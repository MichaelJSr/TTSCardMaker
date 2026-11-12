"""References in the save's Lua scripts hold: GUIDs exist, object types are TTS types, TEAMS (seat = team) and
SIDE_ORDER agree, hand zones belong to seats on a team.
Usage: python scripts_global_refs.py [save.json]   (exit 1 on a failure; WARN lines are not failures)"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import save_arg  # noqa: E402

SEATS = ['White', 'Brown', 'Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink']
TEAMS = {'None', 'Clubs', 'Diamonds', 'Hearts', 'Spades', 'Jokers'}
TYPES = {'Generic', 'Board', 'Card', 'Deck', 'Bag', 'Infinite', 'Dice', 'Figurine', 'Chip', 'Coin', 'Tile', 'Block',
         '3D Text', 'Scripting', 'Hand', 'Fog', 'Layout', 'Rpg', 'Puzzle', 'Calculator', 'Notecard', 'Counter',
         'Tablet', 'Clock', 'Domino', 'Mahjong', 'Chess', 'Checker', 'Go', 'Jigsaw', 'Stack'}

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
    g = code_only(save.get('LuaScript') or '')
    teams = table(g, 'TEAMS')
    seen = {}                                   # seat -> its team
    if teams is not None:
        pairs = re.findall(r'\[?\s*["\']?(\w+)["\']?\s*\]?\s*=\s*["\'](\w+)["\']', teams)   # Seat = "Team"
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
    hands = {o['GUID']: o for o, p in objs if o.get('Name') == 'HandTrigger'}
    if seen:
        for k, o in hands.items():
            if o.get('FogColor') in SEATS and o.get('FogColor') not in seen:
                warns.append(f'HandTrigger {k}: owner {o.get("FogColor")} is on no team')
    for w in warns:
        print('WARN', w)
    for f in fails:
        print('FAIL', f)
    print(f'{len(scripts)} scripts, {len(hands)} hand zones, {len(fails)} failures, {len(warns)} warnings')
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(main(save_arg()))
