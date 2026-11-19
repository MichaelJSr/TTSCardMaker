"""Paths and interpreters the TTS save checks share; each can be set from the environment (see README.md)."""
import functools
import glob
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
from urllib.request import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.environ.get("TTS_REPO") or os.path.join(HERE, "..", ".."))     # TTSCardMaker
SAVE = os.path.join(REPO, "TTS", "Impossibility Simulator.json")
HISTORY = os.path.expanduser(os.environ.get("TTS_HISTORY", "/tmp/tts-checks/history.git"))    # full history, blobless
BOT = os.path.expanduser(os.environ.get("AUTOCROISSANT", ""))      # the updater's code; unset: AC main (bot_main)
BOT_REPO_URL = "https://github.com/bobberlington/AutoCroissant.git"     # card-sync.yml's BOT_REPO (BUILDER_REF main)
LUA_PYTHONS = (os.environ.get("LUA_PYTHON", ""), "~/.venvs/tts-checks/bin/python")
CARD_REPO_URL = "https://github.com/MichaelJSr/TTSCardMaker.git"
SITE_URL = "https://michaeljsr.github.io/TTSCardMaker"
# the card repo files the updater reads (a missing Global.lua or pages.json leaves that part of the save alone)
UPDATER_INPUTS = ("TTS/decks.json", "site/Card Edits.json", "TTS/Global.lua", "TTS/Rulebook/pages.json")


def save_arg(i: int = 1) -> str:
    """argv[i], else the repo's save."""
    return os.path.abspath(sys.argv[i]) if len(sys.argv) > i and not sys.argv[i].startswith("-") else SAVE


@functools.cache
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


def _own(save: str, repo: str, main: str):
    """The commit save is the save of: the checkout's HEAD if repo's main has it, else its merge-base with
    TTS_REF or origin/main (a work branch); None for an edited save."""
    env = {**os.environ, "GIT_NO_LAZY_FETCH": "1"}

    def git(r, *args):
        return subprocess.run(["git", "-C", r, *args], capture_output=True, text=True, env=env)
    try:
        data = open(save, "rb").read()
    except OSError:
        return None
    blob = hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()
    rel = os.path.relpath(SAVE, REPO)
    for c in (git(REPO, "rev-parse", "HEAD").stdout.strip(),
              git(REPO, "merge-base", "HEAD", os.environ.get("TTS_REF", "origin/main")).stdout.strip()):
        if c and git(repo, "merge-base", "--is-ancestor", c, main).returncode == 0:
            return c if git(repo, "rev-parse", f"{c}:{rel}").stdout.strip() == blob else None
    return None


@functools.cache
def judged_commit(save: str = SAVE) -> str:
    """The commit links_pins and updater_idempotent judge save at: _own's on the history clone's main, else (an
    edited save) that main."""
    clone = ensure_history()
    return _own(save, clone, "main") or subprocess.run(["git", "-C", clone, "rev-parse", "main"], capture_output=True,
                                                       text=True).stdout.strip()


@functools.cache
def ref() -> str:
    """REF: $TTS_REF, else _own's on the checkout's origin/main (no history clone needed), else origin/main. drift,
    the contents checks and verify_rules_snapshot read the tree, decks.json and Global.lua there: an older
    checkout is judged at its own commit."""
    return os.environ.get("TTS_REF") or _own(save_arg(), REPO, "origin/main") or "origin/main"


def __getattr__(name):          # `from checks_env import REF`: worked out then, for that check's save
    if name == "REF":
        return ref()
    raise AttributeError(name)


def history_at(dest: str, commit: str) -> str:
    """A bare repo sharing the history clone's objects whose main is commit: its origin is itself, so the updater's
    fetch leaves main there; blobs it lacks still come lazily from GitHub."""
    clone = ensure_history()
    subprocess.run(["git", "init", "-q", "--bare", dest], check=True)
    with open(os.path.join(dest, "objects", "info", "alternates"), "w") as f:
        f.write(os.path.join(os.path.abspath(clone), "objects") + "\n")
    for k, v in (("core.repositoryformatversion", "1"), ("remote.origin.url", os.path.abspath(dest)),
                 ("remote.gh.url", CARD_REPO_URL), ("remote.gh.promisor", "true"),
                 ("remote.gh.partialclonefilter", "blob:none"), ("extensions.partialclone", "gh")):
        subprocess.run(["git", "-C", dest, "config", k, v], check=True)
    subprocess.run(["git", "-C", dest, "update-ref", "refs/heads/main", commit], check=True)
    return dest


@functools.cache
def file_at(ref: str, path: str):
    """path's bytes at ref, never by lazy fetch: the checkout's blob, else the history clone's, else fetched into the
    history clone in one call (a blobless checkout lacks old saves). None when ref:path names no file; exits when
    that fetch fails."""
    env = {**os.environ, "GIT_NO_LAZY_FETCH": "1"}

    def git(repo, *args, data=None):
        r = subprocess.run(["git", "-C", repo, *args], input=data, capture_output=True, env=env)
        return r.stdout if r.returncode == 0 else None
    blob = git(REPO, "rev-parse", "--verify", "-q", f"{ref}:{path}")       # trees only: no blob needed
    clone = None
    if blob is None:
        clone = ensure_history()
        blob = git(clone, "rev-parse", "--verify", "-q", f"{ref}:{path}")
    if blob is None:
        return None
    blob = blob.decode().strip()
    data = git(REPO, "cat-file", "blob", blob)
    if data is None:
        clone = clone or ensure_history()
        data = git(clone, "cat-file", "blob", blob)
    if data is None:
        git(clone, "-c", "fetch.negotiationAlgorithm=noop", "fetch", "-q", "--no-tags", "--no-write-fetch-head",
            "--filter=blob:none", "--stdin", "origin", data=blob.encode())
        data = git(clone, "cat-file", "blob", blob)
    if data is None:
        sys.exit(f"could not fetch {ref}:{path} (blob {blob}) into {clone}")
    return data


def site_cards() -> list:
    """The card browser's cards as rows (build_site writes columns): $TTS_CARDS (a cards.json file), else the live
    website. Both are main's: at a REF behind origin/main a png goes back through the Renamed trailers since; a card
    REF lacks (new since) is left out."""
    path = os.environ.get("TTS_CARDS")
    if path:
        with open(path, encoding="utf-8") as f:
            cards = json.load(f)["cards"]
    else:
        with urlopen(f"{SITE_URL}/data/cards.json", timeout=60) as r:
            cards = json.load(r)["cards"]
    if not isinstance(cards, list):
        cards = [{k: v[i] for k, v in cards["cols"].items() if v[i] is not None} for i in range(cards["n"])]
    env = {**os.environ, "GIT_NO_LAZY_FETCH": "1"}

    def git(*args):
        return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, env=env).stdout
    if git("rev-list", "--count", f"{ref()}..origin/main").strip() in ("", "0"):
        return cards
    back = []                                                   # (new, old), newest first
    for v in git("log", f"{ref()}..origin/main", "--grep=^Renamed: ",
                 "--format=%x1f%(trailers:key=Renamed,valueonly,separator=%x1f)").split("\x1f"):
        old, sep, new = v.strip().partition(" -> ")
        if sep and old and new:
            back.append((new, old))
    files = set(git("ls-tree", "-r", "-z", "--name-only", ref()).split("\0"))
    out = []
    for c in cards:
        p = c.get("png")
        for new, old in back:
            p = old if p == new else p
        if not p or p in files:
            out.append(c if p == c.get("png") else {**c, "png": p})
    return out


def bot_main() -> str:
    """A bare depth-1 clone of AutoCroissant main (the updater Card sync runs) beside TTS_HISTORY: made, or fetched.
    Exits when that fails: an older updater would be tested."""
    clone = os.path.join(os.path.dirname(HISTORY), "autocroissant.git")
    for _ in range(2):                                      # twice: another run may hold its lock
        if os.path.exists(clone):
            cmd = ["git", "-C", clone, "fetch", "-q", "--depth", "1", "--no-tags", "origin",
                   "+refs/heads/main:refs/heads/main"]
        else:
            os.makedirs(os.path.dirname(clone), exist_ok=True)
            cmd = ["git", "clone", "-q", "--bare", "--depth", "1", "--branch", "main", BOT_REPO_URL, clone]
        if subprocess.run(cmd).returncode == 0:
            return clone
        time.sleep(3)
    sys.exit(f"could not fetch AutoCroissant main into {clone} (or set AUTOCROISSANT to a checkout)")


def copy_bot(dest: str) -> str:
    """The updater's code copied to dest: global_config.py and every commands/*.py (whatever tts_save imports) of
    $AUTOCROISSANT, else of AutoCroissant main. Returns where from."""
    os.makedirs(os.path.join(dest, "commands"), exist_ok=True)
    if not BOT:
        clone = bot_main()
        git = functools.partial(subprocess.run, capture_output=True, check=True)
        sha = git(["git", "-C", clone, "rev-parse", "main"], text=True).stdout.strip()
        tar = git(["git", "-C", clone, "archive", sha, "global_config.py", "commands/*.py"]).stdout
        with tarfile.open(fileobj=io.BytesIO(tar)) as t:
            t.extractall(dest, filter="data")
        return f"AutoCroissant main {sha[:8]}"
    if not os.path.exists(os.path.join(BOT, "commands", "tts_save.py")):
        sys.exit(f"no updater at {BOT} (AUTOCROISSANT)")
    shutil.copy(os.path.join(BOT, "global_config.py"), dest)
    for path in glob.glob(os.path.join(BOT, "commands", "*.py")):
        shutil.copy(path, os.path.join(dest, "commands"))
    return BOT


def runner_env() -> dict:
    """os.environ as Card sync's TTS save start has it: lazy fetch on (the add_new_since save, one blob per commit)."""
    return {k: v for k, v in os.environ.items() if k != "GIT_NO_LAZY_FETCH"}


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
    sys.exit("needs lupa: pip install lupa (README.md), or set LUA_PYTHON")


def need_lupa() -> None:
    """Re-run this script under a Python with lupa when this one lacks it."""
    py = lua_python()
    if py != sys.executable:
        os.execv(py, [py, os.path.abspath(sys.argv[0]), *[os.path.abspath(a) if os.path.exists(a) else a
                                                           for a in sys.argv[1:]]])
