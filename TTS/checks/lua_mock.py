"""The global script (TTS/Global.lua, as written into the save) against a mock TTS API (lupa, Lua 5.2), on the save's own
objects and hand zones, with adversarial cases.

    lua_mock.py [save.json] [script.lua]     (script.lua: test it instead of the save's LuaScript)

Checks: Lua 5.2 / MoonSharp syntax only; no Lua patterns (every find, match, gmatch and gsub with a magic character and
no plain flag is caught as it runs: MoonSharp fails long ones with "pattern too complex"); handlers are TTS events, none
per frame; loading does nothing by itself and builds no UI; teams Red/Orange/Green -> Hearts, Blue/Purple/Pink -> Clubs,
other seats None, Grey/Black untouched; hand zones shared on a side (a free seat's zones go to its first seated
teammate and come back when someone sits there, kept through a save and load; other seats' zones never move); large
cards scaled 3,1,3 three frames after leaving a container; turn markers cycle on a flip only; card details, the
rulebook panel and the card finder (aliases, plurals, "status effects") on the website's data/tts.json and the repo's TTS/Rulebook/pages.json (at main, or
pinned to the commit of the Rulebooks bag's PDF, as AutoCroissant tts_save writes it into the save; the seated
players' panels built once the data is in, a player seated later's a moment after, none on use; the save's own UI kept, every id set exists, every onClick a function, spawns into the hand
face down (at the pointer on a seat without one, once the card has gone), Rules buttons and searches turn the PDF to the right page, hidden cards stay hidden; the name plain,
the ability in the website's palette (tts.json ac), every "<" of a text kept from starting a tag; every card's details at each
size: each chapter a whole Rules button, rows fit, each "+ name" spawns its card, the STATUS EFFECTS in the text; a tooltip only
on a name cut short (its whole name), opaque and above every row of buttons); each deck button a copy of the full deck, every card at its count in the save's piles.
Data: $TTS_DETAILS (a tts.json file), else the live website. Exits 1 on a failure.
"""
import json
import os
import re
import sys
from collections import Counter
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
REF = re.compile(re.escape(RAW) + r"([^/]+)/")
PAGES_LINK = re.compile(re.escape(RAW) + r"(main|[0-9a-f]{40})/TTS/Rulebook/pages\.json")
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


def pdf_ref(save):
    """The ref of the Rulebooks bag's PDF link (its Custom_PDF's PDFUrl), or None."""
    for bag in save.get("ObjectStates") or []:
        if bag.get("Nickname") == "Rulebooks" and str(bag.get("Name", "")).endswith("Bag"):
            for o in bag.get("ContainedObjects") or []:
                m = REF.match((o.get("CustomPDF") or {}).get("PDFUrl") or "") if o.get("Name") == "Custom_PDF" else None
                if m:
                    return m.group(1)
    return None


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

    def getHandCount(self):                                 # the hand zones this seat holds
        return sum(z.owner == self.color for z in self._w.zones)

    def getHandObjects(self, index=1):                      # zone index's (hands[(color, i)] past 1); no zone: an error
        if self.color not in self._w.hands and self.color not in {z.owner for z in self._w.zones}:
            raise RuntimeError("Object reference not set to an instance of an object")
        return self._w.lua.table_from(self._w.hands.get(self.color if index == 1 else (self.color, index), []))

    def getPointerPosition(self):
        return self._w.vec(4, 1, 4)

    def getHandTransform(self, index=1):                   # None on a seat without a hand zone, as TTS
        if self.color not in {z.owner for z in self._w.zones}:
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
        self.pos = (1, 1, 1)
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
        return self._w.vec(*self.pos)

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
    def __init__(self, world, guid, owner, transform=None):
        super().__init__(world, "HandTrigger", "", guid)
        self.owner, self._t = owner, transform or {}
        self.pos = (self._t.get("posX", 0), self._t.get("posY", 0), self._t.get("posZ", 0))

    def getRotation(self):
        return self._w.vec(0, self._t.get("rotY", 0), 0)

    def getScale(self):
        return self._w.vec(self._t.get("scaleX", 1), self._t.get("scaleY", 1), self._t.get("scaleZ", 1))

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
        self.calls = 0                                      # setAttribute(s) and setValue calls: what crosses into the game

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
        self.calls += 1

    def setAttributes(self, id, data):
        for key, value in self._w.from_lua(data).items():
            self.setAttribute(id, key, value)
        self.calls += 1 - len(self._w.from_lua(data))

    def setValue(self, id, value):
        if id not in self.ids:
            self.unknown.append(f"setValue({id!r})")
        self.values[id] = value
        self.calls += 1

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
        self.lua.execute("collectgarbage('stop')")          # lupa 2.8's wrapper cache can hand back another object after a collection
        g = self.g = self.lua.globals()
        self.wait, self.ui = Wait(self), UI(self, list(base_ui))
        self.players = {c: Player(self, c) for c in SEATS + ["Grey", "Black"]}
        self.objects = [Obj.of(self, d) for d in save.get("ObjectStates") or [] if d.get("Name") != "HandTrigger"]
        where = {o.get("GUID"): o.get("Transform") for o in walk(save.get("ObjectStates")) if o.get("Name") == "HandTrigger"}
        self.zones = [Zone(self, guid, owner, where.get(guid)) for guid, owner in zones]
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


def plain(text):                                            # Global.lua plain: a "<" never starts a tag
    return text.replace("<", "<<b></b>")


def painted(text, pieces):                                  # Global.lua painted: each piece the nth find after the last
    out, at = [], 0
    for p in pieces or []:
        s, start = None, at
        if isinstance(p, list) and len(p) > 1 and isinstance(p[0], str) and p[0] and re.fullmatch(r"#[0-9a-f]{6}", str(p[1])):
            for _ in range(max(1, int(p[2]) if len(p) > 2 else 1)):
                s = text.find(p[0], start)
                if s < 0:
                    s = None
                    break
                start = s + 1
        if s is not None:
            out.append(f"{plain(text[at:s])}<color={p[1]}>{plain(p[0])}</color>")
            at = s + len(p[0])
    return "".join(out) + plain(text[at:])


STATUS_HEAD = "\n<color=#7dd3fc><b>STATUS EFFECTS</b></color>\n"   # Global.lua detailsText's section


def status_line(n, s):                                      # Global.lua detailsText: a STATUS EFFECTS line's start
    name = f"<color={s['c']}>{plain(n)}</color>" if re.fullmatch(r"#[0-9a-f]{6}", str(s.get("c"))) else plain(n)
    return f"<b>{name}</b> <color=#94a3b8>({plain(s['k'])})</color>  "


def offset_y(ui, i):
    return -float(ui.attrs[i].get("offsetXY", "0 0").split()[1])


def ability_lines(ui, panel):                               # the ability's laid-out lines, top down:
    out = []                                                # [(y, [(text, tooltip)])], a plain line one text
    for i in range(1, 11):
        if ui.on(f"{panel}_al{i}"):
            out.append((offset_y(ui, f"{panel}_al{i}"), [(ui.values.get(f"{panel}_al{i}") or "", "")]))
    for i in range(1, 7):
        row = f"{panel}_as{i}"
        if ui.on(row):
            out.append((offset_y(ui, row), [(ui.values.get(f"{row}_{j}") or "", ui.attrs[f"{row}_{j}"].get("tooltip") or "")
                                            for j in range(1, 8) if ui.on(f"{row}_{j}")]))
    return sorted(out)


def panel_text(ui, panel):                                  # the details as one text (the ability's lines joined)
    head, lines = ui.values.get(f"{panel}_text") or "", ability_lines(ui, panel)
    if not lines and not ui.on(f"{panel}_rest"):
        return head
    rest = ui.values.get(f"{panel}_rest") or "" if ui.on(f"{panel}_rest") else ""
    return head + "\n\n" + "\n".join(" ".join(t for t, _ in els) for _, els in lines) + ("\n" + rest if rest else "")


RICH = re.compile(r"<color=(#[0-9a-fA-F]{6})>|</color>|<b>|</b>")


def drawn(rich):                                            # rich text as drawn: [(char, colour, bold)], tags gone
    out, colours, bold, i = [], [None], 0, 0
    while i < len(rich):
        m = RICH.match(rich, i) if rich[i] == "<" else None
        if m:
            t = m.group(0)
            if m.group(1):
                colours.append(m.group(1))
            elif t == "</color>":
                colours.pop() if len(colours) > 1 else None
            else:
                bold += 1 if t == "<b>" else -1
            i = m.end()
        else:
            out.append((rich[i], colours[-1], bold > 0))
            i += 1
    return out


BADGE = {"turn": "#60a5fa", "any": "#a78bfa", "forced": "#f87171", "trigger": "#fbbf24", "neutral": "#cbd5e1"}


def with_badges(text, d):                                   # Global.lua withBadges: a known "(tag)" in its group's colour
    case, out, i = {t.upper(): t for t in d["tags"]}, [], 0
    while True:
        o = text.find("(", i)
        if o < 0:
            return "".join(out) + text[i:]
        c = text.find(")", o + 1)
        tag = case.get(text[o + 1:c].upper()) if c >= 0 and c - o <= 8 else None
        if tag:
            out += [text[i:o], f"<color={BADGE.get(d['tags'][tag].get('g'), BADGE['neutral'])}><b>({tag})</b></color>"]
            i = c + 1
        else:
            out.append(text[i:o + 1])
            i = o + 1


def ability_wrong(ui, panel, card, d, wide):                # laid out, the ability draws as one text would;
    lines = ability_lines(ui, panel)                        # each status word its rule on hover; lines stacked, fit
    if not lines:
        return []
    wrong = []
    want = drawn(with_badges(painted(card.get("a") or "", card.get("ac")), d))
    got = drawn("\n".join(" ".join(t for t, _ in els) for _, els in lines))
    if [c for c in want if not c[0].isspace()] != [c for c in got if not c[0].isspace()] \
            or "".join(c[0] for c in want).split() != "".join(c[0] for c in got).split():
        wrong.append("ability drawn differently")
    for _, els in lines:
        for t, tip in els:
            seen = "".join(c[0] for c in drawn(t))
            words = re.split(r"[\s,.()/]+", seen)
            names = sorted({p[0] for p in card.get("ac") or [] if isinstance(p, list) and p and p[0] in d["statuses"]
                            and set(words) & set(p[0].split())}, key=lambda n: min(words.index(w) for w in n.split() if w in words))
            ok = {d["statuses"][n]["x"] for n in names} | {"\n".join(f"{n}: {d['statuses'][n]['x']}" for n in names)}
            if tip and tip not in ok:
                wrong.append(f"tooltip {tip!r} on {t!r}")
            if names and len(els) > 1 and not tip and len(els) < 7:
                wrong.append(f"no tooltip on {t!r}")
    ys = [y for y, _ in lines]
    if any(b - a <= 0 for a, b in zip(ys, ys[1:])) or (ui.on(f"{panel}_rest") and offset_y(ui, f"{panel}_rest") < ys[-1]):
        wrong.append(f"lines overlap {ys}")
    if any(float(ui.attrs[i]["width"]) != wide for i in ui.attrs if i.startswith(f"{panel}_a") and ui.on(i) and "width" in ui.attrs[i]):
        wrong.append("a line not the text's width")
    return wrong


def status_wrong(ui, panel, card, d):                       # the STATUS EFFECTS lines in the text, last, in order
    want = [status_line(n, d["statuses"][n]) for n in card.get("x") or [] if n in d["statuses"]]
    text = panel_text(ui, panel)
    at = text.find(STATUS_HEAD)
    if not want:
        return ["a STATUS EFFECTS heading"] if at >= 0 else []
    if at < 0:
        return ["no STATUS EFFECTS heading"]
    lines = text[at + len(STATUS_HEAD):].split("\n")
    return [f"status line {i}" for i, w in enumerate(want) if not any(x.startswith(w) for x in lines)]


TIP = {"tooltipPosition": "Above", "tooltipBackgroundColor": "#0f1729", "tooltipTextColor": "#e8edf5", "tooltipBorderColor": "#3b4b6b"}


def tip_wrong(ui, panel):                                   # a tooltip only on a name cut short: the whole name, as the
    wrong, top = [], 0                                      # panel, above every row of buttons
    kinds = {"rules": ("r", 3, 5), "cards": ("c", 2, 6), "decks": ("k", 3, 8)}      # button prefix, rows, buttons
    rows = [(f"{panel}_{k}{r}", k, r) for k, (_, n, _) in kinds.items() for r in range(1, n + 1)]
    for row, _, _ in rows:
        if ui.on(row):
            top = max(top, float(ui.attrs[row]["offsetXY"].split()[1]) + 30)
    for row, kind, r in rows:
        x, _, n = kinds[kind]
        for i in range(r, n + 1):
            b = f"{panel}_{x}{r}_{i}"
            a, tip = ui.attrs.get(b, {}), ui.attrs.get(b, {}).get("tooltip") or ""
            if any(a.get(k) != v for k, v in TIP.items()):
                wrong.append((b, "style"))
            if not ui.on(b) or not tip:
                continue
            text = ui.text(b)
            if not text.endswith("...") or not tip.startswith(text[:-3].replace("<<b></b>", "<")) or "\n" in tip:
                wrong.append((b, text, tip))
            if float(ui.attrs[row]["offsetXY"].split()[1]) + 30 + float(a.get("tooltipOffset", 8)) < top + 8:
                wrong.append((b, "over the buttons", a.get("tooltipOffset")))
    return wrong


def named_of(card, d):                                      # [(name, path)]
    out = [(n, d["statuses"][n]["p"]) for n in card.get("x") or [] if (d["statuses"].get(n) or {}).get("p")]
    return out + [(d["cards"][p]["n"], p) for p in card.get("m") or [] if p in d["cards"]]


def spawn_label(ui, b):                                     # a "+ name" button's name (whole on hover when shortened)
    return ui.attrs[b].get("tooltip") or ui.text(b)


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
    urls, pdf = [u for u, _ in w.web], pdf_ref(save)
    refs = [m.group(1) for u in urls if (m := PAGES_LINK.fullmatch(u))]
    check(len(urls) == 2 and f"{SITE_URL}/data/tts.json" in urls and len(refs) == 1 and refs[0] in ("main", pdf),
          f"fetches tts.json and pages.json, at main or pinned with the Rulebooks PDF ({pdf}): {urls}")
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
    check(ui.on("Red_d1") and ui.values.get("Red_d1_title") == plain(card["n"]) and ui.values.get("Red_d1_text"),
          f"Card details: panel 1 shows {card['n']!r}")
    rules, named = chapters_of(card, details), named_of(card, details)
    def slot(kind, i):                                      # the button of item i ("Red_d1_r2_3"), in whichever row it went
        return next((f"Red_d1_{kind}{r}_{i}" for r in range(1, 4) if ui.on(f"Red_d1_{kind}{r}_{i}")), None)
    shown_rules = [ui.text(b) for b in (slot("r", i) for i in range(1, 6)) if b]
    check(shown_rules == [f"Rules: {details['chapters'][r]['title']}" for r in rules[:5]], f"Rules buttons {shown_rules}")
    shown_cards = [spawn_label(ui, b) for b in (slot("c", i) for i in range(1, 7)) if b]
    check(shown_cards == [f"+ {n}" for n, _ in named[:6]] and not tip_wrong(ui, "Red_d1"),
          f"spawn buttons; a tooltip only on a name cut short {shown_cards} {tip_wrong(ui, 'Red_d1')}")
    before = ui.calls
    w.run(w.g.showDetails, "Red", target, what="Card details again")
    check(ui.calls == before, f"the same card again sends nothing to the game ({ui.calls - before} calls)")
    width = lambda: ui.attrs.get("Red_d1", {}).get("width")
    w.call("detailsSize", red, None, "Red_d1_bigger")
    big = width()
    for _ in range(3):
        w.call("detailsSize", red, None, "Red_d1_smaller")
    check((big, width()) == ("660", "440"), f"A+ / A- size the panel ({big}, {width()})")
    over, cut = [], []                                      # at the smallest size, each row of buttons fits its width
    for kind, n, rows in (("rules", 5, 3), ("cards", 6, 2)):
        for r in range(1, rows + 1):
            row = f"Red_d1_{kind}{r}"
            if not ui.on(row):
                continue
            bs = [b for b in (f"Red_d1_{kind[0]}{r}_{i}" for i in range(r, n + 1)) if ui.on(b)]
            ws = [int(ui.attrs[b]["preferredWidth"]) for b in bs]
            if sum(ws) + 6 * (len(ws) - 1) > int(ui.attrs[row]["width"]):
                over.append((row, ws))
            cut += [(ui.text(b), ui.attrs[b].get("tooltip")) for b in bs if ui.text(b).endswith("...")]
    check(not over and all(tip and tip.startswith(text[:-3]) for text, tip in cut) and not any(t.startswith("Rules") for t, _ in cut),
          f"a row's buttons fit it (Rules wrap, never shortened; a long name shortened with '...', whole on hover) {over or cut}")
    if rules:
        w.log.clear()
        w.call("openRules", red, None, slot("r", 1))
        turned = [e[1] for e in w.log if e[0] == "page"]
        ch = details["chapters"][rules[0]]
        ok = turned and 0 <= turned[0] < len(pages) and (pages[turned[0]].get("num") == str(int(ch["num"]))
                                                          or pages[turned[0]].get("name") == ch["title"])
        check(bool(ok) and ("take", "3a33a8") in w.log, f"Rules: {ch['title']} takes the PDF out of its bag and turns to "
              f"its page {turned}")
        w.log.clear()
        w.call("openRules", red, None, slot("r", 1))
        check(not any(e[0] == "take" for e in w.log) and any(e[0] == "page" for e in w.log),
              "Rules again: the PDF already on the table")
    if named:
        w.spawns.clear()
        w.call("spawnNamed", red, None, slot("c", 1))
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
    want = [plain(c["n"]) for c in (details["cards"][face_path(cards[k])] for k in (3, 1, 2))]
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
    slot = Obj.of(w, cards[1])
    w.hands[("Blue", 3)] = [slot]
    w.told.clear()
    w.run(w.g.showDetails, "Red", slot, what="card in Blue's third hand zone")
    check(("Red", "No details for this card.") in w.told, "a card in another player's third hand zone: no details")
    w.run(w.g.showDetails, "Blue", secret, what="Blue's own card")
    check(len(ui.builds) == 1 and ui.on("Blue_d1"), "Blue's panels were built with the data: none on use")
    w.seat("Red", "Blue", "Teal")
    w.call("onPlayerChangeColor", "Teal")
    check(len(ui.builds) == 2 and "Teal_d1" in ui.ids and ui.on("Blue_d1") and ui.on("Red_d1") and ui.on("Red_d3")
          and not ui.on("Red_d2"), "Teal seated later: Teal's panels built; the open ones are drawn again")
    if named:                                               # Teal has no hand zone; the card then went into a deck
        teal, gone = w.players["Teal"], Obj.of(w, cards[0])
        gone.is_face_down = False
        w.run(w.g.showDetails, "Teal", gone, what="Teal: Card details")
        gone.destroyed = True
        b = next((f"Teal_d1_c{r}_1" for r in range(1, 3) if ui.on(f"Teal_d1_c{r}_1")), None)
        w.spawns.clear()
        if b:
            w.call("spawnNamed", teal, None, b)
        sp, p = (w.spawns[0] if len(w.spawns) == 1 else {}), teal.getPointerPosition()
        check(bool(sp) and sp["position"] == [p.x + 2.6, p.y + 1.5, p.z] and sp["rotation"][2] == 0,
              f"a seat with no hand: + name after the card left spawns at the pointer {sp and sp['position']}")
        w.call("closeDetails", teal, None, "Teal_d1_close")

    # ---- deck buttons ----
    block = re.search(r"\nlocal DECKS = \{\n(.*?)\n\}", script, re.DOTALL)
    listed = re.findall(r'^\s*\["((?:[^"\\]|\\.)*)"\]\s*=', block.group(1), re.MULTILINE) if block else []
    by_name = {c["n"]: p for p, c in details["cards"].items()}
    check(listed and all(n in by_name for n in listed), f"DECKS: every card named is in tts.json {[n for n in listed if n not in by_name]}")
    eden = by_name.get("Tainted Eden")
    if eden:
        teal = w.players["Teal"]
        url = RAW + "main/" + eden.replace(" ", "%20")
        o = Obj.of(w, {"Name": "CardCustom", "Nickname": "Tainted Eden", "GUID": "te0001", "CardID": 100,
                       "CustomDeck": {"1": {"FaceURL": url, "BackURL": RAW + "main/MDW/Assets/cardback.png"}}})
        w.run(w.g.showDetails, "Teal", o, what="Card details: Tainted Eden")
        for _ in range(3):
            w.call("detailsSize", teal, None, "Teal_d1_smaller")
        btn = {i: next((f"Teal_d1_k{r}_{i}" for r in range(1, 4) if ui.on(f"Teal_d1_k{r}_{i}")), None) for i in range(1, 9)}
        labels = [ui.text(b) if b else None for b in btn.values()]
        want = [f"+ {n}★ Equips" for n in range(1, 5)] + [f"+ {n}★ Items" for n in range(1, 5)]
        over = [r for r in range(1, 4) if ui.on(f"Teal_d1_decks{r}") and sum(int(ui.attrs[b]["preferredWidth"]) + 6 for b in btn.values()
                if b and b.startswith(f"Teal_d1_k{r}_")) - 6 > int(ui.attrs[f"Teal_d1_decks{r}"]["width"])]
        check(labels == want and not over, f"Tainted Eden: 8 deck buttons, unshortened at the smallest size {labels} {over}")
        w.spawns.clear()
        w.call("spawnDeck", teal, None, btn[8])
        sp = w.spawns[0] if len(w.spawns) == 1 else {}
        d = sp.get("data") or {}
        kids = d.get("ContainedObjects") or []
        paths = sorted(face_path(k) for k in kids)
        expect = sorted(p for p in details["cards"] if p.startswith("Items/") and "/4 Stars/" in p)
        ok = d.get("Name") == "Deck" and paths == expect and d.get("DeckIDs") == [k["CardID"] for k in kids] and \
            all(str(int(k["CardID"]) // 100) in d["CustomDeck"] for k in kids) and sp["rotation"][2] == 180 and \
            sp["position"][1] == 3 and min(sp["scale"]) > 0
        check(bool(ok), f"+ 4★ Items: one shuffled deck of every Items/*/4 Stars card ({len(paths)} of {len(expect)}), face down beside the card")
        w.spawns.clear()
        w.call("spawnDeck", teal, None, btn[3])
        got = Counter(map(face_path, w.spawns[0]["data"].get("ContainedObjects") or [] if len(w.spawns) == 1 else []))
        typed = sorted(p for p, c in details["cards"].items() if p.startswith("Items/") and "/3 Stars/" in p
                       and {"equip", "fragileequip"} & set(c.get("t") or []))
        most = Counter()                                  # path -> the most copies one saved deck holds
        for x in walk(save.get("ObjectStates")):
            if x.get("Name") == "Deck":
                most |= Counter(map(face_path, x.get("ContainedObjects") or []))
        want = Counter({p: most[p] or 1 for p in typed})
        check(got == want, f"+ 3★ Equips: every 3★ item with an equip icon, at its count ({got.total()} of {want.total()}; "
              f"from other folders {[p.split('/')[-1] for p in typed if not p.startswith('Items/Equip/')]})")
        every = lambda names: set.intersection(*(set(x) for x in walk(save.get("ObjectStates")) if x.get("Name") in names))
        saved_deck, saved_card = every({"Deck"}), every({"Card", "CardCustom"})   # the fields every saved one has
        lacks = lambda have, model: sorted(set(model) - {"GUID"} - set(have))
        check(not lacks(d, saved_deck) and not any(lacks(k, saved_card) for k in kids) and d.get("Nickname") == "4★ Items",
              f"the deck has a saved deck's fields, named '4★ Items' ({d.get('Nickname')!r}; lacks {lacks(d, saved_deck)})")
        # a copy of the full deck: each card at its count in the save's 2★ item deck (Metronome 5, Bomb 3), else once
        two = {p for p in details["cards"] if p.startswith("Items/") and "/2 Stars/" in p}
        held = max((Counter(p for p in map(face_path, x.get("ContainedObjects") or []) if p in two)
                    for x in walk(save.get("ObjectStates")) if x.get("Name") == "Deck"), key=lambda c: c.total(), default=Counter())
        want = Counter({p: held[p] or 1 for p in two})
        w.spawns.clear(), w.told.clear()
        w.call("spawnDeck", teal, None, btn[6])
        got = Counter(map(face_path, w.spawns[0]["data"]["ContainedObjects"] if len(w.spawns) == 1 else []))
        check(got == want and max(held.values(), default=0) > 1 and ("Teal", f"2★ Items: {want.total()} cards, shuffled.") in w.told,
              f"+ 2★ Items: a copy of the save's full deck ({got.total()} of {want.total()} cards; {held.most_common(3)})")
        hand = next(z for z in w.zones if z._t.get("scaleX", 0) > 10)    # a card in a big hand zone, then in a small one
        clear = lambda x, z: all(abs(x - h.pos[0]) > h._t["scaleX"] / 2 + 1.9 or abs(z - h.pos[2]) > h._t["scaleZ"] / 2 + 1.9
                                 for h in w.zones if h._t)
        for zone in (hand, next(z for z in w.zones if 0 < z._t.get("scaleX", 0) < 10)):
            o.pos = zone.pos
            w.spawns.clear()
            w.call("spawnDeck", teal, None, btn[1])
            sp = w.spawns[0] if len(w.spawns) == 1 else {}
            x, y, z = sp["position"] if sp else (0, 0, 0)
            check(bool(sp) and clear(x, z) and abs(x - zone.pos[0]) < 15 and abs(z - zone.pos[2]) < 12,
                  f"+ 1★ Equips from a card in hand zone {zone.getGUID()} at {zone.pos}: beside it, clear of every hand zone ({x:.1f}, {z:.1f})")
        o.pos = (1, 1, 1)
        # a card the save lacks: made, in a saved card's fields (another table, without one 4★ item)
        drop = expect[0]
        save2 = json.loads(json.dumps(save))
        def strip(objs):
            kept = [x for x in objs or [] if face_path(x) != drop]
            for x in kept:
                if x.get("ContainedObjects"):
                    x["ContainedObjects"] = strip(x["ContainedObjects"])
            return kept
        save2["ObjectStates"] = strip(save2["ObjectStates"])
        w2 = World(script, save2, zones, saved_ui)
        w2.seat("Teal")
        w2.g.onLoad("")
        w2.wait.flush()
        w2.respond(details_raw, pages_text)
        w2.run(w2.g.showDetails, "Teal", Obj.of(w2, o._data), what="Card details: Tainted Eden (second table)")
        b8 = next((f"Teal_d1_k{r}_8" for r in range(1, 4) if w2.ui.on(f"Teal_d1_k{r}_8")), None)
        w2.call("spawnDeck", w2.players["Teal"], None, b8)
        kids2 = w2.spawns[0]["data"]["ContainedObjects"] if len(w2.spawns) == 1 else []
        made = [k for k in kids2 if face_path(k) == drop]
        ok = len(kids2) == len(expect) and len(made) == 1 and not lacks(made[0], saved_card) and \
            made[0].get("Nickname") == details["cards"][drop]["n"] and int(made[0]["CardID"]) // 100 > 1727 and \
            str(int(made[0]["CardID"]) // 100) in w2.spawns[0]["data"]["CustomDeck"]
        check(ok, f"a card the save lacks ({drop}) is made in a saved card's fields, its own CustomDeck key {made and made[0].get('CardID')}")
        check(not w2.told or all("failed" not in m for _, m in w2.told), f"no deck button errors {w2.told}")

    # ---- rulebook panel ----
    w.call("openRulebook", "Red")
    chapters = [p for p in pages if (p.get("num", "").isdigit()) or p.get("name") == "Table of Contents"]
    slots = len([i for i in ui.ids if i.startswith("Red_rb_g")])
    listed = [ui.text(f"Red_rb_g{i}") for i in range(1, slots + 1) if ui.on(f"Red_rb_g{i}")]
    check(ui.on("Red_rb") and len(chapters) <= slots and len(listed) == len(chapters),
          f"Contents: {len(listed)} of {len(chapters)} chapters listed ({slots} slots)")
    def search(query):
        words = query.lower().replace("(", " ").replace(")", " ").split()       # "(1CD)" finds the drawn 1CD
        return [i for i, p in enumerate(pages) if words and all(x in (p.get("t") or "").lower() for x in words)]
    for query in ("stall", "true damage", "(1CD)", "(1cd) 50%", "zzqqxx"):
        w.call("rulebookSearch", red, query)
        hits = search(query)
        listed = [int(ui.text(f"Red_rb_g{i}").split()[1]) - 1 for i in range(1, slots + 1) if ui.on(f"Red_rb_g{i}")]
        title = ui.values.get("Red_rb_title")
        check(listed == hits[:slots] and (title == "Nothing found") == (not hits),
              f"search {query!r}: pages {[i + 1 for i in listed]} ({title})")
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
    finder_rows = lambda: (ui.values.get("Red_fc_title"), [ui.text(i) for i in sorted(ui.ids) if i.startswith("Red_fc_g") and ui.on(i)])
    w.call("finderSearch", red, "5 star")
    one = finder_rows()
    w.call("finderSearch", red, "5 stars")
    check(one[0] != "No card found" and finder_rows() == one, f"a plural finds what its singular does: '5 stars' {finder_rows()[0]!r}, '5 star' {one[0]!r}")
    w.call("finderSearch", red, "status effects")
    statuses, title = sum(c.get("k") in ("Buff", "Debuff") for c in details["cards"].values()), ui.values.get("Red_fc_title")
    check(statuses and title.split()[0] == str(statuses), f"'status effects' finds every buff and debuff ({title!r}, {statuses})")
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

    # ---- the palette's colours, status lines, and text that looks like rich text ----
    path = face_path(cards[0])
    st = {"Burn": {"x": "3 DMG <hot>, -1 SPD", "k": "debuff", "c": "#db923d", "xc": [["-1 SPD", "#ffd21f"]], "p": path},
          **{f"S{i}": {"x": f"rule {i}", "k": "buff"} for i in range(1, 7)}}
    odd = {**details["cards"][path], "n": "Rose <b>Thorn</b> <color=#ff0000>x", "nc": [["Thorn", "#ff7a1a"]], "al": ["Zqrose"],
           "a": "<i>Burn</i> a Burn, then Burn<3\nBurn", "ac": [["Burn", "#ff0000", 2], ["Burn<3", "#00ff00"], ["gone", "#0000ff"], ["Burn", "#0000ff"]],
           "x": ["Burn", "Gone", *list(st)[1:]]}
    w4 = World(script, save, zones)
    w4.seat("Red")
    w4.g.onLoad("")
    w4.wait.flush()
    odd_details = {**details, "statuses": {**details["statuses"], **st}, "cards": {**details["cards"], path: odd}}
    w4.respond(json.dumps(odd_details), pages_text)
    w4.run(w4.g.showDetails, "Red", Obj.of(w4, cards[0]), what="Card details: colours")
    title, text = w4.ui.values.get("Red_d1_title") or "", panel_text(w4.ui, "Red_d1")
    check(title == "Rose <<b></b>b>Thorn<<b></b>/b> <<b></b>color=#ff0000>x" and title == plain(odd["n"]),
          f"the name plain (no nc), the card's own '<' no tag {title!r}")
    tail = text[text.find(STATUS_HEAD):]
    check(tail == STATUS_HEAD + '<b><color=#db923d>Burn</color></b> <color=#94a3b8>(debuff)</color>  3 DMG <<b></b>hot>, <color=#ffd21f>-1 SPD</color>'
          + "".join(f"\n<b>S{i}</b> <color=#94a3b8>(buff)</color>  rule {i}" for i in range(1, 7))
          and not status_wrong(w4.ui, "Red_d1", odd, odd_details) and "Red_d1_s1" not in w4.ui.ids
          and not any(w4.ui.attrs.get(i, {}).get("tooltip") for i in w4.ui.ids if i.startswith("Red_d1_") and ("_text" in i or "_rest" in i)),
          f"STATUS EFFECTS last in the text, each its line in its colour, its rule's words in theirs, no tooltip; one unknown left "
          f"out {tail[:160]!r} {status_wrong(w4.ui, 'Red_d1', odd, odd_details)}")
    check("<<b></b>i>Burn<<b></b>/i> a <color=#ff0000>Burn</color>, then <color=#00ff00>Burn<<b></b>3</color>\n<color=#0000ff>Burn</color>" in text,
          "the ability in its colours: the nth find, a piece not found skipped, '<' no tag")
    laid = ability_lines(w4.ui, "Red_d1")
    check([[tip for _, tip in els] for _, els in laid] == [["", st["Burn"]["x"], ""], [st["Burn"]["x"]]]
          and all(w4.ui.attrs["Red_d1_as1_2"].get(k) == v for k, v in TIP.items()) and not ability_wrong(w4.ui, "Red_d1", odd, odd_details, 496),
          f"the ability line by line, each status word its rule on hover, as the panel; the rest no tooltip {laid}")
    burn = next((f"Red_d1_c{r}_1" for r in range(1, 3) if w4.ui.on(f"Red_d1_c{r}_1")), None)
    check(burn and w4.ui.text(burn) == "+ Burn" and not w4.ui.attrs[burn].get("tooltip"), f"'+ Burn': no rule on hover {burn and w4.ui.attrs[burn]}")
    w4.run(w4.table_menu["Find a card"], "Red", w4.vec(10, 1, 10), what="Find a card: '<' in a name")
    w4.call("finderSearch", w4.players["Red"], "thorn</b>")
    check(w4.ui.text("Red_fc_g1").startswith(plain(odd["n"]) + "   "), f"the finder's row: the name, '<' no tag {w4.ui.text('Red_fc_g1')!r}")
    w4.call("finderSearch", w4.players["Red"], "zqrose")
    check(w4.ui.on("Red_fc_g1") and w4.ui.text("Red_fc_g1").startswith(plain(odd["n"])), f"a card's alias finds it (al) {w4.ui.values.get('Red_fc_title')!r}")

    # ---- every card's details at each size ----
    w5 = World(script, save, zones)
    w5.seat("Red")
    w5.g.onLoad("")
    w5.wait.flush()
    w5.respond(details_raw, pages_text)
    ui5, red5, bad, cut, laid_n = w5.ui, w5.players["Red"], [], 0, 0
    def at(kind, i, rows):
        return next((f"Red_d1_{kind}{r}_{i}" for r in range(1, rows + 1) if ui5.on(f"Red_d1_{kind}{r}_{i}")), None)
    for d in cards:
        c = details["cards"][face_path(d)]
        rules, named = chapters_of(c, details), named_of(c, details)
        o = Obj.of(w5, d)
        o.is_face_down = False
        w5.run(w5.g.showDetails, "Red", o, what=f"Card details: {c['n']}")
        if not (ui5.on("Red_d1") and ui5.values.get("Red_d1_title") == plain(c["n"])):
            bad.append((c["n"], "no panel"))
            continue
        for size in (1, 2, 3):
            for b in ["smaller"] * 3 + ["bigger"] * (size - 1):
                w5.call("detailsSize", red5, None, f"Red_d1_{b}")
            shown = [ui5.text(b) for b in (at("r", i, 3) for i in range(1, 6)) if b]
            if shown != [f"Rules: {details['chapters'][r]['title']}" for r in rules]:
                bad.append((c["n"], size, shown))
            for kind, n, rows in (("rules", 5, 3), ("cards", 6, 2), ("decks", 8, 3)):
                for r in range(1, rows + 1):
                    ws = [int(ui5.attrs[b]["preferredWidth"]) for b in (f"Red_d1_{kind[0]}{r}_{i}" for i in range(r, n + 1)) if ui5.on(b)]
                    if ws and sum(ws) + 6 * (len(ws) - 1) > int(ui5.attrs[f"Red_d1_{kind}{r}"]["width"]):
                        bad.append((c["n"], size, f"{kind}{r}", ws))
            bad += [(c["n"], size, x) for x in status_wrong(ui5, "Red_d1", c, details) + tip_wrong(ui5, "Red_d1")]
            cut += sum(1 for b in ui5.attrs if re.fullmatch(r"Red_d1_[rck]\d_\d", b) and ui5.on(b) and ui5.attrs[b].get("tooltip"))
            bad += [(c["n"], size, x) for x in ability_wrong(ui5, "Red_d1", c, details, (440, 540, 660)[size - 1] - 44)]
            laid_n += bool(ability_lines(ui5, "Red_d1"))
        for i, (name, path) in enumerate(named[:6], 1):
            b = at("c", i, 2)
            w5.spawns.clear()
            if b:
                w5.call("spawnNamed", red5, None, b)
            if not b or spawn_label(ui5, b) != f"+ {name}" or len(w5.spawns) != 1 \
                    or face_path(w5.spawns[0]["data"]) != path:
                bad.append((c["n"], f"+ {name}"))
        w5.call("closeDetails", red5, None, "Red_d1_close")
    check(not bad and cut, f"every card's details at each size ({len(cards)} cards): each chapter a whole Rules button, rows fit, "
          f"each '+ name' spawns its card, the STATUS EFFECTS in the text; a tooltip only on a name cut short ({cut}), as the panel, "
          f"above the buttons; {laid_n} card sizes' abilities line by line, drawn as one text would ({len(bad)} wrong) {bad[:5]}")

    # ---- the website offline ----
    w3 = World(script, save, zones)
    w3.seat("Red")
    w3.run(w3.g.onLoad, "", what="onLoad (offline)")
    w3.respond(None, None)
    w3.run(w3.g.showDetails, "Red", Obj.of(w3, cards[0]), what="Card details offline")
    w3.run(w3.g.openRulebook, "Red", what="rulebook offline")
    check(("Red", "Card details are still loading.") in w3.told and any("not loaded" in x for x in w3.logs)
          and not w3.ui.builds, "website offline: 'still loading', logged, no panels")

    for world in (w, w2, w3, w4, w5):
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
