"""The global script (TTS/Global.lua, as written into the save) against a mock TTS API (lupa, Lua 5.2), on the save's own
objects and hand zones, with adversarial cases.

    lua_mock.py [save.json] [script.lua]     (script.lua: test it instead of the save's LuaScript)

Checks: Lua 5.2 / MoonSharp syntax only; no Lua patterns (every find, match, gmatch and gsub with a magic character and
no plain flag is caught as it runs: MoonSharp fails long ones with "pattern too complex"); handlers are TTS events, none
per frame; loading does nothing by itself and builds no UI; teams Red/Orange/Green -> Hearts, Blue/Purple/Pink -> Clubs,
other seats None, Grey/Black untouched; hand zones shared on a side (a free seat's zones go to its first seated
teammate and come back when someone sits there, kept through a save and load; other seats' zones never move); large
cards scaled 3,1,3 three frames after leaving a container; turn markers cycle on a flip only; card details, the
rulebook panel and the card finder on the website's data/tts.json and the repo's TTS/Rulebook/pages.json (the seated
players' panels built once the data is in, a player seated later's a moment after, none on use; the save's own UI kept, every id set exists, every onClick a function, spawns into the hand
face down, Rules buttons and searches turn the PDF to the right page, hidden cards stay hidden).
Data: $TTS_DETAILS (a tts.json file), else the live website. Exits 1 on a failure.
"""
import json
import os
import re
import sys
from urllib.parse import unquote
from urllib.request import urlopen

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import REPO, SITE_URL, need_lupa, save_arg  # noqa: E402

need_lupa()
import lupa.lua52 as lupa  # noqa: E402

SEATS = ["White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink"]
TEAM = {"Red": "Hearts", "Orange": "Hearts", "Green": "Hearts", "Blue": "Clubs", "Purple": "Clubs", "Pink": "Clubs"}
SIDE = {"Hearts": ["Red", "Orange", "Green"], "Clubs": ["Blue", "Purple", "Pink"]}
TTS_TEAMS = {"None", "Clubs", "Diamonds", "Hearts", "Spades", "Jokers"}
TTS_EVENTS = {
    "onLoad", "onSave", "onUpdate", "onFixedUpdate", "onChat", "onExternalMessage", "onBlindfold", "onPlayerAction",
    "onPlayerChangeColor", "onPlayerChangeTeam", "onPlayerConnect", "onPlayerDisconnect", "onPlayerHotkey",
    "onPlayerPing", "onPlayerTurn", "onObjectCollisionEnter", "onObjectCollisionExit", "onObjectCollisionStay",
    "onObjectDestroy", "onObjectDrop", "onObjectEnterContainer", "onObjectEnterZone", "onObjectFlick", "onObjectHover",
    "onObjectLeaveContainer", "onObjectLeaveZone", "onObjectLoopingEffect", "onObjectNumberTyped", "onObjectPageChange",
    "onObjectPeek", "onObjectPickUp", "onObjectRandomize", "onObjectRotate", "onObjectSearchEnd", "onObjectSearchStart",
    "onObjectSpawn", "onObjectStateChange", "onObjectTriggerEffect", "onScriptingButtonDown", "onScriptingButtonUp",
    "onZoneGroupSort"}
NEEDED = {"onLoad", "onSave", "onPlayerChangeColor", "onPlayerDisconnect", "onObjectLeaveContainer", "onObjectSpawn",
          "onObjectEnterZone", "onObjectRotate"}
PER_FRAME = {"onUpdate", "onFixedUpdate"}
LUA_TABLE = re.compile(r"(resizeTargets\s*=\s*\{\n)(.*?)(\n\})", re.DOTALL)        # as commands/tts_save.py
LUA_ROW = re.compile(r'^(\s*)\[\s*"((?:[^"\\]|\\.)*)"\s*\]\s*=\s*(.*?)\s*,?\s*$', re.MULTILINE)
RAW = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/"
LINK = re.compile(re.escape(RAW) + r"[^/]+/(.+)")
NOT_52 = [(r"//", "integer division"), (r"\bgoto\b", "goto"), (r"::", "label"), (r"&", "bitwise and"),
          (r"\|", "bitwise or"), (r"~(?!=)", "bitwise not/xor"), (r"<<|>>", "shift"), (r"\butf8\.", "utf8 lib"),
          (r"\bmath\.(type|tointeger|ult)\b", "5.3 math"), (r"\bstring\.(pack|unpack|packsize)\b", "5.3 string"),
          (r"\btable\.move\b", "5.3 table.move")]
GUARD = r"""
local raw = {find = string.find, match = string.match, gmatch = string.gmatch, gsub = string.gsub}
PATTERN_HITS = {}
local function note(fn, s, p)
    if type(p) == "string" and raw.find(p, "[%^%$%(%)%%%.%[%]%*%+%-%?]") then
        table.insert(PATTERN_HITS, fn .. "('" .. p .. "') over " .. #tostring(s) .. " characters")
    end
end
string.find = function(s, p, i, plain) if not plain then note("find", s, p) end return raw.find(s, p, i, plain) end
string.match = function(s, p, i) note("match", s, p) return raw.match(s, p, i) end
string.gmatch = function(s, p) note("gmatch", s, p) return raw.gmatch(s, p) end
string.gsub = function(s, p, r, n) note("gsub", s, p) return raw.gsub(s, p, r, n) end
"""

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


def walk(objs):
    for o in objs or []:
        yield o
        yield from walk(o.get("ContainedObjects"))


def face_path(d):
    deck = d.get("CustomDeck") or {}
    entry = deck.get(str((d.get("CardID") or 0) // 100)) or next(iter(deck.values()), {})
    m = LINK.match(entry.get("FaceURL") or "")
    return unquote(m.group(1)) if m else None


def kind(name):
    if name in ("Card", "CardCustom"):
        return "Card"
    if name in ("Deck", "DeckCustom"):
        return "Deck"
    if name == "Infinite_Bag":
        return "Infinite"
    if name.endswith("Bag"):
        return "Bag"
    return {"HandTrigger": "Hand"}.get(name, "Generic")


class Player:
    def __init__(self, world, color):
        self._w, self.color, self.seated, self.steam_name, self._team = world, color, False, "", "None"

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
        self._w.log.append(("team", self.color, value))

    def getHandObjects(self):
        return self._w.lua.table_from(self._w.hands.get(self.color, []))

    def getPointerPosition(self):
        return self._w.vec(4, 1, 4)

    def getHandTransform(self, index=1):
        if self.color in ("Grey", "Black"):
            return None
        i = SEATS.index(self.color)
        return self._w.to_lua({"position": {"x": i * 3.0, "y": 1.0, "z": -20.0}, "rotation": {"x": 0, "y": 30.0 * i, "z": 0}})


class Book:
    def __init__(self, world):
        self._w = world

    def setPage(self, n):
        self._w.log.append(("page", n))


class Obj:
    def __init__(self, world, name, nickname="", guid="", data=None):
        self._w, self.name, self.type, self._name, self._guid = world, name, kind(name), nickname, guid
        self._data, self.destroyed, self.is_face_down, self.Book = data or {}, False, False, None
        if name == "Custom_PDF":
            self.Book = Book(world)

    @classmethod
    def of(cls, world, d):
        o = cls(world, d.get("Name", ""), d.get("Nickname", ""), d.get("GUID", ""), d)
        o.is_face_down = bool((d.get("Transform") or {}).get("rotZ", 0) % 360 == 180)
        return o

    def getName(self):
        return self._name

    def getGUID(self):
        return self._guid

    def isDestroyed(self):
        return self.destroyed

    def setScale(self, v):
        if self.destroyed:
            raise RuntimeError("setScale on a destroyed object")
        self._w.log.append(("scale", self._guid, (v["x"], v["y"], v["z"])))

    def setName(self, n):
        self._name = n
        self._w.log.append(("name", self._guid, n))

    def setColorTint(self, t):
        self._w.log.append(("tint", self._guid, tuple(self._w.from_lua(t))))

    def addContextMenuItem(self, label, fn):
        self._w.menus.setdefault(self, []).append((label, fn))

    def getCustomObject(self):                              # a deck's Card answers {}: the script reads its CustomDeck
        url = None
        if self.name == "CardCustom":
            deck = self._data.get("CustomDeck") or {}
            url = (deck.get(str((self._data.get("CardID") or 0) // 100)) or {}).get("FaceURL")
        return self._w.to_lua({"face": url} if url else {})

    def getData(self):
        return self._w.to_lua(self._data)

    def getPosition(self):
        return self._w.vec(1, 1, 1)

    def getRotation(self):
        return self._w.vec(0, 180, 0)

    def getObjects(self):
        return self._w.to_lua([{"name": c.get("Nickname", ""), "guid": c.get("GUID", "")}
                               for c in self._data.get("ContainedObjects") or []])

    def takeObject(self, params):
        guid = params["guid"]
        kids = self._data.get("ContainedObjects") or []
        d = next(c for c in kids if c.get("GUID") == guid)
        self._data["ContainedObjects"] = [c for c in kids if c is not d]
        o = Obj.of(self._w, d)
        self._w.objects.append(o)
        self._w.log.append(("take", guid))
        if params["callback_function"]:
            params["callback_function"](o)
        return o


class Zone(Obj):
    def __init__(self, world, guid, owner):
        super().__init__(world, "HandTrigger", "", guid)
        self.owner = owner

    def getData(self):
        return self._w.to_lua({"FogColor": self.owner})

    def setValue(self, color):
        self.owner = color
        self._w.log.append(("zone", self._guid, color))


class Hands:
    def __init__(self, world):
        self._w = world

    def getHands(self):
        return self._w.lua.table_from(self._w.zones)


class UI:
    def __init__(self, world, base):
        self._w, self.base, self.builds, self.ids, self.attrs, self.values, self.unknown = world, base, [], {}, {}, {}, []
        self._busy = 0

    @property
    def loading(self):                                      # busy for a few reads after a build, as TTS loads it
        self._busy = max(0, self._busy - 1)
        return self._busy > 0

    def getXmlTable(self):
        return self._w.to_lua(self.base)

    def setXmlTable(self, t):
        xml = self._w.from_lua(t)
        self.builds.append(xml)
        self.ids, self.attrs, self.values, self._busy = {}, {}, {}, 3
        def visit(e):
            a = e.get("attributes") or {}
            if "id" in a:
                self.ids[a["id"]] = self.ids.get(a["id"], 0) + 1
                self.attrs[a["id"]] = {k: str(v) for k, v in a.items()}
                self.values[a["id"]] = e.get("value", "")
            for c in e.get("children") or []:
                visit(c)
        for e in xml:
            visit(e)

    def setAttribute(self, id, key, value):
        if id not in self.ids:
            self.unknown.append(f"setAttribute({id!r}, {key!r})")
        self.attrs.setdefault(id, {})[key] = str(value)

    def setValue(self, id, value):
        if id not in self.ids:
            self.unknown.append(f"setValue({id!r})")
        self.values[id] = value

    def on(self, id):
        return self.attrs.get(id, {}).get("active") == "true"

    def text(self, id):
        return self.attrs.get(id, {}).get("text", "")


class Wait:
    LIMIT = 1000    # callbacks one flush may run: a callback that keeps re-arming a wait would otherwise never end

    def __init__(self, world):
        self._w, self.queue = world, []

    def time(self, fn, seconds, reps=1):
        self._w.log.append(("wait.time", seconds))
        self.queue.append(fn)

    def frames(self, fn, frames=1):
        self._w.log.append(("wait.frames", frames))
        self.queue.append(fn)

    def condition(self, fn, cond, timeout=None, on_timeout=None):
        tries = [0]
        def poll():
            if cond():
                fn()
            elif tries[0] < 50:
                tries[0] += 1
                self.queue.append(poll)
            elif on_timeout:
                on_timeout()
        self.queue.append(poll)

    def flush(self):
        for _ in range(self.LIMIT):
            if not self.queue:
                return
            self.queue.pop(0)()
        self.queue.clear()
        raise RuntimeError(f"waits still queued after {self.LIMIT} callbacks (one keeps re-arming itself?)")


class World:
    """One table: a Lua runtime with the mock TTS API around the save's objects, the script loaded."""

    def __init__(self, script, save, zones, base_ui=()):
        self.log, self.shout, self.told, self.logs, self.prints = [], [], [], [], []
        self.menus, self.table_menu, self.spawns, self.web, self.hands = {}, {}, [], [], {}
        self.lua = lupa.LuaRuntime(unpack_returned_tuples=True)
        g = self.g = self.lua.globals()
        self.wait, self.ui = Wait(self), UI(self, list(base_ui))
        self.players = {c: Player(self, c) for c in SEATS + ["Grey", "Black"]}
        self.objects = [Obj.of(self, d) for d in save.get("ObjectStates") or [] if d.get("Name") != "HandTrigger"]
        self.zones = [Zone(self, guid, owner) for guid, owner in zones]
        g.Player = self.lua.table_from(self.players)
        g.Wait, g.UI, g.Hands = self.wait, self.ui, Hands(self)
        g.JSON = self.lua.table_from({"decode": lambda s: self.to_lua(json.loads(s)),
                                      "encode": lambda t: json.dumps(self.from_lua(t))})
        g.WebRequest = self.lua.table_from({"get": lambda url, cb: self.web.append((url, cb))})
        g.broadcastToAll = lambda msg, color=None: self.shout.append(msg)
        g.broadcastToColor = lambda msg, who, color=None: self.told.append((who, msg))
        g.printToAll = lambda msg, color=None: self.prints.append(msg)
        g.printToColor = lambda msg, who, color=None: self.prints.append(msg)
        g.print = lambda *a: self.prints.append(" ".join(map(str, a)))
        g.log = lambda *a: self.logs.append(" ".join(map(str, a)))
        g.getSeatedPlayers = lambda: self.lua.table_from([c for c in SEATS if self.players[c].seated])
        g.getObjects = lambda: self.lua.table_from(self.objects)
        g.getObjectFromGUID = lambda guid: next((o for o in self.objects + self.zones if o.getGUID() == guid), None)
        g.addContextMenuItem = lambda label, fn: self.table_menu.__setitem__(label, fn)
        g.spawnObjectData = self.spawn
        self.lua.execute(GUARD)
        self.before = set(g.keys())
        self.lua.execute(script)
        self.defined = set(g.keys()) - self.before
        self.lua.execute("setmetatable(_G, {__index = function(_, k) error('undefined global ' .. tostring(k), 2) end})")

    def to_lua(self, v):
        if isinstance(v, dict):
            return self.lua.table_from({k: self.to_lua(x) for k, x in v.items()})
        if isinstance(v, (list, tuple)):
            return self.lua.table_from([self.to_lua(x) for x in v])
        return v

    def from_lua(self, v):
        if lupa.lua_type(v) != "table":
            return v
        items = sorted(v.items(), key=lambda kv: (not isinstance(kv[0], int), str(kv[0]) if not isinstance(kv[0], int) else kv[0]))
        if [k for k, _ in items] == list(range(1, len(items) + 1)):
            return [self.from_lua(x) for _, x in items]
        return {k: self.from_lua(x) for k, x in items}

    def vec(self, x, y, z):
        return self.lua.table_from({"x": x, "y": y, "z": z})

    def spawn(self, params):
        p = {k: self.from_lua(params[k]) for k in ("data", "position", "rotation", "scale")}
        self.spawns.append(p)
        o = Obj.of(self, p["data"])
        if params["callback_function"]:
            params["callback_function"](o)
        return o

    def call(self, name, *args):
        fn = self.g[name] if name in self.defined else None
        if fn is None:
            check(False, f"{name} defined")
            return
        try:
            fn(*args)
            self.wait.flush()
        except (lupa.LuaError, RuntimeError) as e:
            self.wait.queue.clear()
            check(False, f"{name}{args}: {e}")

    def run(self, fn, *args, what=""):
        try:
            fn(*args)
            self.wait.flush()
        except (lupa.LuaError, RuntimeError) as e:
            self.wait.queue.clear()
            check(False, f"{what}: {e}")

    def seat(self, *colors):
        for c, p in self.players.items():
            p.seated = c in colors
            p.steam_name = p.steam_name or f"P{c}"

    def respond(self, details, pages):
        for url, cb in self.web:
            text = pages if "pages.json" in url else details
            res = {"is_error": text is None, "error": "offline", "text": text or ""}
            self.run(cb, self.to_lua(res), what=f"WebRequest {url}")
        self.web.clear()

    def team_events(self):
        return [e[1:] for e in self.log if e[0] == "team"]

    def zone_calls(self):
        return [e[1:] for e in self.log if e[0] == "zone"]

    def owners(self):
        return {z.getGUID(): z.owner for z in self.zones}


def expected_owners(homes, seated):
    """Each zone's owner: its own seat when seated or not on a side, else the side's first seated seat, else its own."""
    out = {}
    for guid, home in homes.items():
        owner = home
        if home in TEAM and home not in seated:
            owner = next((c for c in SIDE[TEAM[home]] if c in seated), home)
        out[guid] = owner
    return out


def chapters_of(card, d):
    out = []
    def add(i):
        if i and i not in out and i in d["chapters"]:
            out.append(i)
    if card.get("g"):
        add("timing-tags")
    for t in card.get("t") or []:
        add((d["types"].get(t) or {}).get("c"))
    if card.get("x"):
        add("status-effects")
    for i in card.get("r") or []:
        add(i)
    return out


def named_of(card, d):
    out = [(n, d["statuses"][n]["p"]) for n in card.get("x") or [] if (d["statuses"].get(n) or {}).get("p")]
    return out + [(d["cards"][p]["n"], p) for p in card.get("m") or [] if p in d["cards"]]


def details_text():
    path = os.environ.get("TTS_DETAILS")
    if path:
        with open(path, encoding="utf-8") as f:
            return f.read()
    with urlopen(f"{SITE_URL}/data/tts.json", timeout=60) as r:
        return r.read().decode("utf-8")


def main():
    with open(save_arg(), encoding="utf-8") as f:
        save = json.load(f)
    script = save.get("LuaScript") or ""
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as f:
            script = f.read()
    with open(os.path.join(REPO, "TTS", "Rulebook", "pages.json"), encoding="utf-8") as f:
        pages_text = f.read()
    pages = json.loads(pages_text)["pages"]
    details_raw = details_text()
    details = json.loads(details_raw)

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

    zones = [(o["GUID"], o.get("FogColor")) for o in walk(save.get("ObjectStates")) if o.get("Name") == "HandTrigger"]
    zones.append(("w00001", "White"))                       # a seat on no side: its zone never moves
    homes = dict(zones)
    saved_ui = [{"tag": "Text", "attributes": {"id": "saved_ui"}, "value": "the save's own UI"}]
    try:
        w = World(script, save, zones, saved_ui)
    except lupa.LuaError as e:
        check(False, f"script loads under Lua 5.2: {e}")
        return
    check(True, "script loads under Lua 5.2")
    on = {n for n in w.defined if re.match(r"on[A-Z]", n) and w.lua.eval(f"type(rawget(_G, '{n}'))") == "function"}
    check(on <= TTS_EVENTS, f"handlers are TTS events (not: {sorted(on - TTS_EVENTS)})")
    check(NEEDED <= on, f"handles {sorted(NEEDED)} (missing {sorted(NEEDED - on)})")
    check(not on & PER_FRAME, f"nothing runs every frame ({sorted(on & PER_FRAME)})")
    check(not w.log and not w.shout and not w.told and not w.web and not w.ui.builds and not w.prints,
          "loading does nothing by itself")

    # ---- onLoad: seated Red, Orange, Blue, White ----
    w.seat("Red", "Orange", "Blue", "White")
    for c, n in [("Red", "Ann"), ("Orange", "Bob"), ("Blue", "Cy"), ("White", "Di")]:
        w.players[c].steam_name = n
    w.g.onLoad("")
    check(not w.team_events() and not w.zone_calls() and not w.web, "onLoad waits before acting")
    w.wait.flush()
    check(w.team_events() == [("White", "None"), ("Red", "Hearts"), ("Orange", "Hearts"), ("Blue", "Clubs")],
          f"onLoad teams {w.team_events()}")
    joined = lambda c, n: f"{n} joined {c} → assigned to {TEAM[c]}."
    check(w.shout == [joined("Red", "Ann"), joined("Orange", "Bob"), joined("Blue", "Cy")], f"onLoad broadcasts {w.shout}")
    want = expected_owners(homes, {"Red", "Orange", "Blue", "White"})
    check(w.owners() == want, "onLoad: free seats' hand zones go to the side's first seated player")
    told = dict(w.told)
    check(told.get("Red") == "You hold Green's hand zones too (their seats are free)."
          and told.get("Blue") == "You hold Pink and Purple's hand zones too (their seats are free).",
          f"onLoad: players told which zones they hold {w.told}")
    check(not w.ui.builds, "loading builds no panels")
    check(sorted(u for u, _ in w.web) == sorted([f"{SITE_URL}/data/tts.json", RAW + "main/TTS/Rulebook/pages.json"]),
          f"fetches tts.json and pages.json {[u for u, _ in w.web]}")
    check("Find a card" in w.table_menu, "right-click the table: Find a card")
    bag = next((o for o in w.objects if o.type == "Bag" and o.getName() == "Rulebooks"), None)
    check(bag is not None and [x[0] for x in w.menus.get(bag, [])] == ["Contents and search"],
          "right-click the Rulebooks bag: Contents and search")

    # ---- onPlayerChangeColor: every seat, then Grey and Black ----
    for c in SEATS:
        w.log.clear(), w.shout.clear()
        w.players[c].seated, w.players[c].steam_name, w.players[c]._team = True, f"P{c}", "Spades"
        w.call("onPlayerChangeColor", c)
        team = TEAM.get(c, "None")
        check(w.players[c].team == team and w.team_events() == [(c, team)], f"{c} -> {team}")
        check(w.shout == ([joined(c, f"P{c}")] if c in TEAM else []), f"{c} broadcast {w.shout}")
    check(w.owners() == homes, "every seat taken: every hand zone its own seat's")
    for c in ("Grey", "Black"):
        w.log.clear(), w.shout.clear()
        w.players[c].seated = True
        w.call("onPlayerChangeColor", c)
        check(not w.team_events() and not w.shout and not w.zone_calls(), f"{c} left alone")
    for c in ("Magenta", "", "red"):
        w.log.clear(), w.shout.clear()
        w.call("onPlayerChangeColor", c)
        check(not w.team_events() and not w.shout and not w.zone_calls(), f"unknown colour {c!r}: no error, nothing done")
    w.log.clear(), w.shout.clear()
    w.players["Red"].seated, w.players["Red"]._team = False, "Spades"
    w.call("onPlayerChangeColor", "Red")
    check(w.players["Red"].team == "Spades" and not w.team_events() and not w.shout, "unseated Red: team left alone")

    # ---- hand zones shared on a side ----
    def step(what, seated, fn, *args):
        w.seat(*seated)
        w.log.clear(), w.told.clear()
        w.call(fn, *args)
        check(w.owners() == expected_owners(homes, set(seated)), f"hand zones: {what}")
    step("Red alone on Hearts holds every Hearts zone; Clubs' stay", ["Red"], "onPlayerChangeColor", "Orange")
    check(("Red", "You hold Green and Orange's hand zones too (their seats are free).") in w.told, f"Red told {w.told}")
    step("Orange sits: Orange's come back, Green's stay with Red", ["Red", "Orange"], "onPlayerChangeColor", "Orange")
    step("Red disconnects: Red's and Green's go to Orange", ["Orange"], "onPlayerDisconnect", w.players["Red"])
    step("Orange to Grey: Hearts' zones home again", ["Grey"], "onPlayerChangeColor", "Grey")
    w.seat("Blue", "Yellow")
    w.call("onPlayerChangeColor", "Blue")
    w.log.clear()
    w.call("onPlayerChangeColor", "Yellow")
    check(not w.zone_calls(), "a seat change that moves nothing: no zone calls")
    check(w.owners()["w00001"] == "White", "a seat on no side: its zone never moves")
    state = w.g.onSave()
    try:
        saved = json.loads(state)
        check(saved.get("zoneHome") == homes, "onSave keeps every zone's own seat")
    except (TypeError, ValueError) as e:
        check(False, f"onSave returns JSON: {e}")
        saved = {}
    # load that save (zones as left: Purple's and Pink's with Blue), Purple sits: its zone comes back
    left = [(g, w.owners()[g]) for g, _ in zones]
    w2 = World(script, save, left)
    w2.seat("Blue", "Purple")
    w2.run(w2.g.onLoad, state, what="onLoad(saved state)")
    check(w2.owners() == expected_owners(homes, {"Blue", "Purple"}), "after a load, a zone still knows its own seat")

    # ---- onObjectLeaveContainer: large cards, menus ----
    w.seat("Red", "Blue")
    deck = Obj(w, "Deck", "Minions", "deck01")
    for i, name in enumerate(targets):
        w.log.clear()
        card = Obj(w, "CardCustom", name, f"c{i:05}")
        w.g.onObjectLeaveContainer(deck, card)
        early = [e for e in w.log if e[0] == "scale"]
        w.wait.flush()
        check(not early and w.log == [("wait.frames", 3), ("scale", card.getGUID(), (3, 1, 3))], f"{name!r} resized")
    if targets:
        w.log.clear()
        card = Obj(w, "CardCustom", targets[0], "again1")
        w.call("onObjectLeaveContainer", deck, card)
        w.call("onObjectLeaveContainer", deck, card)
        check([e for e in w.log if e[0] == "scale"] == [("scale", "again1", (3, 1, 3))] * 2, "resized every time it leaves")
        check([x[0] for x in w.menus.get(card, [])] == ["Card details"], "Card details added once per card")
        w.log.clear()
        card = Obj(w, "CardCustom", targets[0], "gone01")
        w.g.onObjectLeaveContainer(deck, card)
        card.destroyed = True
        w.run(lambda: None, what="destroyed before the wait")
        check(not any(e[0] == "scale" for e in w.log), "destroyed before the wait: no resize")
        for obj, what in [(Obj(w, "CardCustom", "Ditto", "ditto1"), "non-target card"),
                          (Obj(w, "CardCustom", targets[0].lower(), "lower1"), "lower-case name"),
                          (Obj(w, "Deck", targets[0], "deck02"), "deck named like a target"),
                          (Obj(w, "Custom_Tile", targets[0], "tile01"), "tile named like a target")]:
            w.log.clear()
            w.call("onObjectLeaveContainer", deck, obj)
            check(not w.log, f"{what}: not resized")
        w.log.clear()
        a = Obj(w, "CardCustom", targets[-1], "same01")
        w.g.onObjectLeaveContainer(bag, a)
        a.destroyed = True
        b = Obj(w, "CardCustom", targets[-1], "same01")
        w.run(w.g.onObjectLeaveContainer, bag, b, what="re-enter then leave again")
        check([e for e in w.log if e[0] == "scale"] == [("scale", "same01", (3, 1, 3))],
              "re-enter then leave again (same GUID): new object resized once, old skipped")

    # ---- turn markers ----
    markers = [o for o in w.objects if o.getName() in ("Has not taken its turn", "Is taking its turn", "Has taken its turn")]
    check(len(markers) == 6, f"six turn markers in the save ({len(markers)})")
    if markers:
        mk = markers[0]
        seen = []
        for _ in range(3):
            w.log.clear()
            w.call("onObjectRotate", mk, 0, 180, "Red", 0, 0)
            seen.append((mk.getName(), [e[2] for e in w.log if e[0] == "tint"]))
        check(seen == [("Is taking its turn", [(1, 1, 0)]), ("Has taken its turn", [(1, 0, 0)]),
                       ("Has not taken its turn", [(0, 1, 0)])], f"a flip cycles a turn marker {seen}")
        w.log.clear()
        w.call("onObjectRotate", mk, 90, 180, "Red", 0, 180)
        check(not w.log, "a spin without a flip: marker unchanged")
        other = Obj(w, "CardCustom", "Mini Doomer", "nm0001")
        w.log.clear()
        w.call("onObjectRotate", other, 0, 180, "Red", 0, 0)
        check(not w.log, "another object flipped: nothing")

    # ---- card details ----
    cards = list({face_path(d): d for d in walk(save.get("ObjectStates")) if d.get("Name") in ("Card", "CardCustom")
                  and face_path(d) in details["cards"]}.values())         # one copy of each card
    def score(d):
        c = details["cards"][face_path(d)]
        return (bool(named_of(c, details)), len(chapters_of(c, details)), bool(c.get("g")), face_path(d))
    cards.sort(key=score, reverse=True)
    check(len(cards) >= 4, f"save cards with details ({len(cards)})")
    if len(cards) < 4:
        return
    target = Obj.of(w, cards[0])
    target.is_face_down = False
    w.call("onObjectLeaveContainer", deck, target)
    menu = dict(w.menus.get(target, []))
    w.run(menu["Card details"], "Red", what="Card details before the data")
    check(("Red", "Card details are still loading.") in w.told and not w.ui.builds, "before the data: 'still loading'")
    w.respond(details_raw, pages_text)
    ui = w.ui
    check(len(ui.builds) == 1 and "Red_d1" in ui.ids and "Blue_d1" in ui.ids and not any(i.startswith("Orange_") for i in ui.ids),
          f"the data in: the seated players' panels built, no one else's ({len(ui.builds)} builds)")
    red = w.players["Red"]
    w.told.clear()
    w.run(menu["Card details"], "Red", what="Card details")
    check(len(ui.builds) == 1, f"a first right-click builds nothing ({len(ui.builds)} builds)")
    if not ui.builds:
        return
    xml = ui.builds[-1]
    check(any((e.get("attributes") or {}).get("id") == "saved_ui" for e in xml), "a build keeps the save's own UI")
    check(all(n == 1 for n in ui.ids.values()), f"ids unique {[i for i, n in ui.ids.items() if n > 1][:3]}")
    calls = {a[k] for a in ui.attrs.values() for k in ("onClick", "onValueChanged") if k in a}
    funcs = {n for n in calls if w.lua.eval(f"type(rawget(_G, '{n}'))") == "function"}
    check(calls and calls == funcs, f"every onClick / onValueChanged is a function (not: {sorted(calls - funcs)})")
    check({a.get("visibility") for i, a in ui.attrs.items() if i.startswith("Red_") and "visibility" in a} == {"Red"},
          "Red's panels only Red sees")
    card = details["cards"][face_path(cards[0])]
    check(ui.on("Red_d1") and ui.values.get("Red_d1_title") == card["n"] and ui.values.get("Red_d1_text"),
          f"Card details: panel 1 shows {card['n']!r}")
    rules, named = chapters_of(card, details), named_of(card, details)
    def slot(kind, i, rows):                                # the button of item i ("Red_d1_c2_3"), in whichever row it went
        return next((f"Red_d1_{kind}{r}_{i}" for r in range(1, rows + 1) if ui.on(f"Red_d1_{kind}{r}_{i}")), None)
    shown_rules = [ui.text(b) for b in (slot("r", i, 4) for i in range(1, 5)) if b]
    check(shown_rules == [f"Rules: {details['chapters'][r]['title']}" for r in rules[:4]], f"Rules buttons {shown_rules}")
    shown_cards = [ui.text(b) for b in (slot("c", i, 6) for i in range(1, 7)) if b]
    check(shown_cards == [f"+ {n}" for n, _ in named[:6]], f"spawn buttons {shown_cards}")
    width = lambda: ui.attrs.get("Red_d1", {}).get("width")
    w.call("detailsSize", red, None, "Red_d1_bigger")
    big = width()
    for _ in range(3):
        w.call("detailsSize", red, None, "Red_d1_smaller")
    check((big, width()) == ("660", "440"), f"A+ / A- size the panel ({big}, {width()})")
    over = []                                               # at the smallest size, every row of buttons fits its width
    for kind, n in (("rules", 4), ("cards", 6)):
        for r in range(1, n + 1):
            row = f"Red_d1_{kind}{r}"
            if not ui.on(row):
                continue
            ws = [int(ui.attrs[b]["preferredWidth"]) for b in (f"Red_d1_{kind[0]}{r}_{i}" for i in range(r, n + 1)) if ui.on(b)]
            if sum(ws) + 6 * (len(ws) - 1) > int(ui.attrs[row]["width"]):
                over.append((row, ws))
    check(not over, f"buttons wrap onto rows, none past its row's width {over}")
    if rules:
        w.log.clear()
        w.call("openRules", red, None, slot("r", 1, 4))
        turned = [e[1] for e in w.log if e[0] == "page"]
        ch = details["chapters"][rules[0]]
        ok = turned and 0 <= turned[0] < len(pages) and (pages[turned[0]].get("num") == str(int(ch["num"]))
                                                          or pages[turned[0]].get("name") == ch["title"])
        check(bool(ok) and ("take", "3a33a8") in w.log, f"Rules: {ch['title']} takes the PDF out of its bag and turns to "
              f"its page {turned}")
        w.log.clear()
        w.call("openRules", red, None, slot("r", 1, 4))
        check(not any(e[0] == "take" for e in w.log) and any(e[0] == "page" for e in w.log),
              "Rules again: the PDF already on the table")
    if named:
        w.spawns.clear()
        w.call("spawnNamed", red, None, slot("c", 1, 6))
        sp = w.spawns[0] if w.spawns else {}
        hand = red.getHandTransform()
        ok = sp and face_path(sp["data"]) == named[0][1] and sp["rotation"][2] == 180 and \
            sp["position"][0] == hand.position.x and len(sp["scale"]) == 3 and min(sp["scale"]) > 0
        check(bool(ok), f"+ {named[0][0]}: spawned into Red's hand face down {sp and (sp['position'], sp['rotation'])}")
    for d in cards[1:4]:                                    # three more: the fourth replaces the oldest panel
        o = Obj.of(w, d)
        o.is_face_down = False
        w.run(w.g.showDetails, "Red", o, what="Card details")
    names = [ui.values.get(f"Red_d{k}_title") for k in (1, 2, 3)]
    want = [details["cards"][face_path(cards[3])]["n"], details["cards"][face_path(cards[1])]["n"],
            details["cards"][face_path(cards[2])]["n"]]
    check(names == want and all(ui.on(f"Red_d{k}") for k in (1, 2, 3)), f"three panels; a fourth replaces the oldest {names}")
    w.call("closeDetails", red, None, "Red_d2_close")
    check(not ui.on("Red_d2"), "X closes a panel")
    w.told.clear()
    down = Obj.of(w, cards[1])
    down.is_face_down = True
    w.run(w.g.showDetails, "Red", down, what="face-down card")
    check(("Red", "No details for this card.") in w.told, "a face-down card: no details")
    secret = Obj.of(w, cards[1])
    w.hands["Blue"] = [secret]
    w.told.clear()
    w.run(w.g.showDetails, "Red", secret, what="card in Blue's hand")
    check(("Red", "No details for this card.") in w.told, "a card in another player's hand: no details")
    w.run(w.g.showDetails, "Blue", secret, what="Blue's own card")
    check(len(ui.builds) == 1 and ui.on("Blue_d1"), "Blue's panels were built with the data: none on use")
    w.seat("Red", "Blue", "Teal")
    w.call("onPlayerChangeColor", "Teal")
    check(len(ui.builds) == 2 and "Teal_d1" in ui.ids and ui.on("Blue_d1") and ui.on("Red_d1") and ui.on("Red_d3")
          and not ui.on("Red_d2"), "Teal seated later: Teal's panels built; the open ones are drawn again")

    # ---- rulebook panel ----
    w.call("openRulebook", "Red")
    chapters = [p for p in pages if (p.get("num", "").isdigit()) or p.get("name") == "Table of Contents"]
    slots = len([i for i in ui.ids if i.startswith("Red_rb_g")])
    listed = [ui.text(f"Red_rb_g{i}") for i in range(1, slots + 1) if ui.on(f"Red_rb_g{i}")]
    check(ui.on("Red_rb") and len(chapters) <= slots and len(listed) == len(chapters),
          f"Contents: {len(listed)} of {len(chapters)} chapters listed ({slots} slots)")
    def search(query):
        words = query.lower().split()
        return [i for i, p in enumerate(pages) if words and all(x in (p.get("t") or "").lower() for x in words)]
    for query in ("stall", "true damage", "(1cd) 50%", "zzqqxx"):
        w.call("rulebookSearch", red, query)
        hits = search(query)
        listed = [i for i in range(1, slots + 1) if ui.on(f"Red_rb_g{i}")]
        title = ui.values.get("Red_rb_title")
        check(len(listed) == min(len(hits), slots) and (title == "Nothing found") == (not hits),
              f"search {query!r}: {len(listed)} pages ({title})")
        if hits and query == "stall":
            w.log.clear()
            w.call("rulebookGo", red, None, "Red_rb_g1")
            check([e[1] for e in w.log if e[0] == "page"] == [hits[0]], f"a found page turns the PDF there ({hits[0]})")
    w.call("closeRulebook", red)
    check(not ui.on("Red_rb"), "X closes the rulebook panel")

    # ---- card finder ----
    w.run(w.table_menu["Find a card"], "Red", w.vec(10, 1, 10), what="Find a card")
    check(ui.on("Red_fc"), "Find a card opens")
    w.call("finderSearch", red, card["n"].lower())
    check(ui.text("Red_fc_g1").startswith(card["n"]), f"search by name: first {ui.text('Red_fc_g1')!r}")
    w.spawns.clear()
    w.call("finderGo", red, None, "Red_fc_g1")
    w.call("finderGo", red, None, "Red_fc_g1")
    ok = len(w.spawns) == 2 and all(face_path(s["data"]) == face_path(cards[0]) and s["rotation"][2] == 180 for s in w.spawns)
    check(ok, "a found card spawns into the hand face down, every click")
    w.call("finderSearch", red, "zzqqxx")
    check(ui.values.get("Red_fc_title") == "No card found" and not ui.on("Red_fc_g1"), "nothing found")
    grey = w.players["Grey"]
    w.run(w.table_menu["Find a card"], "Grey", w.vec(10, 1, 10), what="Grey: Find a card")
    w.call("finderSearch", grey, card["n"].lower())
    w.spawns.clear()
    w.call("finderGo", grey, None, "Grey_fc_g1")
    check(len(w.spawns) == 1 and w.spawns[0]["position"][0] == 10 and w.spawns[0]["rotation"][2] == 0,
          "a spectator's card spawns face up where the table was right-clicked")
    stray = Obj(w, "CardCustom", "Stray", "stray1", {"Name": "CardCustom", "CardID": 100, "CustomDeck": {
        "1": {"FaceURL": RAW + "main/MDW/Nothing_Here.png"}}})
    w.told.clear()
    w.run(w.g.showDetails, "Red", stray, what="unknown card")
    check(("Red", "No details for this card.") in w.told, "a card the data lacks: no details")

    # ---- the website offline ----
    w3 = World(script, save, zones)
    w3.seat("Red")
    w3.run(w3.g.onLoad, "", what="onLoad (offline)")
    w3.respond(None, None)
    w3.run(w3.g.showDetails, "Red", Obj.of(w3, cards[0]), what="Card details offline")
    w3.run(w3.g.openRulebook, "Red", what="rulebook offline")
    check(("Red", "Card details are still loading.") in w3.told and any("not loaded" in x for x in w3.logs)
          and not w3.ui.builds, "website offline: 'still loading', logged, no panels")

    for world in (w, w2, w3):
        hits = list(world.lua.eval("PATTERN_HITS").values())
        check(not hits, f"no Lua patterns {hits[:3]}")
        check(not world.ui.unknown, f"every UI id set exists {world.ui.unknown[:3]}")
        check(not world.prints, f"no prints {world.prints[:3]}")


try:
    main()
except Exception as e:                                     # a crash is a failure too
    check(False, f"crashed: {type(e).__name__}: {e}")
print(f"{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
