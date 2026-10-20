"""Build the static card browser into site/dist.

Run by .github/workflows/site.yml on every push to main, every 6 hours (to pick up the bot's latest
/update_stats data), and on demand. Also runs locally: `python site/build/build_site.py`, then serve site/dist.

Where the data comes from:
  * Card text, stats, authors, aliases and history: AutoCroissant's stats.pkl / aliases.pkl / old_stats.pkl
    (the same data the Discord bot answers from), downloaded from its public GitHub repo. PSDs are never parsed here.
  * Images: card PNGs in this repo, turned into three WebP sizes (240 px and 360 px for the grid at 1x/2x, 720 px
    for the card view). They are cached by git blob hash in site/.cache/img, so after the first run only new or
    changed cards are downloaded and resized; images no card uses any more are pruned.
  * Icons: Types/ and Types/Stars/; icon names and aliases from MDW/Fonts/stoogedings-src/stoogedings.json.
  * Deck rules: the rulebook pages; banned cards from MDW/Constructed Ban List.txt.
  * Authors: MDW/Card Authors.txt ([people] git name = shown name, [cards] Card Name = person) wins over the bot's
    author, the same rule AutoCroissant applies on /update_stats.
  * Image versions: one pass over the git history (commit metadata only, no file contents) lists every commit that
    changed each card PNG, following exact renames (folder moves). Needs full history: a shallow clone gets none.
PSDs in the repo that the bot hasn't parsed yet (and card PNGs without a PSD) are still listed, image only.

Output (site/dist): data/cards.json (everything the first screen needs), data/rules.json, data/history.json and
data/versions.json (loaded when the rulebook, a card's text or image history or the changes feed is opened), images,
icons, assets and one share page per card. Asset and data URLs carry a build version (?v=...) so a deploy never mixes old scripts with new data.

The build fails (exit 1, nothing deployed) when the bot's card data can't be downloaded or looks truncated, or when
many images fail; it degrades gracefully (logs and continues) for missing history/aliases or a few bad images.
"""
import hashlib
import html
import io
import json
import os
import pickle
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
import time
from datetime import datetime, timezone
from urllib.parse import quote
from urllib.request import Request, urlopen

from PIL import Image

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(SITE)
DIST = os.path.join(SITE, "dist")
CACHE = os.path.join(SITE, ".cache")
CARD_REPO = os.environ.get("CARD_REPO", "MichaelJSr/TTSCardMaker")
BOT_REPO = os.environ.get("BOT_REPO", "bobberlington/AutoCroissant")
SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")
RAW = f"https://raw.githubusercontent.com/{CARD_REPO}/main/"
BOT_RAW = f"https://raw.githubusercontent.com/{BOT_REPO}/main/"
IMAGE_SIZES = {240: 80, 360: 78, 720: 75}    # width -> WebP quality. 240/360: grid at 1x/2x; 720: card view
IMAGE_WIDTH = 360                            # the size whose dimensions go into cards.json (aspect ratio)
ICON_SIZE = 96
MIN_CARDS = 100                              # fewer cards than this in stats.pkl means a broken download
# the game's names for each card_type (rulebook: creature/item decks, field cards, N.M.E. items, auxiliary decks)
KIND_LABEL = {"creature": "Creature", "item": "Item", "field": "Field card", "minion": "Minion", "nme": "N.M.E. item",
              "aux item": "Auxiliary item", "creatures": "Auxiliary creature", "debuff": "Debuff", "buff": "Buff"}
CARD_FOLDERS = ("Creatures/", "Items/", "Field/", "N.M.E/", "Auxiliary/")
SKIP_PARTS = ("MDW", "Markers")


def log(*args):
    print(*args, flush=True)


def fetch(url, tries=3):
    for attempt in range(tries):
        try:
            with urlopen(Request(url, headers={"User-Agent": "card-browser-build"}), timeout=60) as r:
                return r.read()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))


def norm(text):
    """Lenient name key for showing icons: case, spaces, _ - . ' don't matter. (Looser than the bot's parser on
    purpose: the website only decides which image to show, it never judges whether a card is correct.)"""
    return re.sub(r"[\s_\-.'’]+", "", (text or "").lower())


def alnum(text):
    """Looser key for hand-typed lists (the ban list): letters and digits only."""
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def slugify(name):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-") or "card"


# ---- the bot's pickles (read without AutoCroissant's code) ------------------------------------------
class _Obj:
    def __setstate__(self, state):
        if isinstance(state, tuple):
            state = state[1] if len(state) > 1 and isinstance(state[1], dict) else state[0]
        self.__dict__.update(state or {})


class _Unpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module.startswith("commands"):
            return type(name, (_Obj,), {})
        return super().find_class(module, name)


def load_bot_pickle(name):
    data = fetch(BOT_RAW + name)
    return _Unpickler(io.BytesIO(data)).load()


def stat(card, attr):
    value = getattr(getattr(card, "stats", None), attr, -1)
    return value if isinstance(value, int) and value >= 0 else None


# ---- repo listing ----------------------------------------------------------------------------------
def repo_tree():
    """{path: blob sha} for every file at HEAD (works in a sparse, blobless checkout)."""
    out = subprocess.run(["git", "-C", REPO, "ls-tree", "-r", "-z", "HEAD"], capture_output=True, check=True).stdout
    tree = {}
    for entry in out.decode("utf-8").split("\0"):
        if entry:
            meta, path = entry.split("\t", 1)
            tree[path] = meta.split()[2]
    return tree


def classify(path):
    """Folder-based classification for cards the bot hasn't parsed (mirrors AutoCroissant's CardClassifier)."""
    parts = path.split("/")
    stars = None
    if len(parts) >= 2:
        m = re.match(r"(\d+)\s*Stars?", parts[len(parts) - 2])
        stars = int(m.group(1)) if m else None
    top = parts[0]
    if top == "Field":
        return {"type": "field", "stars": stars}
    if top == "Items":
        return {"type": "item", "subtype": parts[1].lower() if len(parts) > 2 else None, "stars": stars}
    if top == "Creatures":
        return {"type": "creature", "series": parts[1] if len(parts) > 2 else None, "stars": stars}
    if top == "N.M.E":
        return {"type": "nme"}
    if top == "Auxiliary" and len(parts) > 2:
        sub = parts[1]
        if sub == "Minions":
            return {"type": "minion"}
        if sub == "Items":
            return {"type": "aux item"}
        if sub == "Status Effects":
            return {"type": "debuff" if "Debuffs" in parts else "buff", "stars": stars}
        return {"type": sub.lower()}
    return {"type": "unknown"}


# ---- thumbnails and icons ----------------------------------------------------------------------------
def image_bytes(path):
    local = os.path.join(REPO, path)
    if os.path.isfile(local):
        with open(local, "rb") as fh:
            return fh.read()
    return fetch(RAW + quote(path))


def image_names(sha):
    return {w: f"{sha[:16]}-{w}.webp" for w in IMAGE_SIZES}


def make_images(path, sha):
    """Cached WebP images of a card PNG, named by blob hash. Returns (key, width, height) of the IMAGE_WIDTH one."""
    names = image_names(sha)
    cached = {w: os.path.join(CACHE, "img", n) for w, n in names.items()}
    if not all(os.path.exists(f) for f in cached.values()):
        src = Image.open(io.BytesIO(image_bytes(path)))
        src = src.convert("RGBA" if src.mode in ("RGBA", "LA", "P") else "RGB")
        for w, quality in IMAGE_SIZES.items():
            if os.path.exists(cached[w]):
                continue
            im = src.copy()
            im.thumbnail((w, w * 3), Image.LANCZOS)
            im.save(cached[w] + ".tmp", "WEBP", quality=quality, method=4)
            os.replace(cached[w] + ".tmp", cached[w])
    with Image.open(cached[IMAGE_WIDTH]) as im:
        return sha[:16], im.width, im.height


def build_icons(tree):
    """Types/ icons into dist/icons as 96 px WebP; return {normalized spelling: {file, name, kind}}."""
    manifest_path = os.path.join(REPO, "MDW/Fonts/stoogedings-src/stoogedings.json")
    if os.path.exists(manifest_path):
        manifest = json.load(open(manifest_path))
    else:
        log("warning: no stoogedings manifest; icons get no aliases")
        manifest = {"icons": {}}
    os.makedirs(os.path.join(DIST, "icons"), exist_ok=True)
    icons = {}
    for path in sorted(tree):
        folder, _, file = path.rpartition("/")
        if folder not in ("Types", "Types/Stars") or not file.lower().endswith(".png"):
            continue
        stem = os.path.splitext(file)[0]
        name = stem.lower() if folder == "Types" else stem.lower().replace(" ", "_")
        kind = "type" if folder == "Types" else "star"
        out_name = f"{slugify(name)}.webp"
        im = Image.open(io.BytesIO(image_bytes(path))).convert("RGBA")
        box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
        if box:
            im = im.crop(box)
        im.thumbnail((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
        im.save(os.path.join(DIST, "icons", out_name), "WEBP", quality=90, alpha_quality=100, method=4)   # shown at ≤34 px
        entry = {"file": f"icons/{out_name}", "name": name, "kind": kind}
        aliases = manifest["icons"].get(name, {}).get("aliases", [])
        for spelling in [name] + list(aliases):
            icons.setdefault(norm(spelling), entry)
    return icons


# ---- authors ---------------------------------------------------------------------------------------
def card_key(name):
    """Card names match case-insensitively, with _ and spaces alike and whitespace collapsed."""
    return " ".join((name or "").replace("_", " ").lower().split())


def parse_authors():
    """MDW/Card Authors.txt -> (people {lowercase git name: shown name}, cards {card_key: person}). Warns, never fails."""
    path = os.path.join(REPO, "MDW/Card Authors.txt")
    people, cards = {}, {}
    if not os.path.exists(path):
        log("warning: no MDW/Card Authors.txt; authors come from the bot's data only")
        return people, cards
    section = None
    for n, raw in enumerate(open(path, encoding="utf-8", errors="replace"), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip().lower()
            if section not in ("people", "cards"):
                log(f"warning: Card Authors.txt line {n}: unknown section [{section}], its lines are ignored")
            continue
        left, eq, right = line.partition("=")
        left, right = left.strip(), right.strip()
        if not eq or not left or not right or section not in ("people", "cards"):
            log(f"warning: Card Authors.txt line {n} ignored (expected 'left = right' inside [people] or [cards]): {line[:60]}")
            continue
        if section == "people":
            people[left.lower()] = right
        else:
            cards[card_key(left)] = right
    return people, cards


def person(people, name):
    return people.get(name.lower(), name) if name else name


# ---- image versions ----------------------------------------------------------------------------------
def image_versions(paths):
    """{current path: [(commit, path then), ...] newest first, one per content change}, commits as
    (sha, unix time, author, subject). Exact renames (same blob deleted and added in one commit) are followed, so folder
    moves keep their history; a rename that also changes the image starts a new history. None in a shallow clone."""
    shallow = subprocess.run(["git", "-C", REPO, "rev-parse", "--is-shallow-repository"], capture_output=True, text=True).stdout.strip()
    if shallow == "true":
        log("warning: shallow clone, so no image versions (git fetch --unshallow --filter=blob:none to get them)")
        return None
    out = subprocess.run(["git", "-C", REPO, "-c", "core.quotePath=false", "log", "--raw", "--no-renames", "--no-abbrev",
                          "--format=%x01%H%x09%at%x09%an%x09%s", "--", "*.png", "*.PNG"],
                         capture_output=True, text=True, check=True).stdout
    tracked = {p: p for p in paths}               # path at the commit being read -> current path
    versions = {p: [] for p in paths}
    for chunk in out.split("\x01")[1:]:
        head, _, body = chunk.partition("\n")
        sha, ts, author, subject = (head.split("\t", 3) + ["", "", "", ""])[:4]
        commit = (sha, int(ts or 0), author, subject)
        adds, dels, mods = [], {}, []
        for line in body.splitlines():
            if not line.startswith(":"):
                continue
            meta, _, path = line.partition("\t")
            if path.startswith('"'):              # unusual characters: git quotes the path
                path = path[1:-1].encode("latin-1", "backslashreplace").decode("unicode_escape").encode("latin-1").decode("utf-8", "replace")
            _, _, old, new, status = meta.split()[:5]
            if status == "A":
                adds.append((path, new))
            elif status == "D":
                dels.setdefault(old, []).append(path)
            elif status == "M":
                mods.append(path)
        for path in mods:
            if path in tracked:
                versions[tracked[path]].append((commit, path))
        for path, blob in adds:
            if path not in tracked:
                continue
            key = tracked.pop(path)
            renamed_from = dels.get(blob)
            if renamed_from:                      # moved without changing: keep following it under its old name
                tracked[renamed_from.pop(0)] = key
            else:
                versions[key].append((commit, path))
    return versions


# ---- ban list --------------------------------------------------------------------------------------
def parse_banlist(by_norm):
    path = os.path.join(REPO, "MDW/Constructed Ban List.txt")
    if not os.path.exists(path):
        return {"notes": [], "groups": []}
    notes, groups, current = [], [], None
    for raw in open(path, encoding="utf-8", errors="replace").read().splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.endswith(":"):
            current = {"title": line.rstrip(":"), "entries": []}
            groups.append(current)
        elif current is None:
            notes.append(line)
        else:
            name, _, reason = line.partition(" - ")
            card = by_norm.get(alnum(name)) or by_norm.get(alnum(re.sub(r"\(.*?\)", "", name)))
            current["entries"].append({"name": name.strip(), "reason": reason.strip(), "id": card["id"] if card else None})
    return {"notes": notes, "groups": groups}


# ---- main ------------------------------------------------------------------------------------------
def main():
    started = time.time()
    os.makedirs(os.path.join(CACHE, "img"), exist_ok=True)
    if os.path.isdir(os.path.join(CACHE, "thumbs")):          # cache layout before 2026-10-20
        shutil.rmtree(os.path.join(CACHE, "thumbs"))
    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    os.makedirs(os.path.join(DIST, "thumbs"))

    tree = repo_tree()
    log(f"repo files: {len(tree)}")
    try:
        stats = load_bot_pickle("stats.pkl")
    except Exception as e:
        raise SystemExit(f"error: can't load the bot's card data ({BOT_RAW}stats.pkl): {e}. Not building a site without it.")
    if not isinstance(stats, dict) or len(stats) < MIN_CARDS:
        raise SystemExit(f"error: stats.pkl has {len(stats) if isinstance(stats, dict) else 'no'} entries "
                         f"(expected at least {MIN_CARDS}); refusing to deploy a truncated site.")
    try:
        old_stats = load_bot_pickle("old_stats.pkl")
    except Exception as e:
        log("no card history:", e)
        old_stats = {}
    try:
        aliases = load_bot_pickle("aliases.pkl")
    except Exception as e:
        log("no aliases:", e)
        aliases = {}
    log(f"bot data: {len(stats)} entries, {len(old_stats)} with history, {len(aliases)} aliases")

    png_by_name = {}
    for path in tree:
        if path.lower().endswith(".png") and path.startswith(CARD_FOLDERS) and not any(p in SKIP_PARTS for p in path.split("/")):
            png_by_name.setdefault(os.path.basename(path).lower(), path)

    cards, rules, used_slugs = [], [], set()

    def unique_slug(name):
        base = slugify(name)
        slug, n = base, 2
        while slug in used_slugs:
            slug, n = f"{base}-{n}", n + 1
        used_slugs.add(slug)
        return slug

    def png_for(psd_path, name):
        guess = psd_path[: len(psd_path) - 4] + ".png" if psd_path.lower().endswith(".psd") else None
        if guess in tree:
            return guess
        return png_by_name.get(name.replace(" ", "_").lower() + ".png")

    seen_pngs = set()
    for name, c in sorted(stats.items(), key=lambda kv: kv[0].lower()):
        path = getattr(c, "path", "") or ""
        png = png_for(path, name)
        if png:
            seen_pngs.add(png)
        entry = {
            "id": unique_slug(name), "name": name, "type": getattr(c, "card_type", "unknown"),
            "subtype": getattr(c, "subtype", None), "series": getattr(c, "series", None),
            "stars": getattr(c, "stars", None), "types": list(getattr(c, "types", []) or []),
            "hp": stat(c, "hp"), "def": stat(c, "defense"), "atk": stat(c, "attack"), "spd": stat(c, "speed"),
            "ability": getattr(c, "ability", None), "author": getattr(c, "author", None),
            "ts": getattr(c, "timestamp", None) or None, "psd": path, "png": png,
            "problems": list(getattr(c, "problems", []) or []),
        }
        versions = []
        for old in old_stats.get(name, []) or []:
            text = getattr(old, "ability", None)
            if text and text != entry["ability"] and all(v["ability"] != text for v in versions):
                versions.append({"ts": getattr(old, "timestamp", None), "ability": text})
        if versions:
            entry["history"] = sorted(versions, key=lambda v: v["ts"] or 0)
        (rules if entry["type"] == "rulebook" or "/Rulebook/" in path else cards).append(entry)

    # duplicates: more PNGs exported from one card's PSD (A_Snack.psd -> A_Snack2.png "Breakfast", A_Snack3.png
    # "Supper"). Same card, different name and art. Named by the bot's alias for that PNG, else the original's name.
    alias_names = {}
    for alias, target in aliases.items():
        alias_names.setdefault(str(target).lower(), []).append(str(alias).replace("_", " ").strip())
    lower_tree = {path.lower() for path in tree}
    by_psd = {c["psd"].lower(): c for c in cards if c.get("psd")}
    for path in sorted(tree):
        m = re.match(r"(.+?)(\d+)\.png$", path, re.I)
        if not m or path in seen_pngs or not path.startswith(CARD_FOLDERS) or (m.group(1) + m.group(2) + ".psd").lower() in lower_tree:
            continue                          # not numbered, already a card, or it has a PSD of its own
        original = by_psd.get((m.group(1) + ".psd").lower())
        if original is None:
            continue
        names = alias_names.get(os.path.basename(path).lower())
        name = " ".join(w[:1].upper() + w[1:] for w in max(names, key=len).split()) if names else original["name"]
        dup = {k: v for k, v in original.items() if k not in ("history", "dups")}
        dup.update(id=unique_slug(name), name=name, png=path, problems=[], dup=original["id"])
        original.setdefault("dups", []).append(dup["id"])
        cards.append(dup)
        seen_pngs.add(path)
    log(f"duplicates: {sum(1 for c in cards if c.get('dup'))} PNGs share another card's PSD")

    # PSDs the bot hasn't parsed yet, and card PNGs without a PSD: list them, image only
    known = {norm(c["name"]) for c in cards + rules}
    for path in sorted(tree):
        low = path.lower()
        if not path.startswith(CARD_FOLDERS) or any(p in SKIP_PARTS for p in path.split("/")):
            continue
        if not (low.endswith(".psd") or (low.endswith(".png") and path not in seen_pngs)):
            continue
        name = os.path.splitext(os.path.basename(path))[0].replace("_", " ")
        if norm(name) in known or "/Rulebook/" in path:
            continue
        known.add(norm(name))
        png = png_for(path, name) if low.endswith(".psd") else path
        info = classify(path)
        cards.append({"id": unique_slug(name), "name": name, "type": info["type"], "subtype": info.get("subtype"),
                      "series": info.get("series"), "stars": info.get("stars"), "types": [], "hp": None, "def": None,
                      "atk": None, "spd": None, "ability": None, "author": None, "ts": None,
                      "psd": path if low.endswith(".psd") else None, "png": png, "problems": [], "parsed": False})
    # cards.json leaves "parsed" out when true

    # aliases.pkl: alias -> target png file name
    by_png = {os.path.basename(c["png"]).lower(): c for c in cards if c["png"]}
    for alias, target in aliases.items():
        card = by_png.get(str(target).lower())
        if card is not None and norm(str(alias).replace("_", " ")) != norm(card["name"]):     # Breakfast's "breakfast"
            card.setdefault("aliases", []).append(str(alias).replace("_", " "))

    # authors: MDW/Card Authors.txt wins over the bot ([people] maps git names to shown names)
    people, credited = parse_authors()
    for e in cards:
        if not e.get("dup"):
            listed = credited.get(card_key(e["name"]))
            e["author"] = person(people, listed or e.get("author"))
    by_id = {e["id"]: e for e in cards}
    for e in cards:
        if e.get("dup"):
            e["author"] = by_id[e["dup"]]["author"]          # a duplicate is its original's card
    if credited:
        log(f"authors: {sum(1 for e in cards if card_key(e['name']) in credited)} cards credited by Card Authors.txt, {len(people)} people")

    # images (cached by blob hash; only new or changed PNGs are fetched and resized)
    jobs = [e for e in cards + rules if e["png"] and e["png"] in tree]
    failed = []
    def images(e):
        try:
            e["img"], e["tw"], e["th"] = make_images(e["png"], tree[e["png"]])
        except Exception as err:
            failed.append(e["png"])
            log("image failed:", e["png"], err)
    cache_dir = os.path.join(CACHE, "img")
    cached_before = len(os.listdir(cache_dir))
    with ThreadPoolExecutor(min(16, (os.cpu_count() or 4) * 2)) as pool:
        list(pool.map(images, jobs))
    if len(failed) > max(5, len(jobs) // 50):
        raise SystemExit(f"error: {len(failed)} of {len(jobs)} card images failed (network?); not deploying a site with missing images.")
    used = set()
    for e in jobs:
        if e.get("img"):
            for name in image_names(tree[e["png"]]).values():
                used.add(name)
                shutil.copyfile(os.path.join(cache_dir, name), os.path.join(DIST, "thumbs", name))
    pruned = [n for n in os.listdir(cache_dir) if n not in used]
    for n in pruned:
        os.remove(os.path.join(cache_dir, n))
    made = len(os.listdir(cache_dir)) - cached_before + len(pruned)
    log(f"images: {len(jobs)} cards, {made} new files, {len(pruned)} unused pruned, {len(failed)} failed")

    icons = build_icons(tree)
    by_norm = {}
    for c in cards:
        by_norm.setdefault(alnum(c["name"]), c)
        for a in c.get("aliases", []):
            by_norm.setdefault(alnum(a), c)
    banlist = parse_banlist(by_norm)

    # image versions: commits table + per card [[commit index, path then if it differs], ...], newest first
    by_png = {}
    for e in cards + rules:
        if e.get("png") and e["png"] in tree:
            by_png.setdefault(e["png"], []).append(e)
    found = image_versions(list(by_png))
    versions = {"available": found is not None, "repo": CARD_REPO, "commits": [], "cards": {}}
    if found:
        index = {}
        for png, vs in found.items():
            rows = []
            for (sha, ts, author, subject), path in vs:
                if sha not in index:
                    index[sha] = len(versions["commits"])
                    versions["commits"].append([sha, ts, person(people, author), subject])
                rows.append([index[sha]] + ([path] if path != png else []))
            if len(rows) > 1:                     # one version = nothing to compare
                for e in by_png[png]:
                    versions["cards"][e["id"]] = rows
                    e["iv"] = len(rows)
        first = min((c[1] for c in versions["commits"]), default=0)
        versions["since"] = first
        log(f"image versions: {sum(len(r) for r in versions['cards'].values())} versions of {len(versions['cards'])} cards "
            f"from {len(versions['commits'])} commits, since {datetime.fromtimestamp(first, timezone.utc):%Y-%m-%d}")

    history = {}
    for e in cards + rules:
        if e.get("history"):                  # loaded on demand: the first screen only needs the count
            history[e["id"]] = e.pop("history")
            e["hv"] = len(history[e["id"]])
        for k in [k for k, v in e.items() if v in (None, [], "") or (k == "parsed" and v is True)]:
            del e[k]                          # drop empty fields to keep the JSON small
    rules.sort(key=lambda r: r["name"].lower())
    data = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "repo": CARD_REPO, "botRepo": BOT_REPO, "raw": RAW,
        "cards": cards, "icons": icons, "banlist": banlist,
    }
    os.makedirs(os.path.join(DIST, "data"))
    files = {"cards.json": data, "rules.json": {"rules": rules}, "history.json": history, "versions.json": versions}
    blobs = {name: json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8") for name, obj in files.items()}
    for name, blob in blobs.items():
        with open(os.path.join(DIST, "data", name), "wb") as fh:
            fh.write(blob)
    log(f"cards: {len(cards)} ({sum(1 for c in cards if c.get('parsed') is False)} image only), rulebook pages: {len(rules)}, "
        f"icons: {len(set(i['file'] for i in icons.values()))}, banned: {sum(len(g['entries']) for g in banlist['groups'])}")

    # static files, stamped with a build version so browsers never mix an old script with new data
    assets_src = os.path.join(SITE, "assets")
    digest = hashlib.sha256()
    for name in sorted(os.listdir(assets_src)) + ["index.html"]:
        digest.update(open(os.path.join(SITE, "index.html") if name == "index.html" else os.path.join(assets_src, name), "rb").read())
    for name in sorted(blobs):
        digest.update(blobs[name])
    version = digest.hexdigest()[:10]
    os.makedirs(os.path.join(DIST, "assets"))
    for name in os.listdir(assets_src):
        text = open(os.path.join(assets_src, name), encoding="utf-8").read()
        if name.endswith(".js"):              # module imports: "./x.js" -> "./x.js?v=..."
            text = re.sub(r'(from\s+"\./[\w-]+\.js)"', rf'\1?v={version}"', text)
        with open(os.path.join(DIST, "assets", name), "w", encoding="utf-8") as fh:
            fh.write(text)
    template = re.sub(r'((?:assets/[\w-]+\.(?:js|css))|data/cards\.json)"', rf'\1?v={version}"',
                      open(os.path.join(SITE, "index.html"), encoding="utf-8").read()).replace("<!--BUILD-->", version)
    with open(os.path.join(DIST, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(template.replace("<!--HEAD-->", '<base href="./">'))
    with open(os.path.join(DIST, "404.html"), "w", encoding="utf-8") as fh:
        fh.write(template.replace("<!--HEAD-->", f'<base href="{SITE_URL}/">'))   # absolute: the 404 page can be served at any depth
    for c in cards:
        text = re.sub(r"\[([^\[\]:]+)(?::\s*(no|tint|sticker))?\]",
                      lambda m: ("non-" if m.group(2) == "no" else "") + m.group(1).replace("_", " ").title(), c.get("ability", "") or "")
        bits = [KIND_LABEL.get(c["type"], c["type"].title())] + ([f"{c['stars']}★"] if c.get("stars") else []) + ([c["series"]] if c.get("series") else [])
        desc = " · ".join(bits) + (" — " + " ".join(text.split()) if text else "")
        image = RAW + quote(c["png"]) if c.get("png") else ""
        url = f"{SITE_URL}/c/{c['id']}/" if SITE_URL else ""
        head = "\n".join([
            '<base href="../../">',
            f'<meta name="card" content="{c["id"]}">',
            f'<meta property="og:title" content="{html.escape(c["name"])}">',
            f'<meta property="og:description" content="{html.escape(desc[:300])}">',
            f'<meta property="og:image" content="{html.escape(image)}">' if image else "",
            f'<meta property="og:url" content="{html.escape(url)}">' if url else "",
            '<meta property="og:type" content="website">',
            '<meta name="twitter:card" content="summary_large_image">',
            f'<title>{html.escape(c["name"])} · Impossibility Simulator</title>',
        ])
        os.makedirs(os.path.join(DIST, "c", c["id"]))
        page = template.replace("<!--HEAD-->", head).replace("<title>Impossibility Simulator · Card Browser</title>", "")
        with open(os.path.join(DIST, "c", c["id"], "index.html"), "w", encoding="utf-8") as fh:
            fh.write(page)
    log(f"site written to {DIST} (build {version}, {time.time() - started:.0f}s)")


if __name__ == "__main__":
    sys.exit(main())
