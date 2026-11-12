"""Runs the bot's TTS save updater on a copy of the save as Card sync's TTS save step does (--names: $TTS_DATA_REF's
db/stats.json); it must report no changes and leave the bytes identical. Also: perturbed copies must converge back.
Usage: updater_idempotent.py [save.json]
Inputs (decks.json, Card Edits, Global.lua/.xml, pages.json): a commit's own save, that commit's; else beside the save,
else TTSCardMaker origin/main.
Code: $AUTOCROISSANT's updater modules (copied; its repo_history.json is never touched), run by this Python."""
import atexit
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import REF, UPDATER_INPUTS, copy_bot, file_at, history_at, judged_commit, runner_env, save_arg  # noqa: E402

PY = sys.executable
OK_SECTIONS = ("Nicknames kept (not on the website)", "Decks left alone")   # informational, no change
DATA_REF = os.environ.get("TTS_DATA_REF", "origin/data")                    # Card sync's names: its db/stats.json

save = save_arg()
work = tempfile.mkdtemp(prefix="ttsupd_")
atexit.register(shutil.rmtree, work, ignore_errors=True)     # a failed run leaves nothing
JUDGED = judged_commit(save)
CLONE = history_at(os.path.join(work, "history.git"), JUDGED)     # main = the commit under test
SAVED = file_at(JUDGED, "TTS/Impossibility Simulator.json") == open(save, "rb").read()    # that commit's own save
failures = []


def setup():
    local = os.path.join(work, "local")
    repo = os.path.dirname(os.path.dirname(save))          # the save's checkout: its files beside it, else REF's
    for path in UPDATER_INPUTS:
        os.makedirs(os.path.dirname(os.path.join(local, path)), exist_ok=True)
        mine = os.path.join(repo, path)
        if SAVED:                                           # its commit's inputs: a fixed point there
            data = file_at(JUDGED, path)
        else:
            data = open(mine, "rb").read() if os.path.exists(mine) else file_at(REF, path)
        if data is None:
            continue
        open(os.path.join(local, path), "wb").write(data)
    bot = os.path.join(work, "bot")
    copy_bot(bot)
    stats, data = os.path.join(work, "stats.json"), file_at(DATA_REF, "db/stats.json")
    if data is None:
        sys.exit(f"no db/stats.json at {DATA_REF} (git fetch origin +data:refs/remotes/origin/data)")
    open(stats, "wb").write(data)
    return local, bot, stats


LOCAL, BOT, STATS = setup()
ENV = {**runner_env(), "AUTOCROISSANT_LOCAL_DIR": LOCAL, "AUTOCROISSANT_HISTORY_CLONE": CLONE}


def run(path):
    """The updater's report text for path, the names from STATS (Card sync's --names)."""
    code = "import sys, runpy; sys.argv = ['tts_save', sys.argv[1], '--names', sys.argv[2]]; " \
        "runpy.run_module('commands.tts_save', run_name='__main__')"
    r = subprocess.run([PY, "-c", code, path, STATS], cwd=BOT, env=ENV, capture_output=True, text=True, timeout=600)
    if r.returncode:
        failures.append(f"updater exited {r.returncode}: {r.stderr[-2000:]}")
    return r.stdout


def sections(report):
    return re.findall(r"^## (.*?)(?: \((\d+)\))?$", report, re.M)


def copy(name, data):
    path = os.path.join(work, name)
    open(path, "wb").write(data)
    return path


orig = open(save, "rb").read()

# 1. As the Action: no changes, same bytes
p = copy("as_action.json", orig)
rep = run(p)
print(rep)
if "**No changes.**" not in rep:
    failures.append("updater reported changes on the save")
if open(p, "rb").read() != orig:
    failures.append("updater rewrote the save")
for title, _ in sections(rep):
    if title not in OK_SECTIONS:
        failures.append(f"report section: {title}")

# 2. Perturbed: unpinned links, a wrong Nickname, a missing resizeTargets row must all come back exactly
s = json.loads(orig.decode("utf-8"))
text = orig.decode("utf-8")
raw = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/"
pins = re.findall(re.escape(raw) + r"([0-9a-f]{40})/", text)
pert = text
for sha in sorted(set(pins))[:5]:
    pert = pert.replace(raw + sha + "/", raw + "main/")
lua = json.loads(pert)["LuaScript"]
rows = re.findall(r'^\s*\[".*?"\]\s*=.*$\n?', lua, re.M)
if rows:
    pert_obj = json.loads(pert)
    pert_obj["LuaScript"] = lua.replace(rows[0], "", 1)
    pert = json.dumps(pert_obj)        # not TTS formatting: the updater must restore that too
p = copy("perturbed.json", pert.encode("utf-8"))
rep3 = run(p)
if open(p, "rb").read() != orig:
    failures.append("perturbed save (unpinned links, Lua row, compact JSON) did not converge back to the original")
    print(rep3)
print("perturbed run:", [t for t in sections(rep3) if t[0] not in OK_SECTIONS])

# 3. One card taken out of a complete deck: re-added once, then a second run reports no changes
rules = json.load(open(os.path.join(LOCAL, "TTS", "decks.json")))["decks"]


def decks(objs):
    for o in objs or []:
        if o.get("Name") == "Deck":
            yield o
        yield from decks(o.get("ContainedObjects"))
        for st in (o.get("States") or {}).values():
            yield from decks([st])


s = json.loads(orig.decode("utf-8"))
target = next((d for d in decks(s["ObjectStates"]) if (rules.get(d.get("GUID")) or {}).get("rule")
               and not rules[d["GUID"]]["rule"].get("partial") and d.get("ContainedObjects")
               and not (rules[d["GUID"]].get("odd_counts")) and rules[d["GUID"]]["rule"].get("count") == 1), None)
if target:
    target["ContainedObjects"].pop(0)
    target["DeckIDs"].pop(0)
    p = copy("missing_card.json", json.dumps(s).encode("utf-8"))
    rep4 = run(p)
    if "## Cards added (1)" not in rep4:
        failures.append(f"removed card in {target['GUID']} not re-added once")
    print("missing-card run:", target["GUID"], [t for t in sections(rep4) if t[0] not in OK_SECTIONS])
    rep5 = run(p)
    if "**No changes.**" not in rep5:
        failures.append("second run after re-adding a card still changed the save (flaps)")
        print(rep5)
else:
    print("note: no complete count-1 deck to test re-adding")

for f in failures:
    print("FAIL:", f)
print("OK" if not failures else f"{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
