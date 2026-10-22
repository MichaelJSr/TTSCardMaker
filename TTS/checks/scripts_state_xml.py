"""LuaScriptState is JSON the script can load, BlockSquare turn markers agree with their state, XmlUI is well-formed.
Usage: python scripts_state_xml.py [save.json]   (exit 1 on a failure)"""
import json, os, re, sys
import xml.etree.ElementTree as ET

def walk(objs, path=()):
    for o in objs or []:
        yield o, path
        yield from walk(o.get('ContainedObjects'), path + (o.get('GUID'),))
        for k, st in (o.get('States') or {}).items():
            yield from walk([st], path + (o.get('GUID'), 'state' + k))

def main(path):
    save = json.load(open(path, encoding='utf-8'))
    fails, warns = [], []
    items = [('Global', save)] + [(o.get('GUID'), o) for o, _ in walk(save.get('ObjectStates'))]
    for name, o in items:
        src, state, xml = o.get('LuaScript') or '', o.get('LuaScriptState') or '', o.get('XmlUI') or ''
        if state:
            try:
                data = json.loads(state)
            except ValueError as e:
                fails.append(f'{name}: LuaScriptState is not JSON: {e}')
                data = None
            if not re.search(r'function\s+onSave\b', src):
                warns.append(f'{name}: LuaScriptState kept but the script has no onSave')
            if not re.search(r'function\s+on[Ll]oad\s*\(\s*\w+', src):
                warns.append(f'{name}: LuaScriptState kept but onLoad takes no saved_data')
            if 'watchFlip' in src and isinstance(data, dict):     # BlockSquare turn marker
                cycle = re.findall(r'\{\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\}', src.split('stateNames')[0])
                names = re.findall(r'"([^"]+)"', src.split('stateNames', 1)[1].split('}')[0])
                i = data.get('currentIndex')
                if not isinstance(i, int) or not 1 <= i <= len(names):
                    fails.append(f'{name}: currentIndex {i!r} out of 1..{len(names)}')
                else:
                    if o.get('Nickname') != names[i - 1]:
                        fails.append(f'{name}: Nickname {o.get("Nickname")!r} but state {i} is {names[i - 1]!r}')
                    cd = o.get('ColorDiffuse') or {}
                    want = tuple(map(float, cycle[i - 1]))
                    have = (cd.get('r'), cd.get('g'), cd.get('b'))
                    if any(h is None or abs(h - w) > 0.01 for h, w in zip(have, want)):
                        fails.append(f'{name}: ColorDiffuse {have} but state {i} is {want}')
            if 'tableImageData' in src and isinstance(data, dict):  # Flex Table Control
                for e in data.get('tid') or []:
                    if not (isinstance(e, dict) and e.get('name') and str(e.get('url', '')).startswith('http')):
                        fails.append(f'{name}: bad saved table image {e!r}')
                if not isinstance(data.get('cd'), dict):
                    fails.append(f'{name}: no cd (checkbox) table in state')
        elif re.search(r'function\s+onSave\b', src) and o is not save:
            warns.append(f'{name}: has onSave but no saved state (loads defaults)')
        if xml.strip():
            try:
                ET.fromstring('<root>' + xml + '</root>')     # XmlUI may have several top-level elements
            except ET.ParseError as e:
                fails.append(f'{name}: XmlUI not well-formed: {e}')
            if not re.search(r'<\s*[A-Za-z]', xml):
                warns.append(f'{name}: XmlUI has no elements (comment only)')
    for w in warns:
        print('WARN', w)
    for f in fails:
        print('FAIL', f)
    print(f'{len(items)} objects, {len(fails)} failures, {len(warns)} warnings')
    return 1 if fails else 0

if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from checks_env import save_arg
    sys.exit(main(save_arg()))
