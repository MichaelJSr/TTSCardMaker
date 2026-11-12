"""Shared helpers for the contents_* TTS save checks (mirror commands/tts_save.py)."""
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import REF, REPO as TC, file_at, save_arg, site_cards  # noqa: E402,F401 (site_cards re-exported)

RAW = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/"
LINK = re.compile(re.escape(RAW) + r"(refs/heads/main|main|[0-9a-f]{7,40})/([^\s\"\\<>]+)")
CARD_NAMES = ("Card", "CardCustom")


def git(*args) -> bytes:
    return subprocess.run(["git", "-C", TC, *args], check=True, capture_output=True).stdout


def tree(ref=REF) -> dict:
    out = git("ls-tree", "-r", "-z", ref).decode("utf-8")
    files = {}
    for e in out.split("\0"):
        meta, _, path = e.partition("\t")
        p = meta.split(" ")
        if len(p) == 3 and p[1] == "blob":
            files[path] = p[2]
    return files


def show(path, ref=REF):
    data = file_at(ref, path)
    return None if data is None else data.decode("utf-8")


def load_save(path=None):
    path = path or save_arg()
    with open(path, encoding="utf-8") as f:
        return json.load(f), path


def load_rules(save_path):
    """decks.json beside the save, else the repo's."""
    side = os.path.join(os.path.dirname(os.path.abspath(save_path)), "decks.json")
    if os.path.exists(side):
        with open(side, encoding="utf-8") as f:
            return json.load(f)
    return json.loads(show("TTS/decks.json"))


def walk(objs, parents=()):
    for o in objs or []:
        yield o, parents
        yield from walk(o.get("ContainedObjects"), parents + (o,))
        for st in (o.get("States") or {}).values():
            yield from walk([st], parents + (o,))


def entry(card):
    cd = card.get("CustomDeck") or {}
    if not cd:
        return None
    return cd.get(str(card.get("CardID", 0) // 100)) or next(iter(cd.values()))


def link(url):
    """(ref, repo path) of a repo link, or None."""
    m = LINK.fullmatch(url or "")
    return (m.group(1), unquote(m.group(2))) if m else None


def face(card):
    lk = link((entry(card) or {}).get("FaceURL"))
    return lk[1] if lk else None


def back(card):
    lk = link((entry(card) or {}).get("BackURL"))
    return lk[1] if lk else None


def glob(pattern):
    out = ""
    for tok in re.split(r"(\*\*|\*|\?)", pattern):
        out += {"**": ".*", "*": "[^/]*", "?": "[^/]"}.get(tok, re.escape(tok))
    return re.compile(out + r"\Z")


def rule_cards(rule, pngs):
    globs = [glob(g) for g in rule.get("folders", [])]
    inc, exc = set(rule.get("include", [])), set(rule.get("exclude", []))
    return [p for p in pngs if p in inc or (p not in exc and any(g.match(p) for g in globs))]


class Result:
    def __init__(self, name):
        self.name, self.fails, self.notes = name, [], []

    def fail(self, msg):
        self.fails.append(msg)

    def note(self, msg):
        self.notes.append(msg)

    def done(self):
        for n in self.notes:
            print(f"NOTE {n}")
        for f in self.fails:
            print(f"FAIL {f}")
        print(f"{self.name}: {'FAIL' if self.fails else 'OK'} ({len(self.fails)} failures, {len(self.notes)} notes)")
        sys.exit(1 if self.fails else 0)
