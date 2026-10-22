"""Shared helpers for the contents_* TTS save checks (mirror commands/tts_save.py)."""
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import REF, REPO as TC, save_arg, site_cards  # noqa: E402

RAW = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/"
LINK = re.compile(re.escape(RAW) + r"(refs/heads/main|main|[0-9a-f]{7,40})/([^\s\"\\<>]+)")
CARD_NAMES = ("Card", "CardCustom")
HAND_NAMED = ("Auxiliary/Rulebook/", "Auxiliary/Markers/")
LARGE = "Auxiliary/Creatures/"


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
    try:
        return git("show", f"{ref}:{path}").decode("utf-8")
    except subprocess.CalledProcessError:
        return None


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


def stem(path):
    return os.path.splitext(os.path.basename(path))[0].replace("_", " ")


def edit_key(name):
    return re.sub(r"\s+", " ", name.replace("_", " ")).strip().lower()


def glob(pattern):
    out = ""
    for tok in re.split(r"(\*\*|\*|\?)", pattern):
        out += {"**": ".*", "*": "[^/]*", "?": "[^/]"}.get(tok, re.escape(tok))
    return re.compile(out + r"\Z")


def rule_cards(rule, pngs):
    globs = [glob(g) for g in rule.get("folders", [])]
    inc, exc = set(rule.get("include", [])), set(rule.get("exclude", []))
    return [p for p in pngs if p in inc or (p not in exc and any(g.match(p) for g in globs))]


class Names:
    """Card Edits.json name > cards.json name > PSD stem > PNG stem (as _Names)."""

    def __init__(self, files, save_path):
        cards = site_cards()
        self.site = {c["png"]: c["name"] for c in cards if c.get("png") and c.get("name")}
        self.cards = cards
        side = os.path.join(os.path.dirname(os.path.abspath(save_path)), "..", "site", "Card Edits.json")
        text = open(side, encoding="utf-8").read() if os.path.exists(side) else show("site/Card Edits.json")
        self.edits = {edit_key(k): v for k, v in (json.loads(text or "{}").get("cards") or {}).items()
                      if isinstance(v, dict)}
        self.lower = {p.lower(): p for p in files}

    def _stem(self, path):
        psd = self.lower.get(os.path.splitext(path)[0].lower() + ".psd")
        return stem(psd or path)

    def known(self, path):
        e = self.edits.get(edit_key(self._stem(path)))
        if e and isinstance(e.get("name"), str) and e["name"].strip():
            return e["name"]
        return self.site.get(path)

    def of(self, path):
        return self.known(path) or self._stem(path)


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
