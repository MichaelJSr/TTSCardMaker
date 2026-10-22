"""CustomDeck key collisions. Fails if one key names two images anywhere in the save (merged, TTS shows one face),
or a card's key != CardID // 100.
Usage: customdeck_collisions.py [save.json]"""
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import save_arg  # noqa: E402

save = json.load(open(save_arg(), encoding="utf-8"))
fails, uses = [], collections.defaultdict(set)


def img(v):
    return (v.get("FaceURL"), v.get("BackURL"))


def walk(objs):
    for o in objs or []:
        cd = o.get("CustomDeck") or {}
        for k, v in cd.items():
            uses[k].add(img(v))
        if o.get("Name") in ("Card", "CardCustom") and cd and str(o.get("CardID", 0) // 100) not in cd:
            fails.append(f"{o.get('GUID')}: CardID {o.get('CardID')} not in its CustomDeck {list(cd)}")
        kids = o.get("ContainedObjects") or []
        if o.get("Name") in ("Deck", "DeckCustom"):
            seen = {}
            for c in kids:
                for k, v in (c.get("CustomDeck") or {}).items():
                    if k in seen and seen[k] != img(v):
                        fails.append(f"deck {o.get('GUID')}: key {k} for two images")
                    seen.setdefault(k, img(v))
            for k, v in cd.items():
                if k in seen and seen[k] != img(v):
                    fails.append(f"deck {o.get('GUID')}: own key {k} differs from its card's")
        walk(kids)
        walk(list((o.get("States") or {}).values()))


walk(save.get("ObjectStates"))
cross = sorted((k for k, v in uses.items() if len(v) > 1), key=int)
print(f"keys {len(uses)}, highest {max(map(int, uses))}, cross-object collisions {len(cross)}: {cross}")
for f in fails:
    print("FAIL", f)
if cross:
    print("FAIL cross-object collisions")
sys.exit(1 if fails or cross else 0)
