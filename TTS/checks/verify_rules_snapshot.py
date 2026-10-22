"""decks.json vs the save (C1-C3): card_list, cards, large_cards.current_keys, and no rule matching a non-card PNG.
Usage: verify_rules_snapshot.py [save.json] [decks.json]. Absent snapshot fields are skipped (removing them passes)."""
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import REF, REPO as TC, save_arg, site_cards  # noqa: E402

LINK = re.compile(r"https://raw\.githubusercontent\.com/MichaelJSr/TTSCardMaker/[^/]+/(.+)")


def walk(objs):
    for o in objs or []:
        yield o
        yield from walk(o.get("ContainedObjects"))
        for st in (o.get("States") or {}).values():
            yield from walk([st])


def face(c):
    cd = c.get("CustomDeck") or {}
    e = cd.get(str(c.get("CardID", 0) // 100)) or (next(iter(cd.values())) if cd else {})
    m = LINK.fullmatch((e or {}).get("FaceURL") or "")
    return unquote(m.group(1)) if m else None


def glob(p):
    out = ""
    for tok in re.split(r"(\*\*|\*|\?)", p):
        out += {"**": ".*", "*": "[^/]*", "?": "[^/]"}.get(tok, re.escape(tok))
    return re.compile(out + r"\Z")


def rule_cards(rule, pngs):
    gs = [glob(g) for g in rule.get("folders", [])]
    inc, exc = set(rule.get("include", [])), set(rule.get("exclude", []))
    return [p for p in pngs if p in inc or (p not in exc and any(g.match(p) for g in gs))]


def main():
    save_path = save_arg()
    here = os.path.dirname(os.path.abspath(save_path))
    rules_path = sys.argv[2] if len(sys.argv) > 2 else next(
        (p for p in (os.path.join(here, "decks.json"), os.path.join(here, "TTS/decks.json")) if os.path.exists(p)), None)
    save, rules = json.load(open(save_path, encoding="utf-8")), json.load(open(rules_path, encoding="utf-8"))
    files = subprocess.run(["git", "-C", TC, "ls-tree", "-r", "--name-only", REF], capture_output=True, text=True, check=True).stdout.split("\n")
    fileset = set(files)
    pngs = sorted(p for p in files if p.lower().endswith(".png"))
    site = {c.get("png") for c in site_cards()}
    decks = {o.get("GUID"): o for o in walk(save.get("ObjectStates")) if o.get("Name") == "Deck"}
    fails = []
    for g, e in rules.get("decks", {}).items():
        d = decks.get(g)
        if d is None:
            fails.append(f"{g}: rule for a deck not in the save")
            continue
        cards = d.get("ContainedObjects") or []
        if "card_list" in e:
            have, listed = {face(c) for c in cards}, set(e["card_list"])
            if have != listed:
                fails.append(f"{g} card_list: only listed {sorted(listed - have)}, only in deck {sorted(have - listed)}")
        if "cards" in e and e["cards"] != len(cards):
            fails.append(f"{g} cards: {e['cards']} in rules, {len(cards)} in save")
        r = e.get("rule")
        if r:
            for p in rule_cards(r, pngs):
                if p not in site and (p[:-4] + ".psd") not in fileset and not p.startswith(("Auxiliary/Rulebook/", "Auxiliary/Markers/")):
                    fails.append(f"{g} rule matches {p}: not a card (no PSD, not on the website)")
    lc = rules.get("large_cards") or {}
    if "current_keys" in lc:
        m = re.search(r"resizeTargets\s*=\s*\{\n(.*?)\n\}", save.get("LuaScript") or "", re.S)
        keys = re.findall(r'\[\s*"((?:[^"\\]|\\.)*)"\s*\]', m.group(1)) if m else []
        if sorted(keys) != sorted(lc["current_keys"]):
            fails.append(f"large_cards.current_keys {lc['current_keys']} != Lua {keys}")
    for f in fails:
        print("FAIL", f)
    print(f"{len(fails)} failure(s)")
    sys.exit(1 if fails else 0)


main()
