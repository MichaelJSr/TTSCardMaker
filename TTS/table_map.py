"""The TTS table from above for the rulebook's Table chapter, drawn from the save (owner 2026-11-04): each holder's own
picture where it lies and turned as it lies, the counters in their colours with their values, the bags, the hand zones
in their seats' colours, and the chapter's areas outlined and numbered (the chapter lists them under the picture).
Run it again after moving things on the table (Pillow only):

    python3 TTS/table_map.py [save] [out.webp]      (default: TTS/Impossibility Simulator.json -> site/rulebook/img/table-map.webp)
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(REPO, "MDW", "Assets")
FONT = os.path.join(REPO, "MDW", "Fonts", "Consolas Bold.ttf")
X0, X1, Z0, Z1 = -104, 139, -38.5, 38.5     # the table top (the Flex Table's edges) and the side board to its right
SIDE = 104.5                                # past the table's right edge: the side board (simple decks, copies, bags)
S = 9                                       # px per table unit
SEATS = {"Red": (218, 26, 24), "Orange": (244, 100, 29), "Green": (49, 179, 43), "Blue": (31, 135, 255),
         "Purple": (160, 32, 240), "Pink": (245, 112, 206)}
INK, PANEL = (16, 33, 117), (207, 207, 255)
PAPER = (255, 255, 255)                     # the rulebook's page under it (style.css --rb-paper, the PDF's sheets)
# the chapter's areas, in its pictures' order: nicknames (5 and 6 also by kind and place, below)
AREAS = {1: ("Creatures", "Items", "Field Cards", "N.M.E Items", "Creatures Developer Version", "Baseline Creatures"),
         2: ("Global Turn", "SP", "Star Points", "Bricks", "Points", "Item Shop", "Field Shop", "N.M.E. Shop"),
         3: ("Creature Holder", "Item Holder"),
         4: ("All Status Effects", "Graveyard", "Discard Pile", "Field Card Holder"),
         5: ("Auxiliary Items", "Minions", "Minion Holder", "Active Holder"),
         6: ()}
BAGS = ("Infinite_Bag", "Quarter", "Die_6_Rounded")
_pics = {}


def picture(url):
    """A holder's picture from MDW/Assets (RGBA), or None."""
    name = url.split("/")[-1]
    if name not in _pics:
        _pics[name] = None
        for sub in ("Holders", "Markers", ""):
            path = os.path.join(ASSETS, sub, name)
            if os.path.exists(path):
                _pics[name] = Image.open(path).convert("RGBA")
                break
    return _pics[name]


def px(x, z):
    return (x - X0) * S, (Z1 - z) * S


def rgb(c):
    return tuple(max(0, min(255, round(c.get(k, 0) * 255))) for k in "rgb")


def paste_turned(canvas, im, cx, cy, deg):
    """im centred at (cx, cy), turned deg clockwise (the save's rotY, as TTS shows a picture from above)."""
    turned = im.rotate(-deg, resample=Image.BICUBIC, expand=True)
    canvas.alpha_composite(turned, (round(cx - turned.width / 2), round(cy - turned.height / 2)))


def dashed_box(draw, box, colour, width=4, dash=16, gap=10):
    x0, y0, x1, y1 = box
    for a, b, c, d in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
        length = math.hypot(c - a, d - b)
        n = int(length // (dash + gap)) + 1
        for k in range(n):
            t0, t1 = k * (dash + gap) / length, min(1, (k * (dash + gap) + dash) / length)
            draw.line([(a + (c - a) * t0, b + (d - b) * t0), (a + (c - a) * t1, b + (d - b) * t1)], fill=colour, width=width)


def draw_map(save):
    W, H = round((X1 - X0) * S), round((Z1 - Z0) * S)
    felt = Image.open(os.path.join(ASSETS, "Table_Felt.jpeg")).convert("RGBA")
    scale = max(W / felt.width, H / felt.height)
    felt = felt.resize((math.ceil(felt.width * scale), math.ceil(felt.height * scale)), Image.LANCZOS)
    canvas = felt.crop(((felt.width - W) // 2, (felt.height - H) // 2, (felt.width - W) // 2 + W, (felt.height - H) // 2 + H))
    draw = ImageDraw.Draw(canvas, "RGBA")
    font = lambda size: ImageFont.truetype(FONT, size)
    sx, _ = px(SIDE, 0)
    draw.rounded_rectangle([sx, (Z1 - 30) * S, W - 10, (Z1 + 30) * S], radius=18, fill=(60, 16, 21, 255), outline=(0, 0, 0, 100), width=4)
    objs = [o for o in save["ObjectStates"]
            if X0 <= o["Transform"]["posX"] <= X1 and Z0 <= o["Transform"]["posZ"] <= Z1
            and (o["Transform"]["posY"] > 0.8 or o["Transform"]["posX"] > SIDE) and o["Name"] not in ("Custom_Assetbundle", "Custom_Model")]
    boxes = {n: [] for n in AREAS}
    area_of = {nick: n for n, nicks in AREAS.items() for nick in nicks}

    def note(o, pts):
        nick = o.get("Nickname") or ""
        n = (6 if o["Transform"]["posX"] > SIDE else 5 if o["Name"] in BAGS
             else None if o["Name"] == "Counter" and nick in ("HP", "DEF", "ATK", "SPD") else area_of.get(nick))
        if n:
            boxes[n] += pts

    zones = Image.new("RGBA", canvas.size, (0, 0, 0, 0))   # the hand zones, under everything, on a layer of their own
    zd = ImageDraw.Draw(zones)
    for o in objs:
        t = o["Transform"]
        if o["Name"] != "HandTrigger" or t["scaleX"] < 10:
            continue
        c = SEATS.get(o.get("FogColor"), (128, 128, 128))
        x0, y0 = px(t["posX"] - t["scaleX"] / 2, t["posZ"] + t["scaleZ"] / 2)
        x1, y1 = px(t["posX"] + t["scaleX"] / 2, t["posZ"] - t["scaleZ"] / 2)
        zd.rounded_rectangle([x0 + 3, y0, x1 - 3, y1], radius=12, fill=c + (110,), outline=c + (255,), width=4)
        zd.text(((x0 + x1) / 2, (y0 + y1) / 2), f"{o.get('FogColor', '')} hand", font=font(30), fill=(255, 255, 255, 255), anchor="mm",
                stroke_width=2, stroke_fill=(0, 0, 0, 160))
    canvas.alpha_composite(zones)                      # see-through drawn over the felt, the picture itself opaque
    draw = ImageDraw.Draw(canvas, "RGBA")
    for o in sorted(objs, key=lambda o: o["Transform"]["posY"]):    # tiles and tokens: their pictures where they lie
        if o["Name"] not in ("Custom_Tile", "Custom_Token"):
            continue
        t, ci = o["Transform"], o.get("CustomImage") or {}
        flipped = abs(((t["rotZ"] + 180) % 360) - 180) > 90
        im = picture((ci.get("ImageSecondaryURL") if flipped and ci.get("ImageSecondaryURL") else ci.get("ImageURL")) or "")
        aspect = im.width / im.height if im else 1.0
        w, h = (4.187 * t["scaleX"], 3.347 * t["scaleZ"]) if o["Name"] == "Custom_Token" else (2 * aspect * t["scaleX"], 2 * t["scaleZ"])
        r = math.radians(t["rotY"])
        note(o, [(t["posX"] + lx * math.cos(r) + lz * math.sin(r), t["posZ"] - lx * math.sin(r) + lz * math.cos(r))
                 for lx, lz in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))])
        cx, cy = px(t["posX"], t["posZ"])
        tile = (im.resize((max(1, round(w * S)), max(1, round(h * S))), Image.LANCZOS) if im
                else Image.new("RGBA", (max(1, round(w * S)), max(1, round(h * S))), PANEL + (255,)))
        paste_turned(canvas, tile, cx, cy, t["rotY"] + 180)       # a picture's top faces -z at rotY 0 (the snap points say so)
    draw = ImageDraw.Draw(canvas, "RGBA")
    for o in objs:                                     # counters, bags, the coin and the die, the rulebooks
        t, cx, cy = o["Transform"], *px(o["Transform"]["posX"], o["Transform"]["posZ"])
        if o["Name"] == "Counter":
            s = t["scaleX"]
            w, h = round(1.9 * s * S), round(0.95 * s * S)
            tile = Image.new("RGBA", (w, h))
            d = ImageDraw.Draw(tile)
            d.rounded_rectangle([0, 0, w - 1, h - 1], radius=max(2, h // 5), fill=rgb(o.get("ColorDiffuse") or {}) + (255,), outline=(17, 17, 17, 255), width=2)
            d.rounded_rectangle([w * .2, h * .18, w * .8, h * .82], radius=3, fill=(17, 17, 17, 255))
            d.text((w / 2, h / 2), str((o.get("Counter") or {}).get("value", 0)), font=font(max(8, round(h * .55))), fill=(125, 255, 138, 255), anchor="mm")
            paste_turned(canvas, tile, cx, cy, t["rotY"] + 180)
            note(o, [(t["posX"], t["posZ"])])
        elif o["Name"] in BAGS + ("go_game_bowl_black", "go_game_bowl_white"):
            rad = (0.85 if o["Name"] == "Infinite_Bag" else t["scaleX"]) * S
            c = rgb(o.get("ColorDiffuse") or {}) + (255,)
            if o["Name"] == "Die_6_Rounded":
                draw.rounded_rectangle([cx - rad, cy - rad, cx + rad, cy + rad], radius=rad * .3, fill=c, outline=(17, 17, 17, 255), width=2)
            else:
                draw.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=c, outline=(17, 17, 17, 255), width=2)
            note(o, [(t["posX"], t["posZ"])])
        elif o["Name"] == "Custom_Model_Bag":
            draw.rounded_rectangle([cx - 24, cy - 32, cx + 24, cy + 32], radius=6, fill=(122, 74, 42, 255), outline=(17, 17, 17, 255), width=2)
    for n, pts in boxes.items():                       # the areas: dashed outlines, numbered
        if not pts:
            continue
        xs, zs = [p[0] for p in pts], [p[1] for p in pts]
        x0, y0 = px(min(xs) - 1.2, max(zs) + 1.2)
        x1, y1 = px(max(xs) + 1.2, min(zs) - 1.2)
        dashed_box(draw, (x0, y0, x1, y1), (255, 255, 255, 220))
        draw.ellipse([x0 - 30, y0 - 30, x0 + 30, y0 + 30], fill=PANEL + (255,), outline=INK + (255,), width=4)
        draw.text((x0, y0 + 1), str(n), font=font(38), fill=INK + (255,), anchor="mm")
    canvas = Image.alpha_composite(Image.new("RGBA", canvas.size, (90, 39, 44, 255)), canvas)   # opaque (Pillow's draws leave alpha)
    mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=36, fill=255)
    out = Image.new("RGB", canvas.size, PAPER)    # rounded on the page's white, opaque: the PDF takes it as a JPEG
    out.paste(canvas.convert("RGB"), (0, 0), mask)
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    save_path = args[0] if args else os.path.join(REPO, "TTS", "Impossibility Simulator.json")
    out_path = args[1] if len(args) > 1 else os.path.join(REPO, "site", "rulebook", "img", "table-map.webp")
    with open(save_path, encoding="utf-8") as fh:
        image = draw_map(json.load(fh))
    image.save(out_path, "WEBP", quality=86, method=6)
    print(f"{out_path}: {image.width}x{image.height}, {os.path.getsize(out_path) / 1e3:.0f} KB")
