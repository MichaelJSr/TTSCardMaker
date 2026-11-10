"""Runs every check on a save, 4 at a time: one line each, the tail of a failing one, exit 1 if any fails.

    python run_all.py [save.json]       (default the repo's save; outputs in /tmp/tts-checks/out/; about 40 s)
"""
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from card_sync_steps import GROUPS  # noqa: E402
from checks_env import HERE, ensure_history, save_arg  # noqa: E402

CHECKS = [   # file and its extra arguments
    ("structure.py",), ("serializer.py",), ("customdeck_collisions.py",), ("drift.py",),
    ("contents_decks.py",), ("contents_names.py",), ("contents_backs.py",), ("contents_coverage.py",),
    ("contents_resize.py",), ("verify_rules_snapshot.py",),
    ("scripts_lua_syntax.py",), ("scripts_global_refs.py",), ("scripts_state_xml.py",), ("verify_scripts_static.py",),
    ("lua_mock.py",), ("lua_table.py",), ("lua_resize_roundtrip.py",),
    ("links_pins.py",), ("pins_current.py",), ("links_http.py",), ("final_spot.py",),
    ("updater_idempotent.py",), ("updater_report_decks.py",),
]
# card_sync_steps.py in 3 parts of about 15 s: these two and the rest of its GROUPS
CSS_PARTS = (("main", "save", "bake"), ("plans", "timer", "gate", "history", "build", "tell"))
CHECKS += [("card_sync_steps.py", *p) for p in (*CSS_PARTS, tuple(g for g in GROUPS if g not in sum(CSS_PARTS, ())))]
OUT = "/tmp/tts-checks/out"
TIMEOUT = 600                                               # seconds per check: one that hangs fails, the rest still run
SLOW = ("card_sync_steps.py", "links_http.py", "final_spot.py", "updater_idempotent.py")   # started first


def main():
    save = save_arg()
    os.makedirs(OUT, exist_ok=True)
    os.environ["TTS_HISTORY_FETCHED"] = ensure_history()    # once, before the checks that read it (they skip the fetch)
    failed = []

    def run(check):
        name, *extra = check
        args = [] if name == "card_sync_steps.py" else [save]          # its extras: groups of cases
        start = time.monotonic()
        try:
            r = subprocess.run([sys.executable, os.path.join(HERE, name), *args, *extra], capture_output=True, text=True,
                               timeout=TIMEOUT)
            code, text = r.returncode, r.stdout + r.stderr
        except subprocess.TimeoutExpired as e:              # its output is bytes even with text=True
            code = 1
            text = "".join((b or b"").decode("utf-8", "replace") for b in (e.stdout, e.stderr)) + f"\ntimed out after {TIMEOUT}s"
        with open(os.path.join(OUT, "_".join([name.replace(".py", ""), *extra[:1]]) + ".txt"), "w", encoding="utf-8") as f:
            f.write(text)
        return code, text, time.monotonic() - start

    with ThreadPoolExecutor(4) as pool:                     # lines still in CHECKS order
        order = sorted(CHECKS, key=lambda c: SLOW.index(c[0]) if c[0] in SLOW else len(SLOW))
        futures = {c: pool.submit(run, c) for c in order}
        for check in CHECKS:
            code, text, took = futures[check].result()
            print(f"{'ok  ' if code == 0 else 'FAIL'} {' '.join(check)} ({took:.0f}s)", flush=True)
            if code:
                failed.append(check[0])
                for line in text.strip().splitlines()[-8:]:
                    print("       " + line)
    print(f"{len(CHECKS) - len(failed)} of {len(CHECKS)} passed; outputs in {OUT}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
