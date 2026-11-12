"""decks.json vs the save (C1-C3): card_list (an add_new_since deck may hold more), and no rule matching a non-card PNG.
Usage: verify_rules_snapshot.py [save.json] [decks.json]."""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import REF, REPO as TC, save_arg, site_cards  # noqa: E402
from contents_lib import face, rule_cards, show, walk  # noqa: E402


def load_rules(save_path):
    """argv[2], else decks.json beside the save (or in its TTS/), else the repo's."""
    here = os.path.dirname(os.path.abspath(save_path))
    path = sys.argv[2] if len(sys.argv) > 2 else next(
        (p for p in (os.path.join(here, "decks.json"), os.path.join(here, "TTS/decks.json")) if os.path.exists(p)), None)
    if path:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return json.loads(show("TTS/decks.json"))


def main():
    save_path = save_arg()
    save, rules = json.load(open(save_path, encoding="utf-8")), load_rules(save_path)
    files = subprocess.run(["git", "-C", TC, "ls-tree", "-r", "--name-only", REF], capture_output=True, text=True, check=True).stdout.split("\n")
    fileset = set(files)
    pngs = sorted(p for p in files if p.lower().endswith(".png"))
    site = {c.get("png") for c in site_cards()}
    decks = {o.get("GUID"): o for o, _ in walk(save.get("ObjectStates")) if o.get("Name") == "Deck"}
    fails = []
    for g, e in rules.get("decks", {}).items():
        d = decks.get(g)
        if d is None:
            fails.append(f"{g}: rule for a deck not in the save")
            continue
        cards = d.get("ContainedObjects") or []
        if "card_list" in e:
            have, listed = {face(c) for c in cards}, set(e["card_list"])
            if have != listed and ((e.get("rule") or {}).get("add_new_since") and listed <= have):
                print(f"NOTE {g} card_list: new cards since add_new_since, not listed yet {sorted(have - listed)}")
            elif have != listed:
                fails.append(f"{g} card_list: only listed {sorted(listed - have)}, only in deck {sorted(have - listed)}")
        r = e.get("rule")
        if r:
            for p in rule_cards(r, pngs):
                if p not in site and (p[:-4] + ".psd") not in fileset:
                    fails.append(f"{g} rule matches {p}: not a card (no PSD, not on the website)")
    for f in fails:
        print("FAIL", f)
    print(f"{len(fails)} failure(s)")
    sys.exit(1 if fails else 0)


main()
