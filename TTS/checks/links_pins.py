"""Repo link pins: sha known, on main, path there, blob == main's, pin == last commit that changed it; canonical %-encoding.

    python links_pins.py [save.json] [history clone] [ref]   (defaults: $TTS_HISTORY, main)
The clone is made (bare, blobless, full history) or fetched; the checkout is shallow, don't use it.
Exit 1 on any defect.
"""
import json
import os
import re
import subprocess
import sys
from os.path import expanduser
from urllib.parse import quote, unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import HISTORY, ensure_history, save_arg  # noqa: E402

RAW = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/"
LINK = re.compile(re.escape(RAW) + r"([^/\s\"\\<>]+)/([^\s\"\\<>]+)")
ANY_URL = re.compile(r"https?://[^\s\"\\<>]+")
URL_SAFE = "/'!()*-._~"     # the updater's quoting


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, check=True).stdout.decode()


def tree(repo, commit, paths=()):
    out = {}
    for e in git(repo, "ls-tree", "-r", "-z", commit, "--", *paths).split("\0"):
        meta, _, p = e.partition("\t")
        parts = meta.split(" ")
        if len(parts) == 3 and parts[1] == "blob":
            out[p] = parts[2]
    return out


def strings(v, where=""):
    if isinstance(v, dict):
        for k, x in v.items():
            yield from strings(x, f"{where}/{k}")
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from strings(x, f"{where}[{i}]")
    elif isinstance(v, str):
        yield where, v
        if v[:1] in "{[":                       # nested JSON (LuaScriptState)
            try:
                yield from strings(json.loads(v), where + "<json>")
            except ValueError:
                pass


def last_changed(repo, head):
    """Updater rule: path -> newest commit (topo) whose blob differs from every parent's."""
    rows = [l.split() for l in git(repo, "rev-list", "--parents", "--topo-order", "--reverse", head).splitlines()]
    # one diff-tree for all commits, each against its first parent (root: against nothing)
    pairs = "".join(f"{c} {ps[0]}\n" if ps else f"{c}\n" for c, *ps in rows)
    out = subprocess.run(["git", "-C", repo, "diff-tree", "--stdin", "--always", "--root", "-r", "--no-renames", "-z"],
                         input=pairs.encode(), capture_output=True, check=True).stdout.decode().split("\0")
    maps, i = {}, 0
    for c, *ps in rows:
        olds = [maps[p] for p in ps]
        cur = dict(olds[0]) if olds else {}
        i += 1                                  # header: the commit id
        while i < len(out) - 1 and out[i].startswith(":"):
            meta, p = out[i].split(" "), out[i + 1]
            i += 2
            if meta[4] == "D" or meta[1] == "160000":
                cur.pop(p, None)                # gone, or a submodule
                continue
            b = meta[3]
            cur[p] = next(((b, o[p][1]) for o in olds if p in o and o[p][0] == b), (b, c))
        maps[c] = cur
    return {p: c for p, (_, c) in maps[rows[-1][0]].items()}


def main():
    save = save_arg()
    repo = expanduser(sys.argv[2] if len(sys.argv) > 2 else HISTORY)
    ref = sys.argv[3] if len(sys.argv) > 3 else "main"
    if repo == HISTORY:
        ensure_history()
    if git(repo, "rev-parse", "--is-shallow-repository").strip() == "true":
        sys.exit(f"{repo} is shallow: pins can't be checked")
    head = git(repo, "rev-parse", ref).strip()
    data = json.load(open(save, encoding="utf-8"))
    links = {}                                  # (ref, enc) -> [where]
    others = {}
    for where, s in strings(data):
        for m in LINK.finditer(s):
            links.setdefault(m.groups(), []).append(where)
        for m in ANY_URL.finditer(s):
            if not m.group(0).startswith(RAW):
                others.setdefault(m.group(0), []).append(where)
    # nested JSON strings are seen twice (raw + parsed): count once
    for k in links:
        links[k] = sorted({w.split("<json>")[0] for w in links[k]})
    main_tree = tree(repo, head)
    rule = last_changed(repo, head)
    bad, notes = [], []
    shas = {r for r, _ in links}
    known = {}
    for r in shas:
        ok = subprocess.run(["git", "-C", repo, "cat-file", "-e", f"{r}^{{commit}}"], capture_output=True).returncode == 0
        anc = ok and subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", r, head],
                                    capture_output=True).returncode == 0
        known[r] = (ok, anc)
    at = {}
    by_sha = {}
    for r, enc in links:
        by_sha.setdefault(r, set()).add(unquote(enc))
    for r, ps in by_sha.items():
        if known[r][0]:
            found = tree(repo, r, sorted(ps))
            for p in ps:
                at[(r, p)] = found.get(p)
    loglast = {}
    for (r, enc), where in sorted(links.items()):
        p = unquote(enc)
        tag = f"{r[:10]}/{enc} ({len(where)}x, e.g. {where[0]})"
        if not re.fullmatch(r"[0-9a-f]{40}", r):
            bad.append(f"NOT PINNED to a full sha: {tag}")
            continue
        if not known[r][0]:
            bad.append(f"UNKNOWN commit: {tag}")
            continue
        if not known[r][1]:
            bad.append(f"commit not in {ref}'s history: {tag}")
        if quote(p, safe=URL_SAFE) != enc:
            bad.append(f"NON-CANONICAL encoding: {enc} (want {quote(p, safe=URL_SAFE)})")
        if at.get((r, p)) is None:
            bad.append(f"PATH NOT AT pinned sha: {tag}")
            continue
        if p not in main_tree:
            bad.append(f"GONE from {ref}: {tag}")
            continue
        if at[(r, p)] != main_tree[p]:
            bad.append(f"STALE pin (blob differs from {ref}): {tag}")
        if rule.get(p) != r:
            bad.append(f"PIN NOT LATEST: {tag} want {rule.get(p)}")
        if p not in loglast:
            loglast[p] = git(repo, "log", "--format=%H", "-1", head, "--", p).strip()
        if loglast[p] != rule.get(p):
            notes.append(f"git log -1 differs from the updater rule for {p}: log {loglast[p][:10]} rule {rule.get(p, '')[:10]}")
    paths = {unquote(e) for _, e in links}
    print(f"{len(links)} distinct repo links ({sum(len(w) for w in links.values())} fields), {len(paths)} paths, "
          f"{len(shas)} shas; {len(others)} other URLs; head {head[:10]}")
    for n in notes:
        print("note:", n)
    for b in bad:
        print("FAIL:", b)
    print("OK" if not bad else f"{len(bad)} failures")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
