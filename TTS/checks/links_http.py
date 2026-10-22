"""Every URL in the save loads: HTTP status, content type, image decodes (PIL), bytes match the pinned blob.

    python links_http.py [save.json] [checkout] [history clone]     (defaults: this repo, $TTS_HISTORY)
Repo links: ranged GET of the first 64 KB, compared with the blob at the pin (size from Content-Range); the blob
itself is decoded with PIL. Other hosts: full GET, decoded or magic-checked. 8 requests at a time. Exit 1 on a defect.
"""
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from os.path import expanduser, splitext
from urllib.parse import unquote

import requests
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import HISTORY, REPO, ensure_history, save_arg  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
RAW = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/"
LINK = re.compile(re.escape(RAW) + r"([0-9a-f]{40})/([^\s\"\\<>]+)")
ANY_URL = re.compile(r"https?://[^\s\"\\<>]+")
PREFIX = 65536
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
FORMATS = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG"}
REQUIRED = ("FaceURL", "BackURL", "ImageURL", "MeshURL", "DiffuseURL", "AssetbundleURL", "PDFUrl")
DOC_ONLY = ("https://api.tabletopsimulator.com/",)      # links in comments: status only


def strings(v, where=""):
    if isinstance(v, dict):
        for k, x in v.items():
            yield from strings(x, f"{where}/{k}")
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from strings(x, f"{where}[{i}]")
    elif isinstance(v, str):
        yield where, v
        if v[:1] in "{[":
            try:
                yield from strings(json.loads(v), where)
            except ValueError:
                pass


def git(repo, *args, text=True):
    out = subprocess.run(["git", "-C", repo, *args], capture_output=True, check=True).stdout
    return out.decode() if text else out


def blob_bytes(checkout, clone, sha, path):
    meta = git(clone, "ls-tree", sha, "--", path).split()
    blob = meta[2]
    for repo in (checkout, clone):
        try:
            return blob, git(repo, "cat-file", "blob", blob, text=False)
        except subprocess.CalledProcessError:
            continue
    raise RuntimeError(f"blob {blob} unreadable")


def decode(data):
    im = Image.open(BytesIO(data))
    fmt, size, mode = im.format, im.size, im.mode
    im.load()
    return fmt, size, mode


def check_repo(url, sha, enc, checkout, clone, session):
    path = unquote(enc)
    out = {"url": url, "fail": [], "note": []}
    blob, data = blob_bytes(checkout, clone, sha, path)
    r = session.get(url, headers={"Range": f"bytes=0-{PREFIX - 1}"}, timeout=60, stream=True)
    body = r.raw.read(PREFIX + 1, decode_content=True)
    r.close()
    out["status"], out["type"] = r.status_code, r.headers.get("Content-Type", "")
    if r.status_code not in (200, 206):
        out["fail"].append(f"HTTP {r.status_code}")
        return out
    total = int(r.headers["Content-Range"].rsplit("/", 1)[1]) if "Content-Range" in r.headers else \
        int(r.headers.get("Content-Length", -1))
    if total != len(data):
        out["fail"].append(f"served size {total} != blob size {len(data)}")
    if body[:PREFIX] != data[:PREFIX]:
        out["fail"].append("served bytes differ from the pinned blob")
    ext = splitext(path)[1].lower()
    if ext in FORMATS:
        if not out["type"].startswith("image/"):
            out["fail"].append(f"content type {out['type']}")
        try:
            fmt, size, mode = decode(data)
            out["image"] = (fmt, size, mode)
            if fmt != FORMATS[ext]:
                out["note"].append(f"{ext} file is {fmt}")
        except Exception as e:
            out["fail"].append(f"PIL can't decode: {e}")
    else:
        out["note"].append(f"non-image repo file ({out['type']})")
    out["size"] = len(data)
    return out


def check_other(url, session):
    out = {"url": url, "fail": [], "note": []}
    if url.startswith("http://"):
        out["note"].append("plain http")
    r = session.get(url, timeout=60)
    out["status"], out["type"], out["size"] = r.status_code, r.headers.get("Content-Type", ""), len(r.content)
    if r.status_code != 200:
        out["fail"].append(f"HTTP {r.status_code}")
        return out
    if url.startswith(DOC_ONLY):
        return out
    data = r.content
    if data[:7] == b"UnityFS":
        out["image"] = ("assetbundle", *[x.decode(errors="replace") for x in data[12:60].split(b"\0")[:2]])
    elif re.search(rb"^\s*v\s+-?[\d.]", data[:4096], re.M) and re.search(rb"^\s*f\s+\d", data, re.M):
        out["image"] = ("obj mesh", data.count(b"\nv "), data.count(b"\nf "))
    else:
        try:
            out["image"] = decode(data)
        except Exception as e:
            out["fail"].append(f"neither image, assetbundle nor OBJ ({out['type']}): {e}")
    return out


def main():
    save = save_arg()
    checkout = expanduser(sys.argv[2] if len(sys.argv) > 2 else REPO)
    clone = ensure_history(expanduser(sys.argv[3] if len(sys.argv) > 3 else HISTORY))
    data = json.load(open(save, encoding="utf-8"))
    urls = {}
    for where, s in strings(data):
        for m in ANY_URL.finditer(s):
            urls.setdefault(m.group(0), set()).add(where)
    empty = []                                          # required link fields left blank
    def blanks(v, where=""):
        if isinstance(v, dict):
            for k, x in v.items():
                if k in REQUIRED and not x:
                    empty.append(f"{where}/{k}")
                blanks(x, f"{where}/{k}")
        elif isinstance(v, list):
            for i, x in enumerate(v):
                blanks(x, f"{where}[{i}]")
    blanks(data)
    session = requests.Session()
    session.headers["User-Agent"] = UA                  # imgur answers 429 to python-requests
    session.mount("https://", requests.adapters.HTTPAdapter(pool_maxsize=8, max_retries=2))

    def one(url):
        try:
            m = LINK.fullmatch(url)
            if m:
                return check_repo(url, m.group(1), m.group(2), checkout, clone, session)
            if url.startswith(RAW):
                return {"url": url, "fail": ["repo link not pinned to a full sha"], "note": []}
            return check_other(url, session)
        except Exception as e:
            return {"url": url, "fail": [f"{type(e).__name__}: {e}"], "note": []}

    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(one, sorted(urls)))
    fails = [r for r in results if r["fail"]]
    types = {}
    for r in results:
        types[(r.get("status"), r.get("type"))] = types.get((r.get("status"), r.get("type")), 0) + 1
    print(f"{len(urls)} URLs; status/type: {types}")
    for r in results:
        if not r["url"].startswith(RAW):
            print("other:", r["url"], r.get("status"), r.get("type"), r.get("size"), r.get("image"), r["note"],
                  sorted(urls[r["url"]])[:2])
    for r in results:
        for n in r["note"]:
            if r["url"].startswith(RAW):
                print("note:", r["url"][len(RAW) + 41:], n)
    big = sorted((r for r in results if r.get("image") and isinstance(r["image"][1], tuple)),
                 key=lambda r: -r["image"][1][0] * r["image"][1][1])[:5]
    for r in big:
        print("largest:", r["url"][len(RAW) + 41:], r["image"], r.get("size"))
    for r in fails:
        print("FAIL:", r["url"], "; ".join(r["fail"]), sorted(urls[r["url"]])[:2])
    for w in empty:
        print("FAIL: empty", w)
    print("OK" if not fails and not empty else f"{len(fails) + len(empty)} failures")
    sys.exit(1 if fails or empty else 0)


if __name__ == "__main__":
    main()
