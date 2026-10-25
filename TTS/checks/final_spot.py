"""End-to-end spot check of N random cards (default 30, seed 2026).
Usage: final_spot.py [save.json] [n] [seed]     (code: $AUTOCROISSANT; history: $TTS_HISTORY; names: the website)
Per card: face URL 200 + decodable PNG matching the repo blob; link pinned to the last commit changing the file
(full history clone, main); Nickname = card browser name; in a deck its rule covers (hand-picked decks: noted); CustomDeck wiring
(own key = CardID // 100, parent deck's CustomDeck entry identical, DeckIDs[i] == CardID). Exits 1 on a failure."""
import hashlib
import io
import json
import os
import random
import subprocess
import sys

import requests
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import REF, REPO as TC, ensure_history, save_arg, site_cards, use_bot  # noqa: E402

use_bot()
import commands.tts_save as ts  # noqa: E402

HIST = ensure_history()                                     # the checkout is shallow
save_path = save_arg()
n = int(sys.argv[2]) if len(sys.argv) > 2 else 30
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 2026
save = json.load(open(save_path, encoding="utf-8"))
side = os.path.join(os.path.dirname(os.path.abspath(save_path)), "decks.json")
rules = json.load(open(side)) if os.path.exists(side) else json.loads(
    subprocess.run(["git", "-C", TC, "show", f"{REF}:TTS/decks.json"], capture_output=True).stdout)
site = {c["png"]: c["name"] for c in site_cards() if c.get("png")}


def git(*a):
    return subprocess.run(["git", "-C", TC, *a], capture_output=True, check=True).stdout


tree = {}
for e in git("ls-tree", "-r", "-z", REF).decode().split("\0"):
    meta, _, p = e.partition("\t")
    if meta.split(" ")[1:2] == ["blob"]:
        tree[p] = meta.split(" ")[2]
pngs = sorted(p for p in tree if p.lower().endswith(".png"))

cards = [(o, par) for o, par in ts._walk(save["ObjectStates"]) if o.get("Name") in ("Card", "CardCustom")
         and ts._face_path(o)]
rng = random.Random(seed)
sample = rng.sample(cards, min(n, len(cards)))
fails, notes = [], []
for card, parents in sample:
    path = ts._face_path(card)
    tag = f"{card.get('GUID')} {card.get('Nickname')!r} ({path})"
    bad = []
    key = str(card["CardID"] // 100)
    entry = card["CustomDeck"].get(key)
    if entry is None:
        bad.append(f"no CustomDeck[{key}]")
        entry = ts._entry(card)
    url = entry["FaceURL"]
    m = ts.LINK.fullmatch(url)
    sha = m.group(1)
    last = subprocess.run(["git", "-C", HIST, "log", "-1", "--format=%H", "main", "--", path],
                          capture_output=True, check=True).stdout.decode().strip()     # full history
    if not last.startswith(sha) and sha != last:
        bad.append(f"pinned {sha[:8]}, last change {last[:8]}")
    r = requests.get(url, timeout=60)
    if r.status_code != 200:
        bad.append(f"HTTP {r.status_code}")
    else:
        try:
            im = Image.open(io.BytesIO(r.content)); im.load()
            if im.format != "PNG":
                bad.append(f"format {im.format}")
        except Exception as e:
            bad.append(f"not decodable: {e}")
        blob = hashlib.sha1(b"blob %d\0" % len(r.content) + r.content).hexdigest()
        if blob != tree.get(path):
            bad.append("bytes differ from origin/main blob")
    back = ts.LINK.fullmatch(entry.get("BackURL") or "")
    if back and requests.head(entry["BackURL"], timeout=30).status_code != 200:
        bad.append("back URL not 200")
    want = site.get(path)
    if want is None:
        notes.append(f"{tag}: not on the website, Nickname kept")
    elif card.get("Nickname") != want:
        bad.append(f"Nickname {card.get('Nickname')!r} != site {want!r}")
    deck = parents[-1] if parents and parents[-1].get("Name") == "Deck" else None
    if deck is None:
        notes.append(f"{tag}: not in a deck (in {parents[-1].get('Name') if parents else 'table'})")
    else:
        i = deck["ContainedObjects"].index(card)
        if deck["DeckIDs"][i] != card["CardID"]:
            bad.append(f"deck {deck['GUID']} DeckIDs[{i}] {deck['DeckIDs'][i]} != CardID {card['CardID']}")
        if deck["CustomDeck"].get(key) != entry:
            bad.append(f"deck {deck['GUID']} CustomDeck[{key}] differs")
        rule = (rules["decks"].get(deck["GUID"]) or {}).get("rule")
        if not rule:
            notes.append(f"{tag}: deck {deck['GUID']} has no rule")
        elif rule.get("partial"):
            notes.append(f"{tag}: deck {deck['GUID']} hand-picked")
        elif path not in ts._rule_cards(rule, pngs):
            bad.append(f"deck {deck['GUID']} rule does not cover it")
    print(("FAIL " if bad else "ok   ") + tag + (": " + "; ".join(bad) if bad else ""))
    fails += [f"{tag}: {b}" for b in bad]
for x in notes:
    print("NOTE", x)
print(f"{len(sample)} cards, {len(fails)} failures, {len(notes)} notes")
sys.exit(1 if fails else 0)
