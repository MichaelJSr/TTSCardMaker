"""Runs every check on a save: one line each, the tail of a failing one, exit 1 if any fails.

    python run_all.py [save.json]       (default the repo's save; outputs in /tmp/tts-checks/out/)
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import HERE, ensure_history, save_arg  # noqa: E402

CHECKS = [   # file and its extra arguments
    ("structure.py",), ("serializer.py",), ("customdeck_collisions.py",), ("drift.py",),
    ("contents_decks.py",), ("contents_names.py",), ("contents_backs.py",), ("contents_coverage.py",),
    ("contents_resize.py",), ("verify_rules_snapshot.py",),
    ("scripts_lua_syntax.py",), ("scripts_global_refs.py",), ("scripts_state_xml.py",), ("verify_scripts_static.py",),
    ("lua_mock.py",), ("lua_table.py",), ("lua_resize_roundtrip.py",),
    ("links_pins.py",), ("pins_current.py",), ("links_http.py",), ("final_spot.py",),
    ("updater_idempotent.py",), ("updater_report_decks.py",), ("tts_save_gate.py",),
]
OUT = "/tmp/tts-checks/out"


def main():
    save = save_arg()
    os.makedirs(OUT, exist_ok=True)
    ensure_history()                                        # once, before the checks that read it
    failed = []
    for name, *extra in CHECKS:
        args = [] if name == "tts_save_gate.py" else [save]
        start = time.monotonic()
        r = subprocess.run([sys.executable, os.path.join(HERE, name), *args, *extra], capture_output=True, text=True)
        text = r.stdout + r.stderr
        with open(os.path.join(OUT, name.replace(".py", ".txt")), "w", encoding="utf-8") as f:
            f.write(text)
        print(f"{'ok  ' if r.returncode == 0 else 'FAIL'} {name} ({time.monotonic() - start:.0f}s)", flush=True)
        if r.returncode:
            failed.append(name)
            for line in text.strip().splitlines()[-8:]:
                print("       " + line)
    print(f"{len(CHECKS) - len(failed)} of {len(CHECKS)} passed; outputs in {OUT}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
