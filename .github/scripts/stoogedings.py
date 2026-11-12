"""
The icon fonts after a Types/ push (.github/workflows/stoogedings.yml, owner 2026-11-07).

stoogedings is rebuilt from the repo's Types/ and Types/Stars/ by MDW/Fonts/stoogedings-src/build_stoogedings.py, after
the runner proves it rebuilds the font last committed byte for byte (from that commit's own files: else nothing lands).
The build is incremental (11-08): icons and badges whose inputs match its record (stoogedings-inputs.json) are copied
from the committed font, so only added or changed icons are drawn; a glyph of anything else that changes stops the run.
The glyphs whose outlines, metrics or pictures changed are found by name, and the card texts that shape to them or shape
otherwise (HarfBuzz over the card data's psd_details.json and stats.json, as the 11-07 font lane did): those still land,
and the commit names them. The website's badge font (badge_web_font.py) is rebuilt when its inputs changed since it was
last committed, and site/assets/text.js takes its numbers; it lands only with redrawn badges or a new badge_web_font.py.

    python stoogedings.py --repo <checkout> --out <dir> [--data <folder with psd_details.json, stats.json>]

Writes <out>/files/<repo path> for each file to commit, <out>/message.txt and <out>/summary.md. Exit 0 (with or without
files), 2 when the runner does not rebuild the last font byte for byte or a glyph of an unchanged icon or badge
changed (no files), 1 on an error.
"""
import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

FONT = "MDW/Fonts/stoogedings.ttf"
SRC = "MDW/Fonts/stoogedings-src"
MANIFEST = f"{SRC}/stoogedings.json"
RECORD = f"{SRC}/stoogedings-inputs.json"      # what the committed font's glyphs were drawn from
BADGE = "site/rulebook/fonts/roboto-black.woff2"
TEXT_JS = "site/assets/text.js"
INPUTS = ("Types", SRC, "MDW/Fonts/Bree Serif Regular.ttf", "MDW/Fonts/Roboto Black.ttf", FONT, BADGE, TEXT_JS)
BADGE_INPUTS = ("MDW/Fonts/Roboto Black.ttf", f"{SRC}/build_stoogedings.py", f"{SRC}/badge_web_font.py")
CONSTS = ("RING_DIGITS", "LSB", "RSB")          # text.js lines badge_web_font.py prints
CHUNK, POOL = 8, 4                               # blobs a fetch, fetches at a time (card_data's)
NAMED = 20                                       # cards named in the commit at most
NO_LAZY = {**os.environ, "GIT_NO_LAZY_FETCH": "1"}


def git(repo: str, *args: str, data: bytes = None) -> bytes:
    return subprocess.run(["git", "-C", repo, *args], input=data, capture_output=True, check=True, env=NO_LAZY).stdout


def last(repo: str, *paths: str) -> str:
    """The last commit at HEAD that changed one of paths."""
    return git(repo, "log", "-1", "--format=%H", "HEAD", "--", *paths).decode().strip()


def extract(repo: str, commit: str, dest: str) -> dict:
    """INPUTS at commit written under dest (missing blobs fetched in batches, never one by one); {path: blob}."""
    rows = [line.split("\t", 1) for line in git(repo, "ls-tree", "-r", commit, "--", *INPUTS).decode().splitlines()]
    blobs = {path: meta.split()[2] for meta, path in rows}
    have = git(repo, "cat-file", "--batch-check", data="".join(f"{b}\n" for b in blobs.values()).encode()).decode()
    missing = [line.split()[0] for line in have.splitlines() if line.endswith("missing")]
    chunks = [missing[i:i + CHUNK] for i in range(0, len(missing), CHUNK)]
    with ThreadPoolExecutor(POOL) as pool:
        list(pool.map(lambda chunk: git(repo, "-c", "fetch.negotiationAlgorithm=noop", "fetch", "-q", "--no-tags",
                                        "--no-write-fetch-head", "--filter=blob:none", "origin", *chunk), chunks))
    proc = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            env=NO_LAZY)
    proc.stdin.write("".join(f"{b}\n" for b in blobs.values()).encode())
    proc.stdin.close()
    for path in blobs:
        size = int(proc.stdout.readline().split()[2])
        data = proc.stdout.read(size)
        proc.stdout.read(1)
        os.makedirs(os.path.dirname(os.path.join(dest, path)), exist_ok=True)
        with open(os.path.join(dest, path), "wb") as fh:
            fh.write(data)
    proc.wait()
    return blobs


def read(path: str) -> bytes:
    with open(path, "rb") as fh:
        return fh.read()


def build(tree: str, out: str) -> bytes:
    """tree's own build_stoogedings.build into out (a process of its own: each commit's script); out's bytes. Its
    manifest is updated in place under tree."""
    code = ("import sys; sys.path.insert(0, sys.argv[1] + '/" + SRC + "'); import build_stoogedings as b; "
            "b.build(sys.argv[1], sys.argv[1] + '/" + MANIFEST + "', sys.argv[2])")
    subprocess.run([sys.executable, "-c", code, tree, out], check=True)
    return read(out)


def glyphs(font) -> dict:
    """{glyph name: (advance and bearing, outline bytes, picture)}: what a glyph draws, by name (glyph ids move when an
    icon is added); an SVG picture's own glyph ids left out."""
    order, glyf, hmtx = font.getGlyphOrder(), font["glyf"], font["hmtx"].metrics
    pictures = {}
    for doc in font["SVG "].docList:
        data, lo, hi = doc.data, doc.startGlyphID, doc.endGlyphID
        for gid in range(lo, hi + 1):
            pictures[gid] = re.sub(r'id="glyph\d+"', 'id="glyph"', data)
    return {name: (hmtx[name], glyf[name].compile(glyf), pictures.get(gid)) for gid, name in enumerate(order)}


def texts(data: str) -> dict:
    """{text: {card name}} of the cards' texts: psd_details' visible text layers (and their lines), stats' names,
    abilities and notes; {} without the data."""
    found = defaultdict(set)
    if not data:
        return found
    details = json.loads(read(os.path.join(data, "psd_details.json")))
    for record in (details.get("cards") or {}).values():
        name = os.path.splitext(os.path.basename(record.get("path") or ""))[0].replace("_", " ")
        for layer in record.get("text") or []:
            if layer.get("visible") and layer.get("text"):
                for piece in [layer["text"]] + [x for x in re.split(r"[\r\n\x03]", layer["text"]) if x]:
                    found[piece].add(name)
    stats = json.loads(read(os.path.join(data, "stats.json")))
    for key, card in (stats.get("cards") or {}).items():
        for field in ("name", "display_name", "ability", "note"):
            value = card.get(field)
            if isinstance(value, str) and value.strip():
                for piece in [value] + [x for x in value.split("\n") if x]:
                    found[piece].add(card.get("name") or key)
    return found


def shaped(path: str):
    """A text's HarfBuzz shape in the font at path, by glyph name: [(name, x advance, y advance, x offset, y offset)],
    with liga and rlig (badges, tokens) as Photoshop sets them."""
    import uharfbuzz as hb
    from fontTools.ttLib import TTFont
    font = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
    order = TTFont(path, lazy=True).getGlyphOrder()

    def shape(text: str) -> tuple:
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(font, buf, {})
        return tuple((order[i.codepoint], p.x_advance, p.y_advance, p.x_offset, p.y_offset)
                     for i, p in zip(buf.glyph_infos, buf.glyph_positions))
    return shape


def record(tree: str) -> dict:
    return json.loads(read(os.path.join(tree, RECORD)))


def redrawn(was: dict, now: dict) -> tuple:
    """(icons drawn anew, badges drawn anew, letters changed) by the build that turned record was into now."""
    part = lambda r, k: (r.get("recipe") or {}).get(k)
    icons = sorted(now.get("icons", {}) if part(was, "icons") != part(now, "icons") else
                   (k for k, v in now.get("icons", {}).items() if (was.get("icons") or {}).get(k) != v))
    return (icons, part(was, "badges") != part(now, "badges") or was.get("labels") != now.get("labels"),
            was.get("letters") != now.get("letters"))


def mine(name: str, icons: list, badges: bool, letters: bool) -> bool:
    """Whether glyph name may change: one of icons' (build_stoogedings icon_glyphs), a badge's, a letter's."""
    bases = {"icon_" + re.sub(r"[^a-z0-9]", "_", k) for k in icons}
    return (name.split(".", 1)[0] in bases or badges and name.startswith("badge_")
            or letters and not name.startswith(("icon_", "badge_")))


def compare(old: str, new: str, data: str) -> tuple:
    """(glyphs changed, added or gone by name, {glyph or "shape": cards whose texts use it or shape otherwise})."""
    from fontTools.ttLib import TTFont
    a, b = glyphs(TTFont(old)), glyphs(TTFont(new))
    changed = sorted(name for name in set(a) | set(b) if a.get(name) != b.get(name))
    before, after = shaped(old), shaped(new)
    used = defaultdict(set)
    for text, cards in texts(data).items():
        sa, sb = before(text), after(text)
        hit = [g[0] for g in sb if g[0] in changed] + [g[0] for g in sa if g[0] in changed]
        for name in dict.fromkeys(hit):
            used[name] |= cards
        if sa != sb and not hit:
            used["(shaped otherwise)"] |= cards
    return changed, dict(used)


def badge(head: str, tree: str, repo: str) -> dict:
    """The badge font when its inputs moved since it was last committed: {path: bytes} of the woff2 (when its tables
    changed) and text.js (when its constants print otherwise), {} when it rebuilds the same; None otherwise."""
    from fontTools.ttLib import TTFont
    if not git(repo, "diff", "--name-only", last(repo, BADGE), head, "--", *BADGE_INPUTS).strip():
        return None
    was = read(os.path.join(tree, BADGE))
    printed = subprocess.run([sys.executable, os.path.join(tree, SRC, "badge_web_font.py")], cwd=os.path.join(tree, SRC),
                             capture_output=True, text=True, check=True).stdout
    made = read(os.path.join(tree, BADGE))
    old, new = TTFont(io.BytesIO(was)), TTFont(io.BytesIO(made))
    out = {}
    if sorted(old.keys()) != sorted(new.keys()) or any(old.getTableData(t) != new.getTableData(t) for t in old.keys()
                                                       if t != "GlyphOrder"):
        out[BADGE] = made
    was_js = read(os.path.join(tree, TEXT_JS))
    script = was_js.decode("utf-8")
    for line in printed.splitlines():
        found = re.match(r"const (\w+) = ", line)
        if found and found.group(1) in CONSTS:
            script = re.sub(rf"(?m)^const {found.group(1)} = .*;$", lambda _: line.rstrip(), script, count=1)
    if script.encode("utf-8") != was_js:
        out[TEXT_JS] = script.encode("utf-8")
    return out


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python stoogedings.py", description="Rebuild the icon fonts after a Types/ push")
    parser.add_argument("--repo", required=True, help="the card repo's checkout (blobless is enough)")
    parser.add_argument("--out", required=True, help="files/, message.txt, summary.md")
    parser.add_argument("--data", default="", help="a folder with the card data's psd_details.json and stats.json")
    args = parser.parse_args(argv)
    repo, out = os.path.abspath(args.repo), os.path.abspath(args.out)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(os.path.join(out, "files"))
    head = git(repo, "rev-parse", "HEAD").decode().strip()
    font_commit = last(repo, FONT, RECORD)
    lines = [f"## Stoogedings\n\nMain `{head[:8]}`; the font last committed in `{font_commit[:8]}`.\n"]
    # the runner rebuilds the last font byte for byte, from that commit's own files
    base = os.path.join(out, "base")
    extract(repo, font_commit, base)
    manifest, kept = read(os.path.join(base, MANIFEST)), record(base)
    if build(base, os.path.join(out, "base.ttf")) != read(os.path.join(base, FONT)) \
            or read(os.path.join(base, MANIFEST)) != manifest or record(base) != kept:
        lines.append(f"This runner does not rebuild `{font_commit[:8]}`'s font byte for byte: nothing is committed.")
        write(out, lines, "")
        return 2
    now = os.path.join(out, "head")
    blobs = extract(repo, head, now)
    files = {}
    was_font, was_manifest, was = read(os.path.join(now, FONT)), read(os.path.join(now, MANIFEST)), record(now)
    made = build(now, os.path.join(out, "head.ttf"))
    icons, badges, letters = redrawn(was, record(now))
    message = ""
    if made != was_font or read(os.path.join(now, MANIFEST)) != was_manifest or record(now) != was:
        files.update({FONT: made, MANIFEST: read(os.path.join(now, MANIFEST)), RECORD: read(os.path.join(now, RECORD))})
        with open(os.path.join(out, "old.ttf"), "wb") as fh:
            fh.write(was_font)
        changed, used = compare(os.path.join(out, "old.ttf"), os.path.join(out, "head.ttf"), args.data)
        from fontTools.ttLib import TTFont
        both = set(TTFont(os.path.join(out, "old.ttf"), lazy=True).getGlyphOrder()) \
            & set(TTFont(os.path.join(out, "head.ttf"), lazy=True).getGlyphOrder())
        stray = [name for name in changed if name in both and not mine(name, icons, badges, letters)]
        if stray:
            lines.append(f"Glyphs of unchanged icons or badges changed ({', '.join(stray[:20])}): nothing is committed.")
            write(out, lines, "")
            return 2
        paths = git(repo, "diff", "--name-only", font_commit, head, "--", "Types").decode().split()
        message = "Font: stoogedings rebuilt" + (f" for {', '.join(os.path.basename(p) for p in paths[:5])}"
                                                + (f" and {len(paths) - 5} more" if len(paths) > 5 else "") if paths else "")
        body = [f"Drawn: {', '.join(icons) or 'no icon'}" + (", every badge" if badges else "") + " (the rest copied)",
                f"Glyphs changed: {len(changed)}" + (f" ({', '.join(changed[:30])}{', ...' if len(changed) > 30 else ''})"
                                                     if changed else "")]
        for name, cards in sorted(used.items()):
            shown = sorted(cards)
            body.append(f"Changes glyphs cards use: {name} ({', '.join(shown[:NAMED])}"
                        + (f", +{len(shown) - NAMED} more" if len(shown) > NAMED else "") + ")")
        message += "\n\n" + "\n".join(body)
        lines += [f"- {line}" for line in body]
    badge_files = badge(head, now, repo)
    if badge_files == {}:
        lines.append("- the badge font rebuilds the same")
    if badge_files and not badges and not git(repo, "diff", "--name-only", last(repo, BADGE), head, "--",
                                               f"{SRC}/badge_web_font.py").strip():
        lines.append("- the badge font rebuilds otherwise, but no badge was redrawn and badge_web_font.py is as it was: "
                     "not committed (bump build_stoogedings RECIPE[\"badges\"] after changing the badges)")
        badge_files = {}
    if badge_files:
        files.update(badge_files)
        message = message or "Font: badge font rebuilt"
        message += "\n\nBadge font rebuilt: " + ", ".join(sorted(badge_files))
        lines.append("- the badge font rebuilt (its inputs moved)")
    if not files:
        lines.append("The rebuild equals main's fonts: nothing to commit.")
    for path, data in files.items():
        os.makedirs(os.path.dirname(os.path.join(out, "files", path)), exist_ok=True)
        with open(os.path.join(out, "files", path), "wb") as fh:
            fh.write(data)
    lines.append(f"\nFiles: {', '.join(sorted(files)) or 'none'} (inputs: {len(blobs)} files).")
    write(out, lines, message)
    shutil.rmtree(base, ignore_errors=True)
    shutil.rmtree(now, ignore_errors=True)
    return 0


def write(out: str, lines: list, message: str) -> None:
    with open(os.path.join(out, "summary.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    with open(os.path.join(out, "message.txt"), "w", encoding="utf-8") as fh:
        fh.write(message + ("\n" if message else ""))
    print("\n".join(lines))


if __name__ == "__main__":
    raise SystemExit(main())
