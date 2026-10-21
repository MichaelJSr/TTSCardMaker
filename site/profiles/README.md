# Profiles

One file per person who made a profile on the card browser: `<login>.json`, where `<login>` is their GitHub login.
Made and changed on the website (sign in top right → Edit profile) and committed with the edit batch; nobody has a
profile until they make one. The build (`site/build/build_site.py`) reads this folder into `data/users.json` and makes
the `u/<login>/` page; the website shows the profile at `#/u/<login>`, over the person's contributions, and lists
everyone (with or without a profile) at `#/users`.

Format (keys sorted, 2-space indent, trailing newline; everything but `login` optional):

```json
{
  "author": "MichaelJSr",
  "deck": "eyJuIjoiTXkgaGFuZCIsImMiOlsiYWJiaSJdfQ",
  "facts": [{ "label": "Playing since", "value": "2021" }],
  "favourite": "abbi",
  "favouriteItem": "a-snack",
  "hated": "abbi",
  "hatedItem": "a-snack",
  "login": "MichaelJSr",
  "motto": "One line.",
  "series": "OMORI",
  "updated": "2026-10-21T12:00:00Z"
}
```

- `login`: must match the file name exactly (the website reads and removes the file by it); the page is `u/<login>/`.
- `author`: the name on the person's cards (`site/Card Authors.txt`); the profile links "N cards by …" to them, and
  the login's website edits (`_by` in `Card Edits.json`) and commits (a GitHub noreply email, or the login as git name)
  count towards that name's contributions.
- `favourite`, `hated`, `favouriteItem`, `hatedItem`: card ids (the slug in a card's link); the item ones must be items.
- `series`: one of the known series. `motto`: one line, up to 140 characters.
- `deck`: a deck builder share code (the part after `d/#/deck/`) with at least one card, shown as the hand's cards.
- `facts`: up to 12 label/value pairs (40/200 characters). `updated`: set by the website when publishing.

The build never fails on a profile: a file that isn't JSON, is over 16 KB or whose `login` doesn't match is skipped with
a warning; a bad field (a card that no longer exists, an unknown series…) is dropped with a warning; unknown fields are ignored.
