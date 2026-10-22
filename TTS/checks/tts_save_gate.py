"""tts-save.yml's daily gate ('Changes since the last run') against real history, with gh and the names cache mocked.

    python3 tts_save_gate.py [history clone]    (default $TTS_HISTORY or /tmp/tts-checks/history.git; needs jq)
The step's own script runs under bash -e. 'gh run list' answers with a made-up last run. The names cache (the
workflow's newest actions/cache entry: the hash of the card browser's png -> name map the updater last ran with) is
mocked with hashes of that map built from the bot's stats.pkl at real commits (AUTOCROISSANT checkout), the way
build_site.py names cards: PICKLE 3888392 changed the names, so the updater last ran with others and the day runs; a
docs-only bot commit (39da9ed) leaves them, so the day skips; names back to PICKLE^'s after a run with PICKLE's run
too. Exits 1 when a case gets the wrong answer.
"""
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

from checks_env import BOT, HISTORY, REPO, ensure_history

WORKFLOW = os.path.join(REPO, ".github/workflows/tts-save.yml")
BUILD_SITE = os.path.join(REPO, "site/build/build_site.py")
PICKLE, DOCS = "3888392", "39da9ed"     # the bot's printed titles; docs only
FAKE_GH = """#!/bin/bash
if [ "$1 $2" = "run list" ]; then
  [ -n "$MOCK_API_DOWN" ] && exit 1
  while [ $# -gt 0 ]; do [ "$1" = "-q" ] && q=$2; shift; done
  printf '%s' "$MOCK_RUNS" | jq -r "$q"; exit
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


def names_sum(sha: str, site) -> tuple:
    """(hash, map) of the png -> name map build_site.py would make from the bot's stats.pkl at sha (PSD path as png)."""
    data = subprocess.run(["git", "-C", BOT, "show", f"{sha}:stats.pkl"], capture_output=True, check=True).stdout
    stats = site._Unpickler(data, f"stats.pkl@{sha}").load()
    names = {}
    for key, c in stats.items():
        if getattr(c, "duplicate_of", None):
            continue
        path = getattr(c, "path", "") or ""
        is_rule = getattr(c, "card_type", "") == "rulebook" or "/Rulebook/" in path
        parsed = getattr(c, "parsed_values", None) or {}
        title = parsed["name"] if "name" in parsed else getattr(c, "display_name", None)
        names[re.sub(r"\.psd$", ".png", path, flags=re.I)] = (title if not is_rule else None) or key
    return hashlib.sha256(json.dumps(names, sort_keys=True).encode()).hexdigest()[:16], names


def main():
    clone = sys.argv[1] if len(sys.argv) > 1 else HISTORY
    ensure_history(clone)
    if not shutil.which("jq"):
        sys.exit("needs jq")
    spec = importlib.util.spec_from_file_location("build_site", BUILD_SITE)
    site = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(site)
    sums = {}
    for sha in (f"{PICKLE}^", PICKLE, f"{DOCS}^", DOCS):
        sums[sha] = names_sum(sha, site)
    before, after = sums[f"{PICKLE}^"][1], sums[PICKLE][1]
    changed = sum(1 for p in after if before.get(p) != after[p])
    print(f"names at {PICKLE}^ {sums[f'{PICKLE}^'][0]}, at {PICKLE} {sums[PICKLE][0]}: {changed} of {len(after)} differ; "
          f"at {DOCS}^ {sums[f'{DOCS}^'][0]}, at {DOCS} {sums[DOCS][0]}")

    git = lambda *a: subprocess.run(["git", "-C", clone, *a], capture_output=True, text=True, check=True).stdout.strip()
    head = git("rev-parse", "main")
    before_save = git("rev-parse", "c9873ddf^")
    work = tempfile.mkdtemp(prefix="tts-gate_")
    with open(os.path.join(work, "gh"), "w") as f:
        f.write(FAKE_GH)
    os.chmod(os.path.join(work, "gh"), 0o755)
    script = os.path.join(work, "step.sh")
    with open(script, "w") as f:
        f.write(step_script())

    def run(last, names, ran_with, force="false", api_down=False):
        out = os.path.join(work, "out")
        open(out, "w").close()
        runs = [{"headSha": last}] if last else []
        env = {**os.environ, "PATH": work + os.pathsep + os.environ["PATH"], "GITHUB_OUTPUT": out,
               "GITHUB_REPOSITORY": "MichaelJSr/TTSCardMaker", "GITHUB_REF_NAME": "main", "FORCE": force,
               "NAMES_SAME": "true" if names == ran_with else "", "MOCK_RUNS": json.dumps(runs),
               "MOCK_API_DOWN": "1" if api_down else ""}
        r = subprocess.run(["bash", "-e", script], cwd=clone, env=env, capture_output=True, text=True, timeout=120)
        got = re.findall(r"^run=(\w+)$", open(out).read(), re.M)
        return (got[0] if len(got) == 1 else f"exit {r.returncode}, outputs {got}"), (r.stdout + r.stderr).strip()

    old, new, docs = sums[f"{PICKLE}^"][0], sums[PICKLE][0], sums[DOCS][0]
    cases = [   # (what, last run's sha, names hash now, names hash the updater last ran with, force, gh down, wanted)
        ("forced by hand", head, docs, docs, "true", False, "true"),
        (f"PICKLE {PICKLE}: the website's names changed", head, new, old, "false", False, "true"),
        (f"PICKLE {PICKLE} undone: names back to ones run with before, not the last run's", head, old, new, "false", False, "true"),
        (f"docs-only bot commit {DOCS}: names as before, nothing else", head, docs, sums[f"{DOCS}^"][0], "false", False, "false"),
        ("card repo: the save changed (c9873ddf)", before_save, docs, docs, "false", False, "true"),
        ("no earlier run", "", docs, docs, "false", False, "true"),
        ("last run's commit unknown", "0" * 40, docs, docs, "false", False, "true"),
        ("gh run list fails", head, docs, docs, "false", True, "true"),
    ]
    fails = 0 if sums[PICKLE][0] != sums[f"{PICKLE}^"][0] and sums[DOCS][0] == sums[f"{DOCS}^"][0] else 1
    if fails:
        print(f"FAIL the names hashes don't tell {PICKLE} from {DOCS}")
    for what, last, names, ran_with, force, down, wanted in cases:
        got, log = run(last, names, ran_with, force, down)
        ok = got == wanted
        fails += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {what}: run={got} (want {wanted})")
        for line in log.splitlines():
            print("       " + line)
    shutil.rmtree(work, ignore_errors=True)
    print(f"{fails} failure(s)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
