#!/usr/bin/env python3
"""Structure audit of a TTS save: shape, cards, decks, CustomDeck keys, GUIDs, transforms, bags, zones.

python3 structure.py [save.json] [-v]   exit 1 on a defect (warnings only print)
"""
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import save_arg  # noqa: E402

SAVE_KEYS = {"SaveName", "EpochTime", "Date", "VersionNumber", "GameMode", "GameType", "GameComplexity",
             "PlayingTime", "PlayerCounts", "Tags", "Gravity", "PlayArea", "Table", "TableURL", "Sky", "SkyURL",
             "Note", "Rules", "TabStates", "Grid", "Lighting", "Hands", "ComponentTags", "Turns", "CameraStates",
             "DecalPallet", "LuaScript", "LuaScriptState", "XmlUI", "CustomUIAssets", "SnapPoints", "VectorLines",
             "MusicPlayer", "ObjectStates"}
SAVE_REQUIRED = {"SaveName", "VersionNumber", "ObjectStates", "LuaScript", "LuaScriptState", "XmlUI"}
OBJ_KEYS = {"GUID", "Name", "Transform", "Nickname", "Description", "GMNotes", "AltLookAngle", "ColorDiffuse",
            "LayoutGroupSortIndex", "Value", "Locked", "Grid", "Snap", "IgnoreFoW", "MeasureMovement",
            "DragSelectable", "Autoraise", "Sticky", "Tooltip", "GridProjection", "HideWhenFaceDown", "Hands",
            "CardID", "SidewaysCard", "DeckIDs", "CustomDeck", "CustomImage", "CustomAssetbundle", "CustomMesh",
            "MaterialIndex", "MeshIndex", "Number", "Counter", "Bag", "FogColor", "FogHidePointers",
            "FogReverseHiding", "FogSeethrough", "LuaScript", "LuaScriptState", "XmlUI", "ContainedObjects",
            "PhysicsMaterial", "Rigidbody", "JointFixed", "JointHinge", "JointSpring", "RotationValues",
            "AttachedSnapPoints", "AttachedVectorLines", "States", "ChildObjects", "AttachedDecals", "Tags",
            "ColorDiffuseSecondary", "Text", "Tablet", "Clock", "Calculator", "CustomPDF", "CustomUIAssets",
            "HideWhenFaceDown", "LayoutGroupSortIndex", "AltSound", "DeckFaceURL"}
OBJ_REQUIRED = ("GUID", "Name", "Transform")
TRANSFORM = ("posX", "posY", "posZ", "rotX", "rotY", "rotZ", "scaleX", "scaleY", "scaleZ")
CD_KEYS = {"FaceURL", "BackURL", "NumWidth", "NumHeight", "BackIsHidden", "UniqueBack", "Type"}
SEATS = {"White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink"}
CARDS = ("Card", "CardCustom")
BAGS = ("Bag", "Infinite_Bag", "Custom_Model_Bag")
GUID = re.compile(r"[0-9a-f]{6}\Z")
LARGE = "/Auxiliary/Creatures/"
MIN_Y = -2.0          # below this an object fell through (Table_None: objects rest on tiles/boards)

fails, warns, notes = [], [], []


def fail(msg):
    fails.append(msg)


def warn(msg):
    warns.append(msg)


def walk(objs, parents=()):
    for o in objs or []:
        yield o, parents
        yield from walk(o.get("ContainedObjects"), parents + (o,))
        for s in (o.get("States") or {}).values():
            yield from walk([s], parents + (o,))
        yield from walk(o.get("ChildObjects"), parents + (o,))


def label(o):
    return f"{o.get('Name')} {o.get('GUID')} {o.get('Nickname', '')!r}"


def where(parents):
    return "/".join(f"{p.get('Name')}:{p.get('GUID')}" for p in parents) or "table"


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def own_entry(card):
    cd = card.get("CustomDeck") or {}
    return cd.get(str(card.get("CardID", 0) // 100)) if isinstance(card.get("CardID"), int) else None


def main(path):
    raw = open(path, "rb").read()
    if raw.startswith(b"\xef\xbb\xbf"):
        fail("file starts with a UTF-8 BOM")
    save = json.loads(raw.decode("utf-8"), parse_constant=lambda c: fail(f"non-JSON constant {c}"))

    # top level
    if not isinstance(save, dict):
        fail("top level is not an object")
        return
    for k in SAVE_REQUIRED - set(save):
        fail(f"top-level key missing: {k}")
    for k in set(save) - SAVE_KEYS:
        warn(f"unknown top-level key: {k}")
    if not isinstance(save.get("ObjectStates"), list):
        fail("ObjectStates is not a list")
        return
    for k in ("LuaScript", "LuaScriptState", "XmlUI", "SaveName", "VersionNumber"):
        if k in save and not isinstance(save[k], str):
            fail(f"top-level {k} is not a string")

    every = list(walk(save["ObjectStates"]))
    below = []
    guid_where = defaultdict(list)
    for o, parents in every:
        if not isinstance(o, dict):
            fail(f"non-object in {where(parents)}")
            continue
        for k in OBJ_REQUIRED:
            if k not in o:
                fail(f"{label(o)} in {where(parents)}: missing {k}")
        for k in set(o) - OBJ_KEYS:
            warn(f"{label(o)}: unknown key {k}")
        g = o.get("GUID")
        if not isinstance(g, str) or not GUID.match(g):
            fail(f"{label(o)} in {where(parents)}: malformed GUID {g!r}")
        guid_where[g].append((o, parents))
        t = o.get("Transform") or {}
        bad = [k for k in TRANSFORM if not finite(t.get(k))]
        if bad:
            fail(f"{label(o)} in {where(parents)}: Transform {bad} missing or not finite")
        else:
            sc = (t["scaleX"], t["scaleY"], t["scaleZ"])
            if min(sc) <= 0 or max(sc) > 100:
                fail(f"{label(o)}: scale {sc} out of range")
            if not parents and t["posY"] < MIN_Y:
                if o.get("Locked"):
                    below.append(o.get("Name"))
                else:
                    fail(f"{label(o)}: below the table (posY {t['posY']}), not locked")
            if max(abs(t["posX"]), abs(t["posZ"])) > 500 or abs(t["posY"]) > 500:
                fail(f"{label(o)}: position far off ({t['posX']}, {t['posY']}, {t['posZ']})")
        for k in ("ColorDiffuse",):
            c = o.get(k)
            if c is not None and not all(finite(c.get(x)) for x in ("r", "g", "b")):
                fail(f"{label(o)}: {k} not finite")
        for k in ("Nickname", "Description", "GMNotes", "LuaScript", "LuaScriptState", "XmlUI"):
            if k in o and not isinstance(o[k], str):
                fail(f"{label(o)}: {k} is not a string")
        if "CardID" in o and o.get("Name") not in CARDS:
            fail(f"{label(o)}: CardID on a non-card")

    if below:
        notes.append(f"locked objects below y {MIN_Y} (table scenery): {dict(Counter(below))}")

    # GUIDs
    top = Counter(o.get("GUID") for o in save["ObjectStates"])
    for g, n in top.items():
        if n > 1:
            fail(f"top-level GUID {g} used {n} times")
    dup_in = Counter()
    for o, parents in every:
        kids = Counter(c.get("GUID") for c in o.get("ContainedObjects") or [])
        extra = sum(n - 1 for n in kids.values() if n > 1)
        if extra:
            dup_in[f"{label(o)}"] = extra
    shared = {g: v for g, v in guid_where.items() if len(v) > 1}
    top_shared = [g for g in shared if any(not p for _, p in shared[g])]
    notes.append(f"GUIDs: {len(guid_where)} distinct over {len(every)} objects; {len(shared)} shared by "
                 f"several objects ({sum(len(v) for v in shared.values())} objects); "
                 f"{len(top_shared)} of those also used by a top-level object")
    for g in top_shared:
        others = [where(p) + " > " + o.get("Name") for o, p in shared[g] if p]
        warn(f"top-level GUID {g} ({label(next(o for o, p in shared[g] if not p))}) is also inside: {others[:4]}")
    if dup_in:
        notes.append(f"containers holding repeated GUIDs: {len(dup_in)}; repeats {sum(dup_in.values())} "
                     f"(largest: {dup_in.most_common(3)})")

    # cards
    images = defaultdict(set)          # CustomDeck key -> {(Face, Back, W, H)}
    image_users = defaultdict(set)
    for o, parents in every:
        if o.get("Name") not in CARDS:
            continue
        cid = o.get("CardID")
        if not isinstance(cid, int) or isinstance(cid, bool) or cid < 100:
            fail(f"{label(o)} in {where(parents)}: bad CardID {cid!r}")
            continue
        cd = o.get("CustomDeck")
        if not isinstance(cd, dict) or not cd:
            fail(f"{label(o)} in {where(parents)}: no CustomDeck")
            continue
        key = str(cid // 100)
        if key not in cd:
            fail(f"{label(o)} in {where(parents)}: CardID {cid} but CustomDeck keys {list(cd)}")
            continue
        if len(cd) != 1:
            warn(f"{label(o)}: own CustomDeck has {len(cd)} keys {list(cd)}")
        for k, e in cd.items():
            if not k.isdigit() or k.startswith("0"):
                fail(f"{label(o)}: CustomDeck key {k!r} not a plain number")
            missing = CD_KEYS - set(e)
            if missing - {"Type", "UniqueBack", "BackIsHidden"}:
                fail(f"{label(o)}: CustomDeck {k} lacks {sorted(missing)}")
            elif missing:
                warn(f"{label(o)}: CustomDeck {k} lacks {sorted(missing)}")
            if not (e.get("FaceURL") or "").startswith("http") or not (e.get("BackURL") or "").startswith("http"):
                fail(f"{label(o)}: CustomDeck {k} Face/Back URL empty or not http")
            w, h = e.get("NumWidth"), e.get("NumHeight")
            if not (isinstance(w, int) and isinstance(h, int) and 1 <= w <= 10 and 1 <= h <= 7):
                fail(f"{label(o)}: CustomDeck {k} NumWidth/NumHeight {w}x{h}")
            elif k == key and cid % 100 >= w * h - (1 if w * h > 1 else 0):
                fail(f"{label(o)}: CardID {cid} index {cid % 100} outside a {w}x{h} sheet")
            images[k].add((e.get("FaceURL"), e.get("BackURL"), w, h, e.get("UniqueBack"), e.get("BackIsHidden")))
            image_users[k].add(o.get("GUID"))

    # decks
    for d, parents in every:
        if d.get("Name") != "Deck":
            continue
        cards = d.get("ContainedObjects")
        ids = d.get("DeckIDs")
        if not isinstance(cards, list) or not isinstance(ids, list):
            fail(f"{label(d)}: ContainedObjects/DeckIDs not lists")
            continue
        if len(cards) == 0:
            warn(f"{label(d)} in {where(parents)}: empty deck (0 cards; DeckIDs {len(ids)}, "
                 f"CustomDeck {'absent' if 'CustomDeck' not in d else len(d['CustomDeck'])})")
            if ids or d.get("CustomDeck"):
                fail(f"{label(d)}: empty but DeckIDs/CustomDeck not empty")
            continue
        if len(cards) == 1:
            warn(f"{label(d)}: deck of one card (TTS turns it into a card)")
        if len(ids) != len(cards):
            fail(f"{label(d)}: {len(ids)} DeckIDs vs {len(cards)} cards")
        for i, (cid, c) in enumerate(zip(ids, cards)):
            if c.get("Name") not in CARDS:
                fail(f"{label(d)}: item {i} is a {c.get('Name')}")
            elif cid != c.get("CardID"):
                fail(f"{label(d)}: DeckIDs[{i}]={cid} but card {c.get('GUID')} CardID {c.get('CardID')}")
        dcd = d.get("CustomDeck")
        if not isinstance(dcd, dict):
            fail(f"{label(d)}: no CustomDeck")
            continue
        used = defaultdict(set)
        for c in cards:
            e = own_entry(c)
            if e is None:
                continue
            k = str(c["CardID"] // 100)
            used[k].add((e.get("FaceURL"), e.get("BackURL")))
            de = dcd.get(k)
            if de is None:
                fail(f"{label(d)}: card {c.get('GUID')} {c.get('Nickname')!r} key {k} not in the deck's CustomDeck")
            else:
                diff = [f for f in sorted(CD_KEYS) if de.get(f) != e.get(f)]
                if diff:
                    fail(f"{label(d)}: card {c.get('GUID')} {c.get('Nickname')!r} key {k}: deck entry differs in {diff}")
        for k, faces in used.items():
            if len(faces) > 1:
                fail(f"{label(d)}: key {k} carries {len(faces)} different images among its cards")
        unused = sorted(set(dcd) - set(used), key=int)
        if unused:
            warn(f"{label(d)}: unused CustomDeck keys {unused}")
        backs = Counter(own_entry(c).get("BackURL") for c in cards if own_entry(c))
        if len(backs) > 1:
            notes.append(f"{label(d)}: {len(backs)} different backs {dict((b.rsplit('/', 1)[-1], n) for b, n in backs.items())}")
        cs = Counter((c.get("Transform") or {}).get("scaleX") for c in cards)
        if set(cs) != {(d.get("Transform") or {}).get("scaleX")}:
            notes.append(f"{label(d)}: deck scale {d['Transform']['scaleX']} vs card scales {dict(cs)}")
        sideways = {c.get("SidewaysCard") for c in cards}
        if len(sideways) > 1 or d.get("SidewaysCard") not in sideways:
            warn(f"{label(d)}: SidewaysCard deck {d.get('SidewaysCard')} vs cards {sideways}")
        if d.get("CustomDeck"):
            for k, e in d["CustomDeck"].items():
                images[k].add((e.get("FaceURL"), e.get("BackURL"), e.get("NumWidth"), e.get("NumHeight"),
                               e.get("UniqueBack"), e.get("BackIsHidden")))

    # key collisions
    clash = {k: v for k, v in images.items() if len({(f, b) for f, b, *_ in v}) > 1}
    for k, v in sorted(clash.items(), key=lambda kv: int(kv[0])):
        faces = sorted({f.rsplit("/", 1)[-1] for f, *_ in v})
        backs = sorted({b.rsplit("/", 1)[-1] for _, b, *_ in v})
        warn(f"CustomDeck key {k}: {len(v)} different images: faces {faces} backs {backs}")
    flag = {k: v for k, v in images.items() if len(v) > 1 and k not in clash}
    for k, v in flag.items():
        warn(f"CustomDeck key {k}: same images, flags differ {sorted(map(str, v))}")
    notes.append(f"CustomDeck keys: {len(images)}, colliding (different images) {len(clash)}; "
                 f"highest {max(map(int, images))}")
    img_keys = defaultdict(set)
    for k, v in images.items():
        for f, b, *_ in v:
            img_keys[(f, b)].add(k)
    multi = sum(1 for v in img_keys.values() if len(v) > 1)
    notes.append(f"images (face+back) under more than one key: {multi} of {len(img_keys)}")

    # large creatures: scale 3 vs resizeTargets
    lua = save.get("LuaScript") or ""
    m = re.search(r"resizeTargets\s*=\s*\{\n(.*?)\n\}", lua, re.S)
    targets = set(re.findall(r'\[\s*"((?:[^"\\]|\\.)*)"\s*\]\s*=\s*true', m.group(1))) if m else set()
    if not m:
        fail("LuaScript: no resizeTargets table")
    large_names = set()
    scales = defaultdict(Counter)
    for o, parents in every:
        if o.get("Name") not in CARDS:
            continue
        e = own_entry(o) or {}
        face = e.get("FaceURL") or ""
        t = o.get("Transform") or {}
        s = (t.get("scaleX"), t.get("scaleZ"))
        if LARGE in face:
            large_names.add(o.get("Nickname"))
            scales["large"][s] += 1
        elif "/Creatures/" in face:
            scales["creature"][s] += 1
        elif "/Items/" in face or "/Field/" in face or "/N.M.E/" in face:
            scales["item/field/nme"][s] += 1
        elif "/Auxiliary/Minions/" in face:
            scales["minion"][s] += 1
        else:
            scales["other"][s] += 1
    for n in sorted(large_names - targets, key=str):
        fail(f"large creature {n!r} in the save but not in resizeTargets")
    for n in sorted(targets - large_names):
        warn(f"resizeTargets {n!r}: no large creature card with that Nickname in the save")
    small_named = Counter()
    for o, _ in every:
        if o.get("Name") in CARDS and o.get("Nickname") in targets and LARGE not in ((own_entry(o) or {}).get("FaceURL") or ""):
            small_named[o.get("Nickname")] += 1
    for n, c in small_named.items():
        fail(f"{c} non-large card(s) named {n!r} would be resized to 3x by resizeTargets")
    for kind, c in scales.items():
        notes.append(f"card scale (x,z) {kind}: {dict(c.most_common(4))}")
    for o, parents in every:
        if o.get("Name") in CARDS and LARGE in ((own_entry(o) or {}).get("FaceURL") or ""):
            sx = (o.get("Transform") or {}).get("scaleX")
            if not parents and sx != 3.0:
                warn(f"{label(o)}: loose large creature at scale {sx} (Lua only resizes on leaving a container)")

    # bags
    for b, parents in every:
        if b.get("Name") not in BAGS:
            continue
        inside = b.get("ContainedObjects")
        if not isinstance(inside, list):
            fail(f"{label(b)}: ContainedObjects missing")
            continue
        if b["Name"] == "Infinite_Bag" and len(inside) != 1:
            fail(f"{label(b)}: infinite bag holds {len(inside)} objects (TTS wants 1)")
        if b["Name"] != "Infinite_Bag" and not isinstance(b.get("Bag"), dict):
            warn(f"{label(b)}: no Bag order block")
    for o, parents in every:
        if o.get("ContainedObjects") is not None and o.get("Name") not in BAGS + ("Deck",):
            fail(f"{label(o)}: ContainedObjects on a {o.get('Name')}")

    # snap points
    def snaps(lst, owner):
        for i, sp in enumerate(lst or []):
            p = (sp or {}).get("Position") or {}
            if not all(finite(p.get(a)) for a in "xyz"):
                fail(f"snap point {i} of {owner}: bad Position {p}")
            r = sp.get("Rotation")
            if r is not None and not all(finite(r.get(a)) for a in "xyz"):
                fail(f"snap point {i} of {owner}: bad Rotation {r}")
            for k in set(sp) - {"Position", "Rotation", "Tags"}:
                warn(f"snap point {i} of {owner}: unknown key {k}")
    snaps(save.get("SnapPoints"), "the table")
    for o, _ in every:
        snaps(o.get("AttachedSnapPoints"), label(o))
    gs = save.get("SnapPoints") or []
    pos = Counter((round(s["Position"]["x"], 2), round(s["Position"]["z"], 2)) for s in gs)
    for p, n in pos.items():
        if n > 1:
            warn(f"table snap point at {p} repeated {n} times")
    notes.append(f"snap points: table {len(gs)}, attached {sum(len(o.get('AttachedSnapPoints') or []) for o, _ in every)} "
                 f"on {sum(1 for o, _ in every if o.get('AttachedSnapPoints'))} objects")

    # zones
    hands = [o for o, p in every if o.get("Name") == "HandTrigger"]
    for h in hands:
        if h.get("FogColor") not in SEATS:
            fail(f"{label(h)}: FogColor {h.get('FogColor')!r} is not a seat colour")
        if h.get("ContainedObjects"):
            fail(f"{label(h)}: holds objects")
        t = h["Transform"]
        if t["scaleY"] <= 0:
            fail(f"{label(h)}: flat zone")
    seats = Counter(h.get("FogColor") for h in hands)
    notes.append(f"hand zones: {len(hands)} {dict(seats)}")
    for o, p in every:
        if o.get("Name") in ("FogOfWarTrigger", "FogOfWar") and o.get("FogColor") not in SEATS | {"Black", "Grey"}:
            fail(f"{label(o)}: FogColor {o.get('FogColor')!r}")


if __name__ == "__main__":
    main(save_arg())
    for m in notes:
        print("NOTE", m)
    for m in warns:
        print("WARN", m)
    for m in fails:
        print("FAIL", m)
    print(f"structure: {len(fails)} failures, {len(warns)} warnings")
    sys.exit(1 if fails else 0)
