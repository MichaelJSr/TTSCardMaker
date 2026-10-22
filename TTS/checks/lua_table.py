"""The save updater still finds and regenerates the global script's resizeTargets table.

    lua_table.py [save.json] [script.lua]     (script.lua: put it in the save first; its rows must equal the save's)

Runs commands.tts_save._resize_targets ($AUTOCROISSANT): with no repo PNGs, and with TTSCardMaker origin/main's
tree and names (the website's cards.json, Card Edits.json at origin/main); the table must come back unchanged and
error-free. A dropped row and a stray row must be regenerated; a second run must change nothing; _dump must round-trip.
Exits 1 on a failure.
"""
import json
import os
import subprocess
import sys
from copy import deepcopy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import REF, REPO as CARDS, save_arg, site_cards, use_bot  # noqa: E402

use_bot()
import commands.tts_save as ts  # noqa: E402
from commands.card_edits import CardAuthors  # noqa: E402

failures = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        failures.append(what)


class Repo:
    def __init__(self, tree):
        self.tree = tree
        self.pngs = sorted(p for p in tree if p.lower().endswith(".png"))
        self.by_lower = {p.lower(): p for p in tree}


def names_for(repo):
    names = ts._Names.__new__(ts._Names)
    names.repo, names.source = repo, "local"
    names.site = {c["png"]: c["name"] for c in site_cards() if c.get("png") and c.get("name")}
    try:
        text = subprocess.run(["git", "-C", CARDS, "show", f"{REF}:{ts.EDITS_PATHS[0]}"], check=True,
                              capture_output=True).stdout.decode("utf-8")
        names.edits = {CardAuthors.key(k): v for k, v in (json.loads(text).get("cards") or {}).items()
                       if isinstance(v, dict)}
    except subprocess.CalledProcessError:
        names.edits = {}
    return names


def run(save, repo, names):
    report = ts._Report()
    ts._resize_targets(save, repo, names, report)
    return report


def main():
    with open(save_arg(), encoding="utf-8") as f:
        save = json.load(f)
    m = ts.LUA_TABLE.search(save.get("LuaScript") or "")
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as f:
            script = f.read()
        mine = ts.LUA_TABLE.search(script)
        check(bool(m and mine) and mine.group(2) == m.group(2), "script's rows equal the save's rows")
        save["LuaScript"] = script
    lua = save.get("LuaScript") or ""
    m = ts.LUA_TABLE.search(lua)
    check(bool(m), "updater finds resizeTargets")
    if not m:
        return
    print("     rows: " + ", ".join(k for _, k, _ in ts.LUA_ROW.findall(m.group(2))))

    empty = Repo({})
    real = Repo(ts._ls_tree(CARDS, REF))
    for label, repo, names in [("no repo PNGs", empty, None), (REF, real, names_for(real))]:
        s = deepcopy(save)
        r = run(s, repo, names)
        check(not r.errors and s["LuaScript"] == lua and not r.lua_added and not r.lua_removed,
              f"{label}: table unchanged (errors {r.errors}, added {r.lua_added}, removed {r.lua_removed})")
        again = run(s, repo, names)
        check(s["LuaScript"] == lua and not again.errors, f"{label}: second run changes nothing")

    rows = m.group(2).split("\n")
    dropped = lua[:m.start(2)] + "\n".join(rows[1:]) + lua[m.end(2):]
    stray = lua[:m.start(2)] + m.group(2) + '\n' + rows[0][:len(rows[0]) - len(rows[0].lstrip())] \
        + '["Not A Card"] = true,' + lua[m.end(2):]
    first = ts.LUA_ROW.match(rows[0]).group(2)
    for label, text, added, removed in [("dropped row", dropped, [first], []), ("stray row", stray, [], ["Not A Card"])]:
        s = deepcopy(save)
        s["LuaScript"] = text
        r = run(s, empty, None)
        check(s["LuaScript"] == lua and r.lua_added == added and r.lua_removed == removed and not r.errors,
              f"{label}: regenerated (added {r.lua_added}, removed {r.lua_removed})")

    check(json.loads(ts._dump(save)) == save, "_dump round-trips the save with this script")


try:
    main()
except Exception as e:                                     # a crash is a failure too
    check(False, f"crashed: {type(e).__name__}: {e}")
print(f"{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
