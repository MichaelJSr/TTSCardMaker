"""Updater report titles, commit subject and deck CustomDeck pruning, on perturbed copies of the save.
Fails when: links reset to main are reported under 'Links re-pinned (changed files)' (UPD-3), the commit subject
beside the report is missing or not one 'TTS save: ...' line (UPD-2), or a card re-added to a complete deck leaves
its old CustomDeck key orphaned in the deck (UPD-4).
Usage: updater_report_decks.py [save.json]    (code: $AUTOCROISSANT, run by this Python)"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import BOT as AC, REF, REPO as TC, ensure_history, save_arg  # noqa: E402

PY = sys.executable
SRC_CLONE = ensure_history()
MODULES = ["commands/tts_save.py", "commands/repo_history.py", "commands/card_models.py", "commands/card_edits.py",
           "commands/github_api.py", "commands/git_commit.py", "global_config.py"]
RAW = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/"

save = save_arg()
work = tempfile.mkdtemp(prefix="ttsrd_")
failures = []
clone = os.path.join(work, "history.git")
shutil.copytree(SRC_CLONE, clone)
local = os.path.join(work, "local")
for sub, path in (("TTS", "TTS/decks.json"), ("site", "site/Card Edits.json")):
    os.makedirs(os.path.join(local, sub), exist_ok=True)
    data = subprocess.run(["git", "-C", TC, "show", f"{REF}:{path}"], capture_output=True, check=True).stdout
    open(os.path.join(local, path), "wb").write(data)
bot = os.path.join(work, "bot")
for m in MODULES:
    os.makedirs(os.path.dirname(os.path.join(bot, m)), exist_ok=True)
    shutil.copy(os.path.join(AC, m), os.path.join(bot, m))
env = {**os.environ, "AUTOCROISSANT_LOCAL_DIR": local, "AUTOCROISSANT_HISTORY_CLONE": clone}


def run(path):
    r = subprocess.run([PY, "-m", "commands.tts_save", path], cwd=bot, env=env, capture_output=True, text=True,
                       timeout=600)
    if r.returncode:
        failures.append(f"updater exited {r.returncode}: {r.stderr[-1500:]}")
    return r.stdout


def decks(objs):
    for o in objs or []:
        if o.get("Name") == "Deck":
            yield o
        yield from decks(o.get("ContainedObjects"))
        for st in (o.get("States") or {}).values():
            yield from decks([st])


# baseline: converge on current main
base = os.path.join(work, "base.json")
shutil.copy(save, base)
run(base)
text = open(base, encoding="utf-8").read()

# UPD-3: reset a few files' pins to main, keep the rest pinned
shas = sorted(set(re.findall(re.escape(RAW) + r"([0-9a-f]{40})/", text)))[:3]
pert = text
for sha in shas:
    pert = pert.replace(RAW + sha + "/", RAW + "main/")
p = os.path.join(work, "unpinned.json")
open(p, "w", encoding="utf-8").write(pert)
rep = run(p)
heads = re.findall(r"^## (.*)$", rep, re.M)
print("UPD-3 sections:", heads)
if any(h.startswith("Links re-pinned (changed files)") for h in heads):
    failures.append("UPD-3: links reset to main reported as 'Links re-pinned (changed files)'")
subject = os.path.join(work, "unpinned.message.txt")
lines = open(subject, encoding="utf-8").read().splitlines() if os.path.exists(subject) else []
print("UPD-2 subject:", lines)
if len(lines) != 1 or not re.fullmatch(r"TTS save: \d+ links? pinned", lines[0]):
    failures.append(f"UPD-2: commit subject {lines}, want one 'TTS save: N links pinned' line")

# UPD-4: take one card out of complete deck c8333f (or the first complete count-1 deck), re-run
rules = json.load(open(os.path.join(local, "TTS", "decks.json")))["decks"]
s = json.loads(text)
target = next((d for d in decks(s["ObjectStates"]) if d.get("GUID") == "c8333f"), None) or next(
    (d for d in decks(s["ObjectStates"]) if (rules.get(d.get("GUID")) or {}).get("rule", {}).get("count") == 1
     and not rules[d["GUID"]]["rule"].get("partial") and d.get("ContainedObjects")), None)
card = target["ContainedObjects"].pop(0)
target["DeckIDs"].pop(0)
old_key = str(card["CardID"] // 100)
p = os.path.join(work, "missing.json")
open(p, "w", encoding="utf-8").write(json.dumps(s))
rep = run(p)
after = next(d for d in decks(json.load(open(p, encoding="utf-8"))["ObjectStates"]) if d["GUID"] == target["GUID"])
used = {str(c["CardID"] // 100) for c in after["ContainedObjects"]}
orphans = sorted(set(after.get("CustomDeck") or {}) - used)
print("UPD-4 deck", target["GUID"], "removed key", old_key, "orphans after re-add:", orphans,
      "| Cards added" in rep or re.findall(r"^## Cards added.*$", rep, re.M))
if orphans:
    failures.append(f"UPD-4: deck {target['GUID']} keeps unused CustomDeck keys {orphans}")

shutil.rmtree(work, ignore_errors=True)
for f in failures:
    print("FAIL:", f)
sys.exit(1 if failures else 0)
