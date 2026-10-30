# Card browser

Impossibility Simulator's card browser: https://michaeljsr.github.io/TTSCardMaker/. Rebuilt by
`.github/workflows/site.yml` after each Card sync data commit (card pushes and website edits build there, on the new
data), on a push of site code, daily, and on demand (Actions → Card browser → Run workflow).

## What it has

- **Cards**: grid or sortable table; filters for kind, stars, item type, type icons, series and subseries, stat ranges, author, font
  (a text box with autofill; `font=`) and flags, and **Missing** (cards with no series, types, ability, author, artwork
  source...; every sort puts cards lacking its value last). A right-click or long press on a filter excludes it (≠ on the
  Series, Subseries and Author selects). **My filters**: searches saved in this browser ("Save as filter" beside the
  search box), each one a checkbox in the sidebar (`cf=` keeps, `xcf=` drops; a link carries them).
  Sorts include **Newest created** and **Oldest created** (`sort=created`, `&dir=asc` for oldest; the table's Created
  column too; another sort picked from the menu runs in its usual direction): by the card's creation date, ties by
  first upload, then name; a card without one goes last. The creation date is the earlier of its first Discord post
  (`site/Card Creation Dates.json`, below) and the first upload of its image (from the git history); the card page
  shows it as "created <date>" ("created about <date>" while a Discord post awaiting review may still move it).
  The search box speaks the same language as the bot's `/query_ability` (`fire & type==creature`, `hp>7`, `"draw 2"`, `!die`, `|`,
  `created>=2025`, `created==2023-10`: dates at the precision given; spaces around the operator are fine in both),
  and also matches card names and aliases. The table and the Changes tab link "Details" beside PSD chips and parser
  notes (it opens the card with the dropdown open this once; Ctrl-click opens it in a new tab).
- **Card pages**: the card image (click it for the full-size PNG; signed in, with an edit on the image: tabs Original,
  Mock-up and Rendered) with Add to deck, Compare and Edit under it, stat bars, ability text with icons (variants drawn as the card font draws them: `[fire:tint]`
  in the text colour, `[fire:sticker]` on an outline, `[fire:no]` crossed out, `[fire:glow]` and `[fire:darkglow]` on a
  white or black glow), timing-tag badges such as (1CD), (1/2CD), (1GCD) and
  (2U) (hover for the meaning; a closed **Badges** box under the text says what each color means) and links to every card it names (by its printed title or file name, in any case,
  either apostrophe, plural, singular or possessive: "Copper Swords", "an X Fist", "Grodus X's"; a one-word file name
  only when the title is one word too; a one-word name only as the card spells it, capitalized, or lowercase after its
  own verb ("inflict 1T1 smeckeldorfed", "stacks of hardened", "summon a silithid"); not as a label like "Cat:", not
  before a number ("Heal 2 HP"), not as a verb opening a clause ("Flip to the other creature"), and after a capitalized
  word only when that word is a verb or a card: "Summon Jetpack" links, "Evil Quote" doesn't); "mentions", "mentioned by", similar stats,
  same series, text history with changes highlighted, and an image version viewer: every commit that changed the
  card's image, compared side by side with the current one, with the text of that time when it differs (each version,
text or image, links its commit when it is known), and the artwork sources when set. The current
  text is dated from when it started (the bot's carried start), not from the PSD's last commit, which can be a re-save
  that kept the text (the "updated" date). A duplicate (another PNG of the same PSD) shows its original's history; a
  variant picture (one PSD's picture 2, 3...: a duplicate of picture 1) its own. Signed in, each earlier text with a
  commit and each earlier image version has **Revert to this version**: after a confirm listing the files, one commit
  ("<card> reverted to its <day> version") puts the card's PSD and the PNGs printed from it (its variants' and numbered
  duplicates' too; a picture-only duplicate: its PNG) back as they were at that commit, at today's paths (renames
  followed); a file that version lacks stays, and `Card Edits.json` is left as it is (its edits still show).
  Every date on the site is Pacific time, the bot's, whatever the viewer's time zone, and commits are dated when they
  landed (committer time), as the bot dates versions.
  A creature's or minion's **Balance** line compares its total stats (HP + DEF + ATK + SPD) with the others of its star
  level ("Total 35, in the top 10% of 4★ creatures: 92 of the 93 have a lower total"), with their median and middle 80%
  for each stat, and a line of its total over time when its stats changed. **Recorded changes** lists, newest first,
  every change the bot recorded to the card: stats (a buff raises the total, a nerf lowers it), stars, kind, item type,
  types, series, timing tags ("(1PT) → (1CD)") and rewordings (each with its word diff). Dates are Pacific time; one
  from an older record (the bot kept no PSD for it) is marked approximate unless a commit of the PSD has that date, and
  a PSD read again by a newer parser is not a change (the newer reading counts).
  A **Details** dropdown at the bottom of the card page (closed by default; the browser remembers it, its sections and
  fonts, for the session) shows the PSD's structure as the bot read it: fonts (each expandable to its layers; one that
  `MDW/Fonts` lacks is flagged "missing from MDW/Fonts", "not checked" when the bot had no font index), every text
  layer (text, font, size, colour, visible), layer effects, smart objects, canvas (size, mode, depth, ICC profile),
  how the type icons are made (image layers or icon-font tokens), how each stat row is built (template digit row,
  Top + Bottom rows, drawn bars), status-word layers (FX layers and overlay words), the template check (Name and
  Ability layers, deviations), the parser's notes with the PSD-vs-edited values, and the layer tree (rendered when
  its section opens).
  "Decks using this card" lists the public published decks that hold it (the first six, then a link to all of them).
  Every card has a shareable link (`/c/<card>/`, the address bar's URL; `c` copies it) that shows a rich preview in Discord.
- **Ratings**: each card's favorability and power, 1 to 10, over time, on its card page; signed-in editors add theirs.
- **Rulebook**: written on the website, no Photoshop. One text file per chapter in `site/rulebook/` (`NN-slug.md`: the
  number is the book's order, the slug the chapter's link, `#/rules/<slug>` and `#/rules/<slug>/<section>`), its
  pictures in `site/rulebook/img/` (the mascots, the table and reaction diagrams, taken from the Photoshop pages) and
  its two web fonts in `site/rulebook/fonts/` (Inconsolata for Consolas, EB Garamond for the ability boxes; OFL).
  `rulebook.js` draws them in the book's look: lavender panels with italic tabs, the dark ability boxes, mascots saying
  the in-jokes, real card pictures (`![[Card]]`, from the card data, so they follow the cards), badges and icons as on
  cards; the syntax is at the top of `rulebook.js` and behind the editor's Syntax button. The contents follow the
  reading; search shows only the passages that match; each chapter's History (the ban list's too) lists its commits and
  shows each one as a git-style diff (old and new line numbers, removed and added lines, the changed words marked; a
  renumbered chapter's rename followed), from GitHub's API without a sign-in; signed in, an earlier version has
  **Revert to this version** (the ban list's: admins), one commit ("Rulebook: Death reverted to 2026-10-30 10:22")
  making that version's text the current one. Each chapter has an Edit
  button, each section a ✎ (signed in), and the contents a New chapter button: the text beside the page as it will look
  (or as its TTS pages), linked both ways (click the page to reach its line; the cursor shows its block). Pictures, card
  rows and mascots are dragged to move them on the page: dropped on blank space a picture stays where it lands (snapped
  to its panel's edges and centre, with guides); a picked section, panel, box or row (click it, again for its parent)
  takes the drops landing in it; with **Make space** on, drops go into the text, which makes room (a row gains a
  column; on blank space, between the sections). A selected picture gets a tools bar above the page: the 3×3 anchor
  grid (a row's picture in its column, a placed one in its panel, one in the text at the top, middle or end of its
  panel and left, on its own line or right), size, delete and Make space; arrow keys nudge it (with Make space, through
  the text). Pictures come from the Pictures menu (search; Add as Picture or Mascot says) or from the computer (Add
  picture, paste, or drop image files on the page: resized to 1080 px, WebP, published with the chapter); the Insert
  and Colour menus add blocks and colour the selection. A card box picks cards by name. Undo and redo (↶ ↷, Ctrl/Cmd+Z,
  Shift+Z or Y); Ctrl/Cmd+B, I and S (publish). A draft stays in the browser until Publish, which commits the chapter (and its new
  pictures) straight to main. **TTS pages** (`#/rules/print`) cut the same chapters into 1080×1920
  pages (the cover, then "STATS", "STATS 2"... numbered 7, 7.2), as the Photoshop pages were; `=== page ===` starts a new
  one. Card sync's main lane prints them to `TTS/Rulebook/Rulebook.pdf` (real text: searchable, selectable, bookmarks;
  `pages.json` keeps each page's pixel hash so it is printed again only when a page changes; AutoCroissant
  `commands.rulebook_pages`, once the website shows main's chapters), and the save's Rulebooks bag holds it as one PDF
  object (the Photoshop pages are out of the save since 10-30; their files are in `MDW/Old Rules/Rulebook`). The contents' PDF button opens
  it. A chapter push starts Card sync (the bot's `db/rulebook.json` at once, the PDF after its 30-minute window).
  Also the badge colors, the timing-tag glossary and the constructed ban list. Old page links
  (`#/rules/07-stats3`, `#/rules?q=07 Stats3`) open their chapter.
- **Deck builder**: the constructed starting hand from the rulebook (7 creatures, 10 items, one of each, no banned cards,
  optional starting field), with live checks, several saved decks, share links, text import/export, random fill,
  printable proxies, and a Tabletop Simulator saved-object download. Signed in, **Publish…** on a saved hand makes it a
  deck anyone can open: public, or private (encrypted in the browser with a passphrase; only the owner's login, the file
  name made from the deck's name and the date are in clear, and the passphrase cannot be recovered).
- **Published decks** (`#/decks`, linked from the Deck builder page; a deck page is `#/decks/<owner>/<slug>`, static
  `decks/<owner>/<slug>/` that previews in Discord): tiles with the owner, the card count, a complete-hand mark and a
  few card images; filters for text, owner, a card (`?card=<id>`, from a card's page) and complete hands, sorted by date,
  name or owner. A search on the Cards tab also says how many public decks it finds ("2 public decks match
  “bagels”", by deck name, owner, description or card name) and links there. Private decks are not in
  the browser (nor in its count or owner list): they show only on their owner's page and at their own link. A deck's page
  shows the hand grouped like the deck builder with the hand checks, and offers Save a copy to my decks, Share link, Copy
  as text, Discord, TTS save and Print; its owner (or an admin) can replace it with another saved hand or unpublish it. A
  private deck asks for its passphrase (remembered on the device if you tick **Remember on this device**, encrypted with a
  key that can't leave the browser; **Forget** on the deck page drops it). A person's page lists their decks, the
  private ones as locked links. Format in `site/decks/README.md`; see Decks below.
- **Stats**: counts by kind, series (each with its subseries under it), type, timing tag, status effect and author; how many legal cards there are
  for each star level of the starting hand; average stats per star level; stat shapes (each creature's highest stat),
  cooldowns and uses by star level, ability length by star level and kind, items by type and stars; stat distributions (0-10, with
  `‹ ›` or `←`/`→` on a stat that goes higher); and a total-stats-vs-stars chart that highlights possible balance
  outliers. Every chart has a table view; jump links go to Balance, Ratings and History.
  **Balance**: the total stats of each star level of creatures and minions (the middle 80%, the median, the lowest and
  highest, the top and bottom 10% as dots), the strongest and weakest for their star level, each star level's average
  total over time (full-history builds), power creep (by year created), buffs and nerfs by month and by stat, every
  recorded change by month (timing-tag-only changes left out), the most reworked cards. A star level with fewer than 5
  cards is compared with all cards of its kind, and so are the auxiliary creatures, with all creatures.
  **Ratings** (once cards have ratings): favourites and least liked, most divisive (once 3 people rate a card), risers
  and fallers. **History**: cards created per year, text freshness. The kind and series filters apply to every section.
  A bar, column, cell or legend entry that stands for a set of cards opens the Cards grid with those cards (a link:
  Back returns to Stats); a single card opens the card.
- **Changes**: a row of category tabs across the top; clicking one (or the arrow keys on a focused tab) shows that
  category alone, the chosen tab underlined, and the address keeps it (`#/changes/changelog`), so a link or a refresh
  opens the same one. **Recently updated** (`#/changes`): recently updated cards with text diffs (none when the update kept the text). **Changelog**: the card
  sync's events of the last 180 days, one block per push as the Discord posts (new cards, changes with their old values
  and an ability word diff, new art, moves, renames, archived and restored cards, database edits, parser re-reads), by day
  in Pacific time, filterable by kind. **Archive**: the cards whose PSD left the card folders, each tagged Renamed,
Retired (moved to MDW/The Morgue), Unfinished (moved to MDW/Unfinished) or Deleted, with chips to filter by tag (`?tag=retired`). **Database edits**: the card sync's edited and authors
  events, and every commit that changed a Card Edits.json entry or a Card Authors.txt line (website or a commit by hand)
  with each field's old and new value. The events need the card sync's data (`CARD_DATA_DIR`); until then those parts
  say so. **Parser notes**: the cards the bot hasn't parsed yet and the parser's notes.
- **People** (the tab shows how many): everyone who made, edited or committed cards, in one table (GitHub picture, cards
  credited, edit batches published on the website, card commits, public decks, titles, motto), and a page per person
  (`#/u/<name>`, static `u/<name>/` that previews in Discord; **Share** opens a dialog with the link, the Discord preview
  and buttons to copy it as a Discord message or plain text: name, titles and counts, never the motto): their profile when they made one (see People below), their
  GitHub picture and link, their contributions with recently edited cards, recent edit batches and recent card commits, a chart of
  their contributions by month, and a Cards panel: their cards by kind (chips to the Cards tab), the series they mostly draw from, their newest card
  (by its creation date) and a grid of their 24 newest cards; the chart counts cards by creation month. Since round 3 the page
  also has their ranks and edited fields, **Balance** (their cards' strength, buffs and nerfs on them and made to others'),
  **Ratings** (how others rate their cards), **Revisions** (who changes their cards' images, whose they change, reworks),
  **Style** (types, status effects and timing tags they use more than others, wordiness, star and kind mix) and
  **Archived cards**; the Cards panel adds their years, series, banned cards and most referenced card. All from
  `contributions.json` and the cards already loaded. The Cards tab has a **Banned (constructed)** flag.

Top right: **Sign in** (a GitHub token, or your login and password once you set one; see Editing) becomes your login
once signed in; it opens the editor hub (your batch, your profile, your password, sign out). Keyboard: `/` search, `Esc` close, `←`/`→` previous/next card (on a focused stat distribution: more values), `↑`/`↓` image versions,
`d` add to deck, `c` copy link, `x` compare, `e` edit (All fields when signed in), `r` random, `1`–`6` sections (signed in,
with cards selected: `1`–`9` drop them on the first nine pinned boxes), `?` help. The single-key
shortcuts are off while an edit form is open (a card's edit dialog or the profile editor) and while an inline control or a
stat row has focus; `Esc` cancels an inline edit, otherwise it still closes a dialog.

## Where the data comes from

The build does not parse PSDs. Card text, stats, history and PSD details come from the card sync's `db/` (branch
`data`, the only source since 2026-10-25; `CARD_DATA_DIR`, which site.yml sets to its checkout and a local build needs:
`git worktree add /tmp/carddata origin/data`, then `CARD_DATA_DIR=/tmp/carddata/db`): its `stats.json`, `old_stats.json`
and `psd_details.json`, read into stand-ins of the bot's classes (`load_card_data`), the same data the Discord bot
answers from. AutoCroissant's pickles (`stats.pkl`, `aliases.pkl`, `old_stats.pkl`) are gone. The cards' aliases are
their Card Edits entries' (`aliases.pkl` moved into it on 2026-10-22), and no `_by: AutoCroissant` entry (the migration's aliases and series, the moved stat exclusions) counts as a website edit. Where the
migration added a field to an editor's entry, the entry keeps the editor's `_by` and lists that field in `_bot`
(`"_bot":["series"]`): `_bot` holds the fields that are not the stamp editor's. Such a field is nobody's edit, so the
Edited badge, the person page and the stamp-counted edit batches leave it out (the build's `botEdited`). An edit on
the website takes a field it sets or unsets out of `_bot`, and an edit to a `_by: AutoCroissant` entry first lists the
entry's fields in `_bot`, so the editor gets only the fields they change (edit.js `editsFile`). No readable `stats.json` stops the build and the site stays as it was; the
history is skipped with a warning. A field the site reads that the cards lack (a rename in AutoCroissant's
`commands/card_models.py`), or a field it doesn't know, is a warning in the log and on the Actions run. Images, icons, the ban list, icon names, profiles, published decks and password files come from this
repo. Cards that are in the repo but not yet in the bot's data still appear (image only).

The Details dropdown reads `db/psd_details.json` (one record per card PSD keyed by its git blob sha, gathered by the
card sync's build). The build joins a record to a card by the PSD's blob at HEAD, else the blob the bot parsed,
else the newest record for that path, writes `data/details/<id>.json` (the record plus the card's id and name; a
duplicate gets its original's) and sets `details: true` on the card or rulebook page. No file, or no record for a card: no dropdown;
the build never fails on it.

Authors come from `site/Card Authors.txt` when a card is listed there (the bot uses the same file), otherwise from the
bot's data; `[people]` maps git names to the names shown. The hand-kept files `Card Authors.txt`, `Card Edits.json`,
`Card Creation Dates.json`, `Website Admins.txt` and `Constructed Ban List.txt` sit directly under `site/` (moved from `MDW/`
on 2026-10-20), as does `Card Ratings.json` (new on 2026-10-24; the build and the website's editor read it, never the bot); the build and the bot read the
others; the published site includes none of them. `Card Creation Dates.json`
holds each card's first Discord post as `{"date": "YYYY-MM-DD", "from": "discord" | "git" | "hand", "provisional": true}`
(dates only, from the Discord archive kept off the repo), written by AutoCroissant's `python -m commands.card_dates
created` (re-run after rulings and archive updates; it keeps `"from": "hand"` entries, the way to set a date by hand).
A card it misses (one made since) is dated by its first upload, with a build log line naming it. The bot reads the file by
the same rule (AutoCroissant `CardDates.created`), its first upload being the earliest version its database holds: the
same day for the cards first uploaded since 2026-02, so `/query_ability created>=…` and the search agree (770 of 770
cards on 2026-10-23, also with the 11 newest left out of the file). It is no edit: the Changes page and the edit
counts never see it. Bad entries are skipped with a warning, never a failed build. `Card Ratings.json` holds each
card's dated ratings, `[{"date", "scale": "favorability" | "power", "value": a whole number 1-10, "by": "group" | <login>, "source":
"TTS session" | "website"}]`, oldest first: the TTS sessions' boards (written by AutoCroissant's `python -m
commands.tts_ratings`) and the website's Rate it. Only the website reads it (cards.json `ratings`, a login shown as its
credited name); no edit either, and the bot never reads it. Image versions and the People tab's commit counts come from one pass over the git history (commit metadata only),
following folder moves (also a move that changed the image: the only PNG of that file name deleted in that commit);
the build needs full history for them (CI fetches it; a shallow local clone gets no image versions and counts edit
batches from `Card Edits.json`'s `_by`/`_at` stamps instead, a floor since the file keeps one batch per card;
`git fetch --unshallow --filter=blob:none` fixes that).

Each card PNG becomes three AVIF images (240 and 360 px for the grid, 720 px for the card view; quality 60/55/50
at 240/360/720, `IMAGE_SIZES` and NOTES §28; 4:4:4, speed 6; AVIF only, so a browser without AVIF, Safari before 16, shows no card pictures), cached by git blob
hash in `site/.cache/img` (a full re-encode is about 11 CPU-minutes on a Mac, more on the runner: `IMAGE_BUDGET` in
`site.yml` splits it over runs when it doesn't fit one); each image's size and accent color are kept by blob in `site/.cache/images.json` and the
icons in `site/.cache/icons` (named with `ICON_VERSION`: bump it when the icon settings change; the token variants' pictures
with `VARIANT_VERSION`, drawn by the icon font's build script, `MDW/Fonts/stoogedings-src/build_stoogedings.py`, which
needs that folder's `requirements.txt`: without it the build warns and variants show as the plain icon), so an unchanged image costs nothing, and `site/dist` gets hardlinks to the cached files (copies
where links fail). The edit mock-up's fonts get WOFF2 copies in `fonts/` (every glyph kept; cached by blob in
`site/.cache/woff2`, NOTES §32); the browser falls back to the file on raw.githubusercontent.com without one. The first screen loads only `data/cards.json`; `analytics.json` (the Balance section and blocks,
computed by `site/build/analytics.py` from the same bot data) loads when the Stats page or a creature, minion or card
with recorded changes is opened; `rules.json`, `history.json`,
`versions.json`, `users.json` and `contributions.json` load when the rulebook, a card's history, the changes feed or the
People tab is opened; `changelog.json` when the Changelog, Archive or Database edits tab is opened; `decks.json` when the published decks, a deck page or a person's decks are opened; `details/<id>.json`
when a card's or rulebook page's Details dropdown is first opened. `tts.json` is the TTS save's: its global script
(`TTS/Global.lua`) fetches it for the Card details, Find a card and Rules buttons (`build_site.py` `tts_details`). Script, style and data URLs
carry a build version (`?v=...`), so a deploy never mixes old scripts with new data. The Action ships the scripts as
one minified bundle, `assets/app.js`, with its source map `assets/app.js.map` (the modules' own text: browser devtools
show and debug them); the editor, the Stats page (and the cards' Balance blocks) and the People pages are chunks of their
own (`assets/editing-*.js`, `charts-*.js`, `profile-*.js`, each with its map), fetched the first time one is opened
("Loading…"), or at once for a browser that keeps a sign-in or a staged edit. A local build without esbuild ships the
modules one by one, those three loaded the same way. `index.html` carries the cards grid's first
eight tiles (plain links to the cards' pages), so a phone shows cards before the script arrives; a visitor with another
saved view gets it once the script runs. The build checks those tiles against the site's own code in node and stops on
any difference (`site/NOTES.md` §31). The build stops (and nothing is deployed) if the bot's data can't be
downloaded or looks truncated, or if many images fail.

## Editing

Anyone with write access to this repo can fix card data on the site: **Sign in** (top right) takes a GitHub token
(classic, `public_repo` scope); signed in, the card browser is the editor. On a card page, click a stat cell to set that
stat (the top lit cell steps it down, so 0 is reachable; above 10 and per-creature stats go through All fields), click
the ability text to edit it in place (Ctrl/Cmd+Enter or a click elsewhere saves, Esc cancels; the card links in the text
still work), double-click the name to rename, and click the series, subseries or author chip, or the note, to type a new
value (series, subseries and author list the known names as you type, in the token picker's list, with their card
counts; picking one saves it; a missing one shows as a dashed `+ series` chip when you
hover the row). In the cards grid, Ctrl/Cmd-click selects tiles (Shift-click a range, Esc clears; a filter change keeps
only the tiles still shown) and dragging one or the selection onto a series, subseries or author in the filter bar (the
values appear under the Series, Subseries and Author selects while you drag) assigns it to every card dragged; a drop changes that one field only. **Pin a box** (in the toolbar, Grid view) pins
a series, subseries or author as a big box over the grid (up to 100, kept in this browser only, never published; ✕
unpins): drag cards onto it, or select cards and press its number (the first nine) or tap it (on a phone, **Select** makes a tap select a
tile; **Done** or Esc ends it). A subseries box sets the subseries only, on cards of any series. To make a new series,
subseries or author, pick **New series…** (**New subseries…**, **New author…**) at the end of its select and type the
name in its place (Enter or a click elsewhere makes it, Esc or nothing typed cancels). It shows as "Name (no cards
yet)" in the select and as a dashed value under it while you drag, and the card page's chips suggest it; the filter
stays as it was, so the cards to drag are still shown. Until a card carries it, it lives only in your browser tab (gone
when the tab closes or you sign out) and nothing is published for it. Names are trimmed, their spaces collapsed and at
most 60 characters; one that differs from a known name only in case or spacing takes the known spelling (the one most
cards use), on the chips and in All fields too ("mario" is the series Mario), and an author's git or GitHub name from
`[people]` becomes the name shown, as the bot resolves it. A drop sets the value exactly as
its chip shows it. A new author's cards go to `[cards]` under a new `# --- credited to Name (n) ---` group, with no
`[people]` line (that maps a login; an admin can add one later). **Rename everywhere** (⇄, under a picked series,
subseries, author or item type in the filter bar, on a pinned box, beside a card's chips) renames that value on every card
that has it, hidden ones too: type the new name (the known ones are listed), the dialog says how many cards change, and
**Add to batch** queues one edit per card. A name that exists merges them into it, in its spelling; an item type must be
one of the Items/ folders; a duplicate's author follows its original (a variant picture keeps its own). An author's `[people]` lines move too (and
`old = new` joins them when the name has none), so git-credited cards, rulebook pages and new PSDs follow; only cards
they don't carry get their own edit. A pinned box or a filter on the old name follows the new one. (It replaces the bot's retired `/mass_replace`.) Every change lands in the batch bar at the bottom as a
sentence ("Goombella: SPD 4 → 5", "Clot Black: Author → Chestnut"), each with ↺ to take it back; the bar folds to one
line when it gets long, and **Review and publish** commits the whole batch at once. **All fields** (e, also in the bar)
opens the full form for everything else (kind, item type (a fixed list: the `Items/` folders), stars, types, aliases, duplicate of, checks, constructed ban,
hidden, creatures). Signed out, none of this shows: the pages are the same to the pixel. Fields go to
`site/Card Edits.json`, authors to `site/Card Authors.txt`, bans to `site/Constructed Ban List.txt`. Card sync reads
them on that commit and rebuilds the site after its data commit. A subseries (Goombella: series Mario, subseries Paper
Mario: The Thousand-Year Door) exists only as an edit (`subseries`; the bot reads it too). It is one group across series:
the same name under two series is one subseries, a card may have one without a series, picking it in the filter bar
shows all its cards (the Series select narrows them), and renaming it renames it everywhere. Edits **on the card image**
(name, stars, types, stats, ability text; the form groups them and the bar marks them, and they show as "PSD pending"
until the image is regenerated) are told apart from **database only** ones, which come from the card's folder or exist
only as edits (kind, item type, series, subseries, note, aliases, author, duplicate of, checks, constructed ban,
hidden, artwork source, ability artwork source). An image field ticked **Website only (don't change the card image)**
is shown on the website and by the bot but never baked (a quiet "Website only" tag). **Also rename the card's files**
(under a name edit) has the bake rename the PSD and PNGs to the new name; links to the old page redirect. Rulebook chapters have their own editor (Rulebook, above), published on its own. "Split into creatures" gives a
card several stat lines (`creatures` in `Card Edits.json`; creature 1 is the card's own stats), each shown with its own
bars. Admins are the repo owner plus the GitHub logins in `site/Website Admins.txt`; they can also ban, hide cards,
rename people, edit the admin list and edit anyone's profile (all committed with the batch). Remove a card's entry from
`Card Edits.json` to go back to the PSD.

**Rate it.** Signed in, a card page's Ratings block has Favorability and Power inputs (whole numbers 1 to 10; All fields
has them too): **Add to batch** stages your rating for today, published with the batch to `site/Card Ratings.json`
(a rating-only batch leaves `Card Edits.json` alone). Rating again the same day replaces yours; removing one is a hand
edit on GitHub.

**Icons and timing tags as you type.** In card text (the ability and note, in place or in All fields, rulebook pages
too) typing `[` lists the icons with their pictures, the ones the cards use most first; typing more narrows the list
(`[fi` shows fire and field; case, spaces, `_` and `-` don't matter, aliases work: `[barn` finds the poorly drawn
barnstar, and a typo still finds the icon: `[fier` shows fire and field), Backspace widens it. A full name lists its
variants under it, and `[fire:` lists only the variants, each with its own picture (`:tint`, `:sticker`, `:no`,
`:glow`, `:darkglow`). `(` and the start of a timing tag (`(1`, `(O`, `(Act`) lists the tags with their badges and
meanings; words in brackets that start in lower case, like "(see below)", never open it, and others close it at the
first letter that fits no tag ("(Only once)" lists the O tags at "(O", then closes at "(On"). ↑ ↓ move, Enter or Tab
puts the token in (`[fire]`, `[fire:glow]`, `(1CD)`) in place of what you typed, a click or tap does too, and Esc
closes the list only (a second Esc cancels the edit as usual). Text after the cursor stays, unless the cursor is
inside a token: then the whole token is replaced, keeping its variant (`[fi|re:glow]` and fire gives `[fire:glow]`).
The preview follows.

### Signing in and passwords

The first time, sign in with a GitHub token (classic, `public_repo` only). Right after, the site offers **Set a
password**: typed twice, it is published at once as its own commit (`Website: <login>'s password`, not left in the
batch, so it works straight away) as `site/logins/<login>.json` (format in `site/logins/README.md`): the token encrypted
in the browser with the password (PBKDF2-SHA-256, 2,000,000 iterations, AES-GCM-256); the password is never sent or
stored. From then on, on any device, **Sign in** → **Password** takes the GitHub login (any case) and the password: the
page reads the file from GitHub's API (current right after a change; 60 requests an hour per address without a token),
else the site's copy `data/logins/<login>.json` (as new as the last build), decrypts it, and checks the token with
GitHub as a token sign-in does (the login must be the file's; an expired or deleted token says so). A password needs 12
characters or more (4 or more random words are easy to remember) and is refused, with the reason shown as you type, when
it is a well-known one (also with digits or symbols around it), one word with digits or symbols around it (Liverpool1892)
under 16 characters, a repeated pattern, a keyboard or alphabet run, has too few
different characters, is mostly the login, or is a token. The file is public, so anyone can try to guess the password
offline: a long one used nowhere else is what keeps it safe, and the sign-in page and the dialog say so.

Signed in either way, this browser keeps the token until **Sign out**, never in plain text: a non-extractable AES-GCM key
in IndexedDB (`ttscardmaker-signin`) encrypts it into localStorage (`edit-token-sealed`), or into sessionStorage (this
tab only) when "keep me signed in" is unticked; each load decrypts it silently, and Sign out deletes both. A token
remembered in plain text before 2026-10-23 is sealed on the next load, and a password offered once. The hub's
**Password** section: **Set a password**, or **Change password** (a new password for the same token, replacing the file;
also the fix after making a new token) and **Remove my password** (deletes the file). **Forgot password?** on the
sign-in form clears this browser's sign-in, asks for the token, then sets a new password that replaces the file. A
removed or replaced file stays in the git history, so whoever knew an old password can still read the token it held:
Change and Remove say so and point to regenerating the token on GitHub. You write only your own file; admins can list
everyone's (hub → **Password files**) and remove one. That rule is the website's: anyone who can push could still
change or delete a file through git, but the password and the `/user` check mean that only stops its owner signing in
with a password; it never gives anyone the token. Signed out, the sign-in opens on **Password** when the site has any
password files (or this browser last signed in with one). Safari may clear a site's storage after 7 days without a visit,
which signs that browser out.

Private-deck passphrases remembered with **Remember on this device** are kept the same way, under a second
non-extractable key in the same IndexedDB (`decks`), in localStorage (`deckPassSealed:<owner>/<slug>`). They are not
part of the sign-in (anyone with the passphrase opens a private deck, signed in or not), so **Sign out keeps them**; each
deck's **Forget** removes its own (the last one also deletes the `decks` key). One remembered in plain text before
2026-10-23 is sealed on the next visit, or dropped in a browser that can't seal it (no IndexedDB, or IndexedDB failing):
nothing stays in plain text, and Remember there says so and stores nothing.

## People

The People tab lists everyone with a contribution or a profile. Per person: **cards** credited to them (as the Author
filter counts them), **edits** = publish batches, i.e. commits that changed `site/Card Edits.json` (a hand commit to the
file counts too; a move of the file doesn't), and **card commits** = commits that added or changed a card's PSD or PNG
under the card folders (the old `Auxillary/` spelling included; moves and rulebook pages don't count), one per commit
however many files. The bot's own commits and `_by: AutoCroissant` stamps are left out, except a bake: the bot's commit
that reprints cards for edits names each editor in an `Edit-by: <login>` trailer line per card, and counts as one card
commit for each of them (not as an edit: their batch already counted when they published it). The top of each column holds a
title (ties share it, nobody at 0): **Top card maker** (cards), **Top editor** (edits), **Top committer** (card
commits), and the top of the three added together is the **Top contributor**. A commit is credited by its git name, else by the GitHub login in a noreply
email, each looked up in the profiles' `author` fields and then in `[people]` (`Card Authors.txt`); otherwise by the git
name as written. A website login (`_by` or `Edit-by`) maps the same way, else to the person whose noreply commits carry
it, else to itself (any case). So a person committing under two names shows twice until an admin adds one `[people]`
line (`git name = shown name`; one person committing under two git names is merged in `.mailmap` instead) or, when the other name is their GitHub login, their profile names their author; their
GitHub login's page (`#/u/<login>`, where their decks link) opens their person page. The GitHub picture and link come only from a GitHub login known to be the person's: their profile's
login, else the login in their noreply commit emails, their website `_by` stamps or `Edit-by` trailers (a git name is
not a login: someone known only by name gets neither). The chart has one row per kind (cards by their image's first
upload, edit batches, card commits), each on its own scale, by month; it needs the git history like the counts.
The build writes `data/contributions.json` (small, loaded with `users.json`) and a static `u/<name>/` page for
each contributor, carrying the summary ("Top committer · 93 cards · 133 card commits") in its link
preview.

### Profiles

Opt-in: nobody has a profile until they make one (sign in → **Edit profile**, or the People tab). A profile is
`site/profiles/<login>.json` (format in `site/profiles/README.md`), staged in the same batch as card edits and
published in the same commit; you can edit your own, admins anyone's, and a profile can be removed again. Everything in
it is optional: the name on your cards (from `Card Authors.txt`, so the page links "N cards by …" to the author filter),
a one-line motto, a series and subseries (the subseries field suggests the picked series' own), favourite and hated
card and item, a featured hand and up to 12 label/value pairs.
The editor is a page of its own, `#/u/<login>/edit` (Edit profile on the hub, the person page or the review dialog;
signed out, it asks for the token first and comes back): the form on the left, a live preview of the profile on the
right (one column on narrow screens). Each card slot shows the chosen card's tile with **Pick** and **Clear**; Pick opens
a picker inside the page (the one the deck builder's empty slots open in a dialog: search box with the search syntax, kind and stars chips, small tiles; the item slots only
offer items, auxiliary items and N.M.E. items; at most 240 tiles, narrow the search for more). The featured hand is
picked from the deck builder's saved hands or pasted as a share link; its share code is stored as the hand is at that
moment, so later deck-builder edits don't follow. **Add to batch** stages the profile and returns to the person page;
Cancel asks when the form changed; a draft stays in memory per login while the site is open (leaving the page and
coming back restores it; closing the tab while the editor holds unsaved changes asks first, but a draft left behind
on another page goes with the tab). The build validates the files (never failing on one), writes `data/users.json` and
a static `u/<login>/` page with Open Graph tags, like `c/<card>/`, so a profile link previews in Discord (the
description ends with the person's cards: "120 items, 53 creatures, 32 field cards · mostly Hollow Knight, The Binding
of Isaac"). The site shows the page at `#/u/<login>` (the person's contributions and cards follow the profile) and
everyone at `#/users`; all profile text is escaped and only internal links are made from it. Authorship itself is not
duplicated in the profile: it stays in the Author filter, the "by Name" link, search `author==`, the Stats chart and
the People table.

### Decks

A saved hand can be published from the Deck builder page (**Publish…** next to it in My decks; signed out, the button
asks for the token first). The dialog takes a name (the hand's), a description and Public or Private; a private deck
takes a passphrase (8 characters or more, typed twice) and is encrypted right there, in the browser, before it joins
the batch, so the passphrase is never stored or sent anywhere; whoever has it can open the deck, and nobody can recover
it. The deck is one more line in the batch bar ("Deck: Burning Bagels (public)") and goes in the same commit as the card
edits and profiles, as `site/decks/<owner>/<slug>.json` (format in `site/decks/README.md`; the slug is made from the
name). You publish your own hands, admins anyone's; the deck page offers **Replace with…** (another saved hand, same
slug and visibility) and **Unpublish** (the removal joins the batch); the pages show "publishing…" until the site
rebuilds. The hand itself still travels as before: the deck builder's `d/#/deck/<code>` share links are unchanged, and
a deck page's Share link is one of them. The build validates the files (never failing on one: a bad file is skipped
with a warning, a card id that isn't a card is dropped and counted), writes `data/decks.json` (public decks with their
cards resolved, private ones as they are, newest first), counts them in `cards.json` (the Deck builder page shows the
public count) and writes a static `decks/<owner>/<slug>/` page per public deck with Open Graph tags ("Burning Bagels by
MichaelJSr", "7 creatures, 10 items, field card Deepnest", and a 1200×630 image of up to six of its cards in page order,
the field card first, made from their thumbnails and cached in `site/.og-cache` by those images; made only when
`SITE_URL` is set; one card's image when it has a single card, else the site banner). Private decks get no static page
and are not listed in the deck browser: the owner's person page links them (with a lock) and their own
`#/decks/<owner>/<slug>` link opens the passphrase form, which shows nothing but the owner, file name and date until the
passphrase is typed; the owner or an admin can still unpublish or replace one from that page, so a forgotten passphrase
strands nothing, and the commit message names a private deck by its path only.
Decryption needs `crypto.subtle` (https or localhost).

## Font check and card check

Both run in `.github/workflows/card-guards.yml`'s check job (their own workflows until 2026-10-25) on every push to
`main` that changes a PSD, a PNG or a font at the top of `MDW/Fonts/`, whatever `CARD_GUARDS` says, and report at once
(the guards' own post waits for the quiet window). Neither reverts or rejects a push.

- The font check (AutoCroissant `commands/font_check.py`) reads the pushed card PSDs by blob and lists the fonts their
  visible text layers ask for that `MDW/Fonts` does not supply. When something is missing: the job summary, a comment on
  the commit and (with the repository secret `DISCORD_STANDARDS_WEBHOOK`) a post to the standards channel pinging the
  card makers' role (`546427268751294475`; the only ping of the checks), one line per author and font ("... has pushed a
  card without adding the ... font to MDW/Fonts, bite this user."). The fix is to add the font file to the top level of
  `MDW/Fonts/`.
- The card check (AutoCroissant `commands/card_check.py`) reports the notes `/update_stats` would print for each pushed
  PSD (NO STARS FOUND, MISSPELT TYPE, SEVERAL CREATURES, HP/DEF/ATK/SPD NOT FOUND, STATS TOO HIGH, ABILITY TEXT NOT
  FOUND, UNKNOWN TYPE), after the card's `site/Card Edits.json` entry (`problems_ok`, `allow_high_stats`, `creatures`)
  and the bot's exclusions: the job summary, a comment on the commit and one Discord line per card in the standards
  channel, no ping ("... has pushed ... with: ..."). An unreadable PSD is one error line.

Run them by hand from the Actions tab (Card guards; `all` = every card for both checks and the guards, job summary
only).

## Card previews

`.github/workflows/card-preview.yml` bakes one card's website edit the way the card bake would, without committing it:
the website dispatches it (inputs `card`, `edit`, `request`) and reads the result from the branch `previews`
(`previews/<request>/result.json`, `preview.webp`, `before.webp` for the Diff; `site/NOTES.md` section 19 has the contract). Nothing is written to
`main` and nothing is posted; only its second job, which publishes, may write. The repo is public, so a previewed edit is
public too. Run it by hand from the Actions tab with a card name, an edit such as `{"hp": 8}` and an id such as
`manual-test-0001`. The branch is rewritten as one commit when it holds more than 200 previews or one older than 7 days.

## Working on it

```
pip install -r site/build/requirements.txt
python site/build/build_site.py          # writes site/dist (uses local PNGs, caches images in site/.cache/img; node for the first screen, ESBUILD=<esbuild> to bundle)
python -m http.server -d site/dist 8000  # then open http://localhost:8000
```

Code: `site/index.html`, `site/assets/` (plain JavaScript modules and CSS, no build step locally; the Action bundles them
with esbuild: `app.js` routes and views, `grid.js` the cards grid's tiles and toolbar, `editing.js` and `charts.js` the
editor's and the Stats page's modules (loaded on first use),
`search.js`, `text.js`, `deck.js`, `stats.js`, `edit.js` the editor, `inline.js` editing in place, `tokens.js` the
icon and timing-tag picker in card text, drag-to-assign and
the filter bar's New series/subseries/author, `balance.js` the Balance section and the cards' Balance blocks, `login.js` the password sign-in and this browser's sealed token, `profile.js` the People pages, `pick.js` the card picker panel, `details.js` the Details dropdown (card and rulebook pages), `decks.js` the
published decks: slugs, the file formats and their encryption, the browser and deck pages), `ratings.js` the card
ratings (their helpers, chart and card-page block), `site/build/build_site.py` and `site/build/analytics.py` (the balance analytics).
Generated files (`site/dist`, `site/.cache`, `site/.og-cache`) are git-ignored.
