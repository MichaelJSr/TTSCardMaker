#!/usr/bin/env python3
"""Drift of a TTS save against a baseline: anything beyond the updater's own edits fails.

python3 drift.py [save.json] [baseline.json | TTSCardMaker-ref]   (default ref 7ca5e30c, the last hand edit of the save)
Allowed: repo link refs, card Nicknames, card CustomDeck keys and CardIDs, deck DeckIDs/CustomDeck, cards added to or
removed from decks, the resizeTargets rows. Everything else is listed and fails: a card's Description, GMNotes, Memo,
Tags and scripts are the team's (2026-10-22), and the global Lua outside resizeTargets.
"""
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import REF, REPO, save_arg  # noqa: E402

BASELINE = "7ca5e30c"       # re-baseline here after a deliberate hand edit of the save
SAVE = "TTS/Impossibility Simulator.json"
LINK = re.compile(r"(https://raw\.githubusercontent\.com/MichaelJSr/TTSCardMaker/)(?:refs/heads/main|main|[0-9a-f]{7,40})/")
CARDS = ("Card", "CardCustom")
CARD_FREE = {"Nickname", "CardID", "CustomDeck"}
DECK_FREE = {"DeckIDs", "CustomDeck", "ContainedObjects"}
LUA_TABLE = re.compile(r"(resizeTargets\s*=\s*\{\n)(.*?)(\n\})", re.S)

fails, notes = [], []
_tree = []


def tree():
    """Paths on the card repo's origin/main."""
    if not _tree:
        out = subprocess.run(["git", "-C", REPO, "ls-tree", "-r", "-z", "--name-only", REF],
                             check=True, capture_output=True).stdout.decode("utf-8")
        _tree.append(set(out.split("\0")))
    return _tree[0]


def norm(v):
    if isinstance(v, dict):
        return {k: norm(x) for k, x in v.items()}
    if isinstance(v, list):
        return [norm(x) for x in v]
    if isinstance(v, str):
        return LINK.sub(r"\1REF/", v)
    return v


def load_base(arg):
    if arg.endswith(".json"):
        return json.load(open(arg, encoding="utf-8"))
    out = subprocess.run(["git", "-C", REPO, "show", f"{arg}:{SAVE}"], check=True, capture_output=True).stdout
    return json.loads(out.decode("utf-8"))


def face(c):
    cd = c.get("CustomDeck") or {}
    e = cd.get(str(c.get("CardID", 0) // 100)) or next(iter(cd.values()), {})
    return LINK.sub("", e.get("FaceURL") or "")


def compare(a, b, where, stats):
    """a baseline object, b current; same GUID."""
    free = set()
    if a.get("Name") in CARDS:
        free = CARD_FREE
        if a.get("Nickname") != b.get("Nickname"):
            stats["nickname"] += 1
        if face(a) != face(b):
            renamed = unquote(face(a)) not in tree() and unquote(face(b)) in tree()
            (notes if renamed else fails).append(f"{where}: card face {face(a)} -> {face(b)}"
                                                 + (" (rename: old path gone from main)" if renamed else ""))
        ea, eb = (norm(next(iter((x.get("CustomDeck") or {}).values()), {})) for x in (a, b))
        for k in set(ea) | set(eb):
            if k != "FaceURL" and ea.get(k) != eb.get(k):
                fails.append(f"{where}: CustomDeck field {k} {ea.get(k)!r} -> {eb.get(k)!r}")
    elif a.get("Name") == "Deck":
        free = DECK_FREE
    elif "ContainedObjects" in a:
        free = {"ContainedObjects"}
    for k in (set(a) | set(b)) - free:
        if k not in b:
            fails.append(f"{where}: key {k} removed")
        elif k not in a:
            fails.append(f"{where}: key {k} added")
        elif norm(a[k]) != norm(b[k]):
            fails.append(f"{where}: {k} changed: {str(norm(a[k]))[:120]} -> {str(norm(b[k]))[:120]}")
    if "ContainedObjects" in a or "ContainedObjects" in b:
        kids(a.get("ContainedObjects") or [], b.get("ContainedObjects") or [], where, stats, a.get("Name") == "Deck")


def kids(la, lb, where, stats, deck):
    by = defaultdict(list)
    for i, o in enumerate(lb):
        by[o.get("GUID")].append(o)
    used = Counter()
    gone = []
    order_a, order_b = [], []
    for o in la:
        g = o.get("GUID")
        if used[g] < len(by[g]):
            m = by[g][used[g]]
            used[g] += 1
            compare(o, m, f"{where}>{o.get('Name')}:{g}", stats)
            order_a.append(id(m))
        else:
            gone.append(o)
    added = [o for g, lst in by.items() for o in lst[used[g]:]]
    order_b = [id(o) for o in lb if id(o) in set(order_a)]
    if order_a != order_b:
        fails.append(f"{where}: kept objects reordered")
    for o in gone:
        msg = f"{where}: {o.get('Name')} {o.get('GUID')} {o.get('Nickname')!r} removed"
        (notes if deck else fails).append(msg)
        stats["removed"] += 1
    for o in added:
        msg = f"{where}: {o.get('Name')} {o.get('GUID')} {o.get('Nickname')!r} added ({face(o).rsplit('/', 1)[-1]})"
        (notes if deck else fails).append(msg)
        stats["added"] += 1
        if deck and lb.index(o) < len(lb) - len(added):
            fails.append(f"{where}: added card {o.get('GUID')} not at the bottom")


def lua_rest(text):
    return LUA_TABLE.sub(r"\1\3", text or "")


def main(path, base_arg):
    cur = json.load(open(path, encoding="utf-8"))
    base = load_base(base_arg)
    for k in (set(base) | set(cur)) - {"ObjectStates", "LuaScript"}:
        if norm(base.get(k)) != norm(cur.get(k)):
            fails.append(f"top-level {k}: {str(base.get(k))[:100]} -> {str(cur.get(k))[:100]}")
    if list(base) != list(cur):
        fails.append("top-level key order changed")
    if norm(lua_rest(base.get("LuaScript"))) != norm(lua_rest(cur.get("LuaScript"))):
        fails.append("LuaScript changed outside resizeTargets")
    ta = LUA_TABLE.search(base.get("LuaScript") or "")
    tb = LUA_TABLE.search(cur.get("LuaScript") or "")
    if ta and tb and ta.group(2) != tb.group(2):
        notes.append("resizeTargets rows changed")
    stats = Counter()
    kids(base["ObjectStates"], cur["ObjectStates"], "table", stats, False)
    notes.append(f"card Nicknames changed {stats['nickname']}; "
                 f"deck cards added {stats['added']}, removed {stats['removed']}")


if __name__ == "__main__":
    main(save_arg(), sys.argv[2] if len(sys.argv) > 2 else BASELINE)
    for m in notes:
        print("NOTE", m)
    for m in fails:
        print("FAIL", m)
    print(f"drift: {len(fails)} failures")
    sys.exit(1 if fails else 0)
