"""References in the save's Lua scripts hold: GUIDs exist, colours are TTS colours, teams are TTS teams,
hand zones belong to seats on a team, resizeTargets matches the large creature cards.
Usage: python scripts_global_refs.py [save.json]   (exit 1 on a failure; WARN lines are not failures)"""
import json, os, re, sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import save_arg  # noqa: E402

SEATS = ['White', 'Brown', 'Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink']
COLOURS = set(SEATS) | {'Grey', 'Black'}
TEAMS = {'None', 'Clubs', 'Diamonds', 'Hearts', 'Spades', 'Jokers'}
TYPES = {'Generic', 'Board', 'Card', 'Deck', 'Bag', 'Infinite', 'Dice', 'Figurine', 'Chip', 'Coin', 'Tile', 'Block',
         '3D Text', 'Scripting', 'Hand', 'Fog', 'Layout', 'Rpg', 'Puzzle', 'Calculator', 'Notecard', 'Counter',
         'Tablet', 'Clock', 'Domino', 'Mahjong', 'Chess', 'Checker', 'Go', 'Jigsaw', 'Stack'}
RGB = {  # TTS seat colours (Color.<seat>), as the save's TabStates also give them
    'White': (1, 1, 1), 'Brown': (0.443, 0.231, 0.09), 'Red': (0.856, 0.1, 0.094), 'Orange': (0.956, 0.392, 0.113),
    'Yellow': (0.905, 0.898, 0.172), 'Green': (0.192, 0.701, 0.168), 'Teal': (0.129, 0.694, 0.607),
    'Blue': (0.118, 0.53, 1), 'Purple': (0.627, 0.125, 0.941), 'Pink': (0.96, 0.439, 0.807)}
LARGE = 'Auxiliary/Creatures/'

def walk(objs, path=()):
    for o in objs or []:
        yield o, path
        yield from walk(o.get('ContainedObjects'), path + (o.get('GUID'),))
        for k, st in (o.get('States') or {}).items():
            yield from walk([st], path + (o.get('GUID'), 'state' + k))

def code_only(src):
    src = re.sub(r'--\[(=*)\[.*?\]\1\]', '', src, flags=re.S)
    return re.sub(r'--[^\n]*', '', src)

def table(src, name):
    m = re.search(name + r'\s*=\s*\{(.*?)\n\}', src, re.S)
    return m.group(1) if m else None

def face(card):
    cd = card.get('CustomDeck') or {}
    e = cd.get(str(card.get('CardID', 0) // 100)) or {}
    m = re.search(r'/TTSCardMaker/[^/]+/(.+)$', e.get('FaceURL') or '')
    return unquote(m.group(1)) if m else None

def main(path):
    save = json.load(open(path, encoding='utf-8'))
    objs = list(walk(save.get('ObjectStates')))
    guids = {o.get('GUID') for o, _ in objs}
    top = {o.get('GUID'): o for o in save.get('ObjectStates') or []}
    fails, warns = [], []
    scripts = [('Global', save.get('LuaScript') or '')] + \
        [(o['GUID'], o['LuaScript']) for o, _ in objs if o.get('LuaScript')]
    for name, src in scripts:
        code = code_only(src)
        for g in sorted(set(re.findall(r'["\']([0-9a-f]{6})["\']', code))):
            if g not in guids:
                fails.append(f'{name}: GUID {g} not in the save')
            elif g not in top:
                warns.append(f'{name}: GUID {g} is only inside a container')
        for t in re.findall(r'\.(?:tag|type)\s*[~=]=\s*["\']([^"\']+)["\']', code):
            if t not in TYPES:
                fails.append(f'{name}: object type "{t}" is not a TTS type')
        if re.search(r'\.tag\b', code):
            warns.append(f'{name}: uses deprecated obj.tag (obj.type is current)')
        for t in re.findall(r'\.team\s*=\s*["\']([^"\']+)["\']', code):
            if t not in TEAMS:
                fails.append(f'{name}: team "{t}" is not a TTS team')
        for c in re.findall(r'Player\s*\[\s*["\'](\w+)["\']\s*\]', code):
            if c not in COLOURS:
                fails.append(f'{name}: Player["{c}"] is not a TTS colour')
    g = code_only(save.get('LuaScript') or '')
    teams = table(g, 'TEAMS')
    seen = {}                                   # seat -> its team
    if teams is not None:
        pairs = re.findall(r'\[?\s*["\']?(\w+)["\']?\s*\]?\s*=\s*["\'](\w+)["\']', teams)   # Seat = "Team"
        for team, body in re.findall(r'\[?\s*["\']?(\w+)["\']?\s*\]?\s*=\s*\{([^}]*)\}', teams):   # Team = {seats} (before 10-30)
            pairs += [(c, team) for c in re.findall(r'["\'](\w+)["\']', body)]
        for c, team in pairs:
            if team not in TEAMS - {'None'}:
                fails.append(f'TEAMS: "{team}" is not a TTS team')
            if c not in SEATS:
                fails.append(f'TEAMS: "{c}" is not a seat colour')
            if c in seen:
                fails.append(f'TEAMS: {c} in {seen[c]} and {team}')
            seen[c] = team
    side = re.search(r'SIDE_ORDER\s*=\s*\{(.*?\})\s*\}', g, re.S)   # the seats a side's free hand zones go to, in order
    if side:
        order = {t: re.findall(r'["\'](\w+)["\']', body)
                 for t, body in re.findall(r'(\w+)\s*=\s*\{([^}]*)\}', side.group(1))}
        for team in sorted(set(seen.values()) | set(order)):
            want = sorted(c for c, t in seen.items() if t == team)
            if sorted(order.get(team, [])) != want:
                fails.append(f'SIDE_ORDER[{team}] {order.get(team)} is not the seats TEAMS puts on {team} {want}')
    for tname in ('ALL_SEAT_COLORS',):
        body = table(g, tname)
        if body is not None:
            for c in re.findall(r'["\'](\w+)["\']', body):
                if c not in SEATS:
                    fails.append(f'{tname}: "{c}" is not a seat colour')
    rgb = table(g, 'SEAT_COLOR_RGB')
    if rgb is not None:
        for c, r, gg, b in re.findall(r'(\w+)\s*=\s*\{\s*r\s*=\s*([\d.]+)\s*,\s*g\s*=\s*([\d.]+)\s*,\s*b\s*=\s*([\d.]+)', rgb):
            if c not in SEATS:
                fails.append(f'SEAT_COLOR_RGB: "{c}" is not a seat colour')
            elif max(abs(float(x) - y) for x, y in zip((r, gg, b), RGB[c])) > 0.01:
                warns.append(f'SEAT_COLOR_RGB.{c} = ({r}, {gg}, {b}) but TTS {c} is {RGB[c]}')
    hands = {o['GUID']: o for o, p in objs if o.get('Name') == 'HandTrigger'}
    if seen:
        for k, o in hands.items():
            if o.get('FogColor') in SEATS and o.get('FogColor') not in seen:
                warns.append(f'HandTrigger {k}: owner {o.get("FogColor")} is on no team')
    for k, o in hands.items():
        if o.get('FogColor') not in SEATS:
            fails.append(f'HandTrigger {k}: FogColor {o.get("FogColor")!r} is not a seat colour')
    rt = table(save.get('LuaScript') or '', 'resizeTargets')
    if rt is not None:
        names = [n.replace('\\"', '"').replace('\\\\', '\\')
                 for n in re.findall(r'\[\s*"((?:[^"\\]|\\.)*)"\s*\]\s*=\s*true', rt)]
        cards = [(o, face(o)) for o, _ in objs if o.get('Name') in ('Card', 'CardCustom')]
        large = {o.get('Nickname') for o, f in cards if f and f.startswith(LARGE)}
        nicks = {o.get('Nickname') for o, _ in cards}
        for n in names:
            if n not in nicks:
                fails.append(f'resizeTargets: "{n}" is no card Nickname in the save')
            elif n not in large:
                warns.append(f'resizeTargets: "{n}" is not a {LARGE} card')
        for n in sorted(large - set(names)):
            fails.append(f'resizeTargets: large card "{n}" missing')
        for o, f in cards:
            if o.get('Nickname') in names and not (f or '').startswith(LARGE):
                fails.append(f'resizeTargets: "{o.get("Nickname")}" also names a normal card {o["GUID"]} ({f})')
    for w in warns:
        print('WARN', w)
    for f in fails:
        print('FAIL', f)
    print(f'{len(scripts)} scripts, {len(hands)} hand zones, {len(fails)} failures, {len(warns)} warnings')
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(main(save_arg()))
