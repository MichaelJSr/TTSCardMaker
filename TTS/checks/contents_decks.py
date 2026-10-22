"""Decks vs TTS/decks.json rules, applied as tts_save._sync_decks does.

    python contents_decks.py [save.json]    (rules: decks.json beside the save, else TTS_REF's; repo: TTS_REF, default origin/main)
Complete decks: exactly the rule's repo cards, each at odd_counts or count; copies identical.
Hand-picked decks: inside the rule, counts as recorded; with add_new_since, every rule card the save at that commit
lacked (renames by blob) is in. A rule without a count: its deck untouched (none since 2026-10-22).
"""
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from contents_lib import CARD_NAMES, Result, face, load_rules, load_save, rule_cards, show, tree, walk  # noqa: E402

KIND_DIRS = {"creatures": ("Creatures/",), "items": ("Items/",), "fields": ("Field/",), "nme": ("N.M.E/",),
             "minions": ("Auxiliary/Minions/", "Auxiliary/Creatures/"), "auxiliary_items": ("Auxiliary/Items/",),
             "status_effects": ("Auxiliary/Status Effects/",), "morgue": ("MDW/The Morgue/",)}

r = Result("contents_decks")
save, path = load_save()
rules = load_rules(path)
files = tree()
pngs = sorted(p for p in files if p.lower().endswith(".png"))
by_blob = {}
for p_, b_ in files.items():
    by_blob.setdefault(b_, []).append(p_)


def carried(sha):
    """Today's paths of the cards the save had at sha (a gone path follows its blob when one path has it now)."""
    old = show("TTS/Impossibility Simulator.json", sha)
    if old is None:
        return None
    had = {face(c) for c, _ in walk(json.loads(old).get("ObjectStates")) if c.get("Name") in CARD_NAMES} - {None}
    then = tree(sha)
    for p_ in [x for x in had if x not in files]:
        moved = by_blob.get(then.get(p_), [])
        if len(moved) == 1:
            had.add(moved[0])
    return had


decks = {}
for o, parents in walk(save.get("ObjectStates")):
    if o.get("Name") == "Deck":
        if o.get("GUID") in decks:
            r.fail(f"deck GUID {o.get('GUID')} twice")
        decks[o.get("GUID")] = o
rd = rules.get("decks") or {}
for g in sorted(set(decks) - set(rd)):
    r.fail(f"deck {g} {decks[g].get('Nickname')!r} has no rule")
for g in sorted(set(rd) - set(decks)):
    r.fail(f"rule {g} has no deck in the save")

for g, e in rd.items():
    if g not in decks:
        continue
    rule, deck = e.get("rule") or {}, decks[g]
    cards = deck.get("ContainedObjects") or []
    faces = Counter(face(c) for c in cards)
    label = f"{g} {deck.get('Nickname') or '(unnamed)'}"
    # rule sanity: folders fit kind and stars
    for glob_ in rule.get("folders", []):
        if not glob_.startswith(KIND_DIRS.get(rule.get("kind"), ("?",))):
            r.fail(f"{label}: folder {glob_} not under kind {rule.get('kind')}")
        stars = rule.get("stars") or []
        if stars and not any(f"{s} Stars/" in glob_ for s in stars):
            r.fail(f"{label}: folder {glob_} not for stars {stars}")
    for p in rule.get("include", []) + rule.get("exclude", []) + list((e.get("odd_counts") or {})):
        if p not in files:
            r.fail(f"{label}: rule names {p}, not in the repo")
    if e.get("back") and e["back"] not in files:
        r.fail(f"{label}: back {e['back']} not in the repo")
    # integrity the updater relies on
    if (deck.get("DeckIDs") or []) != [c.get("CardID") for c in cards]:
        r.fail(f"{label}: DeckIDs differ from its cards' CardIDs")
    keys = {str(c.get("CardID", 0) // 100) for c in cards}
    if keys - set(deck.get("CustomDeck") or {}):
        r.fail(f"{label}: CustomDeck lacks {sorted(keys - set(deck.get('CustomDeck') or {}))}")
    if set(deck.get("CustomDeck") or {}) - keys:
        r.note(f"{label}: unused CustomDeck keys {sorted(set(deck.get('CustomDeck') or {}) - keys)}")
    want = rule_cards(rule, pngs)
    count = int(rule.get("count") or 0)
    odd = {p: int(n) for p, n in (e.get("odd_counts") or {}).items()}
    if rule.get("partial"):
        out = [p for p in faces if p not in want]
        if out:
            r.fail(f"{label} (hand-picked): outside its rule: {out}")
        wrong = [(p, n, odd.get(p, count)) for p, n in faces.items() if n != odd.get(p, count)]
        if wrong:
            r.fail(f"{label} (hand-picked): copies (path, have, recorded) {wrong}")
        since = rule.get("add_new_since")
        if since:
            had = carried(since)
            if had is None:
                r.fail(f"{label}: add_new_since {since} has no save")
            else:
                new = [p for p in want if p not in had]
                lacking = [p for p in new if p not in faces]
                if lacking:
                    r.fail(f"{label}: new since {since[:8]} but not in it: {lacking}")
                else:
                    r.note(f"{label}: {len(new)} rule cards new since {since[:8]}, all in it")
        listed = set(e.get("card_list") or [])
        if listed and listed != set(faces):
            r.note(f"{label}: decks.json card_list stale: not in deck {sorted(listed - set(faces))}, "
                   f"unlisted {sorted(set(faces) - listed)}")
        r.note(f"{label} (hand-picked): {len(cards)} cards, {len(faces)} distinct, "
               f"{len([p for p in want if p not in faces])} rule cards not in it")
        continue
    if not count:
        if cards:
            r.fail(f"{label}: rule has no count (empty deck) but holds {len(cards)} cards")
        continue
    if not cards:
        r.fail(f"{label}: complete rule but the deck is empty")
        continue
    if not want:
        r.fail(f"{label}: rule matches no repo image")
    for p in want:
        n = faces.get(p, 0)
        if n != odd.get(p, count):
            r.fail(f"{label}: {p} x{n}, rule wants x{odd.get(p, count)}")
    for p, n in faces.items():
        if p not in want:
            why = "gone from the repo (report only)" if p and p not in files else "outside the rule"
            (r.note if p and p not in files else r.fail)(f"{label}: {p} x{n} {why}")
    for c in e.get("copies") or []:
        if c in decks and Counter(face(x) for x in decks[c].get("ContainedObjects") or []) != faces:
            r.fail(f"{label}: differs from its copy {c}")
r.done()
