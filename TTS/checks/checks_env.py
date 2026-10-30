"""Paths and interpreters the TTS save checks share; each can be set from the environment (see README.md)."""
import glob
import json
import os
import shutil
import subprocess
import sys
from urllib.request import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.environ.get("TTS_REPO") or os.path.join(HERE, "..", ".."))     # TTSCardMaker
REF = os.environ.get("TTS_REF", "origin/main")
SAVE = os.path.join(REPO, "TTS", "Impossibility Simulator.json")
HISTORY = os.path.expanduser(os.environ.get("TTS_HISTORY", "/tmp/tts-checks/history.git"))    # full history, blobless
BOT = os.path.expanduser(os.environ.get("AUTOCROISSANT", "~/Desktop/AutoCroissant"))         # the updater's code
LUA_PYTHONS = (os.environ.get("LUA_PYTHON", ""), "~/.venvs/tts-checks/bin/python")
CARD_REPO_URL = "https://github.com/MichaelJSr/TTSCardMaker.git"
SITE_URL = "https://michaeljsr.github.io/TTSCardMaker"
# the card repo files the updater reads (a missing Global.lua, Global.xml or pages.json leaves that part of the save alone)
UPDATER_INPUTS = ("TTS/decks.json", "site/Card Edits.json", "TTS/Global.lua", "TTS/Global.xml", "TTS/Rulebook/pages.json")


def save_arg(i: int = 1) -> str:
    """argv[i], else the repo's save."""
    return os.path.abspath(sys.argv[i]) if len(sys.argv) > i and not sys.argv[i].startswith("-") else SAVE


def ensure_history(clone: str = HISTORY) -> str:
    """A bare blobless clone with main's full history: made, or fetched. The checkout may be shallow."""
    if not os.path.exists(clone):
        os.makedirs(os.path.dirname(clone), exist_ok=True)
        subprocess.run(["git", "clone", "-q", "--bare", "--filter=blob:none", CARD_REPO_URL, clone], check=True)
    elif os.environ.get("TTS_HISTORY_FETCHED") != clone:                  # run_all fetched it once for every check
        subprocess.run(["git", "-C", clone, "fetch", "-q", "origin", "+refs/heads/main:refs/heads/main"], check=False)
    shallow = subprocess.run(["git", "-C", clone, "rev-parse", "--is-shallow-repository"], capture_output=True, text=True)
    if shallow.stdout.strip() == "true":
        sys.exit(f"{clone} is shallow: history checks need a full clone (TTS_HISTORY)")
    return clone


def site_cards() -> list:
    """The card browser's cards: $TTS_CARDS (a cards.json file), else the live website (as the updater)."""
    path = os.environ.get("TTS_CARDS")
    if path:
        with open(path, encoding="utf-8") as f:
            return json.load(f)["cards"]
    with urlopen(f"{SITE_URL}/data/cards.json", timeout=60) as r:
        return json.load(r)["cards"]


def use_bot() -> None:
    """The updater importable (commands.tts_save needs only requests)."""
    if not os.path.exists(os.path.join(BOT, "commands", "tts_save.py")):
        sys.exit(f"no updater at {BOT} (set AUTOCROISSANT)")
    sys.path.insert(0, BOT)


def copy_bot(dest: str) -> None:
    """The updater's code copied to dest: global_config.py and every commands/*.py (whatever tts_save imports)."""
    if not os.path.exists(os.path.join(BOT, "commands", "tts_save.py")):
        sys.exit(f"no updater at {BOT} (set AUTOCROISSANT)")
    os.makedirs(os.path.join(dest, "commands"), exist_ok=True)
    shutil.copy(os.path.join(BOT, "global_config.py"), dest)
    for path in glob.glob(os.path.join(BOT, "commands", "*.py")):
        shutil.copy(path, os.path.join(dest, "commands"))


def lua_python() -> str:
    """A Python with lupa: this one, else $LUA_PYTHON or a known venv."""
    try:
        import lupa.lua52  # noqa: F401
        return sys.executable
    except ImportError:
        pass
    for py in LUA_PYTHONS:
        py = os.path.expanduser(py)
        if py and os.path.exists(py):
            return py
    sys.exit("needs lupa: pip install lupa luaparser (README.md), or set LUA_PYTHON")


def need_lupa() -> None:
    """Re-run this script under a Python with lupa when this one lacks it."""
    py = lua_python()
    if py != sys.executable:
        os.execv(py, [py, os.path.abspath(sys.argv[0]), *[os.path.abspath(a) if os.path.exists(a) else a
                                                           for a in sys.argv[1:]]])
