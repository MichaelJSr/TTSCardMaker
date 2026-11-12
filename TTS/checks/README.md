# TTS save checks

Re-runnable checks of the Tabletop Simulator save (`TTS/Impossibility Simulator.json`), its rules (`TTS/decks.json`),
its Lua, its links and the updater that keeps it (AutoCroissant `commands/tts_save.py`, run by
`.github/workflows/card-sync.yml`). They came out of the 2026-10-22 audit. They only read: no check writes the save,
the rules or a checkout (the updater checks run on copies in a temp dir).

## Run

```sh
python3 -m venv ~/.venvs/tts-checks                             # once
~/.venvs/tts-checks/bin/pip install requests Pillow lupa
~/.venvs/tts-checks/bin/python TTS/checks/run_all.py            # all checks on the repo's save, about 40 s
~/.venvs/tts-checks/bin/python TTS/checks/structure.py [save]   # one check
```

Each check takes the save as its first argument (default: the repo's save) and exits 1 on a failure. `run_all.py`
runs them 4 at a time, the slow ones first, prints one line per check (in its list's order) plus the end of a failing
check's output, and keeps every output in `/tmp/tts-checks/out/`. It runs `card_sync_steps.py` as 3 parts of its
groups (`GROUPS`: two listed in `run_all.py`, then the rest), about 15 s each, so 13 lines.

Interpreter: any Python 3 with `requests` and `Pillow`. The Lua checks also need `lupa`. A
check that needs lupa and runs without it starts again under `$LUA_PYTHON` or `~/.venvs/tts-checks/bin/python`.
The updater checks run a copy of the bot's code (`global_config.py` and every `commands/*.py`) on copies of the
updater's inputs (decks.json, Card Edits.json, Global.lua, pages.json); it needs `requests` and `Pillow`.

| Variable | Default | What |
|---|---|---|
| `AUTOCROISSANT` | `~/Desktop/AutoCroissant` | the updater's code (`commands/tts_save.py` and what it imports) |
| `TTS_HISTORY` | `/tmp/tts-checks/history.git` | bare blobless clone with main's full history, made or fetched on use (the checkout is shallow; under `run_all.py`, fetched once); a file a blobless checkout lacks (an old save, a `TTS_REF` file) is fetched into it, never lazily |
| `TTS_REF` | `origin/main` | the commit whose tree the rules and names checks compare with |
| `TTS_REPO` | this repo | the TTSCardMaker checkout |
| `TTS_CARDS` | the live website | a `cards.json` file to take the card names from |
| `TTS_DETAILS` | the live website | a `tts.json` file for `lua_mock.py`'s card details |
| `LUA_PYTHON` | | a Python with lupa |

Network: the website's `cards.json` (names) and `tts.json` (`lua_mock.py`), GitHub raw (`links_http.py`) and
`git fetch` of the history clone. Keep `TTS_HISTORY` out of `/tmp` on a Mac that reboots (e.g.
`~/Documents/Tools/wt/scratch/tts/history.git`): a new clone is a full-history download. `card_sync_steps.py` needs git 2.37+, bash and `jq`.

## The checks

| Check | What it checks |
|---|---|
| `structure.py` | Save shape: keys, cards (CardID, own CustomDeck, 1x1), decks (DeckIDs = cards, CustomDeck = used keys), no CustomDeck key naming two images, GUIDs, transforms, bags, snap points, hand zones (FogColor a seat colour) |
| `drift.py` | Against the last hand edit (`befdf769`, 11-06: the Specific Item Decks bag removed; or a ref or file as 2nd argument): only the updater's own kinds of edit (link refs, links to a moved file, Nicknames, keys, deck cards, the Rulebooks bag's contents, resizeTargets rows; the global script must equal `TTS/Global.lua`, the UI the baseline's); an existing card's Description, GMNotes, Memo, Tags or scripts, or the global Lua outside resizeTargets, changed fails. Re-baseline `BASELINE` after a deliberate hand edit of the save |
| `contents_decks.py` | Complete decks hold exactly their rule's PNGs at the rule's counts (an empty one fails); hand-picked decks stay inside their rule, and with `add_new_since` hold every rule card the save at that commit lacked |
| `contents_backs.py` | Each deck has its rule's back; backs by card type |
| `contents_coverage.py` | Every website card is in the save and in a complete rule; the Rulebooks bag holds the rulebook's PDF (`TTS/Rulebook/Rulebook.pdf`) as one Custom_PDF object |
| `verify_rules_snapshot.py` | `decks.json` agrees with the save: `card_list` of hand-picked decks (an `add_new_since` deck may hold more: a note), and no rule matching a PNG that is not a card (no PSD, not on the website, like a back) |
| `lua_mock.py` | The global script (`TTS/Global.lua`) under a mock TTS API (lupa) on the save's own objects and hand zones: no Lua patterns (caught as they run; MoonSharp's "pattern too complex"); handlers are TTS events, none per frame; loading does nothing and builds no UI; Red/Orange/Green -> Hearts, Blue/Purple/Pink -> Clubs, other seats None, Grey/Black untouched; a side's free hand zones go to its first seated player and come back (kept through a save and load); large cards to 3,1,3 three frames after leaving a container; turn markers cycle on a flip only; card details, the rulebook panel and the card finder (aliases, plurals, "status effects") on the website's `tts.json` and the repo's `pages.json` (built on a player's first use, the save's UI kept, every id set exists, every onClick a function, spawns into the hand face down (at the pointer on a seat without one, once the card has gone), the PDF turned to the right page, hidden cards stay hidden (face down, or in any of another player's hand zones), the name plain and the ability in the website's palette (`ac`) with a card's own "<" never a tag; every card's details at each size: the text only the kind line, the stats and the ability (no rule sections), each chapter a whole Rules button, rows fit, each "+ name" spawns its card, the ability laid out line by line as one text would draw it with each status word, timing tag and creature or minion type word's rule on hover (wrapped to the text's width), a type word in its type's colour (`ic`), a button's tooltip only on a name cut short: its whole name, above every row of buttons; every tooltip in the opaque style `TIP`); each deck button a copy of the full deck, every card at its count in the save's piles (2★ Items: Metronome 5, Bomb 3). A second argument tests a `.lua` file instead (the way to try a Global.lua change before it reaches the save) |
| `links_pins.py` | Every repo link is pinned to a full sha on main, the last commit that changed the file, with canonical %-encoding (git log's view noted for failed pins only); the global script's links are live data on main, not pinned |
| `links_http.py` | Every URL in the save loads; repo files match their blobs (fetched uncompressed: `.obj` models come gzipped) and images decode; the global script's links load (a `.json` one parses); links in Descriptions, notes and XmlUI only load. Pinned blobs a blobless checkout lacks are fetched first, in a few batches; blobs are read by one `git cat-file --batch` per repo; a blob that decoded once is not decoded again (`decoded-blobs.txt` beside the history clone) |
| `updater_idempotent.py` | The updater run as the Action runs it reports no changes and leaves the bytes alone; unpinned links and a dropped Lua row converge back; an offline website changes nothing; a card taken out of a complete deck comes back once |
| `card_sync_steps.py` | card-sync.yml offline (git 2.37+, bash, jq; group names as arguments run only those), its two lanes: every step's `if:` evaluated per job (data, at once: a dry run writes nothing, else it posts, commits data and dispatches the site, after the bake whatever the data did; main, Bake and save: bake (none with bake=none), save, M and the baked PNGs' re-pin, none after a rejected or late M; GO from Pending edits; a failed live job or retry may alert, a dry one doesn't; the deadline's reserve covers the caps of Commit main and every later step; `after` runs the data steps with AFTER = M); the data Gate on sandbox history, on the data lane's depth-1 checkout after History start and History wait (failed: fetched once more; again: the job fails; site.yml's the same scripts) (stoogedings-src alone and a hand-edited save skip; fonts, stoogedings.json, an upper-case .PSD, the creation dates and AFTER run; AFTER leaves out the dispatch's inputs); the Build step's arguments (the dispatch's inputs, none after the bake; `--own` the main lane's `Card sync:` commits since the last build); the main Gate (a push and a dispatch go; the schedule's when a card input or the save changed, the lane's own commits aside, since the head of the last live run whose Bake and save succeeded on faked run lists, dry runs passed over, or none is found; a PSD-kind website edit sends it to Pending edits); a font cache hit's fonts survive the bake's ff merge (deleted without the Fonts tree step: the control); the Bake step's --pending (a push's run, a schedule, their retries and bake=pending); the timer, a fixed window (a push's or the schedule's main lane is skipped, never the run cancelled, while a push run is in its window: Another timer on faked run lists, not itself or one stuck 40 minutes, unreadable runs counted as none; else a push's main lane waits in itself for this push's guards' check (no fixed wait since 2026-11-03); data at once on every event but a retry, one group with after); Commit main's script on a sandbox origin (M with its outputs; a failed push that landed counts as pushed; main moved: one retry marked `retry` carrying only the bake, none from a retry or while another run is unfinished; nothing pushed past minute 60 or when HEAD is a B the bake never reported); Re-pin (the save again on M, a second commit; none when current or main moved); Tell Discord on faked runs and commit comments (once per broken push by the marker comment on its head commit, Card guards' marker too; a run without a push also once per failing streak of its lane, judged by the newest other live run where the lane ended, and once a lane per run, then the marker; the standards post's text, flags 4, the failed steps); the chain (a chained run gates as the schedule; Leftover edits' pending count; Chain on faked runs and data: at once for stale cards, unmerged bake records and due edits, none when nothing is left, a lane failed, another live run's lane reads it, a dry run, or past CHAIN_IDLE runs without progress or CHAIN_MAX runs; Chain after the data in a push run); one main lane per guarded push (Guards' fixes on faked guards runs: a push's main lane skipped while its guards have fixes to land, the schedule's and a chain's while any such run is unfinished, never when the guards land nothing to start, failed or are absent; card-guards.yml's mark, Plan's fixes, Start Card sync with 25 PSDs or fewer to convert, and Follow up's dispatch with fixes, landed or not, unless that run started first and kept both lanes) |

`contents_lib.py` and `checks_env.py` are shared helpers. `links_pins.py` and `updater_idempotent.py` judge the save
at the checkout's commit (a work branch: its merge-base with `TTS_REF`) when it is that commit's save, else at main:
a later save update on GitHub does not fail an older checkout. `updater_idempotent.py` follows the live website's
names, like the updater. When the website's names change (a Card sync data commit), it fails until the next Card sync
run has updated the save (12 of 13 pass meanwhile).

Not kept from the audit: the zone-claiming runtime checks (`scripts_global_runtime.py`, `verify_scripts_f1_reload.py`,
retired with the old respawn claiming in `c9873ddf`; the hand zones shared on a side since 10-30 are `lua_mock.py`'s),
the one-off checks of that fix against the old save (`final_bytes.py`, `final_diff.py`, `fixer_changes.py`),
`contents_cooldown_pins.py` and `pins_current.py` (covered by `links_pins.py`), `dump_roundtrip.py` and `serializer.py`
(covered by `updater_idempotent.py` and AutoCroissant's `test_serializer_round_trip_real_save`), `final_spot.py` (30
random cards end to end: all cards are in `links_http.py`, `links_pins.py`, `structure.py` and `contents_decks.py`),
`customdeck_collisions.py` (covered by `structure.py`), `verify_scripts_static.py` (covered by `drift.py`),
`scripts_lua_syntax.py` (covered by `lua_mock.py` and `drift.py`), `lua_table.py`, `contents_resize.py` and (2026-11-12)
`lua_resize_roundtrip.py` (covered by `structure.py`, `updater_idempotent.py` and `lua_mock.py`),
`updater_report_decks.py` (covered by AutoCroissant's `test_tts_save.py`), and since 2026-11-12 `contents_names.py`
(covered by `updater_idempotent.py`), `scripts_global_refs.py` and `scripts_state_xml.py` (covered by `drift.py` and
`lua_mock.py`).
