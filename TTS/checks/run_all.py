"""Runs every check on a save, 4 at a time: one line each, the tail of a failing one, exit 1 if any fails.

    python run_all.py [save.json]       (default the repo's save; outputs in /tmp/tts-checks/out/; about 40 s)
"""
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from card_sync_steps import GROUPS  # noqa: E402
from checks_env import HERE, ensure_history, save_arg  # noqa: E402

CHECKS = [   # file and its extra arguments
    ("structure.py",), ("drift.py",),
    ("contents_decks.py",), ("contents_backs.py",), ("contents_coverage.py",),
    ("verify_rules_snapshot.py",),
    ("lua_mock.py",),
    ("links_pins.py",), ("links_http.py",),
    ("updater_idempotent.py",),
]
# card_sync_steps.py in 3 parts of about 15 s: these two and the rest of its GROUPS
CSS_PARTS = (("main", "save", "bake"), ("plans", "timer", "gate", "history", "build", "tell"))
CHECKS += [("card_sync_steps.py", *p) for p in (*CSS_PARTS, tuple(g for g in GROUPS if g not in sum(CSS_PARTS, ())))]
OUT = "/tmp/tts-checks/out"
TIMEOUT = 600                                               # seconds per check: one that hangs fails, the rest still run
SLOW = ("card_sync_steps.py", "links_http.py", "updater_idempotent.py")   # started first
# macOS bash 3.2: a builtin's pipe write cut by SIGCHLD (never bash 5 on runners); each part makes its own sandboxes
EINTR = re.compile(r"\S+: line \d+: \w+: write error: Interrupted system call")   # $0 is the name after bash -c


def _once(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT)
        return r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired as e:                  # its output is bytes even with text=True
        return 1, "".join((b or b"").decode("utf-8", "replace") for b in (e.stdout, e.stderr)) + f"\ntimed out after {TIMEOUT}s"


def run(check, save):
    """(exit code, output, seconds, note); a card_sync_steps part failing on bash's EINTR runs once more."""
    name, *extra = check
    args = [] if name == "card_sync_steps.py" else [save]              # its extras: groups of cases
    cmd = [sys.executable, os.path.join(HERE, name), *args, *extra]
    start = time.monotonic()
    code, text = _once(cmd)
    note = ""
    if code and name == "card_sync_steps.py" and EINTR.search(text):
        code, again = _once(cmd)
        text, note = f"{text}\n--- run again (bash EINTR) ---\n{again}", ", run again: bash EINTR"
    with open(os.path.join(OUT, "_".join([name.replace(".py", ""), *extra[:1]]) + ".txt"), "w", encoding="utf-8") as f:
        f.write(text)
    return code, text, time.monotonic() - start, note


def main():
    save = save_arg()
    os.makedirs(OUT, exist_ok=True)
    os.environ["TTS_HISTORY_FETCHED"] = ensure_history()    # once, before the checks that read it (they skip the fetch)
    failed = []

    with ThreadPoolExecutor(4) as pool:                     # lines still in CHECKS order
        order = sorted(CHECKS, key=lambda c: SLOW.index(c[0]) if c[0] in SLOW else len(SLOW))
        futures = {c: pool.submit(run, c, save) for c in order}
        for check in CHECKS:
            code, text, took, note = futures[check].result()
            print(f"{'ok  ' if code == 0 else 'FAIL'} {' '.join(check)} ({took:.0f}s{note})", flush=True)
            if code:
                failed.append(check[0])
                for line in text.strip().splitlines()[-8:]:
                    print("       " + line)
    print(f"{len(CHECKS) - len(failed)} of {len(CHECKS)} passed; outputs in {OUT}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
