"""Every repo link in the save must serve main's current file: pinned sha's blob == main's blob (git's own view,
independent of the updater's history walk). A failed pin's line names git log's last change of the file.
The global script's links are live data on main (TTS/Global.lua), not pinned.
Usage: pins_current.py [save.json]   (history: $TTS_HISTORY, made or fetched)"""
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import ensure_history, save_arg  # noqa: E402

CLONE = ensure_history()
RAW = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/"
LINK = re.compile(re.escape(RAW) + r"([^/\s\"\\]+)/([^\s\"\\<>]+)")


def git(*a):
    return subprocess.run(["git", "-C", CLONE, *a], capture_output=True, text=True, check=True).stdout


def tree(commit, paths):
    out = subprocess.run(["git", "-C", CLONE, "ls-tree", "-r", "-z", commit, "--", *paths], capture_output=True,
                         text=True).stdout
    found = {}
    for e in out.split("\0"):
        meta, _, p = e.partition("\t")
        parts = meta.split()
        if len(parts) == 3 and parts[1] == "blob":
            found[p] = parts[2]
    return found


with open(save_arg(), encoding="utf-8") as f:
    data = json.load(f)
data["LuaScript"] = ""                                       # the global script: live data on main
text = json.dumps(data, ensure_ascii=False)
links = {}
for m in LINK.finditer(text):
    links[(m.group(1), unquote(m.group(2)))] = links.get((m.group(1), unquote(m.group(2))), 0) + 1
main = tree("main", sorted({p for _, p in links}))
fail, unpinned, gone = [], [], []
by_sha = {}
for sha, p in links:
    by_sha.setdefault(sha, []).append(p)
for sha, paths in sorted(by_sha.items()):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        unpinned += [(sha, p) for p in paths]
        continue
    at = tree(sha, sorted(paths))
    for p in paths:
        if p not in main:
            gone.append((sha, p))
        elif at.get(p) != main[p]:
            last = git("rev-list", "-1", "main", "--", p).strip()
            fail.append(f"{p}: pinned {sha[:8]} serves blob {str(at.get(p))[:8]}, main has {main[p][:8]} "
                        f"(git log's last change {last[:8]})")
print(f"{len(links)} distinct links ({sum(links.values())} total), {len(by_sha)} shas")
for x in unpinned:
    print("UNPINNED:", x)
for x in gone:
    print("GONE:", x)
for x in fail:
    print("FAIL:", x)
bad = fail + [f"unpinned {x}" for x in unpinned] + [f"gone {x}" for x in gone]
print("OK" if not bad else f"{len(bad)} failure(s)")
sys.exit(1 if bad else 0)
