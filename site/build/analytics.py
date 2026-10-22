"""Balance analytics: data/analytics.json, for the Stats page's Balance section and each card's Balance block.

Called by build_site.py with the site's card entries (stars and stats as the card pages show them, edits applied) and
the bot's stats.pkl / old_stats.pkl (each earlier version of a card, dated by the commit of the PSD it was read from;
older records with no PSD blob keep their stored date, marked approximate unless a commit of that PSD has it). A
version's `version` record, when it has one, dates it instead (when): the bot keeps no copy of a version whose data a
later file repeats, and its start moves to the version that holds that data. Days and
months are Pacific time (ZONE).

  * Cohorts: creatures and minions with all four stats, by star level. A star level with fewer than MIN_COHORT cards
    is compared with its kind's "all stars" cohort, and so are the auxiliary creatures (no star level): they count as
    creatures. A duplicate (another PNG of the same PSD) counts once, through its original; hidden cards not at all.
    A card with several creatures counts once, by its first creature (the card's own stats).
  * Per card: its cohort, how many cards of it have a lower or higher total, mid-rank percentiles for each stat and
    the total, z of the total, "top" / "bottom" for the top and bottom 10%, the stat lines it had (trend, when they
    changed) and its recorded changes, newest first. Both read the current card as its page shows it. A version with
    the same date as the one after it is the same PSD read again by a newer parser: the newer reading replaces it.
  * Over time (full-history builds only, since a card's start is its first upload): each month, the total stats of
    each cohort's cards as they were then.

PSDs are never read here; everything comes from the bot's data.
"""
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from types import SimpleNamespace

try:
    from zoneinfo import ZoneInfo
    ZONE = ZoneInfo("America/Los_Angeles")  # the bot's TIMEZONE; balance.js TZ
except Exception:                          # no tz database: UTC, and build_site warns
    ZONE = timezone.utc
ZONE_MISSING = ZONE is timezone.utc

KINDS = ("creature", "minion")             # cohorts: creatures and minions by star level
AUX = "creatures"                          # auxiliary creatures: no star level, compared with all creatures
MIN_COHORT = 5                             # a smaller star level is compared with its kind's "all stars" cohort
OFF_SCALE = 40                             # a total above this is off the scale (stats.js offChart): Tainted Lazarus' old 110s
TOP, BOTTOM = 90, 10                       # flags: the top and bottom 10% of a cohort's totals
STATS = (("hp", "hp"), ("def", "defense"), ("atk", "attack"), ("spd", "speed"))
KEYS = tuple(k for k, _ in STATS) + ("total",)

# timing tags, as site/assets/text.js tagInfo reads them: the cooldown family, old (per turn, every N turns) and new
OLD_TAG = r"[1-9X]PGT|[1-9X]PT|FTE[1-9X]T|E[1-9X]GT|E[1-9X]T"
NEW_TAG = r"[1-9X]G?CD|(?:-1|[0-9X])/[1-9X]G?CD|[1-9X]U"
TAG_RUN = re.compile(rf"(?:\((?:{OLD_TAG}|{NEW_TAG})\))+")      # adjacent cooldown-family tags: "(1CD)(2U)"
OLD_RE = re.compile(rf"\((?:{OLD_TAG})\)")
NEW_RE = re.compile(rf"\((?:{NEW_TAG})\)")


def line_of(stats):
    """(hp, def, atk, spd) of a bot CardStats when all four were read, else None."""
    values = tuple(getattr(stats, attr, -1) for _, attr in STATS)
    return values if all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in values) else None


def entry_line(e):
    """The same for a site card entry (None for a stat it lacks)."""
    values = tuple(e.get(k) for k, _ in STATS)
    return values if all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in values) else None


def quantile(ordered, q):
    """Linear interpolation between the closest ranks (numpy's default)."""
    pos = q * (len(ordered) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(ordered) - 1)
    return round(ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo), 2)


def spread(values):
    ordered = sorted(values)
    return {"p10": quantile(ordered, .1), "p50": quantile(ordered, .5), "p90": quantile(ordered, .9)}


def midrank(value, ordered):
    """Percent of the cohort below this value, ties counted half (unrounded)."""
    below = sum(1 for v in ordered if v < value)
    equal = sum(1 for v in ordered if v == value)
    return 100 * (below + equal / 2) / len(ordered)


def pct_of(rank):
    """A mid-rank rounded half up, but never across a flag's edge: 89.5 is 89 (no "top"), 10.5 is 11."""
    pct = int(rank + .5)
    return TOP - 1 if TOP > rank and pct >= TOP else BOTTOM + 1 if BOTTOM < rank and pct <= BOTTOM else pct


def month_of(ts):
    return datetime.fromtimestamp(ts, ZONE).strftime("%Y-%m")


def month_end(month):
    """The first instant after a "YYYY-MM" month, in ZONE."""
    y, m = (int(x) for x in month.split("-"))
    return datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=ZONE).timestamp()


def months_between(first, last):
    y, m = (int(x) for x in first.split("-"))
    out = []
    while f"{y:04d}-{m:02d}" <= last:
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def tag_runs(text):
    return TAG_RUN.findall(text or "")


def skeleton(text):
    """The text with each run of cooldown-family tags as one marker, and its words."""
    return " ".join(TAG_RUN.sub("\0", text or "").split())


# ---- cohorts --------------------------------------------------------------------------------------------
def cohort_members(cards):
    """[(entry, line, kind)]: the cards the cohorts are made of (kind = creature or minion; auxiliary creatures count as creatures)."""
    out = []
    for e in cards:
        if e.get("dup") or e.get("hidden") or e.get("parsed") is False:
            continue
        kind = "creature" if e.get("type") == AUX else e.get("type")
        line = entry_line(e)
        if kind in KINDS and line is not None:
            out.append((e, line, kind))
    return out


def cohort_key(kind, stars, sizes):
    """kind|stars, or kind|all when that star level is too small (or the card has none)."""
    key = f"{kind}|{stars}"
    return key if isinstance(stars, int) and sizes.get(key, 0) >= MIN_COHORT else f"{kind}|all"


def make_cohorts(members):
    sizes = Counter(f"{kind}|{e.get('stars')}" for e, _, kind in members if e.get("type") != AUX)
    groups = defaultdict(list)
    for e, line, kind in members:
        key = cohort_key(kind, e.get("stars") if e.get("type") != AUX else None, sizes)
        if not key.endswith("|all"):
            groups[key].append((e, line))
        groups[f"{kind}|all"].append((e, line))         # every member is in its kind's "all stars" cohort too
    cohorts = {}
    for key, rows in groups.items():
        kind, stars = key.split("|")
        cohort = {"kind": kind, "stars": None if stars == "all" else int(stars), "n": len(rows)}
        for i, k in enumerate(KEYS):
            cohort[k] = spread([sum(line) if k == "total" else line[i] for _, line in rows])
        totals = [sum(line) for _, line in rows]
        mean = sum(totals) / len(totals)
        cohort["total"].update(min=min(totals), max=max(totals), mean=round(mean, 2))
        cohort["total"]["sd"] = round((sum((t - mean) ** 2 for t in totals) / len(totals)) ** .5, 2)
        cohorts[key] = cohort
    order = lambda k: (KINDS.index(cohorts[k]["kind"]), cohorts[k]["stars"] is None, cohorts[k]["stars"] or 0)
    return {k: cohorts[k] for k in sorted(cohorts, key=order)}, groups, sizes


def card_balance(e, line, key, groups, cohort):
    rows = groups[key]
    columns = {k: sorted(sum(l) if k == "total" else l[i] for _, l in rows) for i, k in enumerate(KEYS)}
    values = dict(zip(KEYS, (*line, sum(line))))
    raw = {k: midrank(values[k], columns[k]) for k in KEYS}
    pct = {k: pct_of(v) for k, v in raw.items()}
    total = values["total"]
    sd = cohort["total"]["sd"]
    out = {"cohort": key, "stats": list(line), "pct": pct, "below": sum(1 for t in columns["total"] if t < total),
           "above": sum(1 for t in columns["total"] if t > total),
           "z_total": round((total - cohort["total"]["mean"]) / sd, 2) if sd else 0.0, "flags": []}
    if len(rows) >= MIN_COHORT:
        if raw["total"] >= TOP:
            out["flags"].append("top")
        elif raw["total"] <= BOTTOM:
            out["flags"].append("bottom")
    return out


# ---- versions and changes ---------------------------------------------------------------------------------
def when(v):
    """A version's start: its `version` record's from (a start the bot carried from a dropped copy), else its date."""
    start = (getattr(v, "version", None) or {}).get("from")
    return start if isinstance(start, (int, float)) else v.timestamp


def chain_of(name, stats, old_stats):
    """A card's versions oldest first, its current card last (archived names: no current card)."""
    versions = sorted((v for v in (old_stats.get(name) or []) if isinstance(getattr(v, "timestamp", None), (int, float))),
                      key=when)
    current = stats.get(name)
    return versions + ([current] if current is not None and isinstance(getattr(current, "timestamp", None), (int, float)) else [])


def shown(e, current):
    """The current card as its page shows it (Card Edits.json applied), with the bot card's date, blob and path."""
    return SimpleNamespace(timestamp=current.timestamp, version=getattr(current, "version", None),
                           blob_sha=getattr(current, "blob_sha", None), path=getattr(current, "path", None),
                           stats=SimpleNamespace(**{attr: e.get(k) for k, attr in STATS}), stars=e.get("stars"), card_type=e.get("type"),
                           subtype=e.get("subtype"), series=e.get("series"), types=e.get("types") or [],
                           creatures=e.get("creatures") or [], ability=e.get("ability"))


def page_chain(e, stats, old_stats):
    """chain_of for a site card: re-reads folded (a version read again at the same commit by a newer parser gives way to
    the newer reading) and the current card as shown."""
    chain = chain_of(e["key"], stats, old_stats)
    out = [v for v, w in zip(chain, chain[1:]) if v.timestamp != w.timestamp] + chain[len(chain) - 1:]
    if out and out[len(out) - 1] is stats.get(e["key"]):
        out[len(out) - 1] = shown(e, out[len(out) - 1])
    return out


def exact(v, psd_commits):
    """v's date (when) is a commit of its PSD: its own with its blob, a start with its commit, or a commit touched a PSD
    of its file name at that second."""
    at = when(v)
    if getattr(v, "blob_sha", None) and at == v.timestamp:
        return True
    if at != v.timestamp and (getattr(v, "version", None) or {}).get("from_commit"):
        return True
    name = os.path.basename(getattr(v, "path", None) or "").lower()
    return psd_commits is not None and (int(at), name) in psd_commits


def change(a, b, texts):
    """What changed from version a to version b ({} for nothing a page shows: art, a move, a re-read of the same text).
    texts = the card's history.json texts plus its current text: "text" holds their indices for the diff."""
    row = {}
    la, lb = line_of(getattr(a, "stats", None)), line_of(getattr(b, "stats", None))
    if la != lb and (la or lb):
        row["stats"] = [list(la) if la else None, list(lb) if lb else None]
        if la and lb and sum(la) <= OFF_SCALE and sum(lb) <= OFF_SCALE:
            row["bal"] = "buff" if sum(lb) > sum(la) else "nerf" if sum(lb) < sum(la) else "shift"
    for field, key in (("stars", "stars"), ("card_type", "kind"), ("subtype", "sub"), ("series", "series")):
        va, vb = getattr(a, field, None), getattr(b, field, None)
        if va != vb:
            row[key] = [va, vb]
    ta, tb = list(getattr(a, "types", None) or []), list(getattr(b, "types", None) or [])
    if sorted(ta) != sorted(tb):
        row["types"] = {"add": sorted(set(tb) - set(ta)), "drop": sorted(set(ta) - set(tb))}
    na, nb = len(getattr(a, "creatures", None) or []), len(getattr(b, "creatures", None) or [])
    if max(na, 1) != max(nb, 1):
        row["lines"] = [max(na, 1), max(nb, 1)]
    xa, xb = getattr(a, "ability", None) or "", getattr(b, "ability", None) or ""
    if xa != xb:
        index = {t: i for i, t in enumerate(texts)}
        row["text"] = [index.get(xa), index.get(xb)]
        if xa.split() == xb.split():
            row["ws"] = True                      # spacing only
        ra, rb = tag_runs(xa), tag_runs(xb)
        if sorted(ra) != sorted(rb):
            row["tags"] = [[x, y] for x, y in zip(ra, rb) if x != y] if len(ra) == len(rb) else [[" ".join(ra), " ".join(rb)]]
            if OLD_RE.search(xa) and not OLD_RE.search(xb) and NEW_RE.search(xb):
                row["old"] = True                 # from the old tags to cooldowns and uses
        if skeleton(xa) != skeleton(xb):
            row["words"] = True                   # the wording changed, not only the timing tags
    return row


def reworked(row):
    """A change to how the card plays: its wording, stats, stars, kind, item type, types or creatures (not its series,
    a spacing or timing-tag rename only)."""
    return any(k in row for k in ("words", "stats", "stars", "kind", "sub", "types", "lines"))


def card_changes(e, chain, psd_commits=None):
    """Rows newest first (chain: page_chain); approx: the newer version's date is not known to be its PSD's commit (an
    older record with no blob, and no commit of that PSD at that second)."""
    texts = [v["ability"] for v in e.get("history") or []] + [e.get("ability") or ""]
    rows = []
    for a, b in zip(chain, chain[1:]):
        row = change(a, b, texts)
        if row:
            if not exact(b, psd_commits):
                row["approx"] = True
            rows.append({"ts": int(when(b)), **row})
    return rows[::-1]                             # newest first


def trend_of(chain):
    """The card's distinct stat lines over time (chain: page_chain; on the scale), when there are two or more."""
    points = []
    for v in chain:
        line = line_of(getattr(v, "stats", None))
        if line and sum(line) <= OFF_SCALE and (not points or tuple(points[-1][k] for k, _ in STATS) != line):
            points.append({"ts": int(when(v)), **{k: x for (k, _), x in zip(STATS, line)}, "total": sum(line)})
    return points if len(points) > 1 else []


# ---- over time ------------------------------------------------------------------------------------------------
def point(v):
    return when(v), getattr(v, "card_type", None), getattr(v, "stars", None), line_of(getattr(v, "stats", None))


def over_time(cards, stats, old_stats, sizes, now):
    """{months: [...], series: {cohort key: [[n, mean, p10, p50, p90] or None per month]}}: at each month's end, the
    creatures and minions there were then with the stars and stats they had then. A card's start is its image's first
    upload (fs, full-history builds only) or its oldest version, whichever is earlier; an archived card ends at its tag."""
    lives = []
    for e in cards:
        if e.get("dup") or e.get("hidden") or e.get("parsed") is False or e.get("key") not in stats:
            continue
        points = [point(v) for v in page_chain(e, stats, old_stats)]                     # the current card as shown
        if not points:
            continue
        start = min([p[0] for p in points] + ([e["fs"]] if e.get("fs") else []))
        lives.append((start, None, points))
    for name, versions in old_stats.items():      # archived: deleted PSDs, tagged by the bot
        if name in stats or not versions:
            continue
        tag = getattr(versions[-1], "archived", None)
        at = tag.get("at") if isinstance(tag, dict) else None
        chain = chain_of(name, stats, old_stats)
        if isinstance(at, (int, float)) and chain:
            lives.append((when(chain[0]), at, [point(v) for v in chain]))
    if not lives:
        return {"months": [], "series": {}}
    months = months_between(month_of(min(s for s, _, _ in lives)), month_of(now))
    series = defaultdict(lambda: [None] * len(months))
    for i, month in enumerate(months):
        t = min(month_end(month), now)
        groups = defaultdict(list)
        for start, end, points in lives:
            if start >= t or (end is not None and end < t):
                continue
            then = [p for p in points if p[0] < t]
            _, kind, stars, line = then[-1] if then else points[0]       # before its first version: as first read
            if kind == AUX:
                kind, stars = "creature", None
            if kind not in KINDS or line is None or sum(line) > OFF_SCALE:
                continue
            key = cohort_key(kind, stars, sizes)
            if not key.endswith("|all"):
                groups[key].append(sum(line))
            groups[f"{kind}|all"].append(sum(line))
        for key, totals in groups.items():
            ordered = sorted(totals)
            series[key][i] = [len(ordered), round(sum(ordered) / len(ordered), 2),
                              quantile(ordered, .1), quantile(ordered, .5), quantile(ordered, .9)]
    return {"months": months, "series": dict(series)}


# ---- the file ----------------------------------------------------------------------------------------------------
def build(cards, stats, old_stats, now=None, history=True, psd_commits=None):
    """data/analytics.json for the site's card entries (before their history is moved to history.json). history = the
    build read the git history (fs is set): without it, no over-time series (cards would start at their last commit).
    psd_commits = {(commit time, PSD file name in lower case)} from that history: an older record dated by one is exact."""
    now = now or datetime.now(timezone.utc).timestamp()
    members = cohort_members(cards)
    cohorts, groups, sizes = make_cohorts(members)
    out_cards = {}
    for e, line, kind in members:
        key = cohort_key(kind, e.get("stars") if e.get("type") != AUX else None, sizes)
        out_cards[e["id"]] = card_balance(e, line, key, groups, cohorts[key])
    versions = 0
    for e in cards:
        if e.get("dup") or e.get("key") not in stats:
            continue
        versions += max(0, len(chain_of(e["key"], stats, old_stats)) - 1)
        chain = page_chain(e, stats, old_stats)
        rows = card_changes(e, chain, psd_commits)
        trend = trend_of(chain) if e["id"] in out_cards else []
        if rows or trend:
            entry = out_cards.setdefault(e["id"], {})
            if rows:
                entry["changes"] = rows
            if trend:
                entry["trend"] = trend
    first = min((when(v) for vs in old_stats.values() for v in vs or [] if isinstance(getattr(v, "timestamp", None), (int, float))), default=None)
    counts = Counter(e.get("type") for e, _, _ in members)
    return {"cohorts": cohorts, "cards": out_cards, "counts": dict(counts), "versions": versions, "since": int(first) if first else None,
            "time": over_time(cards, stats, old_stats, sizes, now) if history else {"months": [], "series": {}},
            "minCohort": MIN_COHORT, "offScale": OFF_SCALE}


def summary(data):
    """Log lines: the cohort sizes and what the history holds."""
    rows = [r for c in data["cards"].values() for r in c.get("changes", [])]
    sizes = ", ".join(f"{k} {c['n']}" for k, c in data["cohorts"].items())
    n = data["counts"]
    return [f"balance: {n.get('creature', 0) + n.get('minion', 0)} creatures and minions with all four stats, and {n.get(AUX, 0)} "
            f"auxiliary creatures (with all creatures); cohorts: {sizes}",
            f"balance: {data['versions']} versions; changes: {len(rows)}, reworks {sum(1 for r in rows if reworked(r))}, "
            f"buffs {sum(1 for r in rows if r.get('bal') == 'buff')}, nerfs {sum(1 for r in rows if r.get('bal') == 'nerf')}, "
            f"timing tags {sum(1 for r in rows if 'tags' in r)} ({sum(1 for r in rows if r.get('old'))} from the old tags), "
            f"approximate dates {sum(1 for r in rows if r.get('approx'))}"]
