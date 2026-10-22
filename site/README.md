# Card browser

Impossibility Simulator's card browser: https://michaeljsr.github.io/TTSCardMaker/. Rebuilt by
`.github/workflows/site.yml` on every push to `main`, every 6 hours, and on demand (Actions → Card browser → Run workflow).

## What it has

- **Cards**: grid or sortable table; filters for kind, stars, item type, type icons, series and subseries, stat ranges, author and flags.
  The search box speaks the same language as the bot's `/query_ability` (`fire & type==creature`, `hp>7`, `"draw 2"`, `!die`, `|`),
  and also matches card names and aliases.
- **Card pages**: full image, stat bars, ability text with icons, timing-tag badges (hover for the meaning) and links to
  every card it names; "mentions", "mentioned by", similar stats, same series, text history with changes highlighted,
  and an image version viewer: every commit that changed the card's image, compared side by side with the current one.
  A **Details** dropdown at the bottom of the card page (closed by default; the browser remembers it, and its sections,
  for the session) shows the PSD's structure as the bot read it: fonts (each expandable to its layers; one that
  `MDW/Fonts` lacks is flagged "missing from MDW/Fonts", "not checked" when the bot had no font index), every text
  layer (text, font, size, colour, visible), layer effects, smart objects, canvas (size, mode, depth, ICC profile),
  how the type icons are made (image layers or icon-font tokens), how each stat row is built (template digit row,
  Top + Bottom rows, drawn bars), status-word layers (FX layers and overlay words), the template check (Name and
  Ability layers, deviations), the parser's notes with the PSD-vs-edited values, and the layer tree (rendered when
  its section opens).
  Every card has a shareable link (`/c/<card>/`) that shows a rich preview in Discord. The Share button (s) opens a dialog
  with that link, a Discord preview, and buttons to copy the card as a Discord message, an image or plain text.
- **Rulebook**: every page with search and highlighting, the timing-tag glossary, and the constructed ban list.
- **Deck builder**: the constructed starting hand from the rulebook (7 creatures, 10 items, one of each, no banned cards,
  optional starting field), with live checks, several saved decks, share links, text import/export, random fill,
  printable proxies, and a Tabletop Simulator saved-object download. Signed in, **Publish…** on a saved hand makes it a
  deck anyone can open: public, or private (encrypted in the browser with a passphrase; only the owner's login, the file
  name made from the deck's name and the date are in clear, and the passphrase cannot be recovered).
- **Published decks** (`#/decks`, linked from the Deck builder page; a deck page is `#/decks/<owner>/<slug>`, static
  `decks/<owner>/<slug>/` that previews in Discord): tiles with the owner, the card count, a complete-hand mark and a
  few card images; filters for text, owner and complete hands, sorted by date, name or owner. Private decks are not in
  the browser (nor in its count or owner list): they show only on their owner's page and at their own link. A deck's page
  shows the hand grouped like the deck builder with the hand checks, and offers Save a copy to my decks, Share link, Copy
  as text, Discord, TTS save and Print; its owner (or an admin) can replace it with another saved hand or unpublish it. A
  private deck asks for its passphrase (remembered on the device if you say so). A person's page lists their decks, the
  private ones as locked links. Format in `site/decks/README.md`; see Decks below.
- **Stats**: counts by kind, series, subseries, type, timing tag, status effect, author and month; how many legal cards there are
  for each star level of the starting hand; average stats per star level; stat distributions; and a total-stats-vs-stars
  chart that highlights possible balance outliers. Every chart has a table view.
- **Changes**: recently updated cards with text diffs, the most revised cards, and cards the bot hasn't parsed yet.
- **People** (the tab shows how many): everyone who made, edited or committed cards, in one table (GitHub picture, cards
  credited, edit batches published on the website, card commits, public decks, titles, motto), and a page per person
  (`#/u/<name>`, static `u/<name>/` that previews in Discord; **Share** opens a dialog with the link, the Discord preview
  and buttons to copy it as a Discord message or plain text: name, titles and counts, never the motto): their profile when they made one (see People below), their
  GitHub picture and link, their contributions with recently edited cards, recent edit batches and recent card commits, a chart of
  their contributions by month, and a Cards panel: their cards by kind (chips to the Cards tab), the series they mostly draw from, their newest card
  (by its image's first upload, from the git history: full-history builds only) and a grid of their 24 newest cards.

Top right: **Sign in** (a GitHub token, see Editing) becomes your login once signed in; it opens the editor hub (your
batch, your profile, sign out). Keyboard: `/` search, `Esc` close, `←`/`→` previous/next card, `↑`/`↓` image versions,
`d` add to deck, `c` copy link, `s` share, `x` compare, `e` edit (All fields when signed in), `r` random, `1`–`6` sections, `?` help. The single-key
shortcuts are off while an edit form is open (a card's edit dialog or the profile editor) and while an inline control or a
stat row has focus; `Esc` cancels an inline edit, otherwise it still closes a dialog.

## Where the data comes from

The build does not parse PSDs. Card text, stats, authors, aliases and history come from AutoCroissant's
`stats.pkl` / `aliases.pkl` / `old_stats.pkl` (the same data the Discord bot answers from), so the site is as fresh as
the bot's last `/update_stats` + `/push`. The build reads the pickles with an allowlist of exactly what they hold (the
bot's `CardInfo` and `CardStats`, as stand-ins without its code, plus `defaultdict` and `list`): a pickle naming
anything else is refused and nothing in it runs (a refused `stats.pkl` stops the build; the history and aliases are
skipped with a warning). A field the site reads that the bot's cards lack (a rename in `commands/card_models.py`), or a
field it doesn't know, is a warning in the log and on the Actions run. Images, icons, the ban list, icon names, profiles and published decks come from this
repo. Cards that are in the repo but not yet in the bot's data still appear (image only).

The Details dropdown reads the bot's `psd_details.json` (AutoCroissant, beside the pickles: one record per card PSD
keyed by its git blob sha, gathered on `/update_stats` and pushed with the pickles; the site fetches it from the bot
repo like the pickles). The build joins a record to a card by the PSD's blob at HEAD, else the blob the bot parsed,
else the newest record for that path, writes `data/details/<id>.json` (the record plus the card's id and name; a
duplicate gets its original's) and sets `details: true` on the card. No file, or no record for a card: no dropdown;
the build never fails on it.

Authors come from `site/Card Authors.txt` when a card is listed there (the bot uses the same file), otherwise from the
bot's data; `[people]` maps git names to the names shown. The hand-kept files `Card Authors.txt`, `Card Edits.json`,
`Website Admins.txt` and `Constructed Ban List.txt` sit directly under `site/` (moved from `MDW/` on 2026-10-20); the
build and the bot read them, the published site does not include them. Image versions and the People tab's commit counts come from one pass over the git history (commit metadata only),
following folder moves; the build needs full history for them (CI fetches it; a shallow local clone gets no image
versions and counts edit batches from `Card Edits.json`'s `_by`/`_at` stamps instead, a floor since the file keeps one
batch per card; `git fetch --unshallow --filter=blob:none` fixes that).

Each card PNG becomes three WebP images (240 and 360 px for the grid, 720 px for the card view), cached by git blob
hash in `site/.cache/img`; each image's size and accent color are kept by blob in `site/.cache/images.json` and the
icons in `site/.cache/icons`, so an unchanged image costs nothing, and `site/dist` gets hardlinks to the cached files (copies
where links fail). The first screen loads only `data/cards.json`; `rules.json`, `history.json`,
`versions.json`, `users.json` and `contributions.json` load when the rulebook, a card's history, the changes feed or the
People tab is opened; `decks.json` when the published decks, a deck page or a person's decks are opened; `details/<id>.json`
when a card's Details dropdown is first opened. Script, style and data URLs
carry a build version (`?v=...`), so a deploy never mixes old scripts with new data. The build stops (and nothing is deployed) if the bot's data can't be
downloaded or looks truncated, or if many images fail.

## Editing

Anyone with write access to this repo can fix card data on the site: **Sign in** (top right) takes a GitHub token
(classic, `public_repo` scope); signed in, the card browser is the editor. On a card page, click a stat cell to set that
stat (the top lit cell steps it down, so 0 is reachable; above 10 and per-creature stats go through All fields), click
the ability text to edit it in place (Ctrl/Cmd+Enter or a click elsewhere saves, Esc cancels; the card links in the text
still work), double-click the name to rename, and click the series, subseries or author chip, or the note, to type a new
value (series, subseries and author offer the known values; a missing one shows as a dashed `+ series` chip when you
hover the row). In the cards grid, Ctrl/Cmd-click selects tiles (Shift-click a range, Esc clears; a filter change keeps
only the tiles still shown) and dragging one or the selection onto a series or author in the filter bar (the values
appear under the Series and Author selects while you drag) assigns it to every card dragged. Every change lands in the batch bar at the bottom as a sentence ("Goombella: SPD 4 → 5", "Clot Black: Author →
Chestnut"), each with ↺ to take it back; the bar folds to one line when it gets long, and **Review and publish** commits
the whole batch at once. **All fields** (e, also in the bar) opens the full form for everything else (kind, item type,
stars, types, aliases, duplicate of, checks, constructed ban, hidden, creatures). Signed out, none of this shows: the
pages are the same to the pixel. Fields go to `site/Card Edits.json`, authors to `site/Card Authors.txt`, bans to
`site/Constructed Ban List.txt`. The site rebuilds on that commit; the bot applies the same files on `/update_stats`.
A subseries (Goombella: series Mario, subseries Paper Mario: The Thousand-Year Door) exists only as an edit (`subseries`;
the bot reads it too). Edits **on the card image** (name, stars, types, stats, ability text; the form groups them and the
bar marks them, and they show as "PSD pending" until the image is regenerated) are told apart from **database only**
ones, which come from the card's folder or exist only as edits (kind, item type, series, subseries, note, aliases,
author, duplicate of, checks, constructed ban, hidden).
Rulebook pages have an Edit button too (title, text, note), saved the same way. "Split into creatures" gives a card
several stat lines (`creatures` in `Card Edits.json`; creature 1 is the card's own stats), each shown with its own bars.
Admins are the repo owner plus the GitHub logins in `site/Website Admins.txt`; they can also ban, hide cards, rename
people, edit the admin list and edit anyone's profile (all committed with the batch). Remove a card's entry from
`Card Edits.json` to go back to the PSD.

## People

The People tab lists everyone with a contribution or a profile. Per person: **cards** credited to them (as the Author
filter counts them), **edits** = publish batches, i.e. commits that changed `site/Card Edits.json` (a hand commit to the
file counts too; a move of the file doesn't), and **card commits** = commits that added or changed a card's PSD or PNG
under the card folders (the old `Auxillary/` spelling included; moves and rulebook pages don't count), one per commit
however many files. The bot's own commits and `_by: AutoCroissant` stamps are left out, except a bake: the bot's commit
that reprints a card for an edit names each editor in an `Edit-by: <login>` trailer line, and counts as a card commit
for each of them (not as an edit: their batch already counted when they published it). The top of each column holds a
title (ties share it, nobody at 0): **Top card maker** (cards), **Top editor** (edits), **Top committer** (card
commits), and the top of the three added together is the **Top contributor**. A commit is credited by its git name, else by the GitHub login in a noreply
email, each looked up in the profiles' `author` fields and then in `[people]` (`Card Authors.txt`); otherwise by the git
name as written. A website login (`_by` or `Edit-by`) maps the same way, else to the person whose noreply commits carry
it, else to itself (any case). So a person committing under two names shows twice until an admin adds one `[people]`
line (`Michael = MichaelJSr`) or, when the other name is their GitHub login, their profile names their author; their
GitHub login's page (`#/u/<login>`, where their decks link) opens their person page. The GitHub picture and link come only from a GitHub login known to be the person's: their profile's
login, else the login in their noreply commit emails, their website `_by` stamps or `Edit-by` trailers (a git name is
not a login: someone known only by name gets neither). The chart has one row per kind (cards by their image's first
upload, edit batches, card commits), each on its own scale, by month; it needs the git history like the counts.
The build writes `data/contributions.json` (small, loaded with `users.json`) and a static `u/<name>/` page for
each contributor, with the profile's page carrying the summary ("Top card maker · 237 cards · 4 edits · 57 card
commits") in its link preview.

### Profiles

Opt-in: nobody has a profile until they make one (sign in → **Edit profile**, or the People tab). A profile is
`site/profiles/<login>.json` (format in `site/profiles/README.md`), staged in the same batch as card edits and
published in the same commit; you can edit your own, admins anyone's, and a profile can be removed again. Everything in
it is optional: the name on your cards (from `Card Authors.txt`, so the page links "N cards by …" to the author filter),
a one-line motto, a series, favourite and hated card and item, a featured hand and up to 12 label/value pairs.
The editor is a page of its own, `#/u/<login>/edit` (Edit profile on the hub, the person page or the review dialog;
signed out, it asks for the token first and comes back): the form on the left, a live preview of the profile on the
right (one column on narrow screens). Each card slot shows the chosen card's tile with **Pick** and **Clear**; Pick opens
a picker inside the page (search box with the search syntax, kind and stars chips, small tiles; the item slots only
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
MichaelJSr", "7 creatures, 10 items, field card Deepnest", the field card's image, else the top creature's, else the site
banner). Private decks get no static page and are not listed in the deck browser: the owner's person page links them
(with a lock) and their own `#/decks/<owner>/<slug>` link opens the passphrase form, which shows nothing but the owner,
file name and date until the passphrase is typed; the owner or an admin can still unpublish or replace one from that
page, so a forgotten passphrase strands nothing, and the commit message names a private deck by its path only.
Decryption needs `crypto.subtle` (https or localhost).

## Font check

`.github/workflows/font-check.yml` runs on every push to `main` that changes a PSD or `MDW/Fonts/`: the bot's checker
(AutoCroissant `commands/font_check.py`) reads the pushed card PSDs by blob and lists the fonts their visible text layers
ask for that `MDW/Fonts` does not supply. When something is missing it writes the job summary, posts (if the repository
secret `DISCORD_FONT_WEBHOOK` is set) to that Discord webhook pinging the card makers' role (`546427268751294475`), one line
per author and font ("... has pushed a card without adding the ... font to MDW/Fonts, bite this user."), and comments on
the commit. It never reverts or rejects a push: the fix is to add the font file to the top level of `MDW/Fonts/`.
Run it by hand from the Actions tab (`all` = every card, about 813 downloads).

## Card check

`.github/workflows/card-check.yml` runs on every push to `main` that changes a PSD, `site/Card Edits.json` or `Types/`: the
bot's checker (AutoCroissant `commands/card_check.py`) reads the pushed card PSDs by blob and reports the notes
`/update_stats` would print for each (NO STARS FOUND, MISSPELT TYPE, SEVERAL CREATURES, HP/DEF/ATK/SPD NOT FOUND, STATS TOO
HIGH, ABILITY TEXT NOT FOUND, UNKNOWN TYPE), after the card's `site/Card Edits.json` entry (`problems_ok`, `allow_high_stats`,
`creatures`) and the bot's exclusions. Report only: the job summary, a comment on the commit and, with the same
`DISCORD_FONT_WEBHOOK` secret, one Discord line per card ("... has pushed ... with: ..."); it never reverts or rejects
a push, and an unreadable PSD is one error line. Run it by hand from the Actions tab (`all` = every card, 25-30 minutes).

## Working on it

```
pip install -r site/build/requirements.txt
python site/build/build_site.py          # writes site/dist (uses local PNGs, caches images in site/.cache/img)
python -m http.server -d site/dist 8000  # then open http://localhost:8000
```

Code: `site/index.html`, `site/assets/` (plain JavaScript modules and CSS, no build step: `app.js` routes and views,
`search.js`, `text.js`, `deck.js`, `stats.js`, `edit.js` the editor, `inline.js` editing in place and drag-to-assign,
`profile.js` the People pages, `pick.js` the card picker panel, `details.js` the card page's Details dropdown, `decks.js` the
published decks: slugs, the file formats and their encryption, the browser and deck pages), `site/build/build_site.py`.
Generated files (`site/dist`, `site/.cache`) are git-ignored.
