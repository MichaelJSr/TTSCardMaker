"""Lua resizeTargets keys = the Nicknames of Auxiliary/Creatures cards in the save (+ repo ones not in it), as
tts_save._resize_targets builds them; values true; the onObjectLeaveContainer lookup still uses obj.getName().

    python contents_resize.py [save.json]
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from contents_lib import CARD_NAMES, LARGE, Names, Result, face, load_save, tree, walk  # noqa: E402

r = Result("contents_resize")
save, path = load_save()
files = tree()
names = Names(files, path)
lua = save.get("LuaScript") or ""
m = re.search(r"resizeTargets\s*=\s*\{\n(.*?)\n\}", lua, re.S)
if not m:
    r.fail("no resizeTargets table in LuaScript")
    r.done()
rows = [ln for ln in m.group(1).split("\n") if ln.strip()]
keys = {}
for ln in rows:
    mm = re.fullmatch(r'\s*\["((?:[^"\\]|\\.)*)"\]\s*=\s*(\S+?),?\s*', ln)
    if not mm:
        r.fail(f"resizeTargets row not understood: {ln!r}")
        continue
    k = mm.group(1).replace('\\"', '"').replace("\\\\", "\\")
    if k in keys:
        r.fail(f"resizeTargets key twice: {k!r}")
    keys[k] = mm.group(2)
nicks, paths = set(), set()
for card, _ in walk(save.get("ObjectStates")):
    p = face(card) if card.get("Name") in CARD_NAMES else None
    if p and p.startswith(LARGE):
        nicks.add(card.get("Nickname") or "")
        paths.add(p)
want = nicks | {names.of(p) for p in files if p.startswith(LARGE) and p.endswith(".png") and p not in paths}
for k in sorted(want - set(keys)):
    r.fail(f"large card not in resizeTargets: {k!r}")
for k in sorted(set(keys) - want):
    r.fail(f"resizeTargets key matches no large card: {k!r}")
for k, v in keys.items():
    if v != "true":
        r.note(f"resizeTargets[{k!r}] = {v}")
others = {c.get("Nickname") for c, _ in walk(save.get("ObjectStates"))
          if c.get("Name") in CARD_NAMES and c.get("Nickname") in keys and not (face(c) or "").startswith(LARGE)}
if others:
    r.fail(f"non-large cards share a resizeTargets name: {sorted(others)}")
if "resizeTargets[obj.getName()]" not in lua:
    r.note("resizeTargets lookup is not resizeTargets[obj.getName()]")
r.note(f"{len(keys)} keys: {sorted(keys)}")
r.done()
