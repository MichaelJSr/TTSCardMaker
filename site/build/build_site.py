"""Build the static card browser into site/dist.

Run by .github/workflows/site.yml on every push to main, after each Card sync commit, daily, and on demand. Also runs locally: `python site/build/build_site.py`, then serve site/dist.

Where the data comes from:
  * Card text, stats, authors and history: the card sync's db/ on this repo's branch data (stats.json, old_stats.json;
    the same data the Discord bot answers from), in CARD_DATA_DIR (site.yml checks the branch out; locally:
    `git worktree add /tmp/carddata origin/data`, then CARD_DATA_DIR=/tmp/carddata/db). PSDs are never parsed here.
    The records are read into stand-ins of the bot's classes (load_card_data); a field the site reads that the cards
    lack, or one it doesn't know, is a warning. The PSDs' structure (fonts, text layers, effects, stat rows, layer
    tree) comes from its psd_details.json, keyed by PSD blob sha; a card or rulebook page with a record gets
    data/details/<id>.json for its Details dropdown. Aliases come from site/Card Edits.json.
  * Images: card PNGs in this repo, turned into three AVIF sizes (240 px and 360 px for the grid at 1x/2x, 720 px
    for the card view; AVIF only, no WebP copies). They are cached by git blob hash and encode settings (thumb_tag, in
    the file names) in site/.cache/img, so after the first run only new or changed cards (or a width whose settings
    changed) are downloaded and encoded; images no card uses any more are pruned. With
    IMAGE_BUDGET (seconds; site.yml sets it), images not made by then are left for the next run: the build fails
    (nothing deployed) and site.yml saves the cache (it does after any failed build), so a full re-encode spans runs.
    Each image's size and accent color are kept in site/.cache/images.json by blob, icons in site/.cache/icons, deck
    page montages in site/.og-cache; dist/ gets hardlinks (else copies).
  * Icons: Types/ and Types/Stars/; icon names and aliases from MDW/Fonts/stoogedings-src/stoogedings.json. Each icon the
    font has also gets its token variants' pictures ([fire:tint], :sticker, :glow, :darkglow; dist/icons/fire.<stamp>.glow.webp),
    drawn by the font build's own icon_art (build_stoogedings.py, which needs its requirements.txt: without them,
    a warning and no variant pictures), cached by blob in site/.cache/icons; cards.json iconVariants holds how far each
    reaches past the icon (text.js sizes them).
  * Deck rules: the rulebook pages; banned cards from site/Constructed Ban List.txt.
  * Authors: site/Card Authors.txt ([people] git name = shown name, [cards] Card Name = person) wins over the bot's
    author, the same rule the card data build applies.
  * Corrections: site/Card Edits.json (the website's Edit button); the bot applies it too.
  * Profiles: site/profiles/<login>.json, made on the website by signed-in editors (own profile; admins any) and
    published with the edit batch. Validated here (bad files skipped, bad fields dropped, never a failed build).
  * Decks: site/decks/<owner>/<slug>.json, hands published from the deck builder by signed-in editors (own decks; admins
    any) with the edit batch. A public deck is resolved against the visible cards (unknown ones dropped with a warning);
    a private one is AES-GCM ciphertext made in the browser and passes through as it is. Bad files skipped, never a failed build.
  * Passwords: site/logins/<login>.json, a signed-in editor's GitHub token encrypted in the browser with their password
    (login.js). Shapes checked (bad files skipped with a warning, never a failed build), copied to data/logins/<login>.json
    (lowercase name), the password sign-in's fallback when GitHub's API can't be reached (names differing only in case:
    neither copied); data.passwords = how many.
  * Image versions and contributions: one pass over the git history (commit metadata only, no file contents; commits
    dated by committer time, as the bot dates versions) lists
    every commit that changed each card PNG, following folder moves (exact renames, and a move that changed the image
    when one PNG of that file name was deleted; not the bot's lossless recompressions, named in its Recompressed
    trailers), gives each card its first upload (fs: created's fallback), and counts
    per person the commits that added or changed a card (PSD or PNG) and the publish batches (commits to Card
    Edits.json). Needs full history: a shallow clone gets no image versions, no fs, and counts edit batches from the
    file's _by/_at stamps instead.
  * Creation dates: site/Card Creation Dates.json (AutoCroissant's `python -m commands.discord_edits created`), each card's
    first Discord post; a card's created is the earlier of that and fs (a hand-set date wins): the Cards tab's created
    sort, the card page's "created" fact, the person pages' newest cards and activity chart. Bad entries skipped.
  * Changelog: the card sync's events (CARD_DATA_DIR's changelog/YYYY-MM.jsonl and manifest.json), the edit batches
    (one more `git log` over Card Edits.json and Card Authors.txt, their versions read in one batch) and the archived
    cards (old_stats tags).
PSDs in the repo that the bot hasn't parsed yet (and card PNGs without a PSD) are still listed, image only.

Output (site/dist): data/cards.json (everything the first screen needs), data/rules.json, data/history.json, data/users.json,
data/contributions.json, data/decks.json, data/versions.json, data/analytics.json and data/changelog.json (loaded when the rulebook, a card's text or image history, the
changes feed, the People tab, the published decks, the Stats page or a card's Balance block, or the Changelog and Database edits tabs are opened; analytics.py makes analytics.json), data/details/<id>.json (a card's or rulebook page's Details dropdown),
data/logins/<login>.json (the password sign-in's fallback copy), data/fonts.json (the edit mock-up's web fonts: PSD font name ->
its MDW/Fonts file, face names cached by blob in site/.cache/fonts.json), images, icons,
assets and one share page per card, per person and per public deck (its preview image a montage of its cards). Asset and data URLs carry a version (?v=...) so a deploy never mixes old scripts with new data: each asset's from its
content and its imports', the data's from its content without the build time; build.txt digests the whole site (which build is live),
then the page's stamp (<meta name="page">), which open pages poll for (fresh.js).
game.txt: every visible card and rulebook page, the timing tags and the ban list as plain text (game_text), linked from the Rulebook.

The build fails (exit 1, nothing deployed) when the bot's card data can't be downloaded or looks truncated, or when
many images fail; it degrades gracefully (logs and continues) for missing history/aliases or a few bad images.
"""
import base64
import hashlib
import html
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from urllib.parse import quote
from urllib.request import Request, urlopen

from PIL import Image, features

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))     # for loads by file path (the bot's bench scripts)
import analytics  # noqa: E402

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(SITE)
DIST = os.path.join(SITE, "dist")
CACHE = os.path.join(SITE, ".cache")
OG_CACHE = os.path.join(SITE, ".og-cache")   # deck page montages: their own CI cache, so outside CACHE
CARD_REPO = os.environ.get("CARD_REPO", "MichaelJSr/TTSCardMaker")
BOT_REPO = os.environ.get("BOT_REPO", "bobberlington/AutoCroissant")
SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")
RAW = f"https://raw.githubusercontent.com/{CARD_REPO}/main/"
DETAILS_JSON = "psd_details.json"            # the PSD structure records {version, cards: {blob sha: record}} (AutoCroissant card_db.DETAILS_JSON)
IMAGE_SIZES = {240: 60, 360: 55, 720: 50}    # width -> AVIF quality. 240/360: grid at 1x/2x; 720: card view (NOTES §28)
AVIF = {"subsampling": "4:4:4", "speed": 6, "max_threads": 1}   # 4:4:4 keeps red text red; one thread each, cards in parallel
THUMB_VERSION = "1"                          # bump to re-encode every card image (a resize change); quality and AVIF rename by themselves


def thumb_tag(w):
    """6 hex digits of a width's encode settings, in its file names: new settings, new files (and URLs)."""
    avif = {k: v for k, v in AVIF.items() if k != "max_threads"}
    return hashlib.sha256(f"{THUMB_VERSION}:{w}:{IMAGE_SIZES[w]}:{json.dumps(avif, sort_keys=True)}".encode()).hexdigest()[:6]


IMAGE_BUDGET = float(os.environ.get("IMAGE_BUDGET") or 0)      # seconds for making images (0: no limit): the rest waits for the next run
IMAGE_WIDTH = 360                            # the size whose dimensions go into cards.json (aspect ratio)
ICON_SIZE = 96
ICON_VERSION = f"1-{ICON_SIZE}"              # in the cached icons' names: bump the 1 when build_icons' crop or WebP settings change
# token variants drawn as images, as the font draws them ([fire:tint] ... [fire:darkglow]); [fire:no] is style.css .tok-no
VARIANT_IMAGES = ("tint", "sticker", "glow", "darkglow")
VARIANT_VERSION = "1"                        # in the cached variant images' names: bump when variant_art or its WebP settings change
FONT_BUILD = "MDW/Fonts/stoogedings-src/build_stoogedings.py"   # its icon_art draws them (needs its requirements.txt)
IMAGE_META = "images.json"                   # in CACHE: each card image's size and accent color, by PNG blob sha
IMAGE_META_VERSION = f"3:{IMAGE_WIDTH}"       # bump the 3 when accent_color or the resize changes
IMAGE_META_WEBP = f"1:{IMAGE_WIDTH}:80"      # the WebP builds' rows: same sizes, their colours kept (no hue change); drop once deployed
OG_WIDTH = 480                               # link-preview image (Discord shows ≤ 300 px tall)
OG_DECK_CARDS = 6                            # cards in a deck page's link-preview montage
CREATOR_CARDS = ("Croissant", "Michael", "Bobberlington", "The Forbidden One", "Kyle", "Tyler", "Z!!!!!")   # the site's preview fan (owner 2026-10-25; alternating warm and dark, Z!!!!! shown whole), by file key; Kyle is hdckighfkvhvgmk's
OG_DECK_VERSION = "1"                        # bump when the montage's layout changes (its cache key)
SITE_NAME = "Impossibility Simulator"
MIN_CARDS = 100                              # fewer cards than this in stats.json means broken data
# the game's names for each card_type (rulebook: creature/item decks, field cards, N.M.E. items, auxiliary decks)
KIND_LABEL = {"creature": "Creature", "item": "Item", "field": "Field card", "minion": "Minion", "nme": "N.M.E. item",
              "aux item": "Auxiliary item", "creatures": "Auxiliary creature", "debuff": "Debuff", "buff": "Buff"}
KIND_PLURAL = {"creature": "creatures", "item": "items", "field": "field cards", "minion": "minions", "nme": "N.M.E. items",
               "aux item": "auxiliary items", "status": "status effects", "creatures": "auxiliary creatures"}   # app.js KINDS
CARD_FOLDERS = ("Creatures/", "Items/", "Field/", "N.M.E/", "Auxiliary/")
# the hand-kept website files, directly under site/ (in MDW/ until 2026-10-20); read by the build and the bot, never published
AUTHORS_PATH = "site/Card Authors.txt"
BANLIST_PATH = "site/Constructed Ban List.txt"
EDITS_PATH = "site/Card Edits.json"
CREATED_PATH = "site/Card Creation Dates.json"  # when each card was made (AutoCroissant discord_edits created; global_config.CREATED_PATH)
CREATED_FROM = ("discord", "git", "hand")       # its first Discord post, first git upload, or set by hand (card_edits.CardDates.FROM)
RATINGS_PATH = "site/Card Ratings.json"         # dated 1-10 ratings (AutoCroissant tts_ratings, the website's Rate it; card_edits.CardRatings)
RATING_SCALES = ("favorability", "power")
RATING_SOURCES = ("TTS session", "website")
BOT_FIELDS = "_bot"                           # an entry's fields that are not its _by editor's (old Discord edits, until 2026-10-25)
CREDIT = "_credit"                            # {field: {"_by", "_at"}}: a _bot field's Discord editor (old entries)
ADMINS_PATH = "site/Website Admins.txt"
PROFILES_DIR = "site/profiles"                # <login>.json per person who made a profile on the website
DECKS_DIR = "site/decks"                      # <owner>/<slug>.json per hand published from the deck builder
LOGINS_DIR = "site/logins"                    # <login>.json: a token sealed with its owner's password (password sign-in)
# Card Edits.json fields; same list in edit.js and the bot's CardEdits (subseries: database only, never from the folder)
EDIT_FIELDS = {"name": str, "type": str, "subtype": str, "series": str, "subseries": str, "stars": int, "types": list,
               "hp": int, "def": int, "atk": int, "spd": int, "ability": str, "note": str, "aliases": list,
               "dup_of": str, "hidden": bool, "problems_ok": bool, "allow_high_stats": bool, "creatures": list}
EDIT_NULLABLE = {"subtype", "series", "subseries", "stars", "hp", "def", "atk", "spd"}      # may be null
# printed on the card image, so an edit waits for the pipeline ("PSD pending"). The same set lives in edit.js FROM, app.js
# FIELD_LABEL, the bot's CardEdits.KIND ("psd") and psd_edit STAT_FIELDS + TEXT_FIELDS + NOT_YET. creatures is database-only
PSD_FIELDS = {"name", "stars", "types", "hp", "def", "atk", "spd", "ability"}
DATA_FIELDS = ("type", "subtype", "series", "subseries", "stars", "types", "hp", "def", "atk", "spd", "ability", "note", "creatures")
STAT_KEYS = {"hp": "hp", "def": "defense", "atk": "attack", "spd": "speed"}
# parser notes an edit answers
FIXED_BY = {"hp": ("HP NOT FOUND",), "def": ("DEF NOT FOUND",), "atk": ("ATK NOT FOUND",), "spd": ("SPD NOT FOUND",),
            "ability": ("ABILITY TEXT NOT FOUND", "NO ABILITY LAYER"), "stars": ("NO STARS FOUND",),
            "type": ("UNKNOWN TYPE",), "types": ("MISSPELT TYPE",), "allow_high_stats": ("STATS TOO HIGH",),
            "creatures": ("SEVERAL CREATURES",)}
SKIP_PARTS = ("MDW", "Markers")


def log(*args):
    print(*args, flush=True)


def fetch(url, tries=3, accept=None):
    headers = {"User-Agent": "card-browser-build", **({"Accept": accept} if accept else {})}
    for attempt in range(tries):
        try:
            with urlopen(Request(url, headers=headers), timeout=60) as r:
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


# ---- stand-ins of the bot's card classes (its data, none of its code) ------------------------------------------
class _Obj:
    """A record's keys as fields (stand_in)."""


class CardInfo(_Obj):
    """Stub of the bot's CardInfo (commands/card_models.py): its fields, no code."""


class CardStats(_Obj):
    """Stub of the bot's CardStats."""


# fields the site reads; other known fields
CARD_FIELDS = {"card_type", "path", "timestamp", "ability", "stars", "subtype", "series", "types", "stats", "problems", "author",
               "blob_sha", "parsed_values"}
# may be missing; archived: a deleted PSD's record; version: a version's start and end (analytics.when)
CARD_FIELDS_OPTIONAL = {"name", "display_name", "duplicate_of", "creatures", "note", "hidden", "problems_ok", "allow_high_stats",
                        "alt_names", "subseries", "parser_version", "archived", "version", "created"}
STATS_FIELDS = {"hp", "defense", "attack", "speed"}
HISTORY_FIELDS = {"ability", "timestamp"}


def warn(message):
    """A warning in the log, and on the run's summary page in GitHub Actions."""
    log(f"warning: {message}")
    if os.environ.get("GITHUB_ACTIONS"):
        text = str(message).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")   # workflow command escaping
        print(f"::warning title=Card browser build::{text}", flush=True)


def bot_field_warnings(stats, old_stats):
    """Fields the site reads that the bot's objects lack, and fields it doesn't know (a rename in card_models.py)."""
    out = []
    def check(source, objs, needed, known):
        objs = [o for o in objs if isinstance(o, _Obj)]
        for field in sorted(needed):
            missing = sum(1 for o in objs if field not in o.__dict__)
            if missing:
                out.append(f"{source}: {missing} of {len(objs)} lack the field {field!r} (renamed in the bot?); "
                           f"the site shows them without it")
        extra = {}
        for o in objs:
            for field in o.__dict__.keys() - known:
                extra[field] = extra.get(field, 0) + 1
        for field, n in sorted(extra.items()):
            out.append(f"{source}: {n} have the field {field!r} the site doesn't know (new or renamed in the bot?); it isn't shown")
    cards = list(stats.values())
    check("stats.json cards", cards, CARD_FIELDS, CARD_FIELDS | CARD_FIELDS_OPTIONAL)
    check("stats.json stat lines", [getattr(c, "stats", None) for c in cards] + [x for c in cards for x in getattr(c, "creatures", None) or []],
          STATS_FIELDS, STATS_FIELDS)
    old = [o for versions in old_stats.values() for o in versions or []]
    check("old_stats.json cards", old, HISTORY_FIELDS, CARD_FIELDS | CARD_FIELDS_OPTIONAL)
    return out


def psd_records(data):
    """The records of psd_details.json by blob sha; {} for anything but its shape."""
    cards = data.get("cards") if isinstance(data, dict) else None
    return {sha: rec for sha, rec in cards.items() if isinstance(rec, dict)} if isinstance(cards, dict) else {}


# ---- the card sync's data (db/ on the branch data, AutoCroissant docs/Campaigns/DATA_BUILD_ACTION.md §8, §10) ----------
# site.yml checks it out and sets CARD_DATA_DIR; the build needs it.
CARD_DATA_DIR = os.environ.get("CARD_DATA_DIR", "")
DB_SCHEMA = 1                                 # AutoCroissant card_db.SCHEMA


def stand_in(cls, rec):
    """A cls stand-in with rec's keys as its fields."""
    if not isinstance(rec, dict):
        raise ValueError(f"a {cls.__name__} record is {type(rec).__name__}, not an object")
    obj = cls()
    obj.__dict__.update(rec)
    return obj


def card_of(rec):
    """A db/ record (card_db.record: CardInfo's attribute names; stats and creatures as CardStats') as a stand-in."""
    card = stand_in(CardInfo, rec)
    if card.__dict__.get("stats") is not None:
        card.stats = stand_in(CardStats, card.stats)
    if card.__dict__.get("creatures") is not None:
        card.creatures = [stand_in(CardStats, line) for line in card.creatures]
    return card


def db_cards(folder, name):
    """{name: record or [record, ...]} of db/<name>; ValueError for anything but a schema DB_SCHEMA card file."""
    with open(os.path.join(folder, name), encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict) or data.get("schema") != DB_SCHEMA or not isinstance(data.get("cards"), dict):
        raise ValueError(f"{name} is not a schema {DB_SCHEMA} card file")
    return data["cards"]


def load_card_data(folder):
    """(stats, old_stats, PSD records) from the card sync's db/: stats.json, old_stats.json and psd_details.json. No
    readable stats.json: SystemExit."""
    try:
        stats = {name: card_of(rec) for name, rec in db_cards(folder, "stats.json").items()}
    except Exception as e:
        raise SystemExit(f"error: can't load the card data ({os.path.join(folder, 'stats.json')}): {e}. Not building a site without it.")
    try:
        old_stats = {name: [card_of(rec) for rec in recs] for name, recs in db_cards(folder, "old_stats.json").items()}
    except Exception as e:
        warn(f"no card history: {e}")
        old_stats = {}
    try:
        with open(os.path.join(folder, DETAILS_JSON), encoding="utf-8") as fh:
            records = psd_records(json.load(fh))
    except Exception as e:
        log("no PSD details:", e)
        records = {}
    return stats, old_stats, records


def join_details(cards, records, tree):
    """
    The record of each card's PSD: by its blob at HEAD, else the blob the bot parsed, else the newest record for its path.

    Flags the card (details: true in cards.json or rules.json) and returns {card id: record + id and name} for data/details/<id>.json.
    A duplicate (same PSD) gets its original's record.
    """
    by_path = {}
    for rec in records.values():
        path = rec.get("path")
        if path and str(rec.get("at") or "") >= str(by_path.get(path, {}).get("at") or ""):
            by_path[path] = rec
    out = {}
    for e in cards:
        path = e.get("psd")
        rec = (records.get(tree.get(path, "")) or records.get(e.get("_blob") or "") or by_path.get(path)) if path else None
        if rec:
            e["details"] = True
            out[e["id"]] = {**rec, "id": e["id"], "name": e["name"]}      # the card's id and shown name win
    return out


FONTS_DIR = "MDW/Fonts"                       # the PSDs' fonts, top level only (AutoCroissant font_check.FONTS_DIR)
FONT_EXTENSIONS = (".ttf", ".otf", ".ttc", ".otc")
WEB_FONTS = (".ttf", ".otf")                  # what the mock-up loads in the browser (a collection holds several faces)
FONT_NAMES = "fonts.json"                     # in CACHE: each font file's face names and size, by blob sha
FONT_NAMES_VERSION = 2                        # bump when font_faces changes (2: PostScript names only, as font_check since 2026-10-23)
FONT_WEB_MAX = 8 * 1024 * 1024                # a bigger file isn't offered to the browser: the mock-up draws a stand-in


def ps_name(name):
    """A name as FreeType reports PostScript names: ASCII 33-126 without []{}()<>/% (font_check.ps_name)."""
    return re.sub(r"[^!-~]|[\[\]{}()<>/%]", "", name)


NAME_CODECS = {0: "utf_16_be", 3: {0: "utf_16_be", 1: "utf_16_be", 10: "utf_16_be", 2: "shift_jis", 3: "gb2312", 4: "big5", 5: "euc_kr", 6: "johab"},
               1: {0: "mac_roman", 6: "mac_greek", 7: "mac_cyrillic", 29: "mac_latin2", 35: "mac_turkish", 37: "mac_iceland"},
               2: {0: "ascii", 1: "utf_16_be", 2: "latin_1"}}          # fontTools encodingTools' map, the common part


def _name_text(platform, encoding, raw):
    """A name record's text as fontTools' toUnicode decodes it (an unknown encoding as ASCII); None when it can't."""
    codec = NAME_CODECS.get(platform, "ascii")
    codec = codec.get(encoding, "ascii") if isinstance(codec, dict) else codec
    try:
        return raw.decode(codec)
    except (UnicodeDecodeError, LookupError):
        return None


def font_faces(data):
    """
    The PostScript name of each face of a TrueType / OpenType font file, as AutoCroissant's font_check.face_names reads it
    with fontTools (without it): name ID 6, else 4, else 1 (the first decodable record, an English one preferred, as
    fontTools' getDebugName), through ps_name. A .ttc / .otc gives one per face. Raises ValueError for a file it can't read.
    """
    import struct
    try:
        offsets = list(struct.unpack_from(f">{struct.unpack_from('>I', data, 8)[0]}I", data, 12)) if data[:4] == b"ttcf" else [0]
        out = []
        for off in offsets:
            tables = {data[off + 12 + 16 * i: off + 16 + 16 * i]: struct.unpack_from(">II", data, off + 20 + 16 * i)
                      for i in range(struct.unpack_from(">H", data, off + 4)[0])}
            records = []
            if b"name" in tables:
                base = tables[b"name"][0]
                _, count, strings = struct.unpack_from(">HHH", data, base)
                for i in range(count):
                    platform, encoding, lang, nid, length, at = struct.unpack_from(">HHHHHH", data, base + 6 + 12 * i)
                    records.append((nid, platform, lang, _name_text(platform, encoding, data[base + strings + at: base + strings + at + length])))

            def pick(nid):                        # fontTools' getDebugName: Windows English, else Mac English, else the last read
                some = mac = None
                for n, platform, lang, value in records:
                    if n != nid or value is None:
                        continue
                    some = value
                    if (platform, lang) == (3, 0x409):
                        return value
                    if (platform, lang) == (1, 0) and mac is None:
                        mac = value
                return mac or some
            out.append(ps_name(next((n for n in (pick(i) for i in (6, 4, 1)) if n), "")))
        return out
    except struct.error as e:
        raise ValueError(f"not a font file ({e})")


def font_bytes(path):
    local = os.path.join(REPO, path)
    if os.path.isfile(local):
        with open(local, "rb") as fh:
            return fh.read()
    return fetch(RAW + quote(path))


def web_fonts(tree, names):
    """
    {font name: {"file": MDW/Fonts path, "bytes": size}} for the PSD fonts in names a top-level MDW/Fonts file supplies, as
    font_check decides it (a face with exactly that PostScript name; the first file by path wins), for the mock-up to
    load as a web font: .ttf / .otf up to FONT_WEB_MAX only. Face names are cached by blob sha
    in CACHE/fonts.json (a file is read, from the checkout or downloaded, only when its blob is new); never fails.
    """
    path = os.path.join(CACHE, FONT_NAMES)
    try:
        with open(path, encoding="utf-8") as fh:
            cached = json.load(fh)
        cached = cached.get("fonts", {}) if cached.get("version") == FONT_NAMES_VERSION else {}
    except (OSError, ValueError, AttributeError):
        cached = {}
    files = sorted(p for p in tree if p.startswith(FONTS_DIR + "/") and "/" not in p[len(FONTS_DIR) + 1:] and p.lower().endswith(FONT_EXTENSIONS))
    ok = lambda row: isinstance(row, dict) and isinstance(row.get("faces"), list) and isinstance(row.get("bytes"), int)

    def read(p):                                  # one bad or unreachable font never stops the build
        try:
            data = font_bytes(p)
            return {"faces": font_faces(data), "bytes": len(data)}
        except Exception as e:
            log(f"font {p}: {e}")
            return None
    new = [p for p in files if not ok(cached.get(tree[p]))]
    with ThreadPoolExecutor(max_workers=8) as pool:   # a CI build downloads them the first time (no MDW/Fonts checkout)
        fresh = dict(zip(new, pool.map(read, new)))
    used, exact = {}, {}
    for p in files:
        sha = tree[p]
        row = cached.get(sha) if ok(cached.get(sha)) else fresh.get(p)
        if not row:
            continue
        used[sha] = row
        for ps in row["faces"]:
            if isinstance(ps, str) and ps:
                exact.setdefault(ps, p)
    try:
        os.makedirs(CACHE, exist_ok=True)
        with open(path + ".tmp", "w", encoding="utf-8") as fh:
            json.dump({"version": FONT_NAMES_VERSION, "fonts": used}, fh, separators=(",", ":"))
        os.replace(path + ".tmp", path)
    except OSError as e:
        log(f"font names not cached: {e}")
    size = {p: used[tree[p]]["bytes"] for p in files if tree[p] in used}
    out = {}
    for name in sorted(n for n in names if isinstance(n, str) and n):
        p = exact.get(name)
        if p and p.lower().endswith(WEB_FONTS) and size.get(p, FONT_WEB_MAX + 1) <= FONT_WEB_MAX:
            out[name] = {"file": p, "bytes": size[p]}
    return out


def record_fonts(records):
    """The font names the text layers of the details records ask for."""
    return {t.get("font") for rec in records for t in (rec.get("text") if isinstance(rec.get("text"), list) else [])
            if isinstance(t, dict) and isinstance(t.get("font"), str)}


def stat(card, attr):
    return stat_of(getattr(card, "stats", None), attr)


def stat_of(stats, attr):
    value = getattr(stats, attr, -1)
    return value if isinstance(value, int) and value >= 0 else None


def text_since(card, old, text):
    """When the card's current text started: its start (analytics.when: the bot's carried version.from, else its last
    PSD commit), or the start of the versions just before it that hold the same text (a stats or art change kept the
    text). None without a date. The card page dates its current text by this (cards.json since), not by ts."""
    if not isinstance(getattr(card, "timestamp", None), (int, float)):
        return None
    start = analytics.when(card)
    dated = sorted((v for v in old or [] if isinstance(getattr(v, "timestamp", None), (int, float))), key=analytics.when)
    for v in reversed(dated):
        if getattr(v, "ability", None) != text:
            break
        start = min(start, analytics.when(v))
    return start


def date_text(entry, card, old):
    """entry's history (the card's older texts other than entry's ability, oldest first) and since (text_since, when
    not ts)."""
    versions = []
    for v in old or []:
        text = getattr(v, "ability", None)
        if text and text != entry["ability"] and all(x["ability"] != text for x in versions):
            versions.append({"ts": analytics.when(v) if getattr(v, "timestamp", None) is not None else None, "ability": text})
    if versions:
        entry["history"] = sorted(versions, key=lambda x: x["ts"] or 0)
    since = text_since(card, old, entry["ability"])
    if since is not None and since != entry["ts"]:
        entry["since"] = since                    # ts stays the last PSD commit ("updated", Recently updated)


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
_card_raw = None


def card_raw():
    """The card repo's files at the build's commit in Actions (raw main is a CDN copy up to 5 minutes old); main elsewhere
    (a local commit may not be pushed)."""
    global _card_raw
    if _card_raw is None:          # set once final: image threads may race here
        base = RAW
        if os.environ.get("GITHUB_ACTIONS") == "true":
            try:
                sha = subprocess.run(["git", "-C", REPO, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
                if re.fullmatch(r"[0-9a-f]{40}", sha):
                    base = f"https://raw.githubusercontent.com/{CARD_REPO}/{sha}/"
            except (OSError, subprocess.CalledProcessError):
                pass
        _card_raw = base
    return _card_raw


def blob_sha(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def image_bytes(path, sha=None):
    """The file from the checkout, else downloaded at the build's commit (then main) and checked against its blob sha,
    so a picture named by a blob is that blob's picture."""
    local = os.path.join(REPO, path)
    if os.path.isfile(local):
        with open(local, "rb") as fh:
            return fh.read()
    err = None
    for base in dict.fromkeys((card_raw(), RAW)):
        try:
            data = fetch(base + quote(path))
        except Exception as e:
            err = e
            continue
        if sha is None or blob_sha(data) == sha:
            return data
        err = ValueError(f"{base}{path} is not blob {sha[:12]}")
    raise err


def image_names(sha):
    names = {w: f"{sha[:16]}-{w}-{thumb_tag(w)}.avif" for w in IMAGE_SIZES}
    names["og"] = f"{sha[:16]}-og.jpg"
    return names


def make_images(path, sha, known=None):
    """Cached AVIF images of a card PNG, named by blob hash and encode settings (thumb_tag). Returns (key, width, height,
    accent color), the size of the IMAGE_WIDTH one; known = the cached [width, height, color] of this blob, kept (missing
    files are made again)."""
    names = image_names(sha)
    cached = {w: os.path.join(CACHE, "img", n) for w, n in names.items()}
    if known and all(os.path.exists(f) for f in cached.values()):
        return (sha[:16], *known)
    src = Image.open(io.BytesIO(image_bytes(path, sha)))
    src = src.convert("RGBA" if src.mode in ("RGBA", "LA", "P") else "RGB")
    sized = {}
    for w, quality in IMAGE_SIZES.items():
        if os.path.exists(cached[w]) and (known or w not in (240, IMAGE_WIDTH)):
            continue
        sized[w] = im = src.copy()
        im.thumbnail((w, w * 3), Image.LANCZOS)
        if not os.path.exists(cached[w]):
            im.save(cached[w] + ".tmp", "AVIF", quality=quality, icc_profile=None, **AVIF)   # no profile: WebP never had one
            os.replace(cached[w] + ".tmp", cached[w])
    if not os.path.exists(cached["og"]):       # from the 720 px one: no PNG download
        with Image.open(cached[720]) as im:
            im = im.convert("RGBA")
            im.thumbnail((OG_WIDTH, OG_WIDTH * 3), Image.LANCZOS)
            flat = Image.new("RGB", im.size, (13, 13, 13))
            flat.paste(im, mask=im.getchannel("A"))
            flat.save(cached["og"] + ".tmp", "JPEG", quality=80, optimize=True, progressive=True)
            os.replace(cached["og"] + ".tmp", cached["og"])
    if known:
        return (sha[:16], *known)
    return sha[:16], *sized[IMAGE_WIDTH].size, accent_color(sized[240])   # the colour from the PNG: no codec noise


def load_image_meta():
    """{blob sha: [width, height, color]} from the last build; {} when missing or made by other image settings."""
    try:
        with open(os.path.join(CACHE, IMAGE_META), encoding="utf-8") as fh:
            meta = json.load(fh)
        ok = meta.get("version") in (IMAGE_META_VERSION, IMAGE_META_WEBP) and isinstance(meta.get("images"), dict)
        images = meta["images"] if ok else {}
        return {sha: row for sha, row in images.items() if valid_meta(row)}
    except (OSError, ValueError, AttributeError, KeyError):
        return {}


def valid_meta(row):
    """[int width, int height, "#rrggbb" or None]"""
    return (isinstance(row, list) and len(row) == 3 and all(type(n) is int and n > 0 for n in row[:2])
            and (row[2] is None or isinstance(row[2], str) and re.fullmatch(r"#[0-9a-f]{6}", row[2]) is not None))


def save_image_meta(images):
    path = os.path.join(CACHE, IMAGE_META)
    with open(path + ".tmp", "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"version": IMAGE_META_VERSION, "images": images}, separators=(",", ":")))
    os.replace(path + ".tmp", path)


def link_or_copy(src, dst, replace=False):
    """Hardlink (cache files are replaced, never rewritten in place), else copy. An existing dst is kept unless replace."""
    if os.path.lexists(dst):
        if not replace:
            return
        os.remove(dst)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copyfile(src, dst)


def accent_color(im):
    """The card's most common vivid color, for embed bars (im: its 240 px picture before encoding)."""
    small = im.convert("RGB").resize((40, 80))
    px = list(small.get_flattened_data() if hasattr(small, "get_flattened_data") else small.getdata())   # Pillow < 12.1
    buckets = {}
    for r, g, b in px:
        if max(r, g, b) >= 70 and max(r, g, b) - min(r, g, b) >= 60:
            buckets.setdefault((r // 40, g // 40, b // 40), []).append((r, g, b))
    if not buckets:
        return None
    top = max(buckets.values(), key=len)
    return "#%02x%02x%02x" % tuple(sum(c[i] for c in top) // len(top) for i in range(3))


def og_size(path):
    with Image.open(path) as im:
        return im.size


def clip(text, limit=300):
    """A link-preview description: Discord shows about this much."""
    return text if len(text) <= limit else text[:limit - 3].rsplit(" ", 1)[0] + "…"


def share_text(c):
    """Kind line, stats line, ability: the card's link-preview description."""
    kind = KIND_LABEL.get(c["type"], c["type"].title())
    head = " · ".join(filter(None, [f"{c['stars']}★ {kind}" if c.get("stars") else kind, c.get("series"), c.get("subseries"),
                                    f"by {c['author']}" if c.get("author") else None]))
    stats = " · ".join(f"{label} {c[k]}" for k, label in (("hp", "HP"), ("def", "DEF"), ("atk", "ATK"), ("spd", "SPD")) if c.get(k) is not None)
    text = re.sub(r"\[([^\[\]:]+)(?::\s*(?ai:(no|tint|sticker|glow|darkglow)))?\]",   # variants in any ASCII case, as the font
                  lambda m: ("non-" if (m.group(2) or "").lower() == "no" else "") + m.group(1).replace("_", " ").title(),
                  c.get("ability", "") or "")
    text = "\n".join(" ".join(line.split()) for line in text.splitlines() if line.strip())
    return clip("\n".join(filter(None, [head, stats, text])))


GRID_PRELOADS = 4                            # the cards grid's first pictures that index.html preloads


def grid_preload(cards):
    """index.html's preload hints for the grid's first pictures (app.js tileHtml: srcset 240w/360w, sizes = the tile size),
    added by a script only when the page opens on the plain grid (no filters, sort or table view) at the saved tile size."""
    first = [c["img"] for c in sorted((c for c in cards if not c.get("hidden")), key=lambda c: c["name"].lower()) if c.get("img")][:GRID_PRELOADS]
    if not first:
        return ""
    return ("<script>(() => { try { if (!/^(#\\/?(cards)?)?$/.test(location.hash) || localStorage.getItem(\"view\") === \"table\") return;\n"
            "  const w = { s: 160, l: 270 }[localStorage.getItem(\"size\")] || 200;\n"
            f"  for (const id of {json.dumps(first)}) {{ const l = document.createElement(\"link\"); l.rel = \"preload\"; l.as = \"image\"; l.href = `thumbs/${{id}}-360-{thumb_tag(360)}.avif`;\n"
            f"    l.imageSrcset = `thumbs/${{id}}-240-{thumb_tag(240)}.avif 240w, thumbs/${{id}}-360-{thumb_tag(360)}.avif 360w`; l.imageSizes = `${{w}}px`; l.fetchPriority = \"high\"; document.head.append(l); }}\n"
            "} catch { /* storage blocked: no hints */ } })();</script>")


def fan(cards, path):
    """1200×630 JPEG of the cards' 720 px thumbs in a row: centred when they fit, else overlapping edge to edge."""
    canvas = Image.new("RGB", (1200, 630), (13, 13, 13))
    ims = []
    for c in cards:
        with Image.open(os.path.join(DIST, "thumbs", f"{c['img']}-720-{thumb_tag(720)}.avif")) as im:
            im = im.convert("RGBA")
            im.thumbnail((300, 570), Image.LANCZOS)
            ims.append(im)
    if ims:
        width = sum(im.width for im in ims) + 20 * (len(ims) - 1)
        if width <= 1160:                      # side by side
            x = (1200 - width) // 2
            for im in ims:
                canvas.paste(im, (x, (630 - im.height) // 2), im)
                x += im.width + 20
        else:
            step = (1200 - 40 - ims[-1].width) / max(1, len(ims) - 1)
            for i, im in enumerate(ims):
                canvas.paste(im, (20 + round(i * step), (630 - im.height) // 2), im)
    canvas.save(path, "JPEG", quality=85, optimize=True, progressive=True)


def site_banner(cards, path):
    """1200×630 link-preview image: a fan of the creators' cards (CREATOR_CARDS, in order; else 5★ creatures, a stable
    pick), cached in OG_CACHE by their images; the cached file's name."""
    by_key = {c.get("key"): c for c in cards if c.get("img") and not c.get("dup")}
    picks = [by_key[k] for k in CREATOR_CARDS if k in by_key]
    if not picks:
        pool = [c for c in cards if c.get("img") and c["type"] == "creature" and c.get("stars") == 5 and not c.get("dup")]
        picks = sorted(pool, key=lambda c: hashlib.md5(c["id"].encode()).hexdigest())[:6]
    key = hashlib.sha256(f"{OG_DECK_VERSION}:{'|'.join(c['img'] for c in picks)}".encode()).hexdigest()[:16]
    name = f"banner-{key}.jpg"
    cached = os.path.join(OG_CACHE, name)
    if not os.path.exists(cached):
        os.makedirs(OG_CACHE, exist_ok=True)
        fan(picks, cached + ".tmp")
        os.replace(cached + ".tmp", cached)
    link_or_copy(cached, path, replace=True)
    return name


def deck_cards(d, by_id):
    """The hand in page order (decks.js handCards): the field card, creatures, items, the rest, each by stars."""
    cards = [by_id[i] for i in d["cards"] if i != d.get("field")]
    rank = {"creature": 0, "item": 1}
    order = sorted(cards, key=lambda c: (rank.get(c["type"], 2), -(c.get("stars") or 0), c["name"].lower()))
    return ([by_id[d["field"]]] if d.get("field") in by_id else []) + order


def deck_montage(picks):
    """A deck page's link-preview image of its first cards, cached in OG_CACHE by their image hashes; (key, cached file)."""
    key = hashlib.sha256(f"{OG_DECK_VERSION}:{'|'.join(c['img'] for c in picks)}".encode()).hexdigest()[:16]
    cached = os.path.join(OG_CACHE, f"{key}.jpg")
    if not os.path.exists(cached):
        fan(picks, cached + ".tmp")
        os.replace(cached + ".tmp", cached)
    return key, cached


def font_builder():
    """FONT_BUILD as a module (variant_art draws with its icon_art), or None, with a warning, without the file or its
    packages (MDW/Fonts/stoogedings-src/requirements.txt): then token variants show as the plain icon."""
    path = os.path.join(REPO, FONT_BUILD)
    if not os.path.exists(path):
        warn(f"no {FONT_BUILD}: token variants show as the plain icon")
        return None
    try:
        spec = importlib.util.spec_from_file_location("build_stoogedings", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    except ImportError as e:
        warn(f"no variant icons: {e.name or e} missing (pip install -r MDW/Fonts/stoogedings-src/requirements.txt); "
             "token variants show as the plain icon")
        return None
    if not hasattr(module, "icon_art"):
        warn(f"{FONT_BUILD} has no icon_art: token variants show as the plain icon")
        return None
    return module


def variant_reach(fb):
    """{variant: how far its image reaches past the icon's square box on each side, in box widths}: the font's
    :sticker OUTLINE and :glow GLOW_SIZE against its icon HEIGHT, in whole pixels at ICON_SIZE (text.js sizes them)."""
    px = lambda units: round(round(ICON_SIZE * units / fb.HEIGHT) / ICON_SIZE, 4)
    return {"tint": 0, "sticker": px(fb.OUTLINE), "glow": px(fb.GLOW_SIZE), "darkglow": px(fb.GLOW_SIZE)}


def variant_art(fb, png, tint, reach):
    """One icon's variant images, from the font build's own icon_art (fb: FONT_BUILD), the icon as big as the plain
    one (long side ICON_SIZE px): {variant: RGBA image}. tint and sticker take the text colour, so they are white
    masks that style.css paints: tint the shape in the plain icon's box, sticker the outline in a square under the plain
    icon. glow and darkglow are the halo with the icon on it. The squares are the icon's square box (where object-fit:
    contain puts it) plus reach[v] of it on each side; layers sit where the font's glyphs put them."""
    art = fb.icon_art(png.convert("RGBA"), tint)
    arr = art.arr
    h, w = arr.shape[:2]
    side = max(w, h)
    white = lambda alpha: Image.merge("RGBA", [Image.new("L", alpha.size, 255)] * 3 + [alpha])
    out = {}
    probe = Image.new("L", art.im.size)
    probe.thumbnail((ICON_SIZE, ICON_SIZE))                  # the plain icon's size (build_icons)
    out["tint"] = white(Image.fromarray(art.tint.astype("uint8") * 255)).resize(probe.size, Image.LANCZOS)

    def square(v):
        """(empty canvas, where the icon's top-left goes) for variant v, at arr's scale"""
        m = round(reach[v] * side)
        return Image.new("RGBA", (side + 2 * m,) * 2), (m + (side - w) // 2, m + (side - h) // 2)

    def done(v, im):
        n = ICON_SIZE + 2 * round(reach[v] * ICON_SIZE)
        return im.resize((n, n), Image.LANCZOS)

    canvas, (x, y) = square("sticker")                       # the outline glyph: pad px past the icon
    canvas.paste(white(Image.fromarray(art.sticker.astype("uint8") * 255)), (x - art.pad, y - art.pad))
    out["sticker"] = done("sticker", canvas)
    icon = Image.fromarray(arr)
    halo = Image.fromarray(art.glow_png)                     # the halo PNG: GLOW_SIZE units left of and above the icon
    halo = halo.resize((round(art.glow_w / art.upp), round(art.glow_h / art.upp)), Image.BICUBIC)
    for v, rgb in fb.GLOWS.items():
        canvas, (x, y) = square(v)
        canvas.paste(Image.merge("RGBA", [Image.new("L", halo.size, c) for c in rgb] + [halo]),
                     (x - round(fb.GLOW_SIZE / art.upp), y - round(fb.GLOW_SIZE / art.upp)))
        canvas.alpha_composite(icon, (x, y))
        out[v] = done(v, canvas)
    return {v: out[v] for v in VARIANT_IMAGES}


def build_icons(tree):
    """Types/ icons into dist/icons as 96 px WebP (<name>.<stamp>.webp), and the variant images
    (<name>.<stamp>.<variant>.webp) of those in the font. Returns ({normalized spelling: {file, name, kind, v: [variants with an image]}}, {variant: reach}); no
    variant images without FONT_BUILD's packages."""
    manifest_path = os.path.join(REPO, "MDW/Fonts/stoogedings-src/stoogedings.json")
    if os.path.exists(manifest_path):
        manifest = json.load(open(manifest_path))
    else:
        log("warning: no stoogedings manifest; icons get no aliases")
        manifest = {"icons": {}}
    os.makedirs(os.path.join(DIST, "icons"), exist_ok=True)
    cache_dir = os.path.join(CACHE, "icons")
    os.makedirs(cache_dir, exist_ok=True)
    script = None                                             # a changed build script or tint mode draws them again
    if manifest["icons"] and os.path.exists(os.path.join(REPO, FONT_BUILD)):
        with open(os.path.join(REPO, FONT_BUILD), "rb") as fh:
            script = hashlib.sha256(fh.read()).hexdigest()
    fb = font_builder() if manifest["icons"] and not script else None   # its warning
    icons, used, todo = {}, set(), []
    for path in sorted(tree):
        folder, _, file = path.rpartition("/")
        if folder not in ("Types", "Types/Stars") or not file.lower().endswith(".png"):
            continue
        stem = os.path.splitext(file)[0]
        name = stem.lower() if folder == "Types" else stem.lower().replace(" ", "_")
        kind = "type" if folder == "Types" else "star"
        cached = os.path.join(cache_dir, f"{tree[path][:16]}-{ICON_VERSION}.webp")   # by blob, like the card images
        used.add(os.path.basename(cached))
        if not os.path.exists(cached):
            im = Image.open(io.BytesIO(image_bytes(path, tree[path]))).convert("RGBA")
            box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
            if box:
                im = im.crop(box)
            im.thumbnail((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
            im.save(cached + ".tmp", "WEBP", quality=90, alpha_quality=100, method=4)   # shown at ≤34 px
            os.replace(cached + ".tmp", cached)
        info = manifest["icons"].get(name)
        key = ""
        if script and info:                                   # the font draws every variant of every manifest icon
            tint = info.get("tint", "auto")
            key = hashlib.sha256(f"{script}:{json.dumps(tint, sort_keys=True)}:{ICON_SIZE}".encode()).hexdigest()[:8]
        # the stamp in the file names (icon and variants): an old page's URL gets its own picture or a 404, never another
        # deploy's
        stamp = hashlib.sha256(f"{tree[path]}:{ICON_VERSION}:{VARIANT_VERSION}:{key}".encode()).hexdigest()[:10]
        out_name = f"{slugify(name)}.{stamp}.webp"
        link_or_copy(cached, os.path.join(DIST, "icons", out_name), replace=True)
        entry = {"file": f"icons/{out_name}", "name": name, "kind": kind}
        if key:
            files = {v: os.path.join(cache_dir, f"{tree[path][:16]}-{v}-{VARIANT_VERSION}-{key}.webp") for v in VARIANT_IMAGES}
            todo.append((path, tint, files, out_name, entry))
        aliases = (info or {}).get("aliases", [])
        for spelling in [name] + list(aliases):
            icons.setdefault(norm(spelling), entry)

    # the font build (cv2, fontTools: about 0.2-0.7 s to import) only when a variant image or the reach isn't cached
    reach_file, reach = f"reach-{script[:16]}-{ICON_SIZE}.json" if script else "", None
    if todo:
        try:
            with open(os.path.join(cache_dir, reach_file), encoding="utf-8") as fh:
                reach = json.load(fh)
        except (OSError, ValueError):
            reach = None
    if todo and (reach is None or not all(os.path.exists(f) for job in todo for f in job[2].values())):
        fb = font_builder()
        if fb is None:
            todo = []
        else:
            reach = variant_reach(fb)
            with open(os.path.join(cache_dir, reach_file + ".tmp"), "w", encoding="utf-8") as fh:
                json.dump(reach, fh)
            os.replace(os.path.join(cache_dir, reach_file + ".tmp"), os.path.join(cache_dir, reach_file))
    if todo:
        used.add(reach_file)
        used.update(os.path.basename(f) for job in todo for f in job[2].values())
    reach = reach if todo else {}

    def draw(job):
        path, tint, files, out_name, entry = job
        if not all(os.path.exists(f) for f in files.values()):
            try:
                art = variant_art(fb, Image.open(io.BytesIO(image_bytes(path, tree[path]))), tint, reach)
            except Exception as e:                            # never a failed build: this icon's variants show plain
                warn(f"no variant images for {path}: {type(e).__name__}: {e}")
                return
            for v, im in art.items():
                mask = v in ("tint", "sticker")               # white + alpha: lossless is smaller and exact
                im.save(files[v] + ".tmp", "WEBP", **({"lossless": True} if mask else {"quality": 90, "alpha_quality": 100}), method=4)
                os.replace(files[v] + ".tmp", files[v])
        for v, f in files.items():
            link_or_copy(f, os.path.join(DIST, "icons", out_name.replace(".webp", f".{v}.webp")), replace=True)
        entry["v"] = list(VARIANT_IMAGES)
    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 1)) as pool:   # cv2 and Pillow work outside the GIL
        list(pool.map(draw, todo))
    for name in os.listdir(cache_dir):
        if name not in used:
            os.remove(os.path.join(cache_dir, name))
    return icons, (reach if any("v" in e for e in icons.values()) else {})


# ---- authors ---------------------------------------------------------------------------------------
def card_key(name):
    """Card names match case-insensitively, with _ and spaces alike and whitespace collapsed."""
    return " ".join((name or "").replace("_", " ").lower().split())


def printed(text):
    """psd_parser.title_text"""
    return re.sub(r"[\s\x00-\x1f]+", " ", (text or "").replace("\ufeff", "")).strip()


def ability_text(text):
    """psd_edit.normalize_ability"""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ").replace("\x03", "\n")
    text = text.replace("\ufeff", "").rstrip()
    text = text.strip("'\"\n").rstrip(" '\"")
    if text:
        text = re.sub(r"\s+([:;,\.\?!])", r"\1", text)
    return text.strip(" '\"\n")


def type_keys(types):
    """A types list as psd_edit.same_types compares it: any order, any case, words joined by space, _, - or nothing alike
    (psd_parser.IconVocabulary.spellings)."""
    return sorted(re.sub(r"[ _\-]+", "", str(t).lower()) for t in types or [])


PEOPLE_AS_WRITTEN = {}                        # [people] with the git names' own case, for the editor


def parse_authors():
    """site/Card Authors.txt -> (people {lowercase git name: shown name}, cards {card_key: person}). Warns, never fails."""
    path = os.path.join(REPO, AUTHORS_PATH)
    if not os.path.exists(path):
        log(f"warning: no {AUTHORS_PATH}; authors come from the bot's data only")
        return {}, {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        return authors_of(fh.read(), note=log, written=PEOPLE_AS_WRITTEN)


def authors_of(text, note=None, written=None, names=None):
    """Card Authors.txt text -> (people, cards) as parse_authors; note(message) gets each skipped line, written the [people]
    lines with the git names' own case, names {card_key: the card name as written}."""
    people, cards = {}, {}
    section = None
    for n, raw in enumerate(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), 1):     # as open() reads lines
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip().lower()
            if section not in ("people", "cards") and note:
                note(f"warning: Card Authors.txt line {n}: unknown section [{section}], its lines are ignored")
            continue
        left, eq, right = line.partition("=")
        left, right = left.strip(), right.strip()
        if not eq or not left or not right or section not in ("people", "cards"):
            if note:
                note(f"warning: Card Authors.txt line {n} ignored (expected 'left = right' inside [people] or [cards]): {line[:60]}")
            continue
        if section == "people":
            people[left.lower()] = right
            if written is not None:
                written[left] = right
        else:
            cards[card_key(left)] = right
            if names is not None:
                names[card_key(left)] = left
    return people, cards


def person(people, name):
    return people.get(name.lower(), name) if name else name


# ---- corrections (site/Card Edits.json) ----------------------------------------------------------------
def valid_edit(field, value):
    kind = EDIT_FIELDS.get(field)
    if kind is None:
        return False
    if value is None:
        return field in EDIT_NULLABLE
    if kind is int:
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0
    if field == "creatures":                     # [{"hp": 7, "def": 4, "atk": 5, "spd": 6}, ...]
        return isinstance(value, list) and all(isinstance(c, dict) and all(k in STAT_KEYS and (v is None or valid_edit("hp", v))
                                                                           for k, v in c.items()) for c in value)
    if kind is list:
        return isinstance(value, list) and all(isinstance(x, str) for x in value)
    return isinstance(value, kind)


def valid_verdict(value):
    """A pipeline `_psd` entry: {"state": "baked" | "refused", "for": {field: value}, "psd": "<blob8>", "reason": str, ...}."""
    return (isinstance(value, dict) and value.get("state") in ("baked", "refused") and isinstance(value.get("for", {}), dict)
            and isinstance(value.get("psd", ""), str) and isinstance(value.get("reason", ""), str))


def edit_aliases(edits, key):
    """The aliases a card's Card Edits.json entry gives it."""
    found = edits.get(card_key(key))
    return [a for a in (found[0].get("aliases") or []) if a.strip()] if found else []


def parse_edits():
    """{card_key: (fields, meta)}; bad entries are skipped."""
    path = os.path.join(REPO, EDITS_PATH)
    if not os.path.exists(path):
        return {}
    try:
        data = json.load(open(path, encoding="utf-8"))
    except ValueError as e:
        log(f"warning: {EDITS_PATH} isn't valid JSON, no corrections applied: {e}")
        return {}
    cards = data.get("cards") if isinstance(data, dict) else None
    if not isinstance(cards, dict):
        log(f"warning: {EDITS_PATH} has no \"cards\" object, no corrections applied")
        return {}
    edits = {}
    for name, fields in cards.items():
        if not isinstance(fields, dict):
            log(f"warning: {EDITS_PATH}: {name!r} isn't an object, skipped")
            continue
        good = {}
        for field, value in fields.items():
            if field.startswith("_"):
                continue
            if valid_edit(field, value):
                good[field] = value
            else:
                log(f"warning: {EDITS_PATH}: {name}: {field} = {value!r} isn't a known field or has the wrong type, skipped")
        meta = {k: fields[k] for k in ("_by", "_at") if isinstance(fields.get(k), str)}
        bot = fields.get(BOT_FIELDS)                  # the fields AutoCroissant set under another editor's _by
        if isinstance(bot, list) and all(isinstance(f, str) for f in bot):
            meta[BOT_FIELDS] = bot
        elif bot is not None:
            log(f"warning: {EDITS_PATH}: {name}: {BOT_FIELDS} = {bot!r} isn't a list of fields, skipped")
        credit = parse_credit(name, fields.get(CREDIT), meta.get(BOT_FIELDS, ()))
        if credit:
            meta[CREDIT] = credit
        if "_psd" in fields:                            # the edit pipeline's verdict on the PSD fields
            if valid_verdict(fields["_psd"]):
                meta["_psd"] = fields["_psd"]
            else:
                log(f"warning: {EDITS_PATH}: {name}: _psd = {fields['_psd']!r} isn't a pipeline verdict, skipped")
        edits[card_key(name)] = (good, meta)
    return edits


def parse_credit(name, credit, bot):
    """An entry's _credit -> {field: {"_by", "_at"}} for its _bot fields; another shape is a warning, a field out of _bot ignored."""
    if credit is None:
        return {}
    if not isinstance(credit, dict):
        warn(f"{EDITS_PATH}: {name}: {CREDIT} = {credit!r} isn't an object, skipped")
        return {}
    out = {}
    for field, stamp in credit.items():
        if not (isinstance(stamp, dict) and isinstance(stamp.get("_by"), str) and stamp["_by"] and isinstance(stamp.get("_at"), str)):
            warn(f"{EDITS_PATH}: {name}: {CREDIT}.{field} = {stamp!r} isn't {{\"_by\", \"_at\"}}, skipped")
        elif field in bot:
            out[field] = {"_by": stamp["_by"], "_at": stamp["_at"]}
    return out


def parse_created():
    """site/Card Creation Dates.json -> {card_key: {"date", "from"[, "provisional"]}}; bad entries are skipped. Warns, never fails."""
    path = os.path.join(REPO, CREATED_PATH)
    if not os.path.exists(path):
        log(f"no {CREATED_PATH}: cards are dated by their first upload")
        return {}
    try:
        data = json.load(open(path, encoding="utf-8"))
    except ValueError as e:
        warn(f"{CREATED_PATH} isn't valid JSON, cards are dated by their first upload: {e}")
        return {}
    cards = data.get("cards") if isinstance(data, dict) else None
    if not isinstance(cards, dict):
        warn(f"{CREATED_PATH} has no \"cards\" object, cards are dated by their first upload")
        return {}
    out, bad = {}, []
    for name, entry in cards.items():
        day = entry.get("date") if isinstance(entry, dict) else None
        try:
            ok = isinstance(day, str) and date.fromisoformat(day).isoformat() == day and entry.get("from") in CREATED_FROM \
                and isinstance(entry.get("provisional", False), bool)
        except ValueError:
            ok = False
        if ok:
            out[card_key(name)] = {"date": day, "from": entry["from"], **({"provisional": True} if entry.get("provisional") else {})}
        else:
            bad.append(name)
    if bad:
        warn(f"{CREATED_PATH}: {len(bad)} entries skipped (expected {{\"date\": \"YYYY-MM-DD\", \"from\": "
             f"{' | '.join(CREATED_FROM)}}}): {', '.join(bad[:10])}")
    return out


def rating_number(v):
    """One decimal, as JS Math.round(v * 10) / 10; whole values as int (JSON.stringify writes 7, not 7.0)."""
    v = int(v * 10 + 0.5) / 10
    return int(v) if v == int(v) else v


def valid_rating(e):
    """card_edits.CardRatings.valid: {date, scale, value 1-10, by, source}."""
    if not isinstance(e, dict) or e.get("scale") not in RATING_SCALES or e.get("source") not in RATING_SOURCES:
        return False
    v, by, day = e.get("value"), e.get("by"), e.get("date")
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not 1 <= v <= 10 or not isinstance(by, str) or not by or len(by) > 100:
        return False
    try:
        return isinstance(day, str) and date.fromisoformat(day).isoformat() == day
    except ValueError:
        return False


def rating_order(entries):
    """Oldest first: date, source (TTS sessions first), by, scale (card_edits.CardRatings.order, edit.js ratingsFile)."""
    return sorted(entries, key=lambda e: (e["date"], RATING_SOURCES.index(e["source"]), e["by"].lower(), RATING_SCALES.index(e["scale"])))


def parse_ratings():
    """site/Card Ratings.json -> {card_key: (name, [entry])}; bad entries are skipped. Warns, never fails."""
    path = os.path.join(REPO, RATINGS_PATH)
    if not os.path.exists(path):
        log(f"no {RATINGS_PATH}: no ratings")
        return {}
    try:
        data = json.load(open(path, encoding="utf-8"))
    except ValueError as e:
        warn(f"{RATINGS_PATH} isn't valid JSON, no ratings: {e}")
        return {}
    cards = data.get("cards") if isinstance(data, dict) else None
    if not isinstance(cards, dict):
        warn(f"{RATINGS_PATH} has no \"cards\" object, no ratings")
        return {}
    out, bad = {}, []
    for name, entries in cards.items():
        entries = entries if isinstance(entries, list) else [None]
        kept = [{"date": e["date"], "scale": e["scale"], "value": rating_number(e["value"]), "by": e["by"], "source": e["source"]}
                for e in entries if valid_rating(e)]
        if len(kept) < len(entries):
            bad.append(name)
        if kept:
            got = out.setdefault(card_key(name), (name, []))
            got[1].extend(kept)
    if bad:
        warn(f"{RATINGS_PATH}: entries skipped on {len(bad)} cards (expected {{date, scale, value 1-10, by, source}}): {', '.join(bad[:10])}")
    return out


def rating_now(entries, scale, day=None, skip=None):
    """ratings.js current(): the mean of each rater's latest entry of scale (on or before day; skip: a rater, or raters,
    left out; "group" counts as one) -> {"value" (1 decimal), "raters", "date" (the newest)}, or None."""
    skip = {skip} if isinstance(skip, str) else set(skip or ())
    latest = {}
    for e in entries or ():                       # oldest first: a later one replaces
        if e.get("scale") == scale and (day is None or e["date"] <= day) and e["by"] not in skip:
            if e["by"] not in latest or e["date"] >= latest[e["by"]]["date"]:
                latest[e["by"]] = e
    if not latest:
        return None
    values = [e["value"] for e in latest.values()]
    return {"value": rating_number(sum(values) / len(values)), "raters": len(latest), "date": max(e["date"] for e in latest.values())}


def tier_of(v):
    """A rating's category 0-4 (edges 2.5, 4.5, 6.5, 8.5; ratings.js tierOf, AutoCroissant tts_ratings.tier_of)."""
    return max(0, min(4, int((v - 0.5) // 2)))


def rater_shown(e, people, by_login, row_of=None):
    """A Card Ratings.json entry as the site shows it: a login credited by another name keeps it as login. row_of:
    login_rows()', else credit()."""
    shown = e["by"] if e["by"] == "group" else (row_of or (lambda k: credit(k, people, by_login)))(e["by"]) or e["by"]
    return {**e, "by": shown, "login": e["by"]} if shown != e["by"] else {**e}


def apply_ratings(cards, ratings, archived, people, by_login, row_of=None):
    """Card Ratings.json onto the cards: e["ratings"] = [{date, scale, value, by, source, login?}], oldest first; by stays
    "group", a login becomes its row (row_of: login_rows(), else credit()), then kept as login (the page's own re-rating). A duplicate's
    go to its original. A name matching an archived row goes to the card it was renamed to (renamedId), else onto the
    row (changelog.json). -> {"entries", "cards", "archived", "unmatched": [name]}"""
    live, by_id = {}, {e["id"]: e for e in cards}
    for e in cards:
        live.setdefault(card_key(e["key"]), e)
    arch = {card_key(r["card"]): r for r in archived}
    got, rows, counts = {}, {id(r) for r in archived}, {"entries": 0, "cards": 0, "archived": 0, "unmatched": []}
    for key, (name, entries) in ratings.items():
        target = live.get(key)
        if target is not None and target.get("dup") in by_id:
            target = by_id[target["dup"]]              # a duplicate's ratings are its original's, as its page shows
        if target is None and key in arch:
            target = by_id.get(arch[key].get("renamedId")) or arch[key]
        if target is None:
            counts["unmatched"].append(name)
            continue
        target.setdefault("ratings", []).extend(rater_shown(e, people, by_login, row_of) for e in entries)
        got[id(target)] = target
        counts["entries"] += len(entries)
    for target in got.values():
        target["ratings"] = rating_order(target["ratings"])
        counts["archived" if id(target) in rows else "cards"] += 1
    return counts


def created_ts(e):
    """A card's created day as epoch seconds (noon UTC), else its first upload (fs), else None."""
    if e.get("created"):
        return datetime.fromisoformat(e["created"]).replace(hour=12, tzinfo=timezone.utc).timestamp()
    return e.get("fs")


def apply_created(cards, created):
    """created (UTC day) per card: the earliest evidence, its first Discord post (the file) or its first upload (fs); a hand
    entry wins. createdFrom says which; createdAbout marks a date an open ruling may still move. Logs, never fails. The
    bot keeps the same rule (AutoCroissant card_edits.CardDates.created) with its own first upload: the earliest version
    its database holds."""
    used, later, today = set(), 0, datetime.now(timezone.utc).date().isoformat()
    for e in cards:
        found = created.get(card_key(e["key"]))
        upload = datetime.fromtimestamp(e["fs"], timezone.utc).date().isoformat() if e.get("fs") else None
        if found:
            used.add(card_key(e["key"]))
        if found and (found["from"] == "hand" or not upload or found["date"] <= upload):
            e["created"], e["createdFrom"] = found["date"], found["from"]
            if found.get("provisional"):
                e["createdAbout"] = True
        elif upload:
            e["created"], e["createdFrom"] = upload, "git"
            later += bool(found)
    dated = [e for e in cards if e.get("created")]
    by = {f: sum(1 for e in dated if e["createdFrom"] == f) for f in CREATED_FROM}
    log(f"created: {len(dated)} of {len(cards)} cards dated ({by['discord']} first Discord post, {by['git']} first upload, "
        f"{by['hand']} by hand; {sum(1 for e in dated if e.get('createdAbout'))} provisional)")
    if later:
        log(f"created: {later} dates in {CREATED_PATH} are after the card's first upload; the upload's used")
    missing = sorted(e["key"] for e in dated if card_key(e["key"]) not in created)
    if created and missing:
        log(f"created: {len(missing)} cards not in {CREATED_PATH}, dated by their first upload until it has them "
            f"(AutoCroissant's `python -m commands.discord_edits created`): {', '.join(missing[:10])}")
    if len(created) > len(used):
        log(f"created: {len(created) - len(used)} names in {CREATED_PATH} match no card: "
            f"{', '.join(sorted(k for k in created if k not in used)[:10])}")
    future = sorted(e["key"] for e in dated if e["created"] > today)
    if future:
        warn(f"{CREATED_PATH}: {len(future)} dates in the future: {', '.join(future[:10])}")


def folder_series(path):
    """A creature's series as its folder gives it (AutoCroissant CardClassifier), else None. Not the database's: that
    can hold a Discord-only series, which reverting to would drop from Card Edits.json."""
    parts = (path or "").split("/")
    return parts[len(parts) - 3].lower() if parts[0] == "Creatures" and len(parts) >= 4 else None


def apply_edits(entry, edits, psd_sha=None, shown=None):
    """All fields but aliases and dup_of (applied later). psd_sha: the PSD's blob in the tree, to tell a stale _psd verdict.
    shown: psd_edit.shown_name, None when unknown."""
    found = edits.get(card_key(entry["key"]))
    if not found:
        return
    fields, meta = found
    verdict = meta.get("_psd") or {}             # counts only while the PSD it was tried on (or baked) is the tree's
    current = bool(psd_sha and verdict.get("psd") and psd_sha.startswith(verdict["psd"]))
    if verdict.get("state") == "baked" and current and verdict.get("reason"):
        entry["baked"] = verdict["reason"]        # the bot's bake of this PSD, its flags with it (kept alone once no field is left)
    if not fields:
        return
    orig = {}
    for field, value in fields.items():
        if field in ("aliases", "dup_of"):
            continue
        orig[field] = folder_series(entry.get("psd")) if field == "series" else entry.get(field)
        entry[field] = list(value) if isinstance(value, list) else value
    if fields.get("creatures"):                  # creature 1 is the card's stats
        for k in STAT_KEYS:
            if k not in fields:
                orig.setdefault(k, entry.get(k))
                entry[k] = fields["creatures"][0].get(k)
    entry["edited"] = sorted(fields)
    entry["orig"] = orig                          # PSD values
    # awaiting a bake, as psd_edit.classify sees it
    def waits(f):
        if f == "name":
            return shown is not None and printed(fields[f]) != shown
        if f == "ability":
            return ability_text(fields[f]) != ability_text(orig.get(f))
        if f == "types":                          # any order and spelling, as psd_edit.same_types
            return type_keys(fields[f]) != type_keys(orig.get(f))
        return entry[f] != orig.get(f)
    pending = sorted(f for f in fields if f in PSD_FIELDS and fields[f] is not None and waits(f))
    if pending:
        entry["pending"] = pending
    tried = verdict.get("for")                    # a refusal: while the refused values are unchanged too
    if verdict.get("state") == "refused" and tried and all(fields.get(f) == v for f, v in tried.items()) and current:
        entry["refused"] = verdict.get("reason") or "refused"
    if fields.get("aliases"):
        entry["webAliases"] = list(fields["aliases"])
    if meta.get("_by"):
        entry["editBy"] = meta["_by"]
    bot = sorted(f for f in fields if f in meta.get(BOT_FIELDS, ()))
    if bot:                                       # not the editor's: credited to nobody, or to their _credit editor
        entry["botEdited"] = bot
    by_field = {f: [meta[CREDIT][f]["_by"], meta[CREDIT][f]["_at"]] for f in bot if f in meta.get(CREDIT, {})}
    if by_field:
        entry["fieldBy"] = by_field
    if meta.get("_at"):
        entry["editAt"] = meta["_at"]
    if fields.get("problems_ok"):
        entry["problems"] = []
    else:
        answered = tuple(p for field in fields for p in FIXED_BY.get(field, ()))
        entry["problems"] = [p for p in entry.get("problems") or [] if not p.startswith(answered)] if answered else entry.get("problems")


def parse_admins():
    path = os.path.join(REPO, ADMINS_PATH)
    if not os.path.exists(path):
        return []
    return [l.strip() for l in open(path, encoding="utf-8") if l.strip() and not l.strip().startswith("#")]


# ---- profiles (site/profiles/<login>.json) --------------------------------------------------------------
LOGIN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}\Z")          # a GitHub login
PROFILE_MAX_BYTES = 16 * 1024
# the same rules as profile.js (LIMITS, PICKS, ITEM_KINDS): one-line text caps, four card slots, label/value pairs
PROFILE_TEXT = {"motto": 140, "author": 60}
PROFILE_PICKS = {"favourite": "Favourite card", "hated": "Hated card", "favouriteItem": "Favourite item", "hatedItem": "Hated item"}
ITEM_KINDS = {"item", "aux item", "nme"}
PROFILE_PAIRS, PAIR_LABEL, PAIR_VALUE, DECK_CODE = 12, 40, 200, 2000
PROFILE_FIELDS = {"login", "series", "deck", "facts", "updated", *PROFILE_TEXT, *PROFILE_PICKS}


def decode_deck(code):
    """A deck-builder share code (deck.js encode: base64url of {"n", "c", "f"}) -> {"name", "cards", "field"} as deck.js
    decode reads it, or None. Strict base64 like atob; a hand with no cards and no field is None too (nothing to show)."""
    try:
        o = json.loads(base64.b64decode(code.replace("-", "+").replace("_", "/") + "=" * (-len(code) % 4), validate=True).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(o, dict):
        return None
    cards = [str(c) for c in o["c"]] if isinstance(o.get("c"), list) else []
    field = str(o["f"]) if o.get("f") else None
    return {"name": str(o.get("n") or "Shared hand"), "cards": cards, "field": field} if cards or field else None


def one_line(value):
    """A string as one line with single spaces; None for anything else."""
    return " ".join(value.split()) if isinstance(value, str) else None


def clean_profile(raw, stem, cards, people):
    """One profile file's JSON -> (the fields the site shows, notes). None when the file can't be used at all; a bad field
    is dropped with a note. stem: the file name without .json; cards: visible cards by id; people: the author names on cards."""
    if not isinstance(raw, dict):
        return None, ["not a JSON object"]
    login = raw.get("login")
    if not isinstance(login, str) or not LOGIN_RE.match(login):
        return None, ['"login" must be a GitHub login']
    if login != stem:                             # the website reads and removes the file by the login's exact spelling
        return None, [f"login {login!r} doesn't match the file name {stem!r}"]
    p, notes = {"login": login}, []
    for field, cap in PROFILE_TEXT.items():
        if raw.get(field) is None:
            continue
        text = one_line(raw[field])
        if text is None or len(text) > cap:
            notes.append(f"{field}: one line of at most {cap} characters, dropped")
        elif text:
            p[field] = text
    if "author" in p:                             # the name as cards show it, matched without case
        known = next((name for name in people if name.lower() == p["author"].lower()), None)
        if known:
            p["author"] = known
        else:
            notes.append(f"author {p.pop('author')!r} isn't a name cards are credited to, dropped")
    series = one_line(raw.get("series"))
    if series:
        if series in {c.get("series") for c in cards.values()}:
            p["series"] = series
        else:
            notes.append(f"series {series!r} isn't a known series, dropped")
    for field, label in PROFILE_PICKS.items():
        cid = raw.get(field)
        if cid is None:
            continue
        card = cards.get(cid) if isinstance(cid, str) else None
        if card is None:
            notes.append(f"{label} {cid!r} isn't a card, dropped")
        elif field.endswith("Item") and card["type"] not in ITEM_KINDS:
            notes.append(f"{label} {card['name']} isn't an item, dropped")
        else:
            p[field] = cid
    deck = raw.get("deck")
    if deck is not None:
        if isinstance(deck, str) and len(deck) <= DECK_CODE and decode_deck(deck):
            p["deck"] = deck
        else:
            notes.append("deck isn't a deck-builder share code, dropped")
    facts = raw.get("facts")
    if facts is not None:
        rows = [(one_line(f.get("label")), one_line(f.get("value"))) for f in facts if isinstance(f, dict)] if isinstance(facts, list) else []
        good = [{"label": l, "value": v} for l, v in rows if l and v and len(l) <= PAIR_LABEL and len(v) <= PAIR_VALUE]
        if not isinstance(facts, list) or len(good) != len(facts) or len(good) > PROFILE_PAIRS:
            notes.append(f"facts: up to {PROFILE_PAIRS} label/value pairs ({PAIR_LABEL}/{PAIR_VALUE} characters), the bad ones dropped")
        if good[:PROFILE_PAIRS]:
            p["facts"] = good[:PROFILE_PAIRS]
    if isinstance(raw.get("updated"), str) and raw["updated"] and len(raw["updated"]) <= 40:
        p["updated"] = raw["updated"]
    unknown = sorted(str(k) for k in set(raw) - PROFILE_FIELDS)
    if unknown:
        notes.append(f"unknown fields ignored: {', '.join(unknown)}")
    return p, notes


def read_profiles(cards, people):
    """site/profiles/*.json -> the profiles the site shows, by login. Warns, never fails: a bad file is skipped.
    cards: visible ones only, so the pages and the counts match the site's."""
    folder = os.path.join(REPO, PROFILES_DIR)
    if not os.path.isdir(folder):
        return []
    visible = {c["id"]: c for c in cards if not c.get("hidden")}
    out = {}
    for name in sorted(os.listdir(folder)):
        rel, path = f"{PROFILES_DIR}/{name}", os.path.join(folder, name)
        if not name.endswith(".json") or not os.path.isfile(path):
            continue
        if os.path.getsize(path) > PROFILE_MAX_BYTES:
            log(f"warning: {rel}: over {PROFILE_MAX_BYTES // 1024} KB, skipped")
            continue
        try:
            raw = json.load(open(path, encoding="utf-8"))
        except (ValueError, OSError) as e:
            log(f"warning: {rel} can't be read as JSON, skipped: {e}")
            continue
        p, notes = clean_profile(raw, name[:-5], visible, people)
        for note in notes:
            log(f"warning: {rel}: {note}")
        if p is None:
            continue
        if p["login"].lower() in out:
            log(f"warning: {rel}: another file already has this login, skipped")
            continue
        out[p["login"].lower()] = p
    if out:
        log(f"profiles: {len(out)} from {PROFILES_DIR}/")
    return [out[k] for k in sorted(out)]


# ---- decks (site/decks/<owner>/<slug>.json) -----------------------------------------------------------------
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}$")                 # the file name: decks.js slugOf(name)
DECK_MAX_BYTES = 16 * 1024
DECK_NAME, DECK_DESC, DECK_CARDS = 80, 500, 40                     # same limits as decks.js
DECK_KDF = {"name": "PBKDF2", "hash": "SHA-256"}                    # a private deck's key derivation (decks.js encrypt)
DECK_ITER_MAX = 5_000_000                                           # PBKDF2 rounds a browser may be asked for
DECK_SALT, DECK_IV, DECK_TAG = 16, 12, 16                           # bytes
DECK_UPDATED_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\Z")      # edit.js's stamp; anything else is ignored (sorts last)
DECK_FIELDS = {"v", "owner", "name", "description", "cards", "field", "updated"}
PRIVATE_FIELDS = {"v", "owner", "private", "kdf", "iv", "data", "updated"}


def b64_bytes(value, size=None):
    """Standard base64 (padding optional) -> bytes; None when it isn't, or isn't `size` bytes."""
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", value):
        return None
    body = value.rstrip("=")
    try:
        raw = base64.b64decode(body + "=" * (-len(body) % 4), validate=True)
    except ValueError:
        return None
    return raw if size is None or len(raw) == size else None


def clean_deck(raw, folder, slug, cards):
    """One deck file's JSON -> (the entry decks.json gets, notes). None when the file can't be used; a card that isn't
    one is dropped with a note. folder: the owner folder; slug: the file name without .json; cards: visible cards by id."""
    if not isinstance(raw, dict):
        return None, ["not a JSON object"]
    if type(raw.get("v")) is not int or raw["v"] != 1:              # not a bool: True == 1
        return None, ['"v" must be 1']
    owner = raw.get("owner")
    if not isinstance(owner, str) or not LOGIN_RE.match(owner):
        return None, ['"owner" must be a GitHub login']
    if owner.lower() != folder.lower():
        return None, [f"owner {owner!r} doesn't match the folder {folder!r}"]
    if not SLUG_RE.match(slug):
        return None, [f"file name {slug!r} isn't a slug (lowercase letters, digits and -)"]
    notes = []
    if owner != folder:                           # the path is what the website edits: its spelling wins
        notes.append(f"owner {owner!r} is spelled {folder!r} in the folder, which is used")
        owner = folder
    updated = raw.get("updated", "")
    if not (isinstance(updated, str) and (updated == "" or DECK_UPDATED_RE.match(updated))):
        notes.append(f'"updated" {str(updated)[:40]!r} isn\'t a date like 2026-10-21T13:00:00Z, ignored')
        updated = ""
    if raw.get("private") is True:                # only the owner, file name and date are in clear; the shapes are checked, not the content
        kdf = raw.get("kdf")
        if not (isinstance(kdf, dict) and kdf.get("name") == DECK_KDF["name"] and kdf.get("hash") == DECK_KDF["hash"]
                and type(kdf.get("iter")) is int and 1 <= kdf["iter"] <= DECK_ITER_MAX and b64_bytes(kdf.get("salt"), DECK_SALT)):
            return None, [f'private deck: "kdf" must be PBKDF2 / SHA-256, iter 1 to {DECK_ITER_MAX}, salt {DECK_SALT} bytes in base64']
        if not b64_bytes(raw.get("iv"), DECK_IV):
            return None, [f'private deck: "iv" must be {DECK_IV} bytes in base64']
        data = b64_bytes(raw.get("data"))
        if data is None or len(data) <= DECK_TAG:
            return None, ['private deck: "data" must be AES-GCM ciphertext in base64']
        unknown = sorted(str(k) for k in set(raw) - PRIVATE_FIELDS)
        if unknown:
            notes.append(f"unknown fields ignored: {', '.join(unknown)}")
        kdf = {"name": kdf["name"], "hash": kdf["hash"], "iter": kdf["iter"], "salt": kdf["salt"]}
        return {"owner": owner, "slug": slug, "private": True, "kdf": kdf, "iv": raw["iv"], "data": raw["data"], "updated": updated}, notes
    name = one_line(raw.get("name"))
    if not name or len(name) > DECK_NAME:
        return None, [f'"name" must be one line of 1 to {DECK_NAME} characters']
    desc = raw["description"].strip() if isinstance(raw.get("description"), str) else ""
    if raw.get("description") is not None and (not isinstance(raw["description"], str) or len(desc) > DECK_DESC):
        notes.append(f"description: text of at most {DECK_DESC} characters, dropped")
        desc = ""
    ids_raw = raw.get("cards", [])
    if not isinstance(ids_raw, list) or len(ids_raw) > DECK_CARDS:
        return None, [f'"cards" must be a list of up to {DECK_CARDS} card ids']
    ids, bad = [], []
    for cid in ids_raw:
        (ids if isinstance(cid, str) and cid in cards and cid not in ids else bad).append(cid if isinstance(cid, str) else repr(cid))
    if bad:
        notes.append(f"{len(bad)} card(s) dropped (not a card, or twice): {', '.join(bad)}")
    field = raw.get("field")
    if field is not None and not (isinstance(field, str) and field in cards):
        notes.append(f"field {field!r} isn't a card, dropped")
        field, bad = None, bad + [field]
    if field in ids:                              # listed once, as the field card
        ids.remove(field)
        notes.append(f"field {field!r} is in \"cards\" too, listed once")
    unknown = sorted(str(k) for k in set(raw) - DECK_FIELDS)
    if unknown:
        notes.append(f"unknown fields ignored: {', '.join(unknown)}")
    return {"owner": owner, "slug": slug, "name": name, "description": desc, "cards": ids, "dropped": len(bad), "field": field,
            "updated": updated, "n": len(ids) + (1 if field else 0)}, notes


# ---- password sign-in (site/logins/<login>.json) ------------------------------------------------------------
LOGIN_MAX_BYTES = 4 * 1024
LOGIN_KDF = "PBKDF2-SHA-256"                                        # login.js KDF
LOGIN_ITER = (1_000_000, 5_000_000)                                 # login.js MIN_ITER, MAX_ITER
LOGIN_SALT, LOGIN_IV, LOGIN_CT = 16, 12, 1024                       # bytes; ct: the AES-GCM tag (16) plus a token
LOGIN_FIELDS = ("v", "login", "kdf", "iterations", "salt", "iv", "ct", "at")


def clean_login(raw, stem):
    """One password file's JSON -> (the entry data/logins/ gets, notes); None when it can't be used (login.js checkFile)."""
    if not isinstance(raw, dict):
        return None, ["not a JSON object"]
    if type(raw.get("v")) is not int or raw["v"] != 1:
        return None, ['"v" must be 1']
    login = raw.get("login")
    if not isinstance(login, str) or not LOGIN_RE.match(login):
        return None, ['"login" must be a GitHub login']
    if login != stem:                             # the file name is the login, exactly: only its owner writes it
        return None, [f"login {login!r} doesn't match the file name {stem!r}"]
    if raw.get("kdf") != LOGIN_KDF:
        return None, [f'"kdf" must be {LOGIN_KDF}']
    if type(raw.get("iterations")) is not int or not LOGIN_ITER[0] <= raw["iterations"] <= LOGIN_ITER[1]:
        return None, [f'"iterations" must be {LOGIN_ITER[0]} to {LOGIN_ITER[1]}']
    if not b64_bytes(raw.get("salt"), LOGIN_SALT):
        return None, [f'"salt" must be {LOGIN_SALT} bytes in base64']
    if not b64_bytes(raw.get("iv"), LOGIN_IV):
        return None, [f'"iv" must be {LOGIN_IV} bytes in base64']
    ct = b64_bytes(raw.get("ct"))
    if ct is None or not DECK_TAG < len(ct) <= LOGIN_CT:
        return None, [f'"ct" must be AES-GCM ciphertext in base64 (at most {LOGIN_CT} bytes)']
    notes, entry = [], {k: raw[k] for k in LOGIN_FIELDS if k != "at"}
    at = raw.get("at")
    if at is not None and not (isinstance(at, str) and DECK_UPDATED_RE.match(at)):
        notes.append(f'"at" {str(at)[:40]!r} isn\'t a date like 2026-10-23T01:45:00Z, ignored')
    elif at:
        entry["at"] = at
    unknown = sorted(str(k) for k in set(raw) - set(LOGIN_FIELDS))
    if unknown:
        notes.append(f"unknown fields ignored: {', '.join(unknown)}")
    return entry, notes


def read_logins():
    """site/logins/*.json -> the password files the site publishes, by login. Warns, never fails: a bad file is skipped."""
    folder = os.path.join(REPO, LOGINS_DIR)
    out, clash = {}, set()
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        rel, path = f"{LOGINS_DIR}/{name}", os.path.join(folder, name)
        if not name.endswith(".json") or not os.path.isfile(path):
            continue
        try:
            if os.path.getsize(path) > LOGIN_MAX_BYTES:
                log(f"warning: {rel}: over {LOGIN_MAX_BYTES // 1024} KB, skipped")
                continue
            raw = json.load(open(path, encoding="utf-8"))
        except (ValueError, OSError) as e:
            log(f"warning: {rel} can't be read as JSON, skipped: {e}")
            continue
        entry, notes = clean_login(raw, name[:-5])
        for note in notes:
            log(f"warning: {rel}: {note}")
        if entry is None:
            continue
        key = entry["login"].lower()
        if key in out or key in clash:            # names differing only in case: none is copied, the sign-in asks GitHub for each
            log(f"warning: {rel}: another file has this login in another case: neither is published (an admin should remove the wrong one)")
            clash.add(key)
            out.pop(key, None)
            continue
        out[key] = entry
    if out:
        log(f"passwords: {len(out)} from {LOGINS_DIR}/")
    return [out[k] for k in sorted(out)]


def write_logins(folder, logins):
    """data/logins/<login in lowercase>.json per password file (the sign-in fetches the typed login, any case)."""
    if not logins:
        return
    os.makedirs(folder, exist_ok=True)
    for entry in logins:
        with open(os.path.join(folder, f"{entry['login'].lower()}.json"), "w", encoding="utf-8") as fh:
            json.dump(entry, fh, separators=(",", ":"), sort_keys=True)


def read_decks(cards):
    """site/decks/<owner>/*.json -> (public decks, private decks) for data/decks.json, newest first. Warns, never fails:
    a bad file is skipped. cards: hands are resolved against the visible ones, so the pages and the counts match the site's."""
    folder = os.path.join(REPO, DECKS_DIR)
    public, private, seen = [], [], set()
    visible = {c["id"]: c for c in cards if not c.get("hidden")}
    for owner in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not os.path.isdir(os.path.join(folder, owner)):
            continue
        for name in sorted(os.listdir(os.path.join(folder, owner))):
            rel, path = f"{DECKS_DIR}/{owner}/{name}", os.path.join(folder, owner, name)
            if not name.endswith(".json") or not os.path.isfile(path):
                continue
            if os.path.getsize(path) > DECK_MAX_BYTES:
                log(f"warning: {rel}: over {DECK_MAX_BYTES // 1024} KB, skipped")
                continue
            try:
                raw = json.load(open(path, encoding="utf-8"))
            except (ValueError, OSError) as e:
                log(f"warning: {rel} can't be read as JSON, skipped: {e}")
                continue
            d, notes = clean_deck(raw, owner, name[:-5], visible)
            for note in notes:
                log(f"warning: {rel}: {note}")
            if d is None:
                continue
            if (d["owner"].lower(), d["slug"]) in seen:
                log(f"warning: {rel}: another file already has this deck, skipped")
                continue
            seen.add((d["owner"].lower(), d["slug"]))
            (private if d.pop("private", False) else public).append(d)
    for group in (public, private):
        group.sort(key=lambda d: (d["owner"].lower(), d["slug"]))
        group.sort(key=lambda d: d["updated"], reverse=True)
    if public or private:
        log(f"decks: {len(public)} public, {len(private)} private from {DECKS_DIR}/")
    return public, private


def deck_text(d, by_id):
    """A public deck's link-preview description: the hand in words ("7 creatures, 10 items, field card Deepnest"), then
    the deck's own description."""
    kinds = {}
    for c in (by_id[i] for i in d["cards"]):
        kinds[kind_of(c)] = kinds.get(kind_of(c), 0) + 1
    order = list(KIND_PLURAL)
    parts = [f"{n} {kind_word(k, n)}" for k, n in sorted(kinds.items(), key=lambda kv: (order.index(kv[0]) if kv[0] in order else len(order), kv[0]))]
    if d["field"]:
        parts.append(f"field card {by_id[d['field']]['name']}")
    return clip("\n".join(filter(None, [", ".join(parts) or "An empty hand", d["description"]])))


def profile_text(p, n_cards, by_id, contrib="", cards_line=""):
    """The profile page's link-preview description; contrib: the person's contrib_text line, if they have contributions;
    cards_line: their cards_text line, if they have cards."""
    lines = [p["motto"]] if p.get("motto") else []
    if p.get("author"):
        lines.append(f"{n_cards} card{'' if n_cards == 1 else 's'} by {p['author']}" + (f" · {p['series']}" if p.get("series") else ""))
    elif p.get("series"):
        lines.append(p["series"])
    if contrib:
        lines.append(contrib)
    picks = [f"{label}: {by_id[p[k]]['name']}" for k, label in PROFILE_PICKS.items() if p.get(k) in by_id]
    if picks:
        lines.append(" · ".join(picks))
    deck = decode_deck(p["deck"]) if p.get("deck") else None
    if deck:
        lines.append(f"Featured hand: {(one_line(deck['name']) or 'Shared hand')[:60]}")
    return person_text(lines, cards_line) or f"{p['login']}'s profile"


def source_time():
    """The built commit's committer date (ISO), "" outside git."""
    try:
        return subprocess.run(["git", "-C", REPO, "show", "-s", "--format=%cI", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def build_branch():
    """Branch the Edit button commits to."""
    if os.environ.get("GITHUB_REF_NAME"):
        return os.environ["GITHUB_REF_NAME"]
    try:
        out = subprocess.run(["git", "-C", REPO, "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        return out if out and out != "HEAD" else "main"
    except (OSError, subprocess.CalledProcessError):
        return "main"


# ---- git history: one `git log --raw` over card PNGs, PSDs and Card Edits.json ----------------------------
HISTORY_REPO = REPO                           # where git log runs (a test points it at a full-history clone)
EDIT_PATHS = {EDITS_PATH, "MDW/Card Edits.json"}       # the website's edit batches, after and before the 2026-10-20 move
HISTORY_PATHS = ("*.png", "*.PNG", "*.psd", "*.PSD", *sorted(EDIT_PATHS))
BOT_AUTHOR = "AutoCroissant"                  # the bot's commits (AutoCroissant git_commit.AUTHOR) and `_by` stamps: an editor's batch, already counted
NOREPLY_RE = re.compile(r"^(?:\d+\+)?([^@+]+)@users\.noreply\.github\.com$")   # GitHub's private email carries the login (old form without the id too)
OLD_CARD_FOLDERS = ("Auxillary/",)            # folder spellings before a rename: the history has them, the tree doesn't
RULE_PARTS = ("Rules", "Rulebook")            # rulebook pages are not cards
EDIT_BY = "Edit-by"                           # a bake commit's trailer, one per editor whose edit it printed (AutoCroissant card_bake)
TRAILER_RE = re.compile(r"^[^\x00-\x1f\x7f]{1,100}$")       # an Edit-by value: a login, or a Discord name (discord:<name>)
RECOMPRESSED = "Recompressed"                 # a bot commit's trailer, one per PNG it only recompressed losslessly (AutoCroissant
                                              # card_guards.RECOMPRESSED, png_recompress): the same image, so no new version
# committer time (%ct), as the bot dates versions (commits API committer.date; card_history LOG_FORMAT): a rebased commit's
# author time can be weeks earlier (Patch 1.9: authored 2026-05-28, committed 2026-06-17), and then no date matches;
# %aN/%aE through .mailmap, as the bot's %aN
HISTORY_FORMAT = (f"%x01%H%x09%ct%x09%aN%x09%aE%x09%s%n%x02%(trailers:key={EDIT_BY},valueonly,separator=%x1f)"
                  f"%n%x03%(trailers:key={RECOMPRESSED},valueonly,separator=%x1f)")


def unquote_path(path):
    """A path as `git -c core.quotePath=false log --raw` prints it: quoted only when it has unusual characters."""
    if path.startswith('"'):
        return path[1:-1].encode("latin-1", "backslashreplace").decode("unicode_escape").encode("latin-1").decode("utf-8", "replace")
    return path


def parse_history(text):
    """`git log --raw --no-renames --no-abbrev --format=HISTORY_FORMAT` -> commits newest first: (sha, committer time, author
    name, author email, subject, [(status, old blob, new blob, path), ...], [Edit-by values: logins, Discord names]).
    A bot commit's change of a PNG its Recompressed trailers name is left out: the same image, losslessly smaller."""
    commits = []
    for chunk in text.split("\x01")[1:]:
        head, _, body = chunk.partition("\n")
        sha, ts, name, email, subject = (head.split("\t", 4) + [""] * 5)[:5]
        entries, editors, same = [], [], set()
        for line in body.splitlines():
            if line.startswith("\x02"):              # the Edit-by trailers' values
                editors = [v.strip() for v in line[1:].split("\x1f") if TRAILER_RE.match(v.strip())]
                continue
            if line.startswith("\x03"):              # the Recompressed trailers' values: paths
                same = {v.strip() for v in line[1:].split("\x1f") if v.strip()}
                continue
            if not line.startswith(":"):
                continue
            meta, _, path = line.partition("\t")
            parts = meta.split()
            if len(parts) >= 5:
                entries.append((parts[4], parts[2], parts[3], unquote_path(path)))
        if same and name.lower() == BOT_AUTHOR.lower():
            entries = [e for e in entries if not (e[0] == "M" and e[3] in same)]
        commits.append((sha, int(ts or 0), name, email, subject, entries, editors))
    return commits


def git_history():
    """Every commit that touched a card PNG, a PSD or Card Edits.json (parse_history's shape). Commit metadata and trees
    only, so CI's blob:none clone has it all; None in a shallow clone, which has no history to read."""
    shallow = subprocess.run(["git", "-C", HISTORY_REPO, "rev-parse", "--is-shallow-repository"], capture_output=True, text=True).stdout.strip()
    if shallow == "true":
        log("warning: shallow clone, so no image versions and no commit counts (git fetch --unshallow --filter=blob:none to get them)")
        return None
    out = subprocess.run(["git", "-C", HISTORY_REPO, "-c", "core.quotePath=false", "log", "--raw", "--no-renames", "--no-abbrev",
                          f"--format={HISTORY_FORMAT}", "--", *HISTORY_PATHS], capture_output=True, text=True, check=True).stdout
    return parse_history(out)


# ---- image versions ----------------------------------------------------------------------------------
def image_versions(paths, commits):
    """{current path: [(commit, path then), ...] newest first, one per content change}, commits as
    (sha, committer time, author, subject). Renames are followed, so folder moves keep their history: exact ones (same blob
    deleted and added in one commit), and a move that also changed the image when that commit deleted exactly one PNG
    of the same file name (alnum, any case) and added only this one. None without history."""
    if commits is None:
        return None
    tracked = {p: p for p in paths}               # path at the commit being read -> current path
    versions = {p: [] for p in paths}
    file_name = lambda p: alnum(os.path.splitext(os.path.basename(p))[0])
    for sha, ts, author, _, subject, entries, _ in commits:
        commit = (sha, ts, author, subject)
        adds, dels, mods = [], {}, []
        for status, old, new, path in entries:
            if not path.lower().endswith(".png"):
                continue
            if status == "A":
                adds.append((path, new))
            elif status == "D":
                dels.setdefault(old, []).append(path)
            elif status == "M":
                mods.append(path)
        for path in mods:
            if path in tracked:
                versions[tracked[path]].append((commit, path))
        changed = defaultdict(list)               # added with an image no delete here had, by file name
        for path, blob in sorted(adds, key=lambda a: a[0] not in tracked):     # tracked ones claim exact renames first
            renamed_from = dels.get(blob)
            if renamed_from:                      # moved without changing: keep following it under its old name
                old = renamed_from.pop(0)
                if path in tracked:
                    tracked[old] = tracked.pop(path)
            else:
                changed[file_name(path)].append(path)
        gone = defaultdict(list)                  # deleted here and no exact rename's source
        for p in (p for ps in dels.values() for p in ps):
            gone[file_name(p)].append(p)
        for name, added in changed.items():
            for path in added:
                if path not in tracked:
                    continue
                key = tracked.pop(path)
                versions[key].append((commit, path))
                if len(added) == 1 and len(gone.get(name, ())) == 1:
                    tracked[gone[name][0]] = key  # moved and changed: older versions under its old name
    return versions


# ---- revisions (the person pages: image changes after the upload) -------------------------------------------------
MASS_PASS = 20                                # a commit changing more card images than this is a mass pass (a template or token pass)


def commit_keys(row, people, by_login, row_of=None):
    """A commit's (parse_history row) credited names: who() of its author; a bot commit (BOT_AUTHOR) -> the row of each
    Edit-by login that isn't a discord: name (row_of: login_rows(), else credit()), else the login; [] without trailers."""
    _, _, name, email, _, _, editors = row
    if name.lower() == BOT_AUTHOR.lower():
        row_of = row_of or (lambda k: credit(k, people, by_login))
        return list(dict.fromkeys(row_of(e) or e for e in editors if not is_discord(e)))
    key = who(name, email, people, by_login)
    return [key] if key else []


def mass_passes(found, by_png=None, skip=()):
    """{sha} of the commits in more than MASS_PASS cards' image versions (by_png: a PNG with only skip's ids, a rulebook
    page, doesn't count)."""
    rule = lambda png: bool(by_png and by_png.get(png)) and all(e["id"] in skip for e in by_png[png])
    size = Counter(sha for png, vs in found.items() if not rule(png) for (sha, *_), _ in vs)
    return {sha for sha, n in size.items() if n > MASS_PASS}


def card_revisions(found, by_png, commits, people, by_login, skip=(), row_of=None):
    """{card id: {credited name: image changes after its first upload}} (found: image_versions, newest first, so its last
    row is the upload): mass passes left out, credited by commit_keys(); every card id of the PNG gets the counts (a
    duplicate's are its original's), skip's (rulebook pages) none. None without history."""
    if found is None:
        return None
    mass, rows, out = mass_passes(found, by_png, skip), {c[0]: c for c in commits or ()}, {}
    for png, vs in found.items():
        got = Counter(k for (sha, *_), _ in vs[:-1] if sha not in mass and sha in rows for k in commit_keys(rows[sha], people, by_login, row_of))
        if got:
            for e in by_png.get(png, ()):
                if e["id"] not in skip:
                    out[e["id"]] = dict(sorted(got.items(), key=lambda kv: (-kv[1], kv[0].lower())))
    return out


# ---- changelog (data/changelog.json: the Changes page's Changelog and Database edits tabs) ---------------------------
# The card sync's events come from CARD_DATA_DIR's changelog/ (AutoCroissant docs/Campaigns/DATA_BUILD_ACTION.md §12.1);
# without it the tabs show no events. The publish batches and the archived cards: git history and db/'s old_stats.
CHANGELOG_DAYS = 180
EVENT_KINDS = {"new", "changed", "art", "reparse", "moved", "renamed", "archived", "restored", "edited", "authors", "restore"}   # AutoCroissant changelog.KINDS
EVENT_KEYS = ("seq", "at", "build", "card_commit", "commit", "by", "edit_by", "kind", "card", "title", "card_type", "stars", "path",
              "from_path", "fields", "verdict", "buffs", "nerfs", "renamed_to", "moved_to", "restored_from")    # what the tabs read; blob and the rest stay in db/
PUSH_KEYS = ("after", "before", "by", "at")
AUTHOR_PATHS = {AUTHORS_PATH, "MDW/Card Authors.txt"}   # before the 2026-10-20 move too
DISCORD_SUBJECT = "Discord:"                  # the bot's commits of /update_metadata, /mass_replace, /alias (design §11)
is_discord = lambda by: str(by or "").lower().startswith("discord:")   # a discord:<name> stamp or Edit-by, any case
WEBSITE_SUBJECT = "Website edit"              # edit.js publish(): "Website edit: …" / "Website edits: n changes"
BATCH_LINES = 60                              # lines kept per edit batch (Card Authors.txt's first commit credited 813 cards); the rest is `more`


def read_changelog(folder):
    """The card sync's events in seq order (db/changelog/YYYY-MM.jsonl, one per line), and its manifest's build facts;
    (None, None) without the folder. A bad line is skipped, one warning per file."""
    path = os.path.join(folder, "changelog")
    if not os.path.isdir(path):
        return None, None
    events = []
    for name in sorted(os.listdir(path)):
        if not re.fullmatch(r"\d{4}-\d{2}\.jsonl", name):
            continue
        bad = 0
        with open(os.path.join(path, name), encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if not line.strip():
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    e = None
                if isinstance(e, dict) and e.get("kind") in EVENT_KINDS and isinstance(e.get("seq"), int) \
                        and isinstance(e.get("at"), (int, float)) and isinstance(e.get("card", ""), str):
                    events.append(e)
                else:
                    bad += 1
        if bad:
            warn(f"{name}: {bad} changelog lines aren't events, skipped")
    manifest = None
    try:
        with open(os.path.join(folder, "manifest.json"), encoding="utf-8") as fh:
            m = json.load(fh)
        if isinstance(m, dict):
            manifest = {k: m.get(k) for k in ("built_at", "card_commit", "run") if isinstance(m.get(k), str)}
    except (OSError, ValueError) as e:
        log(f"changelog: no manifest ({e})")
    return sorted(events, key=lambda e: e["seq"]), manifest


def site_events(events, id_of, since):
    """The events since `since` as the tabs read them: EVENT_KEYS and the push, with the card's id (`id`, `renamedId`) when
    the site has the card."""
    out = []
    for e in events:
        if e["at"] < since:
            continue
        row = {k: e[k] for k in EVENT_KEYS if e.get(k) not in (None, "", [], {})}
        push = e.get("push")
        if isinstance(push, dict) and isinstance(push.get("after"), str):
            row["push"] = {k: push[k] for k in PUSH_KEYS if push.get(k) not in (None, "")}
        for key, out_key in (("card", "id"), ("renamed_to", "renamedId")):
            found = id_of(e.get(key))
            if found:
                row[out_key] = found
        out.append(row)
    return out


def edit_history():
    """Every commit that touched Card Edits.json or Card Authors.txt (parse_history's shape), newest first; None in a
    shallow clone."""
    shallow = subprocess.run(["git", "-C", HISTORY_REPO, "rev-parse", "--is-shallow-repository"], capture_output=True, text=True).stdout.strip()
    if shallow == "true":
        return None
    out = subprocess.run(["git", "-C", HISTORY_REPO, "-c", "core.quotePath=false", "log", "--raw", "--no-renames", "--no-abbrev",
                          f"--format={HISTORY_FORMAT}", "--", *sorted(EDIT_PATHS | AUTHOR_PATHS)], capture_output=True, text=True, check=True).stdout
    return parse_history(out)


def read_blobs(shas):
    """{blob sha: text} from the history repo. In a blobless clone the missing ones come in one fetch, not one each."""
    shas = sorted({s for s in shas if s and s.strip("0")})
    if not shas:
        return {}
    git, listed = ["git", "-C", HISTORY_REPO], "".join(s + "\n" for s in shas)
    check = subprocess.run(git + ["cat-file", "--batch-check"], input=listed, capture_output=True, text=True,
                           env={**os.environ, "GIT_NO_LAZY_FETCH": "1"})
    missing = [line.split()[0] for line in check.stdout.splitlines() if line.endswith(" missing")]
    if missing:                                   # git's own lazy fetch, batched; on failure cat-file fetches what is left
        subprocess.run(git + ["-c", "fetch.negotiationAlgorithm=noop", "fetch", "-q", "--no-tags", "--no-write-fetch-head",
                              "--recurse-submodules=no", "--filter=blob:none", "--stdin", "origin"],
                       input="".join(s + "\n" for s in missing), capture_output=True, text=True)
    out = subprocess.run(git + ["cat-file", "--batch"], input=listed.encode(), capture_output=True).stdout
    blobs, i = {}, 0
    while i < len(out):
        end = out.index(b"\n", i)
        head = out[i:end].decode().split()
        if len(head) < 3 or head[1] == "missing":
            i = end + 1
            continue
        size = int(head[2])
        blobs[head[0]] = out[end + 1:end + 1 + size].decode("utf-8", "replace")
        i = end + 2 + size
    return blobs


def edits_entries(text):
    """Card Edits.json text -> {card_key: (name as written, {field: value}, (_by, _at))}; {} for anything but its shape.
    The pipeline's verdicts and stamps are not edits."""
    try:
        cards = json.loads(text).get("cards") if text else None
    except (ValueError, AttributeError):
        return {}
    if not isinstance(cards, dict):
        return {}
    return {card_key(name): (name, {f: v for f, v in fields.items() if not f.startswith("_")}, (fields.get("_by"), fields.get("_at")))
            for name, fields in cards.items() if isinstance(fields, dict)}


def edit_changes(before, after):
    """[(card_key, name, {field: [old, new]}, _by)] between two Card Edits.json texts, by name. _by is the new entry's
    when this change stamped it (a _by/_at pair no entry had before), else None: a commit that left the stamp alone, or
    moved it to a renamed key, isn't that editor's."""
    a, b = edits_entries(before), edits_entries(after)
    had = {stamp for _, _, stamp in a.values()}
    out = []
    for key in sorted(set(a) | set(b)):
        old, new = a.get(key, (None, {}, (None, None))), b.get(key, (None, {}, (None, None)))
        fields = {f: [old[1].get(f), new[1].get(f)] for f in sorted(set(old[1]) | set(new[1])) if old[1].get(f) != new[1].get(f)}
        if fields:
            out.append((key, new[0] or old[0], fields, new[2][0] if key in b and new[2] not in had else None))
    return out


def stamp_groups(fields, meta):
    """An entry's edited fields by the stamp they are credited to: {(_by, _at): {field: value}}. Its _by takes the fields
    not in _bot, a _credit editor theirs; the bot's are nobody's."""
    out = {}
    bot, credit = meta.get(BOT_FIELDS, ()), meta.get(CREDIT, {})
    for f, v in fields.items():
        stamp = (credit[f]["_by"], credit[f]["_at"]) if f in credit else None if f in bot else (meta.get("_by"), meta.get("_at"))
        if stamp and stamp[0] and stamp[1] and stamp[0].lower() != BOT_AUTHOR.lower():
            out.setdefault(stamp, {})[f] = v
    return out


def edit_batches(commits, people, by_login, edits, id_of, name_of, since, fields_by=None, row_of=None):
    """
    The database edits, newest first: each commit since `since` that changed a Card Edits.json entry or a Card
    Authors.txt line (a website publish batch, a Discord edit, a commit by hand). The bot's bakes (they write verdicts
    and delete the baked entries; the card sync's changed event shows the bake), a pure move and a change of the file's
    notes are none. A batch is credited to the stamps it wrote (_by), else its Edit-by trailers, else its author.
    Without history: the current file's entries grouped by their _by/_at stamps and _credit stamps (each card's last batch
    only, `stamped`).

    Returns:
        {"available": bool, "batches": [{sha?, at, via: website|discord|git, by: [credited name | discord:<name>], subject?, stamped?,
          cards: [{key, name, id?, fields: {field: [old, new]}}], authors: [{key, name, id?, from, to}],
          people: [[git name, from, to]], more?: lines past BATCH_LINES}]}
    fields_by: filled with {credited name: {field: lines}} over every line (BATCH_LINES doesn't cut it; a Card Authors.txt
    line is "author", but not in the commit that created the file: 813 imported credits); Discord names and the bot
    left out. row_of: login_rows(), else credit().
    """
    def card(key, name):
        row = {"key": name or key, "name": name_of(name or key)}       # name: as written, when the site lacks the card
        found = id_of(name or key)
        if found:
            row["id"] = found
        return row

    def shown(by, discord=False):
        """A Discord name keeps its discord: prefix (the site never links it to a person page), anything else is credited"""
        by = str(by or "")
        if is_discord(by) or discord:
            return "discord:" + by[8:] if is_discord(by) else "discord:" + by
        return (row_of(by) if row_of else credit(by, people, by_login)) or by

    def tally(names, fields):
        if fields_by is None:
            return
        for name in names:
            if name and not is_discord(name) and name.lower() != BOT_AUTHOR.lower():
                mine = fields_by.setdefault(name, {})
                for f in fields:
                    mine[f] = mine.get(f, 0) + 1

    if commits is None:
        groups = {}
        for key, (fields, meta) in edits.items():
            for (by, at), mine in stamp_groups(fields, meta).items():
                groups.setdefault((by, at), {}).setdefault(key, {}).update(mine)
        out = []
        for (by, at), rows in groups.items():
            try:
                ts = int(datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp())
            except ValueError:
                continue
            if ts < since:
                continue
            tally([shown(by)], [f for fields in rows.values() for f in fields])
            out.append({"at": ts, "via": "discord" if is_discord(by) else "website", "by": [shown(by)], "stamped": True,
                        "cards": [{**card(k, None), "fields": {f: [None, v] for f, v in sorted(fields.items())}} for k, fields in sorted(rows.items())],
                        "authors": [], "people": []})
        return {"available": False, "batches": sorted(out, key=lambda b: -b["at"])}
    wanted = [c for c in commits if c[1] >= since]
    blobs = read_blobs([s for c in wanted for _, old, new, path in c[5] if path in EDIT_PATHS | AUTHOR_PATHS for s in (old, new)])
    text = lambda sha: blobs.get(sha, "") if sha and sha.strip("0") else ""
    out = []
    for sha, ts, name, email, subject, entries, editors in wanted:
        discord = subject.startswith(DISCORD_SUBJECT)
        if name.lower() == BOT_AUTHOR.lower() and not discord:
            continue                              # a bake's verdicts
        before = {"e": "", "a": ""}
        after = {"e": "", "a": ""}
        for status, old, new, path in entries:
            kind = "e" if path in EDIT_PATHS else "a" if path in AUTHOR_PATHS else None
            if kind and status in ("M", "D") and not before[kind]:
                before[kind] = text(old)
            if kind and status in ("M", "A") and not after[kind]:
                after[kind] = text(new)
        cards = edit_changes(before["e"], after["e"]) if before["e"] != after["e"] else []
        authors, people_changes = [], []
        if before["a"] != after["a"]:
            names, people_written = {}, {}
            (p0, c0), (p1, c1) = (authors_of(t, None, people_written, names) for t in (before["a"], after["a"]))
            git_name = {k.lower(): k for k in people_written}
            authors = [{**card(k, names.get(k)), "from": c0.get(k), "to": c1.get(k)} for k in sorted(set(c0) | set(c1)) if c0.get(k) != c1.get(k)]
            people_changes = [[git_name.get(k, k), p0.get(k), p1.get(k)] for k in sorted(set(p0) | set(p1)) if p0.get(k) != p1.get(k)]
        if not (cards or authors or people_changes):
            continue
        stamps = sorted({shown(by) for _, _, _, by in cards if by and str(by).lower() != BOT_AUTHOR.lower()}, key=str.lower)
        named = {shown(e, discord) for e in editors}   # in a Discord commit every Edit-by is a Discord name
        by = stamps or sorted(named, key=str.lower) or [who(name, email, people, by_login)]
        tally(by, [f for _, _, fields, _ in cards for f in fields] + ["author"] * (len(authors) if before["a"] else 0))   # the file's creation: an import
        row = {"sha": sha, "at": ts, "subject": subject, "by": by,
               "via": "discord" if discord else "website" if subject.startswith(WEBSITE_SUBJECT) else "git",
               "cards": [{**card(key, written), "fields": fields} for key, written, fields, _ in cards[:BATCH_LINES]],
               "authors": authors[:max(0, BATCH_LINES - len(cards))], "people": people_changes[:max(0, BATCH_LINES - len(cards) - len(authors))]}
        more = len(cards) + len(authors) + len(people_changes) - len(row["cards"]) - len(row["authors"]) - len(row["people"])
        if more:
            row["more"] = more
        out.append(row)
    return {"available": True, "batches": out}


ARCHIVE_TAGS = ("renamed", "retired", "deleted")   # changes.js ARCHIVE_TAGS
ARCHIVED_PERSON = ("card", "title", "tag", "renamed_to", "renamedId", "moved_to", "at", "created")       # contributions.json people[].archived


def archive_tag(tag):
    """The bot's archived tag -> renamed (renamed_to), unfinished (moved_to MDW/Unfinished), retired (moved_to elsewhere
    in MDW: The Morgue) or deleted."""
    moved = tag.get("moved_to") or ""
    return "renamed" if tag.get("renamed_to") else "unfinished" if moved.startswith("MDW/Unfinished/") \
        else "retired" if moved else "deleted"


def archived_cards(old_stats, id_of, stats=(), people=None, credited=None, author_of=None):
    """The cards whose PSD left the card repo: old_stats names whose last version carries the bot's `archived` tag
    {at, path, blob, commit, renamed_to?, moved_to?, author?, backfill?} (moved_to: the PSD moved into MDW, retired), newest first. A name in stats is back, whatever its tag says (the
    bot clears it on its next save: card_models.stale_archives). tag: archive_tag(); author: a renamed card's Card Authors.txt
    line > the old name's (credited, by name, or by title when no live card has it) > the renamed card's (author_of: a card name ->
    its author) > the tag's > the last version's, through person(); created: the last version's created date, else the
    Pacific day of its oldest version; series: the last version's."""
    out = []
    for name, versions in (old_stats or {}).items():
        if name in stats:
            continue
        last = versions[len(versions) - 1] if isinstance(versions, list) and versions else None
        tag = getattr(last, "archived", None)
        if not isinstance(tag, dict):
            continue
        title = getattr(last, "display_name", None) or name
        renamed = id_of(tag.get("renamed_to"))
        new = tag["renamed_to"] if renamed else None    # history stays with the card it became
        listed = (new and (credited or {}).get(card_key(new))) or (credited or {}).get(card_key(name)) \
            or (None if id_of(title) else (credited or {}).get(card_key(title))) or (new and author_of and author_of(new))   # a live card's title is its own
        made = getattr(last, "created", None)
        made = made.get("date") if isinstance(made, dict) else None
        if not made:
            dated = [analytics.when(v) for v in versions if isinstance(getattr(v, "timestamp", None), (int, float))]
            made = datetime.fromtimestamp(min(dated), analytics.ZONE).strftime("%Y-%m-%d") if dated else None
        row = {"card": name, "title": title, "tag": archive_tag(tag), "card_type": getattr(last, "card_type", None),
               "stars": getattr(last, "stars", None), "series": getattr(last, "series", None), "at": tag.get("at"),
               "created": made, "author": person(people or {}, listed or tag.get("author") or getattr(last, "author", None)),
               "path": tag.get("path") or getattr(last, "path", None),
               "commit": tag.get("commit"), "renamed_to": tag.get("renamed_to"), "moved_to": tag.get("moved_to")}
        if renamed:
            row["renamedId"] = renamed
        out.append({k: v for k, v in row.items() if v not in (None, "")})
    return sorted(out, key=lambda r: (-(r.get("at") or 0), r["card"].lower()))


# ---- contributions (data/contributions.json: who made, edited and committed cards) ---------------------------
TITLES = (("cards", "Top card maker"), ("edits", "Top editor"), ("commits", "Top committer"))   # top count per column; ties share; same list in profile.js
OVERALL = "Top contributor"                   # the top total of the three columns; profile.js OVERALL
RECENT_COMMITS = 10
MIN_RATERS = 5                                # P7/P8: the fewest cards a correlation is shown for (P5: 3 of their own)
RECENT_BAL = 5                                # P1: the newest buffs and nerfs kept per person
PAGE_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$")       # a name that can be a u/<key>/ folder


def login_rows(commits, people, by_login):
    """A login -> its row, or None: credit(), else the name its noreply commits (not the bot's) credit most."""
    noreply = {}                                  # a noreply email's login -> {credited name: commits}
    for _, _, name, email, _, _, _ in commits or ():
        m = NOREPLY_RE.match(email or "")
        if m and name.lower() != BOT_AUTHOR.lower():
            c = noreply.setdefault(m.group(1).lower(), {})
            k = who(name, email, people, by_login)
            if k:
                c[k] = c.get(k, 0) + 1

    def row_of(login):
        c = noreply.get((login or "").lower())
        return credit(login, people, by_login) or (min(c, key=lambda n: (-c[n], n.lower())) if c else None)
    return row_of


def credit(key, people, by_login):
    """A git name or GitHub login -> the name the site credits: the author field of the profile with that login (the
    person's own statement), else [people]; None when neither knows it (case-insensitive, like person())."""
    p = by_login.get((key or "").lower())
    if p and p.get("author"):
        return p["author"]
    return people.get((key or "").lower())


def who(name, email, people, by_login):
    """A commit's author -> the credited name: credit() of the git name, else of the login in a GitHub noreply email,
    else the git name as written."""
    m = NOREPLY_RE.match(email or "")
    return credit(name, people, by_login) or (m and credit(m.group(1), people, by_login)) or name or ""


def is_card_file(path):
    """A card's PSD or PNG under the card folders (today's or a renamed spelling), not a template, marker or rulebook page."""
    return path.lower().endswith((".psd", ".png")) and path.startswith(CARD_FOLDERS + OLD_CARD_FOLDERS) \
        and not any(p in SKIP_PARTS or p in RULE_PARTS for p in path.split("/"))


def contributions(cards, people, profiles, edits, commits, balance=None, revisions=None, archived=(), fields_by=None, row_of=None):
    """{"available", "since", "people": [{key, logins, github?, cards, edits, commits, first, last, recent, recentEdits,
    months, + person_extras' keys}], "site"?: {z}} by cards, then commits.
    cards: visible non-duplicate cards credited to the name. edits = publish batches: commits that changed Card Edits.json
    (a hand commit counts, a pure move doesn't), or without history the file's distinct _by/_at stamps (a floor: it keeps
    one batch per card; a `_bot` field counts only for its `_credit` editor). commits: commits that added or changed a card PSD or PNG (a move, the same blob deleted and
    added, isn't a change), one however many files. The bot's own commits and stamps and discord:<name> stamps are left out, but a bake (a bot
    commit changing a card, with Edit-by trailers, one per card and editor) is one card commit of each editor it names,
    its recent entry counting their trailers as cards, never an edit (their batch already counted). A login is the row credit() names, else the row its noreply commits credit most, else its own (any
    case). logins: the names credited to the person (key, profile logins, [people] names, GitHub logins seen), each in
    one row.
    github: a GitHub login known to be theirs (their profile's, else the most used of the logins in their noreply commit
    emails, _by stamps and Edit-by trailers), never a git name. recent / recentEdits: the last card commits [ts, subject,
    n cards] and edit batches [ts, subject, sha]. months: [["YYYY-MM" Pacific, cards created (created, else fs), edits, commits]].
    balance: analytics.json; revisions: card_revisions(); archived: archived_cards(); fields_by: edit_batches' (person_extras);
    row_of: login_rows() (made here without)."""
    by_login = {p["login"].lower(): p for p in profiles}
    rec, seen_logins, spelled = {}, {}, {}
    row_of = row_of or login_rows(commits, people, by_login)

    def key_of(login):
        """A website or Edit-by login -> the credited name: row_of(), else the login as first spelled."""
        return row_of(login) or spelled.setdefault(login.lower(), login)

    def rec_of(key):
        return rec.setdefault(key, {"key": key, "cards": 0, "edits": 0, "commits": 0, "first": 0, "last": 0, "recent": [], "recentEdits": [], "months": {}})

    def seen(r, ts):
        r["first"], r["last"] = min(r["first"] or ts, ts), max(r["last"], ts)

    def tally(r, ts, i):
        m = r["months"].setdefault(datetime.fromtimestamp(ts, analytics.ZONE).strftime("%Y-%m"), [0, 0, 0])   # Pacific, as the site's dates
        m[i] += 1

    def known(key, login):
        if login and LOGIN_RE.match(login):
            c = seen_logins.setdefault(key, {})
            c[login] = c.get(login, 0) + 1

    for c in cards:
        if c.get("author") and not c.get("dup") and not c.get("hidden"):
            r = rec_of(c["author"])
            r["cards"] += 1
            if c.get("created") or c.get("fs"):
                tally(r, created_ts(c), 0)
    if commits is not None:
        for sha, ts, name, email, subject, entries, editors in commits:
            bot = name.lower() == BOT_AUTHOR.lower()
            key = who(name, email, people, by_login)
            if not bot and (not key or key.lower() == BOT_AUTHOR.lower()):
                continue
            gone = {old for s, old, _, _ in entries if s == "D"}
            changed = lambda s, new: s == "M" or (s == "A" and new not in gone)       # not a blob moved from another path
            touched = {os.path.splitext(os.path.basename(p))[0].lower() for s, _, new, p in entries if changed(s, new) and is_card_file(p)}
            if bot:                               # a bake: the card commit of each editor named
                named = {}                        # row -> [login as first spelled, their cards: one trailer per card]
                for login in [e for e in editors if LOGIN_RE.match(e)] if touched else ():
                    named.setdefault(key_of(login), [login, 0])[1] += 1      # one commit per row named
                for k, (login, n) in named.items():
                    if k.lower() == BOT_AUTHOR.lower():
                        continue
                    r = rec_of(k)
                    known(k, login)
                    seen(r, ts)
                    r["commits"] += 1
                    tally(r, ts, 2)
                    if len(r["recent"]) < RECENT_COMMITS:
                        r["recent"].append([ts, subject, n])
                continue
            edited = any(p in EDIT_PATHS and changed(s, new) for s, _, new, p in entries)
            if not touched and not edited:
                continue
            r = rec_of(key)
            m = NOREPLY_RE.match(email or "")
            known(key, m and m.group(1))
            seen(r, ts)
            if edited:
                r["edits"] += 1
                tally(r, ts, 1)
                if len(r["recentEdits"]) < RECENT_COMMITS:
                    r["recentEdits"].append([ts, subject, sha])
            if touched:
                r["commits"] += 1
                tally(r, ts, 2)
                if len(r["recent"]) < RECENT_COMMITS:
                    r["recent"].append([ts, subject, len(touched)])
    else:
        for by, at in {stamp for fields, meta in edits.values() for stamp in stamp_groups(fields, meta)}:   # a field's own editor
            if is_discord(by):                    # a Discord user is nobody's row
                continue
            r = rec_of(key_of(by))
            r["edits"] += 1
            try:
                seen(r, int(datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp()))
            except ValueError:
                pass
    for _, meta in edits.values():                # website logins: one per batch stamp
        by = meta.get("_by")
        if by and by.lower() != BOT_AUTHOR.lower() and not is_discord(by):
            known(key_of(by), by)
    out = []
    for r in rec.values():
        if not (r["cards"] or r["edits"] or r["commits"]):
            continue
        names = {r["key"]} | {p["login"] for p in profiles if p.get("author") == r["key"]} | {g for g, shown in PEOPLE_AS_WRITTEN.items() if shown == r["key"]} \
            | set(seen_logins.get(r["key"], ()))
        own_names = {n.lower(): n for n in sorted(names, reverse=True) if (row_of(n) or n) == r["key"]}   # a name credits one row
        r["logins"] = sorted(own_names.values(), key=str.lower)
        own = [n for n in r["logins"] if n.lower() in by_login and LOGIN_RE.match(n)]
        counted = seen_logins.get(r["key"], {})
        github = own[0] if own else min(counted, key=lambda n: (-counted[n], n.lower())) if counted else ""
        if github:
            r["github"] = github
        r["months"] = [[k, *v] for k, v in sorted(r["months"].items())]
        out.append(r)
    out.sort(key=lambda r: (-r["cards"], -r["commits"], -r["edits"], r["key"].lower()))
    res = {"available": commits is not None, "since": min((r["first"] for r in out if r["first"]), default=0), "people": out}
    zs = [v["z_total"] for v in (balance or {}).get("cards", {}).values() if "z_total" in v]
    if zs:
        res["site"] = {"z": round(sum(zs) / len(zs), 2)}
    person_extras(out, cards, commits, people, by_login, balance or {}, revisions, archived or (), fields_by or {}, row_of)
    return res


# ---- person stats (contributions.json people[]: the person page's Balance, Ratings, Revisions, Archived cards) ---------
def psd_commits_at(commits, people, by_login, row_of=None):
    """{committer time: [(credited names, {alnum PSD file names})]} of the commits that added or changed a PSD."""
    out = {}
    for row in commits or ():
        names = {alnum(os.path.splitext(os.path.basename(p))[0]) for s, _, _, p in row[5] if s != "D" and p.lower().endswith(".psd")}
        if names:
            out.setdefault(row[1], []).append((commit_keys(row, people, by_login, row_of), names))
    return out


def change_by(at_ts, card, row):
    """Who made an analytics change row (at_ts: psd_commits_at): the one commit at its second; with more, the one that
    touched a PSD of the card's file name. [] when it's still not one."""
    got = at_ts.get(row.get("ts"), [])
    if len(got) > 1:
        name = alnum(os.path.splitext(os.path.basename(card.get("psd") or ""))[0])
        got = [g for g in got if name in g[1]]
    return got[0][0] if len(got) == 1 else []


def pearson(xs, ys):
    """Their correlation (2 dp), or None under MIN_RATERS pairs or with no spread."""
    n = len(xs)
    if n < MIN_RATERS:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx, sy = sum((x - mx) ** 2 for x in xs) ** 0.5, sum((y - my) ** 2 for y in ys) ** 0.5
    return round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy), 2) if sx and sy else None


def signed1(v):
    """rating_number() for a difference: one decimal, either sign."""
    return -rating_number(-v) if v < 0 else rating_number(v)


def latest_of(entries, scale):
    """{by: value}: each rater's latest entry of scale (oldest first, a later one replaces)."""
    out = {}
    for e in entries or ():
        if e.get("scale") == scale:
            out[e["by"]] = e["value"]
    return out


def person_extras(rows, cards, commits, people, by_login, balance, revisions, archived, fields_by, row_of=None):
    """Adds to each contributions row (key K; own cards: credited to K, not duplicates, not hidden) what it has of:
    power (P2) {n, z, top, bottom, dots [[id, z, top|bottom?]]}; bal (P1) {buff, nerf, shift, madeBuff, madeNerf, swing? [id, delta, ts],
    recent [[id, buff|nerf, delta, ts]]}; revisions (P3, P12, P13) {self, others, top, theirs, most?, untouched, oldest?};
    rework (P11) {n, of, most?}; ratings (P4) {fav?, favN, power?, powerN, best, worst}; selfBias (P5), rater (P7),
    powerVsStats (P8): per-person ratings only; editFields (P21) [[field, n]]; archived (P17). NOTES.md §8."""
    A = balance.get("cards", {})
    vis = [c for c in cards if c.get("author") and not c.get("dup") and not c.get("hidden")]
    own = defaultdict(list)
    for c in vis:
        own[c["author"]].append(c)
    at_ts = psd_commits_at(commits, people, by_login, row_of)
    made = defaultdict(Counter)                   # K -> buffs and nerfs they made to others' cards
    for c in vis:
        for r in A.get(c["id"], {}).get("changes", ()):
            if r.get("bal") in ("buff", "nerf"):
                for k in change_by(at_ts, c, r):
                    if k != c["author"]:
                        made[k][r["bal"]] += 1
    theirs = defaultdict(Counter)                 # K -> {author: their revisions of the author's cards}
    for c in vis:
        for k, n in (revisions or {}).get(c["id"], {}).items():
            if k != c["author"]:
                theirs[k][c["author"]] += n
    fav = {c["id"]: latest_of(c.get("ratings"), "favorability") for c in vis}
    pw = {c["id"]: latest_of(c.get("ratings"), "power") for c in vis}
    fav_raters = {by for m in fav.values() for by in m if by != "group"}
    raters = fav_raters | {by for m in pw.values() for by in m if by != "group"}   # either scale: P5, P8
    web = Counter(e["by"] for c in [*cards, *archived] for e in c.get("ratings") or () if e.get("source") == "website")
    top = lambda counts: [[k, n] for k, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))[:3]]
    for r in rows:
        K, mine = r["key"], own.get(r["key"], [])
        dots = sorted(([c["id"], A[c["id"]]["z_total"], *A[c["id"]].get("flags", ())[:1]] for c in mine if "z_total" in A.get(c["id"], {})),
                      key=lambda d: (d[1], d[0]))
        if dots:
            flags = Counter(f for c in mine for f in A.get(c["id"], {}).get("flags", ()))
            r["power"] = {"n": len(dots), "z": round(sum(d[1] for d in dots) / len(dots), 2), "top": flags["top"], "bottom": flags["bottom"], "dots": dots}
        bal = {"buff": 0, "nerf": 0, "shift": 0, "madeBuff": made[K]["buff"], "madeNerf": made[K]["nerf"], "recent": []}
        moves = []
        for c in mine:
            for row in A.get(c["id"], {}).get("changes", ()):
                if row.get("bal") in bal:
                    bal[row["bal"]] += 1
                    if row["bal"] != "shift":
                        old, new = row["stats"]
                        moves.append([c["id"], row["bal"], sum(new) - sum(old), row["ts"]])
        if moves:
            swing = max(moves, key=lambda m: (abs(m[2]), m[3]))
            bal["swing"] = [swing[0], swing[2], swing[3]]
            bal["recent"] = sorted(moves, key=lambda m: -m[3])[:RECENT_BAL]
        if dots or any(bal[k] for k in ("buff", "nerf", "shift", "madeBuff", "madeNerf")):
            r["bal"] = bal
        if revisions is not None:
            n = {c["id"]: sum(revisions.get(c["id"], {}).values()) for c in mine}
            by = Counter()
            for c in mine:
                by.update(revisions.get(c["id"], {}))
            rev = {"self": by.pop(K, 0), "others": sum(by.values()), "top": top(by), "theirs": top(theirs[K]),
                   "untouched": sum(1 for c in mine if not n[c["id"]])}
            most = min(mine, key=lambda c: (-n[c["id"]], c["name"].lower()), default=None)
            if most and n[most["id"]] >= 2:
                rev["most"] = [most["id"], n[most["id"]]]
            still = [c for c in mine if not n[c["id"]] and created_ts(c)]
            if still:
                rev["oldest"] = min(still, key=lambda c: (created_ts(c), c["name"].lower()))["id"]
            if mine or rev["theirs"]:
                r["revisions"] = rev
        reworks = {c["id"]: (sum(1 for row in A.get(c["id"], {}).get("changes", ()) if analytics.reworked(row)), c["name"].lower()) for c in mine}
        hit = [i for i, (k, _) in reworks.items() if k]
        if hit:
            r["rework"] = {"n": len(hit), "of": len(mine)}
            most = min(hit, key=lambda i: (-reworks[i][0], reworks[i][1]))
            if reworks[most][0] >= 2:
                r["rework"]["most"] = [most, reworks[most][0]]
        others = lambda c, scale: rating_now(c.get("ratings"), scale, skip=K)      # everyone's but K's
        fv, pv = ([(c["id"], v["value"]) for c in mine for v in [others(c, scale)] if v] for scale in ("favorability", "power"))
        if fv or pv:
            rat = {"favN": len(fv), "powerN": len(pv)}
            for short, vals in (("fav", fv), ("power", pv)):
                if vals:
                    rat[short] = rating_number(sum(v for _, v in vals) / len(vals))
            if len(fv) >= 2:                      # best takes up to half, worst the rest below it: never the same card or value
                order = sorted(fv, key=lambda x: (-x[1], x[0]))
                k = min(3, (len(fv) + 1) // 2)
                rat["best"] = [list(x) for x in order[:k]]
                rat["worst"] = [list(x) for x in order[k:][::-1][:3] if x[1] < order[k - 1][1]]
            r["ratings"] = rat
        if K in raters:
            bias = {}
            for scale, short, count, latest in (("favorability", "fav", "n", fav), ("power", "power", "powerN", pw)):
                d = [latest[c["id"]][K] - v["value"] for c in mine if K in latest[c["id"]] for v in [others(c, scale)] if v]
                if len(d) >= 3:
                    bias[short], bias[count] = signed1(sum(d) / len(d)), len(d)
            if bias:
                r["selfBias"] = bias
            pairs = [(fav[c["id"]][K], v["value"]) for c in vis if K in fav[c["id"]] for v in [others(c, "favorability")] if v]
            if len(pairs) >= MIN_RATERS:
                rater = {"n": len(pairs), "harsh": signed1(sum(a - b for a, b in pairs) / len(pairs))}
                agree = pearson([a for a, _ in pairs], [b for _, b in pairs])
                if agree is not None:
                    rater["agree"] = agree
                twin = None
                for other in sorted(fav_raters - {K}, key=str.lower):
                    shared = [(m[K], m[other]) for m in fav.values() if K in m and other in m]
                    rr = pearson([a for a, _ in shared], [b for _, b in shared])
                    if rr is not None and (twin is None or rr > twin[1]):
                        twin = [other, rr]
                if twin:
                    rater["twin"] = twin
                r["rater"] = rater
            pz = [(pw[c["id"]][K], A[c["id"]]["z_total"]) for c in vis if K in pw[c["id"]] and "z_total" in A.get(c["id"], {})]
            rr = pearson([a for a, _ in pz], [b for _, b in pz])
            if rr is not None:
                r["powerVsStats"] = {"r": rr, "n": len(pz)}
        fields = Counter(fields_by.get(K, {}))
        if web[K]:
            fields["rating"] += web[K]
        if fields:
            r["editFields"] = [[f, n] for f, n in sorted(fields.items(), key=lambda kv: (-kv[1], kv[0]))]
        gone = [{k: a[k] for k in ARCHIVED_PERSON if k in a} for a in archived if a.get("author") == K]
        if gone:
            r["archived"] = gone


def titles_of(rows):
    """{key: [titles]}: OVERALL for the top total of TITLES' columns, then the top count in each column; ties share;
    nobody at 0. profile.js titlesOf is the same rule."""
    out = {r["key"]: [] for r in rows}
    best = max((sum(r[f] for f, _ in TITLES) for r in rows), default=0)
    for r in rows:
        if best and sum(r[f] for f, _ in TITLES) == best:
            out[r["key"]].append(OVERALL)
    for field, title in TITLES:
        top = max((r[field] for r in rows), default=0)
        for r in rows:
            if top and r[field] == top:
                out[r["key"]].append(title)
    return out


def people_count(rows, profiles):
    """The People table's row count, as profile.js peopleRows makes them: each contributor, plus each profile no
    contributor row takes (a row takes the first profile, by login, whose login is theirs or whose author is their key)."""
    taken, n = set(), len(rows)
    for p in sorted(profiles, key=lambda p: p["login"].lower()):
        r = next((r for r in rows if p["login"].lower() in {l.lower() for l in r["logins"]} or (p.get("author") and r["key"] == p["author"])), None)
        if r and r["key"] not in taken:
            taken.add(r["key"])
        else:
            n += 1
    return n


def contrib_text(r, titles, with_cards=True):
    """One link-preview line: "Top card maker · 237 cards · 4 edits · 57 card commits"."""
    n = lambda field, word: f"{r[field]} {word}{'' if r[field] == 1 else 's'}"
    parts = list(titles) + ([n("cards", "card")] if with_cards and r["cards"] else []) + ([n("edits", "edit")] if r["edits"] else []) \
        + ([n("commits", "card commit")] if r["commits"] else [])
    return " · ".join(parts)


def kind_of(c):
    """The card's kind as the site's filters group it: status effects together (app.js kindOf)."""
    return "status" if c.get("type") in ("buff", "debuff") else c.get("type")


def kind_word(kind, n):
    """The kind's word for n cards: 1 field card, 2 field cards."""
    return KIND_PLURAL.get(kind, kind) if n != 1 else KIND_PLURAL.get(kind, kind).rstrip("s")


def cards_text(key, cards):
    """One link-preview line for a person's cards: "120 items, 53 creatures, 32 field cards · mostly Hollow Knight, The
    Binding of Isaac" (the three biggest kinds and series); "" without cards. Counts as cardsBy() in profile.js."""
    own = [c for c in cards if key and c.get("author") == key and not c.get("dup") and not c.get("hidden")]
    if not own:
        return ""
    kinds, series = {}, {}
    for c in own:
        kinds[kind_of(c)] = kinds.get(kind_of(c), 0) + 1
        if c.get("series"):
            series[c["series"]] = series.get(c["series"], 0) + 1
    order = list(KIND_PLURAL)
    by_count = sorted(kinds.items(), key=lambda kv: (-kv[1], order.index(kv[0]) if kv[0] in order else len(order), kv[0]))
    line = ", ".join(f"{n} {kind_word(k, n)}" for k, n in by_count[:3])
    top = sorted(series.items(), key=lambda kv: (-kv[1], kv[0].lower()))[:3]
    return line + (f" · mostly {', '.join(name for name, _ in top)}" if top else "")


def person_text(lines, cards_line="", limit=300):
    """A person's link-preview description: the lines, then the cards line last, whole series dropped from its "mostly"
    list (then the list itself) rather than cut mid-name when the cap is near."""
    head = "\n".join(filter(None, lines))
    while cards_line and len(head) + len(cards_line) + 1 > limit:
        kinds, _, mostly = cards_line.partition(" · mostly ")
        cards_line = f"{kinds} · mostly {mostly.rsplit(', ', 1)[0]}" if ", " in mostly else kinds if mostly else ""
    return clip("\n".join(filter(None, [head, cards_line])), limit)


# ---- ban list --------------------------------------------------------------------------------------
def parse_banlist(by_norm):
    path = os.path.join(REPO, BANLIST_PATH)
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


# ---- game.txt: the whole game as plain text (AutoCroissant docs/Future/GAME_TXT.md) ----------------
GAME_TXT = "game.txt"
GAME_KINDS = ("creature", "item", "field", "minion", "nme", "aux item", "buff", "debuff", "creatures")   # app.js KINDS order
GAME_TAGS = (                                 # the rulebook's Timing tags panel (app.js renderRules, text.js tagInfo)
    ("On your turn", (("OYT", "On your turn"), ("1CD", "Cooldown: 1 turn"), ("1/2CD", "Cooldown: 1 turn, then 2"))),
    ("At any time", (("AAT", "At any time"), ("1GCD", "Global cooldown: 1 global turn"),
                     ("1/2GCD", "Global cooldown: 1 global turn, then 2"))),
    ("Forced", (("BOT", "Beginning of turn (forced)"), ("ENDT", "End of turn (forced)"),
                ("BOGT", "Beginning of global turn (forced)"), ("ENDGT", "End of global turn (forced)"))),
    ("Per game & triggers", (("OFS", "On first summon"), ("OS", "On summon"), ("OD", "On death"), ("WOF", "While on field"),
                             ("1PG", "Can only be activated once per game"), ("2U", "2 uses"))),
    ("Other tags", (("Action", "Costs the creature's action"),)),
    ("Old system (rulebook pages)", (("1PT", "usable once per turn (on your turn)"),
                                     ("E2T", "every 2 turns, starting on turn 2 (multi-turn)"),
                                     ("FTE2T", "every 2 turns, starting on your 1st turn (multi-turn)"),
                                     ("1PGT", "usable once per global turn (at any time)"),
                                     ("E2GT", "every 2 global turns (at any time, multi-turn)"))),
)


def game_words(text, icons):
    """Icon tokens as words ([fire] -> fire, [fire:no] -> not fire); other [..] text prints as it is, as on the site."""
    def word(m):
        base, _, v = m.group(1).partition(":")
        if norm(base) not in icons or (v and v.lower() not in VARIANT_IMAGES + ("no",)):
            return m.group(0)
        return ("not " if v.lower() == "no" else "") + base.replace("_", " ")
    text = re.sub(r"\[([^\[\]\n]{1,52})\]", word, text or "")
    return "\n".join(line.rstrip() for line in text.strip().splitlines())


def game_text(cards, rules, banlist, icons, manifest):
    """game.txt: a header, the rulebook pages in book order, the timing tags, the ban list, then every visible card by
    kind and series; a variant picture as its own card, its text only when it differs. Stats as printed (bars). Dated by
    the card data, so a no-change build keeps the file. ’ as '."""
    shown = [c for c in cards if not c.get("hidden")]
    by_id, m = {c["id"]: c for c in cards if c.get("id")}, manifest or {}
    out = [f"{SITE_NAME}: every card and rulebook page as plain text.", f"{len(shown)} cards, {len(rules)} rulebook pages."
           + (f" Card data built {m['built_at']} from card commit {m['card_commit'][:12]}." if m.get("built_at") and m.get("card_commit") else "")
           + (f" {SITE_URL}/" if SITE_URL else ""), "", "# Rulebook", ""]
    for p in rules:
        out += [f"## {p['name']}", game_words(p.get("ability"), icons), ""]
    out += ["# Timing tags", "X can be any number; the first number of a pair such as (1/2CD) can also be 0 or -1.", ""]
    for group, tags in GAME_TAGS:
        out += [f"## {group}", *(f"({t}) {('Old system: ' if group.startswith('Old') else '') + meaning}" for t, meaning in tags), ""]
    out += ["# Constructed ban list", *banlist["notes"], ""]
    for g in banlist["groups"]:
        out += [f"## {g['title']}", *(e["name"] + (f" - {e['reason']}" if e["reason"] else "") for e in g["entries"]), ""]
    order = {k: i for i, k in enumerate(GAME_KINDS)}
    for kind in sorted({c.get("type") or "unknown" for c in shown}, key=lambda k: (order.get(k, len(order)), k)):
        group = sorted((c for c in shown if (c.get("type") or "unknown") == kind),
                       key=lambda c: ((c.get("series") or "~").lower(), c["name"].lower()))
        plural = {**KIND_PLURAL, "buff": "buffs (status effects)", "debuff": "debuffs (status effects)"}.get(kind, kind)
        out += [f"# {plural[:1].upper() + plural[1:]} ({len(group)})", ""]
        for c in group:
            bars = [" ".join(f"{k.upper()} {'?' if s.get(k) is None else s[k]}" for k in STAT_KEYS) for s in c.get("creatures") or [c]
                    if any(s.get(k) is not None for k in STAT_KEYS)]
            label = KIND_LABEL.get(kind, kind) + (f" ({c['subtype']})" if c.get("subtype") else "")
            line = [c["name"], label, f"{c['stars']}★" if c.get("stars") is not None else "",
                    ", ".join(t.replace("_", " ") for t in c.get("types") or []), "; ".join(bars),
                    " / ".join(x for x in (c.get("series"), c.get("subseries")) if x)]
            orig = by_id.get(c.get("dup"))           # a variant picture: its own card; same text not repeated
            if orig:
                line.append(f"variant of {orig['name']}")
            text = c.get("ability") if not orig or c.get("ability") != orig.get("ability") else None
            out += [" | ".join(x for x in line if x), *([game_words(text, icons)] if text else []), ""]
    return "\n".join(out).replace("’", "'")


# ---- main ------------------------------------------------------------------------------------------
# ---- build versions (?v=) ------------------------------------------------------------------------------
IMPORT_RE = re.compile(r'(from\s+"\./([\w-]+\.js))"')     # a module's static imports, as they are stamped
VOLATILE = {"cards.json": ("generated", "source"), "decks.json": ("generated",), "changelog.json": ("since",)}   # the build's clock


def stamp_of(data):
    return hashlib.sha256(data).hexdigest()[:10]


def asset_stamps(texts):
    """{file: (stamp, text as served)} for site/assets ({file: text}): a file's stamp hashes its served text, and a module's
    imports carry their own stamps, so a change reaches the URLs of that file and its importers only. An import cycle: one
    stamp over every file."""
    deps = {n: [m.group(2) for m in IMPORT_RE.finditer(t)] if n.endswith(".js") else [] for n, t in texts.items()}
    out = {}

    def stamp(name, path=()):
        if name in out:
            return out[name][0]
        if name in path:
            raise ValueError(f"import cycle: {' -> '.join(path + (name,))}")
        text = texts[name]
        if deps[name]:
            got = {d: stamp(d, path + (name,)) for d in deps[name] if d in texts}
            text = IMPORT_RE.sub(lambda m: f'{m.group(1)}?v={got.get(m.group(2)) or stamp_of(m.group(2).encode())}"', text)
        out[name] = (stamp_of(text.encode("utf-8")), text)
        return out[name][0]
    try:
        for name in sorted(texts):
            stamp(name)
    except ValueError as e:
        log(f"assets: {e}; one stamp for all")
        digest = hashlib.sha256()
        for name in sorted(texts):
            digest.update(name.encode() + b"\0" + texts[name].encode("utf-8") + b"\0")
        one = digest.hexdigest()[:10]
        out = {n: (one, IMPORT_RE.sub(rf'\1?v={one}"', t) if n.endswith(".js") else t) for n, t in texts.items()}
    return out


def steady(files, blobs):
    """{data file: its bytes without the build's clock (VOLATILE)}"""
    return {name: json.dumps({k: v for k, v in files[name].items() if k not in VOLATILE.get(name, ())}, separators=(",", ":"),
                             ensure_ascii=False).encode("utf-8") if VOLATILE.get(name) else blob for name, blob in blobs.items()}


def data_stamp(data, details):
    """The data's stamp: the data files (steady()) and the details files ({name: bytes})."""
    digest = hashlib.sha256()
    for name in sorted(data):
        digest.update(name.encode() + b"\0" + data[name] + b"\0")
    for name in sorted(details):
        digest.update(f"details/{name}".encode() + b"\0" + details[name] + b"\0")
    return digest.hexdigest()[:10]


BUILD_TXT = "build.txt"                       # in DIST: dist_digest() (which build is live), then the page stamp


def dist_digest(data):
    """sha256 over every file in DIST but BUILD_TXT (thumbs/ too, by content), the data files without the build's clock
    (data: steady()): a build that only changed this script digests the same."""
    paths = sorted(os.path.relpath(os.path.join(root, name), DIST).replace(os.sep, "/")
                   for root, _, names in os.walk(DIST) for name in names)

    def sha(rel):
        if rel.startswith("data/") and rel[5:] in data:
            return hashlib.sha256(data[rel[5:]]).digest()
        with open(os.path.join(DIST, rel), "rb") as fh:
            return hashlib.sha256(fh.read()).digest()
    digest = hashlib.sha256()
    with ThreadPoolExecutor(max_workers=8) as pool:   # hashlib works outside the GIL
        for rel, h in zip(paths, pool.map(sha, paths)):
            if rel != BUILD_TXT:
                digest.update(rel.encode() + b"\0" + h)
    return digest.hexdigest()


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
    if not CARD_DATA_DIR:
        raise SystemExit("error: no CARD_DATA_DIR: set it to a checkout of the data branch's db/ "
                         "(git worktree add /tmp/carddata origin/data; CARD_DATA_DIR=/tmp/carddata/db).")
    data_dir = os.path.abspath(CARD_DATA_DIR)
    stats, old_stats, records = load_card_data(data_dir)
    if not isinstance(stats, dict) or len(stats) < MIN_CARDS:
        raise SystemExit(f"error: the card data (stats.json in {data_dir}) has "
                         f"{len(stats) if isinstance(stats, dict) else 'no'} entries (expected at least {MIN_CARDS}); "
                         f"refusing to deploy a truncated site.")
    log(f"card data ({data_dir}): {len(stats)} entries, {len(old_stats)} with history, {len(records)} PSD records")
    for message in bot_field_warnings(stats, old_stats if isinstance(old_stats, dict) else {}):
        warn(message)
    edits = parse_edits()

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

    seen_pngs, bot_dup_names = set(), {}
    for name, c in sorted(stats.items(), key=lambda kv: kv[0].lower()):
        path = getattr(c, "path", "") or ""
        if getattr(c, "duplicate_of", None):     # the bot's duplicate: only its name is used
            if getattr(c, "display_name", None):
                bot_dup_names[name.replace(" ", "_").lower() + ".png"] = c.display_name
            continue
        png = png_for(path, name)
        if png:
            seen_pngs.add(png)
        is_rule = getattr(c, "card_type", "") == "rulebook" or "/Rulebook/" in path
        # the printed title the bot read (since 2026-10-21): shown instead of the file name; a Card Edits.json name wins below
        parsed = getattr(c, "parsed_values", None) or {}
        title = parsed["name"] if "name" in parsed else getattr(c, "display_name", None)
        version = getattr(c, "parser_version", None)
        shown = (title or name) if isinstance(version, int) and version >= 2 else None    # older parses read no titles
        entry = {
            "id": unique_slug(name), "name": (title if not is_rule else None) or name, "type": getattr(c, "card_type", "unknown"),
            "subtype": getattr(c, "subtype", None), "series": getattr(c, "series", None), "subseries": None,   # from edits only
            "stars": getattr(c, "stars", None), "types": list(getattr(c, "types", []) or []),
            "hp": stat(c, "hp"), "def": stat(c, "defense"), "atk": stat(c, "attack"), "spd": stat(c, "speed"),
            "ability": getattr(c, "ability", None), "author": getattr(c, "author", None),
            "ts": getattr(c, "timestamp", None) or None, "psd": path, "png": png,
            "problems": list(getattr(c, "problems", []) or []), "key": name,
            "creatures": [{k: stat_of(x, a) for k, a in STAT_KEYS.items()} for x in getattr(c, "creatures", None) or []] or None,
        }
        # undo the bot's applied edits; the file is the authority
        for field, value in (getattr(c, "parsed_values", None) or {}).items():
            if field in DATA_FIELDS or field == "problems":
                entry[field] = list(value) if isinstance(value, list) else value
        sha = tree.get(path)
        entry["_blob"] = getattr(c, "blob_sha", None)       # the PSD the bot read; join_details, dropped below
        if sha and getattr(c, "blob_sha", None) and sha != c.blob_sha:
            entry["reparsePending"] = True       # PSD committed since the bot last read it (a bake, or any edit)
        apply_edits(entry, edits, sha, shown)
        date_text(entry, c, old_stats.get(name))
        (rules if is_rule else cards).append(entry)

    # duplicates: more PNGs exported from one card's PSD (A_Snack.psd -> A_Snack2.png "Breakfast", A_Snack3.png
    # "Supper"). Same card, different name and art. Named by its Card Edits entry's aliases, else the original's name.
    lower_tree = {path.lower() for path in tree}
    by_psd = {c["psd"].lower(): c for c in cards if c.get("psd")}
    for path in sorted(tree):
        m = re.match(r"(.+?)(\d+)\.png$", path, re.I)
        if not m or path in seen_pngs or not path.startswith(CARD_FOLDERS) or (m.group(1) + m.group(2) + ".psd").lower() in lower_tree:
            continue                          # not numbered, already a card, or it has a PSD of its own
        original = by_psd.get((m.group(1) + ".psd").lower())
        if original is None:
            continue
        names = edit_aliases(edits, os.path.splitext(os.path.basename(path))[0])
        name = (bot_dup_names.get(os.path.basename(path).lower())                     # alias or the PSD's hidden title
                or (" ".join(w[:1].upper() + w[1:] for w in max(names, key=len).split()) if names else original["name"]))
        dup = {k: original.get(k) for k in DATA_FIELDS + ("author", "ts", "psd")}
        dup.update(id=unique_slug(name), name=name, key=os.path.splitext(os.path.basename(path))[0].replace("_", " "),
                   png=path, problems=[], dup=original["id"])
        apply_edits(dup, edits, tree.get(original["psd"]))
        date_text(dup, stats[original["key"]], old_stats.get(original["key"]))   # its PSD's history, against its own text
        for k in ("pending", "refused", "baked", "reparsePending"):   # same PSD: its image changes with the original's
            value = [f for f in original[k] if f != "name"] if k == "pending" and original.get(k) else original.get(k)
            if value and not dup.get(k):         # not the name: a duplicate prints its own title
                dup[k] = value
        original.setdefault("dups", []).append(dup["id"])
        cards.append(dup)
        seen_pngs.add(path)
    log(f"duplicates: {sum(1 for c in cards if c.get('dup'))} PNGs share another card's PSD")

    # PSDs the bot hasn't parsed yet, and card PNGs without a PSD: list them, image only
    known = {norm(c[k]) for c in cards + rules for k in ("name", "key")}     # a shown title differs from the file name
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
        entry = {"id": unique_slug(name), "name": name, "key": name, "type": info["type"], "subtype": info.get("subtype"),
                 "series": info.get("series"), "subseries": None, "stars": info.get("stars"), "types": [], "hp": None, "def": None,
                 "atk": None, "spd": None, "ability": None, "author": None, "ts": None,
                 "psd": path if low.endswith(".psd") else None, "png": png, "problems": [], "parsed": False}
        apply_edits(entry, edits, tree.get(path) if low.endswith(".psd") else None)
        cards.append(entry)
    # cards.json leaves "parsed" out when true

    # dup_of ("" = not a duplicate)
    by_id = {e["id"]: e for e in cards}
    by_key = {}
    for field in ("key", "name"):
        for e in cards:
            by_key.setdefault(card_key(e[field]), e)
    for e in cards:
        found = edits.get(card_key(e["key"]))
        if not found or "dup_of" not in found[0]:
            continue
        own, target_name = found[0], found[0]["dup_of"]
        old = by_id.get(e.get("dup"))
        if old is not None and e["id"] in old.get("dups", []):
            old["dups"].remove(e["id"])
        e.pop("dup", None)
        if not target_name:
            continue
        target = by_key.get(card_key(target_name))
        if target is None or target is e:
            log(f"warning: {EDITS_PATH}: {e['key']}: dup_of {target_name!r} isn't another card, ignored")
            continue
        e["dup"] = target["id"]
        target.setdefault("dups", []).append(e["id"])
        for field in DATA_FIELDS:                 # fill blanks from the original
            if field not in own and e.get(field) in (None, [], ""):
                e[field] = target.get(field)
    edited = [e for e in cards if e.get("edited")]
    if edits:
        log(f"corrections: {len(edited)} cards from {EDITS_PATH}" + (f" ({len(edits) - len(edited)} names match no card)" if len(edits) > len(edited) else ""))

    for e in cards:                               # website aliases
        for alias in e.get("webAliases", []):
            if norm(alias) != norm(e["name"]) and norm(alias) not in {norm(a) for a in e.get("aliases", [])}:
                e.setdefault("aliases", []).append(alias)
    for e in cards:                               # the file name stays searchable under a printed or corrected title
        if not e.get("dup") and norm(e["key"]) != norm(e["name"]) and norm(e["key"]) not in {norm(a) for a in e.get("aliases", [])}:
            e.setdefault("aliases", []).append(e["key"])

    # authors: site/Card Authors.txt wins over the bot ([people] maps git names to shown names)
    people, credited = parse_authors()
    for e in cards:
        if not e.get("dup"):
            listed = credited.get(card_key(e["key"])) or credited.get(card_key(e["name"]))
            e["author"] = person(people, listed or e.get("author"))
            if listed:
                e["authorListed"] = True
    for e in cards:
        if e.get("dup"):
            e["author"] = by_id[e["dup"]]["author"]          # a duplicate is its original's card
    if credited:
        log(f"authors: {sum(1 for e in cards if e.get('authorListed'))} cards credited by Card Authors.txt, {len(people)} people")

    # images (cached by blob hash; only new or changed PNGs are fetched and encoded)
    if not features.check("avif"):
        raise SystemExit("error: this Pillow can't write AVIF (the card images); pip install -r site/build/requirements.txt")
    jobs = [e for e in cards + rules if e["png"] and e["png"] in tree]
    failed, later, meta = [], [], load_image_meta()
    deadline = time.time() + IMAGE_BUDGET if IMAGE_BUDGET > 0 else None
    def images(e):
        if deadline and time.time() > deadline and not all(
                os.path.exists(os.path.join(CACHE, "img", n)) for n in image_names(tree[e["png"]]).values()):
            later.append(e["png"])                # over the budget: the next run makes it
            return
        try:
            e["img"], e["tw"], e["th"], e["color"] = make_images(e["png"], tree[e["png"]], meta.get(tree[e["png"]]))
        except Exception as err:
            failed.append(e["png"])
            log("image failed:", e["png"], err)
    cache_dir = os.path.join(CACHE, "img")
    cached_before = len(os.listdir(cache_dir))
    try:
        with ThreadPoolExecutor(min(16, (os.cpu_count() or 4) * 2)) as pool:
            list(pool.map(images, jobs))
    finally:                                      # whatever stops the build now, site.yml saves the cache with what was made
        save_image_meta({**meta, **{tree[e["png"]]: [e["tw"], e["th"], e["color"]] for e in jobs if e.get("img")}})
    if later:
        raise SystemExit(f"error: {len(later)} of {len(jobs)} card images not made within IMAGE_BUDGET ({IMAGE_BUDGET:.0f}s); "
                         f"the next run makes them (the {len(jobs) - len(later)} done are cached). Not deploying.")
    if len(failed) > max(5, len(jobs) // 50):
        raise SystemExit(f"error: {len(failed)} of {len(jobs)} card images failed (network?); not deploying a site with missing images.")
    used = set()
    for e in jobs:
        if e.get("img"):
            for name in image_names(tree[e["png"]]).values():
                used.add(name)
                link_or_copy(os.path.join(cache_dir, name), os.path.join(DIST, "thumbs", name))
    pruned = [n for n in os.listdir(cache_dir) if n not in used]
    for n in pruned:
        os.remove(os.path.join(cache_dir, n))
    save_image_meta({tree[e["png"]]: [e["tw"], e["th"], e["color"]] for e in jobs if e.get("img")})
    made = len(os.listdir(cache_dir)) - cached_before + len(pruned)
    log(f"images: {len(jobs)} cards, {made} new files, {len(pruned)} unused pruned, {len(failed)} failed")

    icons, icon_variants = build_icons(tree)
    by_norm = {}
    for c in cards:
        by_norm.setdefault(alnum(c["name"]), c)
        by_norm.setdefault(alnum(c["key"]), c)
        for a in c.get("aliases", []):
            by_norm.setdefault(alnum(a), c)
    banlist = parse_banlist(by_norm)

    # image versions: commits table + per card [[commit index, path then if it differs], ...], newest first
    by_png = {}
    for e in cards + rules:
        if e.get("png") and e["png"] in tree:
            by_png.setdefault(e["png"], []).append(e)
    commits = git_history()
    found = image_versions(list(by_png), commits)
    versions = {"available": found is not None, "repo": CARD_REPO, "commits": [], "cards": {}}
    rule_ids = {e["id"] for e in rules}
    if found:
        index = {}
        for png, vs in found.items():
            rows = []
            for (sha, ts, author, subject), path in vs:
                if sha not in index:
                    index[sha] = len(versions["commits"])
                    versions["commits"].append([sha, ts, person(people, author), subject])
                rows.append([index[sha]] + ([path] if path != png else []))
            for e in by_png[png]:                 # fs: first upload (the oldest row): created's fallback (apply_created)
                if rows and e["id"] not in rule_ids:
                    e["fs"] = min(ts for (_, ts, _, _), _ in vs)
            if len(rows) > 1:                     # one version = nothing to compare
                for e in by_png[png]:
                    versions["cards"][e["id"]] = rows
                    e["iv"] = len(rows)
        first = min((c[1] for c in versions["commits"]), default=0)
        versions["since"] = first
        log(f"image versions: {sum(len(r) for r in versions['cards'].values())} versions of {len(versions['cards'])} cards "
            f"from {len(versions['commits'])} commits, since {datetime.fromtimestamp(first, timezone.utc):%Y-%m-%d}")

    apply_created(cards, parse_created())         # after fs: a card's first upload can be the earlier evidence
    detail_files = join_details(cards + rules, records, tree)      # rulebook pages too: the bot reads their PSDs
    for e in cards + rules:
        e.pop("_blob", None)
    if records:
        log(f"PSD details: {len(detail_files)} cards and rulebook pages have a record ({len(records)} in {DETAILS_JSON})")
    fonts = web_fonts(tree, record_fonts(detail_files.values())) if detail_files else {}     # the mock-up's web fonts (data/fonts.json)
    if fonts:
        log(f"web fonts: {len(fonts)} of the {len(record_fonts(detail_files.values()))} PSD fonts from {FONTS_DIR}")

    if analytics.ZONE_MISSING:
        warn("no tz database: balance days and months in UTC, not Pacific time as balance.js shows them")
    psd_commits = None if commits is None else {(ts, os.path.basename(path).lower()) for _, ts, _, _, _, entries, _ in commits
                                                for status, _, _, path in entries if status != "D" and path.lower().endswith(".psd")}
    try:                                          # balance analytics: never a failed build
        balance = analytics.build(cards, stats, old_stats if isinstance(old_stats, dict) else {}, history=commits is not None,
                                  psd_commits=psd_commits)
        for message in analytics.summary(balance):
            log(message)
    except Exception as e:
        warn(f"no balance analytics: {type(e).__name__}: {e}")
        balance = {"cohorts": {}, "cards": {}, "counts": {}, "versions": 0, "since": None, "time": {"months": [], "series": {}}}
    for e in cards:
        if e["id"] in balance["cards"]:
            e["balance"] = True                   # its Balance block loads data/analytics.json

    history = {}
    for e in cards + rules:
        if e.get("history"):                  # loaded on demand: the first screen only needs the count
            history[e["id"]] = e.pop("history")
            e["hv"] = len(history[e["id"]])
        for k in [k for k, v in e.items() if v in (None, [], "") or (k == "parsed" and v is True)]:
            del e[k]                          # drop empty fields to keep the JSON small
    rules.sort(key=lambda r: r["name"].lower())
    public_decks, private_decks = read_decks(cards)
    data = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source_time(),              # edit.js: a publish is live once this reaches its commit's date
        "repo": CARD_REPO, "botRepo": BOT_REPO, "raw": RAW,
        "cards": cards, "icons": icons, "iconVariants": icon_variants, "banlist": banlist,
        "thumbs": {w: thumb_tag(w) for w in IMAGE_SIZES},      # app.js img(): thumbs/<img>-<w>-<tag>.avif
        # for the editor
        "branch": build_branch(), "files": {"edits": EDITS_PATH, "authors": AUTHORS_PATH, "banlist": BANLIST_PATH, "admins": ADMINS_PATH,
                                            "profiles": PROFILES_DIR, "decks": DECKS_DIR, "logins": LOGINS_DIR,
                                            "ratings": RATINGS_PATH},
        "admins": parse_admins(),
        "decks": {"public": len(public_decks), "private": len(private_decks)},     # the Deck builder page shows the public count; the list is decks.json
        "people": sorted(set(people.values()) | {e["author"] for e in cards if e.get("author")}, key=str.lower),
        "peopleMap": PEOPLE_AS_WRITTEN,
    }
    profiles = read_profiles(cards, data["people"])
    by_login = {p["login"].lower(): p for p in profiles}
    id_of = lambda name: (by_key.get(card_key(name)) or {}).get("id") if isinstance(name, str) and name else None
    name_of = lambda key: (by_key.get(card_key(key)) or {}).get("name") or key
    archived = archived_cards(old_stats if isinstance(old_stats, dict) else {}, id_of, stats, people=people, credited=credited,
                             author_of=lambda name: (by_key.get(card_key(name)) or {}).get("author"))
    row_of = login_rows(commits, people, by_login)   # a login's row, as contributions keys it
    rated = apply_ratings(cards, parse_ratings(), archived, people, by_login, row_of)
    line = f"ratings: {rated['entries']} entries on {rated['cards']} cards ({rated['archived']} archived)"
    if rated["unmatched"]:
        warn(f"{line}, {len(rated['unmatched'])} names match no card: {', '.join(rated['unmatched'][:10])}")
    elif rated["entries"]:
        log(line)
    revs = card_revisions(found, by_png, commits, people, by_login, skip=rule_ids, row_of=row_of)
    if revs is not None:
        log(f"revisions: {sum(n for v in revs.values() for n in v.values())} card image changes on {len(revs)} cards "
            f"({len(mass_passes(found, by_png, rule_ids))} mass-pass commits left out)")

    # the Changes page's Changelog and Database edits tabs: the card sync's events, the edit batches, archived cards
    since = int(time.time()) - CHANGELOG_DAYS * 86400
    events, manifest = read_changelog(data_dir)
    if events is None:
        warn(f"CARD_DATA_DIR {CARD_DATA_DIR} has no changelog folder; the Changelog tab shows no events")
    fields_by = {}                                # the person pages' edits by field: all time
    try:
        every = edit_batches(edit_history(), people, by_login, edits, id_of, name_of, 0, fields_by=fields_by, row_of=row_of)
        batches = {**every, "batches": [b for b in every["batches"] if b["at"] >= since]}
    except Exception as e:                        # never a failed build
        warn(f"no edit batches: {type(e).__name__}: {e}")
        batches = {"available": False, "batches": []}
        fields_by.clear()
    contrib = contributions(cards, people, profiles, edits, commits, balance=balance, revisions=revs, archived=archived, fields_by=fields_by, row_of=row_of)
    titles = titles_of(contrib["people"])
    person_of = {login.lower(): r for r in contrib["people"] for login in r["logins"]}        # a profile's login -> its contributions
    previews = {}                                 # u/<name>/ -> its link-preview text, for the share dialog too
    for p in profiles:
        n = sum(1 for c in cards if c.get("author") == p["author"] and not c.get("dup") and not c.get("hidden")) if p.get("author") else 0   # as cardsBy() counts
        r = person_of.get(p["login"].lower())
        previews[p["login"]] = profile_text(p, n, by_id, contrib_text(r, titles[r["key"]], with_cards=not p.get("author")) if r else "",
                                            cards_text(r["key"] if r else p.get("author"), cards))
    with_profile = {p["login"].lower() for p in profiles}
    for r in contrib["people"]:                   # a contributor without a profile, whose name no profile's page has
        if not any(login.lower() in with_profile for login in r["logins"] + [r["key"]]) and PAGE_KEY_RE.match(r["key"]):
            previews[r["key"]] = person_text([contrib_text(r, titles[r["key"]])], cards_text(r["key"], cards))
    contrib["previews"] = previews
    data["peopleCount"] = people_count(contrib["people"], profiles)      # the People tab's counter
    log(f"contributions: {len(contrib['people'])} people, {sum(r['edits'] for r in contrib['people'])} edit batches, "
        f"{sum(r['commits'] for r in contrib['people'])} card commits" + ("" if contrib["available"] else " (no history: batches counted from the edits file)"))

    changelog = {"available": events is not None, "since": since, "days": CHANGELOG_DAYS, "repo": CARD_REPO, "source": manifest,
                 "events": site_events(events or [], id_of, since), "archived": archived, "edits": batches}
    log(f"changelog: {len(changelog['events'])} events" + ("" if events is not None else " (no changelog folder)") +
        f", {len(batches['batches'])} edit batches, {len(changelog['archived'])} archived cards")
    try:                                      # password files (read before cards.json: data.passwords opens the sign-in on Password)
        logins = read_logins()
    except Exception as e:                    # never a failed build
        warn(f"no password files: {type(e).__name__}: {e}")
        logins = []
    data["passwords"] = len(logins)
    os.makedirs(os.path.join(DIST, "data"))
    files = {"cards.json": data, "rules.json": {"rules": rules}, "history.json": history, "versions.json": versions, "users.json": {"users": profiles},
             "contributions.json": contrib, "decks.json": {"generated": data["generated"], "decks": public_decks, "private": private_decks},
             "analytics.json": balance, "changelog.json": changelog, **({"fonts.json": {"fonts": fonts}} if fonts else {})}
    blobs = {name: json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8") for name, obj in files.items()}
    for name, blob in blobs.items():
        with open(os.path.join(DIST, "data", name), "wb") as fh:
            fh.write(blob)
    try:                                      # password files: the sign-in's copy when GitHub's API can't be reached
        write_logins(os.path.join(DIST, "data", "logins"), logins)
    except Exception as e:                    # never a failed build
        warn(f"no password files written: {type(e).__name__}: {e}")
    details = {f"{cid}.json": json.dumps(rec, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
               for cid, rec in detail_files.items()}   # json.dumps: json.dump to a file is the slow pure-Python encoder
    if details:                               # one small file per card, fetched when its Details dropdown opens
        os.makedirs(os.path.join(DIST, "data", "details"))
        for name, blob in details.items():
            with open(os.path.join(DIST, "data", "details", name), "wb") as fh:
                fh.write(blob)
    log(f"cards: {len(cards)} ({sum(1 for c in cards if c.get('parsed') is False)} image only), rulebook pages: {len(rules)}, "
        f"icons: {len(set(i['file'] for i in icons.values()))}, banned: {sum(len(g['entries']) for g in banlist['groups'])}")
    game = game_text(cards, rules, banlist, icons, manifest)
    with open(os.path.join(DIST, GAME_TXT), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(game)
    log(f"{GAME_TXT}: {len(game.encode())} bytes, about {round(len(game.split()) * 1.3)} tokens")

    # static files, stamped so browsers never mix an old script with new data: each asset by its content (and its imports'),
    # the data by its content without the build's clock, so a deploy that changed nothing keeps every URL (and the caches)
    assets_src = os.path.join(SITE, "assets")
    texts = {}
    for name in os.listdir(assets_src):
        with open(os.path.join(assets_src, name), encoding="utf-8") as fh:
            texts[name] = fh.read()
    assets = asset_stamps(texts)
    data = steady(files, blobs)
    version = data_stamp(data, details)
    os.makedirs(os.path.join(DIST, "assets"))
    for name, (_, text) in assets.items():
        with open(os.path.join(DIST, "assets", name), "w", encoding="utf-8") as fh:
            fh.write(text)
    def url(m):                               # index.html's asset and data URLs
        name = m.group(1).removeprefix("assets/")
        return f'{m.group(1)}?v={assets[name][0] if name in assets else version}"'
    with open(os.path.join(SITE, "index.html"), encoding="utf-8") as fh:
        template = re.sub(r'((?:assets/[\w-]+\.(?:js|css))|data/cards\.json)"', url, fh.read()).replace("<!--BUILD-->", version)
    page = stamp_of(template.encode("utf-8"))  # the page's stamp: build.txt's 2nd line (fresh.js)
    template = template.replace("<!--PAGE-->", page)
    banner = site_banner(cards, os.path.join(DIST, "og.jpg"))
    def og_tags(title, desc, url, image="", size=None, alt=""):
        tags = [f'<meta property="og:site_name" content="{SITE_NAME}">', '<meta property="og:type" content="website">',
                f'<meta property="og:title" content="{html.escape(title)}">', f'<meta property="og:description" content="{html.escape(desc)}">',
                f'<meta name="twitter:card" content="{"summary_large_image" if image else "summary"}">']
        if url:
            tags += [f'<meta property="og:url" content="{html.escape(url)}">', f'<link rel="canonical" href="{html.escape(url)}">']
        if image:
            tags.append(f'<meta property="og:image" content="{html.escape(image)}">')
            if size:
                tags += [f'<meta property="og:image:width" content="{size[0]}">', f'<meta property="og:image:height" content="{size[1]}">']
            if alt:
                tags.append(f'<meta property="og:image:alt" content="{html.escape(alt)}">')
        return "\n".join(tags)
    site_desc = "Every card, the rulebook, a starting-hand builder and stats."
    site_og = og_tags(f"{SITE_NAME} · Card Browser", site_desc, f"{SITE_URL}/" if SITE_URL else "", f"{SITE_URL}/og.jpg" if SITE_URL else "", (1200, 630))
    with open(os.path.join(DIST, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(template.replace("<!--HEAD-->", '<base href="./">\n' + site_og + "\n" + grid_preload(cards)))
    with open(os.path.join(DIST, "404.html"), "w", encoding="utf-8") as fh:
        fh.write(template.replace("<!--HEAD-->", f'<base href="{SITE_URL}/">\n' + site_og))   # absolute: the 404 page can be served at any depth
    os.makedirs(os.path.join(DIST, "d"))                # shared hands: d/#/deck/<code>
    with open(os.path.join(DIST, "d", "index.html"), "w", encoding="utf-8") as fh:
        fh.write(template.replace("<!--HEAD-->", '<base href="../">\n' + og_tags(f"Shared starting hand · {SITE_NAME}",
                 "Open to see the hand, check it and save a copy.", f"{SITE_URL}/d/" if SITE_URL else "", f"{SITE_URL}/og.jpg" if SITE_URL else "", (1200, 630))))
    default_meta = ('<meta name="theme-color" content="#0d0d0d">', '<meta name="description" content="Every Impossibility Simulator card, the rulebook and a starting-hand builder.">')
    def share_page(parts, head):
        """DIST/<parts>/index.html: the app with its own <head> (<base> climbs back to the site root)."""
        page = template.replace("<!--HEAD-->", "\n".join([f'<base href="{"../" * len(parts)}">'] + head)).replace("<title>Impossibility Simulator · Card Browser</title>", "")
        for tag in default_meta:
            page = page.replace(tag, "")
        os.makedirs(os.path.join(DIST, *parts), exist_ok=True)
        with open(os.path.join(DIST, *parts, "index.html"), "w", encoding="utf-8") as fh:
            fh.write(page)
    def og_image(c):
        """The card's 480 px link-preview JPEG when the site has a URL, else the raw PNG."""
        if c.get("img") and SITE_URL:
            return f"{SITE_URL}/thumbs/{c['img']}-og.jpg", og_size(os.path.join(DIST, "thumbs", f"{c['img']}-og.jpg"))
        return (RAW + quote(c["png"]) if c.get("png") else ""), None
    for c in cards:
        if c.get("hidden"):
            continue
        desc, (image, size) = share_text(c), og_image(c)
        share_page(("c", c["id"]), [
            f'<meta name="card" content="{c["id"]}">',
            *([f'<link rel="preload" as="image" href="thumbs/{c["img"]}-720-{thumb_tag(720)}.avif" fetchpriority="high">'] if c.get("img") else []),   # the dialog's picture (app.js placeholderOf)
            og_tags(c["name"], desc, f"{SITE_URL}/c/{c['id']}/" if SITE_URL else "", image, size, f"{c['name']} card"),
            f'<meta name="theme-color" content="{c.get("color") or "#3987e5"}">',
            f'<meta name="description" content="{html.escape(desc)}">',
            f'<title>{html.escape(c["name"])} · {SITE_NAME}</title>',
        ])
    for p in profiles:                            # u/<login>/: the favourite card as the preview image, else the site banner
        desc = previews[p["login"]]
        fav = by_id.get(p.get("favourite") or "")
        image, size = og_image(fav) if fav and fav.get("img") else ((f"{SITE_URL}/og.jpg", (1200, 630)) if SITE_URL else ("", None))
        share_page(("u", p["login"]), [
            og_tags(p["login"], desc, f"{SITE_URL}/u/{p['login']}/" if SITE_URL else "", image, size, f"{fav['name']} card" if fav else ""),
            f'<meta name="theme-color" content="{(fav or {}).get("color") or "#3987e5"}">',
            f'<meta name="description" content="{html.escape(desc)}">',
            f'<title>{html.escape(p["login"])} · {SITE_NAME}</title>',
        ])
    for r in contrib["people"]:                   # u/<key>/ for a contributor without a profile: the same page, the site banner as its image
        if r["key"] not in previews or r["key"].lower() in with_profile:
            continue
        desc = previews[r["key"]]
        share_page(("u", r["key"]), [
            og_tags(r["key"], desc, f"{SITE_URL}/u/{r['key']}/" if SITE_URL else "", f"{SITE_URL}/og.jpg" if SITE_URL else "", (1200, 630)),
            '<meta name="theme-color" content="#3987e5">',
            f'<meta name="description" content="{html.escape(desc)}">',
            f'<title>{html.escape(r["key"])} · {SITE_NAME}</title>',
        ])
    shutil.rmtree(os.path.join(CACHE, "og"), ignore_errors=True)   # montages lived here before OG_CACHE: not in the image cache
    os.makedirs(OG_CACHE, exist_ok=True)
    montages = set()
    for d in public_decks:                        # decks/<owner>/<slug>/: a montage of its first cards, else one card, else the site banner
        hand = deck_cards(d, by_id)
        picks = [c for c in hand if c.get("img")][:OG_DECK_CARDS]
        pic = picks[0] if picks else (hand[0] if hand else None)
        desc, title = deck_text(d, by_id), f"{d['name']} by {d['owner']}"
        image, size = og_image(pic) if pic and pic.get("img") else ((f"{SITE_URL}/og.jpg", (1200, 630)) if SITE_URL else ("", None))
        alt = f"{pic['name']} card" if pic and pic.get("img") else ""
        if SITE_URL and len(picks) > 1:
            try:
                key, cached = deck_montage(picks)
                os.makedirs(os.path.join(DIST, "decks", d["owner"], d["slug"]), exist_ok=True)
                link_or_copy(cached, os.path.join(DIST, "decks", d["owner"], d["slug"], f"og-{key}.jpg"))
                montages.add(f"{key}.jpg")
                image, size, alt = f"{SITE_URL}/decks/{d['owner']}/{d['slug']}/og-{key}.jpg", (1200, 630), ", ".join(c["name"] for c in picks)
            except Exception as err:              # one card instead
                warn(f"deck {d['owner']}/{d['slug']}: no preview montage ({err})")
        share_page(("decks", d["owner"], d["slug"]), [
            f'<meta name="deck" content="{html.escape(d["owner"])}/{d["slug"]}">',
            og_tags(title, desc, f"{SITE_URL}/decks/{d['owner']}/{d['slug']}/" if SITE_URL else "", image, size, alt),
            f'<meta name="theme-color" content="{(pic or {}).get("color") or "#3987e5"}">',
            f'<meta name="description" content="{html.escape(desc)}">',
            f'<title>{html.escape(title)} · {SITE_NAME}</title>',
        ])
    for n in os.listdir(OG_CACHE) if SITE_URL else []:   # no montages without SITE_URL: keep the cache
        if n not in montages and n != banner:     # site.yml saves the cache under these names, so only the ones in use
            os.remove(os.path.join(OG_CACHE, n))
    if montages:
        log(f"deck previews: {len(montages)} montages")
    with open(os.path.join(DIST, BUILD_TXT), "w", encoding="utf-8") as fh:
        fh.write(dist_digest(data) + "\n" + page + "\n")
    log(f"site written to {DIST} (build {version}, {time.time() - started:.0f}s)")


if __name__ == "__main__":
    sys.exit(main())
