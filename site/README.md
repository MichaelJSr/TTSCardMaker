# Card browser

Impossibility Simulator's card browser: https://michaeljsr.github.io/TTSCardMaker/. Rebuilt by
`.github/workflows/site.yml` on every push to `main`, every 6 hours, and on demand (Actions → Card browser → Run workflow).

## What it has

- **Cards**: grid or sortable table; filters for kind, stars, item type, type icons, series, stat ranges, author and flags.
  The search box speaks the same language as the bot's `/query_ability` (`fire & type==creature`, `hp>7`, `"draw 2"`, `!die`, `|`),
  and also matches card names and aliases.
- **Card pages**: full image, stat bars, ability text with icons, timing-tag badges (hover for the meaning) and links to
  every card it names; "mentions", "mentioned by", similar stats, same series, text history with changes highlighted,
  and an image version viewer: every commit that changed the card's image, compared side by side with the current one.
  Every card has a shareable link (`/c/<card>/`) that shows a rich preview in Discord.
- **Rulebook**: every page with search and highlighting, the timing-tag glossary, and the constructed ban list.
- **Deck builder**: the constructed starting hand from the rulebook (7 creatures, 10 items, one of each, no banned cards,
  optional starting field), with live checks, several saved decks, share links, text import/export, random fill,
  printable proxies, and a Tabletop Simulator saved-object download.
- **Stats**: counts by kind, series, type, timing tag, status effect, author and month; how many legal cards there are
  for each star level of the starting hand; average stats per star level; stat distributions; and a total-stats-vs-stars
  chart that highlights possible balance outliers. Every chart has a table view.
- **Changes**: recently updated cards with text diffs, the most revised cards, and cards the bot hasn't parsed yet.

Keyboard: `/` search, `←`/`→` previous/next card, `d` add to deck, `c` copy link, `x` compare, `r` random, `1`–`5` sections, `?` help.

## Where the data comes from

The build does not parse PSDs. Card text, stats, authors, aliases and history come from AutoCroissant's
`stats.pkl` / `aliases.pkl` / `old_stats.pkl` (the same data the Discord bot answers from), so the site is as fresh as
the bot's last `/update_stats` + `/push`. Images, icons, the ban list and icon names come from this repo. Cards that are
in the repo but not yet in the bot's data still appear (image only).

Authors come from `MDW/Card Authors.txt` when a card is listed there (the bot uses the same file), otherwise from the
bot's data; `[people]` maps git names to the names shown. Image versions come from the git history (commit metadata
only), following folder moves; the build needs full history for them (CI fetches it; a shallow local clone gets none,
`git fetch --unshallow --filter=blob:none` fixes that).

Each card PNG becomes three WebP images (240 and 360 px for the grid, 720 px for the card view), cached by git blob
hash in `site/.cache/img`. The first screen loads only `data/cards.json`; `rules.json` and `history.json` load when the
rulebook, a card's history or the changes feed is opened. Script, style and data URLs carry a build version (`?v=...`),
so a deploy never mixes old scripts with new data. The build stops (and nothing is deployed) if the bot's data can't be
downloaded or looks truncated, or if many images fail.

## Working on it

```
pip install -r site/build/requirements.txt
python site/build/build_site.py          # writes site/dist (uses local PNGs, caches images in site/.cache/img)
python -m http.server -d site/dist 8000  # then open http://localhost:8000
```

Code: `site/index.html`, `site/assets/` (plain JavaScript modules and CSS, no build step), `site/build/build_site.py`.
Generated files (`site/dist`, `site/.cache`) are git-ignored.
