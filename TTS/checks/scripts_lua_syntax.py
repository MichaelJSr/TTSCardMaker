"""Every LuaScript in the save compiles as Lua 5.2 and uses nothing MoonSharp (TTS) lacks.
Usage: python scripts_lua_syntax.py [save.json]   (needs lupa; luaparser optional)"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import need_lupa, save_arg  # noqa: E402

need_lupa()

def walk(objs, path=()):
    for o in objs or []:
        yield o, path
        yield from walk(o.get('ContainedObjects'), path + (o.get('GUID'),))
        for k, st in (o.get('States') or {}).items():
            yield from walk([st], path + (o.get('GUID'), 'state' + k))

def strip(src):
    """Code with strings and comments blanked; also the list of string bodies."""
    out, strs, i, n = [], [], 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith('--', i):
            m = re.match(r'--\[(=*)\[', src[i:])
            if m:
                end = src.find(']' + m.group(1) + ']', i)
                end = n if end < 0 else end + len(m.group(1)) + 2
            else:
                end = src.find('\n', i)
                end = n if end < 0 else end
            out.append(' ' * (end - i)); i = end; continue
        m = re.match(r'\[(=*)\[', src[i:])
        if m:
            end = src.find(']' + m.group(1) + ']', i)
            end = n if end < 0 else end + len(m.group(1)) + 2
            strs.append(src[i:end]); out.append('""' + ' ' * (end - i - 2)); i = end; continue
        if c in '"\'':
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == '\\' else 1
            strs.append(src[i:j + 1]); out.append('""' + ' ' * (j - i - 1)); i = j + 1; continue
        out.append(c); i += 1
    return ''.join(out), strs

BANNED = [  # Lua 5.3+ syntax or libraries MoonSharp lacks
    (r'//', 'floor division //'), (r'<<|>>', 'bit shift'), (r'(?<![~<>=])&', 'bitwise &'),
    (r'\|', 'bitwise |'), (r'~(?!=)', 'bitwise ~'), (r'\bgoto\b', 'goto'), (r'::\w+::', 'label'),
    (r'<\s*(const|close)\s*>', 'attrib'), (r'\butf8\s*\.', 'utf8 lib'),
    (r'\bmath\s*\.\s*(tointeger|type|ult)\b', 'math 5.3'), (r'\bstring\s*\.\s*(pack|unpack|packsize)\b', 'string.pack'),
    (r'\btable\s*\.\s*move\b', 'table.move'), (r'\bcoroutine\s*\.\s*(close|isyieldable)\b', 'coroutine 5.3+'),
    (r'\bwarn\s*\(', 'warn()'), (r'\bsetfenv\b|\bgetfenv\b|\bloadstring\b|\bmodule\s*\(', '5.1-only'),
]

def main(path):
    from lupa import lua52
    rt = lua52.LuaRuntime()
    load = rt.eval('function(s, n) local f, e = load(s, n) return e end')
    try:
        from luaparser import ast as luaast
    except ImportError:
        luaast = None
    save = json.load(open(path, encoding='utf-8'))
    scripts = [('Global', save.get('LuaScript') or '')]
    scripts += [(f"{o.get('GUID')} {o.get('Nickname') or o.get('Name')}", o.get('LuaScript') or '')
                for o, _ in walk(save.get('ObjectStates')) if o.get('LuaScript')]
    bad = 0
    for name, src in scripts:
        if not src.strip():
            continue
        before = bad
        err = load(src, '=' + name)
        if err:
            print(f'FAIL {name}: Lua 5.2 compile: {err}'); bad += 1
        if luaast is not None:
            try:
                luaast.parse(src)
            except Exception as e:  # luaparser is stricter on odd code: report only
                print(f'WARN {name}: luaparser: {str(e)[:120]}')
        code, strs = strip(src)
        for pat, what in BANNED:
            for m in re.finditer(pat, code):
                line = code.count('\n', 0, m.start()) + 1
                print(f'FAIL {name}:{line}: {what}'); bad += 1
        for s in strs:
            if re.search(r'\\u\{', s):
                print(f'FAIL {name}: \\u{{}} escape (5.3) in {s[:40]}'); bad += 1
        print(f'ok   {name}: {len(src)} chars' if bad == before else f'..   {name}')
    print(f'{len(scripts)} scripts, {bad} failures')
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main(save_arg()))
