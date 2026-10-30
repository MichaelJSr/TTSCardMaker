"""Repo vs save coverage, the Rulebooks bag, gone images.

    python contents_coverage.py [save.json]
Fails: a website card missing from the save or from every complete rule; a complete-rule card not on the website;
the Rulebooks bag not exactly its rule's pages (one each, back = own face; its rule's old pages, kept, in the bag
rule.old names inside it). Notes: repo PNGs nowhere in the save
(by folder), links to files gone from the repo (D5: report only).
"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from contents_lib import (CARD_NAMES, LINK, Result, back, face, load_rules, load_save, rule_cards,  # noqa: E402
                          site_cards, tree, walk)
from urllib.parse import unquote  # noqa: E402


def strings(v):
    if isinstance(v, dict):
        for x in v.values():
            yield from strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from strings(x)
    elif isinstance(v, str):
        yield v


r = Result("contents_coverage")
save, path = load_save()
rules = load_rules(path)
files = tree()
pngs = sorted(p for p in files if p.lower().endswith(".png"))
web = {c["png"] for c in site_cards() if c.get("png")}
faces = Counter(face(o) for o, _ in walk(save.get("ObjectStates")) if o.get("Name") in CARD_NAMES)
linked = {unquote(m.group(2)) for s in strings(save) for m in LINK.finditer(s)}
complete = set()
for e in (rules.get("decks") or {}).values():
    rule = e.get("rule") or {}
    if not rule.get("partial") and rule.get("count"):
        complete |= set(rule_cards(rule, pngs))
for p in sorted(web - set(faces)):
    r.fail(f"website card not in the save: {p}")
for p in sorted(web - complete):
    r.fail(f"website card in no complete deck rule: {p}")
for p in sorted(complete - web):
    r.fail(f"complete-rule card not on the website: {p}")
for p in sorted(p for p in linked if p not in files):
    r.note(f"linked image gone from the repo (report only): {p}")
nowhere = Counter("/".join(p.split("/")[:2]) for p in pngs if p not in linked)
r.note(f"repo PNGs nowhere in the save: {dict(nowhere)}")

# Rulebooks bag
for guid, bag in (rules.get("bags") or {}).items():
    rule = bag.get("rule")
    objs = [o for o, _ in walk(save.get("ObjectStates")) if o.get("GUID") == guid]
    if len(objs) != 1:
        r.fail(f"bag {guid} {bag.get('name')!r}: {len(objs)} objects")
        continue
    if bag.get("tokens"):                               # Creature Types: name -> image
        have = {}
        for o in objs[0].get("ContainedObjects") or []:
            m = LINK.fullmatch((o.get("CustomImage") or {}).get("ImageURL") or "")
            have[o.get("Nickname")] = unquote(m.group(2)) if m else None
        if have != bag["tokens"]:
            r.fail(f"bag {bag.get('name')!r}: tokens differ: {set(have.items()) ^ set(bag['tokens'].items())}")
    if not rule or rule.get("kind") != "rulebook":
        continue
    inside = objs[0].get("ContainedObjects") or []
    old = rule.get("old") or {}
    if old:                                             # the Photoshop pages, kept in a bag of their own inside it
        nested = [o for o in inside if o.get("Nickname") == old.get("bag")]
        if len(nested) != 1:
            r.fail(f"bag {bag.get('name')!r}: {len(nested)} bags named {old.get('bag')!r} inside")
        else:
            kept = Counter(face(c) for c in nested[0].get("ContainedObjects") or [])
            for p in sorted(set(rule_cards(old, pngs)) - set(kept)):
                r.fail(f"bag {old.get('bag')!r}: page missing {p}")
    held = Counter(face(c) for c in inside if c.get("Name") in CARD_NAMES)
    want = set(rule_cards(rule, pngs))
    for p in sorted(want - set(held)):
        r.fail(f"bag {bag.get('name')!r}: page missing {p}")
    for p, n in held.items():
        if p not in want:
            r.fail(f"bag {bag.get('name')!r}: not its rule's {p}")
        elif n != 1:
            r.fail(f"bag {bag.get('name')!r}: {p} x{n}")
    for c in objs[0].get("ContainedObjects") or []:
        if bag.get("back") == "own face" and back(c) != face(c):
            r.fail(f"bag {bag.get('name')!r}: {face(c)} back {back(c)}")
    elsewhere = [p for o, par in walk(save.get("ObjectStates")) if o.get("Name") in CARD_NAMES
                 and (p := face(o)) in want and objs[0] not in par]
    if elsewhere:
        r.note(f"bag {bag.get('name')!r} pages also outside it: {elsewhere}")
    tex = bag.get("texture")
    if tex and tex not in {unquote(m.group(2)) for s in strings({k: v for k, v in objs[0].items()
                                                                  if k != "ContainedObjects"}) for m in LINK.finditer(s)}:
        r.fail(f"bag {bag.get('name')!r}: texture {tex} not linked")
r.done()
