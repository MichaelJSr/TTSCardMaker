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
    ("updater_idempotent.py",), ("updater_report_decks.py",), ("tts_save_gate.py",), ("card_sync_steps.py",),
]
OUT = "/tmp/tts-checks/out"
TIMEOUT = 600                                               # seconds per check: one that hangs fails, the rest still run


def main():
    save = save_arg()
    os.makedirs(OUT, exist_ok=True)
    os.environ["TTS_HISTORY_FETCHED"] = ensure_history()    # once, before the checks that read it (they skip the fetch)
    failed = []
    for name, *extra in CHECKS:
        args = [] if name in ("tts_save_gate.py", "card_sync_steps.py") else [save]
        start = time.monotonic()
        try:
            r = subprocess.run([sys.executable, os.path.join(HERE, name), *args, *extra], capture_output=True, text=True,
                               timeout=TIMEOUT)
            code, text = r.returncode, r.stdout + r.stderr
        except subprocess.TimeoutExpired as e:              # its output is bytes even with text=True
            code = 1
            text = "".join((b or b"").decode("utf-8", "replace") for b in (e.stdout, e.stderr)) + f"\ntimed out after {TIMEOUT}s"
        with open(os.path.join(OUT, name.replace(".py", ".txt")), "w", encoding="utf-8") as f:
            f.write(text)
        print(f"{'ok  ' if code == 0 else 'FAIL'} {name} ({time.monotonic() - start:.0f}s)", flush=True)
        if code:
            failed.append(name)
            for line in text.strip().splitlines()[-8:]:
                print("       " + line)
    print(f"{len(CHECKS) - len(failed)} of {len(CHECKS)} passed; outputs in {OUT}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
