#!/bin/bash
# History join's, in the background from the depth-1 checkout: main's history joins it (no config or ref written) from
# whichever is in first, History start's fetch (history.git) or the cached copy History wait starts when that one is
# late (history-copy.git, action.yml); a failed one waits for the other, if started. Neither, or still shallow (main
# moved between the two): from GitHub. Exit code in history.code.
t=$RUNNER_TEMP full='' copy='' code=0
join() {
  git -c remote.history.url="file://$1" -c remote.history.promisor=true -c remote.history.partialclonefilter=blob:none \
    fetch -q --unshallow --no-tags --no-write-fetch-head history main && [ "$(git rev-parse --is-shallow-repository)" = false ]
}
while :; do
  if [ -z "$full" ] && [ -s "$t/history-fetch.code" ]; then
    full=$(cat "$t/history-fetch.code")
    cat "$t/history-fetch.log"
    if [ "$full" = 0 ] && join "$t/history.git"; then echo "History join: joined"; break; fi
    full=failed
  fi
  if [ -z "$copy" ] && [ -s "$t/history-copy.code" ]; then
    copy=$(cat "$t/history-copy.code")
    cat "$t/history-copy.log"
    if [ "$copy" = 0 ] && join "$t/history-copy.git"; then echo "History join: joined the cached copy"; break; fi
    copy=failed
  fi
  if [ "$full" = failed ] && { [ ! -e "$t/history-copy.started" ] || [ "$copy" = failed ]; }; then
    echo "History join: from GitHub"
    git -c protocol.version=2 fetch -q --unshallow --no-tags --filter=blob:none origin +refs/heads/main:refs/remotes/origin/main || code=$?
    break
  fi
  sleep 0.05
done
echo "$code" > "$t/history.code"
