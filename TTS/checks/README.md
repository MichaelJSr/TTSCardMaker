# TTS save checks

Re-runnable checks of the Tabletop Simulator save (`TTS/Impossibility Simulator.json`), its rules (`TTS/decks.json`),
its Lua, its links and the updater that keeps it (AutoCroissant `commands/tts_save.py`, run by
`.github/workflows/card-sync.yml`). They came out of the 2026-10-22 audit. They only read: no check writes the save,
the rules or a checkout (the updater checks run on copies in a temp dir).

## Run

```sh
python3 -m venv ~/.venvs/tts-checks                             # once
~/.venvs/tts-checks/bin/pip install requests Pillow lupa luaparser
~/.venvs/tts-checks/bin/python TTS/checks/run_all.py            # all checks on the repo's save, about 2 minutes
~/.venvs/tts-checks/bin/python TTS/checks/structure.py [save]   # one check
```

Each check takes the save as its first argument (default: the repo's save) and exits 1 on a failure. `run_all.py`
prints one line per check plus the end of a failing check's output, and keeps every output in `/tmp/tts-checks/out/`.

Interpreter: any Python 3 with `requests` and `Pillow`. The Lua checks also need `lupa` (`luaparser` is optional). A
check that needs lupa and runs without it starts again under `$LUA_PYTHON` or `~/.venvs/tts-checks/bin/python`.
The updater checks import the bot's code, which needs only `requests`.

| Variable | Default | What |
|---|---|---|
| `AUTOCROISSANT` | `~/Desktop/AutoCroissant` | the updater's code (`commands/tts_save.py` and what it imports); `updater_report_decks.py` needs it at the bot's main of 2026-10-22 or later |
| `TTS_HISTORY` | `/tmp/tts-checks/history.git` | bare blobless clone with main's full history, made or fetched on use (the checkout is shallow; under `run_all.py`, fetched once) |
| `TTS_REF` | `origin/main` | the commit whose tree the rules and names checks compare with |
| `TTS_REPO` | this repo | the TTSCardMaker checkout |
| `TTS_CARDS` | the live website | a `cards.json` file to take the card names from |
| `LUA_PYTHON` | | a Python with lupa |

Network: the website's `cards.json` (names), GitHub raw (`links_http.py`, `final_spot.py`) and `git fetch` of the
history clone. `card_sync_steps.py` needs git 2.37+, bash and `jq`.

## The checks

| Check | What it checks |
|---|---|
| `structure.py` | Save shape: keys, cards (CardID, own CustomDeck, 1x1), decks (DeckIDs = cards, CustomDeck = used keys), GUIDs, transforms, bags, snap points, hand zones (FogColor a seat colour) |
| `serializer.py` | The file is a byte-exact fixed point of the updater's `_dump` (TTS's own JSON style) |
| `customdeck_collisions.py` | No CustomDeck key names two images anywhere in the save; each card's key is CardID // 100 |
| `drift.py` | Against the last hand edit (`0d33adc8`, the mats enlarged and the loose Militron centred; or a ref or file as 2nd argument): only the updater's own kinds of edit (link refs, Nicknames, keys, deck cards, resizeTargets rows); an existing card's Description, GMNotes, Memo, Tags or scripts, or the global Lua outside resizeTargets, changed fails. Re-baseline `BASELINE` after a deliberate hand edit of the save |
| `contents_decks.py` | Complete decks hold exactly their rule's PNGs at the rule's counts (an empty one fails); hand-picked decks stay inside their rule, and with `add_new_since` hold every rule card the save at that commit lacked |
| `contents_names.py` | Card Nicknames = the website's names (Card Edits.json first); rulebook pages are "Page N: Title"; Descriptions are not judged (the team's) |
| `contents_backs.py` | Each deck has its rule's back; backs by card type |
| `contents_coverage.py` | Every website card is in the save and in a complete rule; the Rulebooks bag holds its pages once each |
| `contents_resize.py` | The Lua `resizeTargets` rows = the Nicknames of the `Auxiliary/Creatures` cards |
| `verify_rules_snapshot.py` | `decks.json` agrees with the save: `card_list` of hand-picked decks (an `add_new_since` deck may hold more: a note), and no rule matching a PNG that is not a card (no PSD, not on the website, like a back) |
| `scripts_lua_syntax.py` | Every script compiles as Lua 5.2 and uses nothing MoonSharp lacks (lupa) |
| `scripts_global_refs.py` | GUIDs, colours and teams in the scripts are real; hand zones belong to seats on a team; resizeTargets names large cards |
| `scripts_state_xml.py` | LuaScriptState is JSON; turn markers agree with their state; XmlUI is well-formed |
| `verify_scripts_static.py` | Script defects fixed in `c9873ddf` stay fixed: Flex Table `getHandTransform(i)`, seat colours, the destroyed-card guard, no team-zone warning |
| `lua_mock.py` | The global script under a mock TTS API (lupa): only onLoad, onPlayerChangeColor and onObjectLeaveContainer; Red/Orange/Green -> Hearts, Blue/Purple/Pink -> Clubs, other seats None, Grey/Black untouched; large cards to 3,1,3 three frames after leaving a container; no zone or spawn calls; seat swaps, destroyed cards and other adversarial cases. A second argument tests a `.lua` file instead |
| `lua_table.py` | The updater finds and regenerates `resizeTargets` (a dropped and a stray row come back right; a second run changes nothing) |
| `lua_resize_roundtrip.py` | The updater's table edit leaves the rest of the script byte-identical and still loads in Lua 5.2 |
| `links_pins.py` | Every repo link is pinned to a full sha on main, the last commit that changed the file, with canonical %-encoding (git log's view noted for failed pins only) |
| `pins_current.py` | Every pinned link serves main's current blob (git's own view, not the updater's walk); a failure names git log's last change |
| `links_http.py` | Every URL in the save loads; repo images match their blobs and decode |
| `final_spot.py` | 30 random cards end to end: image, pin, Nickname, deck rule, CustomDeck wiring (`[n] [seed]` after the save) |
| `updater_idempotent.py` | The updater run as the Action runs it reports no changes and leaves the bytes alone; unpinned links and a dropped Lua row converge back; an offline website changes nothing; a card taken out of a complete deck comes back once |
| `updater_report_decks.py` | Report titles ("Links pinned" vs "Links re-pinned (changed files)"), the commit subject beside the report, and no CustomDeck key left unused when a card is re-added |
| `card_sync_steps.py` | card-sync.yml offline (git 2.37+, bash, jq), its two lanes: every step's `if:` evaluated per job (data, at once: a dry run writes nothing, else it posts, commits data and dispatches the site, after the bake whatever the data did; no MAIN_COMMIT or POSTS switch; main, Bake and save: bake (none with bake=none), save, M and the baked PNGs' re-pin, none after a rejected or late M; GO from Pending edits; a failed live job or retry may alert, a dry one doesn't; the deadline's reserve covers the caps of Commit main and every later step; `after` runs the data steps with AFTER = M); the data Gate on sandbox history (stoogedings-src alone and a hand-edited save skip; fonts, stoogedings.json, an upper-case .PSD, the creation dates and AFTER run; AFTER leaves out the dispatch's inputs); the Build step's arguments (the dispatch's inputs, none after the bake; `--own` the main lane's `Card sync:` commits since the last build); the main Gate (a push and a dispatch go; the schedule's when a card input or the save changed, the lane's own commits aside, since the head of the last live run whose Bake and save succeeded on faked run lists, dry runs passed over, or none is found; a PSD-kind website edit sends it to Pending edits); a font cache hit's fonts survive the bake's ff merge (deleted without the Fonts tree step: the control); the Bake step's --pending (a push's run, a schedule, their retries and bake=pending); the timer, a fixed window (a push's or the schedule's main lane is skipped, never the run cancelled, while a push run is in its window: Another timer on faked run lists, not itself or one stuck 40 minutes, unreadable runs counted as none; else a push's waits in card-sync-quiet on its first attempt, in no group; data at once on every event but a retry, one group with after); Commit main's script on a sandbox origin (M with its outputs; a failed push that landed counts as pushed; main moved: one retry marked `retry` carrying only the bake, none from a retry or while another run is unfinished; nothing pushed past minute 60 or when HEAD is a B the bake never reported); Re-pin (the save again on M, a second commit; none when current or main moved); Tell Discord on faked runs (once per failing streak of its lane, judged by the newest other live run where the lane ended; once a lane per run); the chain (a chained run gates as the schedule, a wait one waits card-sync-quiet from its dispatch; Leftover edits' due and held counts; Chain on faked runs and data: at once for stale cards, unmerged bake records and due edits, through the window for held edits, none when nothing is left, a lane failed, another live run's lane reads it, a dry run, or past CHAIN_IDLE runs without progress or CHAIN_MAX runs; Chain after the data in a run whose main lane waits a window) |

`contents_lib.py` and `checks_env.py` are shared helpers. The names checks (`contents_names.py`, `final_spot.py`,
`updater_idempotent.py`) follow the live website, like the updater. When the website's names change (a Card sync data
commit), they fail until the next Card sync run has updated the save (21 of 24 pass meanwhile; 24 of 24 after the
2026-10-22 run).

Not kept from the audit: the zone-claiming runtime checks (`scripts_global_runtime.py`, `verify_scripts_f1_reload.py`,
retired with the claiming in `c9873ddf`), the one-off checks of that fix against the old save (`final_bytes.py`,
`final_diff.py`, `fixer_changes.py`), `contents_cooldown_pins.py` (covered by `links_pins.py`) and `dump_roundtrip.py`
(covered by `serializer.py`).
