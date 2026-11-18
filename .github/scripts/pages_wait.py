"""
The Card browser's deploy hand-over (.github/workflows/site.yml), by the run's API on one connection: conditional
reads, so a 304 isn't counted against the rate limit. The version job deploys (it holds github-pages: GitHub starts a
job with an environment ~2 s late, so the build has none); the build uploads and waits.

    python3 pages_wait.py artifact <name> <upload step>   (version job) this attempt's artifact <name>, listed every
        0.25 s while the build runs, or none once the build's <upload step> ended without one or the build ended:
        artifact=<id> or nothing in GITHUB_OUTPUT
    python3 pages_wait.py end                             (version job, nothing deployed) the build's end
    python3 pages_wait.py deployed                        (build) the version job's end

Exit 1: the build failed or did not run in this attempt (version job: 'Re-run failed jobs' re-runs both), or the version
job did not end well in this attempt (build). Stdlib only.
"""
import http.client
import json
import os
import sys
import time
from urllib.parse import urlsplit

POLL, SLOW, JOBS = 0.25, 2, 2       # s from look to look: artifact listings while the build runs, else; the jobs
LISTED = 120                        # s: an upload that ended well, not listed yet (at most)
UNLISTED = 60                       # s: a job missing from the run's (at most)
DOWN = 300                          # s: no read answered (at most)


class Api:
    def __init__(self):
        url = urlsplit(os.environ.get("GITHUB_API_URL") or "https://api.github.com")
        self.new = lambda: (http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection)(url.netloc, timeout=20)
        self.base, self.conn, self.tags, self.bodies = url.path.rstrip("/"), None, {}, {}
        self.headers = {"Authorization": f"Bearer {os.environ['GH_TOKEN']}", "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "site.yml pages_wait"}
        self.reads = self.counted = 0
        self.ok = time.monotonic()      # the last read answered

    def get(self, path: str, conditional: bool = True):
        """path's JSON (a 304: the last one); None when the read failed."""
        headers = {**self.headers, **({"If-None-Match": self.tags[path]} if conditional and path in self.tags else {})}
        try:
            self.conn = self.conn or self.new()
            self.conn.request("GET", self.base + path, headers=headers)
            reply = self.conn.getresponse()
            body = reply.read()
            self.reads += 1
            if reply.status == 304:
                self.ok = time.monotonic()
                return self.bodies[path]
            self.counted += 1
            if reply.status != 200:
                print(f"{path}: HTTP {reply.status}", file=sys.stderr)
                if reply.status in (403, 429):      # rate limited: as told, 5 s to a minute
                    time.sleep(min(max(int(reply.getheader("Retry-After") or 5), 5), 60))
                return None
            data = json.loads(body)
        except (OSError, http.client.HTTPException, ValueError) as error:
            print(f"{path}: {type(error).__name__}, read again", file=sys.stderr)
            if self.conn:
                self.conn.close()
            self.conn = None
            return None
        if reply.getheader("ETag"):
            self.tags[path], self.bodies[path] = reply.getheader("ETag"), data
        self.ok = time.monotonic()
        return data

    def down(self) -> bool:
        return time.monotonic() - self.ok > DOWN


RUN = f"/repos/{os.environ.get('GITHUB_REPOSITORY', '')}/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}"
ATTEMPT = int(os.environ.get("GITHUB_RUN_ATTEMPT") or 1)


def job(api: Api, name: str):
    """The run's latest job `name` ({}: not listed); None when the read failed."""
    data = api.get(f"{RUN}/jobs?filter=latest&per_page=100")
    return None if data is None else next((j for j in data.get("jobs") or [] if j.get("name") == name), {})


def listed(api: Api, name: str, conditional: bool = True) -> str:
    data = api.get(f"{RUN}/artifacts?name={name}&per_page=100", conditional) or {}
    return next((str(a["id"]) for a in data.get("artifacts") or [] if a.get("name") == name and not a.get("expired")), "")


def other(api: Api, found, start: float, what: str) -> str:
    """Why `found` (a job, {} unlisted, None unread) is not this attempt's, once that lasts; else ''."""
    if found is None:
        return f"no API read answered in {DOWN} s" if api.down() else ""
    if not found:
        return f"no {what} job listed" if time.monotonic() - start > UNLISTED else ""
    return f"the {what} job did not run in attempt {ATTEMPT}" if found.get("run_attempt", ATTEMPT) != ATTEMPT else ""


def pause(since: float, every: float):
    """Till `every` s after `since` (a look's start): its reply's time counts."""
    time.sleep(max(0.0, since + every - time.monotonic()))


def fail(why: str) -> int:
    print(f"::error::{why}")
    return 1


def artifact(api: Api, name: str, upload: str) -> int:
    start, look, build, since = time.monotonic(), 0.0, {}, None
    while True:
        began = time.monotonic()
        found = listed(api, name)
        if not found and time.monotonic() >= look:
            look = time.monotonic() + JOBS
            got = job(api, "build")
            build = build if got is None else got
            if why := other(api, got, start, "build"):
                return fail(f"{why}: nothing to deploy (re-run all jobs)")
            step = next((s for s in build.get("steps") or [] if s.get("name") == upload), {})
            if step.get("conclusion") == "success":
                since = since or time.monotonic()
                if time.monotonic() - since > LISTED:
                    return fail(f"{name} uploaded, not listed in {LISTED} s")
            elif step.get("status") == "completed" or build.get("status") == "completed":
                found = listed(api, name, conditional=False)        # an upload since the last listing
                if not found:
                    print(f"No {name}: the build's {upload} {step.get('conclusion') or 'did not run'} "
                          f"({time.monotonic() - start:.1f} s, {api.reads} reads, {api.counted} counted)")
                    return 0
        if found:
            print(f"{name} (artifact {found}) listed after {time.monotonic() - start:.1f} s ({api.reads} reads, {api.counted} counted)")
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
                out.write(f"artifact={found}\n")
            return 0
        pause(began, POLL if build.get("status") == "in_progress" else SLOW)


def end(api: Api) -> int:
    start = time.monotonic()
    while True:
        got = job(api, "build")
        if why := other(api, got, start, "build"):
            return fail(why)
        if got and got.get("status") == "completed":
            print(f"The build ended: {got.get('conclusion')}")
            return fail("the build failed: 'Re-run failed jobs' re-runs this job too") if got.get("conclusion") == "failure" else 0
        time.sleep(JOBS)


def deployed(api: Api) -> int:
    start = time.monotonic()
    while True:
        began = time.monotonic()
        got = job(api, "version")
        if why := other(api, got, start, "version"):
            return fail(f"{why}: nothing deployed (re-run all jobs)")
        if got and got.get("status") == "completed":
            if got.get("conclusion") != "success":
                return fail(f"the deploy failed (the version job: {got.get('conclusion')})")
            print(f"Deployed (the version job) after {time.monotonic() - start:.1f} s ({api.reads} reads, {api.counted} counted)")
            return 0
        pause(began, POLL)


def main(argv: list) -> int:
    api = Api()
    if argv[:1] == ["artifact"] and len(argv) == 3:
        return artifact(api, argv[1], argv[2])
    if argv == ["end"]:
        return end(api)
    if argv == ["deployed"]:
        return deployed(api)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
