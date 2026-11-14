"""The PSDs' sizes for build_site.py (PSD_TREE, the PSD size sort) in a trees API reply's shape: site.yml runs
`python -S site/build/psd_sizes.py <commit> <out.json>` in the background (stdlib only: uv installs meanwhile). The
blobless clone has no blob sizes, so they are kept by blob in site/.cache/psd/sizes.json (a blob's size never changes;
saved with the card images, outside site.yml's check of the cache's top-level JSON) and only new blobs' folders are
read, one trees call each (not recursive); past MANY folders (the first run), one recursive call for the whole tree.
Exit 0: every PSD's size; 1: some left out (the rest written); 2: no git tree."""
import json
import os
import posixpath
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

CACHE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".cache", "psd", "sizes.json")
MANY = 40           # more new folders: one recursive call
WORKERS = 8


def trees(path):
    """A trees API call's entries; 3 tries 1 s apart (the recursive one can hit GitHub's 10 s limit); None."""
    url = f"repos/{os.environ.get('GITHUB_REPOSITORY', 'MichaelJSr/TTSCardMaker')}/git/trees/{path}"
    for wait in (0, 1, 1):
        time.sleep(wait)
        try:
            r = subprocess.run(["gh", "api", url], capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                data = json.loads(r.stdout)
                return data["tree"], bool(data.get("truncated"))
            print(f"{path}: {r.stderr.strip()[:200]}", flush=True)
        except (subprocess.TimeoutExpired, ValueError, KeyError, TypeError) as e:
            print(f"{path}: {type(e).__name__}", flush=True)
    return None


def listing(commit):
    """({PSD path: blob sha}, {folder: tree sha}) at a commit, from git (the clone has every tree)."""
    out = subprocess.run(["git", "ls-tree", "-r", "-t", "-z", commit], capture_output=True, check=True).stdout
    psds, folders = {}, {"": commit}
    for rec in out.decode("utf-8", "surrogateescape").split("\0"):
        if "\t" not in rec:
            continue
        meta, path = rec.split("\t", 1)
        _, kind, sha = meta.split()
        if kind == "tree":
            folders[path] = sha
        elif kind == "blob" and path.lower().endswith(".psd"):
            psds[path] = sha
    return psds, folders


def main(commit, out):
    start = time.time()
    try:
        psds, folders = listing(commit)
    except (OSError, subprocess.CalledProcessError) as e:
        print(f"PSD sizes: no tree at {commit[:8]}: {e}", flush=True)
        return 2
    try:
        with open(CACHE, encoding="utf-8") as fh:
            known = {k: v for k, v in json.load(fh).items() if isinstance(v, int)}
    except (OSError, ValueError, AttributeError):
        known = {}
    new = sorted({posixpath.dirname(p) for p, sha in psds.items() if sha not in known})
    calls = [f"{commit}?recursive=1"] if len(new) > MANY else [folders[d] for d in new]
    truncated = False
    with ThreadPoolExecutor(WORKERS) as pool:
        for got in pool.map(trees, calls):
            if got:
                truncated |= got[1]
                known.update({i["sha"]: i["size"] for i in got[0]
                              if i.get("type") == "blob" and isinstance(i.get("size"), int)})
    tree = [{"path": p, "type": "blob", "sha": sha, "size": known[sha]}
            for p, sha in sorted(psds.items()) if sha in known]
    known = {sha: known[sha] for sha in sorted(set(psds.values())) if sha in known}    # this commit's only
    for path, data in ((CACHE, known), (out, {"sha": commit, "tree": tree, "truncated": truncated})):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path + ".tmp", "w", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"))
        os.replace(path + ".tmp", path)
    missing = len(psds) - len(tree)
    print(f"PSD sizes at {commit[:8]}: {len(psds)} PSDs, new in {len(new)} folders, {len(calls)} trees calls"
          f"{' (recursive)' if len(new) > MANY else ''}, {time.time() - start:.1f} s", flush=True)
    if missing:
        print(f"PSD sizes: {missing} of {len(psds)} not read", flush=True)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:3]))
