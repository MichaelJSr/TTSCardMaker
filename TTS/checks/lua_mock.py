"""Global LuaScript against a mock TTS API (lupa, Lua 5.2), with adversarial cases (seat swaps, Grey/Black, no-team
seats, empty onLoad, double leave, destroyed objects).

    lua_mock.py [save.json] [script.lua]     (script.lua: test it instead of the save's LuaScript)

Checks: Lua 5.2 / MoonSharp syntax only; defines only onLoad, onPlayerChangeColor, onObjectLeaveContainer;
teams Red/Orange/Green -> Hearts, Blue/Purple/Pink -> Clubs, other seats None, Grey/Black untouched, join broadcasts;
large cards scaled 3,1,3 three frames after leaving a container; no hand-zone claiming (no zone or spawn calls).
Exits 1 on a failure.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import need_lupa, save_arg  # noqa: E402

need_lupa()
import lupa.lua52 as lupa  # noqa: E402

SEATS = ["White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink"]
TEAM = {"Red": "Hearts", "Orange": "Hearts", "Green": "Hearts", "Blue": "Clubs", "Purple": "Clubs", "Pink": "Clubs"}
TTS_TEAMS = {"None", "Clubs", "Diamonds", "Hearts", "Spades", "Jokers"}
EVENTS = {"onLoad", "onPlayerChangeColor", "onObjectLeaveContainer"}
LUA_TABLE = re.compile(r"(resizeTargets\s*=\s*\{\n)(.*?)(\n\})", re.DOTALL)        # as commands/tts_save.py
LUA_ROW = re.compile(r'^(\s*)\[\s*"((?:[^"\\]|\\.)*)"\s*\]\s*=\s*(.*?)\s*,?\s*$', re.MULTILINE)
NOT_52 = [(r"//", "integer division"), (r"\bgoto\b", "goto"), (r"::", "label"), (r"&", "bitwise and"),
          (r"\|", "bitwise or"), (r"~(?!=)", "bitwise not/xor"), (r"<<|>>", "shift"), (r"\butf8\.", "utf8 lib"),
          (r"\bmath\.(type|tointeger|ult)\b", "5.3 math"), (r"\bstring\.(pack|unpack|packsize)\b", "5.3 string"),
          (r"\btable\.move\b", "5.3 table.move")]

failures = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        failures.append(what)


def code_only(src):
    """Source with comments and string contents blanked; also returns the strings."""
    out, strings, i = [], [], 0
    while i < len(src):
        long = re.match(r"(--)?\[(=*)\[", src[i:])
        if long:
            end = src.find("]" + long.group(2) + "]", i)
            end = len(src) if end < 0 else end + len(long.group(2)) + 2
            if not long.group(1):
                strings.append(src[i:end])
            out.append(" ")
            i = end
        elif src.startswith("--", i):
            end = src.find("\n", i)
            i = len(src) if end < 0 else end
        elif src[i] in "\"'":
            j = i + 1
            while j < len(src) and src[j] != src[i]:
                j += 2 if src[j] == "\\" else 1
            strings.append(src[i:j + 1])
            out.append('""')
            i = j + 1
        else:
            out.append(src[i])
            i += 1
    return "".join(out), strings


class Player:
    def __init__(self, log, color, seated=False, name=""):
        self._log, self.color, self.seated, self.steam_name, self._team = log, color, seated, name, "None"

    @property
    def team(self):
        return self._team

    @team.setter
    def team(self, value):
        if self.color in ("Grey", "Black"):
            raise RuntimeError(f"team set on {self.color}")
        if value not in TTS_TEAMS:
            raise RuntimeError(f"invalid team {value!r}")
        self._team = value
        self._log.append(("team", self.color, value))


class Obj:
    def __init__(self, log, kind, name, guid):
        self._log, self.type, self.tag, self._name, self._guid, self.destroyed = log, kind, kind, name, guid, False

    def getName(self):
        return self._name

    def getGUID(self):
        return self._guid

    def isDestroyed(self):
        return self.destroyed

    def setScale(self, v):
        if self.destroyed:
            raise RuntimeError("setScale on a destroyed object")
        self._log.append(("scale", self._guid, (v["x"], v["y"], v["z"])))


class Zone:
    def __init__(self, log, guid):
        self._log, self._guid = log, guid

    def __getattr__(self, name):                            # any zone call is logged
        if name.startswith("_"):
            raise AttributeError(name)
        return lambda *a: self._log.append((self._guid, name))


class Wait:
    def __init__(self, log):
        self._log, self.queue = log, []

    def time(self, fn, seconds, reps=1):
        self._log.append(("wait.time", seconds))
        self.queue.append(fn)

    def frames(self, fn, frames=1):
        self._log.append(("wait.frames", frames))
        self.queue.append(fn)

    def condition(self, fn, cond, *a):
        self.queue.append(fn)

    def flush(self):
        while self.queue:
            self.queue.pop(0)()


def main():
    with open(save_arg(), encoding="utf-8") as f:
        script = json.load(f).get("LuaScript") or ""
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as f:
            script = f.read()

    code, strings = code_only(script)
    for pattern, what in NOT_52:
        hits = [m.group(0) for m in re.finditer(pattern, code)]
        check(not hits, f"Lua 5.2: no {what}" + (f" (found {hits[:3]})" if hits else ""))
    check(not any("\\u{" in s for s in strings), "Lua 5.2: no \\u{} escapes")
    m = LUA_TABLE.search(script)
    rows = LUA_ROW.findall(m.group(2)) if m else []
    lines = [x for x in m.group(2).split("\n") if x.strip()] if m else []
    check(bool(m) and rows and len(rows) == len(lines) and not any("--" in x for x in lines),
          f"resizeTargets in the updater's shape ({len(rows)} rows)")
    targets = [k.replace('\\"', '"').replace("\\\\", "\\") for _, k, _ in rows]

    log, msgs, other = [], [], []                          # other: zone, spawn and print calls, never cleared
    lua = lupa.LuaRuntime(unpack_returned_tuples=True)
    g = lua.globals()
    wait = Wait(log)
    players = {c: Player(log, c) for c in SEATS + ["Grey", "Black"]}
    g.Player = lua.table_from(players)
    g.Wait = wait
    g.broadcastToAll = lambda msg, color=None: msgs.append(("all", msg))
    g.broadcastToColor = lambda msg, who, color=None: msgs.append((who, msg))
    g.printToAll = lambda msg, color=None: msgs.append(("all", msg))
    g.printToColor = lambda msg, who, color=None: msgs.append((who, msg))
    g.print = lambda *a: other.append(("print", " ".join(map(str, a))))
    g.getSeatedPlayers = lambda: lua.table_from([c for c in SEATS if players[c].seated])
    g.getObjectFromGUID = lambda guid: Zone(other, guid)
    g.spawnObjectJSON = lambda *a: other.append(("spawn",))
    g.JSON = lua.table_from({"decode": lambda s: lua.table(), "encode": lambda t: "{}"})
    before = set(g.keys())
    try:
        lua.execute(script)
    except lupa.LuaError as e:
        check(False, f"script loads under Lua 5.2: {e}")
        return
    check(True, "script loads under Lua 5.2")
    defined = set(g.keys()) - before
    check(defined == EVENTS, f"defines exactly {sorted(EVENTS)} (got {sorted(defined)})")
    check(not log and not msgs and not other, "loading does nothing by itself")
    lua.execute("setmetatable(_G, {__index = function(_, k) error('undefined global ' .. tostring(k), 2) end})")

    def call(name, *args):
        fn = g[name]
        if fn is None:
            check(False, f"{name} defined")
            return
        try:
            fn(*args)
            wait.flush()
        except (lupa.LuaError, RuntimeError) as e:
            check(False, f"{name}{args}: {e}")

    def joined(color, name):
        return ("all", f"{name} joined {color} → assigned to {TEAM[color]}.")

    # onLoad: seated Red, Orange, Blue, White
    for c, n in [("Red", "Ann"), ("Orange", "Bob"), ("Blue", "Cy"), ("White", "Di")]:
        players[c].seated, players[c].steam_name = True, n
    g.onLoad("")
    check(not any(e[0] == "team" for e in log), "onLoad waits before assigning")
    wait.flush()
    teams = [e[1:] for e in log if e[0] == "team"]
    check(teams == [("White", "None"), ("Red", "Hearts"), ("Orange", "Hearts"), ("Blue", "Clubs")],
          f"onLoad teams {teams}")
    check(msgs == [joined("Red", "Ann"), joined("Orange", "Bob"), joined("Blue", "Cy")], f"onLoad broadcasts {msgs}")

    # onPlayerChangeColor: every seat, then Grey and Black
    for c in SEATS:
        log.clear(), msgs.clear()
        players[c].seated, players[c].steam_name, players[c]._team = True, f"P{c}", "Spades"
        call("onPlayerChangeColor", c)
        want = TEAM.get(c, "None")
        check(players[c].team == want and [e for e in log if e[0] == "team"] == [("team", c, want)],
              f"{c} -> {want}")
        check(msgs == ([joined(c, f"P{c}")] if c in TEAM else []), f"{c} broadcast {msgs}")
    for c in ("Grey", "Black"):
        log.clear(), msgs.clear()
        players[c].seated = True
        call("onPlayerChangeColor", c)
        check(not log and not msgs, f"{c} left alone")
    log.clear(), msgs.clear()
    players["Red"].seated, players["Red"]._team = False, "Spades"
    call("onPlayerChangeColor", "Red")
    check(players["Red"].team == "Spades" and not log and not msgs, "unseated Red left alone")

    # onObjectLeaveContainer
    deck = Obj(log, "Deck", "Minions", "deck01")
    for i, name in enumerate(targets):
        log.clear()
        card = Obj(log, "Card", name, f"c{i:05}")
        g.onObjectLeaveContainer(deck, card)
        early = [e for e in log if e[0] == "scale"]
        wait.flush()
        check(not early and log == [("wait.frames", 3), ("scale", card._guid, (3, 1, 3))], f"{name!r} resized")
    if targets:
        log.clear()
        card = Obj(log, "Card", targets[0], "again1")
        call("onObjectLeaveContainer", deck, card)
        call("onObjectLeaveContainer", deck, card)
        check([e for e in log if e[0] == "scale"] == [("scale", "again1", (3, 1, 3))] * 2, "resized every time it leaves")
        log.clear()
        card = Obj(log, "Card", targets[0], "gone01")
        g.onObjectLeaveContainer(deck, card)
        card.destroyed = True
        try:
            wait.flush()
            check(not any(e[0] == "scale" for e in log), "destroyed before the wait: no resize")
        except (lupa.LuaError, RuntimeError) as e:
            wait.queue.clear()
            check(False, f"destroyed before the wait: {e}")
        for obj, what in [(Obj(log, "Card", "Ditto", "ditto1"), "non-target card"),
                          (Obj(log, "Card", targets[0].lower(), "lower1"), "lower-case name"),
                          (Obj(log, "Deck", targets[0], "deck02"), "deck named like a target"),
                          (Obj(log, "Tile", targets[0], "tile01"), "tile named like a target")]:
            log.clear()
            call("onObjectLeaveContainer", deck, obj)
            check(not log, f"{what}: left alone")

    # ---- adversarial cases ----
    def reset_players():
        for c, p in players.items():
            p.seated, p.steam_name, p._team = False, "", "None"
    def team_events():
        return [e[1:] for e in log if e[0] == "team"]

    # two players switch seats quickly (Red<->Blue), events back to back, no wait in between
    reset_players(); log.clear(), msgs.clear()
    players["Red"].seated, players["Red"].steam_name, players["Red"]._team = True, "Bee", "Hearts"
    players["Blue"].seated, players["Blue"].steam_name, players["Blue"]._team = True, "Ann", "Clubs"
    g.onPlayerChangeColor("Blue")
    g.onPlayerChangeColor("Red")
    pend = list(wait.queue)
    wait.flush()
    check(players["Red"].team == "Hearts" and players["Blue"].team == "Clubs" and not pend,
          f"quick swap Red<->Blue: teams {players['Red'].team}/{players['Blue'].team}, deferred {len(pend)}")
    check(msgs == [joined("Blue", "Ann"), joined("Red", "Bee")], f"quick swap broadcasts {msgs}")

    # Red -> Yellow -> Green in a row (one player hopping)
    reset_players(); log.clear(), msgs.clear()
    for c in ("Red", "Yellow", "Green"):
        for s in SEATS:
            players[s].seated = False
        players[c].seated, players[c].steam_name = True, "Hop"
        call("onPlayerChangeColor", c)
    check(team_events() == [("Red", "Hearts"), ("Yellow", "None"), ("Green", "Hearts")], f"hop teams {team_events()}")

    # swap during onLoad's wait: the deferred pass uses who is seated when it fires
    reset_players(); log.clear(), msgs.clear()
    players["Red"].seated, players["Red"].steam_name = True, "Ann"
    g.onLoad("")
    players["Red"].seated = False
    players["Yellow"].seated, players["Yellow"].steam_name = True, "Ann"
    g.onPlayerChangeColor("Yellow")
    wait.flush()
    check(players["Yellow"].team == "None" and not any(e[1] == "Red" for e in team_events()),
          f"swap during onLoad wait: {team_events()}")

    # Grey and Black: seated or not, with a team already, never touched
    for c in ("Grey", "Black"):
        reset_players(); log.clear(), msgs.clear()
        players[c].seated, players[c].steam_name = True, "Spec"
        object.__setattr__(players[c], "_team", "None")
        call("onPlayerChangeColor", c)
        check(not log and not msgs and not wait.queue, f"{c} (seated) left alone")

    # colour not in any team, and colours TTS has no Player for
    for c in ("Yellow", "Teal", "White", "Brown"):
        reset_players(); log.clear(), msgs.clear()
        players[c].seated, players[c].steam_name, players[c]._team = True, "N", "Diamonds"
        call("onPlayerChangeColor", c)
        check(players[c].team == "None" and not msgs, f"{c} (no team) -> None, silent")
    for c in ("Magenta", "", "red"):
        log.clear(), msgs.clear()
        call("onPlayerChangeColor", c)
        check(not log and not msgs, f"unknown colour {c!r}: no error, nothing done")

    # onLoad with nobody seated
    reset_players(); log.clear(), msgs.clear()
    call("onLoad", "")
    check(not team_events() and not msgs, "onLoad, nobody seated: nothing")
    # onLoad with only Grey/Black (getSeatedPlayers never lists them in mock; TTS lists Black)
    g.getSeatedPlayers = lambda: lua.table_from(["Black"])
    players["Black"].seated = True
    call("onLoad", "")
    check(not team_events() and not msgs, "onLoad, only Black seated: nothing")
    g.getSeatedPlayers = lambda: lua.table_from([c for c in SEATS if players[c].seated])

    if targets:
        # leaves a bag twice before the first wait fires
        bag = Obj(log, "Bag", "Bag", "bag01")
        log.clear()
        card = Obj(log, "Card", targets[-1], "twice1")
        g.onObjectLeaveContainer(bag, card)
        g.onObjectLeaveContainer(bag, card)
        wait.flush()
        check([e for e in log if e[0] == "scale"] == [("scale", "twice1", (3, 1, 3))] * 2,
              "leaves a bag twice before the wait: both resize, no error")
        # leaves, goes back in (destroyed), leaves again as a new object with the same GUID
        log.clear()
        a = Obj(log, "Card", targets[-1], "same01")
        g.onObjectLeaveContainer(bag, a)
        a.destroyed = True
        b = Obj(log, "Card", targets[-1], "same01")
        try:
            g.onObjectLeaveContainer(bag, b)
            wait.flush()
            check([e for e in log if e[0] == "scale"] == [("scale", "same01", (3, 1, 3))],
                  "re-enter then leave again (same GUID): new object resized once, old skipped")
        except (lupa.LuaError, RuntimeError) as e:
            wait.queue.clear()
            check(False, f"re-enter then leave again: {e}")
        # destroyed object whose every method but isDestroyed errors (as TTS)
        class Dead(Obj):
            def getGUID(self):
                if self.destroyed: raise RuntimeError("getGUID on destroyed")
                return self._guid
            def getName(self):
                if self.destroyed: raise RuntimeError("getName on destroyed")
                return self._name
        log.clear()
        d = Dead(log, "Card", targets[0], "dead01")
        g.onObjectLeaveContainer(bag, d)
        d.destroyed = True
        try:
            wait.flush()
            check(not any(e[0] == "scale" for e in log), "destroyed (strict methods): no resize, no error")
        except (lupa.LuaError, RuntimeError) as e:
            wait.queue.clear()
            check(False, f"destroyed (strict methods): {e}")
        # a destroy event must not need handling
        check(lua.eval("rawget(_G, 'onObjectDestroy')") is None, "no onObjectDestroy handler needed")
    check(not other, f"no zone, spawn or print calls {other[:3]}")


try:
    main()
except Exception as e:                                     # a crash is a failure too
    check(False, f"crashed: {type(e).__name__}: {e}")
print(f"{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
