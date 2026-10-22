"""Updater's resizeTargets regex round-trip on the save's LuaScript (or a given script).

    lua_resize_roundtrip.py [save.json] [script.lua]     (the updater: $AUTOCROISSANT; Lua: lupa, see checks_env)

Removes every Shadow Queen card, adds a large creature PNG with a quoted/backslashed name, runs
commands.tts_save._resize_targets: the table changes as expected, the rest of the script is byte-identical,
a second run changes nothing, and the result still loads in Lua 5.2 with the new key. Exits 1 on a failure.
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import lua_python, save_arg, use_bot  # noqa: E402

use_bot()
import commands.tts_save as t  # noqa: E402

LUA_PY = lua_python()

failures = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        failures.append(what)


class Repo:
    def __init__(self, pngs):
        self.pngs = pngs


class Names:
    def __init__(self, extra):
        self.extra = extra

    def of(self, path):
        return self.extra.get(path) or os.path.splitext(os.path.basename(path))[0].replace("_", " ")


def strip_table(lua):
    m = t.LUA_TABLE.search(lua)
    return (lua[:m.start(2)], lua[m.end(2):]) if m else None


def main():
    save = json.load(open(save_arg(), encoding="utf-8"))
    if len(sys.argv) > 2:
        save["LuaScript"] = open(sys.argv[2], encoding="utf-8").read()
    before = save["LuaScript"]
    m = t.LUA_TABLE.search(before)
    check(bool(m), "resizeTargets table found")
    if not m:
        return
    old = [k for _, k, _ in t.LUA_ROW.findall(m.group(2))]

    # unchanged inputs: no change at all
    pngs = set()
    for card, _ in t._walk(save.get("ObjectStates")):
        p = t._face_path(card) if card.get("Name") in t.CARD_NAMES else None
        if p and p.startswith(t.LARGE_CARDS):
            pngs.add(p)
    s0 = dict(save)
    r0 = t._Report()
    t._resize_targets(s0, Repo(pngs), Names({}), r0)
    check(s0["LuaScript"] == before and not r0.lua_added and not r0.lua_removed and not r0.errors,
          f"no-op run leaves the script byte-identical {r0.errors}")

    # drop Shadow Queen everywhere, add a new large creature
    def drop(objs):
        out = []
        for o in objs or []:
            if o.get("Nickname") == "Shadow Queen" and o.get("Name") in t.CARD_NAMES:
                continue
            if o.get("ContainedObjects"):
                o = dict(o, ContainedObjects=drop(o["ContainedObjects"]))
                ids = [c.get("CardID") for c in o["ContainedObjects"]]
                if "DeckIDs" in o:
                    o["DeckIDs"] = ids
            out.append(o)
        return out
    s1 = dict(save, ObjectStates=drop(save["ObjectStates"]))
    new_path = "Auxiliary/Creatures/Big_Test.png"
    new_name = 'Big "Q" \\ Test'
    pngs1 = (pngs - {"Auxiliary/Creatures/Shadow_Queen.png"}) | {new_path}
    r1 = t._Report()
    t._resize_targets(s1, Repo(pngs1), Names({new_path: new_name}), r1)
    after = s1["LuaScript"]
    check(r1.lua_added == [new_name] and r1.lua_removed == ["Shadow Queen"] and not r1.errors,
          f"report: added {r1.lua_added}, removed {r1.lua_removed}, errors {r1.errors}")
    check(strip_table(after) == strip_table(before), "outside the table byte-identical")
    m1 = t.LUA_TABLE.search(after)
    rows = t.LUA_ROW.findall(m1.group(2))
    keys = [k.replace('\\"', '"').replace("\\\\", "\\") for _, k, _ in rows]
    want = sorted((set(old) - {"Shadow Queen"}) | {new_name}, key=lambda k: (k.lower(), k))
    check(keys == want, f"table keys {keys}")
    lines = m1.group(2).split("\n")
    check(len({ln.index("=") for ln in lines}) == 1 and all(ln.startswith("    [") and ln.endswith(" = true,")
                                                             for ln in lines), "rows aligned, indented, '= true,'")

    # second run: no change
    r2 = t._Report()
    s2 = dict(s1)
    t._resize_targets(s2, Repo(pngs1), Names({new_path: new_name}), r2)
    check(s2["LuaScript"] == after and not r2.lua_added and not r2.lua_removed, "second run is a no-op")

    # restoring the inputs restores the original script exactly
    s3 = dict(s1, ObjectStates=save["ObjectStates"])
    r3 = t._Report()
    t._resize_targets(s3, Repo(pngs), Names({}), r3)
    check(s3["LuaScript"] == before, "restored inputs give back the original bytes")

    # still Lua 5.2 and the new key is live
    probe = after + '\nreturn resizeTargets ~= nil, (function() return nil end)()'
    lua = ("import lupa.lua52 as l,sys;r=l.LuaRuntime();g=r.globals();"
           "g.Wait=r.table();g.Player=r.table();r.execute(sys.stdin.read());"
           "print('ok')")
    p = subprocess.run([LUA_PY, "-I", "-c", lua], input=after, capture_output=True, text=True)
    check(p.returncode == 0 and p.stdout.strip() == "ok", f"edited script loads in Lua 5.2 {p.stderr[-300:]}")
    key_probe = after.replace("local resizeTargets", "resizeTargets", 1) + \
        f'\nassert(resizeTargets[{json.dumps(new_name)}] == true)\nassert(resizeTargets["Shadow Queen"] == nil)'
    p = subprocess.run([LUA_PY, "-I", "-c", lua], input=key_probe, capture_output=True, text=True)
    check(p.returncode == 0, f"new key readable, removed key gone {p.stderr[-300:]}")


try:
    main()
except Exception as e:                                      # a crash is a failure too
    check(False, f"crashed: {type(e).__name__}: {e}")
print(f"{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
