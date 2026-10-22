"""card-sync.yml's switches and step scripts, offline: which steps run, the gate's inputs, the fonts, the main commit.

    python3 card_sync_steps.py            (needs git 2.37 or later, bash and jq; no network)
1. The step plan: every step's `if:` evaluated as GitHub does (&&, ||, !, ==, the status functions, the implicit
   success()) for the migration's runs: step 6 and 7 (MAIN_COMMIT and POSTS off) bake only on a dry run and write only
   `data`; step 8 (both on) bakes, commits M and posts; a rejected M drops the posts and the data; a failed live run
   (a retry too) alerts, a dry one doesn't; the deadline's reserve covers the caps of Commit main and every later step.
2. The Gate step's own script on sandbox history: stoogedings-src/ alone doesn't start a run, MDW/Fonts' fonts,
   stoogedings.json and an upper-case .PSD do, and the run's own save commits don't.
3. The fonts: a cache hit restores them outside the sparse patterns; after the Fonts tree step the bake's fast-forward
   merge (git_commit.local_commit's) keeps them (without it git deletes them: the control).
4. The Bake step's arguments: --pending for a schedule and a schedule's retry, not for a dispatch.
5. Commit main's own script on a sandbox origin: a save-only M names itself in the manifest when the build wrote db/,
   and leaves an unchanged db/ alone; a push that failed but landed counts as pushed; main moved: M is dropped and one
   new run is dispatched (marked retry, the cards, seed and restore carried, never full or allow_archive), none from a
   retry or while a run is pending; past minute 60 nothing is pushed. Exits 1 when a case gets the wrong answer.
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


def check(ok: bool, what: str) -> None:
    print(f"{'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        FAILED.append(what)


# ---------- The workflow file (the subset of YAML it uses) ----------
def _block(lines: list, at: int, indent: int) -> tuple:
    """The literal block after line at (deeper than indent): (text, next line)."""
    body, i = [], at + 1
    while i < len(lines) and (not lines[i].strip() or len(lines[i]) - len(lines[i].lstrip()) > indent):
        body.append(lines[i])
        i += 1
    while body and not body[-1].strip():
        body.pop()
    cut = min(len(x) - len(x.lstrip()) for x in body if x.strip())
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
    while i < len(lines) and (not lines[i].strip() or len(lines[i]) - len(lines[i].lstrip()) > indent):
        x = lines[i].strip()
        if x and not x.startswith("#"):
            key, _, rest = x.partition(":")
            out[key.strip()] = _value(rest)
        i += 1
    return out, i


def load() -> dict:
    lines = open(WORKFLOW, encoding="utf-8").read().split("\n")
    flow = {"steps": []}
    i = 0
    while i < len(lines):
        x = lines[i]
        if x == "env:":
            flow["env"], i = _mapping(lines, i, 0)
            continue
        if x.startswith("run-name:"):
            flow["run_name"] = x.split(":", 1)[1].strip()
        if x.startswith("    timeout-minutes:"):
            flow["timeout"] = int(_value(x.split(":", 1)[1]))
        if x == "    env:":
            flow["job_env"], i = _mapping(lines, i, 4)
            continue
        if x.startswith("      - "):
            step, j = {}, i
            first = True
            while j < len(lines):
                y = lines[j]
                if not first and (y.startswith("      - ") or (y.strip() and len(y) - len(y.lstrip()) < 8)):
                    break
                line = y[8:]
                first = False
                if y.strip() and not y.strip().startswith("#") and (len(y) - len(y.lstrip()) == 8 or y.startswith("      - ")):
                    key, _, rest = line.partition(":")
                    key = key.strip()
                    if rest.strip() == "|":
                        step[key], j = _block(lines, j, 8)
                        continue
                    if rest.strip() == "" and key in ("env", "with"):
                        step[key], j = _mapping(lines, j, 8)
                        continue
                    step[key] = _value(rest)
                j += 1
            flow["steps"].append(step)
            i = j
            continue
        i += 1
    return flow


def step(flow: dict, name: str) -> dict:
    return next(s for s in flow["steps"] if s.get("name") == name or s.get("id") == name)


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


def plan(flow: dict, event: str = "workflow_dispatch", inputs: dict = None, switches: dict = None, actor: str = "MichaelJSr",
         outcomes: dict = None, outputs: dict = None) -> dict:
    """{step id or name: outcome} of one run: a step that runs gets its outcome from outcomes (default success)."""
    inputs = dict(inputs or {})
    outcomes, outputs = outcomes or {}, outputs or {}
    github = {"event_name": event, "actor": actor}
    env = {**flow["env"], **(switches or {})}
    ctx = {"github": github, "inputs": inputs, "vars": {}, "secrets": {}, "steps": {}, "env": env,
           "functions": {"toJSON": json.dumps}}
    for key, value in flow["job_env"].items():
        whole = value.startswith("${{") and value.endswith("}}") and value.count("${{") == 1
        env[key] = evaluate(value, ctx) if whole else value
    failed = [False]
    ctx["functions"].update(success=lambda: not failed[0], failure=lambda: failed[0], always=lambda: True,
                            cancelled=lambda: False)
    ran = {}
    for s in flow["steps"]:
        key = s.get("id") or s.get("name") or s.get("uses")
        cond = s.get("if", "")
        if cond and not any(f in cond for f in STATUS):
            cond = f"success() && ({cond[3:-2] if cond.startswith('${{') else cond})"
        go = bool(evaluate(cond, ctx)) if cond else not failed[0]
        outcome = outcomes.get(key, "success") if go else "skipped"
        ctx["steps"][key] = {"outcome": outcome, "conclusion": outcome, "outputs": outputs.get(key, {}) if go else {}}
        if outcome == "failure":
            failed[0] = True
        ran[key] = outcome
    ran["env"] = env
    return ran


def plans(flow: dict) -> None:
    runs = lambda p: {k for k, v in p.items() if v not in ("skipped",) and k != "env"}    # noqa: E731
    go = {"gate": {"go": "true", "main": "a" * 40}}
    baked = {**go, "bake": {"baked": "true", "b": "b" * 40}, "save": {"changed": "true"}}

    p = plan(flow, inputs={"dry_run": True, "bake": "all"}, outputs=baked)
    check(p["env"]["DRY_RUN"] == "true" and {"bake", "build", "save", "posts"} <= runs(p)
          and not {"main", "data-commit", "Site build", "Send the posts"} & runs(p),
          "step 6, dry dispatch: bake (dry), build, save and posts run; nothing committed or sent")
    p = plan(flow, inputs={"dry_run": False, "bake": "all"}, outputs={**go, "save": {"changed": "true"}})
    check(p["env"]["DRY_RUN"] == "false" and "bake" not in runs(p) and "main" not in runs(p) and "data-commit" in runs(p)
          and "Site build" not in runs(p) and "Send the posts" not in runs(p),
          "step 6, live dispatch (MAIN_COMMIT off): no bake, no M, the data commit only (no site build, no posts)")
    p = plan(flow, event="schedule", outputs={**go, "save": {"changed": "true"}})
    check(p["env"]["DRY_RUN"] == "false" and "bake" not in runs(p) and "main" not in runs(p) and "data-commit" in runs(p),
          "step 7, schedule (MAIN_COMMIT and POSTS off): live, writes only data")
    p = plan(flow, event="schedule", outputs=go, outcomes={"build": "failure"})
    check("Tell Discord" not in runs(p), "step 7, a failed scheduled run: no Discord alert while POSTS is off")
    on = {"MAIN_COMMIT": "on", "POSTS": "on"}
    p = plan(flow, event="schedule", switches=on, outputs={**baked, "main": {"pushed": "true"}, "data-commit": {"committed": "true"}})
    check({"bake", "build", "save", "main", "Send the posts", "data-commit", "Site build"} <= runs(p),
          "step 8, schedule: bake, build, save, M, posts, data, site build")
    p = plan(flow, event="schedule", switches=on, outputs={**baked, "main": {"rejected": "true"}})
    check("main" in runs(p) and not {"Send the posts", "data-commit"} & runs(p),
          "step 8, main moved after a bake: the data (it read B) and the posts are dropped")
    p = plan(flow, event="schedule", switches=on, outputs={**go, "save": {"changed": "true"}, "main": {"rejected": "true"}})
    check("main" in runs(p) and not {"Send the posts", "data-commit"} & runs(p),
          "step 8, main moved, save-only M: the data and the posts are dropped too (card_commit and repin stay)")
    p = plan(flow, event="schedule", switches=on, outputs=baked, outcomes={"build": "failure"})
    check(not {"save", "main", "data-commit"} & runs(p) and "Tell Discord" in runs(p),
          "step 8, build failed after a bake: no save, M or data; Discord told")
    p = plan(flow, event="schedule", switches=on, outputs={**go, "save": {"changed": "true"}}, outcomes={"main": "failure"})
    check("main" in runs(p) and not {"Send the posts", "data-commit"} & runs(p), "step 8, M failed (too late): no posts, no data")
    retry = {"dry_run": False, "bake": "all", "force": True, "retry": "schedule"}
    p = plan(flow, inputs=retry, switches=on, actor="github-actions[bot]", outputs=go, outcomes={"build": "failure"})
    q = plan(flow, inputs=retry, switches=on, actor="MichaelJSr", outputs=go, outcomes={"build": "failure"})
    check("Tell Discord" in runs(p) and "Tell Discord" in runs(q), "step 8, a failed retry tells Discord, whoever dispatched it")
    p = plan(flow, inputs={"dry_run": True, "bake": "all"}, switches=on, outputs=go, outcomes={"build": "failure"})
    q = plan(flow, inputs={"dry_run": False, "bake": "all"}, switches=on, outputs=go, outcomes={"build": "failure"})
    check("Tell Discord" not in runs(p) and "Tell Discord" in runs(q), "step 8, a failed dispatch: a live one alerts, a dry one doesn't")
    names = [evaluate(flow["run_name"], {"github": {"event_name": e}, "inputs": i, "functions": {}})
             for e, i in (("workflow_dispatch", {"dry_run": True}), ("workflow_dispatch", {"dry_run": False}), ("schedule", {}))
             if "run_name" in flow] or ["no run-name"]
    check(names == ["Card sync (dry run)", "Card sync", "Card sync"] and f'\\"{names[0]}\\"' in step(flow, "Tell Discord")["run"],
          f"run names {names}: the alert's streak leaves out the dry runs by that name")
    late = re.search(r"late=\$\(\( \((\d+) - (\d+)\) \* 60 \)\)", step(flow, "main")["run"])
    after = flow["steps"][flow["steps"].index(step(flow, "main")):]
    caps = [int(s.get("timeout-minutes", "0")) for s in after]
    check(bool(late) and int(late.group(1)) == flow["timeout"] and all(caps) and int(late.group(2)) >= sum(caps),
          f"Commit main's deadline: the job's timeout ({late and late.group(1)} == {flow['timeout']}) less "
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
        "/MDW/Fonts/stoogedings-src/stoogedings.json", "/TTS/")
    git(ws, "checkout", "-q", "main")
    git(ws, "config", "user.name", "t")
    git(ws, "config", "user.email", "t@t")
    return ws


def run_step(flow: dict, name: str, cwd: str, env: dict, tmp: str) -> tuple:
    """A step's run: script under bash -e: (exit code, output, $GITHUB_OUTPUT as a dict)."""
    out = os.path.join(tmp, f"output-{time.monotonic_ns()}")
    open(out, "w").close()
    e = {**os.environ, "GITHUB_OUTPUT": out, "GITHUB_STEP_SUMMARY": os.path.join(tmp, "summary.md"),
         "GITHUB_WORKSPACE": cwd, "RUNNER_TEMP": os.path.join(tmp, "runner"), "GITHUB_REPOSITORY": "MichaelJSr/TTSCardMaker",
         **env}
    r = subprocess.run(BASH + ["-c", step(flow, name)["run"]], cwd=cwd, capture_output=True, text=True, env=e)
    outputs = dict(line.split("=", 1) for line in open(out, encoding="utf-8").read().splitlines() if "=" in line)
    return r.returncode, r.stdout + r.stderr, outputs


def gate_cases(flow: dict) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work, bare = origin(tmp)
        os.makedirs(os.path.join(tmp, "runner"))
        cases = [  # (files, message, author, expected go)
            ({"MDW/Fonts/stoogedings-src/x.svg": "svg 2"}, "icon source", "t", False),
            ({"site/index.html": "y"}, "site code", "t", False),
            ({"TTS/Impossibility Simulator.json": '{"a":1}'}, "Card sync: TTS save updated", "AutoCroissant", False),
            ({"TTS/Impossibility Simulator.json": '{"a":2}'}, "TTS save by hand", "t", True),
            ({"MDW/Fonts/c.ttf": "font c"}, "a font", "t", True),
            ({"MDW/Fonts/stoogedings-src/stoogedings.json": '{"x":1}'}, "the icon manifest", "t", True),
            ({"Deep/Two/Card.PSD": "psd", "Deep/Two/Card.PNG": "png"}, "an upper-case card", "t", True),
        ]
        starts = []
        for files, message, author, want in cases:
            base = git(work, "rev-parse", "HEAD")
            commit(work, files, message, author)
            git(work, "push", "-q", "origin", "main")
            ws = checkout(tmp, bare, f"ws-{time.monotonic_ns()}")
            write(os.path.join(ws, "bot/commands/card_data.py"), "")
            write(os.path.join(ws, "bot/commands/psd_parser.py"), "PARSER_VERSION = 2\n")
            subprocess.run(["git", "init", "-q", os.path.join(ws, "bot")], check=True)
            git(os.path.join(ws, "bot"), "commit", "-q", "--allow-empty", "-m", "bot")
            write(os.path.join(ws, "carddata/db/manifest.json"), json.dumps(
                {"card_commit": base, "builder": {"parser_version": 2}, "pending": {"stale": [], "repin": []}}))
            code, text, out = run_step(flow, "gate", ws, {"POSTS": "off", "DRY_RUN": "false", "BUILDER_REF": "main",
                                                          "BOT_REPO": "bobberlington/AutoCroissant", "GIT_NO_LAZY_FETCH": "1",
                                                          "FORCE": "false", "FULL": "false", "CARDS": "", "RESTORE": "",
                                                          "SEED": ""}, tmp)
            check(code == 0 and out.get("go") == str(want).lower(),
                  f"gate: {message} -> go={out.get('go')} (want {str(want).lower()})" + ("" if code == 0 else f"\n{text}"))
            starts.append(out.get("start", ""))
        check(all(x.isdigit() and abs(int(x) - time.time()) < 600 for x in starts), "gate: every run records its start (the deadline's clock)")


def fonts_cases(flow: dict) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work, bare = origin(tmp)
        os.makedirs(os.path.join(tmp, "runner"))
        for with_step in (True, False):
            ws = checkout(tmp, bare, f"ws-{with_step}")
            if with_step:
                code, text, _ = run_step(flow, "fonts", ws, {}, tmp)
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
        python = os.path.join(runner, "baker", "bin", "python")
        write(python, f'#!/bin/bash\nprintf "%s\\n" "$@" > "{os.path.join(tmp, "bake.args")}"\n')
        os.chmod(python, 0o755)
        os.makedirs(os.path.join(ws, "bot"))
        main = git(ws, "rev-parse", "HEAD")
        for event, retry, want in (("schedule", "", True), ("workflow_dispatch", "schedule", True),
                                   ("workflow_dispatch", "workflow_dispatch", False), ("workflow_dispatch", "", False)):
            code, text, out = run_step(flow, "bake", os.path.join(ws, "bot"), {"GITHUB_WORKSPACE": ws, "MAIN": main, "CARD": "all",
                                                                              "RETRY_OF": retry, "GITHUB_EVENT_NAME": event,
                                                                              "DRY_RUN": "true"}, tmp)
            args = open(os.path.join(tmp, "bake.args")).read().split("\n")
            check(code == 0 and ("--pending" in args) == want and "baked" not in out,
                  f"bake: {event}{' retry of ' + retry if retry else ''} -> --pending {'yes' if want else 'no'}"
                  + ("" if code == 0 else f"\n{text}"))


def main_cases(flow: dict) -> None:
    script_env = {"GIT_NO_LAZY_FETCH": "1", "BUILT": "success", "GH_TOKEN": "x", "GITHUB_EVENT_NAME": "workflow_dispatch"}

    def setup(tmp: str, name: str, wrote: bool = True) -> tuple:
        work, bare = origin(os.path.join(tmp, name))
        ws = checkout(os.path.join(tmp, name), bare)
        runner = os.path.join(tmp, name, "runner")
        os.makedirs(os.path.join(runner, "builder", "bin"))
        os.symlink(sys.executable, os.path.join(runner, "builder", "bin", "python"))
        fake = os.path.join(tmp, name, "bin")
        os.makedirs(fake)
        write(os.path.join(fake, "gh"), "#!/bin/bash\n"           # run list: the number pending (gh applies --jq)
              f'if [ "$1" = run ]; then echo "${{FAKE_WAITING:-0}}"; exit 0; fi\n'
              f'printf "%s\\n" "$@" > "{os.path.join(tmp, name, "gh.args")}"\n')
        os.chmod(os.path.join(fake, "gh"), 0o755)
        subprocess.run(["git", "init", "-q", os.path.join(ws, "bot")], check=True)
        git(os.path.join(ws, "bot"), "commit", "-q", "--allow-empty", "-m", "builder")
        main = git(ws, "rev-parse", "HEAD")
        data = os.path.join(ws, "carddata")                       # the data checkout, then this run's build
        manifest = os.path.join(data, "db/manifest.json")
        dump = lambda commit_: json.dumps({"card_commit": commit_, "card_commit_at": 1.0, "main_commit": None,   # noqa: E731
                                           "pending": {"repin": ["Cards/One.png"]}}, indent=1, sort_keys=True) + "\n"
        write(manifest, dump(main if not wrote else "0" * 40))
        subprocess.run(["git", "init", "-q", data], check=True)
        git(data, "add", "-A")
        git(data, "commit", "-qm", "data")
        if wrote:
            write(manifest, dump(main))
        write(os.path.join(runner, "message.txt"), f"Card data: 1 changed (main {main[:8]})\n")
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

    def manifest_of(ws: str) -> dict:
        return json.load(open(os.path.join(ws, "carddata/db/manifest.json")))

    with tempfile.TemporaryDirectory() as tmp:
        ws, bare, main, env, root = setup(tmp, "save-only")
        code, text, out = run_step(flow, "main", ws, env, root)
        m = git(bare, "rev-parse", "main")
        manifest = manifest_of(ws)
        at = float(git(ws, "show", "-s", "--format=%ct", m))
        check(code == 0 and out.get("pushed") == "true" and out.get("m") == m != main
              and (manifest["card_commit"], manifest["main_commit"], manifest["card_commit_at"]) == (m, m, at)
              and m[:8] in open(os.path.join(root, "runner", "message.txt")).read(),
              "main: a save-only M is pushed and the manifest names it (card_commit, main_commit, the message)"
              + ("" if code == 0 else f"\n{text}"))

        ws, bare, main, env, root = setup(tmp, "save-only-unchanged", wrote=False)
        code, text, out = run_step(flow, "main", ws, env, root)
        check(code == 0 and out.get("pushed") == "true" and not git(os.path.join(ws, "carddata"), "status", "--porcelain")
              and "db/ unchanged" in text,
              "main: a save-only M on an unchanged build leaves db/ alone (no data commit)" + ("" if code == 0 else f"\n{text}"))

        ws, bare, main, env, root = setup(tmp, "push-landed")
        real = shutil.which("git")
        write(os.path.join(root, "bin", "git"), f'#!/bin/bash\n"{real}" "$@"; code=$?\n[ "$1" = push ] && exit 1\nexit $code\n')
        os.chmod(os.path.join(root, "bin", "git"), 0o755)
        code, text, out = run_step(flow, "main", ws, env, root)
        m = git(bare, "rev-parse", "main")
        check(code == 0 and m != main and out.get("pushed") == "true" and out.get("m") == m and "rejected" not in out
              and not gh_args(root) and manifest_of(ws)["main_commit"] == m,
              "main: a push that failed on the client but landed counts as pushed (no retry)" + ("" if code == 0 else f"\n{text}"))

        ws, bare, main, env, root = setup(tmp, "save-only-moved")
        moved(bare)
        env["INPUTS"] = json.dumps({"dry_run": False, "full": True, "cards": "Mini Doomer", "seed": "", "bake": "all",
                                    "force": False, "allow_archive": True, "restore": "", "builder_ref": "", "retry": ""})
        code, text, out = run_step(flow, "main", ws, env, root)
        args = gh_args(root)
        manifest = manifest_of(ws)
        check(code == 0 and out.get("rejected") == "true" and "pushed" not in out
              and (manifest["card_commit"], manifest["main_commit"], manifest["pending"]["repin"]) == (main, None, ["Cards/One.png"])
              and args[:3] == ["workflow", "run", "card-sync.yml"] and {"dry_run=false", "force=true", "bake=all",
                                                                          "retry=workflow_dispatch", "cards=Mini Doomer"} <= set(args)
              and f"builder_ref={git(os.path.join(ws, 'bot'), 'rev-parse', 'HEAD')}" in args
              and not any(a.startswith(("full=", "allow_archive=", "seed=", "restore=")) for a in args)
              and "full and allow_archive approved" in text,
              f"main moved, save-only: M dropped, one retry dispatched without the approvals ({' '.join(args[3:])})"
              + ("" if code == 0 else f"\n{text}"))

        ws, bare, main, env, root = setup(tmp, "baked-moved")
        commit(ws, {"site/Card Edits.json": '{"verdict":1}'}, "bake")                     # B on main's head
        moved(bare)
        env["GITHUB_EVENT_NAME"] = "schedule"
        code, text, out = run_step(flow, "main", ws, env, root)
        args = gh_args(root)
        check(code == 0 and out.get("rejected") == "true" and {"bake=all", "retry=schedule", "force=true"} <= set(args)
              and not any(a.startswith(("full=", "cards=", "seed=", "restore=", "allow_archive=")) for a in args),
              f"main moved after a scheduled bake: the retry is marked as the schedule's ({' '.join(args[3:])})"
              + ("" if code == 0 else f"\n{text}"))

        ws, bare, main, env, root = setup(tmp, "pending-moved")
        moved(bare)
        env["FAKE_WAITING"] = "1"
        code, text, out = run_step(flow, "main", ws, env, root)
        check(code == 0 and out.get("rejected") == "true" and not gh_args(root) and "is pending" in text,
              "main moved with a run pending: no retry (it would replace the pending run)")

        ws, bare, main, env, root = setup(tmp, "retry-moved")
        moved(bare)
        env["RETRY"] = "true"
        code, text, out = run_step(flow, "main", ws, env, root)
        check(code == 0 and out.get("rejected") == "true" and not gh_args(root),
              "main moved during a retry: a warning, no further run")

        ws, bare, main, env, root = setup(tmp, "late")
        env["START"] = str(int(time.time()) - 61 * 60)
        code, text, out = run_step(flow, "main", ws, env, root)
        check(code == 1 and git(bare, "rev-parse", "main") == main and "pushed" not in out,
              "main: 61 minutes into the run, M is not pushed (red)")


def main():
    for tool in ("git", "bash", "jq"):
        if not shutil.which(tool):
            sys.exit(f"needs {tool}")
    flow = load()
    plans(flow)
    gate_cases(flow)
    fonts_cases(flow)
    bake_cases(flow)
    main_cases(flow)
    print(f"{len(FAILED)} failed" if FAILED else "all passed")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
