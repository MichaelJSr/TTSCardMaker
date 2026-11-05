"""Build "stoogedings": a color icon font for Impossibility Simulator card text, from Types/*.png.

Set a token in this font and it turns into the icon (case-insensitive; space, _ and - are interchangeable):
  [fire]          the icon in its own colors (OpenType-SVG glyph with the PNG embedded)
  [fire:tint]     one-color version that takes the text color
  [fire:sticker]  the icon on an outline that takes the text color
  [fire:no]       the icon crossed out with a red prohibition sign
  [fire:glow]     the icon on a soft white halo; [fire:darkglow] on a soft black one
Every icon also has a fixed Private Use Area codepoint (stable across rebuilds), and U+2605 is the gold star.

Timing tags become badges: "(1CD)" set in this font draws a pill in the tag's color group (on your turn / at any
time / forced / per game and triggers). Cooldowns (nCD, a/bCD, nGCD, a/bGCD), uses (nU) and the rulebook's older
tags (nPT, EnT, FTEnT, nPGT, EnGT) all work; n can be 1-20 or X (the old tags 1-9), and in a/b the first number
-9 up to the second. "(Action)" gets a grey badge. Costs become badges too: "(2 points)" a green coin with the number
on it and "Points" in a pill, "(2 bricks)" a brown brick, "(2 SP)" and "(2 star points)" a yellow star with "SP"
(the TTS table's counter colours), "(4 souls)" and "(3 counters)" a teal pill; numbers 0-50, halves to 9.5 and X.
Any letter case works and draws the same badge: "(1cd)" is (1CD), "(action)" and "(ACTION)" are (Action). The text
is unchanged, so parsers and searches see the same thing as before. Badge letters and numbers are Roboto Black outlines
(MDW/Fonts/Roboto Black.ttf, OFL; owner 2026-11-04: was Changa One), at Changa One's old capital height.
A cooldown badge's left end is a ring, the website's (site/assets/text.js ringHtml): a segment per turn of charge,
the start's charge green, a start below zero red, the turns until its first full charge in the middle (green when
ready, red below zero, else light grey). No glow anywhere (owner 2026-11-04).
Under a Color/Gradient/Pattern Overlay a colour badge or :sticker is a blob (the overlay repaints every pixel), so
Stylistic Alternates (salt) swap them for one-colour shapes in the text color: a badge becomes a pill outline with solid
letters, a :sticker a thin outline around the :tint icon. The text is unchanged.

Renderer behavior that shaped the design (tested in Photoshop 2023 and macOS CoreText):
  * Photoshop renders SVG glyphs, including embedded PNGs, but paints SVG `currentColor` (and context-fill,
    CPAL var()) black. Anything that should follow the text color is therefore a plain TrueType outline.
  * Photoshop draws overlapping glyphs in text order, so :sticker is [outline][icon][spacer] and :no is
    [icon][zero-width sign], produced by GSUB multiple substitution; no PNG is stored twice. :glow and :darkglow
    are [halo][icon][spacer] the same way: the halo is its own PNG, drawn first.
    Apple apps (CoreText) draw plain outlines above SVG glyphs, so there :sticker shows only the outline.
  * CoreText ignores <use> that points at an <image>, so each color glyph embeds its PNG directly.
  * Photoshop draws SVG glyphs whole, past the line box (glow test 2026-10-23), so the halo may reach beyond
    ascent/descent; the spacers widen the token by the halo so it stays off the neighbouring letters.
  * A layer stroke outlines every bit of a halo's alpha (a black disc on stroked card text): use :glow on
    unstroked text.

usage: python build_stoogedings.py
Rebuilds MDW/Fonts/stoogedings.ttf from Types/ and Types/Stars/ of the repo this script lives in. Run it after
adding or changing icons, then commit stoogedings.ttf and stoogedings.json together with the PNGs.
stoogedings.json (token names, aliases, codepoints, per-icon tint modes) is updated in place: new PNGs get the
next free codepoint and existing codepoints never move.
needs: pip install -r requirements.txt   (fonttools, skia-pathops, opencv-python-headless, numpy, pillow)
"""
import base64
import io
import json
import math
import os
import re
from types import SimpleNamespace

import cv2
import numpy as np
from PIL import Image
from fontTools import subset
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen, RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.S_V_G_ import table_S_V_G_
from fontTools.ttLib.tables.otBase import USE_HARFBUZZ_REPACKER

TOP, HEIGHT = 820, 1000       # icon box: 0.82em above the baseline to 0.18em below (cards: icon ~1.5-1.9x cap height)
SIDE = 40                     # side bearing of a color icon, font units
MAX_W = 1400                  # very wide icons are scaled down to this width
RASTER = 256                  # long side of the embedded PNG, px (card icons render at ~80-150 px)
TRACE = 1024                  # long side used for tracing outlines, px
OUTLINE = 70                  # :sticker outline thickness, font units (~7 px at a 100 px font size)
STICKER_LINE = 40             # salt :sticker: outline thickness; the rest of OUTLINE is the gap to the icon
NO_RED = "#e01b22"
FIRST_PUA = 0xE000
# :glow halo: Nebulous_Precipice's darkmatter drop shadow (120 px, spread 20%, 80%), its size cut to 0.3 em (owner)
GLOW_SIZE = 300               # halo reach, font units
GLOW_SPREAD = 0.20            # Photoshop's Spread: the matte grows by this share of the size
GLOW_OPACITY = 0.80
GLOW_SIGMA = 0.42             # blur sigma per unit of blurred reach (fits that shadow)
GLOW_WORK = 2                 # font units per px while making it
GLOW_UPP = 12                 # font units per halo PNG px
GLOWS = {"glow": (255, 255, 255), "darkglow": (0, 0, 0)}

DEFAULT_ALIASES = {
    "darkmatter": ["dark matter"],
    "lightshadow": ["light shadow"],
    "buffstack": ["buff stack"],
    "debuffstack": ["debuff stack"],
    "debuffupgrade": ["debuff upgrade"],
    "nme": ["n.m.e"],
    "warpstar": ["warp star"],
    "yinyangultra": ["yin yang ultra", "yin yang"],
    "sapphire_starold": ["sapphire star"],
    "the_poorly_drawn_barnstar": ["poorly drawn barnstar", "barnstar"],
    "thunderfury_blessed_blade_of_the_starseeker": ["thunderfury"],
    "isaac_no_circle": ["isaac no circle"],
    "6star": ["6 star"], "7star": ["7 star"], "8star": ["8 star"],
}

DEFAULT_TINT = {   # chosen by eye from a silhouette / auto / cut-dark / cut-light comparison of every icon
    **{k: "silhouette" for k in ("girl", "buff", "debuff", "dark", "darkmatter", "fire", "light", "rock", "support", "water",
                                 "6star", "7star", "8star", "bgold", "bronze", "silver", "star", "null_star", "ruby_star",
                                 "ruby_star_pmttydns_icon", "sapphire_star_pmttydns_icon", "sapphire_starold", "dst_star",
                                 "elden_stars", "isaac_no_circle", "yinyangultra")},
    **{k: {"mode": "detail", "cut": "dark"} for k in ("undead", "unknown", "nebula_star", "bfables")},
}


# ---- config ---------------------------------------------------------------------------
def discover(repo):
    found = {}
    types_dir = os.path.join(repo, "Types")
    for f in sorted(os.listdir(types_dir)):
        if f.lower().endswith(".png"):
            # same key AutoCroissant uses for types: the lowercased file stem
            found[os.path.splitext(f)[0].lower()] = ("type", f"Types/{f}")
    for f in sorted(os.listdir(os.path.join(types_dir, "Stars"))):
        if f.lower().endswith(".png"):
            found[os.path.splitext(f)[0].lower().replace(" ", "_")] = ("star", f"Types/Stars/{f}")
    return found


def load_config(path, repo):
    cfg = json.load(open(path)) if os.path.exists(path) else {"icons": {}}
    icons = cfg["icons"]
    used = {int(v["pua"], 16) for v in icons.values()}
    nxt = max(used, default=FIRST_PUA - 1) + 1
    for key, (kind, rel) in discover(repo).items():
        if key not in icons:
            icons[key] = {"kind": kind, "file": rel, "pua": f"{nxt:04X}", "aliases": DEFAULT_ALIASES.get(key, []),
                          "tint": DEFAULT_TINT.get(key, "auto")}
            nxt += 1
        else:
            icons[key]["file"] = rel
    cfg["icons"] = dict(sorted(icons.items(), key=lambda kv: kv[1]["pua"]))
    return cfg


def spellings(name):
    words = [w for w in re.split(r"[ _\-]+", name.lower()) if w]
    return {sep.join(words) for sep in (" ", "_", "-", "")}


# ---- image -> masks -> outlines -----------------------------------------------------------
def remove_small(mask, min_area):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    return keep[lab]


def ellipse(r):
    r = max(1, int(round(r)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def silhouette(alpha):
    sil = alpha > 110
    sil = cv2.morphologyEx(sil.astype(np.uint8), cv2.MORPH_CLOSE, ellipse(1)).astype(bool)
    return remove_small(sil, max(12, sil.sum() * 0.0008))


def fill_holes(mask):
    m = np.pad(mask.astype(np.uint8), 1)
    flood = m.copy()
    cv2.floodFill(flood, None, (0, 0), 1)
    return (m | (1 - flood)).astype(bool)[1:-1, 1:-1]


def tint_mask(sil, rgb, opts):
    """One-color version: the silhouette with the icon's minority-tone details cut out (panda patches,
    skull eye sockets, bomb highlight), falling back to the plain silhouette when that gets noisy."""
    mode = opts if isinstance(opts, str) else opts.get("mode", "auto")
    if mode == "silhouette" or sil.sum() < 400:
        return sil
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]).astype(np.uint8)
    thr = opts.get("threshold") if isinstance(opts, dict) else None
    if thr is None:
        thr, _ = cv2.threshold(lum[sil].reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    dark = sil & (lum <= thr)
    frac_dark = dark.sum() / sil.sum()
    cut = opts.get("cut") if isinstance(opts, dict) else None
    if cut is None:
        cut = "dark" if frac_dark < 0.5 else "light"
    holes = dark if cut == "dark" else (sil & ~dark)
    frac = holes.sum() / sil.sum()
    if mode == "auto" and not 0.03 <= frac <= 0.45:
        return sil
    size = max(sil.shape)
    holes = cv2.morphologyEx(holes.astype(np.uint8), cv2.MORPH_OPEN, ellipse(size * 0.004)).astype(bool)
    holes = remove_small(holes, sil.sum() * 0.002)
    result = sil & ~holes
    result = cv2.morphologyEx(result.astype(np.uint8), cv2.MORPH_OPEN, ellipse(size * 0.003)).astype(bool)
    result = remove_small(result, sil.sum() * 0.002)
    if mode == "auto":
        n_parts = cv2.connectedComponentsWithStats(result.astype(np.uint8), 8)[0] - 1
        n_holes = cv2.connectedComponentsWithStats((~result & fill_holes(result)).astype(np.uint8), 8)[0] - 1
        if result.sum() < 0.5 * sil.sum() or n_parts > 12 or n_holes > 30:
            return sil
    return result


def sticker_mask(alpha, pad):
    """Outline shape: everything visible (incl. soft glows), small gaps bridged, holes filled, grown by `pad` px."""
    m = np.pad(alpha > 60, pad)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, ellipse(pad * 0.6)).astype(bool)
    m = fill_holes(remove_small(m, max(12, m.sum() * 0.001)))
    return cv2.dilate(m.astype(np.uint8), ellipse(pad)).astype(bool)


def halo(alpha, w_u, h_u):
    """Halo alpha (0..1) of a w_u x h_u unit icon, GLOW_SIZE beyond it, GLOW_WORK units per px."""
    size = (max(1, round(w_u / GLOW_WORK)), max(1, round(h_u / GLOW_WORK)))
    shrink = size[0] < alpha.shape[1]
    a = cv2.resize(alpha.astype(np.float32) / 255, size, interpolation=cv2.INTER_AREA if shrink else cv2.INTER_LINEAR)
    a = np.pad(a, round(GLOW_SIZE / GLOW_WORK))
    a = cv2.dilate(a, ellipse(GLOW_SPREAD * GLOW_SIZE / GLOW_WORK))
    sigma = GLOW_SIGMA * (1 - GLOW_SPREAD) * GLOW_SIZE / GLOW_WORK
    a = cv2.GaussianBlur(a, (0, 0), sigma, borderType=cv2.BORDER_CONSTANT)
    return a * GLOW_OPACITY


def icon_art(im, tint="auto"):
    """One icon's pictures, as its glyphs draw them; the website's variant images come from here too
    (site/build/build_site.py variant_art). im: the PNG as RGBA; tint: its manifest tint mode.
    Returns im cropped to its visible box, its size in font units (w_u, h_u), the TRACE-size pixels `arr` (upp units per
    px), the silhouette, the :tint mask, the :sticker mask (pad px past the icon on each side), the :glow halo (GLOW_WORK
    units per px) and glow_png, the halo PNG's alpha (GLOW_UPP units per px; the halo is glow_w x glow_h units)."""
    a = np.array(im.getchannel("A"))
    ys, xs = np.nonzero(a > 8)
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    aspect = im.width / im.height
    h_u = HEIGHT if HEIGHT * aspect <= MAX_W else MAX_W / aspect
    w_u = h_u * aspect
    big = im.copy()
    big.thumbnail((TRACE, TRACE), Image.LANCZOS)
    arr = np.array(big)
    upp = w_u / big.width
    sil = silhouette(arr[..., 3])
    pad = int(round(OUTLINE / upp))
    glow = halo(arr[..., 3], w_u, h_u)
    g_w, g_h = glow.shape[1] * GLOW_WORK, glow.shape[0] * GLOW_WORK
    size = (max(1, round(g_w / GLOW_UPP)), max(1, round(g_h / GLOW_UPP)))
    glow_png = np.clip(np.round(cv2.resize(glow, size, interpolation=cv2.INTER_AREA) * 255), 0, 255).astype(np.uint8)
    return SimpleNamespace(im=im, w_u=w_u, h_u=h_u, arr=arr, upp=upp, sil=sil, tint=tint_mask(sil, arr[..., :3], tint),
                           pad=pad, sticker=sticker_mask(arr[..., 3], pad), glow=glow, glow_w=g_w, glow_h=g_h,
                           glow_png=glow_png)


def trace(mask, upp, x0, top, external=False, eps=0.9):
    """Binary mask (y down, px) -> TrueType contours in font units (y up): outer clockwise, holes counter-clockwise."""
    mode = cv2.RETR_EXTERNAL if external else cv2.RETR_CCOMP
    contours, hier = cv2.findContours(mask.astype(np.uint8) * 255, mode, cv2.CHAIN_APPROX_NONE)
    polys = []
    if hier is None:
        return polys
    for c, h in zip(contours, hier[0]):
        if cv2.contourArea(c) < 4:
            continue
        c = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
        pts = []
        for px, py in c:
            p = (round(x0 + px * upp), round(top - py * upp))
            if not pts or p != pts[-1]:
                pts.append(p)
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts.pop()
        if len(pts) < 3:
            continue
        area = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))
        if area == 0:
            continue
        is_hole = h[3] != -1
        if (not is_hole and area > 0) or (is_hole and area < 0):
            pts.reverse()
        polys.append(pts)
    return polys


def circle(cx, cy, r, clockwise, n=64):
    pts = [(round(cx + r * math.cos(2 * math.pi * i / n)), round(cy + r * math.sin(2 * math.pi * i / n))) for i in range(n)]
    return pts[::-1] if clockwise else pts  # math order is counter-clockwise in y-up


def prohibition(cx, cy, r, w):
    """Red 'no' sign: ring + 45-degree bar, as TrueType contours and an SVG path (y flipped)."""
    ring = [circle(cx, cy, r, True), circle(cx, cy, r - w, False)]
    d, inner = w / 2, r - w / 2
    ux, uy = math.cos(math.radians(135)), math.sin(math.radians(135))   # bar from top-left to bottom-right
    nx, ny = -uy, ux
    ends = [(cx + ux * inner, cy + uy * inner), (cx - ux * inner, cy - uy * inner)]
    bar = [(round(ends[0][0] + nx * d), round(ends[0][1] + ny * d)), (round(ends[1][0] + nx * d), round(ends[1][1] + ny * d)),
           (round(ends[1][0] - nx * d), round(ends[1][1] - ny * d)), (round(ends[0][0] - nx * d), round(ends[0][1] - ny * d))]
    area = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(bar, bar[1:] + bar[:1]))
    if area > 0:
        bar.reverse()
    polys = ring + [bar]
    svg = " ".join("M" + " L".join(f"{x} {-y}" for x, y in p) + " Z" for p in polys)
    return polys, svg


# ---- timing-tag badges ---------------------------------------------------------------------
BADGE_GROUPS = {   # rulebook "02 Abbreviations": color (top, bottom, border) per time frame
    "turn":    ("#4f86f7", "#2563eb", "#1e3a8a"),   # on your turn: XCD, X/XCD, OYT; old XPT, EXT, FTEXT
    "any":     ("#9f67ff", "#7c3aed", "#4c1d95"),   # at any time: XGCD, X/XGCD, AAT; old XPGT, EXGT
    "forced":  ("#ef5050", "#dc2626", "#7f1d1d"),   # forced: BOT, ENDT, BOGT, ENDGT
    "trigger": ("#e08a1e", "#b45309", "#78350f"),   # per game and triggers: XPG, XU, OFS, OS, OD, WOF
    "neutral": ("#64748b", "#475569", "#1e293b"),   # not a timing tag: Action
}
BADGE_LABEL = {"-": "\u2212"}     # drawn as a minus sign
BADGE_BOTTOM, BADGE_TOP = -130, 820    # pill about as tall as the icons (0.95 em), centred on the capitals
BADGE_CAPS = 540                       # label capital height: close to the body text's own capitals (Changa One's, kept)
LABEL_FONT = "MDW/Fonts/Roboto Black.ttf"   # the badges' letters and numbers (owner 2026-11-04: was Changa One)
LABEL_METRICS = {   # badges set these unlike the label font: (lsb, rsb), its ink kept, or an advance (badge_web_font.py too)
    "1": (100, 111),                   # Roboto's tabular 1 (167, 351): "1CD" read "1 CD"; a stem's side-bearings
    "/": (100, 80),                    # its steep slash (-30, 11) fused with the figure before it: "1/2CD" read "V2CD"
    "X": (70, 35),                     # its X (4, 5) ran into a slash: "1/XCD", "X/2CD"
    " ": 310,                          # its word space (510): "4 Souls" as Changa One spaced it
}
BADGE_PAD = 200                        # space between label and pill ends
BADGE_TRACKING = 26                    # extra space between label letters
BADGE_BORDER = 30
BADGE_SIDE = 40
BADGE_LINE = 50                        # salt badge: pill outline thickness (same advance as the badge)


COUNTS = [*map(str, range(1, 21)), "X"]     # n of nCD, nGCD, nU, nPG and b of a/b (owner 2026-11-03: was 1-9)
FIRSTS = [*map(str, range(-9, 21)), "X"]    # a of a/b, the charge it starts with: up to b (was -1 to 9, any b)


def badge_tags():
    """Every timing tag plus Action: [(tag, group)]. The first 341 (n 1-9 or X, a/b with a from -1 to 9) keep their
    order and glyphs; the wider range (owner 2026-11-03: n up to 20, a from -9 up to b) follows them."""
    tags = _first_tags()
    seen = {t for t, _ in tags}
    more = [(f"{n}{kind}", group) for n in COUNTS
            for kind, group in (("CD", "turn"), ("GCD", "any"), ("U", "trigger"), ("PG", "trigger"))]
    for cd, group in (("CD", "turn"), ("GCD", "any")):
        more += [(f"{a}/{b}{cd}", group) for b in COUNTS for a in FIRSTS if "X" in (a, b) or int(a) <= int(b)]
    return tags + [t for t in more if t[0] not in seen and not seen.add(t[0])]


def _first_tags():
    """The 341 tags of 2026-10-22, in their glyph order."""
    nums, firsts = "123456789X", ["-1", *"0123456789", "X"]
    tags = [("OYT", "turn"), ("AAT", "any")]
    tags += [(t, "forced") for t in ("BOT", "ENDT", "BOGT", "ENDGT")]
    tags += [(t, "trigger") for t in ("OFS", "OS", "OD", "WOF")]
    tags += [("Action", "neutral")]   # the badge's label; CASE matches any case
    for n in nums:   # old system
        tags += [(f"{n}PT", "turn"), (f"E{n}T", "turn"), (f"FTE{n}T", "turn"),
                 (f"{n}PGT", "any"), (f"E{n}GT", "any"), (f"{n}PG", "trigger")]
    for n in nums:   # cooldowns and uses (2026-10-21)
        tags += [(f"{n}CD", "turn"), (f"{n}GCD", "any"), (f"{n}U", "trigger")]
    for cd, group in (("CD", "turn"), ("GCD", "any")):   # a/b cooldowns, e.g. (1/2CD), (-1/1GCD)
        tags += [(f"{a}/{b}{cd}", group) for a in firsts for b in nums]
    return tags


def num(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")   # 0.1 unit is plenty; keeps the SVG small


def badge_glyph(tag):
    return "badge_" + tag.replace("/", "_").replace("-", "m")   # glyph names can't hold "/"


def capsule(x0, y0, w, h, n=24):
    """Clockwise pill outline (y up) for the plain-glyph fallback."""
    r = h / 2
    pts = []
    for i in range(n + 1):                                    # right end, top to bottom
        a = math.pi / 2 - math.pi * i / n
        pts.append((round(x0 + w - r + r * math.cos(a)), round(y0 + r + r * math.sin(a))))
    for i in range(n + 1):                                    # left end, bottom to top
        a = -math.pi / 2 - math.pi * i / n
        pts.append((round(x0 + r + r * math.cos(a)), round(y0 + r + r * math.sin(a))))
    return pts


def rounded(x0, y0, w, h, r, n=6):
    """Clockwise rounded rectangle (y up)."""
    pts = []
    for cx, cy, a0 in ((x0 + w - r, y0 + h - r, 90), (x0 + w - r, y0 + r, 0), (x0 + r, y0 + r, -90), (x0 + r, y0 + h - r, 180)):
        pts += [(round(cx + r * math.cos(math.radians(a0 - 90 * i / n))), round(cy + r * math.sin(math.radians(a0 - 90 * i / n))))
                for i in range(n + 1)]
    return pts


def star(cx, cy, r, inner=0.5):
    """Clockwise five-pointed star (y up), a point up; inner: the inner corners' share of r."""
    return [(round(cx + (r if i % 2 == 0 else r * inner) * math.cos(math.radians(90 - 36 * i))),
             round(cy + (r if i % 2 == 0 else r * inner) * math.sin(math.radians(90 - 36 * i)))) for i in range(10)]


# ---- cost badges (owner 2026-11-03): the TTS table's counters' colours ------------------------
COST_NUMBERS = [*map(str, range(51)), *(f"{n}.5" for n in range(10)), "X"]
COSTS = {   # kind: (spellings in canonical case, label word (one, more), pill (top, bottom, border), word colour)
    "points": (("point", "points"), ("Point", "Points"), ("#08785a", "#034532", "#012419"), "#effff9"),
    "bricks": (("brick", "bricks"), ("Brick", "Bricks"), ("#5e3019", "#3f1d0c", "#241005"), "#ffe6d6"),
    "sp": (("SP", "star point", "star points"), ("SP", "SP"), ("#2a4a9e", "#172a63", "#0b1740"), "#eef2ff"),
    "souls": (("soul", "souls"), ("Soul", "Souls"), ("#149488", "#0f766e", "#0b4f4a"), "#ffffff"),
    "counters": (("counter", "counters"), ("Counter", "Counters"), ("#149488", "#0f766e", "#0b4f4a"), "#ffffff"),
}
COIN = "#00ffae"           # the Points counter (TTS save, ColorDiffuse 0, 1, 0.682)
BRICK = "#a0522d"          # the Bricks counter (0.627, 0.322, 0.176), brown (owner 2026-11-03)
STAR = "#ffff00"           # the Star Points counter (1, 1, 0)
ICON_INSET = 60            # the coin from the pill's left end (round in its round end)
BRICK_INSET = 150          # the brick's: its corners inside the round end
ICON_GAP = 80              # icon to word
COIN_H, BRICK_H = 830, 700
STAR_R = 600               # its points reach past the pill (the owner's 11-03 design), in its plain outline too
NUM_CAPS = 440             # the number on the icon
ICON_LINE = 34


def cost_badges():
    """[(glyph name, kind, number, [spellings])] for every cost: points, bricks, SP, souls, counters."""
    out = []
    for kind, (spellings, _, _, _) in COSTS.items():
        for n in COST_NUMBERS:
            out.append((f"badge_cost_{kind}_{n.replace('.', 'p')}", kind, n, [f"{n} {s}" for s in spellings]))
    return out


def badge_spellings():
    """Every typed tag the font draws as a badge, in its canonical case: the timing tags and the costs' spellings."""
    return [t for t, _ in badge_tags()] + [s for *_, spellings in cost_badges() for s in spellings]


def _set(glyphs, cmap, ch):
    """(glyph, advance, dx): a label-font character as badges set it, its outline moved dx (LABEL_METRICS)."""
    g, m = glyphs[cmap[ord(ch)]], LABEL_METRICS.get(ch)
    if m is None:
        return g, g.width, 0
    if not isinstance(m, tuple):
        return g, m, 0
    x0, _, x1, _ = _ink(glyphs, cmap, ch)
    return g, m[0] + x1 - x0 + m[1], m[0] - x0


def _set_ink(glyphs, cmap, ch):
    """(xMin, yMin, xMax, yMax, advance) of a character as badges set it (_set)."""
    _, adv, dx = _set(glyphs, cmap, ch)
    x0, y0, x1, y1 = _ink(glyphs, cmap, ch)
    return x0 + dx, y0, x1 + dx, y1, adv


def _merged(glyphs, draws):
    """RecordingPen (y up) of [(glyph, transform)] as one outline, its overlaps removed: Roboto Black's static instance
    keeps the variable font's overlapping contours (a T's stem and bar share its top edge), which the fork and FreeType
    count twice on a shared edge (a bright seam Photoshop doesn't draw)."""
    import pathops                                     # skia-pathops: only the badges' build needs it
    path = pathops.Path()
    for g, t in draws:
        rec = DecomposingRecordingPen(glyphs)
        g.draw(rec)
        rec.replay(TransformPen(path.getPen(), t))
    path.simplify(fix_winding=True, keep_starting_points=True, clockwise=True)
    out = RecordingPen()
    path.draw(out)
    return out


def _svg_d(rec):
    """SVG path data (y down) of a RecordingPen's outline (y up)."""
    pen = SVGPathPen(None, ntos=num)
    rec.replay(TransformPen(pen, (1, 0, 0, -1, 0, 0)))
    return pen.getCommands()


def _label(glyphs, cmap, text, x, baseline, caps_scale, tracking=BADGE_TRACKING, nudge=0.0):
    """(svg path, RecordingPen y up, width) of text in the label font from x on baseline (nudge: moved by it, the
    width as without)."""
    draws, x0 = [], x
    for ch in text:
        g, adv, dx = _set(glyphs, cmap, BADGE_LABEL.get(ch, ch))
        draws.append((g, (caps_scale, 0, 0, caps_scale, x + nudge + dx * caps_scale, baseline)))
        x += adv * caps_scale + tracking
    rec = _merged(glyphs, draws)
    return _svg_d(rec), rec, x - x0 - tracking


def _one_nudge(text, caps):
    """x to move a number by so that a leading 1 sits optically centred (its flag pulls its ink box left of its weight:
    the ring's lone 1 0.3 box units, a leading one 0.15, at their capitals), for capitals caps tall."""
    if not text.startswith("1"):
        return 0.0
    two = len(text) > 1
    return RING_ONE[two] / RING_CAPS[two] * caps


def _width(glyphs, cmap, text, caps_scale, tracking=BADGE_TRACKING):
    return sum(_set(glyphs, cmap, BADGE_LABEL.get(ch, ch))[1] * caps_scale for ch in text) + tracking * (len(text) - 1)


def _sides(glyphs, cmap, text, caps_scale):
    """(left, right) side-bearings of text as badges set it: its first character's, its last's, scaled."""
    first, last = (_set_ink(glyphs, cmap, BADGE_LABEL.get(c, c)) for c in (text[0], text[-1]))
    return first[0] * caps_scale, (last[4] - last[2]) * caps_scale


def _ring(outer, inner):
    return [outer, inner[::-1]]


def cost_badge(glyphs, cmap, cap_height, kind, n):
    """(plain outline, svg body, advance, (salt outline, salt label)) of one cost badge."""
    _, words, (top, bottom, border), ink = COSTS[kind]
    word = words[0] if n == "1" else words[1]
    height, mid = BADGE_TOP - BADGE_BOTTOM, (BADGE_TOP + BADGE_BOTTOM) / 2
    scale, nscale = BADGE_CAPS / cap_height, NUM_CAPS / cap_height
    left = BADGE_SIDE
    defs = (f'<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/>'
            f'<stop offset="1" stop-color="{bottom}"/></linearGradient>')
    art, salt = "", []
    if kind in ("souls", "counters"):                     # a card's own currency: a text pill, like a timing tag
        text = f"{n} {word}"
        w = _width(glyphs, cmap, text, scale)
        width = max(height, w + 2 * BADGE_PAD)
        lsb, rsb = _sides(glyphs, cmap, text, scale)       # its ink centred, as a timing tag's
        d, rec, _ = _label(glyphs, cmap, text, left + (width - (w - lsb - rsb)) / 2 - lsb, mid - BADGE_CAPS / 2, scale)
        art, labels = f'<path d="{d}" fill="{ink}"/>', [rec]
    else:
        nw = _width(glyphs, cmap, n, nscale, 10)
        if kind == "sp":
            r = STAR_R
            cx, cy = left + 20 + r * math.sin(math.radians(72)), mid + 40
            k = min(1, 0.88 * r / nw)                     # long numbers shrink onto the star
            icon_w = 2 * r * math.sin(math.radians(72)) + 20
            pts = star(cx, cy, r)
            svg = lambda ps: "M" + " L".join(f"{x} {-y}" for x, y in ps) + " Z"    # paths: the fork leaves a polygon open
            defs += (f'<radialGradient id="i" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#ffffe8"/>'
                     f'<stop offset=".3" stop-color="#ffff70"/><stop offset=".55" stop-color="{STAR}"/>'
                     f'<stop offset=".85" stop-color="#d9c800"/><stop offset="1" stop-color="#a69400"/></radialGradient>')
            art = (f'<path d="{svg(pts)}" fill="#6e6200"/>'                  # its edge: the star under a smaller one
                   f'<path d="{svg(star(cx, cy, r - 1.8 * ICON_LINE))}" fill="url(#i)"/>'
                   f'<ellipse cx="{num(cx - 0.24 * r)}" cy="{num(-(cy + 0.24 * r))}" rx="{num(0.1 * r)}" ry="{num(0.06 * r)}" '
                   f'fill="#ffffff" opacity="0.75"/>')
            ncol, nshadow = "#3b3300", None
            ring = _ring(pts, star(cx, cy, r - 2.2 * ICON_LINE))
            ncx, ncy = cx, cy - 0.06 * r
        else:
            coin = kind == "points"
            h = COIN_H if coin else BRICK_H
            icon_w = max(h if coin else 1060, nw + 2 * (190 if coin else 200))
            x0, y0 = left + (ICON_INSET if coin else BRICK_INSET), mid - h / 2
            rx = h / 2 if coin else 70
            if coin:
                grad = (f'<radialGradient id="i" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#e8fff7"/>'
                        f'<stop offset=".3" stop-color="#6dffd0"/><stop offset=".58" stop-color="{COIN}"/>'
                        f'<stop offset="1" stop-color="#00a36c"/></radialGradient>')
                inset = 105
                art = (f'<rect x="{num(x0)}" y="{num(-(y0 + h))}" width="{num(icon_w)}" height="{h}" rx="{num(rx)}" '
                       f'fill="url(#i)" stroke="#00603f" stroke-width="{ICON_LINE}"/>'
                       f'<rect x="{num(x0 + inset)}" y="{num(-(y0 + h - inset))}" width="{num(icon_w - 2 * inset)}" '
                       f'height="{h - 2 * inset}" rx="{num(rx - inset)}" fill="none" stroke="#00c98a" stroke-width="30"/>'
                       f'<ellipse cx="{num(x0 + 0.3 * h)}" cy="{num(-(y0 + 0.74 * h))}" rx="{num(0.13 * h)}" '
                       f'ry="{num(0.075 * h)}" fill="#ffffff" opacity="0.6"/>')
                ncol, nshadow = "#003d29", None
            else:
                grad = (f'<linearGradient id="i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c97b52"/>'
                        f'<stop offset=".45" stop-color="{BRICK}"/><stop offset="1" stop-color="#7a3a1c"/></linearGradient>')
                art = (f'<rect x="{num(x0)}" y="{num(-(y0 + h))}" width="{num(icon_w)}" height="{h}" rx="{rx}" '
                       f'fill="url(#i)" stroke="#3d1a08" stroke-width="{ICON_LINE}"/>'
                       f'<rect x="{num(x0 + 70)}" y="{num(-(y0 + h - 50))}" width="{num(icon_w - 140)}" height="44" rx="22" '
                       f'fill="#ffffff" opacity="0.35"/>'
                       f'<rect x="{num(x0 + 70)}" y="{num(-(y0 + 94))}" width="{num(icon_w - 140)}" height="44" rx="22" '
                       f'fill="#000000" opacity="0.22"/>')
                ncol, nshadow = "#ffffff", "#3d1a08"
            defs += grad
            k = 1
            outer = (capsule(round(x0), round(y0), round(icon_w), h) if coin
                     else rounded(round(x0), round(y0), round(icon_w), h, rx))
            t = 2 * ICON_LINE
            inner = (capsule(round(x0 + t), round(y0 + t), round(icon_w - 2 * t), h - 2 * t) if coin
                     else rounded(round(x0 + t), round(y0 + t), round(icon_w - 2 * t), h - 2 * t, max(rx - t, 10)))
            ring = _ring(outer, inner)
            ncx, ncy = x0 + icon_w / 2, mid
            icon_w += ICON_INSET if coin else BRICK_INSET
        nl, nr = _sides(glyphs, cmap, n, nscale)
        nx = ncx - (nw - nl - nr) * k / 2 - nl * k            # its ink centred on the icon, as the ring's number (a 1
        nudge = _one_nudge(n, NUM_CAPS * k)                   # optically)
        nd, nrec, _ = _label(glyphs, cmap, n, nx, ncy - NUM_CAPS * k / 2, nscale * k, 10 * k, nudge)
        if nshadow:
            sd, _, _ = _label(glyphs, cmap, n, nx, ncy - NUM_CAPS * k / 2 - 28, nscale * k, 10 * k, nudge)
            art += f'<path d="{sd}" fill="{nshadow}" opacity="0.7"/>'
        art += f'<path d="{nd}" fill="{ncol}"/>'
        ww = _width(glyphs, cmap, word, scale)
        width = icon_w + ICON_GAP + ww + 210
        wd, wrec, _ = _label(glyphs, cmap, word, left + icon_w + ICON_GAP, mid - BADGE_CAPS / 2, scale)
        art += f'<path d="{wd}" fill="{ink}"/>'
        salt, labels = ring, [nrec, wrec]
    width = round(width)
    body = (f'<defs>{defs}</defs><rect x="{left}" y="{-BADGE_TOP}" width="{width}" height="{height}" '
            f'rx="{height / 2:.0f}" ry="{height / 2:.0f}" fill="url(#g)" stroke="{border}" stroke-width="{BADGE_BORDER}"/>'
            + art)
    outline = [capsule(left, BADGE_BOTTOM, width, height)]
    t = BADGE_LINE
    ring = outline + [capsule(left + t, BADGE_BOTTOM + t, width - 2 * t, height - 2 * t)[::-1]] + salt
    if kind == "sp":                   # the plain outline holds the star's points too: Photoshop clips the SVG to its box
        outline = outline + [pts]
    letters = RecordingPen()
    for rec in labels:
        rec.replay(letters)
    return outline, body, width + 2 * BADGE_SIDE, (ring, letters)


def cap_height(glyphs, cmap):
    """The label font's capital height: the top of its H's ink (a flat top), font units."""
    return _ink(glyphs, cmap, "H")[3]


def build_badges(label_font_path):
    """[(spellings, glyph name, plain outline, svg body, advance, (salt outline, salt label), first)] for every timing
    tag and cost; first: one of the 341 of 2026-10-22 (their glyphs keep their place)."""
    label = TTFont(label_font_path)
    glyphs, cmap = label.getGlyphSet(), label.getBestCmap()
    caps, out = cap_height(glyphs, cmap), []
    for name, kind, n, spellings in cost_badges():
        outline, body, advance, alt = cost_badge(glyphs, cmap, caps, kind, n)
        out.append((spellings, name, outline, body, advance, alt, False))
    return _tag_badges(glyphs, cmap, caps) + out


# ---- cooldown rings (owner 2026-11-04, design B): site/assets/text.js ringHtml, the cooldown badge's left end ------
# Its 22-unit box is the pill's height, on the pill's left cap, RING_S font units a unit: a dark body; a rim in the
# group's colour, lighter than the pill and shaded top to bottom like it, inside the pill's border (drawn over the
# ring); X segments (the charge needed) from the top, parallel-sided slots between them: the charge it starts with
# clockwise in green, a start below zero counter-clockwise in red (a whole ring or more below zero: all red), the rest
# hollow, outlined inside its own footprint; more than a whole ring below zero (owner 2026-11-04, "C2"): the red band
# thinner (RING_DEEP_IN) and inside it a thin red lap ring per further ring, up to 2 (RING_LAPS), over the segments that
# deep, slotted as the band; past 8 segments arcs by share; X two dashed circles (green for (X/XCD), full). In the
# middle the turns until its first full charge, its ink box centred in the ring (a 1 optically: RING_ONE), clear of the
# lap rings: green when that is 0 or 1 (ready on its first turn; (X/XCD) a 0), red below zero ((-1/XCD) a red X), else
# light grey (X too). No glow, in or outside the pill (owner 2026-11-04: layer strokes and shadows traced a halo into a lump).
# Nothing inks past the pill, so a layer's stroke or shadow traces the plain capsule.
# The label after it, centred by its ink between the rim and the pill's end (RING_ENDS). The fork's SVG renderer strokes
# rects only and blends opacity in linear light: every line is a filled outline in an opaque colour, the number Roboto
# Black outlines.
# Under salt: in the text colour inside the ordinary pill outline, no body or rim; charge solid, a start below zero a
# thin band along the inside with no outer edge (past 8 segments too), lap rings as in colour, charge to come
# outlined; a divider after the ring (SALT_DIVIDER), the ring centred between it and the outline, closes it off from
# the label (a thin layer stroke left art showing between).
RING_D = BADGE_TOP - BADGE_BOTTOM                  # the box: the pill's height
RING_GAP = 60                                      # with RING_D - BADGE_PAD: the 810 units the ring adds
RING_S = RING_D / 22                               # font units per box unit
RING_MID = (BADGE_TOP + BADGE_BOTTOM) / 2          # centred on the pill
RING_IN, RING_OUT = 6.2, 9.4                       # the segments' radii (box units)
RING_DEEP_IN = 7.25                                # more than a whole ring below zero: the band's inner radius
RING_LAPS = ((6.1, 6.7), (5.18, 5.65))             # its lap rings inside the band, the 1st further ring, the 2nd (thinner:
                                                   # the number 0.37 clear, the 7 of (-6/1CD); 5.05 left it 0.24)
RING_SLOT = 1.1                                    # between segments: a channel this wide
RING_W = 0.9                                       # a hollow segment's outline, inside its footprint
RING_BODY_R = 10.45
RING_RIM_R = (9.9, 11 - BADGE_BORDER / 2 / RING_S)    # the rim: to the pill border's inside edge
RING_RIM = {"turn": ("#92b4fa", "#5b8ff9"), "any": ("#c7a6ff", "#a274ff")}    # top, bottom (the pill's, lifted)
RING_GREEN, RING_RED, RING_BODY = "#4ade80", "#ef4444", "#1c2030"    # red: the website's and the picked preview's
RING_HOLLOW, RING_FAINT = "#c7c9cf", "#b3b5bc"     # #e5e7eb at .85 / .75 over the body, opaque
RING_NUMBER = ("#4ade80", "#ff6b6b", "#e5e7eb")    # ready, below zero, else
RING_CAPS = (7.8, 5.7)                             # the number's capital height: one character, two
RING_NUM_MID, RING_TRACK = 11, -0.45               # its ink box's middle: the ring's; two characters'
RING_ONE = (-0.3, -0.15)                           # a lone 1 moved this far, a leading 1 this: its flag pulls its ink box
                                                   # left of its weight (centroid +0.62 / +0.33 off the box's middle)
RING_ENDS = 86                                     # label: right ink gap less the left in the pill's box, so that the
                                                   # visible walls (the rim's edge, the border's inner edge, both 15 in
                                                   # and r 460) leave it even: their round ends' curve, 2 x 27.9, + 2 x 15
RING_DASH = (2.6, 0.54)                            # dashes: about this period, this share of it lit
SALT_OUT = 9.0                                     # salt: the segments' outer radius, clear of the pill outline
SALT_BAND = 1.4                                    # salt: a start below zero, a band this wide along the inside
SALT_LINE = BADGE_LINE / RING_S                    # salt: the pill outline, and the divider closing the ring off from the
                                                   # label (thin layer strokes left art between)
SALT_DIVIDER = (22 - SALT_LINE, 22 + 16 / RING_S)  # salt: the divider's sides (box units): the outline mirrored (the ring
                                                   # centred in its compartment), to where the label's gap to it stays as
                                                   # before RING_ENDS moved the label 16 left (wider, a layer stroke leaves
                                                   # art beside a 1's stem: Papa Chip's hole 21 -> 41 px)


def cooldown_of(tag):
    """(cap, start) of a cooldown tag, "X" where it says X: (2CD) (2, 0), (-1/1GCD) (1, -1); None for another tag
    (text.js cooldownOf)."""
    m = re.fullmatch(r"(?:(-?\d+|X)/)?(\d+|X)G?CD", tag)
    if not m:
        return None
    n = lambda v: v if v == "X" else int(v)
    return n(m[2]), 0 if m[1] is None else n(m[1])


def _rpt(r, a):
    """Box point at radius r, angle a (degrees clockwise from up), y down."""
    return 11 + r * math.sin(math.radians(a)), 11 - r * math.cos(math.radians(a))


def _side(r, a, d):
    """The angle at radius r of the line d from the radial at a, parallel to it (d > 0: clockwise of it)."""
    return a + math.degrees(math.asin(d / r))


def _seg(r0, r1, a0, a1, d=0.0):
    """text.js seg(): an annular sector r0..r1, a0 to a1, its sides d inside the radials at a0 and a1 and parallel to
    them, clockwise, as contours of ("M" | "L", x, y) and ("A", r, from, to)."""
    if not d and a1 - a0 > 359:
        return _seg(r0, r1, a0, a0 + 180) + _seg(r0, r1, a0 + 180, a0 + 360)
    b0, b1, c0, c1 = _side(r1, a0, d), _side(r1, a1, -d), _side(r0, a0, d), _side(r0, a1, -d)
    return [[("M", *_rpt(r1, b0)), ("A", r1, b0, b1), ("L", *_rpt(r0, c1)), ("A", r0, c1, c0)]]


def _hollow(r0, r1, a0, a1, d):
    """_seg's outline, RING_W wide inside it: the footprint clockwise, the hole counter."""
    w = RING_W
    q0, q1, e = r0 + w, r1 - w, d + w
    b0, b1, c0, c1 = _side(q1, a0, e), _side(q1, a1, -e), _side(q0, a0, e), _side(q0, a1, -e)
    return _seg(r0, r1, a0, a1, d) + [[("M", *_rpt(q1, b1)), ("A", q1, b1, b0), ("L", *_rpt(q0, c0)), ("A", q0, c0, c1)]]


def _annulus(r0, r1):
    return [[("M", *_rpt(r1, 0)), ("A", r1, 0, 360)], [("M", *_rpt(r0, 0)), ("A", r0, 360, 0)]]


def _clockwise(pts):
    s = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))
    return pts if s > 0 else pts[::-1]                 # y down: a positive area is clockwise


def _dash_n(r):
    """Dashes round a circle of radius r: an even count, about RING_DASH[0] apart."""
    return 2 * max(1, round(2 * math.pi * r / RING_DASH[0] / 2))


def _dash_circle(r, w):
    """text.js dashCircle(): a circle's dashes, w wide, evenly round it, a gap centred at the top (mirror-symmetric)."""
    n, lit = _dash_n(r), RING_DASH[1] * 180 / _dash_n(r)
    return [c for k in range(n) for c in _seg(r - w / 2, r + w / 2, (k + 0.5) * 360 / n - lit, (k + 0.5) * 360 / n + lit)]


def _dash_sides(r0, r1, a0, a1, d):
    """A start-X segment's sides along its hollow outline's middle: [("arc", r, from, to) | ("line", p, q)] clockwise."""
    h = RING_W / 2
    R1, R0, e = r1 - h, r0 + h, d + h
    b0, b1, c0, c1 = _side(R1, a0, e), _side(R1, a1, -e), _side(R0, a0, e), _side(R0, a1, -e)
    return [("arc", R1, b0, b1), ("line", _rpt(R1, b1), _rpt(R0, c1)), ("arc", R0, c1, c0), ("line", _rpt(R0, c0), _rpt(R1, b0))]


def _dash_seg(r0, r1, a0, a1, d):
    """text.js dashSeg(): a start-X segment, its hollow outline dashed: each side's dashes spread evenly with one centred
    on every corner (a square there joins its two halves)."""
    h, out = RING_W / 2, []
    for kind, p, q, *rest in _dash_sides(r0, r1, a0, a1, d):
        if kind == "arc":
            r, f0, f1 = p, q, rest[0]
            n = max(1, round(abs(math.radians(f1 - f0)) * r / RING_DASH[0]))
            lit = RING_DASH[1] / 2 * (f1 - f0) / n
            for k in range(n + 1):
                u, v = sorted((f0 + k * (f1 - f0) / n - lit, f0 + k * (f1 - f0) / n + lit))
                u, v = max(u, min(f0, f1)), min(v, max(f0, f1))
                out += _seg(r - h, r + h, u, v)
            continue
        (x0, y0), (x1, y1) = p, q
        L = math.dist(p, q)
        tx, ty = (x1 - x0) / L, (y1 - y0) / L
        n = max(1, round(L / RING_DASH[0]))
        lit = RING_DASH[1] / 2 * L / n
        for k in range(n + 1):
            u, v = max(0, k * L / n - lit), min(L, k * L / n + lit)
            a, b = (x0 + tx * u, y0 + ty * u), (x0 + tx * v, y0 + ty * v)
            pts = [(a[0] - ty * h, a[1] + tx * h), (b[0] - ty * h, b[1] + tx * h), (b[0] + ty * h, b[1] - tx * h),
                   (a[0] + ty * h, a[1] - tx * h)]
            pts = _clockwise(pts)
            out.append([("M", *pts[0])] + [("L", *pt) for pt in pts[1:]])
        for cx, cy in (p, q):                          # the corners: squares along the side
            pts = _clockwise([(cx + h * (sx * tx - sy * ty), cy + h * (sx * ty + sy * tx)) for sx, sy in ((1, 1), (1, -1), (-1, -1), (-1, 1))])
            out.append([("M", *pts[0])] + [("L", *pt) for pt in pts[1:]])
    return out


def ring_parts(cap, start, one=False):
    """The ring of a cooldown (cooldown_of) as [(paint, contours)] in drawing order, box units: paint body, rim, green,
    red, hollow, faint (past 8 segments: the band's edges) or, one (salt), ink; and (number text, colour, ready)."""
    unknown = "X" in (cap, start) and cap != start      # (X/XCD): fully charged, a green 0
    debt = 0 if unknown or cap == "X" else max(0, -start)
    have = 0 if unknown or cap == "X" else max(0, min(start, cap))
    wait = "X" if unknown else 0 if cap == "X" else max(0, cap - start)
    ready = not unknown and wait <= 1
    r0, r1, d = RING_DEEP_IN if cap != "X" and debt > cap else RING_IN, SALT_OUT if one else RING_OUT, RING_SLOT / 2
    ink = (lambda p: "ink") if one else (lambda p: p)
    parts = [] if one else [("body", _annulus(0, RING_BODY_R)[:1]), ("rim", _annulus(*RING_RIM_R))]
    if cap == "X":                                     # (X/XCD): full, its dashes green
        parts.append((ink("green" if start == "X" else "hollow"),
                      _dash_circle(r1 - RING_W / 2, RING_W) + _dash_circle(r0 + RING_W / 2, RING_W)))
    elif cap <= 8:
        for i in range(cap):
            a0, a1 = i * 360 / cap, (i + 1) * 360 / cap
            if start == "X":
                parts.append((ink("hollow"), _dash_seg(r0, r1, a0, a1, d)))
            elif i < have:
                parts.append((ink("green"), _seg(r0, r1, a0, a1, d)))
            elif debt > cap - 1 - i:                   # counter-clockwise from the top
                parts.append(("ink", _seg(r0, r0 + SALT_BAND, a0, a1, d)) if one else ("red", _seg(r0, r1, a0, a1, d)))
                for lap in RING_LAPS[:(debt - cap + i) // cap]:   # its further rings below zero
                    parts.append((ink("red"), _seg(*lap, a0, a1, d)))
            else:
                parts.append((ink("hollow"), _hollow(r0, r1, a0, a1, d)))
    else:
        due = 360 - min(debt, cap) / cap * 360         # below zero from here round to the top
        if one and debt:                               # salt: no outer edge over the below-zero arc, as up to 8
            parts.append(("ink", _annulus(r0, r0 + 0.8) + (_seg(r1 - 0.8, r1, 0, due) if due > 0 else [])))
        else:
            parts.append((ink("faint"), _annulus(r1 - 0.8, r1) + _annulus(r0, r0 + 0.8)))
        if have:
            parts.append((ink("green"), _seg(r0, r1, 0, have / cap * 360)))
        if debt:
            parts.append((ink("red"), _seg(r0, r0 + SALT_BAND if one else r1, due, 360)))
        for j, lap in enumerate(RING_LAPS):            # further rings below zero, by share
            if debt > (j + 1) * cap:
                parts.append((ink("red"), _seg(*lap, 360 - min(debt - (j + 1) * cap, cap) / cap * 360, 360)))
    if one:                                            # salt: a divider after the ring (SALT_DIVIDER)
        (x0, x1), y0, y1 = SALT_DIVIDER, SALT_LINE, 22 - SALT_LINE
        parts.append(("ink", [[("M", x0, y0), ("L", x1, y0), ("L", x1, y1), ("L", x0, y1)]]))
    merged = []                                        # one path per paint run
    for paint, cs in parts:
        if merged and merged[-1][0] == paint:
            merged[-1][1].extend(cs)
        else:
            merged.append((paint, list(cs)))
    colour = RING_NUMBER[0] if ready else RING_NUMBER[1] if start != "X" and start < 0 else RING_NUMBER[2]   # (-1/XCD) too
    return merged, (str(wait), colour, ready)


def _ring_xy(x, y):
    """Box point -> font units, y down (SVG)."""
    return BADGE_SIDE + x * RING_S, -RING_MID + (y - 11) * RING_S


def _ring_d(contours):
    """SVG path data of contours, arcs as cubics of 90 degrees at most."""
    out = []
    for c in contours:
        for op in c:
            if op[0] != "A":
                x, y = _ring_xy(op[1], op[2])
                out.append(f"{op[0]}{num(x)} {num(y)}")
                continue
            _, r, a0, a1 = op
            n = max(1, math.ceil(abs(a1 - a0) / 90 - 1e-9))
            step = (a1 - a0) / n
            k = 4 / 3 * math.tan(math.radians(step) / 4) * r
            for i in range(n):
                b0, b1 = math.radians(a0 + i * step), math.radians(a0 + (i + 1) * step)
                (x0, y0), (x1, y1) = _rpt(r, math.degrees(b0)), _rpt(r, math.degrees(b1))
                pts = [(x0 + k * math.cos(b0), y0 + k * math.sin(b0)), (x1 - k * math.cos(b1), y1 - k * math.sin(b1)), (x1, y1)]
                out.append("C" + " ".join(f"{num(px)} {num(py)}" for px, py in map(lambda p: _ring_xy(*p), pts)))
        out.append("Z")
    return "".join(out)


def _ring_polys(contours):
    """TrueType contours of contours (font units, y up), arcs in steps of 3 degrees at most."""
    polys = []
    for c in contours:
        pts = []
        for op in c:
            if op[0] != "A":
                pts.append(_ring_xy(op[1], op[2]))
                continue
            _, r, a0, a1 = op
            n = max(1, math.ceil(abs(a1 - a0) / 3))
            pts += [_ring_xy(*_rpt(r, a0 + (a1 - a0) * i / n)) for i in range(1, n + 1)]
        p = []
        for x, y in pts:
            q = (round(x), round(-y))
            if not p or q != p[-1]:
                p.append(q)
        while len(p) > 1 and p[0] == p[-1]:
            p.pop()
        if len(p) >= 3:
            polys.append(p)
    return polys


def _ink(glyphs, cmap, ch):
    """(xMin, yMin, xMax, yMax) of a label-font character's outline."""
    pen = BoundsPen(glyphs)
    glyphs[cmap[ord(ch)]].draw(pen)
    return pen.bounds


def ring_number(glyphs, cmap, cap_height, text):
    """[(character, x, y, k)]: the ring's number in the label font, each character's origin (box units, y down) and
    scale (box units per font unit), its ink box centred at (11, RING_NUM_MID) (text.js RING_DIGITS: these outlines, as
    badges set them: _set)."""
    k = RING_CAPS[len(text) > 1] / cap_height
    track = RING_TRACK if len(text) > 1 else 0
    xs, x = [], 0
    for c in text:
        xs.append(x)
        x += _set(glyphs, cmap, c)[1] * k + track
    boxes = [_set_ink(glyphs, cmap, c) for c in text]
    x0, x1 = xs[0] + boxes[0][0] * k, xs[-1] + boxes[-1][2] * k
    y0, y1 = min(b[1] for b in boxes) * k, max(b[3] for b in boxes) * k
    dx, base = 11 - (x0 + x1) / 2 + _one_nudge(text, RING_CAPS[len(text) > 1]), RING_NUM_MID + (y0 + y1) / 2
    return [(c, dx + x, base, k) for c, x in zip(text, xs)]


def _ring_number(glyphs, cmap, cap_height, text, pen, flip):
    """ring_number drawn into pen, its overlaps removed (_merged): SVG units (flip: y down) or glyf units (y up)."""
    draws = []
    for c, x, y, k in ring_number(glyphs, cmap, cap_height, text):
        g, _, dx = _set(glyphs, cmap, c)
        X, Y = _ring_xy(x + dx * k, y)
        draws.append((g, (k * RING_S, 0, 0, k * RING_S, X, -Y)))
    _merged(glyphs, draws).replay(TransformPen(pen, (1, 0, 0, -1, 0, 0)) if flip else pen)


def ring_art(glyphs, cmap, cap_height, cooldown, group):
    """(svg defs, svg of the ring over the pill, salt contours, salt number pen) of a cooldown's ring; all of it inside
    the pill (the glyph's plain outline)."""
    top, bottom = RING_RIM[group]
    paint = {"body": f'fill="{RING_BODY}"', "rim": 'fill="url(#h)"', "green": f'fill="{RING_GREEN}"',
             "red": f'fill="{RING_RED}"', "hollow": f'fill="{RING_HOLLOW}"', "faint": f'fill="{RING_FAINT}"'}
    parts, (text, colour, _) = ring_parts(*cooldown)
    assert max(op[1] if op[0] == "A" else math.dist(op[1:], (11, 11)) for _, cs in parts for c in cs for op in c) <= 11
    R, half = RING_RIM_R[1], RING_D / 2 / RING_S      # the rim's gradient over the pill's height, as the pill's
    defs = (f'<linearGradient id="h" x1="0" y1="{num4((R - half) / (2 * R))}" x2="0" y2="{num4((R + half) / (2 * R))}">'
            f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>')
    body = "".join(f'<path d="{_ring_d(cs)}" {paint[p]}/>' for p, cs in parts)
    pen = SVGPathPen(glyphs, ntos=num)
    _ring_number(glyphs, cmap, cap_height, text, pen, True)
    body += f'<path d="{pen.getCommands()}" fill="{colour}"/>'
    salt, _ = ring_parts(*cooldown, one=True)
    letters = RecordingPen()
    _ring_number(glyphs, cmap, cap_height, text, letters, False)
    return defs, body, _ring_polys([c for _, cs in salt for c in cs]), letters


def num4(v):
    return f"{v:.4f}".rstrip("0").rstrip(".")


def _tag_badges(glyphs, cmap, cap_height):
    scale = BADGE_CAPS / cap_height
    height = BADGE_TOP - BADGE_BOTTOM
    baseline = (BADGE_TOP + BADGE_BOTTOM) / 2 - BADGE_CAPS / 2
    out, tags, first = [], badge_tags(), {t for t, _ in _first_tags()}
    assert len({badge_glyph(t) for t, _ in tags}) == len(tags), "duplicate badge"
    for tag, group in tags:
        top, bottom, border = BADGE_GROUPS[group]
        label_width = _width(glyphs, cmap, tag, scale)
        width = max(height, label_width + 2 * BADGE_PAD)
        cooldown = cooldown_of(tag)
        left = BADGE_SIDE
        lsb, rsb = _sides(glyphs, cmap, tag, scale)
        x = left + (width - (label_width - lsb - rsb)) / 2 - lsb    # label centred in the pill by its ink
        if cooldown:                                          # the ring is the pill's left end, the label after it,
            width = RING_D + RING_GAP + label_width + BADGE_PAD   # its ink centred in the rest
            x = left + RING_D + (width - RING_D - (label_width - lsb - rsb) - RING_ENDS) / 2 - lsb
        text, letters, _ = _label(glyphs, cmap, tag, x, baseline, scale)    # letters: the label as outlines, y up
        pill = (f'<rect x="{left}" y="{-BADGE_TOP}" width="{width:.0f}" height="{height}" rx="{height / 2:.0f}" '
                f'ry="{height / 2:.0f}"')
        stroke = f'stroke="{border}" stroke-width="{BADGE_BORDER}"/>'
        grad = (f'<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/>'
                f'<stop offset="1" stop-color="{bottom}"/></linearGradient>')
        salt = []
        if cooldown:                                          # the pill, the ring, the pill's border over it
            defs, art, salt, number = ring_art(glyphs, cmap, cap_height, cooldown, group)
            number.replay(letters)
            body = (f'<defs>{grad}{defs}</defs>{pill} fill="url(#g)"/>{art}{pill} fill="none" {stroke}'
                    f'<path d="{text}" fill="#ffffff"/>')
        else:
            body = f'<defs>{grad}</defs>{pill} fill="url(#g)" {stroke}<path d="{text}" fill="#ffffff"/>'
        outline = [capsule(left, BADGE_BOTTOM, round(width), height)]
        t = BADGE_LINE
        ring = outline + [capsule(left + t, BADGE_BOTTOM + t, round(width) - 2 * t, height - 2 * t)[::-1]] + salt
        out.append(([tag], badge_glyph(tag), outline, body, round(width) + left + BADGE_SIDE, (ring, letters),
                    tag in first))
    return out


# ---- font assembly ------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))       # <repo>/MDW/Fonts/stoogedings-src/
FAMILY = "stoogedings"


def build(repo=REPO, config_path=os.path.join(HERE, "stoogedings.json"),
          out_path=os.path.join(REPO, "MDW", "Fonts", f"{FAMILY}.ttf")):
    """Build the font from repo/Types into out_path, updating the config at config_path."""
    cfg = load_config(config_path, repo)

    opts = subset.Options()
    opts.layout_features = []
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = TTFont(os.path.join(repo, "MDW/Fonts/Bree Serif Regular.ttf"))   # OFL letters for partial tokens
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=range(0x20, 0x7F))
    sub.subset(font)
    for t in ("GPOS", "GSUB", "GDEF", "kern"):
        if t in font:
            del font[t]
    cmaps = [t for t in font["cmap"].tables if t.isUnicode()]
    char_glyph = font.getBestCmap()
    order = font.getGlyphOrder()
    glyf, hmtx = font["glyf"], font["hmtx"]

    def add_glyph(name, polys, adv):
        pen = TTGlyphPen(None)
        for p in polys:
            pen.moveTo(p[0])
            for pt in p[1:]:
                pen.lineTo(pt)
            pen.closePath()
        g = pen.glyph()
        if g.numberOfContours:
            g.recalcBounds(glyf)
        glyf[name] = g
        hmtx[name] = (adv, g.xMin if g.numberOfContours else 0)
        if name not in order:
            order.append(name)

    spacer = "stk_space"
    add_glyph(spacer, [], OUTLINE - SIDE)

    svg_docs, ligatures, multiples, glows, glow_multiples, sticker_alts = [], {}, [], [], [], []
    for key, info in cfg["icons"].items():
        path = os.path.join(repo, info["file"])
        if not os.path.exists(path):
            print("missing file, codepoint kept reserved:", key, info["file"])
            continue
        art = icon_art(Image.open(path).convert("RGBA"), info.get("tint", "auto"))
        im, w_u, h_u, arr, upp, sil, tint, pad, stk = (art.im, art.w_u, art.h_u, art.arr, art.upp, art.sil, art.tint,
                                                       art.pad, art.sticker)
        top = TOP - (HEIGHT - h_u) / 2
        w_r, h_r = round(w_u), round(h_u)

        small = im.copy()
        small.thumbnail((RASTER, RASTER), Image.LANCZOS)
        buf = io.BytesIO()
        small.save(buf, "PNG", optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode()

        base = "icon_" + re.sub(r"[^a-z0-9]", "_", key)
        adv = round(w_u) + 2 * SIDE
        g_color, g_tint = base, base + ".tint"
        g_stk, g_stk_bg = base + ".sticker", base + ".stk_bg"
        g_no, g_no_over = base + ".no", base + ".no_over"

        sil_polys = trace(sil, upp, SIDE, top)
        add_glyph(g_color, sil_polys, adv)                       # glyf = fallback for renderers without SVG
        svg_docs.append((g_color, f'<image x="{SIDE}" y="{-round(top)}" width="{w_r}" height="{h_r}" '
                                  f'xlink:href="data:image/png;base64,{b64}"/>'))
        add_glyph(g_tint, trace(tint, upp, SIDE, top), adv)

        # sticker = [outline in text color, advance OUTLINE-SIDE] [color icon] [spacer OUTLINE-SIDE]
        stk_polys = trace(stk, upp, OUTLINE - pad * upp, top + pad * upp, external=True)
        add_glyph(g_stk_bg, stk_polys, OUTLINE - SIDE)
        add_glyph(g_stk, stk_polys, adv + 2 * (OUTLINE - SIDE))       # only seen if LAYERS doesn't run
        multiples.append((g_stk, [g_stk_bg, g_color, spacer]))
        # salt sticker: [outline ring + :tint icon] as one plain glyph, in place of the three above
        ring = stk & ~cv2.erode(stk.astype(np.uint8), ellipse(STICKER_LINE / upp)).astype(bool)
        ring[pad:pad + tint.shape[0], pad:pad + tint.shape[1]] |= tint
        sticker_alts.append(([g_stk_bg, g_color, spacer], g_stk + ".salt",
                             trace(ring, upp, OUTLINE - pad * upp, top + pad * upp), adv + 2 * (OUTLINE - SIDE)))

        # no = [color icon] [zero-width red sign drawn back over it]
        cx, cy = -adv + SIDE + w_u / 2, TOP - HEIGHT / 2
        r = HEIGHT / 2 + 30
        no_polys, no_svg = prohibition(cx, cy, r, 0.14 * r)
        add_glyph(g_no_over, no_polys, 0)
        svg_docs.append((g_no_over, f'<path d="{no_svg}" fill="{NO_RED}"/>'))
        add_glyph(g_no, sil_polys, adv)
        multiples.append((g_no, [g_color, g_no_over]))

        # glow = [halo, advance GLOW_SIZE-SIDE] [color icon] [glow_space]; glyphs added last
        glow, g_alpha = art.glow, art.glow_png
        g_top, g_w, g_h = top + GLOW_SIZE, art.glow_w, art.glow_h
        docs = {}
        for variant, rgb in GLOWS.items():
            buf = io.BytesIO()
            rgba = np.dstack([np.full_like(g_alpha, v) for v in rgb] + [g_alpha])
            Image.fromarray(rgba).save(buf, "PNG", optimize=True)
            docs[variant] = (f'<image x="0" y="{num(-g_top)}" width="{g_w}" height="{g_h}" '
                             f'xlink:href="data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"/>')
        # outline: the whole halo
        glows.append((base, adv, trace(glow >= 0.5 / 255, GLOW_WORK, 0, g_top, external=True), docs))

        cp = int(info["pua"], 16)
        for t in cmaps:
            t.cmap[cp] = g_color
            if key == "star":
                t.cmap[0x2605] = g_color

        names = [key] + list(info.get("aliases", []))
        for nm in names:
            for sp in sorted(spellings(nm)):
                for variant, g in ((None, g_color), ("tint", g_tint), ("sticker", g_stk), ("no", g_no),
                                   *((v, f"{base}.{v}") for v in GLOWS)):
                    text = f"[{sp}{':' + variant if variant else ''}]"
                    comps = [char_glyph.get(ord(c)) for c in text]
                    if None in comps:
                        print("unsupported character in token, skipped:", text)
                        continue
                    if text in ligatures and ligatures[text][1] != g:
                        print(f"token collision: {text} -> {ligatures[text][1]} and {g}; keeping the first")
                        continue
                    ligatures[text] = (comps, g)

    badge_ligatures, badge_alts, later = [], [], []
    for typed, name, outline, body, advance, alt, first in build_badges(os.path.join(repo, LABEL_FONT)):
        if first:
            add_glyph(name, outline, advance)
        else:                                   # the wider range and the costs (2026-11-03) go last: older ids kept
            later.append((name, outline, advance))
        svg_docs.append((name, body))
        badge_ligatures += [([char_glyph[ord(c)] for c in f"({t})"], name) for t in typed]
        badge_alts.append((name, advance, alt))

    font.setGlyphOrder(order)
    font["post"].formatType = 2.0
    font["post"].extraNames = []
    font["post"].mapping = {}

    # GSUB, registered under liga and rlig:
    #   MARK    inside a token (after "["), each character becomes a ".tk" copy; capitals become the lowercase copy,
    #           so matching is case-insensitive without changing capitals elsewhere in the font
    #   TOKENS  "[" + .tk characters + "]"  ->  icon glyph
    #   LAYERS  :sticker / :no glyphs  ->  overlapping glyph sequences
    #   CASE    "(" + a tag in any letter case + ")": each letter becomes the tag's own case, so "(action)" or "(1cd)"
    #           draws the (Action) or (1CD) badge; anything else in parentheses is left as typed
    #   BADGES  "(" + tag + ")"  ->  badge glyph
    #   GLOW_TOKENS, GLOW_LAYERS  TOKENS and LAYERS for :glow / :darkglow; last, so older lookups keep their bytes
    # and under salt (Stylistic Alternates), after those:
    #   SALT_BADGES    badge glyph  ->  outlined pill
    #   SALT_STICKERS  [outline][color icon][spacer] of a :sticker  ->  one plain glyph: thin outline + :tint icon
    tok_chars = sorted({c for text in ligatures for c in text[1:-1]})
    glow_texts = {text for text, (_, g) in ligatures.items() if g.rsplit(".", 1)[-1] in GLOWS}
    assert {c for text in glow_texts for c in text[1:-1]} <= {c for text in ligatures.keys() - glow_texts
                                                            for c in text[1:-1]}, "a glow token needs a new .tk glyph"
    tk = {}
    for c in tok_chars:
        src = char_glyph[ord(c)]
        pen = TTGlyphPen(font.getGlyphSet())
        pen.addComponent(src, (1, 0, 0, 1, 0, 0))
        tk[c] = src + ".tk"
        glyf[tk[c]] = pen.glyph()
        hmtx[tk[c]] = hmtx[src]
        if tk[c] not in order:
            order.append(tk[c])

    # glow glyphs last: older glyph ids unchanged
    glow_space = "glow_space"
    add_glyph(glow_space, [], GLOW_SIZE - SIDE)
    for base, adv, halo_polys, docs in glows:
        for variant, body in docs.items():
            g, g_bg = f"{base}.{variant}", f"{base}.{variant}_bg"
            add_glyph(g_bg, halo_polys, GLOW_SIZE - SIDE)
            svg_docs.append((g_bg, body))
            add_glyph(g, halo_polys, adv + 2 * (GLOW_SIZE - SIDE))     # only seen if LAYERS doesn't run
            glow_multiples.append((g, [g_bg, base, glow_space]))
    # salt (one-colour) badges and stickers last: older glyph ids unchanged; then the badges of 2026-11-03 and theirs
    late = {name for name, _, _ in later}

    def salt_glyph(name, advance, polys, label):
        pen = TTGlyphPen(None)
        for p in polys:
            pen.moveTo(p[0])
            for pt in p[1:]:
                pen.lineTo(pt)
            pen.closePath()
        label.replay(pen)
        g = pen.glyph()
        g.recalcBounds(glyf)
        glyf[name + ".salt"] = g
        hmtx[name + ".salt"] = (advance, g.xMin)
        if name + ".salt" not in order:
            order.append(name + ".salt")
    for name, advance, (polys, label) in badge_alts:
        if name not in late:
            salt_glyph(name, advance, polys, label)
    for _, name, polys, advance in sticker_alts:
        add_glyph(name, polys, advance)
    for name, outline, advance in later:
        add_glyph(name, outline, advance)
    for name, advance, (polys, label) in badge_alts:
        if name in late:
            salt_glyph(name, advance, polys, label)
    paren_glued = char_glyph[ord("(")] + ".glued"           # GLUED's "(": the same outline, no badge starts with it
    pen = TTGlyphPen(font.getGlyphSet())
    pen.addComponent(char_glyph[ord("(")], (1, 0, 0, 1, 0, 0))
    glyf[paren_glued] = pen.glyph()
    hmtx[paren_glued] = hmtx[char_glyph[ord("(")]]
    if paren_glued not in order:
        order.append(paren_glued)
    font.setGlyphOrder(order)

    gid = {n: i for i, n in enumerate(font.getGlyphOrder())}
    svg = table_S_V_G_()
    svg.docList = []
    for name, body in sorted(svg_docs, key=lambda d: gid[d[0]]):
        i = gid[name]
        doc = ('<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
               f'<g id="glyph{i}">{body}</g></svg>')
        svg.docList.append((doc, i, i))
    svg.compressed = False
    font["SVG "] = svg

    to_tk = [f"  sub {char_glyph[ord(c)]} by {tk[c]};" for c in tok_chars]
    to_tk += [f"  sub {char_glyph[ord(c.upper())]} by {tk[c]};" for c in tok_chars
              if c.isalpha() and ord(c.upper()) in char_glyph]
    inputs = sorted({char_glyph[ord(c)] for c in tok_chars} |
                    {char_glyph[ord(c.upper())] for c in tok_chars if c.isalpha() and ord(c.upper()) in char_glyph})
    liga, glow_liga = [], []
    for text, (comps, g) in sorted(ligatures.items(), key=lambda kv: -len(kv[0])):
        (glow_liga if text in glow_texts else liga).append(
            f"  sub {' '.join([comps[0]] + [tk[c] for c in text[1:-1]] + [comps[-1]])} by {g};")
    mult = [f"  sub {src} by {' '.join(dst)};" for src, dst in multiples]
    glow_mult = [f"  sub {src} by {' '.join(dst)};" for src, dst in glow_multiples]
    badges = [f"  sub {' '.join(comps)} by {g};" for comps, g in sorted(badge_ligatures, key=lambda x: -len(x[0]))]
    tags = badge_spellings()
    assert len({t.upper() for t in tags}) == len(tags), "badges that differ only in case"
    gn = lambda c: char_glyph[ord(c)]
    folds = {k: sorted({c for t in tags for c in t if test(c)}) for k, test in (("UP", str.isupper), ("LOW", str.islower))}
    fold = [f"lookup FOLD_{k} {{ {' '.join(f'sub {gn(c.swapcase())} by {gn(c)};' for c in cs)} }} FOLD_{k};"
            for k, cs in folds.items()]
    pos = lambda c: (f"[{gn(c)} {gn(c.swapcase())}]' lookup FOLD_{'UP' if c.isupper() else 'LOW'}" if c.isalpha()
                     else f"{gn(c)}'")
    # one rule per subtable, so each is Format 3 like MARK's (feaLib would merge them into one Format 2)
    case = "\n  subtable;\n".join(f"  sub {gn('(')} {' '.join(map(pos, t))} {gn(')')};"
                                  for t in sorted(tags, key=len, reverse=True))
    # a cost glued to a word or number before it is a multiplier, "2(x counters)": its "(" becomes a look-alike the
    # badges don't start with (the website's COST lookbehind); costs only: no timing tag holds a space
    nums = " ".join(gn(c) for c in "0123456789Xx")
    word = " ".join(sorted({gn(c) for c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._"}))
    glued = [f"  sub [{word}] {gn('(')}' lookup GLUE [{nums}] {' '.join(f'[{nums}]' for _ in range(k))}{mid} {gn(' ')};"
             for k in range(3) for mid in ("", f" {gn('.')} [{nums}]")]
    lookups = " ".join(f"lookup {n};" for n in ("MARK", "TOKENS", "LAYERS", "GLUED", "CASE", "BADGES", "GLOW_TOKENS",
                                                "GLOW_LAYERS"))
    salt_badges = [f"  sub {n} by {n}.salt;" for n, _, _ in badge_alts]
    salt_stickers = [f"  sub {' '.join(seq)} by {g};" for seq, g, _, _ in sticker_alts]
    fea = "\n".join(["languagesystem DFLT dflt;", "languagesystem latn dflt;",
                     f"@TOKIN = [{' '.join(inputs)}];",
                     f"@TK = [{' '.join(tk.values())}];",
                     "lookup TO_TK {", *to_tk, "} TO_TK;",
                     "lookup MARK {",
                     f"  sub {char_glyph[ord('[')]} @TOKIN' lookup TO_TK;",
                     "  sub @TK @TOKIN' lookup TO_TK;",
                     "} MARK;",
                     "lookup TOKENS {", *liga, "} TOKENS;",
                     "lookup LAYERS {", *mult, "} LAYERS;",
                     *fold,
                     f"lookup GLUE {{ sub {gn('(')} by {paren_glued}; }} GLUE;",
                     "lookup GLUED {", *glued, "} GLUED;",
                     "lookup CASE {", case, "} CASE;",
                     "lookup BADGES {", *badges, "} BADGES;",
                     "lookup GLOW_TOKENS {", *glow_liga, "} GLOW_TOKENS;",
                     "lookup GLOW_LAYERS {", *glow_mult, "} GLOW_LAYERS;",
                     "lookup SALT_BADGES {", *salt_badges, "} SALT_BADGES;",
                     "lookup SALT_STICKERS {", *salt_stickers, "} SALT_STICKERS;",
                     f"feature liga {{ {lookups} }} liga;",
                     f"feature rlig {{ {lookups} }} rlig;",
                     "feature salt { lookup SALT_BADGES; lookup SALT_STICKERS; } salt;"])
    addOpenTypeFeaturesFromString(font, fea)

    # names: keep the OFL copyright + license for the Bree Serif letters (and the badges' Roboto), drop trademark/vendor info
    name = font["name"]
    bree_copyright = name.getDebugName(0)
    roboto_copyright = TTFont(os.path.join(repo, LABEL_FONT))["name"].getDebugName(0)
    for nid in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 21, 22):
        name.removeNames(nameID=nid)
    family = FAMILY
    ps = re.sub(r"[^A-Za-z0-9-]", "", family.replace(" ", "-")) + "-Regular"
    entries = {
        0: f"Letters: {bree_copyright.rstrip('.')}. Badge letters: {roboto_copyright.rstrip('.')}. "
           "Icons: Impossibility Simulator card art (TTSCardMaker/Types).",
        1: family, 2: "Regular", 3: f"{ps};1.0", 4: family, 5: "Version 1.000", 6: ps,
        10: "Type [fire], [fire:tint], [fire:sticker], [fire:no], [fire:glow] or [fire:darkglow] in this font to get "
            "the icon. Case-insensitive; space, underscore and hyphen are interchangeable. "
            "Timing tags such as (1CD) and costs such as (2 points) become badges.",
    }
    for nid, val in entries.items():
        name.setName(val, nid, 3, 1, 0x409)
        name.setName(val, nid, 1, 0, 0)
    font["head"].fontRevision = 1.0
    font["OS/2"].fsType = 0
    font["OS/2"].achVendID = "STGD"

    out = out_path
    font.recalcTimestamp = False          # keep rebuilds byte-identical so git only sees real changes
    font.cfg[USE_HARFBUZZ_REPACKER] = False   # same GSUB bytes whether or not uharfbuzz is installed
    font["head"].modified = font["head"].created
    font.save(out + ".tmp")
    os.replace(out + ".tmp", out)         # atomic: Photoshop / Font Book never see a half-written file
    with open(config_path, "w") as fh:
        json.dump(cfg, fh, indent=1)
    print(f"built {out}: {os.path.getsize(out) / 1e6:.1f} MB, {len(cfg['icons'])} icons, {len(ligatures)} token spellings")
    return out


if __name__ == "__main__":
    build()
