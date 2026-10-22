"""Card backs: one back per deck (the rule's back, on the cards and the deck's CustomDeck), and by card type.

    python contents_backs.py [save.json]
creature/minion/creatures -> MDW/cardback.png; item/field/nme/aux item -> MDW/cardback_item.png;
buff/debuff -> MDW/cardback_statuseffect.png; rulebook pages -> their own face; markers -> their minus_ image.
"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from contents_lib import CARD_NAMES, Result, back, face, link, load_rules, load_save, site_cards, walk  # noqa: E402

BY_TYPE = {"creature": "MDW/cardback.png", "minion": "MDW/cardback.png", "creatures": "MDW/cardback.png",
           "item": "MDW/cardback_item.png", "field": "MDW/cardback_item.png", "nme": "MDW/cardback_item.png",
           "aux item": "MDW/cardback_item.png", "buff": "MDW/cardback_statuseffect.png",
           "debuff": "MDW/cardback_statuseffect.png"}

r = Result("contents_backs")
save, path = load_save()
rules = load_rules(path).get("decks") or {}
kind = {c["png"]: c.get("type") for c in site_cards() if c.get("png")}
bad = Counter()
for o, parents in walk(save.get("ObjectStates")):
    if o.get("Name") == "Deck":
        want = (rules.get(o.get("GUID")) or {}).get("back")
        backs = Counter(back(c) for c in o.get("ContainedObjects") or [])
        backs.update((link(v.get("BackURL")) or (None, v.get("BackURL")))[1] for v in (o.get("CustomDeck") or {}).values())
        if backs and set(backs) != {want}:
            r.fail(f"deck {o.get('GUID')} {o.get('Nickname')!r}: backs {dict(backs)}, rule {want}")
    if o.get("Name") not in CARD_NAMES:
        continue
    p, b = face(o), back(o)
    if p in kind:
        exp = BY_TYPE.get(kind[p])
    elif p and p.startswith("Auxiliary/Rulebook/"):
        exp = p
    elif p and p.startswith("Auxiliary/Markers/"):
        exp = os.path.dirname(p) + "/minus_" + os.path.basename(p)
    else:
        exp = "MDW/cardback.png" if p and p.startswith("MDW/The Morgue/") else None
    if exp is None:
        r.note(f"{p}: no expected back (type {kind.get(p)}), has {b}")
    elif b != exp:
        bad[(p, b, exp)] += 1
for (p, b, exp), n in sorted(bad.items()):
    r.fail(f"{p}: back {b} x{n}, expected {exp}")
r.done()
