#!/usr/bin/env python3
"""Audit the TTS save against the TTSCardMaker repo.

python3 TTS/audit.py  ->  TTS/AUDIT.md, TTS/audit.json and TTS/decks.json (the rules file); the repo is this file's parent.
Read-only on the save. Stdlib only.
"""
import collections
import datetime
import difflib
import json
import os
import re
import subprocess
from urllib.parse import quote, unquote

OUT = os.path.dirname(os.path.abspath(__file__))   # TTS/
REPO = os.path.dirname(OUT)
SAVE = os.path.join(REPO, "TTS/Impossibility Simulator.json")
RULES = os.path.join(REPO, "TTS/decks.json")
EDITS = os.path.join(REPO, "site/Card Edits.json")
SITE_CARDS = os.path.join(REPO, "site/dist/data/cards.json")   # built site, optional (its names win)
RAW = "https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/"

CARD_NAMES = ("Card", "CardCustom")
BAG_NAMES = ("Bag", "Infinite_Bag", "Custom_Model_Bag")
CARD_FOLDERS = ("Creatures/", "Items/", "Field/", "N.M.E/", "Auxiliary/")   # website card folders
DISK_ROOTS = ("Auxiliary", "Creatures", "Field", "Items", "N.M.E", "Types", "MDW", "TTS")
COVERAGE_FULL = 0.85        # share of a rule's repo cards a deck must hold to count as complete
KIND_MIN = 0.75             # share of one kind below which a deck is "mixed"

# folder globs per kind; {s} = stars
KIND_GLOBS = {
    "creatures": "Creatures/*/{s} Stars/*.png",
    "items": "Items/*/{s} Stars/*.png",
    "fields": "Field/{s} Stars/*.png",
}
FIXED_GLOBS = {
    "nme": ["N.M.E/*.png"],
    "minions": ["Auxiliary/Minions/*.png"],
    "auxiliary_items": ["Auxiliary/Items/*.png"],
    "auxiliary_creatures": ["Auxiliary/Creatures/*.png"],
    "status_effects": ["Auxiliary/Status Effects/Buffs/*.png", "Auxiliary/Status Effects/Debuffs/* Stars/*.png"],
    "rulebook": ["Auxiliary/Rulebook/*.png"],
    "morgue": ["MDW/The Morgue/*.png"],
    "markers": ["Auxiliary/Markers/*.png"],
    "types": ["Types/*.png", "Types/Stars/*.png"],
}
KIND_LABEL = {"creatures": "creatures", "items": "items", "fields": "fields", "nme": "N.M.E", "minions": "minions",
              "auxiliary_items": "auxiliary items", "auxiliary_creatures": "auxiliary creatures (large cards)",
              "status_effects": "status effects", "rulebook": "rulebook pages", "morgue": "The Morgue (retired cards)",
              "markers": "markers", "types": "type icons", "holders": "holders", "card_backs": "card backs",
              "mdw": "MDW files", "other": "other"}


# ---- shared helpers (the updater reuses these) ---------------------------------------------------
def repo_tree(repo=REPO):
    """Paths in git HEAD."""
    out = subprocess.run(["git", "-C", repo, "ls-tree", "-r", "HEAD", "--name-only", "-z"],
                         check=True, capture_output=True).stdout.decode("utf-8")
    return {p for p in out.split("\0") if p}


def git_list(args, repo=REPO):
    """NUL-separated git file list."""
    out = subprocess.run(["git", "-C", repo] + args + ["-z"], capture_output=True).stdout.decode("utf-8", "replace")
    return [p for p in out.split("\0") if p]


def repo_head(repo=REPO):
    return subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()


def disk_tree(repo=REPO, roots=DISK_ROOTS):
    """Files on disk under the image folders (no .DS_Store)."""
    found = set()
    for root in roots:
        for folder, dirs, files in os.walk(os.path.join(repo, root)):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for f in files:
                if f != ".DS_Store":
                    found.add(os.path.relpath(os.path.join(folder, f), repo).replace(os.sep, "/"))
    return found


def url_to_path(url):
    """Repo image URL -> (path, ref); ref is 'main', 'refs/heads/main' or a commit sha. (None, None) if not ours."""
    if not isinstance(url, str) or not url.startswith(RAW):
        return None, None
    rest = unquote(url[len(RAW):]).strip()
    for ref in ("refs/heads/main/", "main/"):
        if rest.startswith(ref):
            return rest[len(ref):], ref.rstrip("/")
    m = re.match(r"([0-9a-f]{7,40})/(.+)$", rest)
    if m:
        return m.group(2), m.group(1)
    return None, None


def path_to_url(path, ref="main"):
    """Repo path -> raw URL, encoded the way the save does (%20, %2C, %26; ' and ! literal)."""
    return RAW + ref + "/" + quote(path, safe="/'!()*-._~")


def path_info(path):
    """Repo path -> {"kind", "stars", "subtype", "series"} from its folders."""
    parts = (path or "").split("/")
    info = {"kind": "other", "stars": None, "subtype": None, "series": None}
    if len(parts) >= 2:
        m = re.match(r"(\d+)\s*Stars?$", parts[len(parts) - 2])
        info["stars"] = int(m.group(1)) if m else None
    top = parts[0]
    sub = parts[1] if len(parts) > 2 else None
    if top == "Creatures":
        info.update(kind="creatures", series=sub)
    elif top == "Items":
        info.update(kind="items", subtype=sub)
    elif top == "Field":
        info["kind"] = "fields"
    elif top == "N.M.E":
        info["kind"] = "nme"
    elif top == "Types":
        info.update(kind="types", subtype="stars" if sub == "Stars" else None)
    elif top == "Auxiliary" and sub:
        info["kind"] = {"Minions": "minions", "Items": "auxiliary_items", "Creatures": "auxiliary_creatures",
                        "Status Effects": "status_effects", "Rulebook": "rulebook", "Markers": "markers"}.get(sub, "other")
        if sub == "Status Effects":
            info["subtype"] = "debuffs" if "Debuffs" in parts else "buffs"
    elif top == "MDW":
        if sub == "The Morgue":
            info["kind"] = "morgue"
        elif sub == "Holders":
            info["kind"] = "holders"
        elif len(parts) == 2 and parts[1].startswith("cardback"):
            info["kind"] = "card_backs"
        else:
            info["kind"] = "mdw"
    return info


def card_key(name):
    """Card Edits.json key: case-insensitive, _ = space, whitespace collapsed (as build_site.py)."""
    return " ".join((name or "").replace("_", " ").lower().split())


def norm(text):
    """Loose name key: case, spaces, _ - . ' don't matter (as build_site.py)."""
    return re.sub(r"[\s_\-.'’]+", "", (text or "").lower())


def stem_name(path):
    """File stem with underscores as spaces."""
    return os.path.splitext(os.path.basename(path))[0].replace("_", " ")


def load_edits(path=EDITS):
    """{card_key: fields} from site/Card Edits.json."""
    try:
        cards = json.load(open(path, encoding="utf-8")).get("cards") or {}
    except (OSError, ValueError, AttributeError):
        return {}
    return {card_key(k): v for k, v in cards.items() if isinstance(v, dict)}


def duplicate_of(path, lower_tree):
    """'<Name>N.png' with no PSD of its own and an original '<Name>.psd' -> that PSD path, else None.
    lower_tree: the repo paths lowercased."""
    m = re.match(r"(.+?)(\d+)\.png$", path, re.I)
    if not m or not path.startswith(CARD_FOLDERS) or (m.group(1) + m.group(2) + ".psd").lower() in lower_tree:
        return None
    original = m.group(1) + ".psd"
    return original if original.lower() in lower_tree else None


def load_site_names(path=SITE_CARDS):
    """{png path: website name} from the built site's cards.json (if present)."""
    try:
        cards = json.load(open(path, encoding="utf-8"))["cards"]
    except (OSError, ValueError, KeyError, TypeError):
        return {}
    return {c["png"]: c["name"] for c in cards if c.get("png")}


def psd_beside(path, by_lower):
    """The PSD next to a PNG, matched case-insensitively (Abbi.png -> ABBI.psd), else None.
    by_lower: {lowercased repo path: [paths]}."""
    found = (by_lower or {}).get(os.path.splitext(path)[0].lower() + ".psd")
    return found[0] if found else None


def website_name(path, edits=None, site_names=None, by_lower=None):
    """The card browser's name for a PNG: Card Edits.json name > built site's name > PSD stem > PNG stem (_ as space).
    A parsed card is keyed by its PSD stem, so case follows the PSD."""
    psd = psd_beside(path, by_lower)
    key = stem_name(psd or path)
    found = (edits or {}).get(card_key(key))
    if found and isinstance(found.get("name"), str) and found["name"].strip():
        return found["name"]
    if site_names and path in site_names:
        return site_names[path]
    return key


def glob_regex(pattern):
    """'*' = one path segment part, '**' = anything."""
    out = ""
    for tok in re.split(r"(\*\*|\*|\?)", pattern):
        out += {"**": ".*", "*": "[^/]*", "?": "[^/]"}.get(tok, re.escape(tok))
    return re.compile(out + r"\Z")


_GLOBS = {}


def glob_match(pattern, path):
    if pattern not in _GLOBS:
        _GLOBS[pattern] = glob_regex(pattern)
    return bool(_GLOBS[pattern].match(path))


def rule_matches(rule, path):
    """A path belongs to a rule: listed in include, or matched by a folder glob (and not excluded)."""
    if not rule or not path:
        return False
    if path in rule.get("include", []):
        return True
    if path in rule.get("exclude", []):
        return False
    return any(glob_match(g, path) for g in rule.get("folders", []))


def rule_cards(rule, tree):
    """Repo PNGs a rule covers."""
    return sorted(p for p in tree if p.lower().endswith(".png") and rule_matches(rule, p))


def walk(objects, parents=()):
    """Every object with its chain of containers (outermost first); includes States."""
    for o in objects or []:
        yield o, parents
        yield from walk(o.get("ContainedObjects"), parents + (o,))
        for state in (o.get("States") or {}).values():
            yield from walk([state], parents + (o,))


def card_urls(card):
    """(FaceURL, BackURL, CustomDeck id) of a card object."""
    deck_id = str(card.get("CardID", 0) // 100) if isinstance(card.get("CardID"), int) else None
    cd = card.get("CustomDeck") or {}
    entry = cd.get(deck_id) or (next(iter(cd.values())) if cd else {})   # stale key: first entry
    return entry.get("FaceURL"), entry.get("BackURL"), deck_id


def stale_card_keys(card):
    """Keys of a card's own CustomDeck when none is its CardID's id (else [])."""
    cd = card.get("CustomDeck") or {}
    if not isinstance(card.get("CardID"), int) or str(card["CardID"] // 100) in cd:
        return []
    return list(cd)


def lua_resize_targets(lua):
    """Keys of the global Lua resizeTargets table."""
    m = re.search(r"resizeTargets\s*=\s*\{(.*?)\n\}", lua or "", re.S)
    return re.findall(r'\[\s*"((?:[^"\\]|\\.)*)"\s*\]\s*=\s*true', m.group(1)) if m else []


def uniq(seq):
    return list(dict.fromkeys(seq))


# ---- audit -------------------------------------------------------------------------------------------
def pos(o):
    t = o.get("Transform") or {}
    return round(t.get("posX", 0.0), 1), round(t.get("posZ", 0.0), 1)


def stars_text(stars):
    return "all" if not stars else "/".join(str(s) for s in stars) + "★"


def kind_rule(kind, stars):
    """Base rule for a kind (+ stars)."""
    if kind in KIND_GLOBS:
        return {"kind": kind, "stars": list(stars), "folders": [KIND_GLOBS[kind].format(s=s) for s in stars]}
    if kind in FIXED_GLOBS:
        return {"kind": kind, "stars": [], "folders": list(FIXED_GLOBS[kind])}
    return None


def rule_from_name(name):
    """Empty decks: guess from the deck's name ('3 Star Equips')."""
    m = re.match(r"(\d)\s*Stars?\s+(Equips?|Attack Items?|Heal(?:ing)? Items?|Support Items?)$", name or "", re.I)
    if not m:
        return None
    word = m.group(2).split()[0].lower()
    sub = "Equip" if word.startswith("equip") else "Heal" if word.startswith("heal") else word.capitalize()
    s = int(m.group(1))
    return {"kind": "items", "stars": [s], "subtype": sub, "folders": [f"Items/{sub}/{s} Stars/*.png"]}


LABEL_WORDS = {"creatures": "creature", "items": "items", "fields": "field", "nme": "n.m.e", "status_effects": "status",
               "minions": "minion", "auxiliary_items": "auxiliary"}


def label_fits(label, kind):
    """A tile name that names this kind ('Items' but not 'Field Items' for items)."""
    low = (label or "").lower()
    word = LABEL_WORDS.get(kind)
    if not word or word not in low:
        return False
    return kind != "items" or not any(w in low for w in ("field", "n.m.e", "auxiliary"))


def rule_text(rule):
    if not rule:
        return "none"
    t = f"{KIND_LABEL.get(rule['kind'], rule['kind'])}"
    if rule.get("stars"):
        t += f" {stars_text(rule['stars'])}"
    if rule.get("subtype"):
        t += f" {rule['subtype']}"
    if rule.get("partial"):
        t += " (hand-picked subset)"
    extra = []
    base = kind_rule(rule["kind"], rule.get("stars") or []) or {"folders": []}
    for f in rule.get("folders", []):
        if f not in base["folders"] and not rule.get("subtype"):
            extra.append(f"+ {f.rsplit('/', 1)[0]}")
    if rule.get("include"):
        extra.append(f"+{len(rule['include'])} listed card(s)")
    if rule.get("exclude"):
        extra.append(f"-{len(rule['exclude'])} excluded")
    return t + (", " + ", ".join(extra) if extra else "")


def main():
    raw_size = os.path.getsize(SAVE)
    save = json.load(open(SAVE, encoding="utf-8"))
    tree = repo_tree()
    head = repo_head()
    lower_tree = {p.lower() for p in tree}
    by_lower = collections.defaultdict(list)
    for p in tree:
        by_lower[p.lower()].append(p)
    disk = disk_tree()
    edits = load_edits()
    site_names = load_site_names()
    pngs = {p for p in tree if p.lower().endswith(".png")}
    tops = save.get("ObjectStates") or []
    everything = list(walk(tops))
    guid_of = lambda o: o.get("GUID", "")

    def where(parents):
        return " > ".join(f"{p.get('Name')} '{p.get('Nickname') or p.get('GUID')}'" for p in parents) or "table"

    # labels: named tiles on the table
    labels = [(pos(o), o.get("Nickname")) for o in tops if o.get("Name") == "Custom_Tile" and (o.get("Nickname") or "").strip()]

    def label_for(o, kind=None):
        """Nearest named tile within 10 units; tiles naming the deck's kind win."""
        x, z = pos(o)
        best = None
        for (lx, lz), name in labels:
            d = ((lx - x) ** 2 + (lz - z) ** 2) ** 0.5
            fits = label_fits(name, kind)
            if d <= 10 and (best is None or (fits, -d) > (best[2], -best[0])):
                best = (d, name, fits)
        if not best:
            return None
        return ("on " if best[0] < 1 else "near ") + f"'{best[1]}'"

    # ---- every URL in the save
    url_refs = []                     # (url, key, obj, parents)
    def scan_urls(o, parents):
        def rec(x, k):
            if isinstance(x, dict):
                for kk, v in x.items():
                    if kk not in ("ContainedObjects", "States"):
                        rec(v, kk)
            elif isinstance(x, list):
                for v in x:
                    rec(v, k)
            elif isinstance(x, str):
                if x.startswith("http") and k.endswith("URL"):
                    url_refs.append((x, k, o, parents))
                elif "http" in x and k in ("LuaScriptState", "LuaScript", "XmlUI"):
                    for u in re.findall(r'https?://[^"\s\\]+', x):
                        url_refs.append((u, k + " (embedded)", o, parents))
        rec(o, None)
    for o, parents in everything:
        scan_urls(o, parents)
    for u in re.findall(r'https?://[^"\s\\]+', save.get("LuaScript", "") + save.get("XmlUI", "") + save.get("LuaScriptState", "")):
        url_refs.append((u, "global script (embedded)", {"Name": "Global", "GUID": "-1"}, ()))

    # ---- cards
    cards = []                        # dicts per card object
    for o, parents in everything:
        if o.get("Name") not in CARD_NAMES:
            continue
        face, back, deck_id = card_urls(o)
        fpath, fref = url_to_path(face)
        bpath, bref = url_to_path(back)
        container = parents[len(parents) - 1] if parents else None
        cards.append({"obj": o, "guid": guid_of(o), "name": o.get("Nickname") or "", "face": face, "back": back,
                      "path": fpath, "ref": fref, "back_path": bpath, "deck_id": deck_id, "parents": parents,
                      "container": container, "info": path_info(fpath), "stale": stale_card_keys(o)})

    def card_role(c):
        cont = c["container"]
        if cont is None:
            return "loose"
        if cont.get("Name") == "Deck":
            return "deck"
        if c["info"]["kind"] == "rulebook":
            return "rulebook"
        if c["info"]["kind"] == "markers":
            return "marker"
        return "bag"
    for c in cards:
        c["role"] = card_role(c)

    # ---- decks
    deck_objs = [(o, parents) for o, parents in everything if o.get("Name") == "Deck"]
    decks = {}
    for o, parents in deck_objs:
        g = guid_of(o)
        mine = [c for c in cards if c["container"] is o]
        paths = [c["path"] for c in mine]
        folders = collections.Counter(p.rsplit("/", 1)[0] if p else "(not a repo link)" for p in paths)
        backs = collections.Counter(c["back_path"] or c["back"] for c in mine)
        counts = collections.Counter(paths)
        decks[g] = {"guid": g, "obj": o, "name": o.get("Nickname") or "", "parents": parents, "cards": mine,
                    "paths": paths, "folders": folders, "backs": backs, "counts": counts,
                    "where": where(parents), "pos": pos(o), "label": None,
                    "scale": collections.Counter(round((c["obj"].get("Transform") or {}).get("scaleX", 0), 2) for c in mine)}

    # infer a base rule per deck
    for d in decks.values():
        paths = [p for p in d["paths"] if p]
        d["notes"] = []
        if not d["cards"]:
            r = rule_from_name(d["name"])
            d["rule"], d["confidence"] = r, ("low" if r else None)
            d["reason"] = "empty deck; rule guessed from its name" if r else "empty deck, name gives no rule"
            d["base"] = r
            continue
        kinds = collections.Counter(path_info(p)["kind"] for p in paths)
        kind, n = kinds.most_common(1)[0]
        share = n / len(d["paths"])
        if share < KIND_MIN or (kind not in KIND_GLOBS and kind not in FIXED_GLOBS):
            d["rule"], d["base"], d["confidence"] = None, None, None
            d["reason"] = "mixed: " + ", ".join(f"{k} {v}" for k, v in kinds.most_common())
            continue
        stars = []
        if kind in KIND_GLOBS:
            sc = collections.Counter(path_info(p)["stars"] for p in paths if path_info(p)["kind"] == kind)
            main_star, m = sc.most_common(1)[0]
            stars = [main_star] if m / n >= 0.9 else sorted(s for s in sc if s is not None)
        d["base"] = kind_rule(kind, stars)
        d["kind_share"] = share

    # extra folders: off-rule cards that make up most of a repo folder join the rule as a glob
    for d in decks.values():
        b = d.get("base")
        if not b or not d["cards"]:
            continue
        off = collections.Counter(p.rsplit("/", 1)[0] for p in set(d["paths"]) if p and not rule_matches(b, p))
        for folder, k in off.items():
            in_repo = [p for p in pngs if p.rsplit("/", 1)[0] == folder]
            if k >= 3 and in_repo and k / len(in_repo) >= 0.5:
                b["folders"].append(folder + "/*.png")
                d.setdefault("extra_folders", []).append(folder + "/*.png")

    # group by base rule; full vs hand-picked subset
    def bkey(b):
        return json.dumps({k: b.get(k) for k in ("kind", "stars", "folders")}, sort_keys=True) if b else None
    for d in decks.values():
        b = d.get("base")
        if not b or not d["cards"]:
            d["coverage"] = None
            continue
        expect = rule_cards(b, tree)
        have = {p for p in d["paths"] if p and rule_matches(b, p)}
        d["coverage"] = (len(have & set(expect)) / len(expect)) if expect else 1.0
        d["partial"] = d["coverage"] < COVERAGE_FULL
    groups = collections.defaultdict(list)
    for g, d in decks.items():
        if not d.get("base") or not d["cards"]:
            groups[("solo", g)].append(g)
        elif d["partial"]:
            groups[(bkey(d["base"]), "partial", frozenset(p for p in d["paths"] if p))].append(g)
        else:
            groups[(bkey(d["base"]), "full")].append(g)
    # empty decks with the same guessed rule are copies too
    for g, d in list(decks.items()):
        if not d["cards"] and d.get("base"):
            groups.pop(("solo", g), None)
            groups[(bkey(d["base"]), "empty")].append(g)

    # final rule per group: include = off-rule cards found in any copy
    for key, members in groups.items():
        for g in members:
            decks[g]["copies"] = [m for m in members if m != g]
            decks[g]["group"] = members
        lead = decks[members[0]]
        if not lead.get("base") or not lead["cards"]:
            for g in members:
                d = decks[g]
                d.setdefault("rule", d.get("base"))
                if d.get("rule") and "confidence" not in d:
                    d["confidence"] = "low"
            continue
        base = lead["base"]
        include = sorted({p for g in members for p in decks[g]["paths"] if p and not rule_matches(base, p)})
        rule = dict(base)
        if include:
            rule["include"] = include
        if lead["partial"]:
            rule["partial"] = True
        counts = collections.Counter(n for g in members for n in decks[g]["counts"].values())
        rule["count"] = counts.most_common(1)[0][0]
        kind_only = kind_rule(base["kind"], base.get("stars") or [])
        unexpected_share = max(sum(1 for p in decks[g]["paths"] if not p or not rule_matches(kind_only, p)) / len(decks[g]["paths"]) for g in members)
        extra = lead.get("extra_folders") or []
        backs_ok = all(len(decks[g]["backs"]) == 1 for g in members)
        if lead["partial"]:
            conf, why = "medium", f"{lead['coverage']:.0%} of the rule's repo cards: a hand-picked subset, its own card list is the rule"
        elif unexpected_share == 0 and backs_ok:
            conf, why = "high", "every card is from the kind's folders, one back"
        elif unexpected_share <= 0.25:
            conf, why = "medium", (f"{unexpected_share:.0%} of cards come from outside the kind's folders: "
                                   + ", ".join(([f"extra folder {', '.join(extra)}"] if extra else []) + ([f"{len(include)} listed card(s)"] if include else [])))
        else:
            conf, why = "low", f"{unexpected_share:.0%} of cards outside the rule"
        if not backs_ok:
            why += "; mixed backs"
        for g in members:
            d = decks[g]
            d["rule"], d["confidence"], d["reason"] = rule, conf, why

    # a card a complete rule covers but that sits only in another deck as a listed card: excluded here
    listed_in = collections.defaultdict(set)
    for members in groups.values():
        for p in (decks[members[0]].get("rule") or {}).get("include", []):
            listed_in[p].update(members)
    for members in groups.values():
        r = decks[members[0]].get("rule")
        if not r or r.get("partial") or not decks[members[0]]["cards"]:
            continue
        have = {p for g in members for p in decks[g]["paths"]}
        ex = [p for p in rule_cards(r, tree) if p not in have and listed_in.get(p) and not listed_in[p] & set(members)]
        if ex:
            r["exclude"] = ex

    for d in decks.values():
        if not d["parents"]:
            d["label"] = label_for(d["obj"], (d.get("rule") or {}).get("kind"))

    # per deck: missing, unexpected, copy counts, duplicates
    for d in decks.values():
        r = d.get("rule")
        d["missing"], d["unexpected"], d["odd_counts"], d["dups"] = [], [], [], []
        if r and d["cards"]:
            have = set(d["paths"])
            if not r.get("partial"):
                d["missing"] = [p for p in rule_cards(r, tree) if p not in have]
            else:
                # subset decks: only report cards a copy lacks vs the others
                union = {p for g in d["group"] for p in decks[g]["paths"] if p}
                d["missing"] = sorted(union - have)
            kind_only = kind_rule(r["kind"], r.get("stars") or [])
            d["unexpected"] = sorted({p for p in d["paths"] if not p or not rule_matches(kind_only, p)}, key=lambda p: p or "")
            want = r.get("count")
            d["odd_counts"] = sorted((p, n) for p, n in d["counts"].items() if n != want)
        # same image under several CustomDeck ids, same Nickname on several images
        ids_by_path = collections.defaultdict(set)
        paths_by_name = collections.defaultdict(set)
        for c in d["cards"]:
            ids_by_path[c["path"] or c["face"]].add(c["deck_id"])
            paths_by_name[c["name"]].add(c["path"] or c["face"])
        d["dups"] = [("image under several deck ids", p, sorted(ids)) for p, ids in ids_by_path.items() if len(ids) > 1]
        d["dups"] += [("one Nickname, several images", n, sorted(ps)) for n, ps in paths_by_name.items() if len(ps) > 1 and n]

    # ---- names
    def site_card(path):
        return bool(path) and path.startswith(CARD_FOLDERS) and "/Markers/" not in path and "/Rulebook/" not in path
    name_pairs = collections.Counter()
    empty_names = collections.Counter()
    for c in cards:
        if not site_card(c["path"]):
            continue
        if not c["name"].strip():
            empty_names[c["path"]] += 1
            continue
        name_pairs[(c["path"], c["name"])] += 1
    nicks_by_path = collections.defaultdict(collections.Counter)
    for (path, nick), n in name_pairs.items():
        nicks_by_path[path][nick] += n
    split_names = {p: dict(c) for p, c in nicks_by_path.items() if len(c) > 1}
    mismatches = []
    for (path, nick), n in sorted(name_pairs.items()):
        site = website_name(path, edits, site_names, by_lower)
        if nick == site:
            continue
        kind = "case/spacing/punctuation only" if norm(nick) == norm(site) else "different"
        mismatches.append({"path": path, "nickname": nick, "website": site, "objects": n, "kind": kind,
                           "duplicate_png": bool(duplicate_of(path, lower_tree))})

    # ---- backs by kind (deck, loose and bag cards; not markers or rulebook pages)
    back_by_kind = collections.defaultdict(collections.Counter)
    for c in cards:
        if c["role"] in ("deck", "loose", "bag"):
            back_by_kind[c["info"]["kind"]][c["back_path"] or c["back"]] += 1
    back_major = {k: v.most_common(1)[0][0] for k, v in back_by_kind.items()}
    wrong_backs = []
    for c in cards:
        if c["role"] in ("deck", "loose", "bag"):
            want = back_major[c["info"]["kind"]]
            have = c["back_path"] or c["back"]
            if have != want:
                wrong_backs.append({"guid": c["guid"], "name": c["name"], "path": c["path"], "back": have, "expected": want,
                                    "where": where(c["parents"])})

    # ---- images not in the repo
    ref_counter = collections.Counter()
    not_in_repo, odd_links, external = {}, {}, collections.Counter()
    for url, key, o, parents in url_refs:
        path, ref = url_to_path(url)
        if path is None:
            external[(url, key, o.get("Name"), o.get("Nickname") or "")] += 1
            continue
        ref_counter[ref] += 1
        if ref != "main":
            odd_links.setdefault(url, []).append(f"{o.get('Name')} {o.get('GUID')} '{o.get('Nickname') or ''}' ({key}, in {where(parents)})")
        if path not in tree:
            e = not_in_repo.setdefault(path, {"path": path, "refs": 0, "objects": set(), "on_disk": os.path.exists(os.path.join(REPO, path)),
                                              "case_match": by_lower.get(path.lower(), [])})
            e["refs"] += 1
            e["objects"].add(f"{o.get('Name')} `{o.get('GUID')}` '{o.get('Nickname') or ''}'")

    # ---- non-card image objects (and marker cards / rulebook pages)
    table_cards = {id(c["obj"]) for c in cards if c["role"] in ("deck", "loose", "bag")}
    objects = collections.OrderedDict()
    for url, key, o, parents in url_refs:
        if id(o) in table_cards:
            continue
        if o.get("Name") == "Deck":
            continue
        path, ref = url_to_path(url)
        ident = path or url
        e = objects.setdefault(ident, {"image": ident, "repo": path is not None, "in_git": path in tree if path else None,
                                       "on_disk": os.path.exists(os.path.join(REPO, path)) if path else None,
                                       "keys": set(), "objects": collections.Counter(), "guids": []})
        e["keys"].add(key)
        e["objects"][f"{o.get('Name')} '{o.get('Nickname') or ''}'" + (f" in {parents[len(parents) - 1].get('Nickname')}" if parents else "")] += 1
        e["guids"].append(o.get("GUID"))
    imageless = collections.Counter(o.get("Name") for o, p in everything
                                    if o.get("Name") not in CARD_NAMES + ("Deck",) and not any(r[2] is o for r in url_refs))

    # ---- Lua large cards
    lua_keys = lua_resize_targets(save.get("LuaScript", ""))
    aux = sorted(p for p in pngs if p.startswith("Auxiliary/Creatures/"))
    aux_site = {p: website_name(p, edits, site_names, by_lower) for p in aux}
    aux_nicks = collections.defaultdict(collections.Counter)
    for c in cards:
        if c["path"] in aux_site:
            aux_nicks[c["path"]][c["name"]] += 1
    large = []
    for p in aux:
        nicks = sorted(aux_nicks[p])
        large.append({"png": p, "website": aux_site[p], "save_nicknames": nicks,
                      "in_lua": [k for k in lua_keys if k in nicks or k == aux_site[p] or card_key(k) == card_key(aux_site[p])],
                      "lua_exact": any(k in nicks for k in lua_keys) if nicks else aux_site[p] in lua_keys})
    lua_orphans = [k for k in lua_keys if not any(k in e["in_lua"] for e in large)]
    lua_named_cards = collections.Counter((c["name"], c["path"]) for c in cards if c["name"] in lua_keys and c["path"] not in aux_site)

    # ---- bags
    bags = []
    for o, parents in everything:
        if o.get("Name") in BAG_NAMES:
            held = collections.Counter(f"{x.get('Name')}" for x in o.get("ContainedObjects") or [])
            bags.append({"guid": guid_of(o), "name": o.get("Nickname") or "", "type": o.get("Name"), "where": where(parents),
                         "pos": pos(o), "holds": dict(held), "obj": o})
    rule_pages = sorted(p for p in pngs if p.startswith("Auxiliary/Rulebook/"))
    bag_pages = collections.Counter(c["path"] for c in cards if c["role"] == "rulebook")
    type_pngs = sorted(p for p in pngs if p.startswith("Types/"))
    type_tokens = collections.Counter()
    type_bag = next((b for b in bags if b["name"] == "Creature Types"), None)
    if type_bag:
        for x in type_bag["obj"].get("ContainedObjects") or []:
            type_tokens[url_to_path((x.get("CustomImage") or {}).get("ImageURL"))[0]] += 1

    # ---- integrity
    id_faces = collections.defaultdict(set)
    id_users = collections.Counter()
    for c in cards:
        if c["deck_id"]:
            id_faces[c["deck_id"]].add((c["face"], c["back"]))
            id_users[c["deck_id"]] += 1
        for k, v in (c["obj"].get("CustomDeck") or {}).items():     # own map keys too (stale ones)
            id_faces[k].add((v.get("FaceURL"), v.get("BackURL")))
    stale_keys = [c for c in cards if c["stale"]]
    stale_ids = {k for c in stale_keys for k in c["stale"]}
    for d in decks.values():
        for k, v in (d["obj"].get("CustomDeck") or {}).items():
            id_faces[k].add((v.get("FaceURL"), v.get("BackURL")))
    id_conflicts = {k: sorted(v) for k, v in id_faces.items() if len(v) > 1}
    deckid_mismatch = [g for g, d in decks.items() if [c["obj"].get("CardID") for c in d["cards"]] != list(d["obj"].get("DeckIDs") or [])]
    deck_cd_missing = [g for g, d in decks.items() if any(c["deck_id"] not in (d["obj"].get("CustomDeck") or {}) for c in d["cards"])]
    card_entry_mismatch = []
    for g, d in decks.items():
        cd = d["obj"].get("CustomDeck") or {}
        for c in d["cards"]:
            e = cd.get(c["deck_id"])
            if e and (e.get("FaceURL"), e.get("BackURL")) != (c["face"], c["back"]):
                card_entry_mismatch.append((g, c["guid"], c["name"]))
    guid_count = collections.Counter(guid_of(o) for o, p in everything)
    dup_guids = {k: n for k, n in guid_count.items() if n > 1}
    max_deck_id = max((int(k) for k in id_faces if k.isdigit()), default=0)
    cardid_bad = [c for c in cards if isinstance(c["obj"].get("CardID"), int) and c["obj"]["CardID"] % 100 != 0]

    # ---- repo vs disk
    in_git_not_disk = sorted(p for p in tree if p.startswith(tuple(r + "/" for r in DISK_ROOTS)) and p not in disk)
    ignored = set(git_list(["ls-files", "--others", "--ignored", "--exclude-standard"]))
    on_disk_not_git = sorted(p for p in disk if p not in tree and p not in ignored)
    ignored_dirs = collections.Counter(p.rsplit("/", 1)[0].split("/.venv")[0] for p in disk if p in ignored)
    save_paths = {url_to_path(u)[0] for u, *_ in url_refs if url_to_path(u)[0]}
    save_not_disk = sorted(p for p in save_paths if p in tree and p not in disk)

    # ---- totals
    top_names = collections.Counter(o.get("Name") for o in tops)
    all_names = collections.Counter(o.get("Name") for o, p in everything)
    roles = collections.Counter(c["role"] for c in cards)
    repo_urls = [(u, k) for u, k, *_ in url_refs if url_to_path(u)[0]]
    distinct_imgs = {url_to_path(u)[0] for u, k in repo_urls}
    deck_card_faces = {c["path"] for c in cards if c["role"] == "deck" and c["path"]}
    card_faces = {c["path"] for c in cards if c["path"]}
    card_images = card_faces | {c["back_path"] for c in cards if c["back_path"]}
    card_link_objs = sum(1 for u, k, o, p in url_refs if o.get("Name") in CARD_NAMES and k in ("FaceURL", "BackURL"))
    deck_level_links = sum(1 for u, k, o, p in url_refs if o.get("Name") == "Deck")
    nonc = {k for k, e in objects.items()}
    img_links = {url_to_path(u)[0] for u, k, o, p in url_refs if k not in ("FaceURL", "BackURL") and "embedded" not in k and url_to_path(u)[0]}
    script_imgs = {url_to_path(u)[0] for u, k, o, p in url_refs if "embedded" in k and url_to_path(u)[0]} - img_links
    nonc_card_imgs = {k for k, e in objects.items() if e["repo"]} - img_links - script_imgs   # marker/rulebook faces
    nonc_external = sum(1 for e in objects.values() if not e["repo"])
    def conf_group(d):
        if not d["cards"]:
            return "empty, rule from the name"
        if (d.get("rule") or {}).get("partial"):
            return "hand-picked"
        return KIND_LABEL.get((d.get("rule") or {}).get("kind"), "no rule")
    conf_counts = collections.Counter(d.get("confidence") or "none" for d in decks.values())
    conf_parts = {cf: collections.Counter(conf_group(d) for d in decks.values() if (d.get("confidence") or "none") == cf) for cf in conf_counts}
    full_missing = {p for d in decks.values() if d["cards"] and d.get("rule") and not d["rule"].get("partial") for p in d["missing"]}
    rule_excluded = {p for d in decks.values() if d.get("rule") for p in d["rule"].get("exclude", [])}
    used_ids = {c["deck_id"] for c in cards if c["deck_id"]}
    shared_ids = sum(1 for k in used_ids if id_users[k] > 1)
    totals = {
        "save_bytes": raw_size, "tts_version": save.get("VersionNumber"), "save_name": save.get("SaveName"),
        "top_level_objects": len(tops), "top_level_by_type": dict(top_names.most_common()),
        "all_objects": len(everything), "all_by_type": dict(all_names.most_common()),
        "decks": len(decks), "decks_top_level": sum(1 for d in decks.values() if not d["parents"]),
        "decks_in_bags": sum(1 for d in decks.values() if d["parents"]), "empty_decks": sum(1 for d in decks.values() if not d["cards"]),
        "card_objects": len(cards), "card_objects_by_name": dict(collections.Counter(c["obj"]["Name"] for c in cards)),
        "card_objects_by_place": dict(roles),
        "url_strings": len(url_refs), "repo_urls": len(repo_urls), "repo_urls_by_ref": dict(ref_counter),
        "external_urls": sum(external.values()),
        "card_face_back_links_on_card_objects": card_link_objs, "deck_level_customdeck_links": deck_level_links,
        "distinct_repo_images": len(distinct_imgs), "distinct_card_faces": len(card_faces),
        "distinct_deck_card_faces": len(deck_card_faces), "distinct_card_images_with_backs": len(card_images),
        "non_card_table_rows": len(nonc), "distinct_image_link_images": len(img_links), "script_only_images": sorted(script_imgs),
        "non_card_table_card_images": len(nonc_card_imgs), "non_card_table_external": nonc_external,
        "deck_confidence": {cf: dict(conf_parts[cf]) for cf in conf_counts},
        "missing_from_complete_decks": len(full_missing), "excluded_in_rules": len(rule_excluded),
        "card_links": sum(1 for u, k, o, p in url_refs if k in ("FaceURL", "BackURL") and url_to_path(u)[0]),
        "card_links_main": sum(1 for u, k, o, p in url_refs if k in ("FaceURL", "BackURL") and url_to_path(u)[1] == "main"),
        "non_card_links": sum(1 for u, k, o, p in url_refs if k not in ("FaceURL", "BackURL") and "embedded" not in k and url_to_path(u)[0]),
        "embedded_links": sum(1 for u, k, o, p in url_refs if "embedded" in k and url_to_path(u)[0]),
        "distinct_faces_in_repo": len({p for p in card_faces if p in tree}),
        "customdeck_ids_used_by_cards": len(used_ids), "customdeck_ids_shared": shared_ids, "max_customdeck_id": max_deck_id,
        "repo_files_head": len(tree), "repo_pngs_head": len(pngs), "repo_head": head,
    }

    # ---- where each image sits, renames
    place_of = collections.defaultdict(collections.Counter)
    for c in cards:
        if c["path"]:
            cont = c["container"]
            dk = decks.get(guid_of(cont)) if cont is not None else None
            place = (f"`{guid_of(cont)}` {cont.get('Nickname') or '(unnamed)'}" + (f" ({dk['label'].split(' ', 1)[1].strip(chr(39))})" if dk and dk["label"] else "")
                     if cont is not None and cont.get("Name") == "Deck"
                     else "loose on the table" if cont is None else f"bag '{cont.get('Nickname')}'")
            place_of[c["path"]][place] += 1
    in_save = set(place_of)

    def elsewhere(path, skip=()):
        """Where else the save holds this image."""
        spots = [p for p in place_of.get(path, {}) if not any(p.startswith(f"`{g}`") for g in skip)]
        if spots:
            return ", ".join(spots)
        return "nowhere in the save" if not skip or path not in place_of else "only here"

    renamed = {}                      # old missing path -> likely new repo path
    for old in not_in_repo:
        folder = old.rsplit("/", 1)[0]
        best = max(((difflib.SequenceMatcher(None, stem_name(old).lower(), stem_name(p).lower()).ratio(), p)
                    for p in pngs if p.rsplit("/", 1)[0] == folder and p not in in_save), default=(0, None))
        if best[0] >= 0.5:
            renamed[old] = best[1]
            not_in_repo[old]["renamed_to"] = best[1]
    renamed_from = {v: k for k, v in renamed.items()}

    def why_missing(path, group):
        if path in renamed_from:
            return f"{stem_name(path)} (new file; the decks hold `{stem_name(renamed_from[path])}`, which is gone from the repo: a rename)"
        return f"{stem_name(path)} ({elsewhere(path, group)})"

    # ---- decisions
    decisions = []
    def names_of(members):
        return ", ".join(f"`{g}`" for g in members)

    # missing cards in complete decks
    miss_lines = []
    for members in groups.values():
        lead = decks[members[0]]
        r = lead.get("rule")
        if not r or r.get("partial") or not lead["cards"]:
            continue
        miss = sorted({p for g in members for p in decks[g]["missing"]})
        if miss:
            miss_lines.append(f"{rule_text(r)} ({names_of(members)}): " + "; ".join(why_missing(p, members) for p in miss))
    if miss_lines:
        decisions.append("Repo cards missing from complete decks. Add each to every copy "
                         "(new cards would get the deck's usual copy count), or exclude it in the rule?\n" + "\n".join("   - " + x for x in miss_lines))
    ex_lines = []
    for members in groups.values():
        r = decks[members[0]].get("rule")
        if r and r.get("exclude"):
            ex_lines.append(f"{rule_text(r)} ({names_of(members)}): " + "; ".join(f"{stem_name(p)} (sits in {elsewhere(p, members)})" for p in r["exclude"]))
    if ex_lines:
        decisions.append("Excluded in the rules because the card sits only in another deck (as a listed card). Confirm:\n" + "\n".join("   - " + x for x in ex_lines))
    inc_lines = []
    for members in groups.values():
        lead = decks[members[0]]
        r = lead.get("rule")
        if r and r.get("include") and not r.get("partial"):
            inc_lines.append(f"{rule_text(r)} ({names_of(members)}): " + "; ".join(
                f"{stem_name(p)} ({'also ' if elsewhere(p, members) != 'only here' else ''}{elsewhere(p, members)})" for p in r["include"]))
        if r and lead.get("extra_folders"):
            inc_lines.append(f"{rule_text(r)} ({names_of(members)}) also takes the whole folder(s) " + ", ".join(f"`{f}`" for f in lead["extra_folders"]))
    if inc_lines:
        decisions.append("Cards from outside a deck's kind folders, kept in the rule (`include` or an extra folder). Keep them there?\n" + "\n".join("   - " + x for x in inc_lines))
    part = sorted((members for members in groups.values() if (decks[members[0]].get("rule") or {}).get("partial")),
                  key=lambda m: (decks[m[0]]["rule"]["kind"], decks[m[0]]["rule"]["stars"], decks[m[0]]["pos"]))
    full_of = {}
    for members in groups.values():
        r = decks[members[0]].get("rule")
        if r and not r.get("partial") and decks[members[0]]["cards"]:
            full_of[bkey(decks[members[0]]["base"])] = members
    for members in part:
        d = decks[members[0]]
        full = full_of.get(bkey(d["base"]))
        if full:
            fp = set(decks[full[0]]["paths"])
            d["not_in_full"] = sorted({p for p in d["paths"] if p not in fp}, key=lambda p: p or "")
            d["full_group"] = full
    if part:
        decisions.append("Hand-picked decks (rule = kind + stars, but they hold only part of the folders; `card_list` in decks.json). "
                         "Should the updater add new cards to them, or only refresh the cards already there?\n" + "\n".join(
            f"   - {names_of(m)} {rule_text(decks[m[0]]['rule'])}, {len(decks[m[0]]['cards'])} cards ({decks[m[0]]['coverage']:.0%}), "
            f"{decks[m[0]]['label'] or decks[m[0]]['where']}"
            + (f"; not in the complete deck: {', '.join(stem_name(p) if p else '?' for p in decks[m[0]]['not_in_full'])}" if decks[m[0]].get("not_in_full") else "")
            for m in part))
    empty = [g for g, d in decks.items() if not d["cards"]]
    if empty:
        decisions.append("Empty decks in the bag 'Specific Item Decks' (no DeckIDs, no CustomDeck). Fill each from the rule guessed from its name, or delete them?\n"
                         + "\n".join(f"   - `{g}` '{decks[g]['name']}': " + (", ".join(f"`{x}`" for x in decks[g]["rule"]["folders"]) if decks[g].get("rule") else "no rule")
                                      for g in empty))
    nulls = [members for members in groups.values() if decks[members[0]]["cards"] and decks[members[0]].get("rule") is None]
    for members in nulls:
        decisions.append(f"Deck(s) {names_of(members)}: {decks[members[0]]['reason']}; rule null. Which folders feed it?")
    item_counts = [(m, decks[m[0]]) for m in groups.values() if (decks[m[0]].get("rule") or {}).get("kind") == "items"
                   and not decks[m[0]]["rule"].get("partial") and decks[m[0]]["odd_counts"]]
    if item_counts:
        decisions.append("Item decks keep per-card copy counts (" + "; ".join(
            f"{stars_text(d['rule']['stars'])}: usually {d['rule']['count']}, {len(d['odd_counts'])} cards differ" for m, d in item_counts)
                         + "). New items get the usual count unless told otherwise?")
    if wrong_backs:
        decisions.append(f"{len(wrong_backs)} card(s) have a back unlike the rest of their kind (see Backs).")
    big = [e for e in large if not e["in_lua"]]
    if big or lua_orphans:
        decisions.append("Large cards: " + "; ".join([f"{e['website']} (`{e['png']}`) is not in Lua resizeTargets" + ("" if e["save_nicknames"] else " and not in the save at all") for e in big]
                                                     + [f"Lua key '{k}' matches no Auxiliary/Creatures PNG" for k in lua_orphans]) + ". Regenerate resizeTargets from Auxiliary/Creatures (plan) and add it to the Minions decks with the other large cards?")
    case_large = [e for e in large if e["in_lua"] and e["save_nicknames"] and e["website"] not in e["save_nicknames"]]
    if case_large:
        decisions.append("Large-card names: the Lua and the save say " + ", ".join(f"'{'/'.join(e['save_nicknames'])}'" for e in case_large)
                         + ", the website " + ", ".join(f"'{e['website']}'" for e in case_large)
                         + ". resizeTargets is case-sensitive, so the Lua keys must follow whatever Nicknames the updater writes.")
    if split_names:
        decisions.append("One image with different Nicknames across the save (likely a typo or a wrong image): " + "; ".join(
            f"`{p}`: " + ", ".join(f"'{n}' ×{c}" for n, c in v.items()) + f" (website '{website_name(p, edits, site_names, by_lower)}')" for p, v in sorted(split_names.items())) + ". Fix which?")
    diff_names = [m for m in mismatches if m["kind"] == "different"]
    if mismatches:
        decisions.append(f"{len(mismatches)} Nickname vs website-name mismatches ({len(diff_names)} different, {len(mismatches) - len(diff_names)} case/spacing/punctuation only; see the table). "
                         "The plan sets Nickname = website name: rename them all, or first fix the website names (Card Edits.json) where the save is right "
                         "(e.g. 'Black Clot', 'M.O.A.B.', 'Thunderfury: ...', 'Mr. Krabs')?")
    loose = [c for c in cards if c["role"] == "loose"]
    if loose:
        decisions.append("Loose card(s): " + ", ".join(f"'{c['name']}' `{c['guid']}` {label_for(c['obj']) or 'at %s' % (pos(c['obj']),)}" for c in loose)
                         + ". Leave as is (the updater refreshes its link), or remove?")
    gone = [e for e in not_in_repo.values()]
    if gone:
        decisions.append("Save images no longer in the repo (report only, D5): " + "; ".join(
            f"`{e['path']}` ×{e['refs']}" + (f", likely renamed to `{e['renamed_to']}`" if e.get("renamed_to") else "") for e in gone)
                         + ". Treat as renames (update path and Nickname in every copy)?")
    if odd_links:
        decisions.append(f"{len(odd_links)} link(s) use refs/heads/main (Types/Girl.png token, loose Militron); sha pinning will rewrite them like the rest. OK?")

    # ---- write rules file
    rules = {
        "about": ("Rules for the TTS save (TTS/Impossibility Simulator.json), written by audit.py. A deck's cards are the repo PNGs "
                  "matched by rule.folders (globs: * stays inside one folder) plus rule.include, minus rule.exclude. "
                  "partial: a hand-picked subset (only its own cards are refreshed; card_list = its distinct cards). "
                  "count: the usual copies per card; odd_counts (per deck): cards at another count. "
                  "rule null: needs a decision (see AUDIT.md)."),
        "generated": datetime.datetime.now().isoformat(timespec="seconds"), "repo_head": head,
        "decks": {}, "bags": {}, "objects": {}, "large_cards": {"source": "Auxiliary/Creatures", "lua_table": "resizeTargets",
                                                               "key": "Nickname", "current_keys": lua_keys},
    }
    for g, d in sorted(decks.items(), key=lambda kv: (bool(kv[1]["parents"]), kv[1]["pos"][0], kv[1]["pos"][1])):
        entry = {"name": d["name"], "where": d["where"] if d["parents"] else (d["label"] or "table"),
                 "position": list(d["pos"]), "cards": len(d["cards"]), "rule": d.get("rule"),
                 "confidence": d.get("confidence"), "copies": d.get("copies", []),
                 "back": (d["backs"].most_common(1)[0][0] if d["backs"] else (back_major.get(d["rule"]["kind"]) if d.get("rule") else None))}
        if d.get("rule") and d["rule"].get("partial"):
            entry["card_list"] = sorted(set(p for p in d["paths"] if p))
        if d["odd_counts"]:
            entry["odd_counts"] = {p: n for p, n in d["odd_counts"] if p}
        rules["decks"][g] = entry
    for b in bags:
        held = b["obj"].get("ContainedObjects") or []
        e = {"name": b["name"], "type": b["type"], "where": b["where"], "position": list(b["pos"]), "holds": b["holds"]}
        if b["name"] == "Rulebooks":
            e["rule"] = {"kind": "rulebook", "folders": ["Auxiliary/Rulebook/*.png"], "exclude": [p for p in rule_pages if p not in bag_pages],
                         "loose_cards": True, "nickname": "Page N: Title"}
            e["back"] = "own face" if all(c["back_path"] == c["path"] for c in cards if c["role"] == "rulebook") else \
                collections.Counter(c["back_path"] for c in cards if c["role"] == "rulebook").most_common(1)[0][0]
            e["texture"] = url_to_path((b["obj"].get("CustomMesh") or {}).get("DiffuseURL"))[0]
        elif b["name"] == "Specific Item Decks":
            e["decks"] = [x.get("GUID") for x in held if x.get("Name") == "Deck"]
        elif b["name"] == "Creature Types":
            e["rule"] = {"kind": "types", "folders": ["Types/*.png", "Types/Stars/*.png"], "object": "Custom_Token", "partial": True}
            e["tokens"] = {x.get("Nickname"): url_to_path((x.get("CustomImage") or {}).get("ImageURL"))[0] for x in held}
        else:
            e["contents"] = sorted({(x.get("Name"), x.get("Nickname") or "", ", ".join(sorted({url_to_path(u)[0] or u for u, k, oo, pp in url_refs if oo is x})))
                                    for x in held})
        rules["bags"][b["guid"]] = e
    for ident, e in objects.items():
        if ident in bag_pages:
            continue                  # rulebook pages: see bags
        rules["objects"][ident] = {"in_git": e["in_git"], "used_by": dict(e["objects"]), "fields": sorted(e["keys"]), "guids": uniq(e["guids"])}

    with open(RULES, "w", encoding="utf-8") as fh:
        json.dump(rules, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    # ---- audit.json
    def jdeck(d):
        return {k: d.get(k) for k in ("guid", "name", "where", "label", "pos", "rule", "confidence", "reason", "copies", "coverage",
                                      "missing", "unexpected", "odd_counts", "dups")} | {
            "cards": len(d["cards"]), "folders": dict(d["folders"]), "backs": dict(d["backs"]), "scale": {str(k): v for k, v in d["scale"].items()}}
    audit = {"totals": totals, "decisions": decisions, "decks": {g: jdeck(d) for g, d in decks.items()},
             "not_in_repo": [dict(e, objects=sorted(e["objects"])) for e in not_in_repo.values()],
             "odd_links": odd_links, "external_urls": [{"url": u, "field": k, "object": n, "nickname": nn, "refs": c} for (u, k, n, nn), c in external.items()],
             "name_mismatches": mismatches, "one_image_several_nicknames": split_names, "empty_nicknames": dict(empty_names), "wrong_backs": wrong_backs,
             "backs_by_kind": {k: dict(v) for k, v in back_by_kind.items()},
             "large_cards": large, "lua_resize_targets": lua_keys, "lua_orphans": lua_orphans,
             "loose_cards": [{"guid": c["guid"], "name": c["name"], "path": c["path"], "url": c["face"], "pos": pos(c["obj"])} for c in loose],
             "objects": {k: dict(v, keys=sorted(v["keys"]), objects=dict(v["objects"])) for k, v in objects.items()},
             "imageless_objects": dict(imageless),
             "integrity": {"customdeck_id_conflicts": id_conflicts, "deckids_order_mismatch": deckid_mismatch,
                           "deck_customdeck_missing": deck_cd_missing, "card_vs_deck_entry_mismatch": card_entry_mismatch,
                           "stale_card_customdeck_keys": [{"guid": c["guid"], "name": c["name"], "cardid": c["obj"].get("CardID"),
                                                           "own_keys": c["stale"], "path": c["path"],
                                                           "deck": guid_of(c["container"]) if c["container"] is not None else None,
                                                           "deck_has_id": c["deck_id"] in ((c["container"] or {}).get("CustomDeck") or {})}
                                                          for c in stale_keys],
                           "duplicate_guids": dup_guids, "cardid_not_multiple_of_100": [c["guid"] for c in cardid_bad]},
             "repo_vs_disk": {"in_git_not_on_disk": in_git_not_disk, "on_disk_not_in_git": on_disk_not_git, "ignored_on_disk": dict(ignored_dirs), "save_refs_not_on_disk": save_not_disk}}
    with open(os.path.join(OUT, "audit.json"), "w", encoding="utf-8") as fh:
        json.dump(audit, fh, indent=1, ensure_ascii=False, default=lambda x: sorted(x) if isinstance(x, (set, frozenset)) else str(x))
        fh.write("\n")

    # ---- AUDIT.md
    L = []
    w = L.append
    def esc(s):
        return str(s).replace("|", "\\|")
    def dname(d):
        return f"{d['name'] or '(unnamed)'}"
    w("# TTS save audit")
    w("")
    w(f"Save `{os.path.relpath(SAVE, REPO)}` ({raw_size:,} bytes, TTS {save.get('VersionNumber')}, \"{save.get('SaveName')}\") "
      f"against TTSCardMaker HEAD `{head[:10]}`. Written by `audit.py` on {datetime.date.today().isoformat()}; rules in `TTS/decks.json`.")
    w("")
    w("Contents: totals; needs a decision; decks; bags; missing repo cards; images not in the repo; unexpected cards; "
      "names; backs; duplicates; large cards; loose cards; non-card images; Militron; repo vs disk; integrity.")
    w("")

    w("## Totals")
    w("")
    t = totals
    w(f"- Top-level objects: **{t['top_level_objects']}** ({', '.join(f'{k} {v}' for k, v in t['top_level_by_type'].items())}).")
    w(f"- All objects incl. contents of decks and bags: {t['all_objects']}.")
    w(f"- Decks: **{t['decks']}** = {t['decks_top_level']} on the table + {t['decks_in_bags']} inside the bag 'Specific Item Decks' "
      f"({t['empty_decks']} of those are empty).")
    w(f"- Card objects: **{t['card_objects']}** ({', '.join(f'{k} {v}' for k, v in t['card_objects_by_name'].items())}); "
      f"by place: {', '.join(f'{k} {v}' for k, v in t['card_objects_by_place'].items())}.")
    w(f"- URL strings: {t['url_strings']}; repo links {t['repo_urls']} ({', '.join(f'{k} {v}' for k, v in t['repo_urls_by_ref'].items())}); "
      f"external {t['external_urls']} (Steam asset bundles/model, pastebin mesh, imgur felts).")
    w(f"- Repo links on card objects (FaceURL+BackURL): {t['card_face_back_links_on_card_objects']}; repeated in decks' CustomDeck maps: {t['deck_level_customdeck_links']}.")
    w(f"- Distinct repo images: **{t['distinct_repo_images']}**; card faces {t['distinct_card_faces']} "
      f"(in decks {t['distinct_deck_card_faces']}); card faces+backs {t['distinct_card_images_with_backs']}; "
      f"images in ImageURL/ImageSecondaryURL/DiffuseURL {t['distinct_image_link_images']}"
      + (f", +{len(script_imgs)} only in scripts ({', '.join('`' + x + '`' for x in sorted(script_imgs))})" if script_imgs else "") + ".")
    w(f"- Deck rules by confidence ({len(decks)} decks): " + "; ".join(
        f"{cf} {conf_counts[cf]} (" + ", ".join(f"{k} {v}" for k, v in conf_parts[cf].most_common()) + ")"
        for cf in ("high", "medium", "low", "none") if conf_counts.get(cf)) + ".")
    w(f"- Repo cards not in their complete decks: {len(full_missing)} missing + {len(rule_excluded)} excluded in the rules "
      f"(they sit only in another deck) = {len(full_missing | rule_excluded)}; see Needs a decision 1-2.")
    w(f"- CustomDeck ids used by cards: {t['customdeck_ids_used_by_cards']}, {t['customdeck_ids_shared']} of them by more than one object; highest id {t['max_customdeck_id']}.")
    w(f"- Repo HEAD: {t['repo_files_head']} files, {t['repo_pngs_head']} PNGs.")
    w("")
    w("Against the earlier observations (NEXT_SESSION_PLAN.md):")
    w("")
    nc = t["card_objects_by_name"]
    w(f"- 228 top-level objects, 57 decks: reproduced ({t['top_level_objects']}, {t['decks']}; the 57 include the 8 decks inside 'Specific Item Decks', 7 of them empty).")
    w(f"- 2,388 card objects: that is the CardCustom count ({nc.get('CardCustom', 0)}). Six more objects are type \"Card\" "
      f"(Dr. Robotnik's Roboticizer, 2 in each of three 1★ item decks): **{t['card_objects']}** card objects in all.")
    w(f"- 9,109 links on main: reproduced. Card FaceURL/BackURL links: {t['card_links']} ({t['card_face_back_links_on_card_objects']} on card objects + "
      f"{t['deck_level_customdeck_links']} in decks' CustomDeck maps), {t['card_links_main']} on main; the other one is the loose Militron's refs/heads/main link. "
      f"All repo links: {t['repo_urls']} ({', '.join(f'{k} {v}' for k, v in t['repo_urls_by_ref'].items())}); none is pinned to a sha yet.")
    w(f"- 153 non-card images: these are links, not images: {t['non_card_links']} repo links in ImageURL/ImageSecondaryURL/DiffuseURL "
      f"(+{t['embedded_links']} embedded in the Flex Table Control's script state), on {len(img_links)} distinct repo images"
      + (f" (+{len(script_imgs)} only in the script)" if script_imgs else "") + ". "
      f"The Non-card images table has {len(nonc)} rows: those, {len(nonc_card_imgs)} marker/rulebook card images "
      f"(FaceURL/BackURL, so already in the card links and the {t['distinct_card_faces']} card faces) and {nonc_external} external URLs. Counters carry no image.")
    w(f"- 821 distinct images: {t['distinct_card_faces']} distinct card faces, {t['distinct_faces_in_repo']} of them in the repo (ZOEY!!!!!.png is gone), so 821 = faces that exist. "
      f"With backs {t['distinct_card_images_with_backs']}; every repo image incl. non-card {t['distinct_repo_images']}.")
    w(f"- \"773 of 799 deck ids used by more than one object\": now {t['customdeck_ids_shared']} of {t['customdeck_ids_used_by_cards']}.")
    w("")

    w("## Needs a decision")
    w("")
    for i, s in enumerate(decisions, 1):
        w(f"{i}. {s}")
    w("")

    w("## Decks")
    w("")
    w("One row per deck GUID. Copies = other decks with the same rule (and, for hand-picked decks, the same cards).")
    w("")
    w("| GUID | Name | Where | Cards | Rule | Conf. | Copies |")
    w("|---|---|---|---|---|---|---|")
    order = sorted(decks.values(), key=lambda d: (json.dumps(d.get("rule") or {}, sort_keys=True), bool(d["parents"]), d["guid"]))
    order = sorted(order, key=lambda d: ({"creatures": 0, "items": 1, "fields": 2, "nme": 3, "status_effects": 4, "minions": 5,
                                          "auxiliary_items": 6}.get((d.get("rule") or {}).get("kind"), 9),
                                         (d.get("rule") or {}).get("stars") or [], bool((d.get("rule") or {}).get("partial")), d["pos"]))
    for d in order:
        loc = (d["label"] or f"x {d['pos'][0]}, z {d['pos'][1]}") if not d["parents"] else f"in bag '{d['parents'][len(d['parents']) - 1].get('Nickname')}'"
        w(f"| `{d['guid']}` | {esc(dname(d))} | {esc(loc)} | {len(d['cards'])} | {esc(rule_text(d.get('rule')))} | {d.get('confidence') or '-'} | "
          f"{', '.join('`' + c + '`' for c in d.get('copies', [])) or '-'} |")
    w("")
    for d in order:
        r = d.get("rule")
        w(f"### `{d['guid']}` {esc(dname(d))}")
        w("")
        w(f"- Position: {'x %s, z %s' % d['pos']}" + (f", {d['label']}" if d["label"] else "") + (f"; inside {d['where']} (position is stale)" if d["parents"] else "") + ".")
        w(f"- Cards: {len(d['cards'])} ({len(set(d['paths']))} distinct); back: "
          + (", ".join(f"`{b}` {n}" for b, n in d["backs"].items()) or "-") + "; card scale: " + (", ".join(f"{k} ({v})" for k, v in d["scale"].items()) or "-") + ".")
        if d["folders"]:
            w("- Folders: " + ", ".join(f"`{f}` {n}" for f, n in sorted(d["folders"].items())) + ".")
        if r:
            w(f"- Rule: **{rule_text(r)}**, folders " + ", ".join(f"`{g}`" for g in r["folders"]) + (f", count {r['count']}" if r.get("count") else "")
              + f". Confidence **{d.get('confidence')}**: {d.get('reason')}.")
        else:
            w(f"- Rule: **null** ({d.get('reason')}).")
        if d.get("coverage") is not None:
            w(f"- Holds {d['coverage']:.0%} of the repo cards its folders cover.")
        w(f"- Copies: {', '.join('`' + c + '` ' + esc(dname(decks[c])) for c in d.get('copies', [])) or 'none'}.")
        if d["cards"]:
            cc = collections.Counter(d["counts"].values())
            w("- Copies per card: " + ", ".join(f"{n}× {k} cards" for n, k in sorted(cc.items())) + ".")
        if d["missing"]:
            label = "Lacks (cards its copies have)" if r and r.get("partial") else "Missing repo cards"
            w(f"- {label} ({len(d['missing'])}): " + ", ".join(f"`{p}`" for p in d["missing"]) + ".")
        if d["unexpected"]:
            w(f"- Outside the kind's folders ({len(d['unexpected'])}): " + ", ".join(f"`{p}`" for p in d["unexpected"]) + ".")
        if d["odd_counts"] and r and not r.get("partial"):
            w(f"- Cards not at {r['count']} copies: " + ", ".join(f"{stem_name(p) if p else '?'} ×{n}" for p, n in d["odd_counts"]) + ".")
        for kind, what, ids in d["dups"]:
            w(f"- Duplicate ({kind}): {esc(what)} -> {', '.join(map(str, ids))}.")
        w("")

    w("## Bags")
    w("")
    for b in bags:
        w(f"- `{b['guid']}` {b['type']} '{esc(b['name'])}' at x {b['pos'][0]}, z {b['pos'][1]} ({b['where']}): holds " + ", ".join(f"{k} {v}" for k, v in b["holds"].items()) + ".")
    w("")
    w(f"Rulebooks bag: {sum(bag_pages.values())} loose page cards, {len(bag_pages)} distinct images; repo has {len(rule_pages)} rulebook PNGs.")
    missing_pages = [p for p in rule_pages if p not in bag_pages]
    extra_pages = [p for p in bag_pages if p not in pngs]
    w(f"- Repo pages not in the bag: {', '.join('`' + p + '`' for p in missing_pages) or 'none'}" + (" (0000_Cover_Book.png is the bag's own texture)" if any("Cover" in p for p in missing_pages) else "") + ".")
    w(f"- Bag pages not in the repo: {', '.join('`' + str(p) + '`' for p in extra_pages) or 'none'}.")
    rb_backs = collections.Counter(c["back_path"] for c in cards if c["role"] == "rulebook")
    own = sum(1 for c in cards if c["role"] == "rulebook" and c["back_path"] == c["path"])
    w(f"- Page backs: {own} of {sum(rb_backs.values())} pages use their own image as the back" + (
        "; others: " + ", ".join(f"`{k}` {v}" for k, v in rb_backs.items() if k not in bag_pages) if own < sum(rb_backs.values()) else "") + ".")
    w(f"- Nicknames are 'Page N: Title' by design; they are not compared with website names.")
    w("")
    w(f"Creature Types bag: {sum(type_tokens.values())} Custom_Token objects; repo has {len(type_pngs)} PNGs in Types/ and Types/Stars/.")
    w(f"- Tokens: " + ", ".join(f"`{p}`" for p in sorted(type_tokens, key=str)) + ".")
    w(f"- Types PNGs with no token ({len([p for p in type_pngs if p not in type_tokens])}): " + ", ".join(stem_name(p) for p in type_pngs if p not in type_tokens) + ".")
    w("")
    sid = next((b for b in bags if b["name"] == "Specific Item Decks"), None)
    if sid:
        w("Specific Item Decks bag: " + ", ".join(f"`{x.get('GUID')}` '{x.get('Nickname')}' ({len(x.get('ContainedObjects') or [])} cards)" for x in sid["obj"].get("ContainedObjects") or []) + ".")
        w("")

    w("## Repo cards missing from each copy")
    w("")
    w("Complete decks only (hand-picked decks are compared with their copies in the deck sections).")
    w("")
    any_missing = False
    for d in order:
        r = d.get("rule")
        if r and not r.get("partial") and d["cards"] and d["missing"]:
            any_missing = True
            w(f"- `{d['guid']}` {esc(dname(d))} ({rule_text(r)}): " + ", ".join(f"`{p}`" for p in d["missing"]))
    if not any_missing:
        w("- none")
    w("")

    w("## Images not in the repo")
    w("")
    w("Report only (D5). Paths are the URL paths, decoded.")
    w("")
    if not_in_repo:
        for e in not_in_repo.values():
            w(f"- `{e['path']}`: {e['refs']} ref(s), {', '.join(sorted(e['objects']))}; on disk: {e['on_disk']}"
              + (f"; differs only by case from `{e['case_match'][0]}`" if e["case_match"] else "") + ".")
    else:
        w("- none: every repo link in the save resolves to a file in HEAD.")
    w("")
    w("Odd links (not plain `main/`):")
    w("")
    for u, who in odd_links.items():
        p = url_to_path(u)[0]
        w(f"- `{u}` (file in HEAD: {p in tree}): {'; '.join(who)}")
    w("")
    w("External links (not the repo):")
    w("")
    for (u, k, n, nn), c in external.items():
        w(f"- {n} '{esc(nn)}' {k}: `{u}` ×{c}")
    w("")

    w("## Cards in an unexpected deck")
    w("")
    w("Cards whose path is outside the deck's kind folders. The rules keep them (`include`, or an extra folder glob); a copy that lacks one lists it as missing. See Needs a decision.")
    w("")
    seen_u = False
    for d in order:
        if d["unexpected"]:
            seen_u = True
            r = d.get("rule") or {}
            w(f"- `{d['guid']}` {esc(dname(d))} ({rule_text(d.get('rule'))}): " + "; ".join(
                f"`{p}`" + (" (listed)" if p in r.get("include", []) else " (extra folder)" if p and rule_matches(r, p) else "")
                + f", {'also ' if elsewhere(p, d['group']) != 'only here' else ''}{elsewhere(p, d['group'])}" for p in d["unexpected"]))
    if not seen_u:
        w("- none")
    w("")

    w("## Nickname vs website name")
    w("")
    named_by_site = sum(1 for p in nicks_by_path if p in site_names)
    w("Website name, as build_site.py: a `site/Card Edits.json` rename "
      f"({len(edits)} entries now), else the built site's name (`site/dist/data/cards.json`, {len(site_names)} cards), "
      "else the stem of the PSD beside the PNG (a parsed card is keyed by its PSD: `Abbi.png` + `ABBI.psd` = 'ABBI'), else the PNG stem; _ as spaces. "
      f"{named_by_site} of the {len(nicks_by_path)} images compared are named by cards.json. "
      "Counted per (image, Nickname) pair; rulebook pages, markers and The Morgue excluded.")
    w("")
    w(f"- Pairs compared: {len(name_pairs)} ({sum(name_pairs.values())} card objects); mismatches: {len(mismatches)} "
      f"({len(diff_names)} different, {len(mismatches) - len(diff_names)} case/spacing/punctuation only).")
    w(f"- Empty Nicknames: {sum(empty_names.values())} objects on {len(empty_names)} images" + (": " + ", ".join(f"`{p}` ×{n}" for p, n in empty_names.items()) if empty_names else "") + ".")
    w("")
    if mismatches:
        w("| Image | Nickname | Website name | Objects | Kind |")
        w("|---|---|---|---|---|")
        for m in sorted(mismatches, key=lambda m: (m["kind"] != "different", m["path"])):
            w(f"| `{esc(m['path'])}` | {esc(m['nickname'])} | {esc(m['website'])} | {m['objects']} | {m['kind']}{' (duplicate PNG)' if m['duplicate_png'] else ''} |")
        w("")

    w("## Backs")
    w("")
    w("Majority back per kind (deck, bag and loose cards):")
    w("")
    for k, v in sorted(back_by_kind.items()):
        w(f"- {KIND_LABEL.get(k, k)}: " + ", ".join(f"`{b}` {n}" for b, n in v.most_common()))
    w("")
    w(f"Minority (wrong) backs: {len(wrong_backs) or 'none'}.")
    for e in wrong_backs:
        w(f"- {e['guid']} '{esc(e['name'])}' `{e['path']}` has `{e['back']}`, expected `{e['expected']}` ({e['where']})")
    w("")
    w("Not cards for this check: marker cards (back = the minus marker), rulebook pages (see Bags).")
    w("")

    w("## Duplicates")
    w("")
    w("Within one deck: the same image under more than one CustomDeck id, or one Nickname on several images. "
      "(Several copies of one card under one id is the normal layout; per-deck copy counts are in the deck sections.)")
    w("")
    nd = 0
    for d in order:
        for kind, what, ids in d["dups"]:
            nd += 1
            w(f"- `{d['guid']}` {esc(dname(d))}: {kind}: {esc(what)} -> {', '.join(map(str, ids))}")
    if not nd:
        w("- none")
    w("")
    w("One image with different Nicknames across the save:")
    w("")
    for p_, v in sorted(split_names.items()):
        w(f"- `{p_}`: " + ", ".join(f"'{esc(n)}' ×{c}" for n, c in v.items()))
    if not split_names:
        w("- none")
    w("")
    w("Cards whose copy count differs from their deck's usual count (complete decks):")
    w("")
    nd = 0
    for d in order:
        r = d.get("rule")
        if r and not r.get("partial") and d["odd_counts"]:
            nd += 1
            w(f"- `{d['guid']}` {esc(dname(d))} (usual {r['count']}): " + ", ".join(f"{stem_name(p) if p else '?'} ×{n}" for p, n in d["odd_counts"]))
    if not nd:
        w("- none")
    w("")

    w("## Large cards (Lua resizeTargets vs Auxiliary/Creatures)")
    w("")
    w(f"Lua keys ({len(lua_keys)}): " + ", ".join(f"'{k}'" for k in lua_keys) + ". Keyed by Nickname, case-sensitive.")
    w("")
    w("| PNG | Website name | Nicknames in the save | In Lua |")
    w("|---|---|---|---|")
    for e in large:
        lua = ("yes" if e["lua_exact"] else "case differs: '" + "', '".join(e["in_lua"]) + "'") if e["in_lua"] else "**no**"
        w(f"| `{e['png']}` | {esc(e['website'])} | {esc(', '.join(e['save_nicknames']) or '**not in the save**')} | {lua} |")
    w("")
    w(f"- Lua keys with no Auxiliary/Creatures PNG: {', '.join(lua_orphans) or 'none'}.")
    w(f"- Auxiliary/Creatures PNGs not in Lua: {', '.join(e['website'] for e in large if not e['in_lua']) or 'none'}.")
    if lua_named_cards:
        w(f"- Cards from other folders whose Nickname is a Lua key: " + ", ".join(f"'{n}' `{p}` ×{c}" for (n, p), c in lua_named_cards.items()) + ".")
    w("")

    w("## Loose cards on the table")
    w("")
    for c in loose:
        w(f"- `{c['guid']}` '{esc(c['name'])}' at x {pos(c['obj'])[0]}, z {pos(c['obj'])[1]} {label_for(c['obj']) or ''}: `{c['face']}` (in HEAD: {c['path'] in tree})")
    if not loose:
        w("- none")
    w("")

    w("## Non-card images")
    w("")
    w("Every image on objects that are not deck/loose cards: tiles, tokens, board, model, bag, marker cards (Infinite_Bags), rulebook pages, and URLs embedded in scripts.")
    w("")
    w("| Image | In HEAD | On disk | Used by |")
    w("|---|---|---|---|")
    rb = [k for k in objects if k.startswith("Auxiliary/Rulebook/") and k != "Auxiliary/Rulebook/0000_Cover_Book.png"]
    for k, e in objects.items():
        if k in rb[1:]:
            continue
        if k in rb[:1]:
            w(f"| {len(rb)} rulebook page images `Auxiliary/Rulebook/*.png` | {all(objects[x]['in_git'] for x in rb)} | {all(objects[x]['on_disk'] for x in rb)} | "
              f"{sum(sum(objects[x]['objects'].values()) for x in rb)} CardCustom in Rulebooks |")
            continue
        used = "; ".join(f"{esc(n)} ×{c}" for n, c in e["objects"].most_common())
        w(f"| `{esc(k)}` | {'-' if e['in_git'] is None else e['in_git']} | {'-' if e['on_disk'] is None else e['on_disk']} | {used} ({', '.join(sorted(e['keys']))}) |")
    w("")
    w("Objects with no image: " + ", ".join(f"{k} {v}" for k, v in imageless.most_common()) + ".")
    w("")

    w("## Militron")
    w("")
    mil = [c for c in cards if "ilitron" in (c["path"] or "") or "ilitron" in c["name"]]
    for c in mil:
        w(f"- `{c['guid']}` '{esc(c['name'])}' `{c['path']}` ({c['ref']}) in " + (f"`{guid_of(c['container'])}` " if c['container'] is not None else "") + f"{where(c['parents'])}"
          + (f" ({decks[guid_of(c['container'])]['label'] or ''})" if c['container'] is not None and c['container'].get('Name') == 'Deck' else f" at {pos(c['obj'])} {label_for(c['obj']) or ''}"))
    mil_png = [p for p in pngs if "ilitron" in p]
    w(f"- Repo: {', '.join('`' + p + '`' for p in sorted(mil_png))}.")
    in_decks = collections.Counter(guid_of(c["container"]) for c in mil if c["role"] == "deck")
    creature4 = [g for g, d in decks.items() if d.get("rule") and d["rule"]["kind"] == "creatures" and d["rule"]["stars"] == [4]]
    w(f"- 4★ creature decks: {', '.join(f'`{g}` ' + ('has it' if g in in_decks else 'lacks it') + (' (subset)' if decks[g]['rule'].get('partial') else '') for g in creature4)}.")
    noarmor = next((e for e in large if "No_Armor" in e["png"]), None)
    if noarmor:
        w(f"- Militron (No Armor): in the save: {'yes' if noarmor['save_nicknames'] else 'no'}; in Lua resizeTargets: {'yes' if noarmor['in_lua'] else 'no'}; "
          f"the Minions decks hold the other {sum(1 for e in large if e['save_nicknames'])} Auxiliary/Creatures cards.")
    w("- The loose Militron sits on the 'Penalty Box Creatures' tile; its link is refs/heads/main while the deck copy's is main, so it was made separately. "
      "Only the simple-version 4★ deck holds Militron; the complete 4★ decks list it as missing.")
    w("")

    w("## Repo vs disk")
    w("")
    w(f"HEAD vs files on disk under {', '.join(DISK_ROOTS)} (.DS_Store ignored).")
    w("")
    w(f"- In git, not on disk ({len(in_git_not_disk)}): " + (", ".join(f"`{p}`" for p in in_git_not_disk) or "none") + ".")
    w(f"- On disk, not in git and not ignored ({len(on_disk_not_git)}): " + (", ".join(f"`{p}`" for p in on_disk_not_git) or "none") + ".")
    w(f"- Git-ignored files on disk: {sum(ignored_dirs.values())}, in " + (", ".join(f"`{k}` {v}" for k, v in ignored_dirs.most_common(8)) or "none") + ".")
    w(f"- Save images in git but not on disk: {', '.join('`' + p + '`' for p in save_not_disk) or 'none'}.")
    w("")

    w("## Integrity (for the updater)")
    w("")
    w(f"- CustomDeck ids that mean different images on different objects: {len(id_conflicts) or 'none'}"
      + (f" (ids {', '.join(sorted(id_conflicts, key=int))}). Ids come from CardIDs, decks' CustomDeck maps and cards' own CustomDeck keys. "
         "The rulebook pages and the Deck of Rejects reuse ids that deck cards also use"
         + (f"; stale own keys ({', '.join(k for k in sorted(stale_ids & set(id_conflicts), key=int))}) clash too" if stale_ids & set(id_conflicts) else "")
         + ". TTS keeps CustomDeck per object, so this works until two such cards meet in one deck; the updater must take new ids above the highest one" if id_conflicts else "") + ".")
    for k, v in sorted(id_conflicts.items(), key=lambda kv: int(kv[0])):
        w(f"  - {k}" + (" (stale own key)" if k in stale_ids else "") + ": " + "; ".join(f"`{url_to_path(f)[0] or f}`" for f, b in v))
    w(f"- Cards whose own CustomDeck lacks their CardID's id (a stale key; reading falls back to that entry, an updater indexing "
      f"`CustomDeck[str(CardID // 100)]` would fail): {len(stale_keys) or 'none'}"
      + (". The deck's map " + ("holds every such id" if all(c["deck_id"] in ((c["container"] or {}).get("CustomDeck") or {}) for c in stale_keys) else "lacks some") + "; rewrite the card's map under its CardID's id." if stale_keys else "."))
    for c in stale_keys:
        w(f"  - `{c['guid']}` '{esc(c['name'])}' CardID {c['obj'].get('CardID')}, own key {', '.join(c['stale'])}, `{c['path']}`"
          + (f", in `{guid_of(c['container'])}` {esc(dname(decks[guid_of(c['container'])]))}" if c["container"] is not None and c["container"].get("Name") == "Deck" else ""))
    w(f"- Decks whose DeckIDs differ from their cards' CardIDs: {', '.join(deckid_mismatch) or 'none'}.")
    w(f"- Cards whose id is missing from the deck's CustomDeck: {', '.join(deck_cd_missing) or 'none'}; card vs deck entry mismatches: {len(card_entry_mismatch)}.")
    w(f"- CardIDs not id*100: {len(cardid_bad)}. Highest CustomDeck id {max_deck_id}: new cards can take {max_deck_id + 1} up.")
    w(f"- GUIDs used by more than one object: {len(dup_guids)} ({sum(dup_guids.values())} objects).")
    w(f"- Role tags in Descriptions: {sum(1 for c in cards if (c['obj'].get('Description') or '').strip())} card objects (to be cleared).")
    w("")

    with open(os.path.join(OUT, "AUDIT.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))
    print(f"decks {len(decks)}, cards {len(cards)}, decisions {len(decisions)}")
    print("wrote", os.path.join(OUT, "AUDIT.md"), os.path.join(OUT, "audit.json"), RULES)


if __name__ == "__main__":
    main()
