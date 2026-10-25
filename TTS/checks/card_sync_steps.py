"""card-sync.yml's lanes and step scripts, offline: which jobs and steps run, both gates, the fonts, the commits.

    python3 card_sync_steps.py            (needs git 2.37 or later, bash and jq; no network)
1. The step plans: every step's `if:` evaluated as GitHub does (&&, ||, !, ==, the status functions, the implicit
   success()), per lane. Data (Card data, and after the bake): a dry run commits, posts and dispatches nothing; switched
   it posts, commits data and dispatches the site (after the bake, whatever the data did); a failed build commits and
   posts nothing. Main (Bake and save): bake, save, M and the re-pin of baked PNGs; bake=none skips the bake; a rejected or late M re-pins nothing; GO from Pending edits runs the
   stages. A failed live job (a retry too) alerts, a dry one doesn't; the deadline's reserve covers the caps of Commit
   main and every later step; after runs the data steps with AFTER = M (when it landed) and RECORDS, also for a bake
   that only recorded verdicts.
2. The data Gate on sandbox history: stoogedings-src/ alone and a hand-edited save don't start the data lane; fonts,
   stoogedings.json, an upper-case .PSD and the creation dates do; AFTER does, without the dispatch's inputs. The Build
   step's arguments: the dispatch's inputs, none after the bake; --own the main lane's commits since the last build.
   The main Gate: a push and a dispatch go; the schedule goes when a card input or the save changed (the lane's own
   commits aside) since the last live run whose Bake and save succeeded (faked run lists; dry runs passed over), or
   none is found; with nothing changed, a PSD-kind website edit sends it to the Pending edits step.
3. The fonts: a cache hit restores them outside the sparse patterns; after the Fonts tree step the bake's fast-forward
   merge (git_commit.local_commit's) keeps them (without it git deletes them: the control).
4. The Bake step's arguments: --pending for a push's run, a schedule, their retries and bake=pending, not for another
   dispatch.
5. Commit main's own script on a sandbox origin: M pushed with its outputs (baked, pngs); a push that failed but landed
   counts as pushed; main moved: M is dropped and one new run is dispatched (marked retry, the bake carried, no data
   inputs), none from a retry or while another run is unfinished; past minute 60 nothing is pushed. Re-pin: the save
   run again on M, a change is a second commit on M; none when the links were current or main moved.
6. The timer (a fixed window): a push's and the schedule's run look for a push run in its window (Another timer: one
   waiting, or with its Quiet window job unfinished; not itself, not one stuck 40 minutes; unreadable runs count as
   none) and skip their main lane when there is one (no cancel: the data lane ran); else a push's waits (card-sync-quiet
   on its first attempt, in no group) and the schedule's goes; a dispatch's at once; Quiet sleeps out what is left of
   the window from the push time. The data lane runs at once on every event but a retry.
7. Tell Discord on faked runs: once per failing streak of its lane (the newest other live run where the lane ended;
   runs that skipped it, and dry runs, passed over), once a lane per run (after sees data's failure).
8. The verdicts (AutoCroissant docs/Future/CARD_SYNC_VERDICTS.md): Bake records keeps M's part only when M landed (the
   baked events get M), records nothing on a dry run; every data job looks for unmerged records; the data gate goes for
   records alone; Build passes them on and lists them in bake-records.json; Guard
   events finds a guards commit's guard-events.json through its Guarded-push run (faked gh), skips one naming another
   commit, and warns for one not found.
Exits 1 when a case gets the wrong answer.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

from checks_env import REPO

WORKFLOW = os.path.join(REPO, ".github/workflows/card-sync.yml")
BASH = ["bash", "--noprofile", "--norc", "-eo", "pipefail"]           # GitHub's `shell: bash`
FAILED = []
LANE = "Bake and save"                                              # the main job's name (its gate's cursor)


def check(ok: bool, what: str) -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        FAILED.append(what)


# ---------- The workflow file (the subset of YAML it uses: anchors on steps, step lists and scalars) ----------
def _indent(line: str) -> int:
    return len(line) - len(line.lstrip())


def _block(lines: list, at: int, indent: int) -> tuple:
    """The literal block after line at (deeper than indent): (text, next line)."""
    body, i = [], at + 1
    while i < len(lines) and (not lines[i].strip() or _indent(lines[i]) > indent):
        body.append(lines[i])
        i += 1
    while body and not body[-1].strip():
        body.pop()
    cut = min(_indent(x) for x in body if x.strip())
    return "\n".join(x[cut:] for x in body) + "\n", i


def _value(text: str) -> str:
    """A scalar: quotes taken off, a trailing comment dropped."""
    text = text.strip()
    if text[:1] in ("'", '"'):
        return text[1:text.index(text[0], 1)]
    return re.sub(r"\s+#.*$", "", text)


def _mapping(lines: list, at: int, indent: int) -> tuple:
    """key: value lines deeper than indent after line at: (dict, next line)."""
    out, i = {}, at + 1
    while i < len(lines) and (not lines[i].strip() or _indent(lines[i]) > indent):
        x = lines[i].strip()
        if x and not x.startswith("#"):
            key, _, rest = x.partition(":")
            out[key.strip()] = _value(rest)
        i += 1
    return out, i


def _step(lines: list, at: int, anchors: dict) -> tuple:
    """One step from its `      - ` line: (dict, next line). An anchor on the dash line names it (the caller's)."""
    step, j = {}, at
    while j < len(lines):
        y = lines[j]
        if j > at and (y.startswith("      - ") or (y.strip() and _indent(y) < 8)):
            break
        line = y[8:]
        if j == at and line.strip()[:1] == "&":
            j += 1
            continue
        if y.strip() and not y.strip().startswith("#") and (_indent(y) == 8 or j == at):
            key, _, rest = line.partition(":")
            key, rest = key.strip(), rest.strip()
            name = ""
            if rest.startswith("&"):
                name, _, rest = rest[1:].partition(" ")
                rest = rest.strip()
            if rest.startswith("*"):
                step[key] = anchors[rest[1:]]
                j += 1
                continue
            if rest == "|":
                step[key], j = _block(lines, j, 8)
                if name:
                    anchors[name] = step[key]
                continue
            if rest == "" and key in ("env", "with"):
                step[key], j = _mapping(lines, j, 8)
                continue
            step[key] = _value(rest)
        j += 1
    return step, j


def load() -> dict:
    """{"env": the workflow's, "run_name", "jobs": {id: {"steps", "env", "timeout", "concurrency", "outputs", "name",
    "if", "needs", "environment"}}}; aliases resolved."""
    lines = open(WORKFLOW, encoding="utf-8").read().split("\n")
    flow = {"env": {}, "jobs": {}}
    anchors: dict = {}
    job, jobs = None, False                   # nothing before `jobs:` is a job's (the push paths look like steps)
    i = 0
    while i < len(lines):
        x = lines[i]
        if x == "env:":
            flow["env"], i = _mapping(lines, i, 0)
            continue
        if x.startswith("run-name:"):
            flow["run_name"] = x.split(":", 1)[1].strip()
        jobs = jobs or x == "jobs:"
        m = re.match(r"^  ([\w-]+):$", x) if jobs else None
        if m:
            job = {"steps": [], "env": {}}
            flow["jobs"][m.group(1)] = job
        if job is None:
            i += 1
            continue
        if x.startswith("    timeout-minutes:"):
            job["timeout"] = int(_value(x.split(":", 1)[1]))
        if x == "    env:":
            job["env"], i = _mapping(lines, i, 4)
            continue
        if x in ("    concurrency:", "    outputs:"):
            job[x.strip()[:-1]], i = _mapping(lines, i, 4)
            continue
        if re.match(r"^    (name|if|needs|environment):", x):
            key, _, rest = x.strip().partition(":")
            job[key] = _value(rest)
        if x.startswith("    steps:"):
            ref = x.split(":", 1)[1].strip()
            if ref.startswith("*"):
                job["steps"] = anchors[ref[1:]]
            elif ref.startswith("&"):
                anchors[ref[1:]] = job["steps"]
        if x.startswith("      - "):
            text = x[8:].strip()
            if text.startswith("*"):
                job["steps"].append(anchors[text[1:]])
                i += 1
                continue
            s, i = _step(lines, i, anchors)
            if text.startswith("&"):
                anchors[text[1:]] = s
            job["steps"].append(s)
            continue
        i += 1
    return flow


def step(job: dict, name: str) -> dict:
    return next(s for s in job["steps"] if s.get("name") == name or s.get("id") == name)


# ---------- GitHub expressions ----------
TOKEN = re.compile(r"\s*(\$\{\{|\}\}|&&|\|\||==|!=|!|\(|\)|,|'(?:[^']|'')*'|[A-Za-z_][\w.\-]*)")
STATUS = ("success(", "failure(", "always(", "cancelled(")


def evaluate(text: str, ctx: dict):
    text = text.strip()
    if text.startswith("${{") and text.endswith("}}"):
        text = text[3:-2]
    tokens, at = [], 0
    while at < len(text):
        m = TOKEN.match(text, at)
        if not m:
            if text[at:].strip():
                raise ValueError(f"cannot read {text[at:]!r}")
            break
        tokens.append(m.group(1))
        at = m.end()
    pos = [0]

    def peek():
        return tokens[pos[0]] if pos[0] < len(tokens) else None

    def take():
        pos[0] += 1
        return tokens[pos[0] - 1]

    def truthy(v):
        return v not in (None, False, 0, "")

    def eq(a, b):
        if isinstance(a, str) and isinstance(b, str):
            return a.lower() == b.lower()
        if isinstance(a, bool) or isinstance(b, bool):
            return str(a).lower() == str(b).lower()
        return a == b

    def primary():
        t = take()
        if t == "(":
            v = or_()
            assert take() == ")"
            return v
        if t == "!":
            return not truthy(primary())
        if t.startswith("'"):
            return t[1:-1].replace("''", "'")
        if peek() == "(":
            take()
            args = []
            while peek() != ")":
                args.append(or_())
                if peek() == ",":
                    take()
            take()
            return ctx["functions"][t](*args)
        if t in ("true", "false"):
            return t == "true"
        value = ctx
        for part in t.split("."):
            value = value.get(part) if isinstance(value, dict) else None
        return value

    def cmp_():
        v = primary()
        while peek() in ("==", "!="):
            op, w = take(), primary()
            v = eq(v, w) if op == "==" else not eq(v, w)
        return v

    def and_():
        v = cmp_()
        while peek() == "&&":
            take()
            w = cmp_()
            v = w if truthy(v) else v
        return v

    def or_():
        v = and_()
        while peek() == "||":
            take()
            w = and_()
            v = v if truthy(v) else w
        return v

    out = or_()
    assert pos[0] == len(tokens), f"left over in {text!r}"
    return out


def plan(flow: dict, job: str, event: str = "workflow_dispatch", inputs: dict = None,
         actor: str = "MichaelJSr", outcomes: dict = None, outputs: dict = None, needs: dict = None) -> dict:
    """{step id or name: outcome} of one job's run: a step that runs gets its outcome from outcomes (default success)."""
    inputs = dict(inputs or {})
    outcomes, outputs = outcomes or {}, outputs or {}
    github = {"event_name": event, "actor": actor}
    env: dict = {}
    ctx = {"github": github, "inputs": inputs, "vars": {}, "secrets": {}, "steps": {}, "env": env, "needs": needs or {},
           "functions": {"toJSON": json.dumps}}
    for layer in (flow["env"], flow["jobs"][job]["env"]):
        for key, value in layer.items():
            whole = value.startswith("${{") and value.endswith("}}") and value.count("${{") == 1
            env[key] = evaluate(value, ctx) if whole else value
    failed = [False]
    ctx["functions"].update(success=lambda: not failed[0], failure=lambda: failed[0], always=lambda: True,
                            cancelled=lambda: False)
    ran = {}
    for s in flow["jobs"][job]["steps"]:
        key = s.get("id") or s.get("name") or s.get("uses")
        cond = s.get("if", "")
        if cond and not any(f in cond for f in STATUS):
            cond = f"success() && ({cond[3:-2] if cond.startswith('${{') else cond})"
        go = bool(evaluate(cond, ctx)) if cond else not failed[0]
        outcome = outcomes.get(key, "success") if go else "skipped"
        ctx["steps"][key] = {"outcome": outcome, "conclusion": outcome, "outputs": outputs.get(key, {}) if go else {}}
        if go:
            env.update(outputs.get(key, {}).get("GITHUB_ENV") or {})     # a step's `>> "$GITHUB_ENV"`
        if outcome == "failure":
            failed[0] = True
        ran[key] = outcome
    ran["env"] = env
    return ran


def plans(flow: dict) -> None:
    runs = lambda p: {k for k, v in p.items() if v not in ("skipped",) and k != "env"}    # noqa: E731
    go = {"gate": {"go": "true", "main": "a" * 40, "GITHUB_ENV": {"GO": "true"}}}
    check(not {"MAIN_COMMIT", "POSTS"} & set(flow["env"]), "no rollback switches (MAIN_COMMIT, POSTS)")
    data, main, after = (flow["jobs"][j] for j in ("data", "main", "after"))
    check(after["steps"] is data["steps"] and data["env"] == {"AFTER": "", "RECORDS": ""}
          and after["env"] == {"AFTER": "${{ needs.main.outputs.baked == 'true' && needs.main.outputs.m || '' }}", "RECORDS": "true"},
          "after: the data lane's steps, with AFTER the bake's M (when it landed) and its records")

    # The data lane
    p = plan(flow, "data", inputs={"dry_run": True}, outputs=go)
    check(p["env"]["DRY_RUN"] == "true" and {"build", "posts"} <= runs(p) and not {"data-commit", "Site build", "Send the posts"} & runs(p),
          "data, dry dispatch: build and posts; nothing committed, sent or dispatched")
    p = plan(flow, "data", event="push", outputs={**go, "data-commit": {"committed": "true"}})
    check({"venv", "fonts", "build", "posts", "Send the posts", "data-commit", "Site build"} <= runs(p),
          "data, a push at once: build, posts, data commit, site build")
    p = plan(flow, "data", event="schedule", outputs=go, outcomes={"build": "failure"})
    check(not {"Send the posts", "data-commit"} & runs(p) and "Tell Discord" in runs(p),
          "data, build failed: no posts, no data commit; Discord told")
    p = plan(flow, "data", event="schedule", outputs={"gate": {"go": "false", "GITHUB_ENV": {"GO": "false"}}})
    check(not {"venv", "build", "posts", "data-commit", "Site build"} & runs(p), "data, nothing to do: the job ends at the gate")
    p = plan(flow, "after", event="push", outputs=go, needs={"main": {"outputs": {"m": "m" * 40, "baked": "true"}}})
    check(p["env"]["AFTER"] == "m" * 40 and {"records-in", "build", "Send the posts", "data-commit", "Site build"} <= runs(p),
          "after: the data lane on M with the bake's records; the site build follows the bake even with db/ unchanged")
    p = plan(flow, "after", event="push", outputs=go, needs={"main": {"outputs": {"m": "", "records": "true"}}})
    check(p["env"]["AFTER"] == "" and {"records-in", "build"} <= runs(p) and "Site build" not in runs(p),
          "after, verdicts only: the records merged, no site build unless the data commit lands")
    p = plan(flow, "data", event="push", outputs=go)
    check({"records-in", "Guard events"} <= runs(p), "data: unmerged bake records and the guards' events looked up")
    p = plan(flow, "data", inputs={"dry_run": True}, outputs=go, outcomes={"build": "failure"})
    q = plan(flow, "data", inputs={"dry_run": False}, outputs=go, outcomes={"build": "failure"})
    check("Tell Discord" not in runs(p) and "Tell Discord" in runs(q), "data, a failed dispatch: a live one alerts, a dry one doesn't")

    # The main lane
    baked = {**go, "bake": {"baked": "true", "b": "b" * 40}, "save": {"changed": "true"}}
    p = plan(flow, "main", inputs={"dry_run": True, "bake": "all"}, outputs=baked)
    check({"bake", "save"} <= runs(p) and not {"main", "repin"} & runs(p), "main, dry dispatch: bake (dry) and save; no M")
    p = plan(flow, "main", inputs={"dry_run": False, "bake": "none"}, outputs={**go, "save": {"changed": "true"}})
    check("bake" not in runs(p) and {"save", "main"} <= runs(p), "main, bake=none: no bake; the save and M")
    p = plan(flow, "main", event="push", outputs={**baked, "main": {"pushed": "true", "pngs": "true"}})
    check({"venv", "fonts", "bake", "save", "main", "repin"} <= runs(p) and "Site build" not in runs(p),
          "main, after a push's window: bake, save, M, the baked PNGs re-pinned (the site follows the after job)")
    p = plan(flow, "main", event="schedule", outputs={**baked, "main": {"pushed": "true", "pngs": "false"}})
    check("main" in runs(p) and "repin" not in runs(p), "main, M without PNGs: nothing to re-pin")
    p = plan(flow, "main", event="schedule", outputs={**baked, "main": {"rejected": "true"}})
    check("main" in runs(p) and "repin" not in runs(p), "main moved: M dropped, no re-pin")
    p = plan(flow, "main", event="schedule", outputs=baked, outcomes={"main": "failure"})
    check("repin" not in runs(p) and "Tell Discord" in runs(p), "main, M failed (too late): no re-pin; Discord told")
    p = plan(flow, "main", event="schedule", outputs=baked, outcomes={"bake": "failure"})
    check({"save", "main"} <= runs(p), "main, a card's bake error: the save and M go on with the other cards (B kept)")
    edits = {"gate": {"go": "false", "edits": "true", "main": "a" * 40, "GITHUB_ENV": {"GO": "false", "EDITS": "true"}}}
    p = plan(flow, "main", event="schedule", outputs={**edits, "edits": {"GITHUB_ENV": {"GO": "true"}}, "bake": baked["bake"],
                                                      "save": {"changed": "true"}, "main": {"pushed": "true"}})
    check({"venv", "edits", "bake", "save", "main"} <= runs(p),
          "main, a put-off website edit past its grace (Pending edits sets GO): bake, save, M")
    p = plan(flow, "main", event="schedule", outputs=edits)
    check({"venv", "edits"} <= runs(p) and not {"bake", "save", "main"} & runs(p),
          "main, website edits still in their grace: the Python environment and Pending edits only")
    p = plan(flow, "main", event="schedule", outputs={"gate": {"go": "false", "edits": "false", "GITHUB_ENV": {"GO": "false", "EDITS": "false"}}})
    check(not {"venv", "edits", "bake", "save"} & runs(p), "main, nothing to do: the job ends at the gate")
    retry = {"dry_run": False, "bake": "all", "force": True, "retry": "schedule"}
    p = plan(flow, "main", inputs=retry, actor="github-actions[bot]", outputs=go, outcomes={"save": "failure"})
    q = plan(flow, "main", inputs=retry, actor="MichaelJSr", outputs=go, outcomes={"save": "failure"})
    check("Tell Discord" in runs(p) and "Tell Discord" in runs(q), "main, a failed retry tells Discord, whoever dispatched it")

    names = [evaluate(flow["run_name"], {"github": {"event_name": e}, "inputs": i, "functions": {}})
             for e, i in (("workflow_dispatch", {"dry_run": True}), ("workflow_dispatch", {"dry_run": False}), ("schedule", {}),
                          ("workflow_dispatch", {"dry_run": False, "retry": "schedule"}))
             if "run_name" in flow] or ["no run-name"]
    tells = [step(flow["jobs"][j], "Tell Discord")["run"] for j in ("data", "main")]
    check(names == ["Card sync (dry run)", "Card sync", "Card sync", "Card sync (retry)"] and tells[0] is tells[1]
          and f'\\"{names[0]}\\"' in tells[0] and "actions/runs/$GITHUB_RUN_ID/jobs" in tells[0],
          f"run names {names}: one alert script (once a run) whose streak leaves out the dry runs by that name")
    late = re.search(r"late=\$\(\( \((\d+) - (\d+)\) \* 60 \)\)", step(main, "main")["run"])
    rest = main["steps"][main["steps"].index(step(main, "main")):]
    caps = [int(s.get("timeout-minutes", "0")) for s in rest]
    check(bool(late) and int(late.group(1)) == main["timeout"] and all(caps) and int(late.group(2)) >= sum(caps),
          f"Commit main's deadline: the job's timeout ({late and late.group(1)} == {main['timeout']}) less "
          f"{late and late.group(2)} minutes, at least the caps of it and every later step ({' + '.join(map(str, caps))})")


# ---------- Sandboxes ----------
def git(cwd: str, *args, env: dict = None, check_: bool = True) -> str:
    e = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
         "GIT_COMMITTER_EMAIL": "t@t", **(env or {})}
    return subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, env=e, check=check_).stdout.strip()


def write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def commit(work: str, files: dict, message: str = "c", author: str = "t") -> str:
    for path, text in files.items():
        write(os.path.join(work, path), text)
    git(work, "add", "--", *files)
    git(work, "commit", "-qm", message, env={"GIT_AUTHOR_NAME": author})
    return git(work, "rev-parse", "HEAD")


def origin(tmp: str) -> tuple:
    """A source repo shaped like the card repo and a bare origin served blobless: (work, origin.git)."""
    work = os.path.join(tmp, "work")
    os.makedirs(work)
    git(work, "init", "-q", "-b", "main")
    commit(work, {"MDW/Fonts/a.ttf": "font a", "MDW/Fonts/b.otf": "font b", "MDW/Fonts/stoogedings-src/stoogedings.json": "{}",
                  "MDW/Fonts/stoogedings-src/x.svg": "svg", "site/Card Edits.json": "{}", "site/Card Authors.txt": "a",
                  "TTS/Impossibility Simulator.json": "{}", "TTS/decks.json": "{}", "Cards/One.psd": "psd",
                  "Cards/One.png": "png", "site/index.html": "x"}, "init")
    bare = os.path.join(tmp, "origin.git")
    subprocess.run(["git", "clone", "-q", "--bare", work, bare], check=True)
    git(bare, "config", "uploadpack.allowFilter", "true")
    git(work, "remote", "add", "origin", bare)
    return work, bare


def checkout(tmp: str, bare: str, name: str = "ws") -> str:
    """The workflow's main checkout: blobless, full history, the sparse patterns of its first step."""
    ws = os.path.join(tmp, name)
    subprocess.run(["git", "clone", "-q", "--filter=blob:none", "--no-checkout", f"file://{bare}", ws], check=True)
    git(ws, "sparse-checkout", "set", "--no-cone", "/site/Card Edits.json", "/site/Card Authors.txt",
        "/site/Card Creation Dates.json", "/MDW/Fonts/stoogedings-src/stoogedings.json", "/TTS/")
    git(ws, "checkout", "-q", "main")
    git(ws, "config", "user.name", "t")
    git(ws, "config", "user.email", "t@t")
    return ws


def run_step(job: dict, name: str, cwd: str, env: dict, tmp: str) -> tuple:
    """A step's run: script under bash -e: (exit code, output, $GITHUB_OUTPUT as a dict)."""
    out = os.path.join(tmp, f"output-{time.monotonic_ns()}")
    open(out, "w").close()
    e = {**os.environ, "GITHUB_OUTPUT": out, "GITHUB_ENV": out + ".env", "GITHUB_STEP_SUMMARY": os.path.join(tmp, "summary.md"),
         "GITHUB_WORKSPACE": cwd, "RUNNER_TEMP": os.path.join(tmp, "runner"), "GITHUB_REPOSITORY": "MichaelJSr/TTSCardMaker",
         **env}
    r = subprocess.run(BASH + ["-c", step(job, name)["run"]], cwd=cwd, capture_output=True, text=True, env=e)
    outputs = dict(line.split("=", 1) for line in open(out, encoding="utf-8").read().splitlines() if "=" in line)
    return r.returncode, r.stdout + r.stderr, outputs


def timer_cases(flow: dict) -> None:
    """The timer: which runs look for another timer, wait, or bake; Another timer on faked run lists; Quiet's sleep."""
    jobs = flow["jobs"]
    timer, quiet, main = jobs["timer"], jobs["quiet"], jobs["main"]
    ctx = lambda event, actor="MichaelJSr", attempt="1", inputs=None, **needs: {  # noqa: E731
        "github": {"event_name": event, "actor": actor, "run_attempt": attempt}, "needs": needs, "inputs": inputs or {},
        "functions": {"cancelled": lambda: False}}
    got = [bool(evaluate(jobs["data"]["if"], ctx(e, inputs=i))) for e, i in (("push", None), ("schedule", None),
                                                                              ("workflow_dispatch", {"cards": "X"}),
                                                                              ("workflow_dispatch", {"retry": "push"}))]
    check(got == [True, True, True, False] and "needs" not in jobs["data"] and "environment" not in jobs["data"]
          and jobs["data"]["concurrency"] == jobs["after"]["concurrency"] == {"group": "card-data", "cancel-in-progress": "false"},
          f"data: at once on a push, the schedule and a dispatch, never a retry; one group with after ({got})")
    got = [bool(evaluate(timer["if"], ctx(e, a))) for e, a in (("push", "MichaelJSr"), ("push", "AutoCroissant"),
                                                              ("push", "github-actions[bot]"), ("schedule", "x"),
                                                              ("workflow_dispatch", "x"))]
    check(got == [True, True, False, True, False],
          f"timer: a person's or the bot's push and the schedule look for a running window; dispatches never ({got})")
    t = lambda result, other="": {"result": result, "outputs": {"other": other} if result != "skipped" else {}}  # noqa: E731
    got = [bool(evaluate(quiet["if"], ctx(e, timer=n))) for e, n in (("push", t("success")), ("push", t("success", "41")),
                                                                     ("push", t("failure")), ("push", t("skipped")),
                                                                     ("schedule", t("success")), ("workflow_dispatch", t("skipped")))]
    check(got == [True, False, True, False, False, False],
          f"quiet: a push's run waits unless another window runs (a failed look waits too); nothing else waits ({got})")
    check([evaluate(quiet["environment"], ctx("push", attempt=a)) for a in ("1", "2")] == ["card-sync-quiet", ""]
          and quiet.get("name") == "Quiet window" and "concurrency" not in quiet and "concurrency" not in timer
          and step(timer, "other")["env"]["QUIET"] == quiet["name"] and step(main, "gate")["env"]["LANE"] == main["name"] == LANE,
          "quiet: card-sync-quiet on the first attempt only, in no group; Another timer looks for its name, the main Gate for main's")
    q = lambda result: {"result": result, "outputs": {}}  # noqa: E731
    want = [(("push", t("success"), q("success")), True), (("push", t("failure"), q("failure")), True),
            (("push", t("success", "41"), q("skipped")), False), (("push", t("skipped"), q("skipped")), False),
            (("schedule", t("success"), q("skipped")), True), (("schedule", t("success", "41"), q("skipped")), False),
            (("schedule", t("failure"), q("skipped")), True), (("workflow_dispatch", t("skipped"), q("skipped")), True)]
    got = [bool(evaluate(main["if"], ctx(e, timer=n, quiet=w))) for (e, n, w), _ in want]
    check(got == [w for _, w in want] and main["needs"] == "[timer, quiet]"
          and main["concurrency"] == {"group": "card-main", "cancel-in-progress": "false"},
          f"main: a push's after its window, the schedule's unless a window runs, a dispatch's at once; one group ({got})")
    a = lambda result, baked="", records="": {"result": result, "outputs": {"baked": baked, "records": records}}  # noqa: E731
    got = [bool(evaluate(jobs["after"]["if"], ctx("push", main=n))) for n in (a("success", "true"), a("success", "false"),
                                                                              a("success"), a("skipped"), a("failure", "true"),
                                                                              a("success", "false", "true"))]
    check(got == [True, False, False, False, True, True] and jobs["after"]["needs"] == "main",
          f"after: once M brought the bake's card files (a later failure too) or the bake recorded verdicts, not a save-only M ({got})")

    with tempfile.TemporaryDirectory() as tmp:
        fake = os.path.join(tmp, "bin")
        os.makedirs(os.path.join(tmp, "runner"))
        write(os.path.join(fake, "gh"), "#!/bin/bash\n"      # gh's --jq on canned JSON: the run list, a run's jobs
              'q=""; prev=""; for a in "$@"; do [ "$prev" = --jq ] && q=$a; prev=$a; done\n'
              '[ -n "$FAKE_FAIL" ] && exit 1\n'
              f'if [ "$2" = cancel ]; then echo "$3" > "{os.path.join(tmp, "cancelled")}"; exit; fi\n'
              'if [ "$1" = run ]; then jq -r "$q" <<< "$FAKE_RUNS"; exit; fi\n'
              'id=$(sed -n "s|.*/runs/\\([0-9]*\\)/jobs|\\1|p" <<< "$2"); jq -r "$q" "$FAKE_JOBS/$id.json"\n')
        write(os.path.join(fake, "sleep"), f'#!/bin/bash\necho "$1" > "{os.path.join(tmp, "slept")}"\n')
        for name in ("gh", "sleep"):
            os.chmod(os.path.join(fake, name), 0o755)
        jobs_dir = os.path.join(tmp, "jobs")
        stamp = lambda minutes: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - minutes * 60))  # noqa: E731
        run = lambda rid, status, minutes=5: {"databaseId": rid, "status": status, "createdAt": stamp(minutes)}  # noqa: E731
        write(os.path.join(jobs_dir, "41.json"), json.dumps({"jobs": [{"name": "timer", "status": "completed"},
                                                                      {"name": "Quiet window", "status": "in_progress"}]}))
        write(os.path.join(jobs_dir, "42.json"), json.dumps({"jobs": [{"name": "Quiet window", "status": "completed"},
                                                                      {"name": LANE, "status": "in_progress"}]}))
        cases = [([], "", "no other push run"), ([run(40, "waiting")], "40", "a run waiting on the environment"),
                 ([run(41, "in_progress")], "41", "a run sleeping out its window (no wait timer)"),
                 ([run(42, "in_progress")], "", "a run past its window (baking)"),
                 ([run(99, "waiting")], "", "this run itself"), ([run(43, "waiting", 50)], "", "a window stuck 50 minutes"),
                 ([run(42, "in_progress"), run(40, "waiting")], "40", "the second of two runs")]
        cancelled = os.path.join(tmp, "cancelled")
        env = {}
        for runs, want, what in cases:
            env = {"PATH": f"{fake}:{os.environ['PATH']}", "FAKE_RUNS": json.dumps(runs), "FAKE_JOBS": jobs_dir, "GITHUB_RUN_ID": "99",
                   "GITHUB_EVENT_NAME": "push", "GITHUB_SERVER_URL": "https://github.com", "GH_TOKEN": "x",
                   "QUIET": "Quiet window"}
            code, text, out = run_step(timer, "other", tmp, env, tmp)
            check(code == 0 and out.get("run", "") == want and not os.path.exists(cancelled),
                  f"Another timer: {what} -> {out.get('run') or 'none'} (the run goes on: its data lane)"
                  + ("" if code == 0 else f"\n{text}"))
        code, text, out = run_step(timer, "other", tmp, {**env, "FAKE_FAIL": "1"}, tmp)
        check(code == 0 and "run" not in out and "were not read" in text, "Another timer: runs not read -> none (this run goes on)")

        now = int(time.time())
        for pushed, low, high, what in ((str(now - 31 * 60), None, None, "past the window (the timer held it)"),
                                        (str(now - 10 * 60), 1190, 1200, "10 minutes ago (no timer)"),
                                        (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - 20 * 60)), 590, 600, "an ISO time"),
                                        ("", 1790, 1800, "no push time")):
            if os.path.exists(os.path.join(tmp, "slept")):
                os.remove(os.path.join(tmp, "slept"))
            code, text, _ = run_step(quiet, "Quiet", tmp, {"PUSHED_AT": pushed, "PATH": f"{fake}:{os.environ['PATH']}"}, tmp)
            slept = int(open(os.path.join(tmp, "slept")).read()) if os.path.exists(os.path.join(tmp, "slept")) else None
            check(code == 0 and (slept is None if low is None else low <= slept <= high),
                  f"quiet: pushed {what} -> sleeps {slept}" + ("" if code == 0 else f"\n{text}"))


def _bot(ws: str) -> None:
    """The builder checkout a gate reads: card_data.py, PARSER_VERSION 2, one commit."""
    write(os.path.join(ws, "bot/commands/card_data.py"), "")
    write(os.path.join(ws, "bot/commands/psd_parser.py"), "PARSER_VERSION = 2\n")
    subprocess.run(["git", "init", "-q", os.path.join(ws, "bot")], check=True)
    git(os.path.join(ws, "bot"), "commit", "-q", "--allow-empty", "-m", "bot")


DATA_GATE = {"DRY_RUN": "false", "BUILDER_REF": "main", "BOT_REPO": "bobberlington/AutoCroissant",
             "GIT_NO_LAZY_FETCH": "1", "FORCE": "false", "FULL": "false", "CARDS": "", "RESTORE": "", "AFTER": "", "RECORDS": ""}


def gate_cases(flow: dict) -> None:
    data, main = flow["jobs"]["data"], flow["jobs"]["main"]
    with tempfile.TemporaryDirectory() as tmp:
        work, bare = origin(tmp)
        os.makedirs(os.path.join(tmp, "runner"))
        cases = [  # (files, message, author, expected go)
            ({"MDW/Fonts/stoogedings-src/x.svg": "svg 2"}, "icon source", "t", False),
            ({"site/index.html": "y"}, "site code", "t", False),
            ({"TTS/Impossibility Simulator.json": '{"a":2}'}, "TTS save by hand", "t", False),
            ({"MDW/Fonts/c.ttf": "font c"}, "a font", "t", True),
            ({"MDW/Fonts/stoogedings-src/stoogedings.json": '{"x":1}'}, "the icon manifest", "t", True),
            ({"Deep/Two/Card.PSD": "psd", "Deep/Two/Card.PNG": "png"}, "an upper-case card", "t", True),
            ({"site/Card Creation Dates.json": '{"cards":{}}'}, "creation dates", "t", True),
        ]
        for files, message, author, want in cases:
            base = git(work, "rev-parse", "HEAD")
            commit(work, files, message, author)
            git(work, "push", "-q", "origin", "main")
            ws = checkout(tmp, bare, f"ws-{time.monotonic_ns()}")
            _bot(ws)
            write(os.path.join(ws, "carddata/db/manifest.json"), json.dumps(
                {"card_commit": base, "builder": {"parser_version": 2}, "pending": {"stale": [], "repin": ["x.png"]}}))
            code, text, out = run_step(data, "gate", ws, DATA_GATE, tmp)
            check(code == 0 and out.get("go") == str(want).lower(),
                  f"data gate: {message} -> go={out.get('go')} (want {str(want).lower()})" + ("" if code == 0 else f"\n{text}"))
            if message == "icon source":
                code, text, out = run_step(data, "gate", ws, {**DATA_GATE, "AFTER": "f" * 40, "RECORDS": "true"}, tmp)
                check(code == 0 and out.get("go") == "true" and "the bake's main commit ffffffff" in text,
                      "data gate: after the bake (AFTER) -> go, nothing else changed" + ("" if code == 0 else f"\n{text}"))
                write(os.path.join(tmp, "runner", "records-in", "verdicts.json"), '{"schema":1,"cards":{"x":{"state":"refused"}}}')
                code, text, out = run_step(data, "gate", ws, {**DATA_GATE, "RECORDS": "true"}, tmp)
                shutil.rmtree(os.path.join(tmp, "runner", "records-in"))
                check(code == 0 and out.get("go") == "true" and "the bake's records: 1 verdicts, 0 events" in text,
                      "data gate: after a bake that only recorded a verdict -> go" + ("" if code == 0 else f"\n{text}"))
                inputs = {"FULL": "true", "CARDS": "X", "RESTORE": "r" * 40}
                code, text, out = run_step(data, "gate", ws, {**DATA_GATE, **inputs}, tmp)
                check(code == 0 and out.get("go") == "true" and text.count("dispatched with") == 3,
                      "data gate: a dispatch's full, cards and restore -> go" + ("" if code == 0 else f"\n{text}"))
                code, text, out = run_step(data, "gate", ws, {**DATA_GATE, **inputs, "AFTER": "f" * 40, "RECORDS": "true"}, tmp)
                check(code == 0 and "dispatched with" not in text,
                      "data gate: after the bake on a dispatch -> its inputs left out" + ("" if code == 0 else f"\n{text}"))

        # The main lane's gate: the cursor is the head of the last run whose Bake and save succeeded
        fake = os.path.join(tmp, "bin")
        write(os.path.join(fake, "gh"), "#!/bin/bash\n"
              'q=""; prev=""; for a in "$@"; do [ "$prev" = --jq ] && q=$a; prev=$a; done\n'
              '[ -n "$FAKE_FAIL" ] && exit 1\n'
              'if [ "$1" = run ]; then jq -r "$q" <<< "$FAKE_RUNS"; exit; fi\n'
              'id=$(sed -n "s|.*/runs/\\([0-9]*\\)/jobs|\\1|p" <<< "$2"); jq -r "$q" "$FAKE_JOBS/$id.json"\n')
        os.chmod(os.path.join(fake, "gh"), 0o755)
        jobs_dir = os.path.join(tmp, "jobs")
        write(os.path.join(jobs_dir, "7.json"), json.dumps({"jobs": [{"name": "Card data", "conclusion": "success"},
                                                                     {"name": LANE, "conclusion": "skipped"}]}))
        write(os.path.join(jobs_dir, "6.json"), json.dumps({"jobs": [{"name": LANE, "conclusion": "success"}]}))
        write(os.path.join(jobs_dir, "8.json"), json.dumps({"jobs": [{"name": LANE, "conclusion": "success"}]}))
        write(os.path.join(jobs_dir, "5.json"), json.dumps({"jobs": [{"name": LANE, "conclusion": "failure"}]}))
        before = git(work, "rev-parse", "HEAD")
        commit(work, {"Cards/Two.psd": "psd 2"}, "a card", "bob")
        commit(work, {"TTS/Impossibility Simulator.json": '{"a":3}'}, "Card sync: TTS save updated", "AutoCroissant")
        git(work, "push", "-q", "origin", "main")
        head = git(work, "rev-parse", "HEAD")
        ws = checkout(tmp, bare, "ws-main")
        _bot(ws)
        env = {"PATH": f"{fake}:{os.environ['PATH']}", "FAKE_JOBS": jobs_dir, "GH_TOKEN": "x", "GIT_NO_LAZY_FETCH": "1",
               "LANE": LANE, "RETRY": "", "DRY_RUN": "false"}
        listed = lambda *pairs, dry=(): json.dumps([{"databaseId": i, "headSha": s,  # noqa: E731
                                                      "displayTitle": "Card sync (dry run)" if i in dry else "Card sync"}
                                                     for i, s in pairs])
        for event, runs, fail, want, what in (
                ("push", "[]", "", "true", "a push: its window is up"),
                ("workflow_dispatch", "[]", "", "true", "a dispatch"),
                ("schedule", listed((7, head), (6, before), (5, head)), "", "true", "a card commit since the last Bake and save"),
                ("schedule", listed((7, before), (6, head)), "", "false", "only the lane's own commit since (skipped runs passed over)"),
                ("schedule", listed((5, head)), "", "true", "no Bake and save succeeded in the last runs"),
                ("schedule", listed((8, head), (6, before), dry=(8,)), "", "true", "a dry run's Bake and save passed over"),
                ("schedule", "[]", "1", "true", "the runs not read")):
            code, text, out = run_step(main, "gate", ws, {**env, "GITHUB_EVENT_NAME": event, "FAKE_RUNS": runs, "FAKE_FAIL": fail}, tmp)
            check(code == 0 and out.get("go") == want and out.get("main") == head,
                  f"main gate: {what} -> go={out.get('go')} (want {want})" + ("" if code == 0 else f"\n{text}"))
        commit(work, {"site/Card Edits.json": '{"cards":{"X":{"hp":1,"_by":"web"},"Y":{"series":"s"}}}'}, "Card sync: edit verdicts",
               "AutoCroissant")
        git(work, "push", "-q", "origin", "main")
        ws = checkout(tmp, bare, "ws-edits")
        _bot(ws)
        code, text, out = run_step(main, "gate", ws, {**env, "GITHUB_EVENT_NAME": "schedule", "FAKE_RUNS": listed((6, head))}, tmp)
        check(code == 0 and out.get("go") == "false" and out.get("edits") == "true",
              f"main gate: nothing changed, a PSD-kind edit in the file -> go={out.get('go')} edits={out.get('edits')} (want false, true)"
              + ("" if code == 0 else f"\n{text}"))


def fonts_cases(flow: dict) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work, bare = origin(tmp)
        os.makedirs(os.path.join(tmp, "runner"))
        for with_step in (True, False):
            ws = checkout(tmp, bare, f"ws-{with_step}")
            if with_step:
                code, text, _ = run_step(flow["jobs"]["main"], "fonts", ws, {}, tmp)
                if code:
                    check(False, f"the Fonts tree step ran\n{text}")
            for name in ("a.ttf", "b.otf"):                     # the cache hit: actions/cache untars MDW/Fonts
                shutil.copy(os.path.join(work, "MDW/Fonts", name), os.path.join(ws, "MDW/Fonts", name))
            git(ws, "status", "--porcelain")                     # any index refresh (the bake's own git calls)
            head = git(ws, "rev-parse", "HEAD")                  # local_commit: a commit on head, then merge --ff-only
            blob = subprocess.run(["git", "-C", ws, "hash-object", "-w", "--stdin"], input="baked", capture_output=True,
                                  text=True, check=True).stdout.strip()
            index = os.path.join(tmp, f"index-{with_step}")
            git(ws, "read-tree", head, env={"GIT_INDEX_FILE": index})
            git(ws, "update-index", "--add", "--cacheinfo", f"100644,{blob},Cards/One.psd", env={"GIT_INDEX_FILE": index})
            tree = git(ws, "write-tree", "--missing-ok", env={"GIT_INDEX_FILE": index})
            b = git(ws, "commit-tree", tree, "-p", head, "-m", "bake")
            git(ws, "merge", "--ff-only", "-q", b, env={"GIT_NO_LAZY_FETCH": "1"})
            kept = all(os.path.isfile(os.path.join(ws, "MDW/Fonts", n)) for n in ("a.ttf", "b.otf"))
            if with_step:
                check(kept and git(ws, "rev-parse", "HEAD") == b, "fonts: a cache hit's fonts survive the bake's ff merge")
            else:
                check(not kept, "fonts (control): without the Fonts tree step's config the ff merge deletes them")


def bake_cases(flow: dict) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work, bare = origin(tmp)
        ws = checkout(tmp, bare)
        runner = os.path.join(tmp, "runner")
        python = os.path.join(runner, "venv", "bin", "python")
        write(python, f'#!/bin/bash\nprintf "%s\\n" "$@" > "{os.path.join(tmp, "bake.args")}"\n')
        os.chmod(python, 0o755)
        os.makedirs(os.path.join(ws, "bot"))
        main = git(ws, "rev-parse", "HEAD")
        for event, retry, want, card in (("schedule", "", True, "all"), ("workflow_dispatch", "schedule", True, "all"),
                                         ("push", "", True, ""), ("workflow_dispatch", "push", True, "all"),
                                         ("workflow_dispatch", "workflow_dispatch", False, "all"), ("workflow_dispatch", "", False, "all"),
                                         ("workflow_dispatch", "", True, "pending")):
            code, text, out = run_step(flow["jobs"]["main"], "bake", os.path.join(ws, "bot"),
                                       {"GITHUB_WORKSPACE": ws, "MAIN": main, "CARD": card, "RETRY_OF": retry,
                                        "GITHUB_EVENT_NAME": event, "DRY_RUN": "true"}, tmp)
            args = open(os.path.join(tmp, "bake.args")).read().split("\n")
            check(code == 0 and ("--pending" in args) == want and "--card" not in args and "baked" not in out,
                  f"bake: {event}{' retry of ' + retry if retry else ''} bake={card} -> --pending {'yes' if want else 'no'}"
                  + ("" if code == 0 else f"\n{text}"))
        for has in (False, True):                       # the data's verdicts, for a builder that reads them
            if has:
                write(os.path.join(ws, "bot", "commands", "card_bake.py"), 'parser.add_argument("--verdicts")\n')
            code, text, out = run_step(flow["jobs"]["main"], "bake", os.path.join(ws, "bot"),
                                       {"GITHUB_WORKSPACE": ws, "MAIN": main, "CARD": "all", "RETRY_OF": "",
                                        "GITHUB_EVENT_NAME": "schedule", "DRY_RUN": "true"}, tmp)
            args = open(os.path.join(tmp, "bake.args")).read().split("\n")
            got = args[args.index("--verdicts") + 1] if "--verdicts" in args else None
            check(code == 0 and got == (os.path.join(ws, "carddata/db/verdicts.json") if has else None),
                  f"bake: --verdicts {got} ({'a builder with' if has else 'an older builder without'} it)" + ("" if code == 0 else f"\n{text}"))


def main_cases(flow: dict) -> None:
    job = flow["jobs"]["main"]
    script_env = {"GIT_NO_LAZY_FETCH": "1", "GH_TOKEN": "x", "GITHUB_EVENT_NAME": "workflow_dispatch"}

    def setup(tmp: str, name: str) -> tuple:
        work, bare = origin(os.path.join(tmp, name))
        ws = checkout(os.path.join(tmp, name), bare)
        runner = os.path.join(tmp, name, "runner")
        os.makedirs(os.path.join(runner, "venv", "bin"))
        fake = os.path.join(tmp, name, "bin")
        os.makedirs(fake)
        write(os.path.join(fake, "gh"), "#!/bin/bash\n"           # run list: the number pending (gh applies --jq)
              f'if [ "$1" = run ]; then echo "${{FAKE_WAITING:-0}}"; exit 0; fi\n'
              f'printf "%s\\n" "$@" > "{os.path.join(tmp, name, "gh.args")}"\n')
        os.chmod(os.path.join(fake, "gh"), 0o755)
        subprocess.run(["git", "init", "-q", os.path.join(ws, "bot")], check=True)
        git(os.path.join(ws, "bot"), "commit", "-q", "--allow-empty", "-m", "builder")
        main = git(ws, "rev-parse", "HEAD")
        write(os.path.join(ws, "TTS/Impossibility Simulator.json"), '{"saved":1}')       # the save stage's change
        env = {**script_env, "MAIN": main, "START": str(int(time.time())), "SAVED": "true", "RETRY": "false",
               "INPUTS": "null", "PATH": f"{fake}:{os.environ['PATH']}"}
        return ws, bare, main, env, os.path.join(tmp, name)

    def moved(bare: str) -> None:
        tip = git(bare, "rev-parse", "main")
        other = git(bare, "commit-tree", f"{tip}^{{tree}}", "-p", tip, "-m", "another writer")
        git(bare, "update-ref", "refs/heads/main", other)

    def gh_args(root: str) -> list:
        path = os.path.join(root, "gh.args")
        return open(path).read().split("\n")[:-1] if os.path.exists(path) else []

    def bake(ws: str) -> str:
        """B on main's head: a verdict, a PSD and its PNG (outside the sparse patterns, as the bake writes them)."""
        files = {"site/Card Edits.json": '{"verdict":1}', "Cards/One.psd": "baked", "Cards/One.png": "baked"}
        for path, text in files.items():
            write(os.path.join(ws, path), text)
        git(ws, "add", "--sparse", "--", *files)
        git(ws, "commit", "-qm", "bake")
        return git(ws, "rev-parse", "HEAD")

    with tempfile.TemporaryDirectory() as tmp:
        ws, bare, main, env, root = setup(tmp, "save-only")
        code, text, out = run_step(job, "main", ws, env, root)
        m = git(bare, "rev-parse", "main")
        check(code == 0 and out.get("pushed") == "true" and out.get("m") == m != main and out.get("baked") == "false"
              and out.get("pngs") == "false" and git(bare, "log", "-1", "--format=%an|%s", "main") == "AutoCroissant|Card sync: TTS save updated",
              "main: a save-only M is pushed (no after job, nothing to re-pin)" + ("" if code == 0 else f"\n{text}"))

        ws, bare, main, env, root = setup(tmp, "baked")
        env["B"] = bake(ws)
        code, text, out = run_step(job, "main", ws, env, root)
        m = git(bare, "rev-parse", "main")
        check(code == 0 and out.get("m") == m and out.get("baked") == "true" and out.get("pngs") == "true"
              and git(bare, "rev-parse", "main^") == main and git(bare, "log", "-1", "--format=%s", "main").startswith("Card sync: 1 card baked, TTS save updated"),
              "main: B plus the save as one M on main's head (the after job re-reads it; its PNG to re-pin)"
              + ("" if code == 0 else f"\n{text}"))

        ws, bare, main, env, root = setup(tmp, "push-landed")
        real = shutil.which("git")
        write(os.path.join(root, "bin", "git"), f'#!/bin/bash\n"{real}" "$@"; code=$?\n[ "$1" = push ] && exit 1\nexit $code\n')
        os.chmod(os.path.join(root, "bin", "git"), 0o755)
        code, text, out = run_step(job, "main", ws, env, root)
        m = git(bare, "rev-parse", "main")
        check(code == 0 and m != main and out.get("pushed") == "true" and out.get("m") == m and "rejected" not in out
              and not gh_args(root), "main: a push that failed on the client but landed counts as pushed (no retry)"
              + ("" if code == 0 else f"\n{text}"))

        ws, bare, main, env, root = setup(tmp, "save-only-moved")
        moved(bare)
        env["INPUTS"] = json.dumps({"dry_run": False, "full": True, "cards": "Mini Doomer", "bake": "Mini Doomer",
                                    "force": False, "allow_archive": True, "restore": "", "builder_ref": "", "retry": ""})
        code, text, out = run_step(job, "main", ws, env, root)
        args = gh_args(root)
        check(code == 0 and out.get("rejected") == "true" and "pushed" not in out and "m" not in out
              and args[:3] == ["workflow", "run", "card-sync.yml"]
              and {"dry_run=false", "force=true", "bake=Mini Doomer", "retry=workflow_dispatch"} <= set(args)
              and f"builder_ref={git(os.path.join(ws, 'bot'), 'rev-parse', 'HEAD')}" in args
              and not any(a.startswith(("full=", "allow_archive=", "restore=", "cards=")) for a in args),
              f"main moved: M dropped, one retry of the main lane dispatched, no data inputs ({' '.join(args[3:])})"
              + ("" if code == 0 else f"\n{text}"))

        ws, bare, main, env, root = setup(tmp, "baked-moved")
        env["B"] = bake(ws)
        moved(bare)
        env["GITHUB_EVENT_NAME"] = "schedule"
        code, text, out = run_step(job, "main", ws, env, root)
        args = gh_args(root)
        check(code == 0 and out.get("rejected") == "true" and "baked" not in out and {"bake=all", "retry=schedule", "force=true"} <= set(args),
              f"main moved after a scheduled bake: no after job; the retry is marked as the schedule's ({' '.join(args[3:])})"
              + ("" if code == 0 else f"\n{text}"))

        ws, bare, main, env, root = setup(tmp, "bake-unreported")
        bake(ws)                                                                  # B made, b= never written
        code, text, out = run_step(job, "main", ws, env, root)
        check(code == 1 and git(bare, "rev-parse", "main") == main and "pushed" not in out and not gh_args(root),
              "main: HEAD is a B the bake never reported: nothing pushed (red)")

        ws, bare, main, env, root = setup(tmp, "pending-moved")
        moved(bare)
        env["FAKE_WAITING"] = "1"
        code, text, out = run_step(job, "main", ws, env, root)
        check(code == 0 and out.get("rejected") == "true" and not gh_args(root) and "does the work" in text,
              "main moved with another run unfinished (a push's waiting, a pending one): no retry")

        ws, bare, main, env, root = setup(tmp, "retry-moved")
        moved(bare)
        env["RETRY"] = "true"
        code, text, out = run_step(job, "main", ws, env, root)
        check(code == 0 and out.get("rejected") == "true" and not gh_args(root),
              "main moved during a retry: a warning, no further run")

        ws, bare, main, env, root = setup(tmp, "late")
        env["START"] = str(int(time.time()) - 61 * 60)
        code, text, out = run_step(job, "main", ws, env, root)
        check(code == 1 and git(bare, "rev-parse", "main") == main and "pushed" not in out,
              "main: 61 minutes into the lane, M is not pushed (red)")

        # Re-pin: the save again on M (a fake tts_save that writes the given save), a second commit on M
        for name, saved, move, want in (("repin", '{"saved":2}', False, "pushed"), ("repin-current", None, False, "current"),
                                        ("repin-moved", '{"saved":2}', True, "moved")):
            ws, bare, main, env, root = setup(tmp, name)
            env["B"] = bake(ws)
            code, text, out = run_step(job, "main", ws, env, root)
            m = out.get("m", "")
            python = os.path.join(root, "runner", "venv", "bin", "python")
            write(python, "#!/bin/bash\n" + (f"printf '%s' '{saved}' > \"$3\"\n" if saved else "") + 'echo "args: $*"\n')
            os.chmod(python, 0o755)
            if move:
                moved(bare)
            tip = git(bare, "rev-parse", "main")
            code, text, out = run_step(job, "repin", os.path.join(ws, "bot"), {"GITHUB_WORKSPACE": ws, "M": m,
                                                                               "GIT_NO_LAZY_FETCH": "1"}, root)
            now = git(bare, "rev-parse", "main")
            if want == "pushed":
                ok = (out.get("pushed") == "true" and git(bare, "rev-parse", "main^") == m
                      and git(bare, "diff", "--name-only", m, "main") == "TTS/Impossibility Simulator.json"
                      and git(bare, "log", "-1", "--format=%an|%s", "main") == "AutoCroissant|Card sync: TTS save re-pinned")
            elif want == "current":
                ok = now == m and "pushed" not in out and "were current" in text
            else:
                ok = now == tip and "pushed" not in out and "main moved since M" in text
            check(code == 0 and ok, f"re-pin: {want} -> main {now[:8]}" + ("" if code == 0 else f"\n{text}"))


def build_cases(flow: dict) -> None:
    """The Build step's arguments (a fake Python): the dispatch's inputs, none after the bake; --own the lane's commits."""
    data = flow["jobs"]["data"]
    with tempfile.TemporaryDirectory() as tmp:
        work, bare = origin(tmp)
        base = git(work, "rev-parse", "HEAD")
        commit(work, {"Cards/One.psd": "psd 2"}, "a card", "bob")
        m = commit(work, {"Cards/One.psd": "baked"}, "Card sync: 1 card baked, TTS save updated", "AutoCroissant")
        r = commit(work, {"TTS/Impossibility Simulator.json": '{"r":1}'}, "Card sync: TTS save re-pinned", "AutoCroissant")
        commit(work, {"site/Card Edits.json": '{"v":2}'}, "Card edits: X", "AutoCroissant")      # the bot's: not the lane's
        commit(work, {"Cards/One.psd": "psd 3"}, "Card sync: by hand", "bob")
        git(work, "push", "-q", "origin", "main")
        ws = checkout(tmp, bare)
        write(os.path.join(ws, "bot", "commands", "card_data.py"), 'add_argument("--verdicts")\n')
        python = os.path.join(tmp, "runner", "venv", "bin", "python")
        write(python, f'#!/bin/bash\nprintf "%s\\n" "$@" > "{os.path.join(tmp, "build.args")}"\n')
        os.chmod(python, 0o755)
        manifest = os.path.join(ws, "carddata/db/manifest.json")
        inputs = {"FULL": "true", "CARDS": "X", "ALLOW_ARCHIVE": "true", "RESTORE": "r" * 40}
        none = {"FULL": "false", "CARDS": "", "ALLOW_ARCHIVE": "false", "RESTORE": ""}
        flags = ("--full", "--cards", "--allow-archive", "--restore")
        records = os.path.join(tmp, "runner", "records-in")
        merged = os.path.join(ws, "carddata/db/bake-records.json")
        for what, extra, has_manifest, want_flags, want_own in (
                ("a dispatch", {**inputs, "AFTER": ""}, True, True, f"{r},{m}"),
                ("after the bake on a dispatch", {**inputs, "AFTER": m, "RECORDS": "true"}, True, False, f"{r},{m}"),
                ("a push, no data yet", {**none, "AFTER": ""}, False, False, None)):
            if extra.get("RECORDS"):
                write(os.path.join(records, "verdicts.json"), "{}")
                write(os.path.join(records, "events.json"), "[]")
                write(os.path.join(records, "listed.json"), '[{"id":"5","run":50},{"id":"7","run":70}]')
                write(os.path.join(records, "ids.json"), '{"7":70}')
                write(merged, '{"merged":{"3":30,"5":50}}')
            elif os.path.isdir(records):
                shutil.rmtree(records)
            if has_manifest:
                write(manifest, json.dumps({"card_commit": base}))
            elif os.path.exists(manifest):
                os.remove(manifest)
            env = {"GITHUB_WORKSPACE": ws, "HEAD_SHA": git(ws, "rev-parse", "HEAD"), "GIT_NO_LAZY_FETCH": "1",
                   "RUN_URL": "u", "BUILDER_REF": "main", **extra}
            code, text, _ = run_step(data, "build", os.path.join(ws, "bot"), env, tmp)
            args = open(os.path.join(tmp, "build.args")).read().split("\n")
            own = args[args.index("--own") + 1] if "--own" in args else None
            passed = {"--verdicts", "--events"} <= set(args)
            if passed:                                  # the merged artifacts: still listed ones kept, these added
                passed = json.load(open(merged)) == {"merged": {"5": 50, "7": 70}}
            check(code == 0 and all((f in args) == want_flags for f in flags) and own == want_own and passed == bool(extra.get("RECORDS")),
                  f"build: {what} -> inputs {'passed' if want_flags else 'left out'}, --own {own}" + ("" if code == 0 else f"\n{text}"))


def tell_cases(flow: dict) -> None:
    """Tell Discord on faked runs and jobs: once per failing streak of its lane, once a lane per run."""
    tell = step(flow["jobs"]["data"], "Tell Discord")
    with tempfile.TemporaryDirectory() as tmp:
        fake = os.path.join(tmp, "bin")
        told = os.path.join(tmp, "told")
        write(os.path.join(fake, "gh"), "#!/bin/bash\n"
              'q=""; prev=""; for a in "$@"; do [ "$prev" = --jq ] && q=$a; prev=$a; done\n'
              'if [ "$1" = run ]; then jq -r "$q" <<< "$FAKE_RUNS"; exit; fi\n'
              'id=$(sed -n "s|.*/runs/\\([0-9]*\\)/jobs|\\1|p" <<< "$2"); jq -r "$q" "$FAKE_JOBS/$id.json"\n')
        write(os.path.join(fake, "curl"), f'#!/bin/bash\ncat > "{told}"\n')
        for name in ("gh", "curl"):
            os.chmod(os.path.join(fake, name), 0o755)
        os.makedirs(os.path.join(tmp, "runner"))
        job = lambda name, conclusion=None: {"name": name, "conclusion": conclusion}  # noqa: E731
        D, A = "Card data", "Card data after the bake"
        cases = [  # (what, this job, this run's jobs, the other runs [(id, jobs, dry)], want told)
            ("main fails after a data-only run, its last main failed", "main", [job(D, "success"), job(LANE)],
             [(7, [job(D, "success"), job(LANE, "skipped")], False), (6, [job(LANE, "failure")], False)], False),
            ("main fails after a data-only run, its last main passed", "main", [job(D, "success"), job(LANE)],
             [(7, [job(D, "success"), job(LANE, "skipped")], False), (6, [job(LANE, "success")], False)], True),
            ("data fails, the last data passed", "data", [job(D), job(LANE)], [(7, [job(D, "success")], False)], True),
            ("after fails once data failed in this run", "after", [job(D, "failure"), job(LANE, "success"), job(A)],
             [(7, [job(D, "success")], False)], False),
            ("main fails once data failed in this run (the other lane)", "main", [job(D, "failure"), job(LANE)],
             [(7, [job(D, "success"), job(LANE, "success")], False)], True),
            ("data fails, a push run in its window failed its data", "data", [job(D), job(LANE)],
             [(10, [job(D, "failure"), job("Quiet window")], False), (7, [job(D, "success")], False)], False),
            ("main fails, a dry run's main passed", "main", [job(D), job(LANE)],
             [(11, [job(LANE, "success")], True), (6, [job(LANE, "failure")], False)], False),
            ("data fails, a replaced data job passed over", "data", [job(D), job(LANE)],
             [(12, [job(D, "cancelled")], False), (6, [job(D, "failure")], False)], False),
            ("data fails, the lane never ran before", "data", [job(D)], [(6, [job(LANE, "failure")], False)], True)]
        for what, this, own, others, want in cases:
            jobs_dir = os.path.join(tmp, f"jobs-{time.monotonic_ns()}")
            write(os.path.join(jobs_dir, "99.json"), json.dumps({"jobs": own}))
            for rid, jobs, _ in others:
                write(os.path.join(jobs_dir, f"{rid}.json"), json.dumps({"jobs": jobs}))
            runs = [{"databaseId": 99, "displayTitle": "Card sync"}] + [
                {"databaseId": rid, "displayTitle": "Card sync (dry run)" if dry else "Card sync"} for rid, _, dry in others]
            if os.path.exists(told):
                os.remove(told)
            env = {"PATH": f"{fake}:{os.environ['PATH']}", "FAKE_RUNS": json.dumps(runs), "FAKE_JOBS": jobs_dir,
                   "GITHUB_RUN_ID": "99", "GITHUB_JOB": this, "GH_TOKEN": "x", "WEBHOOK": "w", "RUN_URL": "https://run/99",
                   "OUTCOMES": "gate=success build=failure bake=failure"}
            code, text, _ = run_step({"steps": [tell]}, "Tell Discord", tmp, env, tmp)
            sent = json.loads(open(told).read())["content"] if os.path.exists(told) else ""
            lane = LANE if this == "main" else D
            check(code == 0 and bool(sent) == want and (not sent or f"({lane}: " in sent),
                  f"tell: {what} -> {'told: ' + sent if sent else 'quiet'}" + ("" if code == 0 else f"\n{text}"))


def records_cases(flow: dict) -> None:
    """Bake records: the refusals always, M's part (its baked events given M) only when M landed; nothing on a dry run."""
    job = flow["jobs"]["main"]
    with tempfile.TemporaryDirectory() as tmp:
        rec = os.path.join(tmp, "runner", "card-bake")
        write(os.path.join(rec, "verdicts.json"), json.dumps({"schema": 1, "cards": {"a": {"state": "refused"}},
                                                               "landed": {"b": {"state": "baked"}, "c": None}}))
        write(os.path.join(rec, "bake-events.json"), json.dumps({"events": [{"kind": "bake-refused", "card": "A"}],
                                                                 "landed": [{"kind": "baked", "card": "B"}]}))
        out = os.path.join(tmp, "runner", "bake-records")
        for landed, dry, want_cards, want_events, want in (
                ("true", "false", {"a": {"state": "refused"}, "b": {"state": "baked"}, "c": None},
                 [{"kind": "bake-refused", "card": "A"}, {"kind": "baked", "card": "B", "commit": "m" * 40}], "true"),
                ("false", "false", {"a": {"state": "refused"}}, [{"kind": "bake-refused", "card": "A"}], "true"),
                ("true", "true", None, None, None)):
            code, text, outputs = run_step(job, "records", tmp, {"LANDED": landed, "M": "m" * 40, "DRY_RUN": dry}, tmp)
            got = json.load(open(os.path.join(out, "verdicts.json"))), json.load(open(os.path.join(out, "events.json")))
            ok = code == 0 and outputs.get("records") == want and (want_cards is None or got == ({"schema": 1, "cards": want_cards}, want_events))
            check(ok, f"bake records: landed={landed} dry={dry} -> records={outputs.get('records')}" + ("" if code == 0 else f"\n{text}"))
        shutil.rmtree(rec)
        code, text, outputs = run_step(job, "records", tmp, {"LANDED": "false", "M": "", "DRY_RUN": "false"}, tmp)
        check(code == 0 and "records" not in outputs and "No bake records." in text, "bake records: none written, none recorded")


def guard_cases(flow: dict) -> None:
    """Guard events: a guards commit's guard-events.json from the run of its Guarded-push (faked gh); a file naming
    another commit is passed over; a commit with none warns."""
    data = flow["jobs"]["data"]
    with tempfile.TemporaryDirectory() as tmp:
        work, bare = origin(tmp)
        base = git(work, "rev-parse", "HEAD")
        push = commit(work, {"Cards/One.psd": "psd 2"}, "a card", "bob")
        g = commit(work, {"Cards/One.png": "png 2"}, f"Card guards: 1 PNG re-exported (push {push[:8]})\n\nCards/One.png: made\n\n"
                   f"Guarded-push: {push}", "AutoCroissant")
        lost = commit(work, {"Cards/One.png": "png 3"}, "Card guards: 1 PNG recompressed (push 00000000)\n\nGuarded-push: " + "0" * 40,
                      "AutoCroissant")
        commit(work, {"Cards/One.png": "png 4"}, "Card guards: by hand", "bob")                  # a person's: not looked up
        git(work, "push", "-q", "origin", "main")
        ws = checkout(tmp, bare)
        write(os.path.join(ws, "carddata/db/manifest.json"), json.dumps({"card_commit": base}))
        arts = os.path.join(tmp, "arts")
        for name, doc in (("1", {"commit": "f" * 40, "events": [{"kind": "guard-png", "card": "Other"}]}),
                          ("2", {"commit": g, "push": push, "events": [{"kind": "guard-png", "card": "One"}]})):
            write(os.path.join(arts, name, "guard-events.json"), json.dumps(doc))
            subprocess.run(["zip", "-q", "-j", os.path.join(arts, f"{name}.zip"), os.path.join(arts, name, "guard-events.json")], check=True)
        fake = os.path.join(tmp, "bin")
        write(os.path.join(fake, "gh"), "#!/bin/bash\n"
              f'case "$2" in\n'
              f'  *runs?head_sha={push}*) printf "11\\n12\\n" ;;\n'
              '  */runs/11/artifacts*) echo 1 ;;\n'
              '  */runs/12/artifacts*) echo 2 ;;\n'
              f'  */artifacts/*/zip) cat "{arts}/$(basename "$(dirname "$2")").zip" ;;\n'
              'esac\n')
        os.chmod(os.path.join(fake, "gh"), 0o755)
        env = {"PATH": f"{fake}:{os.environ['PATH']}", "GH_TOKEN": "x", "GIT_NO_LAZY_FETCH": "1", "MAIN": git(ws, "rev-parse", "HEAD")}
        code, text, _ = run_step(data, "Guard events", ws, env, tmp)
        got = json.load(open(os.path.join(tmp, "runner", "guard-events.json")))
        check(code == 0 and got == [{"commit": g, "push": push, "events": [{"kind": "guard-png", "card": "One"}]}]
              and f"no guard events for the guards commit {lost[:8]}" in text and text.count("no guard events") == 1,
              "guard events: found by the guarded push, the other commit's passed over, a missing one warned" + ("" if code == 0 else f"\n{text}"))


def main():
    for tool in ("git", "bash", "jq"):
        if not shutil.which(tool):
            sys.exit(f"needs {tool}")
    flow = load()
    plans(flow)
    timer_cases(flow)
    gate_cases(flow)
    build_cases(flow)
    tell_cases(flow)
    fonts_cases(flow)
    bake_cases(flow)
    main_cases(flow)
    records_cases(flow)
    guard_cases(flow)
    print(f"{len(FAILED)} failed" if FAILED else "all passed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
