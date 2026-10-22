"""Script defects fixed in c9873ddf stay fixed: Flex Table getHandTransform(i) (F2), seat colours (F3), the
isDestroyed() guard (F4), the team-zone warning (F5). Usage: verify_scripts_static.py [save.json]"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import save_arg  # noqa: E402
s = json.load(open(save_arg(), encoding="utf-8"))
g = s["LuaScript"]
bad = []
def objs(o):
    for x in o:
        yield x; yield from objs(x.get("ContainedObjects", []))
for o in objs(s["ObjectStates"]):
    if "getHandTransform()" in (o.get("LuaScript") or ""):
        st = json.loads(o.get("LuaScriptState") or "{}")
        bad.append(f"F2 {o['GUID']}: getHandTransform() without index; cd={st.get('cd')}")
# F3 seat colours vs TabStates
tab = {v["title"]: v["visibleColor"] for v in s["TabStates"].values()}
for name, r, gg, b in re.findall(r"(\w+)\s*=\s*\{r=([\d.]+),\s*g=([\d.]+),\s*b=([\d.]+)\}", g):
    if name in tab:
        t = tab[name]
        d = max(abs(float(r) - t["r"]), abs(float(gg) - t["g"]), abs(float(b) - t["b"]))
        if d > 0.002:
            bad.append(f"F3 {name}: script {r},{gg},{b} vs TTS {t['r']},{t['g']},{t['b']} (max diff {d:.3f})")
if re.search(r"if obj and obj\.getGUID\(\) ~= nil", g):
    bad.append("F4 resize wait guards with getGUID() instead of isDestroyed()")
m = re.search(r"another team's zone\.\"[^)]*\)\s*return", g)
if m:
    bad.append("F5 team guard only messages, then returns (card still joins the hand)")
for b in bad: print("FAIL", b)
sys.exit(1 if bad else 0)
