# Website notes (2026-10-20, sections 7-12 added 2026-10-21, 13, 14 and the (Action) tag on 2026-10-22, 16-19 on 2026-10-23)

Sections 1-6 began as architecture notes for a Table tab (since reverted); its planning lines went on 2026-10-25,
and the line numbers left in them are of 2026-10-20. The hand-kept files have since moved from MDW/ to site/ (Card
Authors.txt, Card Edits.json, Website Admins.txt, Constructed Ban List.txt): read `MDW/<file>` below as `site/<file>`.


Paths relative to /Users/michaelsrouji/Desktop/TTSCardMaker/site. Plain ES modules, no framework; site.yml bundles them with esbuild (§31).

## 1. Page structure
- Tabs are static `<a data-tab>` links in index.html:30-37: cards, rules, deck, stats, changes, users (plus hidden routes `compare`, `u` = a profile, `card` = modal). Header buttons: random, theme, account (`#account`: "Sign in" or the login, opens the editor hub; the pencil until 2026-10-21), keys.
- Routing = hash routing, no registry. `parseHash()` app.js:~119 -> `{name, arg, params}` from `#/name/arg?query`. `route()` (app.js:~138) on `hashchange`/`popstate`; `renderView(r, hash)` (app.js:~150) holds the table `views = { cards: renderCards, rules: renderRules, deck: renderDeck, stats: renderStatsView, changes: renderChanges, compare: renderCompare }`, toggles `.tabs a.active` by `data-tab === r.name`, and sets document.title from a second name map (same line block). Unknown names fall back to renderCards.
  Build copies every file in site/assets/ automatically (build_site.py:1249, as of 2026-10-21), rewrites `from "./x.js"` imports to `?v=<hash>` for cache busting (each asset's stamp from its content and its imports' stamps, `asset_stamps`; the data's from its content without the build time, `data_stamp`; §27), so a new assets/table.js needs no build change. index.html `preload`/`modulepreload` hints are only hints; `?v=` is added by regex only for `assets/*.js|css` and `data/cards.json` (build_site.py:1255).
- Views produce HTML as template-literal strings assigned to `view.innerHTML` (`#view` = `<main>`); every dynamic string goes through `esc()` (text.js:3). No DOM builders/templates. Handlers are NOT attached per element: one delegated `document` click listener (app.js:709) dispatches `[data-action="name"]` to `actions[name](el)` (object at app.js:662; editor's actions merged via `...editor.actions`), `change` listener (app.js:722) for SELECT/checkbox actions. Also `[data-open=cardId]` -> opens card modal `#/card/<id>`; `[data-pick]` for the deck picker. Per-view one-off listeners are added after innerHTML (e.g. deck name input app.js:529, rules search 451).
- Async views: show `<div class="loading">`, call `whenLoaded(promise, what, rerender)` (app.js:~66) which re-renders or shows an error; lazy loaders are memoised promises (`rulesP ||= getJson(...)`, reset to null on failure).
- Dialogs: `#modal` (hidden attr) with `.dialog` content; `showDialog(html)` (app.js:660, small dialog with close button), `closeModal()`, `toast(msg)`, `copy(text, what)`, `debounce`. Tooltips: any `[data-tip]` attr. Keyboard: global keydown app.js:745 (ignores typing in INPUT/TEXTAREA/SELECT).
- State object `S` (app.js:~17): data, all, cards (non-hidden), byId Map, banned Map, icons, renderer, decks, compare, list, versions, history, rules. `derive()` recomputes after edits. `rerender()` re-renders the current hash view (call it after any state change). `S.renderer.render(text, ownName)` renders ability text with icons/badges/card links.
- Timing tags (text.js `TAG` finds candidates, `tagInfo(tag)` -> `{tag, group, meaning, multi, old}` or null; 2026-10-21): cooldowns `nCD` and `a/bCD` (group turn), global cooldowns `nGCD` and `a/bGCD` (any), uses `nU` (trigger), plus OYT, AAT, BOT, ENDT, BOGT, ENDGT, OFS, OS, OD, WOF and `nPG`; n = 1-9 or X, a = -1, 0-9 or X. `(Action)` (2026-10-22) is in `FIXED` with its own grey group `neutral` (`--b-neutral`, `GROUP_NAMES.neutral` "Other tags"). Any letter case is the same tag (2026-10-22, as the font's CASE lookup): `TAG` takes `[0-9A-Za-z/]`, `tagInfo` folds what was typed to the canonical case (`canon`: upper case, or the `FIXED` key, so "(action)" is Action) and returns it as `tag`; `badgeHtml` labels and tips the badge with it and the Stats page counts under it. The text itself is never changed. Not a timing tag: the Stats page's "Timing tags" chart (stats.js) skips the `neutral` group; the rulebook glossary lists it under "Other tags". Meanings follow the letters only ("Cooldown: 1 turn, then 2"; singular for 1 and -1). Badges draw "-" as U+2212, like the font. The old `nPT`, `EnT`, `FTEnT`, `nPGT`, `EnGT` (only on rulebook pages since the cards' cooldown update) get `old: true` and an "Old system: " meaning. Same set as the stoogedings font's `badge_tags()` (341 badges since 2026-10-22, 340 before); change both together. `TAG` has no /g flag (no shared lastIndex): iterate with `new RegExp(TAG.source, "g")`, as stats.js does; the rulebook glossary (app.js `renderRules`) shows one of each, old ones last. Badge colors (2026-10-22): text.js `LEGEND` / `legendHtml()`, one line per group with its examples drawn by `badgeHtml` (the color word per group in `COLOUR`, the colors themselves only in the `--b-*` CSS), the text of rulebook page 02 Abbreviations; shown as the first rulebook panel (`#badge-colors`) and on a card page as a closed `<details class="badge-help">` after the ability and note when `hasBadges` finds one in either.
- CSS conventions (style.css, one file): theme via `:root[data-theme=dark|light]` custom props (`--page --surface --surface-2 --surface-3 --border --border-strong --ink --ink-2 --muted --accent --danger --good --warn`, chart `--s1..--s4`); theme set pre-paint in index.html:20 from localStorage "theme". Use existing classes: `.panel` (card box, 14px radius), `.toolbar`, `.actions` (button row), `.grid` + `.tile` (card tile, `--tile` width var; tileHtml() in app.js:~190 builds one), `.strip` (h-scroll tile row), `.slots/.slot` (deck slots, 2:3 aspect), `.tier-title`, `.chips/.chip`, `.seg` (segmented buttons), `.fact`, `.muted`, `.num`, `.kbd`, `button.primary/.ghost/.icon/.danger`, `table.data`, `.empty`, `.loading`, `.check`, `.erow/.ein` (form rows), `.wide` (full width input), `.stars`. Layout idiom: two-column CSS grid (`.deck {1fr 340px}` at style.css:193, `.browse {260px 1fr}`) collapsing to one column via `@media (max-width: 980px|860px)`; sticky sidebars at `top:64px`. Header wraps under 980px (`.tabs` becomes scrollable row). Inline `style=` is used liberally for one-offs. Print rules at style.css:240. No CSS framework or preprocessor.

## 2. Data loading
- `getJson(name)` app.js:~58: `fetch("data/"+name+"?v=<build>")` relative to `<base>`; ordinary HTTP cache keyed by the `?v=` build hash. `cards.json` is preloaded in index.html:12 and awaited in `init()` before first render.
- Files (dist/data/, sizes from the 2026-10-20 build):
  - cards.json 409 KB: `{generated, repo:"MichaelJSr/TTSCardMaker", botRepo:"bobberlington/AutoCroissant", raw:"https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/main/", cards[], icons{}, banlist{notes[], groups[{title, entries[{name, reason, id}]}]}, branch:"main", files{edits,authors,banlist,admins,profiles,decks}, admins[logins], people[], peopleMap{git:shown}, decks{public,private}}`. icons = `{normalizedName: {file:"icons/x.webp", name, kind:"type"|...}}`.
  - rules.json 67 KB `{rules:[{id, name, type:"rulebook", ability, ...}]}` (lazy: rulebook tab). history.json 48 KB `{cardId: [{ts, ability}]}` (lazy: changes tab / card with `hv`). versions.json `{available, repo, commits[[sha,ts,author,subject]], cards{id:[[commitIdx, path]]}}`; currently `available:false`, empty (76 bytes).
  - details/<id>.json (2026-10-21; 0.9-16.7 KB each, median 3.7 KB, one per card or rulebook page with `details: true`; lazy: the card or rulebook page's Details dropdown, `loadDetails` memoised per card id in app.js): the bot's psd_details.json record `{id, name, path, at, parser, canvas{w,h,mode,depth,icc}, fonts{font:{layers[], supplied}}, text[{layer,text,font,size,color,visible}], effects{layer:[names]}, smart_objects[], icons, stats{hp,def,atk,spd}, fx[], overlays[], template{name_layer, ability_layers, deviations}, tree[[name, kind, visible, children?]]}`; a section the bot couldn't read is a short string. Section 11.
  - decks.json (2026-10-21; lazy: `#/decks`, a deck page, a person's Decks panel): `{generated, decks: [{owner, slug, name, description, cards[visible ids], dropped, field|null, updated, n}], private: [{owner, slug, kdf{name,hash,iter,salt}, iv, data, updated}]}`, both newest first. cards.json carries the counts as `decks: {public, private}` and `files.decks = "site/decks"`. Section 12.
  - analytics.json (2026-10-22; 105 KB, 13 KB gzipped; lazy: the Stats page's Balance section, a card with `balance: true`): section 14.
- Card record (cards.json, empty fields dropped; 773 cards; types: creature 298, item 189, minion 91, debuff 52, field 50, aux item 48, nme 26, buff 12, creatures 7). Fields: `id` (slug, e.g. "a-snack"), `name`, `type` (kind), `subtype` (item type e.g. heal), `series`, `stars` (int), `types[]` (icon names), `hp def atk spd`, `ability` (text with `[type]` tokens and \n), `author`, `ts` (last PSD commit, epoch s), `psd`, `png` (repo path of full PNG), `key` (card file key used in Card Edits.json/Authors), `dups[]` (ids that are copies of this card; on the copy: `dup` = original id), `aliases[]`, `authorListed`, `img` (hash for thumbs), `tw`,`th` (360-wide thumb dims), `color` (accent hex), `hv` (history count), `iv` (image versions, only over 1), `fs` (first upload of the image, epoch s, from the git history: full-history builds only, every card with a history row), `created` (the creation date "YYYY-MM-DD": the earlier of `site/Card Creation Dates.json`'s first Discord post and `fs`, a hand-set date winning; `createdFrom` "discord" | "git" | "hand", `createdAbout: true` while provisional; build_site `apply_created`, 2026-10-23), `problems[]`, `creatures[]` (list of per-creature stat objects when a card has several), `ratings[]` (dated 1-10 ratings, oldest first: section 25), `parsed:false` (only when not parsed), plus editor-only fields at runtime: `edited`, `orig`, `editAt`, `webAliases`, `hidden`, `note`, `problems_ok`, `allow_high_stats`, `_staged`, `_sent`, `_banned`, `_unused`. Cards have NO sha/GUID or TTS ids (`details: true`, 2026-10-21, only says `data/details/<id>.json` exists; the record is joined by blob sha at build time). Note `c.type` of a field card = "field", status effects "debuff"/"buff".
- Images: thumbnails `thumbs/<img>-{240|360|720}-<tag>.avif` (AVIF since 2026-10-24, §28; the tags in cards.json `thumbs`) (app.js:~44 `img(c,w)`, `imgAttrs(c, cssPx)` gives src+srcset+width/height); full-size PNG = `S.data.raw + urlPath(c.png)` (raw.githubusercontent.com, `fullUrl(c)` app.js:~49; this is what TTS FaceURL uses in deck.js:156); card back images `raw + "MDW/cardback.png"` and `MDW/cardback_item.png` (deck.js:181-183). Icons `icons/<name>.<stamp>.webp` (§28). Name lookup helpers: `S.byId`, `norm(name)` (text.js:4: lowercase, strips spaces/_-.'), search `compile(query)` (search.js:35) returns predicate; matches names + aliases; `suggest(q, cards)`.

## 3. Editor (assets/edit.js, 557 lines)
- `createEditor(app)` (edit.js:24) is a closure; app.js:~110 instantiates `editor` with `{S, KIND_LABEL, derive, rerender, goCard, currentCard, toast, modal, openCard, closeModal, showDialog, iconFor, render}`. Returned public API (edit.js:545-556) is ONLY: `actions`, `get me`, `staged(id)`, `init()`, `open(id)` (card form), `refresh` (=preview). Everything below is private and must be exported/added for a new feature: `gh`, `readFile`, `commitFiles`, `signIn`, `token`, `stage`, `save`, `count`, `publish`, `renderBar`, `reviewHtml`.
- Sign-in: classic PAT with `public_repo` scope, pasted into hub dialog (`openHub`, edit.js:485; form `#signin-form`). `signIn(t, remember)` edit.js:75: `GET /user` (reads `x-oauth-scopes` header, must match `\b(public_)?repo\b`), then `GET /repos/{repo}` and requires `permissions.push`; `me = {login, admin, push:true}`, `admin = permissions.admin || isAdmin(login)` where `isAdmin` checks `S.data.admins` (from MDW/Website Admins.txt + owner; case-insensitive). Token stored in localStorage "edit-token" if "remember", else sessionStorage (until 2026-10-23: now sealed, see 16); only sent to api.github.com (`gh()` edit.js:37, headers Bearer, `X-GitHub-Api-Version: 2022-11-28`, `cache:"no-store"`). `init()` auto-signs-in from stored token at load (async; then `derive()`+`rerender()`), so `editor.me` is null until that resolves (then rerender). `signOut()` clears all.
- (a) is-editor: `editor.me` (null = not signed in; `.push` true for any signed in editor, `.admin` for admins, `.login`). Prompt login: `editor.actions["edit-hub"]()` / private `openHub(note, thenCardId)`.
- Batching: `stage = {cards:{id:op}, people:{}, admins:null}` persisted in localStorage "edit-stage" (`save()` = persist + `preview()` + renderBar); op = `{id,key,name,set:{field:val},unset:[],author?,ban?}`. After publish, ops live in localStorage "edit-sent" ({at,sha,ops}) and are re-applied in `preview()` until `S.data.generated` is newer (so UI shows "Publishing..."). Floating bar `#edit-bar` (class `.edit-bar`, fixed bottom) shows "N unpublished changes" with Review/Publish (since 2026-10-21 the batch bar of section 10: one sentence per pending edit with a revert); `reviewHtml()` lists ops via `describe(op)`; Publish button `data-action="edit-publish"` reads `#edit-msg` (optional commit message) and calls `publish(msg)`.
- Publish (edit.js:422 `publish`, 56 `commitFiles`) = **git data API, one commit**, not contents API. `commitFiles(edits, message)`, edits = `{path: oldText => newText | null}`:
  1. `GET /repos/{repo}/git/ref/heads/{branch}` -> head sha
  2. `GET /repos/{repo}/git/commits/{head}` -> base tree sha
  3. for each path: `readFile(path, head)` = `GET /repos/{repo}/contents/{path}?ref={head}` with `Accept: application/vnd.github.raw+json` (returns raw text; 404 -> null). Calls `edit(old)`; skipped if result null or unchanged. No file sha needed.
  4. `POST /git/trees {base_tree, tree:[{path, mode:"100644", type:"blob", content}]}` (inline content, no separate blob call)
  5. `POST /git/commits {message, tree, parents:[head]}`
  6. `PATCH /git/refs/heads/{branch} {sha}` (no force). On 422 (not fast-forward = someone pushed) it loops from step 1 re-reading the files and re-applying the edit functions; up to 3 retries (`attempt >= 3` throws). Returns new commit sha, or null if nothing changed.
  Retry re-applies the pure transform to fresh content, which is exactly the "merge with concurrent bot updates" pattern needed. Repo/branch come from `S.data.repo` / `S.data.branch` ("MichaelJSr/TTSCardMaker", "main"). Rate: authenticated; each attempt = 3 + N reads + 3 writes.
  Commit message: `message || (what.length > 3 ? "Website edits: N changes" : "Website edit: A, B, C")` where what = card/page names (+ "people", "admins"). User may type a custom message.
  After commit: stores sent-ops, clears stage, `save()`, dialog "Published" with commit link `https://github.com/{repo}/commit/{sha}`; site rebuild takes minutes (workflow); the card sync brings it to the bot within minutes and to the PSDs within about 30 minutes (card-sync.yml: the data lane at once on a card push, the bake 30 minutes after the first card push of a burst).
- Files written (paths from `files()` edit.js:32 = defaults overridden by `S.data.files`): `MDW/Card Edits.json` (`editsFile`: JSON `{about, cards:{key:{fields..., _by, _at}}}`, keys sorted, fixed field ORDER, hand-formatted one-line-per-card), `MDW/Card Authors.txt` (`authorsFile`: INI-ish `[people]`/`[cards]` with `# --- credited to X (n) ---` groups), `MDW/Constructed Ban List.txt` (`banFile`: `Group:` headings, `Name - reason` lines), `MDW/Website Admins.txt` (admins, `#` comment lines preserved). Rulebook pages are edited as cards with type "rulebook" (ids from rules.json), their field changes also go into Card Edits.json (not separate files; `ruleFormHtml` edit.js:162 edits name/ability/note).
- Image previews (2026-10-23, section 22): the Edit dialog's `openForm` calls `app.formOpened({form, card, read, base})`
  (not for rulebook pages), and the editor's API gains `github(path, opts)` (its `gh`, with the token), `scopes` (the
  token's classic scopes from sign-in, null for a fine-grained one), `psdOf(id)` (what the PSD prints of each PSD field)
  and `entryFields(id, op)` (the fields the card's Card Edits.json entry would hold once published). That is all the
  wiring; preview.js and mockup.js hold the rest.

## 4. Deck builder (assets/deck.js 208 lines + app.js:473-551, 684-691)
- State: `S.decks` array of `{id, name, cards:[cardId...], field:cardId|null}`; localStorage "decks" (JSON) + "activeDeck" (id). API in deck.js: `loadDecks`, `saveDecks`, `activeDeck`, `setActive`, `newDeck(decks,name,cards,field)`, `addCard(deck, card, byId)` (returns error string or ""), `removeCard`, `validate(deck, byId, banned)` -> `{checks[{ok,text}], badCards:Set, complete, count, slots}`, `randomFill`, `toText/fromText` (name lookup by norm(name)+aliases, `# Name`, `Field: X`, `5★ Name` lines), `encode/decode` (base64url JSON `{n,c,f}`), `ttsSave(deck, byId, raw)`, `download(filename, text)`, `printSheet`. Hand rules are constructed-format specific (HAND tiers: creatures 5★x1,4★x2,3★x3,2★x1; items 4★x2,3★x3,2★x3,1★x2 ) so validate/addCard are NOT reusable for tables; the generic pieces are below.
- Share links: `deckUrl(d)` = `${ROOT}d/#/deck/<code>`; dist/d/index.html is a copy of the SPA with `<base href="../">`; `renderDeck` with `r.arg` decodes it read-only (`S.shared`). Card share = `c/<id>/` static pages generated per card. Any new top-level path needs a build_site.py addition.
- Reusable: no drag and drop anywhere (grep: none; slots are click-to-pick). Card search widget = `openPicker(tier)` app.js: a dialog holding the shared pick.js panel (section 9; since 2026-10-21, the old `#picker-q`/`data-pick` dialog is gone) with `filter` = the tier (or field ≤3★), parsed, not in the hand, `tile` = `tileHtml(c,{small:true,constructed:true})` (the Banned flag); `onChoose` runs `D.addCard` (its refusal is a toast and the dialog stays). Slots: `.slots` grid, filled `.slot.filled[data-open]`, empty `button.slot[data-action=pick]`. Deck list sidebar: `.deck-list` buttons (`deck-select`), actions New/Duplicate/Delete (confirm()). Name edit: inline `<input id=deck-name>` with `change` listener. Existing "Download for TTS" (`deck-tts`, app.js:684) exports a saved-object `{ObjectStates:[Deck{Name:"Deck",Nickname,DeckIDs,CustomDeck{key:{FaceURL,BackURL,NumWidth:1,NumHeight:1,BackIsHidden:true,UniqueBack:false,Type:0}},ContainedObjects:[Card{CardID:key*100,Nickname,Description,Transform,CustomDeck}]}]}` (deck.js:151-188): useful as the reference for the save's Card/Deck schema; creature CardIDs keys 1+, items 101+, field 201. TTS card scale z = (th/tw)/1.4.

## 5. Build pipeline / large file
- dist/ is NOT a copy of the repo. build_site.py (1816 lines) writes only: data/*.json (8 since analytics.json, 2026-10-22) and data/details/<id>.json, assets/ (from site/assets), thumbs/, icons/, c/<id>/index.html (773), u/<login>/index.html, decks/<owner>/<slug>/ (index.html, og-<key>.jpg), d/index.html, index.html, 404.html, og.jpg.
- Large data handling already in code: lazy-loading of the big optional JSONs (history/versions/rules) via memoised promises; first screen only needs 409 KB cards.json; `content-visibility:auto` on tiles; `loading="lazy"`; thumbs at 240/360/720. Nothing deals with CORS errors besides the jsDelivr `error` fallback on old-version images (app.js:408). No streaming/worker use; JSON.parse of 5.5 MB on main thread takes ~30-60 ms, fine; JSON.stringify for commit similar. Inline tree `content` for 5.5 MB works (tree API accepts up to 100 MB), but request body is a JSON-escaped copy (~6-7 MB) and the PATCH-retry loop re-uploads it each attempt.
- Build speed and safety (2026-10-21, AutoCroissant BUGS §1.6). `site/.cache/images.json` = `{version, images: {PNG blob sha: [tw, th, color]}}`; `make_images(path, sha, known)` returns the cached row while all 4 files of the blob exist, else makes them and computes `accent_color` (now in the thread pool); the file is rewritten each build with the used blobs only; `IMAGE_META_VERSION` (`3:<IMAGE_WIDTH>`) drops it when the settings change: bump its `3` when `accent_color` or the resize changes (`IMAGE_META_WEBP` rows are accepted too, §28). Icons are cached by blob in `site/.cache/icons/<sha16>-<ICON_VERSION>.webp` (pruned like img/; `ICON_VERSION` = `1-<ICON_SIZE>`: bump its `1` when build_icons' crop or WebP settings change, since site.yml's restore-keys bring back older caches and a cached icon is never redrawn). `link_or_copy` hardlinks cache -> dist/thumbs and dist/icons (copy on OSError; an existing thumb is skipped, an existing icon replaced so the last same-named icon wins as before): safe because cache files are only ever replaced (`.tmp` + `os.replace`) or removed, never written in place; nothing may write into a dist thumb or icon. Local warm build 7.0-7.7 s -> 3.7-4.2 s (user CPU 3.6 s -> 0.6 s; the rest is the 4 fetches and the dist rmtree/writes). Pickles: the loader (`_Unpickler`, `PICKLE_GLOBALS`, `_STUBS`, `load_bot_pickle`) went 2026-10-25; db/ records become `_Obj` stand-ins (`stand_in`/`card_of`), and `bot_field_warnings` still runs after loading: every `CARD_FIELDS` / `STATS_FIELDS` (card and creature stat lines) / `HISTORY_FIELDS` (old_stats) missing on any object, and any field outside `CARD_FIELDS | CARD_FIELDS_OPTIONAL` / `STATS_FIELDS`, is a `warn()` (log line, plus a `::warning` annotation under GitHub Actions, `%`/CR/LF escaped). `load_image_meta` drops rows that aren't `[int, int, "#rrggbb" or null]`. A new CardInfo field in the bot means adding it to one of the two sets. Nothing in TTSCardMaker unpickles (the workflows' bot modules read JSON).
- PSD pending (2026-10-21, AutoCroissant EDIT_PIPELINE_DESIGN §9): `apply_edits(entry, edits, psd_sha, shown)` marks a PSD field pending as `psd_edit.classify` would try it: a value set (null stats are never baked) and unlike the PSD; a `name` against `shown` = the bot's title (`parsed_values["name"]`, else `display_name`), else the file name, through `printed()` (= `title_text`), only for cards with `parser_version` >= 2 (older pickles never read titles: no name pending); an `ability` through `ability_text()` (= `normalize_ability`). On the 2026-10-21 v2 sweep it matches `psd_edit.classify` (not `bake_card`'s earlier gates) on the real PSDs: 6 name jobs plus Sans and Papyrus (pending until the pipeline refuses them, no readable Text/Name), 21 already printed. A duplicate's own name edit is never pending, and a duplicate copies its original's pending fields but `name` (it prints its own title).
- Baked verdicts (2026-10-24, AutoCroissant BUG 2): a bake with flags (content it drew best-effort: overflow, typed tokens, word styles, font stand-ins) keeps its `_psd` verdict, alone once no field is left; `apply_edits` puts a baked verdict's reason in `baked` while `psd` is the tree's blob (before any field check: a verdict-only entry adds nothing else), and the card page shows it as "Image baked: ...".
- Not done: no prediction of a refusal before the pipeline writes `_psd`: shown "PSD pending" until then are Sans and Papyrus (the Details record's `template.name_layer` could tell), stars and types (never baked yet), an original with numbered PNGs and its duplicates, stats beside a `creatures` list, a card with no PNG; a staged, unpublished edit shows no "PSD pending" until it is published.

## 6. Gotchas
- Sticky headers (2026-10-22): `position: sticky` pins to the nearest scroll container, so `table.data th { top: 52px }` (under the bar) only works where the page scrolls; inside a wrapper with overflow other than visible/clip it lands 52px down over the first rows. `.table-wrap` (scrolls itself) resets th to `top: 0`; `.scroll-x` scrolls only at <=980px, where the bar wraps to 104-171px and page tables' th get `top: auto`; `.filters`/`.toc` sit at 112px for 861-980px. Desktop bar is 56.75px (line-height 1.45 makes it fixed), so th pins at 56px; `.page` and the Stats sections (`#stats-balance`, `-ratings`, `-history`) have scroll-margin-top 70/117/184px for the one-, two- and three-row bar. At 981-1200px the brand text hides and `.search` may shrink (min-width: 0), so the bar never widens the page; the cards table (812px+) outgrows its column there, so in `.browse` it scrolls sideways with th `top: auto` up to 1200px.

## 7. Profiles (2026-10-21)
- Files: `site/profiles/<login>.json` (format: `site/profiles/README.md`). Opt-in; one file per GitHub login; the login field must match the file name exactly (the editor reads, replaces and removes the file by that spelling, and keeps it when the signed-in login differs in case; `#/u/<login>` is matched without case and the address bar is rewritten to the file's spelling).
- Module `assets/profile.js`: pure `validateProfile(raw, ctx)` -> `{profile, errors}` (ctx = cards Map, series Set, people list; the same rules as `clean_profile` in build_site.py: LIMITS, PICKS, ITEM_KINDS), `profileFile(p)` (sorted keys, 2-space indent, trailing newline = Python `json.dumps(sort_keys=True, indent=2, ensure_ascii=False)`; the editor's unchanged-form check compares these texts, since the build writes keys in another order), `deckCode(text)` (share link or code -> code), `mergeUsers(published, pending)`, `cardsBy(author, cards)`; and the profile page `profileHtml(x)` (everything through `esc`, links only to `#/…` routes). The users table `usersHtml` became the People table (section 8).
- Routes (app.js): `#/u/<login>` (view `u`, tab highlight `users`) and `#/users`; `parseHash` recognises the static paths `c/<id>/` and `u/<login>/` (STATIC_PAGES) when the address bar has no hash, `syncUrl` rewrites `#/u/<login>` to `u/<login>/`, and `hashOf(r)` supplies the hash `route()`/`rerender()` need when the URL has none. `data/users.json` loads lazily (`loadUsers`, like rules.json) together with `contributions.json` (section 8). Key `6` = People (the tab was labelled Users until 2026-10-21, a label decision for the owner to confirm; `data-tab`, routes and pages kept their names, so it is one word in index.html to undo).
- Editor (edit.js): `stage.profiles = {login: profile | null}` (null = remove the file), counted and reviewed with the batch; `openProfile(login)` (own profile, or anyone's for admins; `publish()` refuses a batch holding someone else's profile unless the signed-in user is an admin) goes to the editor page (section 9; until 2026-10-21 a dialog), whose form reads back through `validateProfile`; publish adds `edits["site/profiles/<login>.json"] = t => profileFile({...p, updated: at})` (or `false` to delete: `commitFiles` turns `false` into a tree entry with `sha: null`) to the same single commit; the sent record (`edit-sent`) carries `profiles` too, so the page shows "Publishing…" until the site rebuilds. Public API additions: `profileOf(login)`, `pendingProfiles()`, `profilePage(login)`; `openHub(note, then)` takes a callback now. `app.onAuth()` updates `#account` on sign-in/out; `app.users()`, `app.goUser()` are the other new hooks; the editor page's are `app.view`, `app.route()`, `app.tile(card)`, `app.kinds`, `app.kindOf`, `app.savedDecks()` and `app.goEdit(login)` (section 9).
- Build (build_site.py): `read_profiles(cards, people)` -> `data/users.json` (`{"users": [...]}`, sorted by login; added to `files`, so hashed into the build version) and `u/<login>/index.html` via `share_page` (the card pages use it too) with Open Graph tags (`profile_text`; image = the favourite card's og.jpg, else og.jpg). Never fails the build: bad file skipped, bad field dropped, each with a `warning:` line; 16 KB cap per file. `data.files.profiles = "site/profiles"`.
- Avatar, GitHub link, Share, counter (2026-10-21): `avatarHtml(login, px)` / `githubUrl(login)` (profile.js) build `https://avatars.githubusercontent.com/<login>?s=<2×px>` (lazy, `alt="<login> on GitHub"`, no referrer) and `https://github.com/<login>` only when the value passes `LOGIN_RE`, else ""; the login is the profile's (`profile.login`, People row `githubOf(r)`) or the person's `github` from contributions.json (section 8), never profile text or a git name. Person page: 48 px in the `h2.person-name` plus a "GitHub: <login>" fact; People table: 20 px `a.face` before the name (an empty `span.face` keeps the column aligned). The page's Copy link became **Share** (`share-user`): app.js `openUserShare(name)` shows `shareDialogHtml` (profile.js: link + Copy link, the Discord embed with the build's preview text `contributions.json previews[name]`, the favourite card's 360 thumb or og.jpg, Copy as Discord message, Copy plain text, Share… when `navigator.share`); `personDiscord` is the name as a `<…>` link (no preview) + `contribLine` + `cardsLine` (the JS twins of `contrib_text` / `cards_text`, byte-equal on today's build), no motto or pairs, so it carries no link from profile text; Copy plain text and Share… use `personText` (the same without markdown or the link; Share… without the name), not the preview, since the preview holds the motto and Discord auto-links URLs in pasted text; a staged or just-published profile gets a note that the preview is the published page's. `personAt(name)` resolves profile and person as the person page does. Counter: `#people-count` (index.html, the deck counter's `.count`) from cards.json `peopleCount` (build `people_count`, = `peopleRows(...).length`: contributors plus profiles no row takes) at boot, then `rows.length` whenever the table renders (pending profiles included).

## 8. People: contributions (2026-10-21)
- Build (build_site.py): one `git log --raw --no-renames --no-abbrev --format=%x01%H%x09%ct%x09%aN%x09%aE%x09%s -- *.png *.PNG *.psd *.PSD 'MDW/Card Edits.json' 'site/Card Edits.json'` in `git_history()` (runs in `HISTORY_REPO`, = REPO; a test wrapper points it at a full-history `--filter=blob:none --no-checkout` clone), parsed once by `parse_history(text)` into `(sha, ts, name, email, subject, [(status, old blob, new blob, path)])` newest first; None in a shallow clone. `image_versions(paths, commits)` consumes the PNG entries exactly as before (same output: checked byte-equal against the previous implementation on the full clone); `contributions(cards, people, profiles, edits, commits)` consumes the rest. Measured on the 547-commit clone: 500 commits in the walk, 1.45 MB of text, 0.1 s; parsing + counting 0.02 s; contributions.json 4.1 KB.
- Keying: `credit(key, people, by_login)` = the `author` of the profile whose login is the key, else `[people]`, else None; `who(name, email, people, by_login)` = credit of the git name, else of the login in a `[<id>+]<login>@users.noreply.github.com` email, else the git name as written; a login (`_by`, `Edit-by`) goes through `contributions`' `key_of` = `login_rows()` (credit, else the key its noreply commits credit most, a pre-pass over the history; made once in main() and also used for ratings' `by`, `edit_batches`' credits and `commit_keys`' Edit-by logins), else the login as first spelled (case-insensitive, so `Croissant2`/`croissant2` are one row; a bake counts once per row named). `BOT_AUTHOR = "AutoCroissant"` is skipped as a commit author and as a `_by` stamp. Each person carries `logins` = {key} ∪ profile logins whose author is the key ∪ `[people]` left-hand sides mapping to the key ∪ the GitHub logins seen for them (noreply, `_by`, `Edit-by`), kept only where `row_of` (credit, else noreply) lands on the key, one spelling per name (so a login sits in one row; the client's `personOf` matches a profile by login first); the client matches `editBy` against it, and `findPerson` / `personOf` match by it, so `#/u/JasonBechdolt` (a deck's "by" link) opens Chestnut's page and a profile under that login joins Chestnut's row: one page, one row, private decks listed once. Split identities merge through one `[people]` line (Michael/MichaelJSr: same email, different git name, no login involved) or a profile's author field when the other name is the GitHub login (Chestnut/JasonBechdolt, Croissant/Croissant2), never code.
- Counts: cards = visible non-duplicate cards with `author == key`; edits = commits where an edits path is `M`, or `A` with a blob not deleted in the same commit (the MDW -> site move is not a batch: 7 commits touch the file today, 6 count); card commits = commits with an `M`, or an `A` whose blob no `D` in the same commit gave up (a pure move isn't a change: the 2025-02-12 `Auxillary/` -> `Auxiliary/` rename, folder reshuffles), of a `.psd`/`.png` under CARD_FOLDERS or OLD_CARD_FOLDERS (`Auxillary/`) without SKIP_PARTS or RULE_PARTS (`Rules`, `Rulebook`: rulebook pages), one per commit; `recent` = the last 10 card commits as `[ts, subject, distinct card stems]`; `first`/`last` over both kinds. Fallback without history: distinct `(_by, _at)` stamps from Card Edits.json (bot excluded), `available: false`. Today (full history, 390 card commits): MichaelJSr 237/6/65 (with Michael, through `[people]`), Chestnut 178/0/48, hdckighfkvhvgmk 125/0/55, Croissant 93/0/133, bobberlington 82/0/18, Zomoroko 20/0/61, TyKim182 17/0/10, Tyler9648 13/0/0.
- Titles: `TITLES` (build) = `TITLES` (profile.js): cards -> Top card maker, edits -> Top editor, commits -> Top committer; the top count per column, ties share, nobody at 0; plus `OVERALL` (below). `titles_of` feeds the Open Graph text (`contrib_text`: "Top committer · 93 cards · 133 card commits", appended to `profile_text` for profiles, cards left out when the profile already says "N cards by X"); `titlesOf` in profile.js computes the same for the pages, so the JSON carries no titles.
- Data: `data/contributions.json` = `{available, since, people: [{key, logins, github?, cards, edits, commits, first, last, recent, recentEdits, months}], previews: {name: text}}` people sorted by cards, commits, edits, key (the fields after `recent` are below). Static pages: `u/<key>/index.html` for each contributor without a profile (login or author matching), only for keys matching `PAGE_KEY_RE` (folder-safe) and no profile's login (any case: that page and preview stay the profile's); 8 today.
- Client: `loadContrib` (memoised, like `loadUsers`); `usersReady` awaits both. `renderUsers` -> `peopleRows(people, mergeUsers(...))` (contributors with their profile attached via `personOf`, then profile-only rows) -> `peopleHtml` (one `table.data` in a sideways-scrolling `.scroll-x`: Person | Cards | Edits | Card commits | Decks | Titles | Motto; toolbar "N people · since <date>", or "commits not in this build"). `renderUser` resolves `#/u/<arg>` to a profile by login as before, else to a person by key or login (`findPerson`), then to that person's profile if one of their logins made one (the address bar is rewritten to the profile's login); `personHtml` = `profileHtml` + a Contributions panel, or a plain header + contributions for a contributor without a profile ("Make your profile" only when the signed-in login is one of the person's logins). `contributionsHtml`: facts (cards -> `#/cards?author=`, edits, card commits since, title chips), "Recently edited cards" = visible cards whose `editBy` is one of the logins (the surviving last batch per card), "Recent card commits" = `recent`. The Database edits tab's "Edited on the website or in Discord" names link to `#/u/<login>` (a Discord name never).
- Added 2026-10-21. History format `HISTORY_FORMAT` adds a second line per commit, `\x02` + the `Edit-by` trailers' values joined by `\x1f` (`%(trailers:key=Edit-by,valueonly,separator=%x1f)`); `parse_history` returns a 7th element, the values that pass `LOGIN_RE` (a value with a space is dropped whole, not split). **Bake credit (decision)**: a commit by `BOT_AUTHOR` that changes a card file (`touched`, as for anyone) is one card commit, in `recent` and `months`, for each row its `Edit-by` logins name (`key_of`, above; the bot's own login skipped); never an edit, since the editor's publish commit already counted the batch (the bake also rewrites Card Edits.json); a bot commit without trailers, or touching no card file (a run that only drops redundant fields or writes refused verdicts), counts for nobody, as before. Since 2026-10-22 a bake run is one commit for all its cards (AutoCroissant `card_bake`: `Card edits: 5 baked, …`), with one `Edit-by` trailer per baked card and editor: the row's `recent` entry counts its own trailers as its cards (not `touched`, the whole run's), and an editor's card commits count one per run, no longer one per card. Card commits count authorship of a changed card, and the editor asked for this change, so the card commit is theirs rather than the bot's. AutoCroissant writes the trailers (`card_bake`, one `Edit-by: <login>` line per baked card and editor in the commit message's last paragraph, sorted).
  `github` per person: the login of their profile when they have one, else the most counted of the logins in their noreply commit emails (one per commit), `_by` stamps in Card Edits.json and `Edit-by` trailers (ties by name); absent when none (bobberlington, hdckighfkvhvgmk, TyKim182, Tyler9648 today: plain email addresses). Today: MichaelJSr, JasonBechdolt (Chestnut), Croissant2 (Croissant), Zomoroko. The person page and the People table count decks owned by it too (a contributor publishes decks as their login).
  `recentEdits` = the last 10 edit batches `[ts, subject, sha]` (the person page's "Recent edit batches", the date linking to the commit when `sha` is 40 hex and `repo` is owner/name; the subject is escaped text, never a link). The cards.json list (last batch per card) is kept above it as "Recently edited cards".
  `months` = `[["YYYY-MM" UTC, cards, edits, commits]]`, months with activity only, sorted: cards by the card's `created` (else `fs`; "Cards created", 2026-10-23, was the first upload), edits and card commits by commit time. profile.js `activityHtml(p, x)`: `monthRange` fills every month from the first to the last, one stats.js `columns()` row (exported with `card` as `chartCard`) per kind the person has, colours `--s1`/`--s2`/`--s3`, each on its own scale (the 2023-11 import month holds most cards: MichaelJSr 222 of 237, so a shared or stacked scale flattens everything else), labels every ⌈n/9⌉ months, the stats.js Table toggle (months with activity) and hover values; shown only with history (`available`), between the Contributions and Cards panels; on a phone the chart keeps a 600 px minimum width and scrolls sideways (`#chart-activity`, style.css) rather than shrinking its 940 px viewBox to unreadable text (the stats.js charts still shrink). The `previews` map (`{name: link-preview text}`) is computed once in `main` and used by both the static pages and the share dialog. contributions.json: 3.7 KB -> 7.2 KB (7.5 KB with today's history).
  Overall title: `OVERALL = "Top contributor"` (build and profile.js), the top total of cards + edits + card commits, ties share, nobody at 0, listed before the column titles (so the Open Graph line starts with it). Today MichaelJSr (308).
- Round 3 person stats (2026-10-24). Build: `contributions(..., balance=None, revisions=None, archived=(),
  fields_by=None)` (positional calls unchanged) ends with `person_extras()`, which adds per row, each key left out when
  empty: `power` (P2: own cards' analytics `z_total`, `{n, z, top, bottom, dots: [[id, z, top|bottom?]]}`), `bal` (P1:
  own cards' analytics rows with `bal`, delta = new total - old; `swing` [id, delta, ts] the largest, shown as "Biggest
  swing"; `madeBuff`/`madeNerf` = rows on others' cards made by them; present with `power` so the page shows `No buffs
  or nerfs recorded yet.`), `revisions` (P3/P12/P13 from stats' `card_revisions` counts, `{self, others, top, theirs,
  most?, untouched, oldest?}`; absent without history), `rework` (P11: `analytics.reworked` rows), `ratings` (P4:
  `rating_now(..., skip=K)` per own card, `best` up to half of the rated cards, `worst` the rest rated below them),
  `selfBias`/`rater`/`powerVsStats` (P5/P7/P8: only for a person with entries of their own on either scale (P7's twins:
  favorability raters), never "group"; correlations at `MIN_RATERS = 5` cards, P5 at 3), `editFields` (P21:
  `edit_batches(..., fields_by=)` counts every changed field of every batch they are credited with, all time, before the
  `BATCH_LINES` cut, a Card Authors.txt line as `author`, not in the commit that created that file, an import of 813
  credits; plus `rating` = their website ratings), `archived` (P17: `archived_cards` rows with their `author`, slim
  `ARCHIVED_PERSON` fields, newest first). Top level `site: {z}` = the mean `z_total`. Who made a change row
  (`change_by`): the commit that added or changed a PSD at its second (`psd_commits_at`, credited by `commit_keys`);
  with two, the one with the card's PSD file name; else nobody. main() calls `edit_batches` once for all time and keeps
  the last `CHANGELOG_DAYS` for changelog.json. contributions.json: 9 KB -> 24 KB (rehearsal data). Client (profile.js,
  from cards.json and `S.mentions`/`S.mentionedBy`, no other file): `styleOf` (P6; ratio = their share / all cards'
  share, n >= 3, ratio >= 1.5, top 3), `mixOf` (P10), `careerOf` (P14), `seriesOf` (P15, ties share a lead),
  `mostReferenced` (P16, n >= 2), `ranksOf` (P18: competition ranking; strength at `power.n` >= 5, words per ability at
  5 abilities), memoised per cards array (`route()` renders twice). Panels after the activity chart: Balance, Ratings,
  Revisions, Style, Cards (+ years, series, banned link, most referenced), Archived cards (changes.js `archiveTagHtml`),
  Decks. The strength strip's dots carry `data-card`/`data-v`/`data-l` in a `.chart`, so the chart tooltip and
  click-to-open work; on a phone it keeps 760 px and scrolls. app.js `FLAGS` gains `banned` (`c._banned`).

## 9. Profile editor page, card picker, Cards panel (2026-10-21)
- Route `#/u/<login>/edit` (app.js): `parseHash` returns `{name: "u", arg: login, edit: true}` for exactly three segments ending in `edit` (any other extra segment still joins into `arg`); `hashOf` appends `/edit`; `syncUrl` leaves it a hash route (no `u/<login>/` rewrite, so the static page never gets an `edit` folder); the title is "Edit profile", the tab highlight stays on People; `goUser` ignores the edit route when deciding "already there", `goEdit(login)` is its twin for the editor. `renderUser` hands the route to `editor.profilePage(login)`, which renders into `#view`: signed out -> a placeholder plus the sign-in hub whose `then` reopens the editor (while the stored token's sign-in is still running, "Signing in…" and the editor appears when it settles: `init` now re-renders after a failed sign-in too); not own and not admin -> toast and `location.replace` to the person page; else it awaits `users.json` (the "Loading the profile…" placeholder only before its first load), checks it is still the page to show (no newer `profilePage` call, and `S.listHash`, the view's route, unchanged: `location.hash` would be the card's while a card dialog is open above the editor, and `rerender()` under a dialog re-renders `S.listHash`), and builds the form from the in-memory draft (`drafts`, a Map by lowercase login, set while the form differs from the profile, cleared on Add to batch, Cancel and Remove) or from the profile.
- Form (edit.js `profilePageHtml`): `form#edit-form.edit-form.panel` with `data-login`, ids `pf-*` (the card dialog keeps `ef-*`; both forms share the id `edit-form`, so the dialog's lookups are scoped to `app.modal` and `edit-cancel` takes the modal's form first). Layout `.profile-edit`: form left, `aside.edit-preview` right (sticky) with `profileHtml({..., preview: true})` = the profile section without its buttons and state; one column under 980 px. Card slots `.pslot[data-slot]`: the chosen card's small tile (clicking it opens the card, as anywhere) or an empty `.slot`, Pick (`data-pf-pick`) and Clear (`data-pf-clear`), a hidden `#pf-<slot>` input holding the id. Featured hand: `#pf-deck` hidden input with the share code, `#pf-hand` showing the decoded name and size, buttons per saved hand (`data-hand=<deck id>`, from the `app.savedDecks()` hook; the code is `encode(deck)` at click time, so later deck-builder edits don't follow; an empty hand is disabled), and `#pf-deck-link` where a pasted link or code moves into `#pf-deck` as soon as it decodes (Enter there and in the picker's search box is swallowed, so it never submits the form); text left in the box didn't decode, so `update()` adds "Featured hand: not a deck builder share link" to the summary and Add to batch refuses, while the hand itself (`#pf-deck`, the preview, the draft) stays as it was. The hooks the page uses from app.js: `view`, `route()`, `tile(card)`, `kinds`, `kindOf`, `savedDecks()`, `goEdit(login)`. Pairs: `.frow` rows with a remove button; one blank row when there are none. `readState(form)` -> the `profileState(p)` shape (exported, with `savedHands(decks)`; the one-off node checks exercised them) -> `validateProfile({login, ...state})`; `update()` on every input/change outside the picker writes the summary (`#pf-summary`), the preview, `form.dataset.dirty` (via `sameProfile`, now exported from profile.js) and the draft. Submit stages exactly as before (`stage.profiles[login]`, or deleted when equal to the live file) and `goUser`; Cancel confirms when dirty and `location.replace`s to the person page (the editor leaves no history entry behind); a `beforeunload` prompt fires while any `#edit-form` is dirty (the card dialog included). The hub's Edit profile, the person page's buttons and the review dialog's Edit all go through `openProfile` -> the route.
- Keyboard (app.js): every single-key shortcut (`/`, `?`, `r`, `1`–`6`, the card keys) is off while any `#edit-form` is on the page (and, since section 10, while a stat row `.segs[data-inline]` or a contenteditable element has focus; the inline controls are inputs, so the old test covers them); Escape still closes a dialog. One exception: Enter on a focused tile (`[data-open]`) opens the card as a click does, form or not, unless a form is in the dialog (the card's All fields form above the page); while a dialog is up only its own tiles do (a page tile under the hub, reached with Tab, doesn't). This also stops shortcuts firing from a focused button inside the card edit dialog, and the card keys (`c`, `x`, `d`, the arrows) in a card dialog opened from a tile on the editor page, since the page's form stays in the DOM underneath. `actions.close` only treats a form inside the modal as the thing to cancel.
- Picker module `assets/pick.js`: `mount(container, {cards, filter, onChoose, placeholder, tile, kinds, kindOf, initial, focus})` (`cards` may be a function, read on each search: the deck builder passes `() => S.cards` so a `derive()` under the open dialog shows; chips are counted at mount; one placeholder, the default, for both) renders a search box (search.js `compile`, 120 ms debounce), kind chips (only kinds present after `filter`, in `kinds` order with counts) and stars chips, and `.grid.picker` of 120 px tiles made by the `tile` callback (app.js `tileHtml(c, {small: true})`) with `data-open` rewritten to `data-choose`, so the document's click listener ignores them; the panel's own listeners (on the element it creates, so re-mounting drops them) choose on click or Enter. `pickList` (pure: filter, query, chips, by name as app.js `sortCards(..., "name")`, capped at `CAP` = 240 with a "narrow the search" note) and `facets` are exported. Item slots pass `filter: c => ITEM_KINDS.has(c.type)`. The module is generic on purpose and the only picker: the deck builder's slot dialog (`openPicker` in app.js) mounts it too, with its tier as `filter` and the Banned flag through `tile`. `mount` also takes `initial` (`{query, kinds, stars}`; chips not shown are dropped) and `focus` (false: leave focus alone); `read(container)` returns that state from the DOM (the typed text even before the debounce), or null.
- Rebuilds (edit.js `keep()`/`carry`): before `profilePage` replaces the page it reads, from the same login's form in the view, what the draft doesn't hold: the link box's text, and the open picker's slot (`#pf-picker[data-slot]`) and `pick.read` state. The next build of that login restores them (the text stays refused in the summary; the picker reopens with focus only when no dialog is up), so a `rerender()` (a card edit staged from a dialog above, show hidden cards, a Discard in the review dialog) and a sign out and back in keep them. A build of another login drops it, and so does any other page rendering (`renderView` calls `editor.leave()` off the editor route), so signing out, leaving and coming back starts fresh; Add to batch, Cancel and Remove forget it with the draft (`forget(login)`).
- Cards panel (profile.js `cardsPanelHtml`, after the Contributions panel on every person page with cards, profile or not): `cardsOf(author, cards)` (visible, non-duplicate, not hidden; `cardsBy` counts it; no author -> nothing, so the two author-less image-only cards belong to nobody), `cardFacts(list, {kindOf, kinds, recent})` -> kinds by count (ties in KINDS order), the three biggest series, the newest card by `createdTs` (created, else fs; null when no card has one) and the 24 newest (createdTs desc, then fs, undated last, then name; 2026-10-23, was fs). Chips link to `#/cards?author=…&kind=…`, series to the series filter, "All N cards" to `#/cards?author=…&sort=new`. No "first card" fact (every veteran's first upload is the 2023-11-05/06 import), no stars bar, no most-revised fact.
- Build (build_site.py): `fs` = the oldest row of `image_versions` for every card with any history row (set before the "> 1" filter that gates `iv`/versions.json, cards only, never a `ts` fallback); `cards_text(key, cards)` = "120 items, 53 creatures, 32 field cards · mostly Hollow Knight, The Binding of Isaac" (the three biggest kinds with `KIND_PLURAL`, singular at 1, the three biggest series), appended as the last line of the profile pages' and the contributor pages' Open Graph description by `person_text(lines, cards_line)`: when the 300-character cap is near, whole series are dropped from the "mostly" list (then the list, then the line) rather than cut mid-name; `clip()` (the cap, now shared with `share_text`) still guards the result. The profile line "237 cards by MichaelJSr" and the cards line both carry counts on purpose: the first is the author link's total, the second the kinds. Measured on the full-history clone: 773 of 773 cards get `fs`; newest cards Chestnut: Slugcat 2025-08-28, MichaelJSr: Mol D. Truffy 2026-01-24, Croissant: Piko Piko Hammer 2025-08-29.

## 10. Inline editing in edit mode (2026-10-21)
- Design (NEXT_SESSION_PLAN idea 20): signed in, the card browser is the editor; three primitives (edit a value in place on the card page; drag tiles onto a Series or Author value; one batch bar of sentences with a revert each), the form kept only as **All fields**, no new popups or panels, view mode unchanged. Everything is gated on `editor.me` (`editing()` in app.js): the two mounts and the one template expression (`${editing() ? "All fields" : "Edit"}` on the card's Edit button) are the only edit-mode code in app.js's renders, so a signed-out page is byte-identical to before (the built `dist/assets/app.js` templates for openCard, tileHtml and renderCards differ from main only in that expression).
- Module `assets/inline.js` (DOM-free at import, like pick.js): a DOM *upgrade* after render, never a template change. `mountCard(modal, c)` (end of `openCard`) adds `data-inline=<field>`, `tabindex=0` and a `data-tip` to the `h2` (name, double-click), the `.ability` box or the "No ability text." paragraph (click), each `.segs` row of a single-creature card with a value ≤ 10 (`role=slider`, `aria-valuenow`, arrows/Home/End/Enter; rows above 10 and per-creature rows only get the tip "Use All fields"), the series/subseries/author chips (a duplicate's author chip stays a link: "Same as the original") and the `.note` block; missing series/subseries/author/note get dashed `+ series` placeholder buttons (`.ghost-fact`, `data-empty`) in `.facts`, visible only while `.facts` is hovered or one has focus (opacity, so no layout shift). `mountGrid(view, p)` (end of `renderCards`; `p` = the rendered list's params, so a re-render behind the card dialog, whose hash is `#/card/<id>` while the list is `S.listHash`'s, builds the filter bar for the list shown; `createBucket` reads the same) sets `draggable` on the grid's tiles, `data-selected` from `S.selected` (an `article` has no selectable role, so no `aria-selected`), " · N selected" in the result count, and inserts a `.drop-list` of `span.chip[data-value]` (every series, every author) after the Series and Author `<select>`s; `display: none` until `body.dragging-cards`. `install(api)` adds the delegated listeners once: pointerdown/click/dblclick/keydown/focusout on `#modal` (they run before the document listeners, so `stopPropagation` there keeps Escape from closing the dialog and the arrows from changing cards), dragstart/dragend/dragover/dragleave/drop on the document.
- Opening an editor replaces the element's content with a control (`control(f, v, list)`: `input.inline-name`, `textarea.inline-ability` sized by `fit(text)`, `input.inline-fact` with a `datalist#inline-dl` of the editor's `options()`); an `<a>` or `<button>` host is swapped for a `span` of the same classes (a link would still navigate, a button can't hold an input) and swapped back on cancel; other hosts restore their innerHTML. One editor at a time: opening another commits the first (if that commit is refused, the first stays open and gets the focus back). Commit = Enter (Ctrl/Cmd+Enter in the textarea) or focusout; an unchanged value just restores; a refused one (stageField/stageAuthor returned null with a toast: a name too long) keeps the input and its text, as in the filter bar, so it can be shortened or Esc'd; a focusout while `document.hasFocus()` is false (alt-tab, devtools) is ignored, so the editor survives a window blur. Esc cancels. A commit goes through `editor.stageField(id, f, v)` / `stageAuthor(id, v)` and then `goCard(id)` (the dialog re-renders exactly as after the form; the modal's scrollTop is put back); focus returns to the spot only after a keyboard commit (Enter, or a Tab-driven focusout: `relatedTarget` set and the last input a key, tracked by a `pointer` flag from pointerdown/keydown), since `openCard` blurs on purpose so the single-key shortcuts work after a mouse action. Stat cells: click cell N sets N, the top lit cell sets N-1 (`cellValue`) so 0 is reachable; a click while a keyboard change is unsaved counts from the saved value. Links (`a, .badge, img`) inside the ability box and the note still navigate on a plain click. Chips: a plain click edits (view mode filters; Ctrl/Cmd/Shift-click still follows the link).
- Ops (edit.js): the pure `mergeField(op, {pub, psd, edited}, f, v)` is readForm's rule for one field (equal to the published value: no entry; equal to the PSD's on an edited field: `unset`; else `set`; `op.name` follows a name edit), so a field staged inline and the same field staged by the form give the same op, and the form's whole-op replace agrees with the merged op. `fromInput` normalises the control's text (trim, "" → null, the name falling back to the published one, ints ≥ 0), `mergeAuthor` mirrors readForm's author line, `withoutItem` is the revert, `describeItems` gives each line as `{item, text, short, psd}` (`text` is the review dialog's unchanged string, `short` the bar's "SPD 4 → 5" with long values clipped), `barItems(stage, describe)` the bar's lines. `tidy`/`value`/`psdValue` moved to module level (the closure binds `S.byId` for dup_of) so node checks cover them without a DOM (a one-off `inline_ops.mjs`, not kept in the repo, incl. an `editsFile` regression against a snapshot from main). Closure additions: `stageField`, `stageAuthor` (a duplicate is refused: its author follows the original), `stageMany(ids, key, v)` (one save; returns how many ops changed, so a card already at that value isn't counted in the toast; since the buckets bullet below `{changed, dups, value, error}`), `revert(id, item)` (the bar's ↺, private); public API gains `stageField`, `stageAuthor`, `stageMany`, `value`, `options()` (series, subseries(series), authors = people ∪ authors on cards).
- Batch bar (`renderBar`, same `#edit-bar`, role=region): collapsed = one `.bar-head` line "✎ N unpublished changes · Goombella: SPD 4 → 5 · …" (N = the lines, one per field; the hub's "Review batch (N)" keeps `count()`, one per card; CSS ellipsis), a ▸ toggle (`edit-bar-toggle`, `aria-expanded`; only when more than 3 lines, otherwise the list is always open), Review and publish, Discard. Open = `.edit-bar.open` (14 px radius, 760 px, 40vh scroll) with `ul.bar-list`: `<a href=#/card/id>Name</a>: SPD 4 → 5 · on the card image` (the marker only for PSD fields, tooltip PSD_TIP; database-only lines carry nothing), ↺ (`edit-revert` with `data-id`/`data-item`, or `data-item=admins|people|profile` + `data-login` for the other kinds, quiet: no dialog) and All fields once per card. People are one line (one revert for the group, as the review dialog has one Discard). The sent-only state is unchanged. The modal (z 50) still covers the bar (z 40), as before: the bar is used from the list views.
- Selection (app.js): `S.selected` (Set of ids), `toggleSelect(id, range)` from the document click handler when `editing()` and Ctrl/Cmd/Shift is held on a grid tile (Shift = `rangeIds` over `S.list` from the last toggled tile); reflected in place (`inline.reflect`), never a re-render. Cleared on Esc with no dialog open, on sign-out (`onAuth`) and when `renderView` shows anything but the cards list; `renderCards` drops ids no longer in the list, so a drag never carries filtered-out cards. Signing in through the hub calls `app.rerender()` so the grid behind it gets its tiles and drop lists at once (the boot path already did). Drag payload = `dragIds(id, S.selected)` as `text/plain` ids; drop = `stageMany` + clear + `rerender` + toast "3 cards: series → Mario". `dragend` and `drop` both clear `body.dragging-cards` (a dropped tile may be re-rendered away before its dragend).
- Keyboard: Esc cancels an inline edit (and a keyboard stat change not yet saved) and otherwise closes the dialog; the typing guard counts `isContentEditable` and a focused stat row (`closest(".segs[data-inline]")`; a focused chip or the h2 leaves the shortcuts on); the help dialog's `e` line says "(all fields)" only in edit mode; inline controls are real inputs with aria-labels; the three primitives have keyboard paths except the drag (chips per card cover it).
- Decisions where the brief was open: drop targets are value chips shown only during a drag, under the two selects (a closed `<select>` can't take a per-value drop; dropping on the select itself would only ever assign the current filter value, useless since the filtered grid hides the cards you would drag); Ctrl/Cmd/Shift-click selection, no per-tile checkbox, table view not draggable; the "No ability text." paragraph is the ability editor's host on cards without text (no new chip); the note is a one-line input (no notes exist today; the form keeps the textarea); long values in bar sentences are clipped at 48 characters; the bar's reverts for admins/people/profiles are quiet (the review dialog's Discard buttons, which reopen it, are untouched). Left out as not agreed: stars, a token picker on "[", tag completion on "(", a type-row palette (stars and the palette since 2026-10-23: section 19), rulebook title/text in place, Hidden/ban drop targets (Subseries got one with the buckets below); rulebook pages keep their Edit button.
- New series, subseries and authors ("buckets", 2026-10-21; the owner: "in edit mode, we should be able to create new series and subseries and authors and more, to bucket cards into"). Idea 20's rules hold: no new popups or panels, one batch bar, view mode unchanged (signed-out pages rendered byte-identical to main under linkedom, stale buckets in sessionStorage included; the only app.js change is `params: () => parseHash().params` in the `inline.install` api).
  - Scope: only series (`series`, free text), subseries (`subseries`, database only, always inside one series) and author (`[cards]` of Card Authors.txt) get "New …": each is a value many cards share with a filter select and a chip editor. Not hidden/problems_ok/allow_high_stats (yes/no), not the ban list (its groups are star tiers of a rules document, each ban needs its own reason, admin-only, no filter facet: a bulk "banned" would be wrong data; stays in All fields), not kind/item type (rulebook categories: a new one is a rules change), not types/stars/stats (icons, numbers) nor aliases/note/dup_of/creatures (one card each).
  - Creating: `mountGrid` (now in the grid and the table alike; drop lists still grid only) appends to the Series and Author selects `<option value="" data-new-bucket>New series…</option>` / "New author…"; the Subseries select gets "New subseries…" with a series picked, else a disabled "Pick a series to add a subseries"; a picked series without subseries has no Subseries select in the template, so mountGrid inserts the same `<h3>Subseries</h3><select data-action="select-param" data-key="subseries">` after the Series select. A document `change` listener from `install` (registered before app.js's, app.js:985) sees the data-new-bucket option, calls `stopImmediatePropagation` (the filter doesn't change), hides the select and puts `control(key, "", [], true)` after it (`input.inline-fact`, aria-label "New series, Enter to save, Esc to cancel"). Document keydown/focusout listeners on that input: Enter or a focusout with text = `createBucket` → `editor.addBucket(kind, text, series)`; Esc or a focusout with nothing typed puts the select back at its `defaultSelected` option (Esc refocuses it); a focusout while `document.hasFocus()` is false is ignored, like the chip editors. A refused name (too long) keeps the input and its text, after Enter or a click away. Made: the "(no cards yet)" option and the dashed drop chip are added in place, no re-render (the hash untouched, and a click that ended the typing still lands on its tile or chip), toast "New series “X”: drag cards onto it under Series" (subseries: "… of Mario …"; in the table view "…: in Grid view, drag cards onto it"), focus on the select after Enter. Arrowing on a closed select past its last value (Windows and Firefox change the value in place; seen as a change within 150 ms of an arrow key) puts the select back instead of opening the input. No drop-on-"+ New" chip: the drop list only shows during a drag and typing in a drop would need a second state (possible follow-up).
  - A bucket before any card: browser only, never published, sessionStorage "edit-buckets" (`K.buckets`, `{series:[name], subseries:[[series, name]], author:[name]}`, read through `readBuckets`), so it survives a reload in the tab and goes with the tab or on sign-out (`signOut` removes the key). `options()` merges buckets into `series`, `subseries(series)` and `authors` (so the card chips' datalists and All fields' datalists offer them: a keyboard path without dragging), adds `ownSubseries(series)` (that series' subseries plus its buckets) and `buckets` = the pending ones, those no card in `S.all` (staged, sent or built; hidden included) carries by nameKey (subseries by [series, name]). mountGrid adds a pending bucket as `bucketOptions(have, list, picked)`: "X (no cards yet)" before "New …", skipped when the select already has that value (the template's `subPicked` option; with no series picked keyed by [series, name] through `optKey`, so Kirby's new "Paper Mario" is listed beside Mario's), `selected` when it is the hash param (with a series picked); a subseries one carries `data-series` (the select-param handler then sets the series too) and, with no series picked, says which ("Foo (Mario, no cards yet)"). Picking one shows the template's own "No cards match.". The session entry stays after cards carry it, so reverting every drop shows "(no cards yet)" again; a mistyped empty one goes with the tab and harms nothing.
  - Drops: the Series and Author drop lists gain the pending buckets first as `span.chip[data-value][data-new]` (dashed: `.drop-list .chip[data-new]`), via `dropChips`; a Subseries drop list goes under the Subseries select only with a series picked and holds `ownSubseries(series)`, so the grid is that series and a drop can't hang a subseries off the wrong one. `drop` → `stageMany(ids, key, v)` (key may be "subseries"): one op per card through stageField/stageAuthor/mergeField, one bar sentence each with ↺ ("Goombella: Subseries Paper Mario: The Thousand-Year Door → Pip Hills"); a drop changes exactly that field (a series drop keeps the card's subseries: the filter keys subseries by [series, subseries], and the user can revert or retype it; the toast adds "· 1 kept its old subseries" when the new series lacks it, `kept` in stageMany's result). Toasts "3 cards: series → X", "Already X" when nothing changed, "1 duplicate kept its original's author" (stageMany now returns `{changed, dups, kept, value, error}`; duplicates are skipped for authors). A bucket itself is never a bar line.
  - Names: pure `canonName(kind, raw, known)` at edit.js module level (with `nameKey`, `sameName`, `readBuckets`, `NAME_MAX` = 60): trim, collapse whitespace runs, empty = cancel quietly, a new name over 60 characters (code points: an emoji is one) refused ("Series names are at most 60 characters"), and a name whose `nameKey` (lowercase, no whitespace) matches a known one takes the known spelling (highest rank: a `[people]` line, else the most cards). The closure's `knownNames(kind, series, skip)` gives it every card's value (S.all; the card being edited left out, so the only card of a series can still be re-cased), the buckets, and for authors `S.data.people` plus every `peopleMap` left side mapped to its shown name (the bot's `CardAuthors.resolve` maps through [people] the same way, so the bar shows what the bot will). Subseries: the picked series' own spelling first; the same name in another series is allowed (made here with that one's spelling); already in this series: no bucket, toast "“Paper Mario” is already a subseries of Mario". Existing names, from "New …" (nothing made): "“mario” is already the series Mario", "“michaeljsr” is shown as MichaelJSr", plus why the filter bar doesn't list it (", on hidden cards only"; an author ", with no cards yet"); on a chip or in All fields the change still applies: "“mario” saved as Mario, its known spelling". So a series several cards share can't be re-cased from the site (each card snaps back to the others' spelling); the built data has no case or spacing duplicates today, and a whole-series rename is left to the owner. The same `canonical()` runs in stageField (series, subseries), stageAuthor, stageMany and readForm (form series, subseries, author; a value left as published is kept as is, a too-long new one shows in the summary, keeps the form dirty so Cancel and leaving the page still ask, and the submit is refused; the series is read once, the subseries uses it). stageMany spells its value once and passes it to stageField/stageAuthor with `defer` (no second spelling per card, so a drop walks the cards a fixed number of times): a drop chip's own value (it is in `seriesList()`, `ownSubseries(series)` or `authorList()`, the lists the chips come from) stays exactly as it is, so if the data ever holds two spellings of a name, dropping on either chip stages that one; other text goes through canonical(), so typing "mario" on a chip or in All fields gives "Mario" (before, it made a second series that the website split and the bot's case-insensitive `series==` merged). No characters are banned: series/subseries are JSON strings, an author is the right side of `Card = person` (bot `partition("=")`, site `split("=").slice(1).join("=")`); output still goes through esc().
  - Who and what is written: any signed-in editor (they edit these fields on any card already); ban, hidden, people, the admin list and others' profiles/decks stay admin-only (ban/hidden are gated only in the UI, the form's disabled Admin fieldset: `publish()` doesn't check `op.ban`/`set.hidden` as it does foreign profiles and decks; no new admin field here, so that hardening stays separate and optional). No new file or format: `editsFile` writes `"series":"X"` / `"subseries":"Y"` in ORDER, one line per card, keys sorted, `_by`/`_at` stamped, a cleared edited subseries `unset` (key removed, never null); `authorsFile` moves the `Card = Name` line into `# --- credited to Name (n) ---` and bumps the counts, a new name gets a new group before `# --- rulebook pages ---`, `[people]` untouched (a typed name isn't a login; an admin maps it later). Not changed: build_site.py, the data formats, the bot.
  - Checks (no browser; one-off scripts, not kept in the repo): `pure.mjs` (canonName: case/spacing duplicates, [people] logins, length, empty, hostile names; sameName; readBuckets; bucketOptions no duplicates and selected; newOption; dropChips; control), `closure.mjs` (createEditor on the built cards.json: addBucket rules, options merging and pruning, stageMany "subseries", revert back to no cards yet, canonical spelling in stageField/stageAuthor, reload, sign-out), `publish.mjs` (the same batch staged via buckets and drops and via main's editor gives a byte-identical commit; Card Edits.json and Card Authors.txt then load with the bot's `CardEdits.parse` / `CardAuthors.parse` and build_site's `parse_edits` / `parse_authors`: `resolve("Acro") == "Pip Squeak"`), and linkedom boots of the whole app (`boot.mjs` create/cancel/commit, drops one and many, duplicates, revert, table view, escaping, sign-out; `reload.mjs`; `form.mjs` chips and All fields; `fixes.mjs` the review's fixes: a subseries name shared across series, in-place creation, too long on focusout, emoji length, kept subseries, arrowing, table toast; `signedout.mjs` main vs working tree). The second review's fixes: `review2_closure.mjs` (a drop keeps a minority spelling's chip value; a 60-card drop walks S.all a fixed number of times, 126 before) and `review2.mjs` (a too-long chip name keeps its input; Discard behind the card dialog keeps Mario's filter bar; All fields stays dirty with a refused name), run from a copy of the checks pointed at this checkout.

## 11. Card details dropdown (2026-10-21)
- Design (NEXT_SESSION_PLAN idea 23): one `<details class="psd-details">` at the bottom of the card dialog (inside `.related`, after `#versions-slot`; app.js `openCard`), summary "Details", closed by default, open/closed remembered per session in `sessionStorage["psd-details"]` (`{details: bool, <section>: bool, "font:<name>": bool}`: the nested sections and each font are remembered too; a font's key is its name, so a font left open is open on every card that has it). Only cards with `details: true` in cards.json get it; share pages, view mode and edit mode are otherwise unchanged (inline.js only touches direct children of the right column).
- Module `assets/details.js` (DOM-free at import, like pick.js): `detailsHtml(state, open = state.details, id)` the element (closed unless `open`; `data-id` = the card id) with a "Loading…" body; `bodyHtml(rec, card, extras, state)` the sections as nested `<details class="sec" data-sec=...>`: Fonts (each font a `<details class="font">` with its layers; `supplied` false -> `.fact.refused` "missing from MDW/Fonts", null -> "not checked"), Text layers (table: layer, text with control characters collapsed, font, size, colour swatch for `#rrggbb` only, visible), Effects (`dl.pairs`, "(off)" muted), Smart objects, Canvas (one line), Type icons (wording per value), Stat rows (per stat, wording per value), Status-word layers (FX layers + overlay words), Template (name/ability layers, deviations), Parser (from cards.json: "Parser notes: …" as on the card page, a table of `orig` vs current for edited PSD fields using app.js FIELD_LABEL, "Also edited: …" for the rest, and `psdBadges(c)` passed in as `extras.badges`), Layer tree (`treeHtml`, rendered only when its section opens, or at once when remembered open; depth capped at 12, `["…","more",true]` markers from the bot shown as "… more"). Every string through `esc`; a section that is a string (the bot's "error: …") or missing ("Not recorded.") renders as muted text; junk types never throw.
- `mount(el, {card, load, storage, extras, outer = true})`: one capturing `toggle` listener on the outer element (toggle doesn't bubble) remembers the state (the outer element's `details` key only when `outer`; a section by `data-sec`, a font by `data-font` (escaped in the attribute; `dataset.font` gives the raw name back, so the key is `font:<raw name>`, the one `fontsHtml` looks up); each write is `remember(storage, key, open)`, a read-merge-write, since several dropdowns can be mounted at once; the body renders with the stored state re-read at load), fetches on first open (`load` = app.js `loadDetails(c)`, a memoised promise per card id, dropped on failure so closing and reopening retries) and renders the tree slot once. Enter/Space on a summary are the browser's own toggle; Esc is app.js's keydown closing the dialog before anything else. Keyboard note: a focused `<summary>` is not "typing", so the single-key card shortcuts (d, c, s, x, e) still fire with a summary focused (harmless, unchanged).
- Build (build_site.py): `DETAILS_JSON = "psd_details.json"`, read from CARD_DATA_DIR by `load_card_data` (until 2026-10-25 also fetched from AutoCroissant beside its pickles); `psd_records(data)` keeps `{sha: record}` only for the file's shape; failure or wrong shape -> "no PSD details: …" logged, `{}`, never a failed build (the old_stats pattern). `join_details(cards, records, tree)` after the image-version pass: record by `tree[psd]` (HEAD blob), else the entry's `_blob` (the bot's `blob_sha`, set in the main loop for cards and rulebook pages alike and popped from both right after), else the newest record (`at`) for the path; flags `details: true` and writes `data/details/<id>.json` (`{**record, id, name}`: the card's id and shown name over the record's PSD name, compact JSON) only when at least one card has a record (no `data/details/` dir otherwise). The data stamp hashes the files (`data_stamp`, §27).
- CSS: everything under `.psd-details` (summary styles, `.sec` left border, `.font`, table, `.swatch`, `.tree` monospace list, `.off` muted). index.html: a `modulepreload` hint for details.js.
- Checks (no browser): node --check on every asset; a node script importing details.js (escaping, all sections, supplied true/false/null, error strings, missing sections, junk types, empty/deep/marked trees, state helpers) and a fake-`<details>` walk-through (closed by default, one fetch per card, close/reopen, nested sections remembered, lazy tree rendered once, re-mount restores open sections, failed fetch retried); local builds with a 4-record fixture and with the fetch failing (exit 0 both; without the file: no flag, no details files, cards.json otherwise identical).
- Rulebook pages (2026-10-21): the bot gathers the rulebook PSDs too (48 of 48 pages have a record), so `join_details(cards + rules, …)` flags rules.json pages and writes their files (ids are unique across both: one `unique_slug`). `renderRules` puts `detailsHtml(state, false)` (always closed: one per page, so a remembered open would fetch all 48) under each page's text and mounts each with `outer: false` (opening one doesn't change the card page's remembered state) with `extras.page`, so `bodyHtml` leaves out Stat rows, Status-word layers and Template (on all 48 records: every stat "none", no FX or overlays, an empty template); Type icons stay (14 pages use image layers). The search box re-renders the rulebook, which closes them; the record is memoised, so reopening doesn't fetch. `.page > div { min-width: 0 }` keeps a wide text table scrolling inside the page.
- Has-details filter: removed at the owner's ask (2026-10-24), both the Cards tab's "PSD details" chip (`flags=details`) and the `has:details` search; an old `flags=details` URL is ignored.
- Links: `detailsLink(c)` (app.js) = a plain `a.fact.details-link` "Details" to `#/card/<id>?details` (no data-action: the document click handler returns on it before the `[data-open]` row, so the browser follows it and Ctrl/Cmd-click opens a new tab). `route` passes `params.has("details")` to `openCard(id, showDetails)`, which renders the dropdown open this once without storing it (`syncUrl` then drops the `?details` with the share URL); `mount` skips storing the first toggle of a dropdown rendered open (the browser may fire one for the parsed `open`), so only the user's own toggles are remembered. A re-render of the same card (`refresh`, `rerender`) keeps an open dropdown open (`was.dataset.id === id`); prev/next don't. Shown only beside PSD chips (`psdChips(c)` = `psdBadges(c)` plus the link when there are chips: the table view's Card column, the Database edits tab's "Edited on the website or in Discord" list) and after each card in the Changes tab's "Parser notes" list; nowhere else (on every table row it would be noise: nearly every card has a record).
- Checks for the above (one-off scripts, not kept in the repo): app_details.mjs (app.js under a stub DOM on the real build: filter and search counts, table and Changes links with and without a record, the `?details` link (open once, not stored, kept over a re-render, Ctrl-click left to the browser), 48 closed rulebook dropdowns, one fetch per opened page, card state untouched) and fonts_state.mjs (all 819 real records render with `data-font`, none open by default, escaping of a font name, merged writes across two mounts, `outer: false`, re-mount restores a font, storage off).

## 12. Published decks (2026-10-21)
- Files: `site/decks/<owner>/<slug>.json` (format: `site/decks/README.md`; the folder holds only that README until someone publishes). One file per published hand; `<owner>` is the publisher's login (the folder must match the file's `owner` without case), `<slug>` comes from the name (`slugOf`: lowercase, non-alphanumerics to `-`, collapsed, trimmed, `hand` when empty, `-2`/`-3` on a clash when the publish dialog's Keep both is chosen; the default replaces) and matches `^[a-z0-9][a-z0-9-]{0,59}$`. Public: `{v: 1, owner, name (1-80, one line), description (≤ 500), cards (0-40 ids), field|null, updated}`. Private: `{v: 1, owner, private: true, kdf: {name: PBKDF2, hash: SHA-256, iter: 300000, salt (16 bytes b64)}, iv (12 bytes b64), data (AES-GCM-256 b64), updated}`; the plaintext is the UTF-8 JSON `{name, description, cards, field}` (the name too), the AES-GCM additionalData is `deck:<owner>/<slug>` with the owner lowercase, so a file moved under another path does not open. 16 KB per file.
- Module `assets/decks.js` (DOM-free at import, imports nothing from app.js): `slugOf`, validation with the build's limits, `fileOf(...)` the public file object, `encrypt(subtle, passphrase, owner, slug, payload)` / `decrypt(...)` (PBKDF2 → AES-GCM through `crypto.subtle`, so https or localhost only), base64 helpers, `deckTileHtml`/`tilesHtml`, `deckPageHtml`, `browserHtml` and the filter/sort helpers on plain data; everything through `esc`.
- Routes (app.js): `#/decks` the browser (tab highlight `deck`; no new tab, keys 1-6 unchanged), `#/decks/<owner>/<slug>` one deck; the Deck builder page gets "Published decks (N) · Browse" (N = the public count from cards.json, no fetch) and a Publish… button per saved hand (Sign in to publish when signed out). `data/decks.json` loads lazily like users.json. Share links of hands stay `d/#/deck/<code>`. A public deck's share page (`decks/<owner>/<slug>/`, no hash) is parsed by `parseHash` on a cold load; `syncUrl` keeps that URL until decks.json is loaded (a decks route is never collapsed to the root) and `decksReady` re-enters through `renderView`, so the title follows.
- Browser: tiles (name, owner → `#/u/<owner>`, n cards, complete-hand mark from `deck.validate`, up to 4 small card images: the field card then creatures by stars; `deckTileHtml` keeps a lock-only branch for a private entry, but nothing renders one); filters text / owner / sort (newest, name, owner) / complete hands only; an empty state. Private decks are left out of the browser altogether (`browserHtml` drops them before the owner list, the filter and the counts; user decision 2026-10-21): a private deck shows only on its owner's person page and at its own `#/decks/<owner>/<slug>` link. Deck page: header, the hand grouped like the deck builder, the checks list, Save a copy to my decks, Share link, Copy as text, Discord, TTS save, Print; owner or admin: Unpublish and Replace with… (a saved hand; same slug and visibility; a private deck asks the passphrase again). Private page: an inline passphrase form (no `prompt`), "Wrong passphrase" inline, Remember on this device = localStorage `deckPassSealed:<owner>/<slug>` (owner lowercase), sealed by login.js `deckPasses` (section 17; plain `deckPass:` before 2026-10-23), with a Forget link. The passphrase form carries the Owner panel too (`ownerPanelHtml`: Unpublish, Replace with…), neither needing the passphrase, so a forgotten one strands nothing; a wrong passphrase keeps what was typed.
- Editor (edit.js): `stage.decks["<owner>/<slug>"]` = the file object exactly as the contract (a private deck is encrypted at staging time, so the passphrase never sits in the stage) or `null` = remove; one item in `count()`; bar lines kind `deck` ("Deck: <name> (public|private)" / "Deck removed: <owner>/<slug>"); review list and discard like profiles; `publish()` writes or removes `site/decks/<owner>/<slug>.json` in the same tree commit; the sent record keeps `decks` (like `profiles`) so the pages show "publishing…" until `S.data.generated` passes `sent.at`. Own decks only, admins any; the commit message says `private deck <owner>/<slug>` for a private one (its name lives only in the local `stage.deckNames`). Person page (profile.js `personHtml`): a Decks panel after the Cards panel (public decks as tiles, newest first; "🔒 N private deck(s)" with links to their pages, the only listing a private deck gets; "All decks by" only when there are public ones).
- Build (build_site.py): `DECKS_DIR = "site/decks"`; `read_decks(cards)` → (public, private), each newest first by `updated` (then owner, slug); `clean_deck(raw, folder, slug, visible)` → the decks.json entry or None with notes, `b64_bytes(value, size)` for the private shapes (standard base64, padding optional, exact byte counts; `iter` 1 to 5,000,000 so a browser can't be made to hang). Public hands are resolved against visible cards: an unknown or repeated id and a field that isn't a card are dropped with a `warning:` line and counted in `dropped`; a field card also in `cards` is kept once, as the field (a warning, not counted; decks.js `validateDeck` and `publicEntry` do the same, so `handCards` never shows it twice); `n` = cards + field. Skipped with a warning (never a failed build): not JSON, over 16 KB, `v` ≠ 1, owner not a login or not the folder, file name not a slug, no usable name, over 40 cards, a wrong private shape, or a second file for the same owner/slug (case-insensitive). Writes `data/decks.json` (in `files`, so hashed into the build version), `decks: {public, private}` and `files.decks` into cards.json, and `decks/<owner>/<slug>/index.html` for public decks only through `share_page`, which now sets `<base href>` from the depth (`"../" * len(parts)`; `c/` and `u/` pages are unchanged) and tolerates an existing folder: `<meta name="deck" content="<owner>/<slug>">`, OG title "<name> by <owner>", description = `deck_text` (the hand in words from `kind_word`: "7 creatures, 10 items, field card Deepnest", then the deck's description, clipped to 300) and as image a montage of its cards (Deck page previews below), else one card's og.jpg, else og.jpg. A missing folder still writes decks.json with empty lists, so the page never 404s. `updated` must be `YYYY-MM-DDTHH:MM:SSZ` (else ignored, sorts last); `v` and `iter` must be ints, not bools; an owner folder spelled differently from `owner` gives the folder's spelling (the path edit.js targets); a `.json` entry that isn't a regular file is skipped and an unreadable one is a warning (profiles too).
- Checks: py_compile; a wrapper build in a scratch folder against a fixture folder (two public decks of one login, one of them complete, the other with unknown ids and a bad field; a public deck of another login; a private deck made in node with the contract's algorithm, whose passphrase the fixture kept for the decrypt check; a file in the wrong owner folder, an oversized one, a bad JSON one and a short-salt private one, all skipped); a build with no decks folder and one with the real folder (README only): cards.json differs only in `decks` and `files.decks`.
- Deck count on the People table (2026-10-21): the Decks column, `deckCount(row, deckList())` = public entries whose owner is the row's profile login, `github` or one of its `logins` (any case); private decks never count.
- Cards tab and card pages (2026-10-21): decks.js `usesCard(d, id)` (public entries only, the field card counts), `filterDecks` takes `p.card` (`#/decks?card=<id>`, a "Using <card> ✕" chip in `browserHtml` clears it), `usingHtml(list, id, ctx, limit = 6)` (the card page's "Decks using this card": newest first, six tiles, then "All N decks using this card" → `#/decks?card=<id>`) and `searchHitsHtml(list, q, ctx)` (the Cards tab's "N public decks match “q”. Show them" → `#/decks?q=<q>`, the same `filterDecks` text match as the browser, so the count is what the link shows; nothing for no match). app.js: `hasDecks()` (cards.json's public count, or a pending deck in the batch) gates both, so a site with no published deck never fetches decks.json; `deckHits(q)` fills `#deck-hits` under the Cards toolbar and `usingDecks(c)` fills `#decks-slot` in the card page's related section (before History), each patched once `loadDecks()` resolves if the page still shows that query or card. The Cards search's DSL (`hp>5`, `|`, `!`) is matched as plain text by the decks filter, so such a query finds no deck.
- Deck page previews (2026-10-21, build_site.py): `deck_cards(d, by_id)` = the hand in `handCards` order (field card, creatures, items, the rest; stars down, then name); the first `OG_DECK_CARDS` (6) with an image go through `deck_montage(picks)` → `fan()` (shared with `site_banner`: 300×570 boxes on 1200×630, centred side by side when they fit, else overlapping edge to edge, so the site banner is byte-identical), cached as `site/.og-cache/<key>.jpg`, key = sha256 of `OG_DECK_VERSION` + the picked image hashes (bump `OG_DECK_VERSION` when the layout changes; unused files are pruned each build with `SITE_URL`, kept without it), hardlinked to `decks/<owner>/<slug>/og-<key>.jpg` (the key in the name busts Discord's cache when the hand changes). Only with `SITE_URL` (the og:image must be absolute) and 2+ pictured cards; one card falls back to that card's 480 px og.jpg, none to the site banner, and a montage that fails is a `warn()` and the one-card image. og:image:alt = the pictured card names. site.yml caches `site/.og-cache` on its own, outside `site/.cache` (actions/cache restores only caches saved with the same `path` list, so the card-images cache's `path` must stay exactly `site/.cache`): `actions/cache/restore` brings back the newest `deck-previews-v2-*`, and after the build `actions/cache/save` stores it under a hash of the montage file names in use (skipped when that is the restored key; `continue-on-error`), so a montage that changes for any reason (a deck, a card's stars or name reordering the hand, an image) is saved once, not redrawn each run. The build removes a leftover `site/.cache/og` (montages lived there before).
- Checks (2026-10-21): a wrapper build in a scratch folder (fixture decks: a full hand, its twin under another owner sharing one cached montage, 2 and 3 card hands, a one-card and a field-only hand on the one-card fallback, the private and broken ones skipped as before); rebuilt warm (cache files untouched), with a deck removed (its montage pruned), without SITE_URL (raw PNG, no montage) and with no decks folder; node: decks.js units (limits, the All link, escaping of a hostile query and card id, private never counted) and app.js under the DOM stub (Cards hits and the browser agree, card page tiles, `?card=`, no decks.json fetch with no published deck).
- Not done: no static page for private decks (by design).

## 13. Created sort and card mentions (2026-10-22)
- Sort (app.js): `SORTS` rows are `[key, label, dir]`; the two `created` rows ("Newest created" `dir` "", "Oldest created" `dir` "asc") put `data-dir` on their option and `select-param` sets `dir` from it (any other sort option clears `dir`, so Oldest created then Stars is highest first, not lowest), so the select shows the one matching the direction and the ⇅ flip moves between them. `isDesc(sort, dir)` (default newest first) serves `sortCards` and `flip-dir`. `sortCards` "created": cards without `fs` last, then `fs`, ties by `name.localeCompare` in both directions (the other sorts multiply their name tie-break by the direction); same `fs` and name (2 pairs, both duplicates) keep input order, as in the name sort (`Array.sort` is stable). Created is the only sort with two menu rows; the others have one and the ⇅ flip. Picking any sort from the menu resets `dir` to that sort's default (before 2026-10-22 a flipped `dir` carried over). `S.created` (any card with `fs`, set in `init`) shows the two options and the table's Created column (`sort-by` key `created`); a shallow build has none, and `sortOf(p)` reads a shared `?sort=created` link as `name` there, so the grid, the menu ("Name"), the table's ▾ and the first ⇅ flip (Z to A) agree. profile.js "All N cards" links `sort=created`, the order of its newest-cards grid (name order on a shallow build, where it was updated order).
- `fs` (build_site.py `image_versions`): a PNG added with a blob no delete in that commit had, when that commit deleted exactly one PNG of the same file name (`alnum` of the base name, so `Dash_Master` = `Dashmaster`) and added only one, is a move that changed the image: its older versions follow under the old path (exact renames are claimed first, tracked adds before untracked ones). Measured on the full-history clone: 54 cards (and 1 rulebook page) got older rows, in versions.json too, so the image viewer and the person pages' month counts change with them; all of them the moves fs_check traced (Regenerative Shield 2025-08-28 → 2023-11-06, Sonic 2025-02-22 → 2025-02-12, Asteroid Field → 2023-11-12, Jera → 2023-11-14); nothing else changed; fs ≤ ts still holds. 601 cards now have an fs in the 2023-11-05/06 import (8 'init' commits, folder by folder): their real order is unknown, the PSDs only carry the template's XMP date. One of the moves is a reclassification: God Tamer, Creatures/Hollow Knight/3 Stars → Auxiliary/Minions in cada060c, so the minion keeps the creature's history (fs 2025-05-04 → 2023-11-05, 1 → 5 versions); kept on purpose, a judgement call.
- Mentions (text.js `makeRenderer`): `byName` keys are `fold()`ed (lowercase, curly apostrophes straight, spaces collapsed) from each card's `name`, then its `key` (file name; a one-word file name only when the title is one word too, so "Blockade" is not The Wall By Ech and "Papyrus" not The Great Papyrus, while Indoctrination → Indoctrinati0n, Sans → snas. and Kyle → hdckighfkvhvgmk stay), then the name without a trailing `!?.` ("Party" for Party!), then a multi-word name ending in one `s` (not -ss/-is/-us) without it ("an X Fist" for X Fists, "Whispy Wood’s" on rulebook page 12), first card wins (an original before its duplicate). The names are grouped by first word, one sticky case-insensitive regex per group, tried at each word start of the text (a word ending in `s`/`es` tries its singular's group too, for "drones", "Cabbages"); same links as one regex of all names (0 differences over cards, notes and rulebook pages, with today's and the pre-3888392 names), but derive() is about 3 times faster warm. Each regex is case-insensitive, `'` matches either apostrophe, a space a run of spaces or tabs (never a line break: 0 links crossed one; `[^\S\n]+` cost derive() about 120 ms on first run), with an optional ending `'s`, `s'` or `(e)s` kept in the link (so "Mantis Lords'" and "Grodus X's" no longer fall back to Mantis and Grodus). `parse()` finds the icons and badges, then the names over the whole text with each icon or badge as `\0`s (a name never spans one) and, for `isRef`, as spaces (so "Flame [fire] Bomb" reads as one phrase); `render` and `mentions` both use it, so strips, Most referenced and stats.js agree by construction (render vs mentions: 0 differences; before, mentions also blanked unknown `[x]` and `(XX)` that render kept as text). `isRef(m, text, card)`: all capitals the card doesn't print are a heading ("PANDA", "DARK MATTER" on rulebook page 20); a multi-word match counts; a one-word one only as the card or file name spells it (without an ending), capitalized (`\p{Lu}`, so É counts) or lowercase after its own `VERB` (a buff or debuff after inflict/cleanse with an optional `1T1(…)` amount or after "stacks of", a minion after summon/resummon/revive with an optional a/an/the/number: "inflict 1T1 smeckeldorfed", "stacks of hardened" on rulebook pages 12, "summon a silithid", "Summon 2 drones", "Revive the jetpack"), not followed by `:` (a label: "Cat:", "Bubble:") or a number (a verb: "Heal 2 HP"; 0 links today), not right after a capitalized word on its line unless that word is in `LEAD` (verbs and little words: Summon, Equip, Create, Cleanse, If, When, This…) or a card ("a Smorg Claw", the Hunter's column list), and not a verb: opening a clause (line start, after a badge, `.!?:` or `)`) and followed by to/the/a/an/your/its/all/any/each/it/this/that ("(BOGT) Flip to the other creature", Tainted Lazarus, both times; "inflict Glued to" is not a clause start and still links). Flip is an item of Tainted Lazarus's own series (The Binding of Isaac), so dropping those two is a judgement call. Known risk, no case today: a multi-word name matches in any case with no other check, so a card named with a common phrase ("Fire Ball") would link "throw a fire ball"; a guard would cost the 7 lowercase multi-word links, all true ("Bake an evil cookie", "the life shroom", "a polevaulter zombie"). The old sentence-start rule is gone (19 of its 22 rejections were real references).
- Measured (a one-off labelled sample, 64 true misses; scratch scripts not kept): found 0 → 50 (47 on the first 2026-10-22 pass, then smeckeldorfed, drones, silithid by `VERB`); still missed 14 = 6 lowercase one-word names with no verb before them ("2 whelps are summoned", "copies of grapes", "hatch into moslings", "(love, motivation, or regret)"; also "sonic" on rulebook page 11.3, unlabelled; left alone: matching any lowercase name adds 14 false links such as "bomb counters", "must stay", "coin flips"), 7 names elided in a coordination ("a Black or White Bloon", the Shaman's totems; left alone), 1 text typo ("Pinapple Mint"; PSD edits on hold). Labelled false links 4 → 0. Link pairs 410 → 456 (Tainted Lazarus → Flip out, Magnus Von Grapple → X Fists in), occurrences 533 → 623 (94 gained, the 4 false ones lost: Flip, Mantis, Grodus, Bubble; the second Flip, after the (BOGT) badge, that the first 2026-10-22 version gained is gone too), every gained one checked by hand; rulebook pages gain 19 true links (3 "stacks of hardened") and keep "Evil Quote!" (page 03, an Eggman quote) unlinked. "Unused status effects": the same 10. Strips, Most referenced and stats.js count ability text only, over the browser's visible cards (Stuffed: 12 there, 14 in raw cards.json); notes and rulebook pages get links but no counts. The owner's cases: THE FORBIDDEN ONE → Spawn of The Forbidden One and The Man Behind The Slaughter → SPringtrap link, strip and Mentioned by (sort_check). The same pairs come out with the pre-3888392 names. Cost of derive()'s renderer and mentions in node here, first run / warm: 28-38 / 16 ms before 2026-10-22, 61-78 / 29 ms with one regex of all names, 33-42 / 8-13 ms grouped by first word.

## 14. Balance analytics (2026-10-22)
- Design: AutoCroissant `docs/Campaigns/DATA_BUILD_ACTION.md` §12.3 (step 3, from today's data). `build/analytics.py` (no PSDs, no network) is called by build_site after the image-version pass (so `fs` is set) and before the history moves to history.json: `analytics.build(cards, stats, old_stats, history=commits is not None)`; `summary()` gives the two `balance:` log lines; the result is `data/analytics.json` (in `files`, so in the build version), and each card with an entry gets `balance: true` in cards.json. An exception in it is a `warn()` and an empty analytics.json (balance.js then shows nothing), never a failed build. build_site puts its own folder on `sys.path` before `import analytics`, so loads by file path (the AutoCroissant bench scripts) still work.
- Cohorts: site entries (edits applied, as the page shows them) of kind creature or minion with all four stats, not a duplicate, hidden or unparsed; by star level; a star level under `MIN_COHORT` (5) is compared with its kind's `<kind>|all` cohort, and so are the auxiliary creatures (kind `creatures`, no star level), with `creature|all`; every member is in its kind's `|all` too. A card with several creatures counts once, by its own stats (creature 1). Measured on PICKLE 3888392 (the design's numbers): creature 2★ 45, 3★ 102, 4★ 93, 5★ 56, minion 1★ 15, 2★ 31, 3★ 27, 4★ 11 (equal), plus minion 5★ 6 (a cohort the design's list leaves out) and God Tamer (0★) in all minions (91): 296 + 91 = 387 creatures and minions, the design's total; the 7 auxiliary creatures make all creatures 303. Per cohort and stat: p10, p50, p90 (numpy's linear quantiles); the total also min, max, mean, sd. Per card: `cohort`, `stats` (its line as built), `pct` (mid-rank: lower + half the ties, of n; rounded half up, but never across a flag's edge (`pct_of`: 89.5 is 89, 10.5 is 11; 12 cards today), so `pct.total` >= 90 exactly when `top`), `below`/`above` (cards with a lower/higher total), `z_total`, `flags` (`top` at an unrounded mid-rank >= 90, `bottom` at <= 10: 78 cards today; 90 when it was rounded first, which flagged 89.5 to 90 and 10 to 10.5).
- Changes: each card's chain (`page_chain`) is its old_stats versions by timestamp, then its current card as the page shows it (`shown`: the site entry's stats, stars, kind, item type, series, types, creatures and ability, Card Edits.json applied, with the stats.pkl card's date and blob; so a stat edit moves the rows, the trend and the Balance line together; 0 differences from the stats.pkl cards today); a row per pair that changed something a page shows (`ts` = the newer version's commit; `approx` when that version's date is not known to be its PSD's commit (`exact`): no `blob_sha` and no commit in build_site's history touching a PSD of its file name at that second (`psd_commits`; without the history, every blobless one): 2 rows today, the Gates and the Temple of Ahn'Qiraj, 26 before the commit check): `stats` [[before], [after]] with `bal` buff/nerf/shift (total up, down, same; not when either total is above `OFF_SCALE` 40, stats.js's off-chart limit: Tainted Lazarus' old 110s), `stars`, `kind`, `sub`, `series`, `types` {add, drop}, `lines` (creatures on the card), `text` [i, j] (indices into history.json's texts plus the current one, for the diff), `ws` (spacing only), `tags` (aligned runs of cooldown-family tags that differ, e.g. ["(2PT)", "(1CD)(2U)"]; the `old` flag went with the cooldown update chart, round 3), `words` (the wording changed beyond the tags). Art-only, moves (paths are rewritten by the bot) and same-text re-reads give no row. A version with the same timestamp as the next is the same PSD read again by a newer parser (8 pairs, the last old version and the current card at 2026-10-19 16:57:41, parser_version None → 2): `page_chain` drops it, so the newer reading stands for that commit in the rows and the trend alike (a re-read that changed stats ends both on the newer line). Only Bob-ulk's re-read changed something, its series (Paper Mario: The Thousand-Year Door → Mario), which its 2026-10-19 row now shows. `reworked()` = words, stats, stars, kind, sub, types or lines (balance.js `isRework`). `trend` = [{ts, hp, def, atk, spd, total}] (the design's shape), the distinct on-scale stat lines when there are two or more. On 3888392: 466 versions, 444 rows, 228 reworks, 0 buffs or nerfs (the one stats row is Tainted Lazarus' off-scale 110s), 224 with tags, 218 from the old tags.
- Over time (`time`, full-history builds only: without `fs` a card would start at its last commit, so a shallow build writes empty months and the panel says it needs the history): at each month's end (Pacific time, `ZONE`, as balance.js; without a tz database it falls back to UTC and build_site warns; the current month at the build), every creature and minion whose start (its oldest version or `fs`, the earlier) has passed, with the kind, stars and stats of the version in effect (before its first version: as first read; the current one as the page shows it), plus archived cards until their tag's `at`; `series[cohort]` = [n, mean, p10, p50, p90] per month. The averages barely move (2★ creatures 16.7 in Nov 2023, 16.9 now): stats never changed, only new cards came.
- Front end: `assets/balance.js` (DOM-free; imports `chartCard`, `hbar`, `table`, `stacked`, `fmt`, `trunc` from stats.js, which now exports them; `stacked` gained `every`, and `chartCard` drops the Table button when there is no table). `statsHtml(A, {cards, byId}, params)` fills `#stats-balance` (left by renderStats under its charts) once `loadAnalytics()` resolves; the kind and series filters scope the dots, outliers and change charts, the bands and medians are always the whole cohort, the over-time panels take the kind only. Charts: `bal-cohorts` (one strip per cohort: band p10-p90 in `--s1` 28%, median tick, min-max hairline, top/bottom dots in `--s1`/`--s2` with a 2px surface ring), `bal-outliers` (diverging bars, total minus the cohort median, the 10 highest and 10 lowest, all in the table), `bal-time` (small multiples, one per star cohort, shared y; mean line and p10-p90 wash; months with n < 5 left out), `bal-buffs` (up/down columns by month, or a sentence when there are none: today's), `bal-months` (stacked: ability reworded `--s1`, timing tags only `--s2`, stats `--s3`, other `--deemph`; not `--s4`, whose yellow beside `--s2` fails the palette validator's normal-vision floor), `bal-reworked` (hbar top 15); round 3 dropped `bal-cooldown` (the cooldown update) and added `bal-creep`, `bal-series` and `bal-stats` (§26). Every day and month in balance.js is Pacific time (`TZ`, the bot's TIMEZONE), so every viewer sees the same waves: in the viewer's zone the Oct 21 wave (05:xx and 06:xx UTC on Oct 22) split in two under Denver time. Card page: `#card-balance` at the top of `.related` (`balanceBlock`: the line, a median / middle-80% table (one decimal, `fmt`, so 5.4–12.6 is not widened to 5–13), the sparkline; the card's numbers are its built `stats`, like the cohort's, so a staged edit never mixes in: the note "As built, before this card's unpublished edits" then shows; the Stats page's dots use the built totals too) and `#card-changes` before History (`changesBlock`, each rewording with a `<details>` word diff once history.json is loaded); a duplicate shows its original's (`balanceOf`), loading the original's history for the diffs. Both refill after `loadAnalytics()` and after `loadHistory()`; a failed load says so and the next visit retries.
- Checks (2026-10-22, no browser; one-off scripts, not kept in the repo): local builds on read-only copies of the pickles at 3888392 and a full-history blobless clone; a node check of balance.js on that build (the design's cohort counts; four cards counted again from cards.json in JS (Tainted Bethany, Sonic, God Tamer, Mettaton EX: cohort, lower/higher, pct, median); sections, strips, dots = flagged cards, the change months adding up to every row, filters, escaping of a hostile name and series, a fixture with buffs, nerfs, a shift and a trend); app.js under a stub DOM (nothing loaded for the first screen, one analytics.json fetch for the Stats page and the cards after it, the Loading message, a card without data, a duplicate, a failed load and its retry); Python fixtures for analytics.py (folding, flags, quantiles, buff/nerf/shift, off-scale, trend, text indices, tags, archived cards over time, no history, empty input; then the review fixes: a 6 → 7 → 8 re-read gives one row 6 → 8 and a trend ending on 8, a stat edit on the current card in the rows, trend and `stats`, a blobless version dated by its PSD's commit is exact and without history approximate, `pct_of` at 89.5, 90, 10, 10.5, pct and flags agreeing on every card); the analytics.json of the build before and after the fixes compared card by card (only Bob-ulk's row, 24 `approx` marks and 12 pcts changed); a picture of the light and dark pages; the palette validator on `--s1..--s4` (light and dark).

## 15. Changes page tabs (2026-10-22)
- Design: AutoCroissant `docs/Campaigns/DATA_BUILD_ACTION.md` §12.1 (step 9); the category row is the owner's ask of 2026-10-22. `CHANGE_TABS` (app.js) is a row of links across the top of the page, one per category, each showing only its sections: `#/changes` (Recently updated), `#/changes/changelog` (`?kind=` csv filter), `#/changes/edits` (`?via=website,discord,git`), `#/changes/website` (Website edits), `#/changes/revised` (Most revised), `#/changes/parser` (Not parsed yet, Parser notes); an unknown key is the first tab. `renderChanges(r)` draws `nav.change-tabs` (links, `aria-current="page"` and `.on` on the chosen one, underlined), then the tab; `NEEDS` says what a tab loads first: Changelog and Database edits `data/changelog.json` once (`loadChangelog`, memoised; a failed load says so and the next visit retries), Recently updated and Most revised history.json, the other two nothing. A tab link that had focus from the keyboard (`changes.keepsTabFocus`: `:focus-visible`, so not after a mouse click) hands it to the chosen tab after the re-render (the loaded redraw after a loading page keeps it when the tab the loading page focused still has it, not relying on script focus counting as `:focus-visible`), and ←/→/Home/End on a focused tab go to the next one (the document keydown handler), so the row works from the keyboard. `webEditsHtml()` is the Website edits tab, "Edited on the website or in Discord": `changes.webEdits(S.all)`, newest first, at most `WEB_EDITS_SHOWN` (100) listed with the total in the heading; `editsHtml` no longer takes it. `webEdited(c)` = `changes.editorFields(c)` is non-empty: `c.edited` less `c.botEdited` (build_site: the entry's `_bot`, the fields the alias migration added under an editor's stamp), and nothing for a `_by: AutoCroissant` entry; the Edited tip, this tab and the person page's Recently edited cards list those fields only. edit.js `editsFile` takes a field it sets or unsets out of `_bot`, and an editor's edit to a `_by: AutoCroissant` entry first puts the entry's fields in `_bot` (else the migrated aliases and series would become that editor's), and the stamp-counted edit batches leave `_bot` fields out.
- Build (build_site.py, "changelog" section): `data/changelog.json` = `{available, since, days: 180, repo, source: {built_at, card_commit, run} | null, events, archived, edits: {available, batches}}`, in `files` (so in the build version). `events`: with `CARD_DATA_DIR` (site.yml sets it at the cutover, step 8; it also switches the cards, see §16), `read_changelog` reads `<dir>/changelog/YYYY-MM.jsonl` (AutoCroissant changelog.append_events; a line that isn't an event is skipped, one `warn` per file) and `manifest.json`; `site_events` keeps the last 180 days by the event's `at`, `EVENT_KEYS` plus the push (`after, before, by, at`), and adds `id` / `renamedId` from the card's name (`by_key`, the dup_of lookup). Without the variable, `available: false` and no events. `archived`: old_stats names whose last version has the bot's `archived` tag and that aren't back in stats (a stale tag, card_models.stale_archives), newest first. `edits`: `edit_history()` = one more `git log --raw` over Card Edits.json and Card Authors.txt (both paths, before and after the move), so git_history's output and contributions.json are untouched; `read_blobs` reads every version in one `cat-file --batch`, after one batched `fetch` of the blobs a blobless clone lacks (`GIT_NO_LAZY_FETCH=1` to find them; measured: one extra pack in a fresh `--filter=blob:none` clone); `edit_batches` diffs each commit's before and after (Card Edits.json entries by `card_key`, `_` fields ignored; Card Authors.txt through `authors_of`, the text half of `parse_authors`) and keeps commits with a change, newest first, the last 180 days: the bot's bakes (verdicts, the baked entries deleted; the card sync's changed event shows them) and pure moves are none; a `Discord:` subject is `via: discord` (even by the bot), `Website edit…` `website`, else `git`; `by` = the new `_by` of the entries this commit stamped (a `_by`/`_at` pair no entry had before, so a renamed key that keeps its stamp isn't a restamp), else the `Edit-by` values, else the author; each credited (`credit()`), except a Discord name (a `discord:` one, or any `Edit-by` in a Discord commit), which keeps its `discord:` prefix and is never credited; so a hand fix that leaves the stamp is its author's. changes.js `nameHtml` decides per name: a `discord:` name (any case) is plain text "<name> (via Discord)" (whatever the batch's `via`, as in a hand migration or revert commit; a Discord batch's heading drops the suffix, its line says via Discord), else `personLink`; app.js's "Edited on the website or in Discord" panel uses it for `editBy` too, and the card's Edited tip `nameText` ("Changed: … · <name> (via Discord)"). contributions() never gives a `discord:` stamp a row or a login, the shallow-clone fallback included. Card Authors.txt rows keep the card name and git name as written. At most `BATCH_LINES` (60) lines per batch, the rest a `more` count (Card Authors.txt's first commit credited 813 cards). A shallow clone: the current file's entries grouped by `_by`/`_at` (`stamped`, new values only, `available: false`). Any exception there is a `warn` and no batches, never a failed build.
- Front end: `assets/changes.js` (DOM-free). `pushGroups` = AutoCroissant `changelog.messages()`'s grouping (seq order, consecutive events with one build, push `after` and re-read flag), `titleOf`/`countsOf`/`linkOf` = `title_of`/`link_of` (Pacific "Oct 22 14:05", "Website edits baked into the PSDs" for the card sync's own push, compare view, else the commit, else the run), `SECTIONS` the post's; the re-reads are a `<details>` list instead of the post's one line, and fields show old → new (the post shows the new value) with a `diffWords` ability diff. Days (Pacific) and pushes newest first by the push's time (then seq), so a day's heading never repeats. A Discord batch's names are plain text, never a person link (`nameHtml`, the Build note above). Kind words are the site's (`KIND_LABEL`).
- Checks (2026-10-22, one-off scripts, not kept): a fixture db/ made with AutoCroissant work/data-build's `changelog.events` between PICKLEs 56b43b9 and 077337a (178 changed, 5 art, 101 re-reads, 1 archived), pushes by `assign_pushes`' fallback, plus hand-made events of the other kinds, a 200-day-old one and two bad lines; scratch builds (local pickles, the image cache) with the worktree's shallow history and a fresh blobless clone: the groups' titles equal the bot's `messages()` post titles for the 10 pushes within 180 days; escaping, filters, empty states; app.js under linkedom (tabs, one changelog.json fetch, the moved panel); without `CARD_DATA_DIR` every other data file equals origin/main's build but `generated`. Review fixes (same day): a throwaway git repo (a hand fix after a website and a Discord edit, a restamp by `_at` alone, Card Authors.txt-only Discord commits with `discord:some_user.name` and `zomoroko` trailers, a bake), changes.js units (a Discord batch, pushes out of seq-time order across midnight), app.js with a late changelog.json failure after leaving the tab; old-vs-new scratch builds differ only in the batches' as-written names. Round 3: a hand commit carrying `_by: discord:zomoroko` (and a hand revert with an `Edit-by: discord:` trailer) stays plain text beside a zomoroko GitHub profile; a hand key rename that keeps its stamp is its author's; webEditsHtml leaves a `discord:` editBy unlinked.

## 16. Card history dates and the card sync's data (2026-10-23)
- From AutoCroissant's history audit (C2, C5, C3-site-local-day, C3-dup-history-split, the archive tags' `moved_to`) and the
  card sync's dry-run check (DATA_BUILD_ACTION.md §10, step 7).
- `since` (build_site `text_since`, cards.json): when the current text started: the card's start (`analytics.when`: the
  bot's carried `version.from`, else its timestamp), or the start of the versions just before it with the same text (a
  stats change, or an edit dated after the PSD). Only written when it differs from `ts`, which stays the last PSD commit
  ("updated", Recently updated's order). `assets/history.js` (DOM-free) dates the current text by `since ?? ts` in the
  History block and the image versions' "Text then" (`textAt`), and Recently updated shows a diff only when the update
  brought the text (`textChanged`). Measured on the dry run's db/ (run 39897696663): wrong "Text then" 179 cards → 0;
  on the 077337a pickles 4 → 0 (the pod cards).
- A duplicate (a numbered PNG of the original's PSD) copies the original's `since` and `history` (hv, history.json), so
  its page has the History block its Balance block already had; Most revised leaves duplicates out.
- Dates: `HISTORY_FORMAT` reads committer time (`%ct`), as the bot dates versions (commits API, card_history
  LOG_FORMAT): 33 of 402 commits move, Patch 1.9's by 20 days, and The Gates and The Temple of Ahn'Qiraj's changes stop
  being approximate. history.js `date`, `month` and `monthKey` format in Pacific time (`TZ`), as balance.js and changes.js
  do; app.js, stats.js and the person pages use them; contributions' months are Pacific too.
- Archived cards: build_site passes the tag's `moved_to` (a PSD moved into MDW, retired) to changelog.json's archived
  rows, and `EVENT_KEYS` passes it in events; since round 3 each row and event shows its tag (Renamed, Retired,
  Unfinished, Deleted) on the Changes page's Archive tab (§26).
- `load_card_data(folder)` (CARD_DATA_DIR): db/'s stats.json, old_stats.json (schema 1, AutoCroissant card_db's records)
  and psd_details.json, read into stand-ins (stats and creatures as CardStats); no readable stats.json stops the build.
  The only source since 2026-10-25 (the pickle fallback, `load_bot_data`, and site.yml's `CARD_DATA` switch are gone):
  site.yml checks out `data` into carddata/ and sets `CARD_DATA_DIR=carddata/db`; a build without it stops. The
  schedule is a daily fallback (Card sync dispatches a build after its commits).
- Checks (2026-10-23): AutoCroissant tests/test_site_build.py (build_site.main on a small repo: db/ (the pickles
  until 2026-10-25), since, committer time, the duplicate's history, moved_to), test_site_history.py (history.js in node
  under four time zones; no date call without a zone), test_site_changes.py (the archived wording); each fix reverted
  alone fails them. A scratch build at 7b48db05 with the 077337a pickles vs the dry run's db/: cards.json differs only in
  the re-parsed cards' ts, reparsePending, since, the 4 padding-fix abilities, Bubble's and God Tamer's stars and notes,
  Springtrap's title and their history entries.

## 17. Password sign-in (2026-10-23)
- Owner's answers (2026-10-23 ~01:45): works on any device (the encrypted token is published in the repo, like private decks); a password sign-in lasts until Sign out on that browser; it REPLACES the plain-text remember (no token stored in plain text any more); Forgot password = the token again, then a new password; Change password while signed in.
- File `site/logins/<login>.json` (format: `site/logins/README.md`): `{at, ct, iterations, iv, kdf: "PBKDF2-SHA-256", login, salt, v: 1}`, keys sorted; key = PBKDF2-SHA-256(password NFC, 16-byte salt, iterations) -> AES-GCM-256, 12-byte iv, additionalData `login:<login lowercase>`, `ct` = ciphertext + tag. `login` equals the file name exactly (GitHub's spelling, `me.login`). ITER 2,000,000 (`login.js`; Chrome on the M2 Ultra derives 1M in 92 ms, node's OpenSSL ~300 ms; mid phones are taken as 4-8x slower, so 0.7-1.5 s), files with 1M-5M accepted (MIN_ITER, MAX_ITER; the build's LOGIN_ITER).
- Module `assets/login.js` (DOM-free; imports esc, LOGIN_RE, b64/unb64 from decks.js): `seal(subtle, password, login, token, {iterations, random})` -> file without `at`; `unseal(subtle, password, login, file)` -> token or "Wrong password" (also a copied or altered file); `checkFile(raw, stem, {exact})` = build_site `clean_login`; `fileText`; `checkPassword(pw, login, token)` -> `{ok, problems, length, words}` (12+ characters (4 words of 3+ letters with separators are 15 anyway, so no separate word rule); refuses COMMON words with leetspeak undone and digits/symbols around, repeats `/^(.+?)\1+$/`, runs along RUNS (alphabet, digits, keyboard rows and columns) over 75% of the pairs, under 5 different characters, under 12 characters once the login is taken out (one under 4 characters only where it stands as a word: `al` is in fallingalpine), a token, digits/symbols only under 16, and under 16 characters `oneWord`: one run of 4+ letters cased like a word (lower, Capitalized, CAPS) with 25%+ vowels, at most 2 other letters, 12 letters at most, as typed or (mostly letters) with leetspeak undone: Liverpool1892, Charlie2024!x, L1verp00l1892; refuses ~0.4% of random 12-character passwords); `vault({idb, subtle, local, session, random})` -> `{has, save(token, keep), load(), clear()}`: device key = non-extractable AES-GCM in IndexedDB `ttscardmaker-signin`/`keys`/`device` (made once, `add` so two tabs racing end on one key), blob `{v, iv, ct}` (aad `device:token`) under `edit-token-sealed` in localStorage (keep) or sessionStorage; `load` drops a blob it can't open; `clear` removes both blobs and the key; forms `signInHtml`, `passwordFormHtml`, `checksHtml`.
- edit.js: `token` lives in memory only; `legacy()` reads the old plain `edit-token`; `booting = device.has() || legacy()`; `init()` -> `restore()`: a legacy token is sealed first (`remember(keep)` removes the plain one even when sealing fails: the sign-in then lasts this page only, with a toast when kept), then a silent `signIn(..., {store: false})`; a 401 clears the vault; after a migration `offerAfterBoot()` opens the Set a password offer once (a toast instead while a dialog or the profile editor is up). `signIn(t, keep, {expect, store})`: `expect` = the password file's login, which `/user` must equal. `gh(..., {anon})` sends no token (signed out). `fetchPassword(typed)` -> `{found, stale}`: the built copy `data/logins/<lower>.json` (cache: no-cache) gives the spelling; then the API raw contents of that spelling, unauthenticated (authoritative: a 404 there means no password even when the site's copy still has one); typed in another case with no built copy: the folder listing finds it (every file of that login in any case: the submit tries each until one opens); the API failing (rate limit, offline) falls back to the built copy (`stale`: a wrong password then says the copy can be minutes behind a change). Password files are written at once by `commitFiles` (one-file commits `Website: <login>'s password` / `... removed`), not staged: the batch would leave a password unusable until "Review and publish" (owner confirmed 2026-10-23 ~02:45). `openPassword(mode, {offer, next})` (`set` | `new` after Forgot | `change`), `removePassword(login)` (own; admins any, from `listPasswords()` = the API folder listing), `pwHubHtml(file)` in the hub's `#hub-pw` (filled by `ownPassword()` = authenticated readFile, cached in `pwKnown`). Hub signed out: Password | Token (`[data-signin-mode]`, hub-local listener, so `then` survives), Password first when `edit-last-login` is set (written on a password set or sign-in, removed by Remove, Forgot and Sign out) or `S.data.passwords` > 0; Forgot (`[data-pw-forgot]`) sets `forgot`, clears the vault and reopens in token mode with a note; the token sign-in then opens `openPassword("new")`, otherwise the offer when `ownPassword(true)` is null. Actions `pw-set`, `pw-change`, `pw-remove`, `pw-later` (Not now / Continue -> `next`), `pw-list`.
- Build: `LOGINS_DIR`, `clean_login(raw, stem)` (as `checkFile`), `read_logins()` (4 KB cap; files for one login in different cases: none copied, warned; warnings only), `write_logins(folder, logins)` -> `data/logins/<lower>.json` (compact, sorted keys); main wraps both in try/except (never a failed build); `data.files.logins`, `data.passwords` (count). LOGIN_RE and DECK_UPDATED_RE end in `\Z` (Python's `$` takes a trailing newline; JS's doesn't). Not in the build version hash (fetched with no-cache).
- Checks (2026-10-23; harnesses in ~/Documents/Tools/wt/scratch/password-1023/; scratch build from a worktree of this branch with the image cache cloned, AutoCroissant's pickles): node `unit.mjs` 84/84 (after the review fixes) (round trip, wrong password, copied/altered ct, tag, iv, salt, the README format decrypted by node:crypto, NFC, checkFile refusals, checkPassword cases, the vault over a fake IndexedDB incl. the two-tab race); headless Chrome `password_ui.mjs` 68/68 (adds: Password first on a fresh browser, the stale-copy hint, two files differing in case, the Remove confirm, a this-tab Change) against a fake https GitHub API (Chrome's host resolver maps api.github.com to 127.0.0.1; fake tokens; CORS preflights answered): offer after the token sign-in, refusals with reasons, publish, reload signs in silently, sign out clears key and blobs, the profile editor reloaded waits for the sealed sign-in, password sign-in wrong/right, from the API right after publishing, from the site's copy when rate-limited (typed in lowercase), Change, Forgot, Remove (git-history warning), admin list/remove, someone else's token and a revoked one refused, keep off = sessionStorage, migration from localStorage, sessionStorage and of a revoked token, no token in plain text at any step, no page errors. AutoCroissant `tests/test_site_logins.py` 27 (AC_SITE_SRC): clean_login refusals, read/write, a login.js file passes the build, login.js refuses what the build refuses, the round trip and tampering (node:crypto reads the format), the password rules, the vault.
- Deck passphrases (owner's ruling 2026-10-23 ~02:45: encrypt them like the token, migrate the plain ones, keep "not remembered"): login.js `keyring` (IndexedDB helpers shared by both) and `deckPasses(env)` -> `{has(deck), save(deck, pass), load(deck), forget(deck), migrate(decks?)}`, deck = `decks.keyOf(owner, slug)`. Key: a sibling non-extractable AES-GCM key `decks` in `ttscardmaker-signin`/`keys` (made on first Remember); blob `{v, iv, ct}` (aad `deck-pass:<deck>`, so a blob copied to another deck doesn't open) under `deckPassSealed:<deck>`. Decision: not tied to the login (signed-out visitors open private decks and can remember too), so `vault.clear()` (Sign out, Forgot) deletes only the `device` key and the deck passphrases stay; Forget per deck (the last one also deletes the `decks` key; a Forget during a save or a migration wins: `save` then stores nothing and returns false). app.js: `passes.has` for the "remembered" line, `passes.load` to auto-open (an unreadable blob is dropped and the form shown; a wrong one is forgotten with "no longer opens"), `passes.save` only when Remember is ticked (a browser that can't seal: toast "can't remember it safely", nothing stored), and `passes.migrate()` after `init()`: each plain `deckPass:<deck>` is sealed and removed (a browser that can't seal it, IndexedDB missing or failing: dropped, never kept in plain text); a plain one found by `load` wins over a sealed one (an old tab wrote it) and is sealed in place. Checks: `unit.mjs` 102/102 (+18: key non-extractable, sealed only, copied blob refused, kept across vault.clear, forget, the last forget deletes the key, forget during a save or a migration wins, migrate all/again/plain-over-sealed, no IndexedDB or IndexedDB failing drops); `password_ui.mjs` 85/85 (+17, section 13, a private fixture deck `site/decks/Bob/secret-hand.json`: migration on load, auto-open, Forget (the `decks` key goes too), unticked stores nothing and asks again, ticked seals, sign out keeps it, an unreadable blob, an old wrong plain one).
- Not done: Safari's 7-day storage expiry signs a browser out; nothing slows offline guessing beyond the iterations; "only its owner writes it" is the website's rule (a pusher can change or delete any file through git: only a denial of password sign-in, as the AAD and the `/user` check keep the token); with the API down an old password still opens the site's copy until the next build (the git history holds the old file anyway).

## 18. Recompressed PNGs are no new image version (2026-10-23)
- The push guards recompress the heavy PNGs a push brings, losslessly, in their bot commit, and one batch pass rewrites
  about 686 card PNGs (AutoCroissant docs/Campaigns/PUSH_GUARDS.md §19). Each such commit names the PNGs it only
  recompressed in `Recompressed: <path>` trailers, in the message's last paragraph (AutoCroissant
  `card_guards.RECOMPRESSED`, `png_recompress --message`). Read as a change, each would add an "Image versions" row by
  AutoCroissant identical to the one before, and a card with one version would start showing the block.
- `HISTORY_FORMAT` adds a third line per commit, `\x03` + those trailers' values joined by `\x1f`; `parse_history` drops
  the commit's `M` entries for the paths named when its author is `BOT_AUTHOR` (a person's commit counts, trailer or
  not). The commit stays in the list with the rest of its entries (a re-export in the same guards commit is still a
  version); the tuple shape is unchanged.
- Checks: AutoCroissant tests/test_site_build.py::test_a_recompression_is_no_new_image_version (a guards commit with a
  recompressed and a re-exported PNG, a batch commit, a person's commit with the trailer); it fails without this change.

## 19. Card previews: the server side and the website's contract (2026-10-23)
- Owner's ask (2026-10-23 ~18:10): "press preview image to dry run bake a card, work on another card, and then go back
  to the first to see the preview". Server side only so far; the UI is a later task, against this contract. Design and
  measurements: AutoCroissant `docs/EDIT_PIPELINE_DESIGN.md` section 16 (with the manual test plan for the first live
  dispatch); code: `.github/workflows/card-preview.yml` runs AutoCroissant `commands/card_preview.py`, which is the bake
  (`card_bake.bake_card`: the same gates, fonts, chart, icon vocabulary and fork pin as card-edits.yml) on one card, on
  the runner, then `commands/card_preview_branch.py`, which publishes the result. Two jobs: the preview holds a
  read-only token; only the publish job may write, and it needs no install (the standard library), so a preview that
  failed or never ran is still published, as a try-again error. Nothing is written to main (no PSD, PNG or edits file);
  no Discord; the result goes to the orphan branch `previews`. No other workflow starts on it (every push trigger here
  is `branches: [main]`, and a GITHUB_TOKEN push starts none), and the site build never reads it.
- **Public.** This repo is public: a preview publishes the editor's unpublished edit twice, as the run's inputs in the
  Actions tab and as `previews/<request>/` and its `index.json` row on the `previews` branch (kept up to 7 days, in
  history until the next rewrite). Say so before an editor's first press ("anyone can see a previewed edit, as with a
  published one").
- **Dispatch** (any signed-in editor; the token must belong to a collaborator with write access):
  `POST https://api.github.com/repos/MichaelJSr/TTSCardMaker/actions/workflows/card-preview.yml/dispatches` with the
  editor's `gh()` headers (`Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`) and the body
  `{"ref": "main", "inputs": {"card": c.key, "edit": JSON.stringify(fields), "request": id}}` -> `204 No Content`.
  - `request`: `crypto.randomUUID()` (36 characters; the workflow takes `[A-Za-z0-9-]{8,64}` and fails, publishing
    nothing, on anything else), a new one per press, never reused.
  - `card`: `c.key` (the Card Edits.json key, the PSD's file name with spaces; a duplicate's own key, so it is refused
    as the bake refuses duplicates). A PSD path (`c.psd`) works too if it is one of the bake's cards (not under `MDW/`
    or `Markers/`), but not for duplicates.
  - `edit`: the card's PSD-kind fields as Publish would leave its entry: the committed Card Edits.json entry with the
    staged op's `set` and `unset` applied, keeping `name`, `stars`, `types`, `hp`, `def`, `atk`, `spd`, `ability` (+
    `creatures` when the entry has a creatures list: it stops a stat bake, as in the bake). All of them, not only the
    staged ones: the bake will bake the committed ones too. Card Edits.json shapes; at most 16 KB; an unknown field or a
    bad value comes back as an input error (`_`-keys are ignored). result.json's `edit` is this object exactly as sent
    (without `_`-keys; a `null` stays a `null`, a creatures list stays the list).
  - Token scopes: a classic token needs `repo` for this endpoint (GitHub's docs; whether the `public_repo` tokens
    sign-in accepts today are enough is item 8 of the test plan); a fine-grained one needs this repository with
    **Actions: Read and write** (and Contents: Read and write, which publishing edits needs anyway). A 403 or 404 with a
    token that signs in is a missing scope: say which. 422: a missing input, or the workflow is not on main.
- **Result**: poll
  `GET https://api.github.com/repos/MichaelJSr/TTSCardMaker/contents/previews/<request>/result.json?ref=previews` with
  `Accept: application/vnd.github.raw+json` and `cache: "no-store"`: 404 until it is published (also before the branch
  exists). Every 10 s for 3 minutes, then every 30 s; give up at 16 minutes (the jobs' timeouts add up to 14) with "no
  result: see the run". The run: `GET .../actions/workflows/card-preview.yml/runs?event=workflow_dispatch&per_page=20`,
  the one whose `display_title` is `Card preview <request>`; when it is `completed` and result.json still 404s a minute
  later, it ended without publishing (a bad request, or the publish job failed): stop polling and link the run. Never
  poll raw.githubusercontent.com for it: raw caches 5 minutes (`max-age=300`), a 404 too.
  - The image, once result.json says `image` (`files.webp`; `files.before`: the card before the edit, for the Diff):
    `https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/previews/previews/<request>/preview.webp` (public, CORS
    `*`; the path is new per request, so the cache never serves an older one; raw serves PNGs as `image/png`, WebP's
    type to confirm on the first dispatch), or the same contents URL with `Accept: application/vnd.github.raw` read as a
    blob into `URL.createObjectURL`. 720 px wide, WebP quality 75 (the card view's width). Beside it `before.webp`: the
    card's official PNG (the one the bake merged onto) made the same way, so the Diff compares one codec with itself and
    unchanged pixels match (the site's thumbs are AVIF: against them codec noise marks 1-5% of an unchanged card red,
    more than a stat edit changes). The full-size PNG is not published (about 1.5 MB a preview; `files` lists the
    WebPs; `size` gives the full card's pixels, `region` the edited box on it).
  - result.json: `state` = `baked` (show the image, `reason` such as `hp 5 -> 8`, `notes`), `redundant` (no image:
    "already on the card", show the current card), `refused` (the bake would refuse it: `reason` such as
    `stat>10: hp 25: above 20`; an image only when `image` is `refused`: what the render got before a later gate refused
    it), `error`, of three kinds: `transient` true: "preview failed, try again" (a runner or GitHub failure, a blob that
    failed its hash), with `run`; `reason` starting `input:`: the site sent something the preview does not take (a site
    bug); any other: the preview cannot run on this card or the repo as it is (a broken shared file such as the icon
    manifest, or a bug in the bot), so show `reason` and `run`, and a new press only helps once that is fixed. `fields`
    gives each field's outcome (`{stars: refused, hp: baked}`), `changes` the old and new values, `notes` the pixel
    misses ("name baked with a pixel difference: bad 1.97%, mean 1.60, max 217"), stars or types not baked, FX layers
    and validator problems; `region` the edited box on the full-size card, `took_s`, `at`. The full table is design
    section 16. Every string goes through `esc()`: reasons and notes quote card text.
- **Stale or current.** A result describes `base` = `{commit, psd_blob, png_blob}` (full blob shas) and `edit`. It is
  current while (a) the card's PSD and PNG on main are still those blobs and (b) the fields the site would send now are
  the edit it sent: compare with the edit stored at dispatch (or `result.edit`, the same object), both as canonical JSON
  (keys sorted; build both the same way, so a cleared field or a creatures list compares as itself). (a) cheaply:
  `base.png_blob.startsWith(c.img)` (cards.json's `img` is the PNG blob's first 16 hex digits; it lags main by a site
  build); exactly, signed in: `GET /repos/MichaelJSr/TTSCardMaker/contents/<folder of c.psd>?ref=main` lists both files'
  `sha` in one call. A stale one: "made on an older version of the card (or edit): preview again"; keep showing it,
  marked, until a new preview replaces it. A change of the bake itself (AutoCroissant main, the fork pin) between the
  preview and the bake is not tracked.
- **Coming back to it.** Keep `{card id: {request, edit, at}}` in localStorage (say `card-previews`) when dispatching,
  so another card, a reload or a crash returns to it; drop an entry when a newer preview of the card replaces it, or on
  a 404 more than a day after `at`. A preview stays at least 6 days unless 150 newer ones came after it: the branch is
  rewritten as one fresh commit when it holds more than 200 previews or one older than 7 days. `index.json` on the
  branch (`.../contents/index.json?ref=previews`) lists every preview
  `{request: {at, card, path, state, psd_blob, png_blob}}`: another device's preview of a card is the newest row with
  its `path` and current blobs (its result.json has the edit).
- **Latency.** About 1-2 minutes for a stat edit and 1.5-3 for an ability or name, from the dispatch to result.json
  (queue, checkouts and the 27 s pip install measured on card-edits.yml's runs; the bake 14 s for a stat and 26 s for an
  ability on the dev Mac under load; the publish job's start, about 10-20 s, estimated), more when Actions queues.
  Several requests run side by side, one commit each on `previews` (retried when the head moved); the same request twice
  waits for the first (don't).
- **Budget.** A preview reads its blobs through the API with the run's GITHUB_TOKEN (1,000 requests an hour for this
  repo, shared with card-edits and card-sync): the icon manifest, the PSD and the PNG (3 for a stat edit, a test), plus
  the status chart for an ability and the added Types/ icons for a types edit. Fine at hobby volume; a burst of a
  hundred previews an hour would compete with the schedules. Size: about 120 KB a preview (Mini Doomer's WebP 59 KB, its
  before.webp about the same, result.json 1 KB), so the branch stays near 24 MB at 200 previews.
- Checks (2026-10-23): AutoCroissant `tests/test_card_preview.py` (the outcomes on a local card repo, a blobless clone's
  REST reads, the bad inputs, values kept off the runner's command lines, the branch's commits and rewrites, a moved
  head and lease, the publisher on the standard library alone, this workflow's shape, no other workflow on the branch,
  and both jobs' own steps run against a bare repo standing in for GitHub, a failed install too); `actionlint` clean.
  Not run: a live dispatch (the workflow must be on main first).

## 20. Token picker and variant pictures (2026-10-23)
- Owner's request (2026-10-23 ~18:00): typing a stoogedings token (it starts with `[`) suggests the icons with their
  pictures and narrows as you type, so nobody has to remember the names, and shows the variants too.
- `assets/tokens.js` (pure helpers above `install`; AutoCroissant tests/test_token_picker.py runs them in node):
  `openToken(text, caret)` -> the token being typed: an unclosed `[` on the caret's line (a name of letters, digits,
  spaces, `_ - . '`, then maybe `:` + letters; at most `MAX_TOKEN` 52 characters, text.js PIECE's limit) or `(` + up to
  7 of text.js TAG's characters (`-?` + 6: `(-1/2GCD)`) that does not start in lower case ("(see below)" and "(only
  once)" never open; "(Only once)" opens at "(O" and closes at "(On"). `close` = the caret, or, when the caret is
  inside a token (the rest of a name, spaces and `:variant` included, then its `]` on the line; for a tag the rest
  and its `)`), past that `]` or `)`; text after the caret that no `]` or `)` closes is never replaced ("[fi|and ice"
  + fire = "[fire]and ice"; until the 2026-10-23 review the rest of the word went too). `tail` = that rest's
  `:variant]` when the font draws it, which a plain icon keeps ("[fi|re:glow]" + fire = "[fire:glow]"; "[fi|:]" +
  fire = "[fire]", never "[fire:]", 2026-10-24). `suggest(open, vocab)`: icons by
  `norm` (case, spaces, `_ - . '` ignored): exact name or alias, name prefix, alias prefix, then (2+ letters) inside a
  name or alias; with none of those (3+ letters), names and aliases whose start is one edit away (two from 6 letters;
  added, dropped, changed or swapped letters: "[fier" -> fire, field); types before stars, then the most used in the
  cards (`uses`: `vocabulary(icons, texts)` counts the tokens in every card's ability; machine 18, fire 9, ice 8 on
  2026-10-23), then by name; an exact match is followed by its variants. After `name:` the
  variants (`VARIANTS` = the bot's ICON_VARIANTS: tint, sticker, no, glow, darkglow; the font gives every icon all of
  them), of that icon when the name is exact, else of every match, prefix first. `(`: `TAGS`, the font's 341
  (badge_tags, the cards' own first, the rulebook's old ones last, all through tagInfo), any case, an exact one first.
  At most 120 rows. `applyChoice` puts the canonical `[name]`, `[name:variant]` or `(TAG)` (a plain icon + `tail`) in
  place of `start..close`, caret after it. `vocabulary(icons, texts)` turns cards.json icons into one entry per icon
  with its other spellings as `keys` and its `uses`.
- The dropdown (`install`, app.js boot; `S.vocab` per data load): one `ul#tok-picker` (role listbox, rows role option
  `#tok-pick-<i>`, each the picture (`renderer.icon(token, {tip: false})`, the variant's own; badgeHtml for a tag),
  the token, the plain name with the variant's or tag's meaning, the kind), moved into the field's `[role=dialog]`
  (aria-modal hides the rest from readers) or body; `position: fixed` under the token's `[` (a mirror div measures the
  caret; above it when there is more room there; `visualViewport` for phone keyboards), 8 rows then it scrolls.
  Fields are `[data-tokens]`: edit.js `#ef-ability` and `#ef-note` (card and rulebook forms), inline.js
  `.inline-ability` and `.inline-note`. Listeners on document, capture: `input` opens and narrows (Backspace widens),
  ArrowLeft/Right/Up/Down/Home/End keyups and pointerups in the field follow the caret (a move out of the token
  closes); keydown while open: Up/Down (wrap), PageUp/Down, Enter or Tab accept, Esc closes the picker only and stops
  the event (inline editing's and the dialog's own Esc come next time), and the token Esc closed stays closed until
  the caret leaves it. Rows: mousedown prevented, so the field keeps the focus and the phone keyboard stays; click
  accepts. Accepting selects `start..close` and runs `execCommand("insertText")` with applyChoice's `insert`
  (undo keeps it; its `input` event updates `#ef-preview`), else sets the value and sends `input`. The field gets
  aria-autocomplete "list" on focus, aria-expanded, aria-controls (while open), aria-activedescendant; a hidden live
  region says how many suggestions. No role combobox: on a multi-line textarea it would hide the textbox role, so
  aria-expanded is a hint some readers skip. IME: no refresh while composing (`compositionend` refreshes), and
  keydowns with keyCode 229 (Safari's composition-ending Enter has isComposing false) never accept.
- Variant pictures: `build_icons` makes `dist/icons/<name>.<variant>.webp` for tint, sticker, glow and darkglow of every
  manifest icon with the font build's own code: build_stoogedings.py `icon_art(im, tint)` (the per-icon part of
  `build()`, moved into a function the font build calls too; the font rebuilt byte-identical with it, 2026-10-23) gives
  the cropped icon, its size in font units, the TRACE-size pixels and the tint, sticker and halo masks; build_site
  `variant_art` places them as the glyphs do (sticker outline pad px past the icon, halo GLOW_SIZE units left of and
  above it) in a square around the icon's square box (where `object-fit: contain` puts the plain icon), reaching
  `variant_reach` past it (OUTLINE / HEIGHT and GLOW_SIZE / HEIGHT, whole pixels at ICON_SIZE: 0.0729 and 0.3021),
  scaled so the icon is as big as the plain one (96 px long side). tint and sticker take the text colour in the font,
  so theirs are white masks (lossless) that style.css paints with `currentColor`; glow and darkglow are the halo PNG
  the font embeds with the icon on it (q90). :no stays style.css's `.tok-no`. Cached by blob in site/.cache/icons as
  `<blob16>-<variant>-<VARIANT_VERSION>-<hash of the build script and the icon's tint mode>.webp`, pruned with the
  icons; cold 12 s for 91 icons (31 s CPU over 8 threads, a busy Mac), warm 0.1 s; 0.7 MB of masks and 1.5 MB of glows
  in dist. Needs the font build's packages (numpy, opencv-python-headless, fonttools): `font_builder()` imports the
  script, and without it or them (or with a script that has no `icon_art`) there is one warning and no variant
  pictures, never a failed build. An icon's `v` in cards.json lists its pictures; `iconVariants` = {variant: reach}
  ({} without them).
- text.js `makeRenderer({cards, icons, variants})` (`variants` = cards.json iconVariants): `[x:tint]` a `span.tokm`
  (the mask in the text colour, 1.35em box), `[x:sticker]` a `span.tokv` (--r: its reach) holding the outline mask and
  the plain icon, `[x:glow]` and `[x:darkglow]` an `img.tokv`. A `.tokv` is (1 + 2 --r) x 1.35em with negative margins
  above and below of --r x 1.35em: it sits on the line as the plain icon does and its halo spills over the lines above
  and below, as Photoshop draws the font's; its full width counts, as the font's spacers widen the token. A variant
  without its picture (an older build) is the plain icon, as the parser reads it. A variant the font has no ligature
  for is letters, as on the card (2026-10-24, text.js `splitToken`, also used by mockup.js `tokenize`): `[fire:]`,
  `[fire:glows]`, and with spaces around it `[fire: glow]` and `[fire:no ]` (until 2026-10-24 these were the plain
  icon). psd_parser still reads `[fire:]` as `[fire]` (its ICON_VARIANTS has "" for no colon).
  `plain()` and build_site's `share_text` still flatten every variant.
- Checks (2026-10-23; harness in ~/Documents/Tools/wt/scratch/picker/: a scratch build of this branch with the image
  cache cloned and AutoCroissant's pickles, served on localhost, driven in WebKit by `browser/shoot.swift`, a
  WKWebView offscreen with GitHub's API answered in the page (a stand-in editor, nothing sent) and IndexedDB hidden;
  screenshots in `shots/`): the Edit dialog's list, narrowing, an exact name's variants, variants after `:`, Enter
  accepting with the preview updated, timing tags, Esc keeping the dialog, no list for "(see below", light theme;
  inline editing (a spaced alias, the first Esc only closing the list, the second cancelling, a click accepting with
  the focus kept), the inline note (Enter accepts, the note stays open), 390 px wide. `variants-font-vs-site.png` sets
  the font's tokens (WebKit draws its OT-SVG glyphs) next to the site's pictures on dark and light: the same look.
  AutoCroissant tests/test_token_picker.py (8): each fails with its part reverted to main. Review fixes the same
  evening (text after the caret kept, a token's variant kept, the 7-character tags, typos, most used first, strict
  `:variant` in text.js, ARIA and IME, site.yml's cache key hashing build_stoogedings.py too): the open-token, ranking,
  timing-tag, choice and text.js tests fail with tokens.js or text.js as before them; screenshots `15-*` and on.
- Not done: the font draws wide icons up to 1.4 em, the site fits every icon (and so its variants) in a 1.35 em square,
  as before; the old `.token-bar` buttons stay.

## 21. Editor: the tooltip, a live preview, drafts, stars and types in place (2026-10-23)
- Owner's requests (2026-10-23 ~18:15-18:45). New logic in five DOM-free modules (pure helpers, plus a few that take an
  element); edit.js, inline.js and app.js only wire them. AutoCroissant `tests/test_site_editor.py` runs them in node.
- **The stuck tooltip** (`assets/tip.js`). Cause: app.js hid the tooltip only on a pointerout from an element that still
  had a tooltip; opening an inline editor deletes the host's `data-tip` (inline.js `open`), so leaving through its
  textarea never hid it, and a re-render under the pointer removed the element it belonged to. Now `tipController` keeps
  the element the tooltip is for: it goes when the pointer leaves that element (pointerout's relatedTarget outside it),
  when the element left the page or lost its tooltip (checked on each pointermove), and on `hideTip()` from code
  (inline.js calls it when an editor opens, closes or commits, and before the dialog re-renders). Every place that
  removes or changes `data-tip` is inline.js (`open` deletes it, `cancel` puts it back, `mountCard`, the palette);
  app.js's `fillTip` is the old pointerover body, unchanged in what it shows. app.js hands inline.js `hideTip` and the icons
  through `inline.extend` (kept off the lines the picker and previews branches change, so their merges stay clean).
- **Live preview** (`assets/live.js`) in the Edit dialog (All fields): the card as it will look once the batch is published,
  redrawn on every input from `readForm`'s op over the published card (`baseOf`: unset fields as their PSD values,
  `previewCard`), nothing staged. Shown: the current card image (`data-preview-image`, the slot an image mock-up can
  draw over), name, kind, item type, stars, series, subseries, author, Hidden, "PSD pending: …" (the printed fields that
  will differ from the PSD, as build_site `apply_edits` computes it: a creatures split adds none), types, stat bars (app.js
  `statBars`), the text with icons and badges (the card renderer), the note, aliases; changed blocks get an accent
  outline. Its links are inert (tabindex -1, no pointer events) so the form isn't left by accident. Layout decision:
  a pane beside the form, not the page behind the dialog (the form replaces the card dialog in the same modal, and on a
  phone a page behind it would be covered anyway). Wide screens (over 1000 px): the dialog widens to 1260 px, the pane is
  the right column (300-400 px), sticky at the top of the scroll. Narrow screens: the form is one column and the pane is a
  "Preview" bar pinned at the top of the dialog (a button, `aria-expanded`), closed by default, remembered while the page
  is open; opened it shows up to 36vh of preview (no image, to save room) and `scroll-padding-top` keeps the field being
  typed in below it; the pane scrolls to the block of the field being typed in (`reveal`, `blockOf`). Rulebook pages keep
  their form without the pane (their text preview under the textarea stays).
- **Drafts** (`assets/drafts.js`): what is typed in the Edit dialog or an inline editor, before it goes into the batch, is
  saved 400 ms after the last key (and at once on `pagehide` or a hidden tab) to localStorage `edit-drafts`:
  `{<card id>: {at, fields: {<field>: value}}}`, the card id being the batch's key (`stage.cards`), field values as the
  form's inputs hold them (text, a checkbox's boolean, the sorted type names, creature rows of text; the ban row as
  `banned`, `ban-group`, `ban-reason`). The Edit dialog writes its changed inputs as the card's whole draft (`changed`
  against how it opened); an inline editor writes its one field into it; the type palette writes `types`. Each field
  also keeps `base`, the value the card showed when it was typed (`{at, fields, base}`).
  "Restore your unsaved edit? Ability, HP · 5 min ago [Restore] [Discard]" shows over the card (edit mode) and at the top
  of the Edit dialog (Restore focused, so a stray key can't throw it away) when a draft holds a field the card doesn't
  show that way now (`restorable`: text compared trimmed, without \r; so a draft equal to the batch is never offered, and
  is dropped). Restore on the card: one text field opens its inline editor with the text, `types` opens the palette, more
  open All fields filled in (`editor.open(id, {draft})`). A draft is lost only by a save, a discard or a publish (review
  of 2026-10-23: clicking the ability box over an offer and pressing Esc, or clicking off, dropped the crash's ability
  text; one key in the dialog's Note replaced a 5-hour-old draft): every editor takes `snap` of the draft when it opens
  and puts it back with `back` when it closes without saving (an inline Esc or a click off with nothing changed, the
  palette's Esc or Cancel, the dialog's Cancel or Esc), whatever was typed meanwhile, so Esc after Restore keeps the
  draft too; typing in the dialog over an unanswered offer joins the older draft (the offer stays). The offer says
  "Ability changed on the card since." when a field's `base` isn't what the card shows now (a newer publish or batch
  edit; `movedSince`), and lists the fields in the form's order. Cleared: Add to batch, an inline commit or palette
  save that staged (those fields), the offer's Discard, the batch's Discard (that card) and Discard all, and Publish
  (the published cards). Not cleared by Sign out (the batch isn't either). On a screen of 820 px or less the card
  page's offer floats at the bottom of the screen until answered (the card image fills the first screen there).
- **Stars in place** (`assets/stars.js`): in edit mode the stars chip becomes a slider of 10 stars (`role=slider`,
  `aria-valuenow`/`valuetext`, the `.fact` look; hover lights the stars a click would set): click a star to set the count
  (the top lit one again sets one less, so 0 is reachable, as the stat cells), arrows, Home, End, Enter to save, Esc to undo
  a keyboard change, a click away saves it; it runs on inline.js's stat-row code (`SLIDERS`, `prov`). A card without stars
  (buffs, auxiliary creatures) gets "+ stars". Over 10: "Use All fields".
- **Types in place** (`assets/palette.js`): the type row (`role=button`, tabindex 0, Enter or Space) or "+ types" opens a palette under it:
  a search box (focused) and chips of every type icon with its name (`aria-pressed`), the card's types first. Typing
  narrows it (name or alias exactly, name prefix, alias prefix, then 2+ letters inside a name or alias: the token picker's
  ranking); Enter in the box toggles the first match and clears it, so "fir Enter wat Enter" adds two; Enter on an empty
  box, Ctrl+Enter, Save or a click or tap away save; Esc or Cancel put the row back; arrows move between chips. The row
  shows the choice as it changes. Saved through `stageField(id, "types", sorted list)`, so the same set in another order is
  no edit. Vocabulary: cards.json `icons` of kind "type" (35 icons, with aliases). The search is the token picker's
  (section 20, `assets/tokens.js`): `palette.useSearch(fn)` swaps the search (fn(vocab, q) -> entries best first),
  `palette.pickerSearch(suggest, all)` is the adapter (the picker's plain type rows, mapped back to the palette's
  entries), and app.js switches it in one line after `tokens.install`:
  `palette.useSearch(palette.pickerSearch(tokens.suggest, () => S.vocab || []));` (without it, `findTypes`). The
  classes are `pal-*` (the picker's are `tp-*`). Against `findTypes`: the same results for 202 of 211 queries; the rest
  are the picker's extras, a slip ("frie", "watr") and the most used first on a tie ("fi": fire, field). In the light
  theme the type icons (palette chips and type rows) get a thin dark outline: "light" and "lightshadow" are white. A
  press on the card dialog's close button while the palette, an inline editor or a keyboard stars change is open saves
  it and closes the dialog in one click (inline.js `closing`: the save skips its redraw, which ate the click). Typing the token picker's "[" in the
  ability box and the note works with drafts and both previews: its choice goes in through an `input` event.
- Checks: AutoCroissant `tests/test_site_editor.py` (13, AC_SITE_SRC; each fails with its logic reverted: a scratch
  mutation run caught 13 of 13), the site tests (70 with this tree). Headless Chrome (Chrome for Testing 156) on a
  scratch build with a fake GitHub API, harnesses in ~/Documents/Tools/wt/scratch/site2-editor/: `tooltip.mjs` 6/6 here,
  2/6 on main's build (the tooltip stays through the click away), and `editor_ui.mjs` 61/61 (signed-out view untouched,
  stars by click and keys, the palette by click, search, Enter, Esc, a click away and "+ types", drafts across a reload of
  an inline field and of the dialog, the offer in both places, never offering what the batch has, Esc and Cancel, Publish
  clearing the published cards' drafts, the preview following name, HP, types and text with "PSD pending", the mobile bar,
  no page errors). Screenshots: ~/Documents/Tools/wt/scratch/site2/shots/editor-*.png.

## 22. Image previews in edit mode: the mock-up and the rendered preview (2026-10-23)
- Owner's asks (2026-10-23 ~18:15-18:45): see an edit on the card image while making it, three ways: a live card page
  (section 21), a **quick mock-up** (the new text and numbers drawn over the card image in the browser, instant,
  labelled as a mock-up) and a **rendered** image ("press preview image to dry run bake a card, work on another card, and
  then go back to the first to see the preview"). The server side of the rendered one is section 19
  (card-preview.yml, AutoCroissant commands/card_preview.py); this is the
  website's side.
- Modules: `assets/mockup.js` (pure helpers, then `draw`) and `assets/preview.js` (pure helpers, then `createPreviews(app)`,
  the viewer, the store and the background check). Both DOM-free at import. Wiring only elsewhere: app.js imports
  `createPreviews`, makes `previews` after the editor (`badges()` re-marks the grid), calls `previews.init()` after
  `editor.init()`, `previews.mountTiles(view)` after `inline.mountGrid`, `previews.mountCard(modal, c)` after
  `inline.mountCard`, `previews.onAuth()` in `onAuth`, and passes `formOpened` to the editor; edit.js as in section 3.
  Everything is gated on `editing()` / `editor.me`: a signed-out page is unchanged. CSS: the `.pv-*` block of style.css
  (theme variables; the ribbon and the grid badge use fixed colours like `.tile .flag`) and the `.iv-*` rules in its
  "round 3: card page" block.
- **The viewer** (2026-10-24, owner's item 14; replaced the "Image with your edit" panel): the card image itself gets
  three tabs, **Original** · **Mock-up** · **Rendered** (`tabsHtml`: `role="tablist" aria-label="Card image"`, roving
  tabindex, "New" on Rendered while a result waits unseen), one image spot that flips in place: `.iv > .iv-stage >
  .iv-orig` holds the original (app.js renders it; on the card page the full-size link and `#detail-img` with its
  720 px swap; never re-rendered, only hidden with `visibility` so the stage keeps its size), `.iv-alt` over it
  (`position: absolute; inset: 0`) the mock-up canvas or the rendered preview, `.iv-caption` under it the text
  (`aria-live`). `.iv[data-show]` = "orig" | "alt" | "dim" (the original at 35% under a state's words: "Baking a
  preview", "The bake would refuse this", "Preview expired", "Not previewed yet", "No image"). Where: on the card page
  for a card whose PSD fields aren't what the PSD prints (`changedOf`: published-not-baked or staged) or that has
  previews (`mountCard`; signed out or nothing to show: the plain image, no tabs); in the Edit dialog at the top of the
  live Preview pane (live.js `paneHtml(open, {viewer, ar})`, outside `#lp-body` so `paintPreview` never touches it;
  the live card shows no second small image: edit.js `previewCtx.image` is empty), centred, at most 52vh tall; up to
  1000 px the pane is a bar and the viewer shows, 30vh tall, beside the live card once the bar is opened. Default tab
  (`defaultMode`): the card page Rendered while the newest preview has an unseen result (showing it marks it seen and
  pins the tab), else Original; the Edit dialog Mock-up while the form changes the image, else Original (it follows
  the form until a tab is picked). A tab picked by hand is kept per card while the page lives (`views`). Keyboard: ←
  → Home End on a focused tab switch tabs (a listener on the tablist with `stopPropagation`, so the card page's ← →
  next-card shortcut doesn't fire); Enter and Space are the buttons'. Only the shown tab costs anything: Original
  fetches no details and draws no canvas.
- **Mock-up** (`mockup.draw(canvas, {card, src, rec, edit, psd, icons, getFonts, raw, onFont, stale})`): the card's 720 px
  thumb (same origin, so the canvas can read it) drawn off-screen and copied when done (a newer draw drops an older one);
  only the fields unlike the PSD are redrawn (`changes`): name, text, stats, stars, types (not a reorder); stats above 10
  are named in the caption ("Not drawn: DEF."), never drawn. Stars and types: section 23.
  - Where: the details record has fonts, sizes and colours but **no text boxes** (psd_details keeps none), so the area
    is the card template's (`TEMPLATES`, fractions of the image measured on the PSDs' layer boxes on 2026-10-23: `tall`
    1200x2400 creatures and minions, whose stat bars sit at (0.3, 0.5, 0.978, 0.535) + 0.0525 a row on 311 of the 390
    cards with digit rows; `item` 1200x1800 with the totems' two rows at 0.624; `square` 1200x1200 status effects; the
    1080x1920 rulebook pages get none): `textArea`, the card's full width, from a little above the template's text
    (0.06 of the height on tall cards, 0.04 on others) but below the card's stat rows (the rows `isBar` sees, else the
    template's for the stats the card has), to the bottom; the name's is the template's name box. In it, the block of
    lines that holds the old text: `textBlocks` (rows and columns of sharp edges; hysteresis, so a short last line joins
    its paragraph; paragraphs are clusters of rows, lines split at quiet rows; size from the line pitch, `LINE` = 1.22
    ems; "left" or "center" from the lines' edges) gives every run of up to 12 neighbouring paragraphs that reaches the
    template's rows, at edge strengths 40, 80 and 130 and two seed strengths (art merges with text at the soft ones, a
    short line seeds a block only at the low one); `calibrate` measures the old text (`tokenize`d, in the card's font)
    against each: k = the block's lines' total width / the old text's width on one line at the block's size, and the
    old text wrapped at the block's width makes about as many lines (within one, or 30%); one line: its size from its
    width (k 0.6-3; its run of rows at least 0.3 em); `lineLike`: no line over 2.2 times the usual height or 2.6 times
    the lowest (art read as a line), three lines in four sharing a centre (a tenth of the width) or a left edge (a
    twentieth); a name: words join within 1.2 line heights (not 4: the stars beside it stay out), one or two lines, as
    many as the old name wraps to. `bestBlock` keeps the one that fits with the most edge mass. A record with
    `text[].box` (canvas px) is the area instead (`recordBox`): adding `layer.bbox` to psd_details' text entries would
    make the mock-up exact (a bot follow-up, not done). An ability layer whose first run is in stoogedings (the text
    starts with a badge) takes the layer's other font from `rec.fonts` (`layerOf`).
  - No block holds the old text (text over busy art, a stylised name, an upside-down card): the new text goes in a
    dark box over the whole area (to the card's edges, opaque, dashed border), so the old text is covered, never half
    there; the caption says "Text in a box: its place on the image wasn't found." (`out.boxed`).
  - Erase: the block's lines (a centred block's made even about its centre: `eraseLines`, a line read short past a dim
    word still goes) plus `strayLines`, lines next to the block it left out (a header in another size or colour, a dim
    last line: within 1.6 pitches, in its columns, edges per em at least 0.3 of its lines' at edge 25, up to 2.4 line
    heights and 1.8 of its tallest, lined up with it, no wider than it nor across the card, and not a stat bar:
    `barLike`, two long straight borders across the band; up to four each way; none for a name). In those lines only,
    pixels at a sharp edge (25: dim words too), with gaps up to 1.2 em on a row filled (a badge's pill, the image's edge
    counting as an edge) and dilated by 0.14 em, take the mean colour of the unmasked pixels around them (cells of 0.8
    em, empty cells from their neighbours, bilinear), so the art keeps its texture outside the letters. The new text's
    fill and outline are read from the old text's pixels on the way (`textColours`: the brightest on a dark background,
    the darkest as the outline when darker than it), else the record's colour; one colour (the card's coloured words
    aren't kept).
  - Text: `tokenize` (an icon token the site knows is an icon, `:no` crossed out; a timing tag text.js knows is a badge,
    any case, drawn as its pill in the site's colours; another bracket or parenthesis stays text; no break inside
    "[ice]."). Under an overlay (`oneColour(rec, layer)`: an enabled ColorOverlay, GradientOverlay or PatternOverlay in
    the details record's `effects` on the ability layer's path or a group above it; 2026-10-25) a badge is a pill
    outline with solid letters and a `:sticker` an outline round its `:tint` mask, both in the text's fill, as the
    font's Stylistic Alternates print them (the bake sets them there: AutoCroissant `psd_edit.one_colour`); the sticker
    outline is the `:sticker` mask with a shrunk copy cut out (`paintMask`), close to the font's 40-unit line. `layout` / `fit` at the calibrated size and the old line pitch, from the old first line down (a PSD's
    text grows downwards), at the old width (one old line: the area's, about its centre); shrunk to 40% when it would
    run past the area's bottom, and then the caption says "The text runs past its place on the card." A name keeps
    its line count and stays within the room about its centre. Stats: `barRows` (template rows, only for stats the
    details call "template") checked with `isBar` (ten cells with sharp borders, else "Not drawn: HP"), then
    `cellPlan`: a cell lights as the last lit one (the rounded first cell: its colour) and darkens as the first dark one
    (none or the rounded last: a shade).
  - Measured (scratch bench, ~/Documents/Tools/wt/scratch/site2r3/bench-run.mjs: " Burns [fire]." added to the
    ability, current image left, mock-up right): the review's 16 cards plus alex-yiik, crock-pot, fragile-strength,
    flameblade and the cursed idol: 21 placed, 1 boxed (tainted-lazarus, upside down), none with both versions of a
    line showing; a fresh random 21: all placed, two with a faint ghost of a few letters (fuzzy-horde, grodus-x); the
    old version showed both versions or erased bars or art on 8 of 17. Names (12 cards): 9 placed with the stars
    untouched, 3 boxed (stylised names in fonts the site doesn't have). Sheets: shots `r3-g06-*`, `r3-g07-*`,
    `r3-g08-mock-names.png`.
  - Fonts: `data/fonts.json` (build_site `web_fonts`): `{"fonts": {PSD font name: {file, bytes}}}` for the fonts the
    details records' text layers name, as font_check decides them (a face with exactly that PostScript name, the first
    file by path; since AutoCroissant 89039eb, 2026-10-23, no aliases or loose matches, and the build follows:
    `FONT_NAMES_VERSION` 2); `font_faces` reads the name table without fontTools and equals font_check.face_names on all
    of MDW/Fonts; only .ttf / .otf up to 8 MB (a collection holds several faces); names cached by blob sha in
    `site/.cache/fonts.json` (CI downloads a font only when its blob is new, 8 at a time, like the PNGs). 131 of the 137
    PSD fonts on the evening's build. The browser loads one
    as a `FontFace` when first drawn: its WOFF2 copy on the site, else from raw.githubusercontent.com (§32) (60 ms for a loaded one, else drawn in a stand-in and
    redrawn when it arrives); the caption names a stand-in, and a role whose record names no font ("Stand-in font for the
    name (the card's isn't known)": 266 of 818 records have no name layer). The last 24 images used stay decoded.
  - Label: a "Mock-up" ribbon on the image and the caption "Mock-up: the real image comes from the bake".
    Caption notes (`mockNote`, exported): what went in a box ("Stars in a box: their places on the image weren't
    found."), ran over, wasn't drawn, the bake would refuse ("The bake would refuse the stars: <why>."), stand-in fonts.
    `<why>` is `plainWhy(why)` (2026-10-24): psd_edit's refusal mapped to plain words by `PLAIN_WHY` ("the card's folder
    sets them" for "the '5 Stars' folder sets them (moving the card is ledger S9)"), else the text without its field,
    boxes and ledger codes; a reworded refusal in psd_edit needs its pattern here too. Rendered says them the same way
    (`plainReason`, `plainNote`): a refused reason's "unsupported-card: stars: <why>" parts read "The bake would refuse
    the stars: <why>.", a "stars not baked: <code>: <why>" note "The stars weren't baked: <why>."; other reasons and
    notes lose ledger codes only.
- **Rendered** (`createPreviews`): the Action's side is one adapter, `CONTRACT` (workflow, ref, branch, inputs, paths).
  - Start: `GET .../actions/workflows/card-preview.yml` (404: "isn't set up on the card repo yet"), then
    `POST .../dispatches` with `{ref: "main", inputs: {card: c.key, edit: JSON.stringify(edit), request}}`. `edit` =
    `entryEdit(editor.entryFields(id, op), get)`: every PSD-kind field of the card's Card Edits.json entry as Publish
    would leave it (built + published-not-built + the batch's op, or the open form's), plus `creatures` when it holds
    several, in the edits file's shapes; at most 16 KB as card_preview counts it (UTF-8 bytes: `editBytes`). In the Edit dialog the form's values go, saved to the batch or
    not. `request` = `<login>-<time base 36>-<4 random>` (`newRequest`; the Action takes 8-64 of A-Z a-z 0-9 -).
  - Token: a classic token needs the repo scope for the dispatch (GitHub's docs; the sign-in accepts public_repo), a
    fine-grained one Actions: Read and write. A 403/404 says so (`startProblem`: "Your token has only the public_repo
    scope" when the sign-in's scopes say so, else "can't start Actions"); a public_repo-only token also gets a note under
    the button before anyone presses it. 401: sign in again; 422: GitHub's message; no network: try again.
  - Store: localStorage `card-previews` = `{card id: [entry, newest first]}`, the last `KEEP` (3) per card, entry =
    `{card, key, name, request, edit, hash, base: {ts, img} at the dispatch, at, state, result?, run?, seen?}`;
    `readStore` drops anything malformed; another tab's writes arrive through the `storage` event.
  - Background check: while any entry is running and someone is signed in, from any page, at the contract's pace
    (`pollDelay`: every 10 s while one started under 3 minutes ago, then every 30 s), `GET .../contents/previews/
    <request>/result.json?ref=previews` (raw, through the editor's `gh`: never raw.githubusercontent, which caches a 404);
    404 = not yet. Also the run, by `display_title` containing the request (the workflow's run-name "Card preview
    <request>"), for a link, and an error when it ended without a result (seen twice). Only a check that finds nothing
    times an entry out (`missed`: past `MAX_WAIT_MS`, 16 minutes, or its own wait: "No result yet" with Check again,
    10 more minutes, and Preview again; past a day it never comes: expired), so a result that came while the site was
    closed is found on the next load (the review's case: press, close the laptop, come back 25 minutes later); the
    first round after a load or a sign-in also looks once at the timed-out ones (`due`). One tab checks for all
    (`takeLock`: localStorage `card-previews-poll` = `{tab, until}`, 75 s, given up on `pagehide`); the others see the
    results through the `storage` event. A round's results make one toast, in the tab you're looking at ("Preview
    ready: Abbi", "Previews finished: Abbi, Acro and Poison"; `finished`, `finishedToast`, 400 ms to gather the
    storage events). Signed out, no timer runs; signing in starts it. Several cards run side by side.
  - Expiry: the previews branch keeps a preview about a week (rewritten past 200 previews or 7 days). `expire` makes a
    result or timeout older than 6 days "expired" (no image, no badge: "Its image is gone: previews are kept about a
    week." with Preview again) and drops entries older than 30 days; the preview image's 404 more than a day after the
    press does the same (the contract's rule). A card whose only previews are expired and that has no PSD change gets
    no viewer.
  - Result: `readResult` keeps state, transient, reason, notes (20, 500 characters), fields, changes, base, image,
    files (`webp`, `png`, `before`: `.webp` / `.png` names only) and the run (a github.com link only); anything else is a transient
    error. Baked: the preview (preview.webp, 720 px) in the image's place, a link to full size (preview.png when `files` lists one: since work/card-preview a1274af7 it never does, so the WebP), Diff
    swapping in the red differences (`diffPixels` against the result's `before.webp`, hidden: changed pixels red over the
    dimmed card, with the share in the caption; a result without one, from before it was published, diffs against the
    720 px AVIF thumb with a note that codec noise shows too); `renderedParts(e, v)` -> `{stage, caption, dim}`, `renderedHtml` =
    stage + caption; each field's outcome ("HP baked · Stars
    refused") and the notes. Redundant: "Already on the card". Refused: the reason, with the bake's render when
    `image` is "refused". Baked without an image file: "The bake drew it, but no image came with the result." with the
    outcomes (not an error). Error: an `input:` reason is "a website bug", a transient one "try again"; when the edit
    changed since, "Out of date" with Preview again instead of Try again (which would send the newer edit). Every string
    through `esc()`. "Earlier:" previews are chips (bordered, the shown one pressed).
  - Badge: a tile gets "Preview" (`.pv-badge`, under the flag) while its card's newest preview has a result not yet
    seen (`hasNews`); the Rendered tab says "New"; showing the Rendered tab on the card page marks it seen. A start
    that failed at once is seen already.
  - Out of date (`staleWhy`): the edit the site would send now hashes differently (`hashOf` over `canonical`: sorted
    keys, sorted types), or the card's image moved (the result's `base.png_blob` against cards.json `img`, its first 16
    hex digits; before a result, the card's `ts` and `img` at the dispatch): "Out of date: the edit changed since" with
    Preview again. Kept, not dropped: the last three stay listed under "Earlier:".
  - The server contract's suggestions not followed: the request id above instead of `crypto.randomUUID()` (both fit);
    `card-previews` with three per card instead of `edit-previews` with one; index.json (another device's previews) not
    read yet. (Polling follows the contract since the 2026-10-23 review: until then every 15 s up to 20 minutes.)
  - Between Publish and the site's rebuild the PSD values come from the built card (edit.js `psdVal` reads `pristine`),
    so a newly published PSD field still counts as one the image doesn't show yet: the mock-up and Preview image stay
    (they read the published-not-built card as printed before). Open viewers are forgotten as soon as they leave the
    page (`prune` on every mount).
- Checks (2026-10-23): AutoCroissant `tests/test_site_previews.py` (19 tests on preview.js and mockup.js in node and on
  build_site's font names: the entry edit, hashes, request ids, result.json, the store, staleness, badges, start
  messages, the panel per state, the diff, text found on drawn pixels with a weak line, erase, wrapping and fitting,
  stat cells and bars, the record's boxes, font names equal to fontTools' on all of MDW/Fonts, the font map and its
  cache); 21 mutations of the new code each fail one. In a real browser (Chrome for Testing 156 headless over the
  DevTools protocol, GitHub's API and raw files faked; a scratch harness, not kept): sign-in, the mock-up following the
  form in the card's font (FOT Pop Happiness on Mini Doomer), the dispatch's inputs, two previews running at once,
  badges on two tiles, side by side and the diff, a refusal, out of date after an edit, light and dark, 375 px (nothing
  wider than the screen), the Action missing, a token that can't start Actions. Screenshots:
  `~/Documents/Tools/wt/scratch/site2/shots/previews-*.png`. Not run: a live dispatch (card-preview.yml must be on main).
- Merged with section 21 on branch work/site-round-2 (2026-10-23). The Edit dialog over 1000 px: the fields, this panel
  floated beside "On the card image", and the live pane on the right (its small image is the current one, as the
  published page shows it until the bake); at 1000 px and below the pane is the bar at the top and this panel stays in
  the form. Restore in the form's draft offer now fires the form's `input` event, so this panel redraws as for a key
  (it kept the old values until the next one). Inline stars, types and text stage PSD fields, so the card page's panel
  comes as soon as one is staged. The server contract as of work/card-preview a1274af7: only the WebP is published (no
  Full size link then), and a previewed edit is public, so the panel says "Anyone can see a previewed edit, as with a
  published one" before the first press. Fonts renamed on main (92b5ae6b) still map: 130 of 137 PSD fonts. Checks:
  scratch `~/Documents/Tools/wt/scratch/site-round-2/integ.mjs` 34/34 in headless Chrome (every feature of sections
  19 and 20 and where they meet; screenshots `round2-*.png`); `trial.mjs` 15/15 on a trial merge with work/token-picker
  8d605085 and the palette switch line (the picker in the dialog and the inline editor with drafts, the live pane and
  the mock-up; the palette with its search); the AutoCroissant site tests.
- Review fixes (2026-10-23 evening, after merging main's picker and card previews): the mock-up's block search,
  stray lines, badges and box (above); drafts that survive an editor closed without saving (section 21); results
  found after the site was closed, expiry, one checking tab, one toast a round, the contract's pace; baked without a
  file; an error's Try again when the edit changed; UTF-8 size; psdVal after Publish; the close button; the type row
  as a button; the phone offer, the 1001-1240 px dialog, light-theme type icons. Checks: AutoCroissant
  `tests/test_site_previews.py` (27) and `tests/test_site_editor.py` (16), the twelve new or changed ones failing on the
  code before; all 179 site, picker, card-preview and font_check tests with this tree. In headless Chrome (scratch ~/Documents/Tools/wt/scratch/site2r3/:
  `integ/integ.mjs` 34/34 and `integ/trial.mjs` 15/15 on the merged tree; the review's probes rerun in `h/`): an
  offered draft kept through Esc, a click off and a dialog's Esc; typing over the dialog's offer joins it; Esc after
  Restore keeps it; a 25-minute-old running preview found baked on load with its badge (1 request); an 8-day-old one
  expired with no panel, a 2-day-old one whose image 404s expired; two tabs: one checks (8 requests for 2 previews in
  33 s), one toast each; close while the palette is open: saved and closed in one click; 1024 px dialog: the Name
  input 362 px (128 before), 9 type columns. Screenshots `~/Documents/Tools/wt/scratch/site2/shots/r3-*.png`.

## 23. Round 3: the card page (2026-10-24)
- Owner's items 1, 2, 4 and 14. Item 2: the notes under Image versions ("Each commit that changed the image...") and
  Recorded changes ("From the bot's card history...") are gone; the per-entry "date approximate" stays. Item 4: the
  Cards tab's "PSD details" chip and the `has:details` search (section 11). Item 1: Add to deck, Compare and Edit sit under
  the card image (`.image-wrap > .card-actions`, after the viewer, before the ← → links); `.detail` keeps its two
  children in order (image column, info column: inline.js reads `:scope > div:nth-child(2)`).
- Item 14a: the image viewer (section 22, "The viewer").
- Item 14b: the mock-up draws stars and type icons. AutoCroissant's psd_details record has a `header` (since
  AutoCroissant's work/r3-card-page; records gathered before have none): `{"stars": {"units": [{core, box}], "icon",
  "at": {"1".."10": [[cx, cy]]}, "refused": {"n" | "*": why}} | null, "types": {"row": [{name, core, box}], "spots":
  {"n": [boxes past the row]}, "fixed": [[name, why]], "tokens", "refused"} | null}`, canvas px (the mock-up scales by
  `rec.canvas.w`), a section psd-tools can't read "error: ...". `units`: the shown stars in reading order (rows top to
  bottom, each right to left: the order the bake hides from); `at[n]`: each count's centres, the bake's own plan
  (psd_edit.plan_stars: rows of two re-centred, hidden stars shown, copies) when it lays the count out, else the
  geometry (the first n, then `_star_layouts`; a refused count is still drawn); `icon`: the star layer the bake copies.
  `row`: the header icons plan_types reads, slot order; `spots[n]`: where a row of n puts the icons past the row
  (`_icon_spots`, per n: the bake picks the first option that stays clear for that n); `fixed`: icons the bake can't
  take off (a frame, a group). Site: `changes()` returns `stars` `[from, to]` and `types` `[old, new]`; `starPlan` keeps
  a shown star when one of the count's centres is within a quarter of a star of it, erases the others (their box, glow
  included) and draws a star at every centre none covers (none: all erased); `typePlan` mirrors plan_types (kept icons
  stay in their slot, removed ones are erased, a kept icon past the new count moves to the first free slot, new ones
  take the next free slots); `fillBox` fills an erased box from the ring of pixels around it (the left-right and
  top-bottom blends, weighted by nearness, so a gradient goes on through); stars are drawn with the record's star icon
  (`S.icons`, else the last star's own pixels), types with their icons, with a soft shadow for the PSD's drop shadow and
  glow. No header, no layout for the count, a token row, or units unlike the stars (The Lich King: 4 units for 5 stars):
  a dark box over `TEMPLATES[shape].stars` / `.types` with the new stars in rows of two (right to left) or the icons
  down a column, and the caption says so (no stars or types left: no box, "Not drawn: stars"); a refusal is named.
- Measured (the new gather over all 764 card PSDs of the Desktop clone, read-only, 36 s with 6 workers; the median
  header 147 ms, the slowest 338 ms, +~1.5 KB a record): 660 with a stars section (494 every count refused for one
  reason, mostly "the 'N Stars' folder sets them"; 577 with every count 1-10 laid out; 10 with none), 687 with a type
  row (526 one icon, 142 two, 15 three, 4 four), 0 token rows, 0 errors. The bake's plan and the geometry agree within
  4 px on 232 of 248 laid-out counts of 30 random PSD-star cards; the 16 others (rows of two re-centred, hidden stars
  shown) are why `at` takes the plan. TEMPLATES' stars and types areas are the median union boxes per shape from the
  same run. Re-measure from psd_details.json once regathered.
- The regather (`python -m commands.psd_details --clone ...`) waits for the history backfill, with the bot idle, and is
  committed under the pickle rules; until then every record lacks `header` and the mock-up boxes stars and types.
- Checks: AutoCroissant `tests/test_site_build.py` (the buttons' order, the notes and the chip gone),
  `tests/test_site_previews.py` (tabs and default tab, rendered stage/caption split, starPlan, typePlan, fillBox,
  mockNote), `tests/test_site_editor.py` (the pane's viewer), `tests/test_psd_details.py` (Mini Doomer's, The Lich
  King's and The Freezer's header). Mutations (the close-up rule, the keep rule, fillBox's ring, `_reading`'s
  right_first) each fail a test. Headless Chrome over the live site with these assets (fake sign-in, a fake
  card-preview.yml run, header records served for 8 cards): signed out unchanged but for the buttons; the viewer on
  the card page and in the Edit dialog at 1400, 1100, 900 and 390 px (nothing wider than the screen; the tabs clear of
  the close button on a phone); ← → on a tab switch tabs, elsewhere cards; Preview image, the result by default with
  New, Diff in place; Mini Doomer 2 -> 3 and 2 -> 1 stars, light -> fire; The Lich King boxed with its refusal; Whelp
  drawn with its refusal; The Freezer + ice under its field icon; Goombella boxed; no console errors.

## 24. Editing round 3: item type, drops, the stuck "+" box, autofill, the pinned tray (2026-10-24)
- Owner's items 3, 15, 16, 17, 18. AutoCroissant `tests/test_site_buckets.py` runs the helpers in node.
- **Item type** (`ITEM_TYPES` in edit.js) is the `Items/` folders, lower case, as the build reads them
  (`parts[1].lower()`): a fixed select in All fields, like Kind. An off-list value (a hand edit) still shows as an option.
  A new item type needs its folder first, then the list (the test keeps the two equal).
- **Drops staged nothing in Safari (item 18).** The drop targets cancelled `dragover` only. In the HTML drag model
  (Safari, Firefox) an uncancelled `dragenter` makes `<body>` the current target, its `dragover` isn't cancelled, so no
  `drop` fires; Chrome is lenient. Now `dragenter` runs the same handler. Also: the tile drags, not its `<img>`
  (`draggable=false`), so the drag carries no image URL; the ids are kept in `dragged` (dataTransfer only as a fallback);
  `body.dragging-cards` is added a frame later (a layout change inside `dragstart` cancels the drag). Checked in Chrome
  by replaying the spec's order (`check18.mjs`), and a trusted drag still stages; not in Safari here (no WebKit tooling).
- **`inline.dropOn(ids, {key, value, series})`** is the one staging path: a filter-bar value (`targetOf` reads its
  list's `data-drop`/`data-series`), a pinned box (`data-pin-k/v/s`: `data-v` would be a chart tooltip), a tap on a box, a number key.
- **The stuck "+" box (item 3).** Reproduced: `+ stars` swapped its chip for a slider at none, and nothing put the chip
  back. Now that slider is `data-fresh`: focus leaving it, a click away or Esc with nothing chosen gives back `+ stars`
  (a keyboard change still saves; moved and back to none counts as nothing chosen, `atNone`). The text editors closed only on `focusout`, which a tap on plain content in iOS
  Safari never fires, and the native `<datalist>` popover (series, subseries, author) could outlive its input. A capture
  `pointerdown` outside the open editor (not on the token list, not on the dialog's scrollbar) now saves it as a click
  elsewhere does (unchanged: closes; the filter bar's "New …" input too); the palette has had the same rule. `cancel`
  blurs the input before it goes. Ratings inputs are no inline editor: with none open, a click stages nothing.
- **Name autofill (item 16).** Series, subseries and author fields (inline, the filter bar's "New …", All fields, the
  profile's "Cards as") are `[data-suggest="series|subseries|author"]` and use tokens.js's list instead of a native
  `<datalist>` (the other half of item 3, and the same list in every browser). The whole value is the query
  (`suggestNames`: same name, prefix, a word's prefix, inside, then one slip, the closest whole name first; ties: the
  card's own series' subseries, most cards, name). An empty field lists at once with no row chosen (Enter and Tab go on
  to the field, so tabbing through never fills it; ↓ chooses the first, ↑ the last); a field holding a value lists once
  you type, its first row chosen only when it is the same name, a prefix or a word's prefix (else Enter keeps the typed
  name). Rows come from edit.js `names(kind, series)` (cards in `S.all`, so staged edits count, plus the pending
  buckets; a subseries of another series reads "Mario · 3 cards"). The subseries field's series: `data-series` (inline)
  or `data-series-from="ef-series"` (All fields), resolved by app.js `seriesFor`. A pick fires `suggest-pick` (detail:
  the row): the inline editor and the filter bar save at once; Esc closes only the list, typing reopens it. The list
  closes on a press outside it, with its field (`tokens.dismiss`, called by inline.js `cancel`/`commit`), and when its
  field is gone. `#ef-dup_of` keeps its card datalist (a card picker, not a name).
- **The pinned tray (item 17)**, `assets/tray.js`: edit mode, Cards grid. Pins in `localStorage["edit-pins"]`
  (`[{k, v, s?}]`, at most 9, `readPins` drops junk, repeats by `nameKey`, a subseries without its series), never
  published. A box is a button (`data-pin/k/v/s`, "Subseries · Mario", the card count from `S.all`, so staged edits
  count) with its ✕ beside it, not inside (no nested buttons). Drag onto it, tap it with cards selected, or press 1-9
  (app.js keydown, after the `#edit-form` return, only with a selection and the tray on screen, Grid view; 1-6 still
  switch tabs otherwise; switching to Table clears the selection, which it can't show): all three
  call `inline.dropOn`. A subseries box stages only cards already in its series, as staged (`splitBySeries`, the rest
  `refused` in `stageMany`'s result and the toast). `KINDS` is the registry: a new kind is one entry plus `stageMany`
  support for its key. The pin form (Pin a box, + Pin) uses the name list; a pick pins it (a subseries row brings its
  series; typed: the filter bar's series, else the one series that has it), Enter pins, Esc or an empty click away
  cancels (a `click` capture, not pointerdown, so the repaint never moves or removes what was pressed: a box, ✕,
  Select or a tile still gets the click). Opening, closing and unpinning repaint the tray in place; only a drop re-renders the grid. Sticky under the
  bar on wide screens; on phones (tall bar) it scrolls with the page, and sticks over the bar while **Select** is on
  (a tap on a tile selects it; Done or Esc ends it).

## 25. Ratings (2026-10-24)
- File `site/Card Ratings.json` (AutoCroissant `card_edits.CardRatings`, `dump_ratings`): `{about, cards: {"Card Name": [{date
  "YYYY-MM-DD", scale "favorability" | "power", value 1-10 (one decimal; whole as an int), by "group" | <login>, source
  "TTS session" | "website"}]}}`, keyed like Card Edits.json (`card_key`), one line per card, lists ordered by date,
  source (TTS first), by (lower case), scale. Not a card file: no Action, card sync, check or bot reads it (AutoCroissant
  `test_bot_ignores_ratings`); not in EDIT_PATHS, so no edit batch.
- The import (AutoCroissant `python -m commands.tts_ratings`, by hand; re-runs replace the sessions' group entries and keep
  the rest): TS_Save_3 2023-04-28, TS_Save_8 2025-03-02, TS_Save_10 2025-04-28 (the session evenings). Each board's five
  3DText labels (power: Plz buff :(, Below Average, Balens, Above Average, Too Stronk; favorability: Pain, Dislike,
  Bogstandard, Like, Nut on you) at x positions: the value is piecewise linear in a card's x between the label midpoints
  (midpoint i/i+1 -> 2i+2.5; label i about 2i+1.5, exactly when centred; past the end labels the same half-band), clamped
  1-10, one decimal. Skipped: TS_Save_3's joke "Double Pain" column, the Forbidden Tier (The Missile, Kalecgos), the 265
  TS_Save_10 power placements left where TS_Save_8 had them (only Prince Of Darkness moved). The import stops when a
  value's `tierOf` isn't the category the save shows (1148 of 1148 agree). 1148 entries, 399 names (Cho'Gath and Ech:
  archived, kept under their names).
- Build (`parse_ratings`, `apply_ratings` after `read_profiles`, before `contributions`): cards.json `ratings` on the
  card whose `key` matches, a login shown as its row's name (`login_rows()`, as contributions keys it; then kept as
  `login`, `rater_shown`); a duplicate's go to its original (All Purpose Medical Kit2's two TS_Save_3 entries); a name
  matching an archived row goes to its `renamedId` card, else onto the row (changelog.json `archived[].ratings`); others
  warn "names match no card" (Cho'Gath and Ech until the history backfill tags them archived). `files.ratings`. Python
  twins of ratings.js: `rating_now(entries, scale, day, skip)` -> `{value, raters, date}` | None, `tier_of(v)`.
- `assets/ratings.js` (pure): `SCALES`, `TIERS` (display labels), `tierOf` (edges 2.5/4.5/6.5/8.5), `latestBy(list,
  scale, {day, skip})`, `current(list, scale, {day, skip})` (mean of each rater's latest; "group" is one rater),
  `ratingDates`, `hasPersonal(cards, scale?)`, `dayLabel`, `chartSvg`, `blockHtml`. The card page's Ratings block
  (`#card-ratings` after `#card-balance`; a duplicate's page shows and rates its original's): per scale the current
  value, its category, "group · <date>" or "n raters · latest <date>", and a chart (y fixed 1-10, power's dashed
  "balanced" line at 5.5, the line through each date's consensus, group dots filled, a person's hollow, unpublished
  dashed; tooltips through `[data-v]`); "All ratings" table.
- Editing: `op.rate = {favorability?, power?}` on the card's op (like `op.ban`): the card page's Rate it (`rate-add`,
  `stageRating`; the page repainted where it was scrolled), All fields' Ratings fieldset (none on a duplicate)
  (`readForm`; prefilled from the staged op, `myRating`), bar lines "Favorability 7.5" (`rate-<scale>` items, reverted
  by `withoutItem`). `applyOp` adds preview entries (by "you", `_staged`/`_sent`; `rater` = your published entries'
  `by`, matched on `login || by`, so `latestBy` counts you once) and `c._rate` (drafts.js `rawOf`). `publish` writes
  `ratingsFile(text, ops, <Pacific day>, login)`: your entry of that day and scale replaced, others kept; `editsFile`
  skips a rating-only op, so Card Edits.json is untouched. `RATINGS_ABOUT` = `CardRatings.ABOUT`.

## 26. Stats round 3: distributions, Ratings and History, the Archive (2026-10-24)
- Removed: Balance's "The cooldown update" (`bal-cooldown`, `WAVE`, `groupOf`) and analytics.py's `old` row flag
  (`OLD_RE`, `NEW_RE`; the log line keeps `timing tags n`). Chart texts are one short line (70 characters at most) or
  none; the Balance intro is one sentence.
- Distributions (stats.js): `countValues(cards, k)` (one pass), `distPages(counts)` (page 0 = 0-10 always, page k =
  10k+1 … 10k+10 when a value is there), `pageRange(k)`. One `.dist-panel` per stat with every page rendered and all
  but the current one hidden, one y scale per stat (`columns({max})`; a non-zero column at least 3 px, `minH`, and pages above 0 print
  each count over its column, `vals`, so a lone card at 12 or 20 shows; `padT: 14` keeps the top tick's number
  under the stat's label, as on the profile's activity rows, 2026-10-24); a stat with values past 10 gets `.dist-pager`
  (‹ range ›), `tabindex` and an aria-label. app.js `distPage(panel, step)` flips the pages (no re-render) and keeps
  the page in `S.distPage` (per session, passed to renderStats as `ctx.distPage`); ←/→ page it while focus is in a paged
  panel (keydown, right after the Changes tabs' block). The table lists 0-10 and every higher value present.
  `fmt` uses one cached `Intl.NumberFormat`.
- Top part, cards only (`cardCharts`, after Average stats by star level): `shapes` (creatures and minions by their
  single highest stat, ties "Tied"), `cooldowns` (each ability's cooldown tag by its recurring number, CD 1/2/3+ and GCD
  1/2+, and its uses tag, U 1/2/3+ (S15's nU, review 2026-10-24), per star level; average turns of the cooldowns; shading per column or table, never "darker", which flips with the theme), `words` (median words per ability, timing tags left out, per star level and
  kind; under 3 cards "—"), `itemtypes` (item type x stars). stats.js now exports `heatTable(head, rows, {numericFrom,
  shade, all})`, `heatScale`, `scatter` (options `xTickLabel`, `x0`, `x1`, `y0`, `y1`, `yTicks`, a point's `v`),
  `stacked` (`tip(cat)`), and `chartCard`'s `startTable` (opens on the table, the button reads Chart). Jump links
  (`nav.stats-jump`, `data-scroll`): Balance, Ratings (when a card has a published rating), History.
- Balance (balance.js; exports `diverging`, `legend`): `bal-creep` (power creep: each cohort member's total minus its
  star level's median, averaged per year of `created`; years under 3 cards only in the table), `bal-series` (series
  strength: the same per series, chart for 5+ members, the 8 strongest and 8 weakest past 16; opens on the table with
  cards, members, average stars, authors, top author; left out under a series filter), `bal-stats` (buffs and nerfs by
  stat: points raised and lowered per stat over every `bal` row, `twoSided`).
- Ratings (`assets/insights.js` `ratingsHtml(A, {cards, banned}, params)`; "" when no card has a published rating;
  staged and sent entries never count; helpers from ratings.js): `rat-power` (creatures and minions' current power vs
  strength, least-squares line, labelled: the 8 farthest 1.5+ from it; 10+ points), `rat-fav` (favorability from the
  mean, top and bottom 10; a card counts with the group's rating or 3+ raters), `rat-divisive` (once someone other than
  the group rated: 3+ people's latest, population SD, `dotRows`), `rat-movers` (favorability at its first date vs now,
  0.5+), `rat-bans` (power tier x ban list), `rat-nerfed` (the first day a card's power was Too Stronk or Plz buff, then
  its first nerf or buff after it, Pacific `dayOf`; no buff or nerf in scope: "No buffs or nerfs recorded yet.").
  Charts that need analytics.json (`rat-power`, `rat-nerfed`) are left out without it.
- History (`historyHtml(A, {cards}, params)`): `hist-who` (card author x who changed the image, top 7 each and Others,
  from analytics.json `revisions`), `hist-revised` (image changes per card), both "Needs a full-history build." when
  `revisions.available` is false; `hist-created` (cards per year of `created`, the top 4 authors and Others),
  `hist-fresh` (the year a card's text last changed: `since` when it has history, else its creation), `hist-archive`
  (retired and deleted per year archived from analytics.json `archived`, renames left out; median life = archived minus
  `created`). history.js gained `dayOf`, `yearOf` (Pacific, one cached formatter). app.js fills `#stats-ratings` and
  `#stats-history` with Balance once analytics.json loads, and with `A = null` when it fails.
- Build: `archived_cards(old_stats, id_of, stats, people, credited)` adds `tag` (`archive_tag`: renamed_to renamed,
  moved_to MDW/Unfinished unfinished (owner, 2026-10-24), other moved_to retired, else deleted; `ARCHIVE_TAGS`), `author` (a renamed card's: Card Authors.txt by the live card it
  became > by the archived name, or by its title when no live card has that title: 'Pizza (item)' is not the live
  Pizza's > the live card's author (`author_of`) > the tag's `author` (backfill) > the last version's, through
  `person`), `created` (the last version's `created.date`, else the Pacific day of its oldest
  version), `series` (the renamed card's, else the last version's as a live series spells it: 'kirby' -> 'Kirby',
  `SERIES_ALIASES` for old folder names). analytics.json gains `archived` (`ARCHIVED_SLIM`: card, title, tag, card_type, stars, series, at,
  created, author; no ratings, commit or path) and `revisions` = `{available, mass: MASS_PASS, cards: {id: {name: n}}}`
  from `card_revisions(found, by_png, commits, people, by_login, skip=rule_ids)`: each image version after a PNG's first
  upload, mass passes (`mass_passes`: commits in more than `MASS_PASS` = 20 cards' versions, rulebook pages not counted)
  left out, credited by `commit_keys(row)` (`who()` of the author; a bot commit: the row (`login_rows()`) of each
  non-`discord:` Edit-by login, else the login; none without trailers); every card id of the PNG gets the counts,
  rulebook pages none. Computed once in main() after `apply_ratings`; the person pages read the same counts. Log line
  `revisions: n card image changes on m cards`.
- Archive tab (`#/changes/archive`, changes.js `archiveHtml(rows, repo, params)`): the archived rows newest first with
  their tag pill (`archiveTagHtml`: `.fact.arch.<tag>`, the paths in its tip), "renamed to <card>", kind, stars, author,
  date and commit; chips per tag (`?tag=`). `ARCHIVE_TAGS` and `archiveTag(row)` (the build's key, else from the fields)
  are shared with the person page. The Changelog tab no longer lists the archived cards; an archived event shows its
  pill, a renamed one "renamed to".

## 27. Speed pass (2026-10-24)

Measured with a local mirror of the live site (scratch site-perf2/front: serve.mjs, run.mjs, same.mjs). Rules the code now
relies on:
- `route(e)` runs once per navigation: a hash navigation fires `popstate` then `hashchange` (same URL, `e.newURL`); the
  `hashchange` of that pair is skipped. A `popstate` alone (c/<id>/ to the root) still routes. Closing a card over the
  rendered view only closes it while `viewSig()` is what `renderView` saw (`S.rev`, bumped by `derive()`; the hands; the
  comparison; the login; the theme) and the view holds no `.loading` (its data came while the dialog was open: the
  loaders' callbacks skip a view under a card); else the view is drawn again (an edit, a hand or Compare changed in the
  dialog). State a dialog can change that a view shows belongs in `viewSig`; a loading placeholder carries `.loading`.
- Dates: `dateFmt(opts)` (text.js) is `toLocaleDateString(undefined, opts)` with its `Intl.DateTimeFormat` made once.
  Use it (or history.js `date`/`month`) for any date shown per row. stats.js `heatScale()` reads the CSS ramp once per
  theme (`heatMemo`); `fmt` prints whole numbers under 1000 with String() where the formatter prints the same
  (`PLAIN`); history.js `dayOf` and balance.js `dayKey` keep each Pacific day per UTC hour (whole-hour offsets only).
- Stats: at the top of the page with the Balance slot below the window, Balance, Ratings and History are filled after
  the first screen has painted (`statsJob` drops a stale fill); scrolled, they are filled at once as before. The fill
  reads the rendered hash (`S.renderedHash`), so a card opened in the meantime gets them filled under it.
- Cards grid: `fillGrid` keeps each tile's node in `gridTiles` (card id -> its markup, node, edit mode) and reuses it
  while `tileHtml` gives the same markup. Code that changes a tile in place must drop it (`refresh` does for the deck
  button) or set its change again after every render (edit mode: `mountGrid`'s draggable, `reflect`, `mountTiles`).
  Each render puts in the tiles that cover the window (`GRID_FIRST` or more) and the rest in `GRID_CHUNK` tasks
  (`gridJob` stops them); in edit mode the later ones get their marks there (inline.js `markTiles`, `mountTiles`).
- Back and Forward draw everything at once (`S.restoring`: the entry's `history.state.drawn`, stamped by `syncUrl`;
  `setParams` keeps it), so the browser's scroll restoration finds the page long enough: grid, table and Stats alike.
- Table view: `tableHtml` writes the rows that cover the window (at least `TABLE_FIRST`, 30 px a row at most, so the
  scroll position holds), `fillTable` appends the rest in `TABLE_CHUNK` tasks; a newer render stops them (`tableJob`).
  Until the last rows are in, a collapsed `tbody.sizer` holds copies of the rest's widest rows per column (`sizerRows`:
  per text column the 3 widest lines and 2 widest words measured on a canvas in the table's fonts, 13.5 px and the
  subseries' 12 px, words split at spaces and after a hyphen; numbers by length; Types by icon count; rows with PSD chips
  always; thumbnails left out, they shrink to fit), so the columns keep their final widths from the first frame. A new
  column or font size in `rowHtml` needs its line in `sizerRows`' `cols`.
- Rulebook: rules.json re-derives (`editor.refresh`) only when a staged or published-not-built edit is on a rulebook
  page (`editor.touches`). No `content-visibility` on its pages: the TOC's smooth jumps landed off target (the pages'
  estimated heights change as they render on the way).
- Read `scrollY` and the window size before replacing the view (renderCards `win`, renderStatsView `top`, `vh`): read
  after, they force a layout of the short page (`innerWidth` too on phones) and the scroll position clamps.
- Mentions: `mentions()` parses without building the icons' HTML (`parse(text, self, false)`); it must keep finding
  what `render()` links (test_site_speed).
- index.html preloads every module app.js imports (unbundled builds; with esbuild the one bundle, §31). Type icons and the filter toggles load lazily.
- A card opened from a link (nothing rendered yet) draws no grid behind it: `S.list` is the grid's list (prev/next),
  the grid comes when the dialog closes, or when something draws the view under the dialog (`rerender` with no card
  dialog showing). A link to a missing card draws the grid at once (then the toast). The dialog's first picture is the
  grid tile's when it has loaded (`placeholderOf`), else the 720 px one a share page preloads, else the 360 px one.
- Build: index.html gets `grid_preload(cards)`: a script that preloads the first `GRID_PRELOADS` pictures of the
  grid's first cards (Name order) with grid.js's srcset and the saved tile size, only for the plain
  grid. c/<id>/ pages preload the 720 px picture. grid.js `thumb`, `imgAttrs` and `TILE_SIZES` must match these.
- Stamps (`?v=`): an asset's is its served text's hash with its imports' stamps in it (`asset_stamps`; an import cycle:
  one stamp for all); the data's (`<meta name="build">`, data URLs) hashes the data and details files without the build
  time (`steady`: `generated`, `since`). A build that changed nothing keeps every URL.
- Deploys: site.yml runs on pushes that touch what the build reads (`paths`). `build.txt` digests the whole site
  without the build time (`dist_digest`); a run whose build equals the live one (its build.txt) doesn't deploy (§28).

## 28. Pictures: AVIF, the deploy gate (2026-10-24, owner's decisions)

- Card images are AVIF only: `IMAGE_SIZES` {240: 60, 360: 55, 720: 50} (quality), `AVIF` (4:4:4, speed 6, one thread
  each; the image pool runs cards in parallel), named `thumbs/<blob16>-<w>-<tag>.avif`: `thumb_tag(w)` is 6 hex digits
  of `THUMB_VERSION`, the width, its quality and `AVIF` (not max_threads), and cards.json `thumbs` gives app.js `img()`
  the three. A settings change renames that width's files, so it re-encodes that width only (restored older caches
  too) and returning visitors' caches never hold old bytes under the URL; bump `THUMB_VERSION` to re-encode all (a
  resize change). No WebP fallback: Safari before 16 shows no card pictures (accepted).
- Quality (ssimulacra2 against a LANCZOS reference on the dark background, all 817 images; scratch site-img-adv2
  score_all.py, q240.jsonl, q360.jsonl): q50 everywhere (the first pick, from a 60-card sample without rulebook pages)
  scored below WebP q80 at 240 px on 483 images (by more than 5 on 259; rulebook pages 76.3 -> 70.7, small text visibly
  smudged) and at 360 px on 401 (by more than 5 on 110). q60 at 240: below WebP by more than 5 on 2, mean +8.5, 12.9 MB
  vs 16.7 (-23%); q55 at 360: by more than 5 on 11, no rulebook page, mean +5.8, 19.5 vs 28.4 MB (-31%); q50 at 720:
  mean +4, 42.6 vs 63.4 MB (-33%). Red text keeps its colour (4:4:4). The og JPEGs and deck montages are made from
  the 720 px AVIF (Pillow decodes it). requirements.txt pins `pillow>=11.3` (AVIF in the wheels); the build stops at
  once on a Pillow without AVIF.
- Encode cost: about 0.8 CPU-s per card on the Mac (WebP: 0.09); a full re-encode of ~820 entries is about 11 CPU-min
  there (870 vs 211 CPU-s for a whole cold build), an estimated 20-25 on the runner. `IMAGE_BUDGET` (site.yml: 1800 s):
  images not made by then are left and the build fails. `images.json` is written in a `finally` around the image pool,
  and site.yml's last step saves `site/.cache` under `card-images-v2-...-partial-<run>` whenever the job failed after the
  build step ran (out of time, too many failed downloads, an error, the step's 38-minute timeout, a later step:
  actions/cache saves only after a passing job) and the cache's file names changed (`cache-before` / `cache-after`: a
  build that stopped before the images, e.g. no bot data, adds no ~160 MB copy), which the next run's restore-keys pick up. Later runs encode only new
  blobs. The thumbs carry no ICC profile (`icc_profile=None`: Pillow's AVIF writer copies the PNG's, about 3 KB, +34% at
  240 px; WebP never had one, so colours are as before).
- Deploy gate (restored): the `changed` step compares `dist/build.txt` with the live `build.txt`; equal: no upload, no
  deploy job; unreadable: deploy. `dist_digest` hashes every file's bytes (thumbs too, about 0.4 s) and nothing else: an
  edit to build_site.py alone builds the same digest (it used to hash the script, which deployed byte-identical sites). The Changes page says "Site updated <time> (Pacific), the last build that changed it":
  `generated` is the time of the deployed build, which is now the last build that changed the site. edit.js
  `sentRecord` still clears on `generated > sent.at`: a published batch that made a commit changes the site (the commit
  is in the changelog), so its build deploys. A batch GitHub already had (commitFiles returns null: a ratings, admins
  or people file equal to the batch) writes no sent record, so nothing waits for a deploy the gate would skip.
- Icon file names carry a stamp: `icons/<name>.<stamp>.webp` and `icons/<name>.<stamp>.<variant>.webp` (10 hex digits:
  sha256 of the blob, `ICON_VERSION`, `VARIANT_VERSION` and the variant key; text.js `variantFile` inserts the variant).
  Not a `?v=` query: Pages ignores it, so a tab left open across a deploy got the new file for its old stamp and a
  cache kept it under that stamp, which a revert then served (scratch site-img/review/sim; fixed, site-img/fix4/sim.mjs:
  the old stamp's URL is a 404 under the next deploy and the revert serves its own bytes).
- Accent colours (`color`: share pages' theme-color, embed bars) come from the PNG's 240 px resize before encoding
  (`accent_color(image)`), not the decoded thumb, so codec settings don't move them; images.json rows of the WebP builds
  (`IMAGE_META_WEBP`) are kept, so no card's colour changes with the switch (a fresh computation would move about 60 of
  772 by a near-tie vote). Drop `IMAGE_META_WEBP` once deployed.
- Measured over plain http://127.0.0.1 (a Pages-like server: max-age=600, an ETag per deploy; HTTPS with
  --ignore-certificate-errors turns Chrome's HTTP cache off and skews repeat visits), medians, main vs AVIF: desktop grid
  first visit 1401 -> 1208 KB (240 px thumbs 904 -> 703; q50 was 1019), after a deploy 1401 -> 1207 KB; 4x phone
  (9 Mbps, 85 ms) grid first 709 -> 628 KB (q50: 599), after a deploy 709 -> 627; card page first 500 -> 493 KB. AVIF
  costs nothing measurable in time: revisit first paint desktop 12 / 12 ms, phone 30 / 30; LCP after a deploy desktop
  76 / 80, phone 798 / 802; phone grid first visit LCP 996 -> 1020 (scratch site-img/fix4/load4.mjs, fix5/m/load6.mjs).
- No service worker (owner 2026-10-24, after a trial on this branch; never deployed): one that kept the thumbs and
  stamped icons across deploys saved 0.26-0.84 MB per returning visitor after each deploy (phone / desktop grid) but
  cost every return visit about 8 ms (desktop) and 22-26 ms (4x phone) of first paint, with or without a static route,
  even when it handled no request (a controlled page costs, not the picture path); LCP was unchanged (scratch
  site-img/fix5). The browser's HTTP cache still reuses an unchanged thumb within its 10 minutes, and a changed card
  gets a new name. The trial's code: work/site-img's history (da24fc0e..c50eafcb).

## 29. A new deploy reaches open pages (2026-10-25)

- Pages sends every file with `Cache-Control: max-age=600`, so a browser that had the site in the last 10 minutes kept
  the old index.html (and its old `?v=` URLs) for up to 10 minutes after a deploy, and an open tab never changed.
- `build.txt` has a 2nd line, the page's stamp: a hash of index.html's template once its `?v=` stamps and the data's
  are in (`<meta name="page">`; every page shares it). site.yml's gate compares the whole file, so nothing changes
  there.
- `assets/fresh.js` (app.js `init().finally(fresh.watch)`): fetches `build.txt?t=<now>` with `cache: "no-store"` on
  load, when the tab shows again (`visibilitychange`) and every 3 minutes; another stamp reloads the page
  (`fetch(page, {cache: "reload"})`, then `location.reload()`: Chrome revalidates the HTML on reload anyway). With
  something typed or open (`[data-dirty="1"]`, `.editing`, a form or text field in the dialog, a focused text field) it
  shows a "The site was updated. Refresh" bar instead; its button reloads (edit.js's beforeunload still asks for a dirty
  form, drafts flush on pagehide). sessionStorage `fresh-tried`: one automatic reload per stamp (a stale CDN copy
  gets the bar, not a loop).
- After a publish (edit.js `soon()`, and on load while a sent record waits): every 15 s for 15 minutes from `sent.at`.
  The reloaded page's `sentRecord` clears with a "Live now" toast once cards.json's `source` (the built commit's
  committer date, `git show -s --format=%cI HEAD`; VOLATILE, so a code-only commit keeps the digest) reaches
  `sent.committed` (the publish commit's `committer.date` from GitHub): both GitHub's clocks, not the build's clock
  against the browser's (a build that checked out an earlier commit but ran after the publish isn't taken for it). A
  build without the publish keeps the record and the checks. No `source` or `committed`: `generated > sent.at`.
- Measured (scratch site-fresh: serve.py, a Pages-like server with max-age=600 and ETags; measure.mjs, headless
  Chrome; the AC test fixture's site, deploy = new card text), seconds from the deploy until the open page has it:
  tab left open: never (by 660 s) -> 178 (the 3-minute check); tab shown again 5 s after: never -> 5.1 (0.1 after the
  return); site opened again: 601 (max-age) -> 1.2 (the cached page loads, then reloads); a publish waiting: never ->
  13 (Live now toast, record cleared); typing in the search box: the bar at 5.2, its Refresh 0.1 s after the click.
  The race (a build of an earlier commit landing first, run_race.sh): 719375bb cleared the record on it with "Live now"
  and never showed the real build by 120 s; now the record stays on it and clears on the real build, 14 s after.

## 30. Stats pruned, subseries in the series chart, charts link to the grid (2026-10-25, owner's rulings)
- Removed (UI, data, code): Constructed ban reasons, Last change by month, Top subseries / "<series> by subseries"
  (stats.js); Series strength (balance.js); Rated power vs stats, Power tier vs ban list, "Did Too Stronk cards get
  nerfed?", Who changes whose cards, Most revised cards, Retired and deleted cards (insights.js). analytics.json loses
  `revisions` and `archived` (`ARCHIVED_SLIM` gone); `card_revisions` stays for the person pages (their Most revised
  fact); the Changes page keeps its Archive tab. `ratingsHtml({cards}, params)` and `historyHtml({cards}, params)` no longer take A.
  Dead with them: history.js `monthKey`, `stacked`'s `tip`, the `scatter`/`heatTable`/`heatScale` exports, `.chart .facts`,
  and archived_cards' series spelling (`SERIES_ALIASES`, `series_of`, `live_series`: an archived row keeps its last series).
- Recorded changes by month: no "Timing tags only"; `changeKind` returns null for a row whose only change is its timing
  tags (not counted), "other" when it also changed stars, kind, item type, types or series.
- Creatures by series (the picked kind's when Stats has one: "Items by series"; the Subseries tile, "Creature subseries"
  without a kind, counts the chart's): each series row is followed by its subseries (then "No subseries" when some have none),
  `hbar` rows with `sub` (thinner bar at 55%, muted 11px label); the table has `↳` rows (`tr.sub`, indented).
- Links: `cardsHref(p, scope)` (stats.js) makes `#/cards?…` from grid params over the Stats scope (its kind wins, its
  series unless the element has one; a cohort row passes no scope: it is the whole cohort). `go()` wraps an SVG element
  in `<a class="go" href aria-label="…: show these cards">`; an svg with links drops `role="img"` (it would hide them).
  `hbar`/`columns`/`diverging`/strip rows take `href`; `stacked` takes `href(cat, key?)` (segment, or the column's hit);
  `twoSided`/`updown` take `upHref`/`downHref` and split the hit area in halves; `heatTable` takes `href(row, col)` (an
  `<a>` in the cell, `data-tip`); `legend` items take a 4th `href`. Single-card elements keep `data-card` (open the
  card); unlinked: Others, No subseries, Middle 80%, the over-time panels, the colour keys of the per-card and per-year
  charts (above/below the median or average, rose/fell, raised/lowered).
- Mapping (every link adds nodup=1: Stats counts a duplicate once): kinds kind=; series kind=creature&series= (&subseries=);
  hand kind&stars&legal=1; average stats (Stars and Cards cells) kind=creature,creatures,minion&stars=&hp=0-99 (with
  stats, as the chart), distributions kind=…&hp=v-v; stat shapes shape=; cooldowns cd=
  (CD_KEYS: 1CD, 2CD, 3CD+, 1GCD, 2GCD+, 1U, 2U, 3U+) &stars=; ability length stars&kind; items kind=item&sub=(&stars=);
  types types=; timing tags tag=; status effects and most referenced mentions=<id>; authors author=; cohort rows
  cohort=<key> (balance.js `inCohort`: a |all key holds the kind's every member), Top/Bottom 10% legend bal=top|bottom;
  power creep cohort=any&q=created==Y; buffs and nerfs month=&change=buff|nerf
  (legend: change only); by stat change=hp+ / hp-…; recorded changes month=&change=text|stats|other (column: month,
  any counted change; a segment under 1 unit tall: no link); created per year q=created==Y&author= (legend author=);
  text freshness fresh=Y.
- Grid (app.js filterCards): kind= also matches a raw type (debuff, buff, unknown; chip "Debuffs"); `LINKED` = legal,
  shape (stats.js `shapeOf`), cd (`cooldownCols`), tag (`tagsOf`), mentions (`S.mentionedBy`), fresh (insights.js
  `freshYear`), bal (balance.js `flagged`), cohort (`inCohort`), nodup ("Duplicates hidden"), each a removable chip; month and change go through balance.js `changedAs`
  (Pacific months, `CHANGE_LABEL` chips). bal/cohort/month/change need analytics.json: the grid says "Loading the
  recorded changes…" (count "…") and draws again when it is in. A followed chart link sets `S.toTop` (the grid opens at its top); Back
  restores the Stats scroll (drawn state). The tooltip adds "Show these cards" under a linked element's value; the
  cursor is a pointer only on links and cards (`.chart .hit` lost its pointer).
- Counts: a link opens the cards its element counts (nodup); Types on cards counts a type once per card (Pandora lists
  panda twice). The cooldown and timing-tag charts count abilities' tags, the grid the cards with them.

## 31. First paint: one script (the first screen in index.html was removed the same day) (2026-10-25, owner's decisions)

Owner, 10-25 ~15:00, after the A/B numbers: "Build it": one esbuild bundle with a published source map, the default
view's first 8 tiles in index.html, and a parity check in node that fails the build.
- **Bundle** (`bundle`): with esbuild (site.yml's pinned 0.28.2) `assets/app.js` is app.js and every module it imports,
  minified ESM, with `assets/app.js.map` beside it (sources `src/<file>` with their text inside: published, so devtools
  and any stack-trace tool map a bundle position to the module and line). Its `?v=` hashes the code and the map and is
  on its `sourceMappingURL` too. Every page keeps one `modulepreload` and the script; the other modules' hints go.
  style.css is minified on its own as before. No esbuild (a local build) or a failed bundle (a warning): the modules go
  out one by one, stamped as before (`asset_stamps`). Since §32 the bundle is split: the editor, Stats and People load on
  first use.
- **grid.js**: `tileHtml`, `toolbarHtml`, the Name order (`byKey`, `nameKey`), `SORTS`, `isDesc`, `KIND_LABEL`,
  `thumb`/`imgAttrs`/`iconImg`, `TILE_SIZES`, moved out of app.js and DOM-free (app.js wraps them with its state).
- **First screen: removed 10-25 evening** (owner, after Safari kept flashing): index.html carried the plain grid's first 8 tiles as links (a `<template id="first">`, checked against grid.js in node by `check_first.mjs`); when app.js took over, Safari redrew every picture (the whole grid flashed at ~2 s) even with the tiles kept in the page untouched and the scrollbar's width reserved (`scrollbar-gutter: stable` stays). The page shows "Loading cards…" until app.js draws the grid again, as before. Kept: the bundle, minify, inline CSS, WOFF2 fonts (§32), on-demand chunks (§33).
- Measured 10-25 (scratch opt/site-phone `firstload.mjs` over `serve.mjs`, Pages-like HTTP/2 and gzip; emulated
  mid-range phone, 4x CPU, cold cache; both sites built locally from the same data; 5 interleaved runs, median (range)):
  slow 4G LCP 3.43 (3.42-3.44) -> 2.05 s (2.01-2.05), fast 4G 0.91 (0.90-0.93) -> 0.50 s (0.46-0.51); FCP unchanged
  (0.70 / 0.25 s); requests 53 -> 26; bytes 569 -> 550 KB. The cost: the pictures now share the line with the script,
  so it runs later: DOMContentLoaded 2.90 -> 3.77 s (fast 0.72 -> 0.89), the whole grid 3.52 -> 4.04 s (fast 1.01 ->
  1.16), TBT +15-20 ms; the tiles are links meanwhile. The bundle alone (no first screen): LCP 3.31, DOMContentLoaded
  3.12, the whole grid 3.40 s. `fetchpriority="low"` on tiles 5-8 changed nothing (the emulated line ignores priority).

## 32. The mock-up's fonts as WOFF2 (2026-10-25, owner's decision)

Owner, 10-25 ~15:20 (S-4 of the optimization plan): WOFF2 copies of the editor's fonts, full glyph sets, only the fonts
the cards use.
- **Build** (`web_woff2`, after `web_fonts`): each file `data/fonts.json` maps (the details records' fonts) gets a WOFF2
  copy, `fonts/<blob16>-<woff2_tag>.woff2`, and its entry `woff2` (that path) and `wbytes`. fontTools' encoder, every
  glyph kept (`woff2_bytes`); the cmap is compiled again by fontTools, because Chrome refuses Apple Kid's own (a format 4
  range past the last glyph). Not the icon font: the mock-up never draws in it (`ICON_FONT`). The tag hashes
  `WOFF2_VERSION` and fontTools' and brotli's versions (pinned in `requirements.txt`): a change re-encodes under new
  names. Cached in `site/.cache/woff2` like the card images (unused ones pruned); a new font blob is the only encode.
  site.yml's cache key hashes the top-level `MDW/Fonts` .ttf/.otf blobs and `requirements.txt` too, so a new font is
  saved once. A font that fails to encode, or no brotli, leaves its entry without `woff2`; never a failed build.
- **Browser** (`mockup.js` `fontSrc`): the FontFace's source is the WOFF2 copy, then the TTF/OTF on raw: a missing copy
  (an old fonts.json after a deploy) falls back by itself.
- Measured on the 10-25 data (130 files): 28.3 MB -> 14.4 MB (51%; per file median 42%, 8-77%). Per card (the fonts of
  its text layers, 814 cards): median 81 -> 37 KB, p90 1,092 -> 313 KB, max 4.76 -> 3.53 MB (PopJoyStd-B). Cold encode
  about 55 s on a Mac (75 CPU-s), warm 0 s; the site grows by 14 MB.
- Checked: every copy decoded again equals its source in glyph order, cmap, hmtx, glyf outlines and instructions or CFF
  charstrings, and the other tables byte for byte (113,823 glyphs, 0 differences). Headless Chrome loads 130 of 130
  copies; from raw it loaded 127 (Academy Engraved LET, EarthboundZero: a bad table directory; Apple Kid: the cmap), so
  those cards' previews now draw in their fonts. The Edit dialog's mock-up of Enraged (Calibri), Monkey D Goofy (EB
  Garamond), Sword (PopJoyStd-B) and Po (an Ability set in stoogedings) draws the same pixels from WOFF2 as from raw;
  Joel Miller (Apple Kid, EarthboundZero) draws in its fonts, where raw gave stand-ins. AutoCroissant
  `tests/test_site_previews.py::test_woff2_copies`.

## 33. Loaded on first use: the editor, Stats, People (2026-10-25, owner's decision)

Owner, 10-25 ~15:20: "Load editor/Stats on demand" (S-3 in the optimization plan). app.js imports three modules with
`import()`, each when first needed; everything else is unchanged.
- **editing.js** (edit.js, inline.js, tray.js, tokens.js, palette.js, preview.js and what they import: live, drafts,
  stars, parts, mockup): the first Edit, Sign in, `e`, Publish a hand, a deck page's owner buttons, `#/u/<login>/edit`, or
  any `data-action` app.js lacks (`act`: edit mode's actions join `actions` once loaded). At boot, beside cards.json, when
  the browser keeps what the editor applies at init (`wantsEditor`: a sealed or old token, a staged batch with something
  in it, a just-published batch, Show hidden, a card preview: edit.js K, login.js SEALED, preview.js KEY; change them
  together); init() waits for it, so staged edits are there on the first draw. Until then `editor` is `IDLE` (nobody
  signed in, nothing staged: `me` null, no pending decks or profiles) and `derive()` runs in init() itself. The token
  picker's vocabulary is made on first use per `S.rev` (it was made in every `derive()`).
- **charts.js** (stats.js, balance.js, insights.js): the Stats tab, a card's Balance block (`loadAnalytics` waits for
  both analytics.json and charts.js, so `S.analytics` set means charts.js is in) and the grid filters the charts link to
  (`shape`, `cd`, `tag`, `fresh`: "Loading…" until charts.js is in, as `bal`, `cohort`, `month`, `change` wait for
  analytics.json).
- **profile.js**: the People tab and person pages (`loadContrib` waits for it, `S.titles` from it). `LOGIN_RE` moved to
  text.js (profile.js re-exports it) so login.js and decks.js, which the deck pages need, don't pull it in.
- **Loading state:** a view shows `<div class="loading">Loading…</div>` (the editor's: "Loading the editor…") and draws
  when it is in (`whenLoaded`: a failure says so with Reload); a click shows the toast "Loading the editor…" until then.
- **Build** (`bundle`): esbuild `--splitting` with `--entry-names=[name] --chunk-names=[name]-[hash]` and a metafile:
  app.js stays `assets/app.js` (`?v=` as before); every other file is a chunk named by its hash (`editing-<hash>.js`,
  `chunk-<hash>.js`, the code shared by several), with its map beside it and its `sourceMappingURL` stamped by its code
  and map. `shared_once` ends each `import()`ed module, in esbuild's copy only, with a bare import of every module the
  page loads: a chunk holds the code one set of entries shares, so the page's modules would otherwise make three chunks
  (each a request beside the first screen's pictures); now app.js imports one. No modulepreload for it: under the
  harness's 4G emulation every request beside the pictures delays them (with the hint: LCP +80 ms slow 4G, +45 ms fast,
  for DOMContentLoaded -0.5 s / -0.14 s more), so app.js fetches it once it runs. `<meta name="chunks">` (every page)
  lists each `import()`'s chunks the page lacks; app.js's `early()` preloads them together before the `import()`, so a
  first open is one round trip, not one per level. A deploy removes the old chunks: a page left open across one gets a
  failed load ("Couldn't load …, Reload") until fresh.js reloads it. Without esbuild the modules go out one by one,
  `import("./x.js?v=…")` stamped like the static imports (`IMPORT_RE`), and index.html's hints list only the page's
  modules (the lazy ones' hints are gone from the template).
- **Sizes** (local build, lane1 data, gzipped): first visit 2 scripts, 60.1 KB (app.js 27.0, its chunk 33.1) against one
  161.5 KB bundle (-101.4 KB); the editor 76.8 + 11.1 (profile.js) + 10.1 (stats.js); Stats 11.1 + 10.1; People 0.8 +
  11.1 + 10.1 (shared chunks once).
- Measured 10-25 (scratch opt/site-phone `firstload.mjs` over `serve.mjs`, as §31; both sites built locally from the same
  data; 5 interleaved cold runs, median): slow 4G LCP 2.05 -> 2.04 s (the first screen's pictures no longer waited on the
  script since §31), the whole grid 4.07 -> 3.57 s, DOMContentLoaded 3.77 -> 3.29 s, TBT 112 -> 72 ms, script 154 -> 113 ms;
  fast 4G LCP 0.49 -> 0.48 s, grid 1.20 -> 1.12 s, DOMContentLoaded 0.90 -> 0.83 s; bytes 564 -> 462 KB. The cost, first
  opens on slow 4G (3 runs): Stats 0.18 -> 0.87 s, People 1.25 -> 1.35 s (its data comes alongside), Edit to the sign-in
  0.02 -> 1.06 s.
- AutoCroissant `tests/test_site_build.py::test_editor_stats_and_people_load_on_first_use` (the stamped `import()`s
  without esbuild; with it, ESBUILD set: no editor, Stats or People source in the first visit's maps, the meta list).

