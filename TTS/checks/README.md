# TTS save checks

Re-runnable checks of the Tabletop Simulator save (`TTS/Impossibility Simulator.json`), its rules (`TTS/decks.json`),
its Lua, its links and the updater that keeps it (AutoCroissant `commands/tts_save.py`, run daily by
`.github/workflows/tts-save.yml`). They came out of the 2026-10-22 audit. They only read: no check writes the save,
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
history clone. `tts_save_gate.py` needs `jq` and the bot checkout (`AUTOCROISSANT`) with its history.

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
| `links_pins.py` | Every repo link is pinned to a full sha on main, the last commit that changed the file, with canonical %-encoding |
| `pins_current.py` | Every pinned link serves main's current blob (git's own view, not the updater's walk) |
| `links_http.py` | Every URL in the save loads; repo images match their blobs and decode |
| `final_spot.py` | 30 random cards end to end: image, pin, Nickname, deck rule, CustomDeck wiring (`[n] [seed]` after the save) |
| `updater_idempotent.py` | The updater run as the Action runs it reports no changes and leaves the bytes alone; unpinned links and a dropped Lua row converge back; an offline website changes nothing; a card taken out of a complete deck comes back once |
| `updater_report_decks.py` | Report titles ("Links pinned" vs "Links re-pinned (changed files)"), the commit subject beside the report, and no CustomDeck key left unused when a card is re-added |
| `tts_save_gate.py` | The workflow's daily gate (the owner's names hash, 075e6c43) against real history, `gh` and the names cache (the names the updater last ran with) mocked: the names hashed from the bot's stats.pkl as build_site.py names cards; PICKLE 3888392 changed them, so it runs, and back again after a run with them it runs too; docs-only bot commit 39da9ed didn't, so it skips; a card repo change, no or an unknown last run, a forced run and a failed `gh run list` run (takes no save) |
| `card_sync_steps.py` | card-sync.yml offline (git 2.37+, bash, jq): every step's `if:` evaluated for the migration's runs (steps 6 and 7, MAIN_COMMIT and POSTS off: a bake only on a dry run, only `data` written, no alert; step 8: bake, M, posts; a rejected M drops the posts and the data; a failed live run or retry alerts, a dry one doesn't; the deadline's reserve covers the caps of Commit main and every later step); the Gate script on sandbox history (stoogedings-src alone skips; fonts, stoogedings.json, an upper-case .PSD and a hand-edited save run; Card sync's own save commits don't); a font cache hit's fonts survive the bake's ff merge (deleted without the Fonts tree step: the control); the Bake step's --pending (a schedule and its retry); Commit main's script on a sandbox origin (a save-only M named in the manifest only when the build wrote db/; a failed push that landed counts as pushed; main moved: one retry marked `retry`, without full or allow_archive, none from a retry or while a run is pending; nothing pushed past minute 60 or when HEAD is a B the bake never reported) |

`contents_lib.py` and `checks_env.py` are shared helpers. The names checks (`contents_names.py`, `final_spot.py`,
`updater_idempotent.py`) follow the live website, like the updater. When the website's names change (a bot pickle
push), they fail until the next `tts-save.yml` run has updated the save (21 of 24 pass meanwhile; 24 of 24 after the
2026-10-22 run).

Not kept from the audit: the zone-claiming runtime checks (`scripts_global_runtime.py`, `verify_scripts_f1_reload.py`,
retired with the claiming in `c9873ddf`), the one-off checks of that fix against the old save (`final_bytes.py`,
`final_diff.py`, `fixer_changes.py`), `contents_cooldown_pins.py` (covered by `links_pins.py`) and `dump_roundtrip.py`
(covered by `serializer.py`).
