# Decks

One file per hand published from the deck builder: `<owner>/<slug>.json`, where `<owner>` is the publisher's GitHub login
and `<slug>` is made from the deck's name (lowercase, anything but letters and digits becomes `-`; a second deck with the
same slug replaces the first, or gets `-2`, `-3` with the dialog's **Keep both**). Written by the website (Deck builder → My decks → **Publish…**, signed in) and committed with
the edit batch, never by hand; you publish your own hands, admins anyone's; a published deck can be replaced or unpublished
the same way. The build (`site/build/build_site.py`) reads this folder into `data/decks.json` and makes a `decks/<owner>/<slug>/`
page for each public deck; the website lists the public decks at `#/decks`, shows one at `#/decks/<owner>/<slug>`, and a
person's (private ones included, as links) on their `#/u/<owner>` page.

Public deck:

```json
{
  "v": 1,
  "owner": "MichaelJSr",
  "name": "Burning Bagels",
  "description": "optional, up to 500 characters",
  "cards": ["abbi", "a-snack"],
  "field": "deepnest",
  "updated": "2026-10-21T13:00:00Z"
}
```

- `owner`: must match the folder name (case doesn't matter; the folder's spelling is the one shown); the page is
  `decks/<owner>/<slug>/`.
- `name`: one line, 1 to 80 characters. `description`: optional.
- `cards`: up to 40 card ids (the slug in a card's link); a constructed hand is 17 and the page shows the hand checks either
  way. `field`: a card id or `null`.
- `updated`: `YYYY-MM-DDTHH:MM:SSZ`, set by the website when publishing; the browser lists newest first (anything else
  is ignored and sorts last).

Private deck: the same hand, encrypted in the browser with a passphrase. Only the owner, the file name (made from the
deck's name, so pick a bland one) and the date are in clear. It is not listed at `#/decks`: it is visible only on its
owner's `#/u/<owner>` page and through its own `#/decks/<owner>/<slug>` link (the passphrase form).

```json
{
  "v": 1,
  "owner": "MichaelJSr",
  "private": true,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iter": 300000, "salt": "<base64, 16 bytes>" },
  "iv": "<base64, 12 bytes>",
  "data": "<base64 AES-GCM ciphertext>",
  "updated": "2026-10-21T13:00:00Z"
}
```

- Key = PBKDF2(passphrase, salt, iter, SHA-256), 256 bits; `data` = AES-GCM of the UTF-8 JSON `{"name", "description",
  "cards", "field"}` with the string `deck:<owner>/<slug>` (owner lowercase) as additional data, so a file moved under
  another owner or name does not open.
- Anyone with the passphrase can open the deck (the page asks for it); the passphrase is never stored in the repo and
  cannot be recovered. Forgotten passphrase: the deck page still offers the owner (and admins) **Unpublish** and
  **Replace with…**, which takes a new one.

The build never fails on a deck: a file that isn't JSON, is over 16 KB, has another `v`, an owner that doesn't match its
folder, a file name that isn't a slug, no usable name, over 40 cards, a second file for the same owner and slug, or
(private) a wrong key, salt, iv or data shape is skipped with a warning; a card id that isn't a card (or is listed twice)
is dropped with a warning and counted in `dropped`; a bad `updated` or description is ignored, as are unknown fields.
