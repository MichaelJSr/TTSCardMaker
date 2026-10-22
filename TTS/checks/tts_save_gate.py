"""tts-save.yml's daily gate ('Changes since the last run') against real history, with gh mocked.

    python3 tts_save_gate.py [history clone]    (default $TTS_HISTORY or /tmp/tts-checks/history.git; needs gh logged in)
The step's own script runs under bash -e. 'gh run list' answers with a made-up last run; 'gh api' asks GitHub for
real bot commits, cut off at a given time. Exits 1 when a case gets the wrong answer.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

from checks_env import HISTORY, REPO, ensure_history

WORKFLOW = os.path.join(REPO, ".github/workflows/tts-save.yml")
QUIET = ("2026-10-21T20:00:00Z", "2026-10-22T07:00:00Z")    # last run, cut-off: bot commits from 13:00Z, no pickle
FAKE_GH = """#!/bin/bash
if [ "$1 $2" = "run list" ]; then
  while [ $# -gt 0 ]; do [ "$1" = "-q" ] && q=$2; shift; done
  printf '%s' "$MOCK_RUNS" | jq -r "$q"; exit
fi
if [ "$1" = "api" ]; then
  [ -n "$MOCK_API_DOWN" ] && exit 1
  url=$2; shift 2
  exec "$REAL_GH" api "$url&until=$MOCK_UNTIL" "$@"
fi
exit 1
"""


def step_script() -> str:
    """The run: block of the 'Changes since the last run' step."""
    lines = open(WORKFLOW, encoding="utf-8").read().split("\n")
    start = next(i for i, x in enumerate(lines) if x.strip() == "- name: Changes since the last run")
    at = next(i for i in range(start, len(lines)) if lines[i].strip() == "run: |")
    indent = len(lines[at + 1]) - len(lines[at + 1].lstrip())
    body = []
    for x in lines[at + 1:]:
        if x.strip() and len(x) - len(x.lstrip()) < indent:
            break
        body.append(x[indent:])
    return "\n".join(body)


def main():
    clone = sys.argv[1] if len(sys.argv) > 1 else HISTORY
    ensure_history(clone)
    real_gh = shutil.which("gh")
    if not real_gh or not shutil.which("jq"):
        sys.exit("needs gh (logged in) and jq")
    head = subprocess.run(["git", "-C", clone, "rev-parse", "main"], capture_output=True, text=True, check=True).stdout.strip()
    before_save = subprocess.run(["git", "-C", clone, "rev-parse", "c9873ddf^"], capture_output=True, text=True,
                                 check=True).stdout.strip()
    work = tempfile.mkdtemp(prefix="tts-gate_")
    gh = os.path.join(work, "gh")
    with open(gh, "w") as f:
        f.write(FAKE_GH)
    os.chmod(gh, 0o755)
    script = os.path.join(work, "step.sh")
    with open(script, "w") as f:
        f.write(step_script())

    def run(runs, until="", force="false", api_down=False):
        out = os.path.join(work, "out")
        open(out, "w").close()
        env = {**os.environ, "PATH": work + os.pathsep + os.environ["PATH"], "REAL_GH": real_gh, "GITHUB_OUTPUT": out,
               "GITHUB_REPOSITORY": "MichaelJSr/TTSCardMaker", "FORCE": force, "BOT_REPO": "bobberlington/AutoCroissant",
               "MOCK_RUNS": json.dumps(runs), "MOCK_UNTIL": until, "MOCK_API_DOWN": "1" if api_down else ""}
        r = subprocess.run(["bash", "-e", script], cwd=clone, env=env, capture_output=True, text=True, timeout=120)
        got = re.findall(r"^run=(\w+)$", open(out).read(), re.M)
        return (got[0] if len(got) == 1 else f"exit {r.returncode}, outputs {got}"), (r.stdout + r.stderr).strip()

    def last(sha, started):
        return [{"headSha": sha, "startedAt": started}]

    cases = [   # (what, runs, until, force, api_down, wanted)
        ("forced by hand", [], "", "true", False, "true"),
        ("no earlier run", [], "", "false", False, "true"),
        ("last run's commit unknown", last("0" * 40, "2026-10-22T07:20:00Z"), "", "false", False, "true"),
        ("PICKLE 3888392 (07:23Z) after the last run", last(head, "2026-10-22T07:20:00Z"), "2026-10-22T07:40:00Z",
         "false", False, "true"),
        ("PICKLE 1.6 h before the last run (website maybe not rebuilt)", last(head, "2026-10-22T09:00:00Z"),
         "2026-10-22T09:30:00Z", "false", False, "true"),
        ("docs-only bot commits (39da9ed ...), no pickle", last(head, QUIET[0]), QUIET[1], "false", False, "false"),
        ("card repo: the save changed (c9873ddf)", last(before_save, QUIET[0]), QUIET[1], "false", False, "true"),
        ("GitHub API down", last(head, QUIET[0]), QUIET[1], "false", True, "true"),
    ]
    fails = 0
    for what, runs, until, force, down, wanted in cases:
        got, log = run(runs, until, force, down)
        ok = got == wanted
        fails += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {what}: run={got} (want {wanted})")
        for line in log.splitlines():
            print("       " + line)
    # the docs-only window really holds bot commits, just none touching the pickles
    window = subprocess.run([real_gh, "api", "repos/bobberlington/AutoCroissant/commits?sha=main&since=2026-10-21T13:00:00Z"
                             f"&until={QUIET[1]}&per_page=100", "-q", "[.[].sha[:7]]"],
                            capture_output=True, text=True)
    shas = json.loads(window.stdout or "[]")
    if "39da9ed" not in shas:
        fails += 1
        print(f"FAIL docs-only window lacks 39da9ed: {shas}")
    else:
        print(f"ok   docs-only window holds {len(shas)} bot commits, 39da9ed among them")
    shutil.rmtree(work, ignore_errors=True)
    print(f"{fails} failure(s)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
