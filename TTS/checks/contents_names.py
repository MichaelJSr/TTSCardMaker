"""Card Nicknames = the website's names (Card Edits.json > cards.json), as tts_save._fix_cards sets them.

    python contents_names.py [save.json]    (TTS_CARDS: a cards.json, default the live website)
Rulebook pages are 'Page N: Title' with N from the file; markers keep their names; cards the website lacks are notes.
"""
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from contents_lib import CARD_NAMES, HAND_NAMED, Names, Result, face, load_save, tree, walk  # noqa: E402

r = Result("contents_names")
save, path = load_save()
files = tree()
names = Names(files, path)
wrong, unnamed, same = Counter(), Counter(), defaultdict(set)
for card, _ in walk(save.get("ObjectStates")):
    if card.get("Name") not in CARD_NAMES:
        continue
    p, nick = face(card), card.get("Nickname") or ""
    if not p:
        r.fail(f"{card.get('GUID')} {nick!r}: face is not a repo link")
        continue
    same[nick].add(p)
    if p.startswith("Auxiliary/Rulebook/"):
        m = re.match(r"(\d+)_", os.path.basename(p))
        if not m or not re.fullmatch(rf"Page {int(m.group(1))}: \S.*", nick):
            r.fail(f"{p}: rulebook Nickname {nick!r}")
        continue
    if p.startswith(HAND_NAMED):
        continue
    known = names.known(p)
    if known is None:
        unnamed[(p, nick)] += 1
    elif known != nick:
        wrong[(p, nick, known)] += 1
    if (card.get("Description") or "").strip() and re.fullmatch(r"(\s*(turbo-)?(damage|crippler|cripler|support|stacker|jack|"
                                                               r"summoner|berserker|consumer|tank|devourer|glass))+\s*",
                                                               card["Description"], re.I):
        r.fail(f"{p}: role tag left in Description {card['Description']!r}")
for (p, old, new), n in sorted(wrong.items()):
    r.fail(f"{p}: Nickname {old!r} x{n}, website {new!r}")
for (p, old), n in sorted(unnamed.items()):
    r.note(f"not on the website, kept: {p} {old!r} x{n}")
for nick, ps in sorted(same.items()):
    if len(ps) > 1:
        r.note(f"one Nickname, {len(ps)} images: {nick!r} {sorted(ps)}")
r.done()
