"""The website's badge letters (owner 2026-11-04): MDW/Fonts/Roboto Black.ttf subset to the characters badges set, no
layout features, its hinting kept (Windows grid-fits web fonts by their own instructions only), with
build_stoogedings.LABEL_METRICS (the 1, / and X re-spaced, the word space) as the icon font sets them, and vertical
metrics that centre its capitals in a 1.45em line (VMETRICS: every engine, no @font-face overrides) ->
site/rulebook/fonts/roboto-black.woff2 (its overlapping contours kept: browsers fill a glyph whole); and on stdout
site/assets/text.js RING_DIGITS (the figures and X, as set, their overlaps removed as the icon font's: _merged) and
LSB, RSB (the side-bearings of the characters badge labels start and end with, as set).

    .venv/bin/python badge_web_font.py          (fontTools and brotli: requirements.txt)
"""
import json
import os

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

from build_stoogedings import LABEL_FONT, LABEL_METRICS, REPO, _merged, _svg_d, num

OUT = os.path.join(REPO, "site/rulebook/fonts/roboto-black.woff2")
CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz +-./−"
FIRSTS, LASTS = "0123456789ABEFOWXY−", "DFGSTUlnrs"   # badge labels' first and last characters (timing tags, own costs)
VMETRICS = (1960, 440)     # ascent, descent: its capitals centred in style.css .badge's line (measured, Chrome, 64 px)


def centre(font):
    """VMETRICS into hhea, OS/2 typo (used: USE_TYPO_METRICS) and win, no line gap."""
    up, down = VMETRICS
    hhea, os2 = font["hhea"], font["OS/2"]
    hhea.ascent, hhea.descent, hhea.lineGap = up, -down, 0
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = up, -down, 0
    os2.usWinAscent, os2.usWinDescent = up, down
    os2.fsSelection |= 1 << 7


def respace(font):
    """LABEL_METRICS into the font's glyf and hmtx: an outline moved to its side-bearings, or an advance."""
    glyf, hmtx, cmap = font["glyf"], font["hmtx"], font.getBestCmap()
    for ch, m in LABEL_METRICS.items():
        name = cmap[ord(ch)]
        g = glyf[name]
        if not isinstance(m, tuple):
            hmtx[name] = (m, hmtx[name][1])
            continue
        assert not g.isComposite(), name
        g.recalcBounds(glyf)
        dx = m[0] - g.xMin
        g.coordinates.translate((dx, 0))
        g.recalcBounds(glyf)
        hmtx[name] = (m[0] + g.xMax - g.xMin + m[1], g.xMin)


def ring_digits(font):
    """{char: [advance, ink x0, y0, x1, y1, outline]}: font units, y down from the baseline."""
    gs, cmap, out = font.getGlyphSet(), font.getBestCmap(), {}
    for ch in "0123456789X":
        name = cmap[ord(ch)]
        b = BoundsPen(gs)
        gs[name].draw(b)
        x0, y0, x1, y1 = b.bounds
        out[ch] = [font["hmtx"][name][0], *(int(v) if v == int(v) else v for v in (float(num(u)) for u in (x0, -y1, x1, -y0))),
                   _svg_d(_merged(gs, [(gs[name], (1, 0, 0, 1, 0, 0))]))]
    return out


def sides(font):
    """({char: left side-bearing} of FIRSTS, {char: right side-bearing} of LASTS): font units, as set."""
    gs, cmap, left, right = font.getGlyphSet(), font.getBestCmap(), {}, {}
    for chars, out in ((FIRSTS, left), (LASTS, right)):
        for ch in chars:
            name = cmap[ord(ch)]
            b = BoundsPen(gs)
            gs[name].draw(b)
            x0, _, x1, _ = b.bounds
            v = float(num(x0 if out is left else font["hmtx"][name][0] - x1))
            out[ch] = int(v) if v == int(v) else v
    return left, right


def main():
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = []
    options.hinting = True
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
    options.notdef_outline = True
    font = TTFont(os.path.join(REPO, LABEL_FONT))
    sub = subset.Subsetter(options)
    sub.populate(text=CHARS)
    sub.subset(font)
    for table in ("GPOS", "GSUB", "GDEF"):
        if table in font:
            del font[table]
    respace(font)
    centre(font)
    font.flavor = "woff2"
    font.recalcTimestamp = False                 # the source's head.modified: the same bytes every run
    font.save(OUT)
    print(f"// {os.path.relpath(OUT, REPO)}: {os.path.getsize(OUT)} bytes")
    print(f"const RING_DIGITS = {json.dumps(ring_digits(font), separators=(',', ':'))};")
    left, right = sides(font)
    print(f"const LSB = {json.dumps(left, separators=(',', ':'))};")
    print(f"const RSB = {json.dumps(right, separators=(',', ':'))};")


if __name__ == "__main__":
    main()
