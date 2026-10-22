# TTS save audit

Save `TTS/Impossibility Simulator.json` (5,501,966 bytes, TTS v14.2.2, "auto_update") against TTSCardMaker HEAD `9fbe6835b8`. Written by `audit.py` on 2026-10-20; rules in `TTS/decks.json`.

Contents: totals; needs a decision; decks; bags; missing repo cards; images not in the repo; unexpected cards; names; backs; duplicates; large cards; loose cards; non-card images; Militron; repo vs disk; integrity.

## Since this audit (2026-10-22)

The rest of this file is the first audit's record (2026-10-20). Don't re-run `audit.py` to refresh it: it rewrites
this file and `decks.json` from the save. The second audit's checks are kept in `TTS/checks/` (see its README).

- **CustomDeck keys:** no key names two images any more (the 39 under Integrity). `c9873ddf` moved the 46 rulebook
  pages (bag `b7abdb`) to keys 1578-1623 and Grandfather Clock and The Missile (`79fd59`) to 1624 and 1625. The
  highest key is 1625, so new cards take 1626 up. `checks/customdeck_collisions.py` fails on any collision.
- **Global Lua** (`c9873ddf`, 48 lines): seats join TTS teams (Red, Orange, Green: Hearts; Blue, Purple, Pink:
  Clubs; other seats: None), and the large cards in `resizeTargets` (kept by the updater) go to scale 3,1,3 when they
  leave a container. Hand-zone claiming is gone (`HAND_ZONE_GUIDS`, `onObjectEnterZone`, the zone respawn, the
  colour tint, the team-zone warning). Each zone keeps its saved owner; a TTS team lets teammates see each other's
  hand zones, so the item holders owned by Red and Blue show to their whole side (not verified for an empty seat).
  The Flex Table Control (`bd69bd`) now moves each hand by its own index (`getHandTransform(i)`).
- **Rules** (`decks.json`): `f33bd9`'s `card_list` names `Z!!!!!.png` (decision 12's rename). The Morgue rule
  (`79fd59`) excludes `MDW/The Morgue/cardback.png`, a back its glob matched; `audit.py` now leaves `cardback*.png`
  out of every rule. The snapshot fields nothing read (`repo_head`, each deck's `cards`, `large_cards.current_keys`)
  are gone, from the file and from `audit.py`.
- **Owner's rules (2026-10-22, later):** the 7 "Specific Item Decks" are complete rules (count 1, back
  `MDW/cardback_item.png`) and hold their 94 cards; Piko Piko Hammer's exclude is gone from `213c84`/`abb81f`; the four
  developer decks have `add_new_since: 318001ea` (Tainted Lazarus and John Ward joined `3a51c6`); Nicknames are the
  website's names (131 names, 398 cards); Description, GMNotes, Memo, Tags and scripts are the team's (the updater
  leaves them). Remaining excludes: Stubborn Queen in `e8e1b6`/`fa254e` (it sits in the Minions decks), the Morgue
  back in `79fd59`. Keys 1626-1721 went to the new cards. `audit.py` keeps `add_new_since` and an empty deck's
  counted rule when it rewrites `decks.json`.

## Totals

- Top-level objects: **228** (Custom_Tile 81, Deck 49, Counter 43, HandTrigger 16, Infinite_Bag 12, Custom_Assetbundle 8, BlockSquare 6, Custom_Token 2, Bag 2, Chinese_Checkers_Piece 1, Quarter 1, Die_6_Rounded 1, go_game_bowl_white 1, go_game_bowl_black 1, Custom_Board 1, Custom_Model_Bag 1, Custom_Model 1, CardCustom 1).
- All objects incl. contents of decks and bags: 2652.
- Decks: **57** = 49 on the table + 8 inside the bag 'Specific Item Decks' (7 of those are empty).
- Card objects: **2394** (CardCustom 2388, Card 6); by place: marker 8, deck 2339, rulebook 46, loose 1.
- URL strings: 9279; repo links 9265 (main 9263, refs/heads/main 2); external 14 (Steam asset bundles/model, pastebin mesh, imgur felts).
- Repo links on card objects (FaceURL+BackURL): 4788; repeated in decks' CustomDeck maps: 4322.
- Distinct repo images: **868**; card faces 822 (in decks 772); card faces+backs 829; images in ImageURL/ImageSecondaryURL/DiffuseURL 39, +1 only in scripts (`MDW/cardback.png`).
- Deck rules by confidence (57 decks): high 29 (items 8, fields 8, creatures 8, status effects 3, N.M.E 2); medium 21 (hand-picked 15, auxiliary items 3, minions 3); low 7 (empty, rule from the name 7).
- Repo cards not in their complete decks: 10 missing + 2 excluded in the rules (they sit only in another deck) = 12; see Needs a decision 1-2.
- CustomDeck ids used by cards: 806, 778 of them by more than one object; highest id 1568.
- Repo HEAD: 2200 files, 1003 PNGs.

Against the earlier observations (NEXT_SESSION_PLAN.md):

- 228 top-level objects, 57 decks: reproduced (228, 57; the 57 include the 8 decks inside 'Specific Item Decks', 7 of them empty).
- 2,388 card objects: that is the CardCustom count (2388). Six more objects are type "Card" (Dr. Robotnik's Roboticizer, 2 in each of three 1★ item decks): **2394** card objects in all.
- 9,109 links on main: reproduced. Card FaceURL/BackURL links: 9110 (4788 on card objects + 4322 in decks' CustomDeck maps), 9109 on main; the other one is the loose Militron's refs/heads/main link. All repo links: 9265 (main 9263, refs/heads/main 2); none is pinned to a sha yet.
- 153 non-card images: these are links, not images: 153 repo links in ImageURL/ImageSecondaryURL/DiffuseURL (+2 embedded in the Flex Table Control's script state), on 39 distinct repo images (+1 only in the script). The Non-card images table has 102 rows: those, 54 marker/rulebook card images (FaceURL/BackURL, so already in the card links and the 822 card faces) and 8 external URLs. Counters carry no image.
- 821 distinct images: 822 distinct card faces, 821 of them in the repo (ZOEY!!!!!.png is gone), so 821 = faces that exist. With backs 829; every repo image incl. non-card 868.
- "773 of 799 deck ids used by more than one object": now 778 of 806.

## Needs a decision

1. Repo cards missing from complete decks. Add each to every copy (new cards would get the deck's usual copy count), or exclude it in the rule?
   - fields 4★ (`b53bbf`, `36ee4c`): The Gates of Ahn'Qiraj (nowhere in the save)
   - creatures 3★ (`6ae2a9`, `ac2a14`): Tainted Lazarus (nowhere in the save); John Ward (nowhere in the save)
   - creatures 4★ (`cde2bc`, `8dc131`): Militron (`2a34b2` ★★★★ (Creatures Simple Version), loose on the table)
   - creatures 5★ (`bc1e3f`, `f05d89`): Z!!!!! (new file; the decks hold `ZOEY!!!!!`, which is gone from the repo: a rename)
   - auxiliary items, +12 listed card(s) (`ac4725`, `0b410c`, `883c04`): The Temple of Ahn'Qiraj (nowhere in the save)
   - minions, + Auxiliary/Creatures, +1 listed card(s) (`6e935f`, `ed587f`, `f8df22`): Militron (No Armor) (nowhere in the save); Anubisath Guardian (nowhere in the save); Qiraji Soldier (nowhere in the save); Silithid (nowhere in the save)
2. Excluded in the rules because the card sits only in another deck (as a listed card). Confirm:
   - items 3★, -1 excluded (`213c84`, `abb81f`): Piko Piko Hammer (sits in `ac4725` Auxiliary Items (Auxiliary Items), `0b410c` Auxiliary Items (Auxiliary Items), `883c04` Auxiliary Items (Auxiliary Items Copy))
   - creatures 2★, -1 excluded (`e8e1b6`, `fa254e`): Stubborn Queen (sits in `6e935f` Minions (Minions), `ed587f` Minions (Minions), `f8df22` Minions (Minions Copy))
3. Cards from outside a deck's kind folders, kept in the rule (`include` or an extra folder). Keep them there?
   - auxiliary items, +12 listed card(s) (`ac4725`, `0b410c`, `883c04`): Bomb (also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy)); Poison Circle (also `8fb88d` ★ (Items), `42909d` ★ (Items Copy)); Holy Card (also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy)); Piko Piko Hammer (only here); Ingredient Desert Limes (also `8fb88d` ★ (Items), `42909d` ★ (Items Copy)); Ingredient Gnome Berries (also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy)); Ingredient Icy Sugar Cubes (also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy)); Ingredient Pineapple Mint (also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy)); Pepperoni Pizza (also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy)); Ingredient Distillery Dough (also `213c84` ★★★ (Items), `abb81f` ★★★ (Items Copy), `b630d6` ★★★ (Items Simple Version)); Gasoline (also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy)); Rope (also `d3995a` N.M.E. Deck (N.M.E Items), `444f1f` N.M.E. Deck (N.M.E. Items Copy))
   - minions, + Auxiliary/Creatures, +1 listed card(s) (`6e935f`, `ed587f`, `f8df22`): Stubborn Queen (only here)
   - minions, + Auxiliary/Creatures, +1 listed card(s) (`6e935f`, `ed587f`, `f8df22`) also takes the whole folder(s) `Auxiliary/Creatures/*.png`
4. Hand-picked decks (rule = kind + stars, but they hold only part of the folders; `card_list` in decks.json). Should the updater add new cards to them, or only refresh the cards already there?
   - `fe5655` creatures 2★ (hand-picked subset), 18 cards (39%), near 'Creatures Developer Version'
   - `b4af5f` creatures 2★ (hand-picked subset), 17 cards (37%), near 'Creatures Simple Version'
   - `3a51c6` creatures 3★ (hand-picked subset), 19 cards (18%), near 'Creatures Developer Version'
   - `66e756` creatures 3★ (hand-picked subset), 22 cards (21%), near 'Baseline Creatures'
   - `a0d005` creatures 3★ (hand-picked subset), 47 cards (46%), near 'Creatures Simple Version'
   - `bdb082` creatures 4★ (hand-picked subset), 14 cards (15%), near 'Creatures Developer Version'
   - `888cba` creatures 4★ (hand-picked subset), 25 cards (27%), near 'Baseline Creatures'
   - `2a34b2` creatures 4★ (hand-picked subset), 42 cards (45%), near 'Creatures Simple Version'; not in the complete deck: Militron
   - `f33bd9` creatures 5★ (hand-picked subset), 14 cards (23%), near 'Creatures Developer Version'
   - `c9a8fc` creatures 5★ (hand-picked subset), 26 cards (46%), near 'Creatures Simple Version'
   - `6dbf7e` items 1★ (hand-picked subset), 30 cards (75%), near 'Items Simple Version'
   - `c86c21` items 2★ (hand-picked subset), 75 cards (73%), near 'Items Simple Version'
   - `b630d6` items 3★ (hand-picked subset), 68 cards (70%), near 'Items Simple Version'
   - `091586` items 4★ (hand-picked subset), 17 cards (57%), near 'Items Simple Version'
   - `79fd59` The Morgue (retired cards) (hand-picked subset), 7 cards (58%), Bag 'Specific Item Decks'
5. Empty decks in the bag 'Specific Item Decks' (no DeckIDs, no CustomDeck). Fill each from the rule guessed from its name, or delete them?
   - `493fc7` '3 Star Equips': `Items/Equip/3 Stars/*.png`
   - `82d617` '2 Star Equips': `Items/Equip/2 Stars/*.png`
   - `452af0` '2 Star Attack Items': `Items/Attack/2 Stars/*.png`
   - `280637` '2 Star Healing Items': `Items/Heal/2 Stars/*.png`
   - `b1cb91` '4 Star Attack Items': `Items/Attack/4 Stars/*.png`
   - `886307` '4 Star Equips': `Items/Equip/4 Stars/*.png`
   - `89e02e` '1 Star Equips': `Items/Equip/1 Stars/*.png`
6. Item decks keep per-card copy counts (2★: usually 1, 21 cards differ; 1★: usually 2, 9 cards differ; 3★: usually 1, 18 cards differ). New items get the usual count unless told otherwise?
7. Large cards: Militron (No Armor) (`Auxiliary/Creatures/Militron_(No_Armor).png`) is not in Lua resizeTargets and not in the save at all. Regenerate resizeTargets from Auxiliary/Creatures (plan) and add it to the Minions decks with the other large cards?
8. Large-card names: the Lua and the save say 'Azamoth The Possessed Vessel', the website 'Azamoth the Possessed Vessel'. resizeTargets is case-sensitive, so the Lua keys must follow whatever Nicknames the updater writes.
9. One image with different Nicknames across the save (likely a typo or a wrong image): `Creatures/Kirby/5 Stars/Crowned_Magolor.png`: 'Crowned Magalor' ×1, 'Crowned Magolor' ×2 (website 'Crowned Magolor'); `Items/Support/2 Stars/Gust_of_Wind.png`: 'Gust of Trees' ×1, 'Gust of Wind' ×4 (website 'Gust of Wind'). Fix which?
10. 84 Nickname vs website-name mismatches (33 different, 51 case/spacing/punctuation only; see the table). The plan sets Nickname = website name: rename them all, or first fix the website names (Card Edits.json) where the save is right (e.g. 'Black Clot', 'M.O.A.B.', 'Thunderfury: ...', 'Mr. Krabs')?
11. Loose card(s): 'Militron' `a371af` on 'Penalty Box Creatures'. Leave as is (the updater refreshes its link), or remove?
12. Save images no longer in the repo (report only, D5): `Creatures/Other/5 Stars/ZOEY!!!!!.png` ×6, likely renamed to `Creatures/Other/5 Stars/Z!!!!!.png`. Treat as renames (update path and Nickname in every copy)?
13. 2 link(s) use refs/heads/main (Types/Girl.png token, loose Militron); sha pinning will rewrite them like the rest. OK?

## Decks

One row per deck GUID. Copies = other decks with the same rule (and, for hand-picked decks, the same cards).

| GUID | Name | Where | Cards | Rule | Conf. | Copies |
|---|---|---|---|---|---|---|
| `e8e1b6` | ★★ | near 'Creatures' | 45 | creatures 2★, -1 excluded | high | `fa254e` |
| `fa254e` | ★★ | near 'Creatures Copy' | 45 | creatures 2★, -1 excluded | high | `e8e1b6` |
| `fe5655` | (unnamed) | near 'Creatures Developer Version' | 18 | creatures 2★ (hand-picked subset) | medium | - |
| `b4af5f` | ★★ | near 'Creatures Simple Version' | 17 | creatures 2★ (hand-picked subset) | medium | - |
| `6ae2a9` | ★★★ | near 'Creatures' | 101 | creatures 3★ | high | `ac2a14` |
| `ac2a14` | ★★★ | near 'Creatures Copy' | 101 | creatures 3★ | high | `6ae2a9` |
| `3a51c6` | (unnamed) | near 'Creatures Developer Version' | 19 | creatures 3★ (hand-picked subset) | medium | - |
| `66e756` | (unnamed) | near 'Baseline Creatures' | 22 | creatures 3★ (hand-picked subset) | medium | - |
| `a0d005` | ★★★ | near 'Creatures Simple Version' | 47 | creatures 3★ (hand-picked subset) | medium | - |
| `cde2bc` | ★★★★ | near 'Creatures' | 92 | creatures 4★ | high | `8dc131` |
| `8dc131` | ★★★★ | near 'Creatures Copy' | 92 | creatures 4★ | high | `cde2bc` |
| `bdb082` | (unnamed) | near 'Creatures Developer Version' | 14 | creatures 4★ (hand-picked subset) | medium | - |
| `888cba` | (unnamed) | near 'Baseline Creatures' | 25 | creatures 4★ (hand-picked subset) | medium | - |
| `2a34b2` | ★★★★ | near 'Creatures Simple Version' | 42 | creatures 4★ (hand-picked subset) | medium | - |
| `bc1e3f` | ★★★★★ | near 'Creatures' | 56 | creatures 5★ | high | `f05d89` |
| `f05d89` | ★★★★★ | near 'Creatures Copy' | 56 | creatures 5★ | high | `bc1e3f` |
| `f33bd9` | (unnamed) | near 'Creatures Developer Version' | 14 | creatures 5★ (hand-picked subset) | medium | - |
| `c9a8fc` | ★★★★★ | near 'Creatures Simple Version' | 26 | creatures 5★ (hand-picked subset) | medium | - |
| `8fb88d` | ★ | near 'Items' | 39 | items 1★ | high | `42909d` |
| `89e02e` | 1 Star Equips | in bag 'Specific Item Decks' | 0 | items 1★ Equip | low | - |
| `42909d` | ★ | near 'Items Copy' | 39 | items 1★ | high | `8fb88d` |
| `6dbf7e` | ★ | near 'Items Simple Version' | 30 | items 1★ (hand-picked subset) | medium | - |
| `a7e1aa` | ★★ | near 'Items' | 96 | items 2★ | high | `7cdb04` |
| `280637` | 2 Star Healing Items | in bag 'Specific Item Decks' | 0 | items 2★ Heal | low | - |
| `82d617` | 2 Star Equips | in bag 'Specific Item Decks' | 0 | items 2★ Equip | low | - |
| `452af0` | 2 Star Attack Items | in bag 'Specific Item Decks' | 0 | items 2★ Attack | low | - |
| `7cdb04` | ★★ | near 'Items Copy' | 96 | items 2★ | high | `a7e1aa` |
| `c86c21` | ★★ | near 'Items Simple Version' | 75 | items 2★ (hand-picked subset) | medium | - |
| `213c84` | ★★★ | near 'Items' | 88 | items 3★, -1 excluded | high | `abb81f` |
| `493fc7` | 3 Star Equips | in bag 'Specific Item Decks' | 0 | items 3★ Equip | low | - |
| `abb81f` | ★★★ | near 'Items Copy' | 88 | items 3★, -1 excluded | high | `213c84` |
| `b630d6` | ★★★ | near 'Items Simple Version' | 68 | items 3★ (hand-picked subset) | medium | - |
| `df0c17` | ★★★★ | near 'Items' | 30 | items 4★ | high | `9c4f0c` |
| `b1cb91` | 4 Star Attack Items | in bag 'Specific Item Decks' | 0 | items 4★ Attack | low | - |
| `886307` | 4 Star Equips | in bag 'Specific Item Decks' | 0 | items 4★ Equip | low | - |
| `9c4f0c` | ★★★★ | near 'Items Copy' | 30 | items 4★ | high | `df0c17` |
| `091586` | ★★★★ | near 'Items Simple Version' | 17 | items 4★ (hand-picked subset) | medium | - |
| `b25a54` | ★ | near 'Field Items' | 9 | fields 1★ | high | `769f68` |
| `769f68` | ★ | near 'Field Items Copy' | 9 | fields 1★ | high | `b25a54` |
| `4e992d` | ★★ | near 'Field Items' | 18 | fields 2★ | high | `b14958` |
| `b14958` | ★★ | near 'Field Items Copy' | 18 | fields 2★ | high | `4e992d` |
| `97edb2` | ★★★ | near 'Field Items' | 12 | fields 3★ | high | `f16501` |
| `f16501` | ★★★ | near 'Field Items Copy' | 12 | fields 3★ | high | `97edb2` |
| `b53bbf` | ★★★★ | near 'Field Items' | 10 | fields 4★ | high | `36ee4c` |
| `36ee4c` | ★★★★ | near 'Field Items Copy' | 10 | fields 4★ | high | `b53bbf` |
| `d3995a` | N.M.E. Deck | on 'N.M.E Items' | 26 | N.M.E | high | `444f1f` |
| `444f1f` | N.M.E. Deck | on 'N.M.E. Items Copy' | 26 | N.M.E | high | `d3995a` |
| `c8333f` | Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐ | on 'All Status Effects' | 64 | status effects | high | `ee3c0c`, `abd26b` |
| `ee3c0c` | Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐ | on 'All Status Effects' | 64 | status effects | high | `c8333f`, `abd26b` |
| `abd26b` | Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐ | on 'Status Effects Copy' | 64 | status effects | high | `c8333f`, `ee3c0c` |
| `ed587f` | Minions | on 'Minions' | 95 | minions, + Auxiliary/Creatures, +1 listed card(s) | medium | `6e935f`, `f8df22` |
| `6e935f` | Minions | on 'Minions' | 95 | minions, + Auxiliary/Creatures, +1 listed card(s) | medium | `ed587f`, `f8df22` |
| `f8df22` | Minions | on 'Minions Copy' | 95 | minions, + Auxiliary/Creatures, +1 listed card(s) | medium | `6e935f`, `ed587f` |
| `0b410c` | Auxiliary Items | on 'Auxiliary Items' | 59 | auxiliary items, +12 listed card(s) | medium | `ac4725`, `883c04` |
| `ac4725` | Auxiliary Items | on 'Auxiliary Items' | 59 | auxiliary items, +12 listed card(s) | medium | `0b410c`, `883c04` |
| `883c04` | Auxiliary Items | on 'Auxiliary Items Copy' | 59 | auxiliary items, +12 listed card(s) | medium | `ac4725`, `0b410c` |
| `79fd59` | Deck of Rejects | in bag 'Specific Item Decks' | 7 | The Morgue (retired cards) (hand-picked subset) | medium | - |

### `e8e1b6` ★★

- Position: x -93.4, z 23.9, near 'Creatures'.
- Cards: 45 (45 distinct); back: `MDW/cardback.png` 45; card scale: 3.0 (45).
- Folders: `Creatures/Bug Fables/2 Stars` 1, `Creatures/Crypt/2 Stars` 2, `Creatures/DST/2 Stars` 1, `Creatures/Everhood/2 Stars` 1, `Creatures/FTL/2 Stars` 2, `Creatures/Hollow Knight/2 Stars` 2, `Creatures/In Sound Mind/2 Stars` 1, `Creatures/Isaac/2 Stars` 2, `Creatures/Kirby/2 Stars` 2, `Creatures/Lisa/2 Stars` 1, `Creatures/Mario/2 Stars` 10, `Creatures/Monkey D Folder/2 Stars` 3, `Creatures/Omori/2 Stars` 1, `Creatures/Other/2 Stars` 8, `Creatures/Pandas/2 Stars` 7, `Creatures/R.E.P.O/2 Stars` 1.
- Rule: **creatures 2★, -1 excluded**, folders `Creatures/*/2 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 98% of the repo cards its folders cover.
- Copies: `fa254e` ★★.
- Copies per card: 1× 45 cards.

### `fa254e` ★★

- Position: x 131.8, z 11.7, near 'Creatures Copy'.
- Cards: 45 (45 distinct); back: `MDW/cardback.png` 45; card scale: 3.0 (45).
- Folders: `Creatures/Bug Fables/2 Stars` 1, `Creatures/Crypt/2 Stars` 2, `Creatures/DST/2 Stars` 1, `Creatures/Everhood/2 Stars` 1, `Creatures/FTL/2 Stars` 2, `Creatures/Hollow Knight/2 Stars` 2, `Creatures/In Sound Mind/2 Stars` 1, `Creatures/Isaac/2 Stars` 2, `Creatures/Kirby/2 Stars` 2, `Creatures/Lisa/2 Stars` 1, `Creatures/Mario/2 Stars` 10, `Creatures/Monkey D Folder/2 Stars` 3, `Creatures/Omori/2 Stars` 1, `Creatures/Other/2 Stars` 8, `Creatures/Pandas/2 Stars` 7, `Creatures/R.E.P.O/2 Stars` 1.
- Rule: **creatures 2★, -1 excluded**, folders `Creatures/*/2 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 98% of the repo cards its folders cover.
- Copies: `e8e1b6` ★★.
- Copies per card: 1× 45 cards.

### `fe5655` (unnamed)

- Position: x -93.4, z -8.2, near 'Creatures Developer Version'.
- Cards: 18 (18 distinct); back: `MDW/cardback.png` 18; card scale: 3.0 (18).
- Folders: `Creatures/Crypt/2 Stars` 1, `Creatures/FTL/2 Stars` 1, `Creatures/Kirby/2 Stars` 1, `Creatures/Mario/2 Stars` 5, `Creatures/Monkey D Folder/2 Stars` 3, `Creatures/Other/2 Stars` 5, `Creatures/Pandas/2 Stars` 1, `Creatures/R.E.P.O/2 Stars` 1.
- Rule: **creatures 2★ (hand-picked subset)**, folders `Creatures/*/2 Stars/*.png`, count 1. Confidence **medium**: 39% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 39% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 18 cards.

### `b4af5f` ★★

- Position: x 131.8, z -24.6, near 'Creatures Simple Version'.
- Cards: 17 (17 distinct); back: `MDW/cardback.png` 17; card scale: 3.0 (17).
- Folders: `Creatures/Bug Fables/2 Stars` 1, `Creatures/DST/2 Stars` 1, `Creatures/Everhood/2 Stars` 1, `Creatures/FTL/2 Stars` 2, `Creatures/In Sound Mind/2 Stars` 1, `Creatures/Kirby/2 Stars` 2, `Creatures/Mario/2 Stars` 2, `Creatures/Omori/2 Stars` 1, `Creatures/Other/2 Stars` 1, `Creatures/Pandas/2 Stars` 5.
- Rule: **creatures 2★ (hand-picked subset)**, folders `Creatures/*/2 Stars/*.png`, count 1. Confidence **medium**: 37% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 37% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 17 cards.

### `6ae2a9` ★★★

- Position: x -93.4, z 19.0, near 'Creatures'.
- Cards: 101 (101 distinct); back: `MDW/cardback.png` 101; card scale: 3.0 (101).
- Folders: `Creatures/DST/3 Stars` 6, `Creatures/Everhood/3 Stars` 1, `Creatures/Fnaf/3 Stars` 5, `Creatures/Hollow Knight/3 Stars` 7, `Creatures/In Sound Mind/3 Stars` 2, `Creatures/Isaac/3 Stars` 3, `Creatures/Kirby/3 Stars` 28, `Creatures/Lisa/3 Stars` 1, `Creatures/Mario/3 Stars` 10, `Creatures/Monkey D Folder/3 Stars` 3, `Creatures/Omori/3 Stars` 9, `Creatures/Other/3 Stars` 12, `Creatures/Pandas/3 Stars` 9, `Creatures/Souls/3 Stars` 1, `Creatures/Undertale/3 Stars` 3, `Creatures/World Of Warcraft/3 Stars` 1.
- Rule: **creatures 3★**, folders `Creatures/*/3 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 98% of the repo cards its folders cover.
- Copies: `ac2a14` ★★★.
- Copies per card: 1× 101 cards.
- Missing repo cards (2): `Creatures/Isaac/3 Stars/Tainted_Lazarus.png`, `Creatures/Other/3 Stars/John_Ward.png`.

### `ac2a14` ★★★

- Position: x 131.8, z 16.6, near 'Creatures Copy'.
- Cards: 101 (101 distinct); back: `MDW/cardback.png` 101; card scale: 3.0 (101).
- Folders: `Creatures/DST/3 Stars` 6, `Creatures/Everhood/3 Stars` 1, `Creatures/Fnaf/3 Stars` 5, `Creatures/Hollow Knight/3 Stars` 7, `Creatures/In Sound Mind/3 Stars` 2, `Creatures/Isaac/3 Stars` 3, `Creatures/Kirby/3 Stars` 28, `Creatures/Lisa/3 Stars` 1, `Creatures/Mario/3 Stars` 10, `Creatures/Monkey D Folder/3 Stars` 3, `Creatures/Omori/3 Stars` 9, `Creatures/Other/3 Stars` 12, `Creatures/Pandas/3 Stars` 9, `Creatures/Souls/3 Stars` 1, `Creatures/Undertale/3 Stars` 3, `Creatures/World Of Warcraft/3 Stars` 1.
- Rule: **creatures 3★**, folders `Creatures/*/3 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 98% of the repo cards its folders cover.
- Copies: `6ae2a9` ★★★.
- Copies per card: 1× 101 cards.
- Missing repo cards (2): `Creatures/Isaac/3 Stars/Tainted_Lazarus.png`, `Creatures/Other/3 Stars/John_Ward.png`.

### `3a51c6` (unnamed)

- Position: x -93.4, z -13.1, near 'Creatures Developer Version'.
- Cards: 19 (19 distinct); back: `MDW/cardback.png` 19; card scale: 3.0 (19).
- Folders: `Creatures/Hollow Knight/3 Stars` 2, `Creatures/In Sound Mind/3 Stars` 1, `Creatures/Isaac/3 Stars` 1, `Creatures/Kirby/3 Stars` 1, `Creatures/Mario/3 Stars` 3, `Creatures/Monkey D Folder/3 Stars` 3, `Creatures/Omori/3 Stars` 1, `Creatures/Other/3 Stars` 6, `Creatures/Undertale/3 Stars` 1.
- Rule: **creatures 3★ (hand-picked subset)**, folders `Creatures/*/3 Stars/*.png`, count 1. Confidence **medium**: 18% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 18% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 19 cards.

### `66e756` (unnamed)

- Position: x -83.0, z -13.1, near 'Baseline Creatures'.
- Cards: 22 (22 distinct); back: `MDW/cardback.png` 22; card scale: 3.0 (22).
- Folders: `Creatures/Hollow Knight/3 Stars` 2, `Creatures/Kirby/3 Stars` 14, `Creatures/Mario/3 Stars` 1, `Creatures/Pandas/3 Stars` 4, `Creatures/Souls/3 Stars` 1.
- Rule: **creatures 3★ (hand-picked subset)**, folders `Creatures/*/3 Stars/*.png`, count 1. Confidence **medium**: 21% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 21% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 22 cards.

### `a0d005` ★★★

- Position: x 131.8, z -19.7, near 'Creatures Simple Version'.
- Cards: 47 (47 distinct); back: `MDW/cardback.png` 47; card scale: 3.0 (47).
- Folders: `Creatures/DST/3 Stars` 2, `Creatures/Everhood/3 Stars` 1, `Creatures/Fnaf/3 Stars` 1, `Creatures/Hollow Knight/3 Stars` 1, `Creatures/Kirby/3 Stars` 18, `Creatures/Mario/3 Stars` 2, `Creatures/Omori/3 Stars` 7, `Creatures/Other/3 Stars` 5, `Creatures/Pandas/3 Stars` 8, `Creatures/Souls/3 Stars` 1, `Creatures/Undertale/3 Stars` 1.
- Rule: **creatures 3★ (hand-picked subset)**, folders `Creatures/*/3 Stars/*.png`, count 1. Confidence **medium**: 46% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 46% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 47 cards.

### `cde2bc` ★★★★

- Position: x -93.4, z 14.1, near 'Creatures'.
- Cards: 92 (92 distinct); back: `MDW/cardback.png` 92; card scale: 3.0 (92).
- Folders: `Creatures/BTD/4 Stars` 1, `Creatures/Crypt/4 Stars` 1, `Creatures/DST/4 Stars` 1, `Creatures/Everhood/4 Stars` 2, `Creatures/FTL/4 Stars` 2, `Creatures/Fnaf/4 Stars` 4, `Creatures/Hollow Knight Silksong/4 Stars` 1, `Creatures/Hollow Knight/4 Stars` 11, `Creatures/In Sound Mind/4 Stars` 2, `Creatures/Isaac/4 Stars` 4, `Creatures/Kirby/4 Stars` 14, `Creatures/Lisa/4 Stars` 2, `Creatures/Mario/4 Stars` 7, `Creatures/Monkey D Folder/4 Stars` 3, `Creatures/Omori/4 Stars` 6, `Creatures/Other/4 Stars` 10, `Creatures/Pandas/4 Stars` 3, `Creatures/ROTMG/4 Stars` 1, `Creatures/Souls/4 Stars` 2, `Creatures/Undertale/4 Stars` 4, `Creatures/World Of Warcraft/4 Stars` 11.
- Rule: **creatures 4★**, folders `Creatures/*/4 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 99% of the repo cards its folders cover.
- Copies: `8dc131` ★★★★.
- Copies per card: 1× 92 cards.
- Missing repo cards (1): `Creatures/Other/4 Stars/Militron.png`.

### `8dc131` ★★★★

- Position: x 131.8, z 21.5, near 'Creatures Copy'.
- Cards: 92 (92 distinct); back: `MDW/cardback.png` 92; card scale: 3.0 (92).
- Folders: `Creatures/BTD/4 Stars` 1, `Creatures/Crypt/4 Stars` 1, `Creatures/DST/4 Stars` 1, `Creatures/Everhood/4 Stars` 2, `Creatures/FTL/4 Stars` 2, `Creatures/Fnaf/4 Stars` 4, `Creatures/Hollow Knight Silksong/4 Stars` 1, `Creatures/Hollow Knight/4 Stars` 11, `Creatures/In Sound Mind/4 Stars` 2, `Creatures/Isaac/4 Stars` 4, `Creatures/Kirby/4 Stars` 14, `Creatures/Lisa/4 Stars` 2, `Creatures/Mario/4 Stars` 7, `Creatures/Monkey D Folder/4 Stars` 3, `Creatures/Omori/4 Stars` 6, `Creatures/Other/4 Stars` 10, `Creatures/Pandas/4 Stars` 3, `Creatures/ROTMG/4 Stars` 1, `Creatures/Souls/4 Stars` 2, `Creatures/Undertale/4 Stars` 4, `Creatures/World Of Warcraft/4 Stars` 11.
- Rule: **creatures 4★**, folders `Creatures/*/4 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 99% of the repo cards its folders cover.
- Copies: `cde2bc` ★★★★.
- Copies per card: 1× 92 cards.
- Missing repo cards (1): `Creatures/Other/4 Stars/Militron.png`.

### `bdb082` (unnamed)

- Position: x -93.4, z -18.1, near 'Creatures Developer Version'.
- Cards: 14 (14 distinct); back: `MDW/cardback.png` 14; card scale: 3.0 (14).
- Folders: `Creatures/Crypt/4 Stars` 1, `Creatures/Everhood/4 Stars` 1, `Creatures/FTL/4 Stars` 1, `Creatures/Hollow Knight Silksong/4 Stars` 1, `Creatures/Kirby/4 Stars` 1, `Creatures/Monkey D Folder/4 Stars` 3, `Creatures/Omori/4 Stars` 1, `Creatures/Other/4 Stars` 3, `Creatures/Pandas/4 Stars` 1, `Creatures/World Of Warcraft/4 Stars` 1.
- Rule: **creatures 4★ (hand-picked subset)**, folders `Creatures/*/4 Stars/*.png`, count 1. Confidence **medium**: 15% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 15% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 14 cards.

### `888cba` (unnamed)

- Position: x -83.0, z -18.0, near 'Baseline Creatures'.
- Cards: 25 (25 distinct); back: `MDW/cardback.png` 25; card scale: 3.0 (25).
- Folders: `Creatures/Everhood/4 Stars` 1, `Creatures/Fnaf/4 Stars` 2, `Creatures/Hollow Knight/4 Stars` 2, `Creatures/Isaac/4 Stars` 1, `Creatures/Kirby/4 Stars` 6, `Creatures/Mario/4 Stars` 4, `Creatures/Other/4 Stars` 2, `Creatures/Pandas/4 Stars` 1, `Creatures/Souls/4 Stars` 1, `Creatures/Undertale/4 Stars` 3, `Creatures/World Of Warcraft/4 Stars` 2.
- Rule: **creatures 4★ (hand-picked subset)**, folders `Creatures/*/4 Stars/*.png`, count 1. Confidence **medium**: 27% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 27% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 25 cards.

### `2a34b2` ★★★★

- Position: x 131.8, z -14.8, near 'Creatures Simple Version'.
- Cards: 42 (42 distinct); back: `MDW/cardback.png` 42; card scale: 3.0 (42).
- Folders: `Creatures/BTD/4 Stars` 1, `Creatures/DST/4 Stars` 1, `Creatures/Everhood/4 Stars` 1, `Creatures/FTL/4 Stars` 1, `Creatures/Fnaf/4 Stars` 3, `Creatures/Hollow Knight/4 Stars` 4, `Creatures/Isaac/4 Stars` 1, `Creatures/Kirby/4 Stars` 10, `Creatures/Lisa/4 Stars` 1, `Creatures/Mario/4 Stars` 3, `Creatures/Omori/4 Stars` 2, `Creatures/Other/4 Stars` 5, `Creatures/Pandas/4 Stars` 1, `Creatures/Souls/4 Stars` 1, `Creatures/Undertale/4 Stars` 2, `Creatures/World Of Warcraft/4 Stars` 5.
- Rule: **creatures 4★ (hand-picked subset)**, folders `Creatures/*/4 Stars/*.png`, count 1. Confidence **medium**: 45% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 45% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 42 cards.

### `bc1e3f` ★★★★★

- Position: x -93.4, z 9.2, near 'Creatures'.
- Cards: 56 (56 distinct); back: `MDW/cardback.png` 56; card scale: 3.0 (56).
- Folders: `Creatures/BTD/5 Stars` 1, `Creatures/Bug Fables/5 Stars` 1, `Creatures/Cuphead/5 Stars` 1, `Creatures/DST/5 Stars` 1, `Creatures/Everhood/5 Stars` 2, `Creatures/FTL/5 Stars` 1, `Creatures/Fnaf/5 Stars` 3, `Creatures/Hollow Knight/5 Stars` 4, `Creatures/Kirby/5 Stars` 14, `Creatures/Mario/5 Stars` 1, `Creatures/Omori/5 Stars` 4, `Creatures/Other/5 Stars` 16, `Creatures/Pandas/5 Stars` 1, `Creatures/ROTMG/5 Stars` 1, `Creatures/Souls/5 Stars` 1, `Creatures/Undertale/5 Stars` 3, `Creatures/World Of Warcraft/5 Stars` 1.
- Rule: **creatures 5★**, folders `Creatures/*/5 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 98% of the repo cards its folders cover.
- Copies: `f05d89` ★★★★★.
- Copies per card: 1× 56 cards.
- Missing repo cards (1): `Creatures/Other/5 Stars/Z!!!!!.png`.

### `f05d89` ★★★★★

- Position: x 131.8, z 26.4, near 'Creatures Copy'.
- Cards: 56 (56 distinct); back: `MDW/cardback.png` 56; card scale: 3.0 (56).
- Folders: `Creatures/BTD/5 Stars` 1, `Creatures/Bug Fables/5 Stars` 1, `Creatures/Cuphead/5 Stars` 1, `Creatures/DST/5 Stars` 1, `Creatures/Everhood/5 Stars` 2, `Creatures/FTL/5 Stars` 1, `Creatures/Fnaf/5 Stars` 3, `Creatures/Hollow Knight/5 Stars` 4, `Creatures/Kirby/5 Stars` 14, `Creatures/Mario/5 Stars` 1, `Creatures/Omori/5 Stars` 4, `Creatures/Other/5 Stars` 16, `Creatures/Pandas/5 Stars` 1, `Creatures/ROTMG/5 Stars` 1, `Creatures/Souls/5 Stars` 1, `Creatures/Undertale/5 Stars` 3, `Creatures/World Of Warcraft/5 Stars` 1.
- Rule: **creatures 5★**, folders `Creatures/*/5 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 98% of the repo cards its folders cover.
- Copies: `bc1e3f` ★★★★★.
- Copies per card: 1× 56 cards.
- Missing repo cards (1): `Creatures/Other/5 Stars/Z!!!!!.png`.

### `f33bd9` (unnamed)

- Position: x -93.4, z -23.0, near 'Creatures Developer Version'.
- Cards: 14 (14 distinct); back: `MDW/cardback.png` 14; card scale: 3.0 (14).
- Folders: `Creatures/Cuphead/5 Stars` 1, `Creatures/Fnaf/5 Stars` 1, `Creatures/Kirby/5 Stars` 3, `Creatures/Other/5 Stars` 6, `Creatures/ROTMG/5 Stars` 1, `Creatures/Undertale/5 Stars` 1, `Creatures/World Of Warcraft/5 Stars` 1.
- Rule: **creatures 5★ (hand-picked subset)**, folders `Creatures/*/5 Stars/*.png`, count 1. Confidence **medium**: 23% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 23% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 14 cards.

### `c9a8fc` ★★★★★

- Position: x 131.8, z -9.9, near 'Creatures Simple Version'.
- Cards: 26 (26 distinct); back: `MDW/cardback.png` 26; card scale: 3.0 (26).
- Folders: `Creatures/Bug Fables/5 Stars` 1, `Creatures/DST/5 Stars` 1, `Creatures/Everhood/5 Stars` 1, `Creatures/Fnaf/5 Stars` 1, `Creatures/Hollow Knight/5 Stars` 3, `Creatures/Kirby/5 Stars` 8, `Creatures/Mario/5 Stars` 1, `Creatures/Omori/5 Stars` 3, `Creatures/Other/5 Stars` 4, `Creatures/Pandas/5 Stars` 1, `Creatures/Souls/5 Stars` 1, `Creatures/Undertale/5 Stars` 1.
- Rule: **creatures 5★ (hand-picked subset)**, folders `Creatures/*/5 Stars/*.png`, count 1. Confidence **medium**: 46% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 46% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 26 cards.

### `8fb88d` ★

- Position: x -84.3, z 23.2, near 'Items'.
- Cards: 39 (24 distinct); back: `MDW/cardback_item.png` 39; card scale: 2.0 (39).
- Folders: `Items/Attack/1 Stars` 4, `Items/Counter/1 Stars` 3, `Items/Deploy/1 Stars` 2, `Items/Equip/1 Stars` 11, `Items/Heal/1 Stars` 11, `Items/Infliction/1 Stars` 2, `Items/Support/1 Stars` 6.
- Rule: **items 1★**, folders `Items/*/1 Stars/*.png`, count 2. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `42909d` ★.
- Copies per card: 1× 9 cards, 2× 15 cards.
- Cards not at 2 copies: Poison Trap ×1, Boko Club ×1, Bone's Loans ×1, GrubSong ×1, Lazy Worm ×1, Leaf Shield ×1, Pillow ×1, Steady Body ×1, Ingredient Desert Limes ×1.
- Duplicate (image under several deck ids): Items/Equip/1 Stars/Shellphone.png -> 1500, 1565.

### `89e02e` 1 Star Equips

- Position: x 116.6, z 4.7; inside Bag 'Specific Item Decks' (position is stale).
- Cards: 0 (0 distinct); back: -; card scale: -.
- Rule: **items 1★ Equip**, folders `Items/Equip/1 Stars/*.png`. Confidence **low**: empty deck; rule guessed from its name.
- Copies: none.

### `42909d` ★

- Position: x 122.6, z 13.3, near 'Items Copy'.
- Cards: 39 (24 distinct); back: `MDW/cardback_item.png` 39; card scale: 2.0 (39).
- Folders: `Items/Attack/1 Stars` 4, `Items/Counter/1 Stars` 3, `Items/Deploy/1 Stars` 2, `Items/Equip/1 Stars` 11, `Items/Heal/1 Stars` 11, `Items/Infliction/1 Stars` 2, `Items/Support/1 Stars` 6.
- Rule: **items 1★**, folders `Items/*/1 Stars/*.png`, count 2. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `8fb88d` ★.
- Copies per card: 1× 9 cards, 2× 15 cards.
- Cards not at 2 copies: Poison Trap ×1, Boko Club ×1, Bone's Loans ×1, GrubSong ×1, Lazy Worm ×1, Leaf Shield ×1, Pillow ×1, Steady Body ×1, Ingredient Desert Limes ×1.
- Duplicate (image under several deck ids): Items/Equip/1 Stars/Shellphone.png -> 1500, 1565.

### `6dbf7e` ★

- Position: x 123.3, z -24.8, near 'Items Simple Version'.
- Cards: 30 (18 distinct); back: `MDW/cardback_item.png` 30; card scale: 2.0 (30).
- Folders: `Items/Attack/1 Stars` 4, `Items/Counter/1 Stars` 2, `Items/Equip/1 Stars` 8, `Items/Heal/1 Stars` 10, `Items/Infliction/1 Stars` 2, `Items/Support/1 Stars` 4.
- Rule: **items 1★ (hand-picked subset)**, folders `Items/*/1 Stars/*.png`, count 2. Confidence **medium**: 75% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 75% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 6 cards, 2× 12 cards.

### `a7e1aa` ★★

- Position: x -84.3, z 18.8, near 'Items'.
- Cards: 96 (66 distinct); back: `MDW/cardback_item.png` 96; card scale: 2.0 (96).
- Folders: `Items/Active/2 Stars` 2, `Items/Attack/2 Stars` 9, `Items/Counter/2 Stars` 2, `Items/Deploy/2 Stars` 2, `Items/Equip/2 Stars` 22, `Items/Heal/2 Stars` 30, `Items/Infliction/2 Stars` 4, `Items/Negation/2 Stars` 10, `Items/Support/2 Stars` 15.
- Rule: **items 2★**, folders `Items/*/2 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `7cdb04` ★★.
- Copies per card: 1× 45 cards, 2× 16 cards, 3× 3 cards, 5× 2 cards.
- Cards not at 1 copies: Bomb ×3, Firebomb ×2, Ice Bomb ×2, Stone Spikes ×2, Basic Shield ×3, Holy Card ×2, Iron Sword ×2, Tomorrow I'll ×2, Grapes ×2, Mushroom ×2, Pep Drink ×3, Pepperoni Pizza ×2, Regeneration Potion ×2, The Chicken ×2, Watermelon ×2, Bag of Evil ×2, Mr Softener ×2, Metronome ×5, Stopwatch ×5, Gust of Trees ×2, Gust of Wind ×2.
- Duplicate (image under several deck ids): Items/Attack/2 Stars/Firebomb.png -> 1530, 1531.
- Duplicate (one Nickname, several images): All-Purpose Medical Kit -> Items/Heal/2 Stars/All_Purpose_Medical_Kit.png, Items/Heal/2 Stars/All_Purpose_Medical_Kit2.png.
- Duplicate (one Nickname, several images): Watermelon -> Items/Heal/2 Stars/Watermelon.png, Items/Heal/2 Stars/Watermelon2.png.
- Duplicate (one Nickname, several images): NME Stock™ -> Items/Support/2 Stars/NME_Stock.png, Items/Support/2 Stars/NME_Stock2.png.

### `280637` 2 Star Healing Items

- Position: x 117.2, z 4.1; inside Bag 'Specific Item Decks' (position is stale).
- Cards: 0 (0 distinct); back: -; card scale: -.
- Rule: **items 2★ Heal**, folders `Items/Heal/2 Stars/*.png`. Confidence **low**: empty deck; rule guessed from its name.
- Copies: none.

### `82d617` 2 Star Equips

- Position: x 117.3, z 5.0; inside Bag 'Specific Item Decks' (position is stale).
- Cards: 0 (0 distinct); back: -; card scale: -.
- Rule: **items 2★ Equip**, folders `Items/Equip/2 Stars/*.png`. Confidence **low**: empty deck; rule guessed from its name.
- Copies: none.

### `452af0` 2 Star Attack Items

- Position: x 117.5, z 5.8; inside Bag 'Specific Item Decks' (position is stale).
- Cards: 0 (0 distinct); back: -; card scale: -.
- Rule: **items 2★ Attack**, folders `Items/Attack/2 Stars/*.png`. Confidence **low**: empty deck; rule guessed from its name.
- Copies: none.

### `7cdb04` ★★

- Position: x 122.6, z 17.7, near 'Items Copy'.
- Cards: 96 (66 distinct); back: `MDW/cardback_item.png` 96; card scale: 2.0 (96).
- Folders: `Items/Active/2 Stars` 2, `Items/Attack/2 Stars` 9, `Items/Counter/2 Stars` 2, `Items/Deploy/2 Stars` 2, `Items/Equip/2 Stars` 22, `Items/Heal/2 Stars` 30, `Items/Infliction/2 Stars` 4, `Items/Negation/2 Stars` 10, `Items/Support/2 Stars` 15.
- Rule: **items 2★**, folders `Items/*/2 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `a7e1aa` ★★.
- Copies per card: 1× 45 cards, 2× 16 cards, 3× 3 cards, 5× 2 cards.
- Cards not at 1 copies: Bomb ×3, Firebomb ×2, Ice Bomb ×2, Stone Spikes ×2, Basic Shield ×3, Holy Card ×2, Iron Sword ×2, Tomorrow I'll ×2, Grapes ×2, Mushroom ×2, Pep Drink ×3, Pepperoni Pizza ×2, Regeneration Potion ×2, The Chicken ×2, Watermelon ×2, Bag of Evil ×2, Mr Softener ×2, Metronome ×5, Stopwatch ×5, Gust of Trees ×2, Gust of Wind ×2.
- Duplicate (image under several deck ids): Items/Attack/2 Stars/Firebomb.png -> 1530, 1531.
- Duplicate (one Nickname, several images): All-Purpose Medical Kit -> Items/Heal/2 Stars/All_Purpose_Medical_Kit.png, Items/Heal/2 Stars/All_Purpose_Medical_Kit2.png.
- Duplicate (one Nickname, several images): Watermelon -> Items/Heal/2 Stars/Watermelon.png, Items/Heal/2 Stars/Watermelon2.png.
- Duplicate (one Nickname, several images): NME Stock™ -> Items/Support/2 Stars/NME_Stock.png, Items/Support/2 Stars/NME_Stock2.png.

### `c86c21` ★★

- Position: x 123.3, z -20.4, near 'Items Simple Version'.
- Cards: 75 (48 distinct); back: `MDW/cardback_item.png` 75; card scale: 2.0 (75).
- Folders: `Items/Attack/2 Stars` 9, `Items/Counter/2 Stars` 2, `Items/Equip/2 Stars` 16, `Items/Heal/2 Stars` 27, `Items/Infliction/2 Stars` 4, `Items/Negation/2 Stars` 8, `Items/Support/2 Stars` 9.
- Rule: **items 2★ (hand-picked subset)**, folders `Items/*/2 Stars/*.png`, count 1. Confidence **medium**: 73% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 73% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 28 cards, 2× 15 cards, 3× 3 cards, 4× 2 cards.
- Duplicate (image under several deck ids): Items/Attack/2 Stars/Firebomb.png -> 1547, 1548.
- Duplicate (one Nickname, several images): Gust of Trees -> Items/Support/2 Stars/Gust_of_Trees.png, Items/Support/2 Stars/Gust_of_Wind.png.
- Duplicate (one Nickname, several images): All-Purpose Medical Kit -> Items/Heal/2 Stars/All_Purpose_Medical_Kit.png, Items/Heal/2 Stars/All_Purpose_Medical_Kit2.png.
- Duplicate (one Nickname, several images): NME Stock™ -> Items/Support/2 Stars/NME_Stock.png, Items/Support/2 Stars/NME_Stock2.png.

### `213c84` ★★★

- Position: x -84.3, z 14.3, near 'Items'.
- Cards: 88 (68 distinct); back: `MDW/cardback_item.png` 88; card scale: 2.0 (88).
- Folders: `Items/Active/3 Stars` 5, `Items/Attack/3 Stars` 15, `Items/Counter/3 Stars` 6, `Items/Equip/3 Stars` 24, `Items/Heal/3 Stars` 19, `Items/Infliction/3 Stars` 4, `Items/Negation/3 Stars` 3, `Items/Support/3 Stars` 12.
- Rule: **items 3★, -1 excluded**, folders `Items/*/3 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 99% of the repo cards its folders cover.
- Copies: `abb81f` ★★★.
- Copies per card: 1× 50 cards, 2× 16 cards, 3× 2 cards.
- Cards not at 1 copies: Big Bomb ×3, Blood Bomb ×2, Burly Bomb ×2, Fireball ×2, Lightning Bolt ×2, POW Block ×2, Shooting Star ×2, Iron Spikes ×2, Metal Shield ×2, Titanium Sword ×2, Dumplings ×2, Feast ×2, Healing Ritual ×2, Life Shroom ×2, Maxim Tomato ×3, Squash Candy ×2, Super Shroom ×2, Ancient Stopwatch ×2.
- Duplicate (image under several deck ids): Items/Heal/3 Stars/Maxim_Tomato.png -> 1532, 1533, 1534.

### `493fc7` 3 Star Equips

- Position: x 116.0, z 4.6; inside Bag 'Specific Item Decks' (position is stale).
- Cards: 0 (0 distinct); back: -; card scale: -.
- Rule: **items 3★ Equip**, folders `Items/Equip/3 Stars/*.png`. Confidence **low**: empty deck; rule guessed from its name.
- Copies: none.

### `abb81f` ★★★

- Position: x 122.6, z 22.2, near 'Items Copy'.
- Cards: 88 (68 distinct); back: `MDW/cardback_item.png` 88; card scale: 2.0 (88).
- Folders: `Items/Active/3 Stars` 5, `Items/Attack/3 Stars` 15, `Items/Counter/3 Stars` 6, `Items/Equip/3 Stars` 24, `Items/Heal/3 Stars` 19, `Items/Infliction/3 Stars` 4, `Items/Negation/3 Stars` 3, `Items/Support/3 Stars` 12.
- Rule: **items 3★, -1 excluded**, folders `Items/*/3 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 99% of the repo cards its folders cover.
- Copies: `213c84` ★★★.
- Copies per card: 1× 50 cards, 2× 16 cards, 3× 2 cards.
- Cards not at 1 copies: Big Bomb ×3, Blood Bomb ×2, Burly Bomb ×2, Fireball ×2, Lightning Bolt ×2, POW Block ×2, Shooting Star ×2, Iron Spikes ×2, Metal Shield ×2, Titanium Sword ×2, Dumplings ×2, Feast ×2, Healing Ritual ×2, Life Shroom ×2, Maxim Tomato ×3, Squash Candy ×2, Super Shroom ×2, Ancient Stopwatch ×2.
- Duplicate (image under several deck ids): Items/Heal/3 Stars/Maxim_Tomato.png -> 1532, 1533, 1534.

### `b630d6` ★★★

- Position: x 123.3, z -16.0, near 'Items Simple Version'.
- Cards: 68 (48 distinct); back: `MDW/cardback_item.png` 68; card scale: 2.0 (68).
- Folders: `Items/Active/3 Stars` 2, `Items/Attack/3 Stars` 15, `Items/Counter/3 Stars` 5, `Items/Equip/3 Stars` 18, `Items/Heal/3 Stars` 17, `Items/Infliction/3 Stars` 3, `Items/Negation/3 Stars` 3, `Items/Support/3 Stars` 5.
- Rule: **items 3★ (hand-picked subset)**, folders `Items/*/3 Stars/*.png`, count 1. Confidence **medium**: 70% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 70% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 30 cards, 2× 16 cards, 3× 2 cards.
- Duplicate (image under several deck ids): Items/Heal/3 Stars/Maxim_Tomato.png -> 1549, 1550, 1551.

### `df0c17` ★★★★

- Position: x -84.3, z 9.9, near 'Items'.
- Cards: 30 (30 distinct); back: `MDW/cardback_item.png` 30; card scale: 2.0 (30).
- Folders: `Items/Active/4 Stars` 2, `Items/Attack/4 Stars` 2, `Items/Counter/4 Stars` 1, `Items/Equip/4 Stars` 16, `Items/Heal/4 Stars` 1, `Items/Infliction/4 Stars` 3, `Items/Negation/4 Stars` 1, `Items/Support/4 Stars` 4.
- Rule: **items 4★**, folders `Items/*/4 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `9c4f0c` ★★★★.
- Copies per card: 1× 30 cards.

### `b1cb91` 4 Star Attack Items

- Position: x 117.1, z 4.4; inside Bag 'Specific Item Decks' (position is stale).
- Cards: 0 (0 distinct); back: -; card scale: -.
- Rule: **items 4★ Attack**, folders `Items/Attack/4 Stars/*.png`. Confidence **low**: empty deck; rule guessed from its name.
- Copies: none.

### `886307` 4 Star Equips

- Position: x 117.2, z 4.2; inside Bag 'Specific Item Decks' (position is stale).
- Cards: 0 (0 distinct); back: -; card scale: -.
- Rule: **items 4★ Equip**, folders `Items/Equip/4 Stars/*.png`. Confidence **low**: empty deck; rule guessed from its name.
- Copies: none.

### `9c4f0c` ★★★★

- Position: x 122.6, z 26.6, near 'Items Copy'.
- Cards: 30 (30 distinct); back: `MDW/cardback_item.png` 30; card scale: 2.0 (30).
- Folders: `Items/Active/4 Stars` 2, `Items/Attack/4 Stars` 2, `Items/Counter/4 Stars` 1, `Items/Equip/4 Stars` 16, `Items/Heal/4 Stars` 1, `Items/Infliction/4 Stars` 3, `Items/Negation/4 Stars` 1, `Items/Support/4 Stars` 4.
- Rule: **items 4★**, folders `Items/*/4 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `df0c17` ★★★★.
- Copies per card: 1× 30 cards.

### `091586` ★★★★

- Position: x 123.3, z -11.6, near 'Items Simple Version'.
- Cards: 17 (17 distinct); back: `MDW/cardback_item.png` 17; card scale: 2.0 (17).
- Folders: `Items/Active/4 Stars` 1, `Items/Attack/4 Stars` 1, `Items/Counter/4 Stars` 1, `Items/Equip/4 Stars` 9, `Items/Heal/4 Stars` 1, `Items/Infliction/4 Stars` 3, `Items/Negation/4 Stars` 1.
- Rule: **items 4★ (hand-picked subset)**, folders `Items/*/4 Stars/*.png`, count 1. Confidence **medium**: 57% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 57% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 17 cards.

### `b25a54` ★

- Position: x -76.9, z 23.1, near 'Field Items'.
- Cards: 9 (9 distinct); back: `MDW/cardback_item.png` 9; card scale: 2.0 (9).
- Folders: `Field/1 Stars` 9.
- Rule: **fields 1★**, folders `Field/1 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `769f68` ★.
- Copies per card: 1× 9 cards.

### `769f68` ★

- Position: x 115.1, z 13.3, near 'Field Items Copy'.
- Cards: 9 (9 distinct); back: `MDW/cardback_item.png` 9; card scale: 2.0 (9).
- Folders: `Field/1 Stars` 9.
- Rule: **fields 1★**, folders `Field/1 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `b25a54` ★.
- Copies per card: 1× 9 cards.

### `4e992d` ★★

- Position: x -76.9, z 18.7, near 'Field Items'.
- Cards: 18 (18 distinct); back: `MDW/cardback_item.png` 18; card scale: 2.0 (18).
- Folders: `Field/2 Stars` 18.
- Rule: **fields 2★**, folders `Field/2 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `b14958` ★★.
- Copies per card: 1× 18 cards.

### `b14958` ★★

- Position: x 115.1, z 17.7, near 'Field Items Copy'.
- Cards: 18 (18 distinct); back: `MDW/cardback_item.png` 18; card scale: 2.0 (18).
- Folders: `Field/2 Stars` 18.
- Rule: **fields 2★**, folders `Field/2 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `4e992d` ★★.
- Copies per card: 1× 18 cards.

### `97edb2` ★★★

- Position: x -76.9, z 14.3, near 'Field Items'.
- Cards: 12 (12 distinct); back: `MDW/cardback_item.png` 12; card scale: 2.0 (12).
- Folders: `Field/3 Stars` 12.
- Rule: **fields 3★**, folders `Field/3 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `f16501` ★★★.
- Copies per card: 1× 12 cards.

### `f16501` ★★★

- Position: x 115.1, z 22.2, near 'Field Items Copy'.
- Cards: 12 (12 distinct); back: `MDW/cardback_item.png` 12; card scale: 2.0 (12).
- Folders: `Field/3 Stars` 12.
- Rule: **fields 3★**, folders `Field/3 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `97edb2` ★★★.
- Copies per card: 1× 12 cards.

### `b53bbf` ★★★★

- Position: x -76.9, z 9.9, near 'Field Items'.
- Cards: 10 (10 distinct); back: `MDW/cardback_item.png` 10; card scale: 2.0 (10).
- Folders: `Field/4 Stars` 10.
- Rule: **fields 4★**, folders `Field/4 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 91% of the repo cards its folders cover.
- Copies: `36ee4c` ★★★★.
- Copies per card: 1× 10 cards.
- Missing repo cards (1): `Field/4 Stars/The_Gates_of_Ahn'Qiraj.png`.

### `36ee4c` ★★★★

- Position: x 115.1, z 26.6, near 'Field Items Copy'.
- Cards: 10 (10 distinct); back: `MDW/cardback_item.png` 10; card scale: 2.0 (10).
- Folders: `Field/4 Stars` 10.
- Rule: **fields 4★**, folders `Field/4 Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 91% of the repo cards its folders cover.
- Copies: `b53bbf` ★★★★.
- Copies per card: 1× 10 cards.
- Missing repo cards (1): `Field/4 Stars/The_Gates_of_Ahn'Qiraj.png`.

### `d3995a` N.M.E. Deck

- Position: x -84.1, z 5.1, on 'N.M.E Items'.
- Cards: 26 (26 distinct); back: `MDW/cardback_item.png` 26; card scale: 2.0 (26).
- Folders: `N.M.E` 26.
- Rule: **N.M.E**, folders `N.M.E/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `444f1f` N.M.E. Deck.
- Copies per card: 1× 26 cards.

### `444f1f` N.M.E. Deck

- Position: x 108.3, z 18.4, on 'N.M.E. Items Copy'.
- Cards: 26 (26 distinct); back: `MDW/cardback_item.png` 26; card scale: 2.0 (26).
- Folders: `N.M.E` 26.
- Rule: **N.M.E**, folders `N.M.E/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `d3995a` N.M.E. Deck.
- Copies per card: 1× 26 cards.

### `c8333f` Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐

- Position: x 89.5, z -1.6, on 'All Status Effects'.
- Cards: 64 (64 distinct); back: `MDW/cardback_statuseffect.png` 64; card scale: 0.75 (64).
- Folders: `Auxiliary/Status Effects/Buffs` 12, `Auxiliary/Status Effects/Debuffs/1 Stars` 12, `Auxiliary/Status Effects/Debuffs/2 Stars` 16, `Auxiliary/Status Effects/Debuffs/3 Stars` 14, `Auxiliary/Status Effects/Debuffs/4 Stars` 10.
- Rule: **status effects**, folders `Auxiliary/Status Effects/Buffs/*.png`, `Auxiliary/Status Effects/Debuffs/* Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `ee3c0c` Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐, `abd26b` Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐.
- Copies per card: 1× 64 cards.

### `ee3c0c` Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐

- Position: x 89.6, z 1.4, on 'All Status Effects'.
- Cards: 64 (64 distinct); back: `MDW/cardback_statuseffect.png` 64; card scale: 0.75 (64).
- Folders: `Auxiliary/Status Effects/Buffs` 12, `Auxiliary/Status Effects/Debuffs/1 Stars` 12, `Auxiliary/Status Effects/Debuffs/2 Stars` 16, `Auxiliary/Status Effects/Debuffs/3 Stars` 14, `Auxiliary/Status Effects/Debuffs/4 Stars` 10.
- Rule: **status effects**, folders `Auxiliary/Status Effects/Buffs/*.png`, `Auxiliary/Status Effects/Debuffs/* Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `c8333f` Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐, `abd26b` Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐.
- Copies per card: 1× 64 cards.

### `abd26b` Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐

- Position: x 110.2, z 15.1, on 'Status Effects Copy'.
- Cards: 64 (64 distinct); back: `MDW/cardback_statuseffect.png` 64; card scale: 0.75 (64).
- Folders: `Auxiliary/Status Effects/Buffs` 12, `Auxiliary/Status Effects/Debuffs/1 Stars` 12, `Auxiliary/Status Effects/Debuffs/2 Stars` 16, `Auxiliary/Status Effects/Debuffs/3 Stars` 14, `Auxiliary/Status Effects/Debuffs/4 Stars` 10.
- Rule: **status effects**, folders `Auxiliary/Status Effects/Buffs/*.png`, `Auxiliary/Status Effects/Debuffs/* Stars/*.png`, count 1. Confidence **high**: every card is from the kind's folders, one back.
- Holds 100% of the repo cards its folders cover.
- Copies: `c8333f` Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐, `ee3c0c` Status Effects⭐⭐⭐⭐⭐⭐⭐⭐⭐.
- Copies per card: 1× 64 cards.

### `ed587f` Minions

- Position: x 97.4, z -3.4, on 'Minions'.
- Cards: 95 (95 distinct); back: `MDW/cardback.png` 95; card scale: 2.0 (95).
- Folders: `Auxiliary/Creatures` 6, `Auxiliary/Minions` 88, `Creatures/Other/2 Stars` 1.
- Rule: **minions, + Auxiliary/Creatures, +1 listed card(s)**, folders `Auxiliary/Minions/*.png`, `Auxiliary/Creatures/*.png`, count 1. Confidence **medium**: 7% of cards come from outside the kind's folders: extra folder Auxiliary/Creatures/*.png, 1 listed card(s).
- Holds 96% of the repo cards its folders cover.
- Copies: `6e935f` Minions, `f8df22` Minions.
- Copies per card: 1× 95 cards.
- Missing repo cards (4): `Auxiliary/Creatures/Militron_(No_Armor).png`, `Auxiliary/Minions/Anubisath_Guardian.png`, `Auxiliary/Minions/Qiraji_Soldier.png`, `Auxiliary/Minions/Silithid.png`.
- Outside the kind's folders (7): `Auxiliary/Creatures/Azamoth_the_Possessed_Vessel.png`, `Auxiliary/Creatures/Igor_Roballtowski.png`, `Auxiliary/Creatures/Mettaton_EX.png`, `Auxiliary/Creatures/Mettaton_NEO.png`, `Auxiliary/Creatures/Morpho_Knight.png`, `Auxiliary/Creatures/Shadow_Queen.png`, `Creatures/Other/2 Stars/Stubborn_Queen.png`.

### `6e935f` Minions

- Position: x 97.4, z 3.3, on 'Minions'.
- Cards: 95 (95 distinct); back: `MDW/cardback.png` 95; card scale: 2.0 (95).
- Folders: `Auxiliary/Creatures` 6, `Auxiliary/Minions` 88, `Creatures/Other/2 Stars` 1.
- Rule: **minions, + Auxiliary/Creatures, +1 listed card(s)**, folders `Auxiliary/Minions/*.png`, `Auxiliary/Creatures/*.png`, count 1. Confidence **medium**: 7% of cards come from outside the kind's folders: extra folder Auxiliary/Creatures/*.png, 1 listed card(s).
- Holds 96% of the repo cards its folders cover.
- Copies: `ed587f` Minions, `f8df22` Minions.
- Copies per card: 1× 95 cards.
- Missing repo cards (4): `Auxiliary/Creatures/Militron_(No_Armor).png`, `Auxiliary/Minions/Anubisath_Guardian.png`, `Auxiliary/Minions/Qiraji_Soldier.png`, `Auxiliary/Minions/Silithid.png`.
- Outside the kind's folders (7): `Auxiliary/Creatures/Azamoth_the_Possessed_Vessel.png`, `Auxiliary/Creatures/Igor_Roballtowski.png`, `Auxiliary/Creatures/Mettaton_EX.png`, `Auxiliary/Creatures/Mettaton_NEO.png`, `Auxiliary/Creatures/Morpho_Knight.png`, `Auxiliary/Creatures/Shadow_Queen.png`, `Creatures/Other/2 Stars/Stubborn_Queen.png`.

### `f8df22` Minions

- Position: x 108.3, z 26.9, on 'Minions Copy'.
- Cards: 95 (95 distinct); back: `MDW/cardback.png` 95; card scale: 2.0 (95).
- Folders: `Auxiliary/Creatures` 6, `Auxiliary/Minions` 88, `Creatures/Other/2 Stars` 1.
- Rule: **minions, + Auxiliary/Creatures, +1 listed card(s)**, folders `Auxiliary/Minions/*.png`, `Auxiliary/Creatures/*.png`, count 1. Confidence **medium**: 7% of cards come from outside the kind's folders: extra folder Auxiliary/Creatures/*.png, 1 listed card(s).
- Holds 96% of the repo cards its folders cover.
- Copies: `6e935f` Minions, `ed587f` Minions.
- Copies per card: 1× 95 cards.
- Missing repo cards (4): `Auxiliary/Creatures/Militron_(No_Armor).png`, `Auxiliary/Minions/Anubisath_Guardian.png`, `Auxiliary/Minions/Qiraji_Soldier.png`, `Auxiliary/Minions/Silithid.png`.
- Outside the kind's folders (7): `Auxiliary/Creatures/Azamoth_the_Possessed_Vessel.png`, `Auxiliary/Creatures/Igor_Roballtowski.png`, `Auxiliary/Creatures/Mettaton_EX.png`, `Auxiliary/Creatures/Mettaton_NEO.png`, `Auxiliary/Creatures/Morpho_Knight.png`, `Auxiliary/Creatures/Shadow_Queen.png`, `Creatures/Other/2 Stars/Stubborn_Queen.png`.

### `0b410c` Auxiliary Items

- Position: x 93.0, z -3.5, on 'Auxiliary Items'.
- Cards: 59 (59 distinct); back: `MDW/cardback_item.png` 59; card scale: 2.0 (59).
- Folders: `Auxiliary/Items` 47, `Items/Attack/2 Stars` 1, `Items/Deploy/1 Stars` 1, `Items/Equip/2 Stars` 1, `Items/Equip/3 Stars` 1, `Items/Heal/1 Stars` 1, `Items/Heal/2 Stars` 4, `Items/Heal/3 Stars` 1, `Items/Support/2 Stars` 1, `N.M.E` 1.
- Rule: **auxiliary items, +12 listed card(s)**, folders `Auxiliary/Items/*.png`, count 1. Confidence **medium**: 20% of cards come from outside the kind's folders: 12 listed card(s).
- Holds 98% of the repo cards its folders cover.
- Copies: `ac4725` Auxiliary Items, `883c04` Auxiliary Items.
- Copies per card: 1× 59 cards.
- Missing repo cards (1): `Auxiliary/Items/The_Temple_of_Ahn'Qiraj.png`.
- Outside the kind's folders (12): `Items/Attack/2 Stars/Bomb.png`, `Items/Deploy/1 Stars/Poison_Circle.png`, `Items/Equip/2 Stars/Holy_Card.png`, `Items/Equip/3 Stars/Piko_Piko_Hammer.png`, `Items/Heal/1 Stars/Ingredient_Desert_Limes.png`, `Items/Heal/2 Stars/Ingredient_Gnome_Berries.png`, `Items/Heal/2 Stars/Ingredient_Icy_Sugar_Cubes.png`, `Items/Heal/2 Stars/Ingredient_Pineapple_Mint.png`, `Items/Heal/2 Stars/Pepperoni_Pizza.png`, `Items/Heal/3 Stars/Ingredient_Distillery_Dough.png`, `Items/Support/2 Stars/Gasoline.png`, `N.M.E/Rope.png`.

### `ac4725` Auxiliary Items

- Position: x 93.1, z 3.2, on 'Auxiliary Items'.
- Cards: 59 (59 distinct); back: `MDW/cardback_item.png` 59; card scale: 2.0 (59).
- Folders: `Auxiliary/Items` 47, `Items/Attack/2 Stars` 1, `Items/Deploy/1 Stars` 1, `Items/Equip/2 Stars` 1, `Items/Equip/3 Stars` 1, `Items/Heal/1 Stars` 1, `Items/Heal/2 Stars` 4, `Items/Heal/3 Stars` 1, `Items/Support/2 Stars` 1, `N.M.E` 1.
- Rule: **auxiliary items, +12 listed card(s)**, folders `Auxiliary/Items/*.png`, count 1. Confidence **medium**: 20% of cards come from outside the kind's folders: 12 listed card(s).
- Holds 98% of the repo cards its folders cover.
- Copies: `0b410c` Auxiliary Items, `883c04` Auxiliary Items.
- Copies per card: 1× 59 cards.
- Missing repo cards (1): `Auxiliary/Items/The_Temple_of_Ahn'Qiraj.png`.
- Outside the kind's folders (12): `Items/Attack/2 Stars/Bomb.png`, `Items/Deploy/1 Stars/Poison_Circle.png`, `Items/Equip/2 Stars/Holy_Card.png`, `Items/Equip/3 Stars/Piko_Piko_Hammer.png`, `Items/Heal/1 Stars/Ingredient_Desert_Limes.png`, `Items/Heal/2 Stars/Ingredient_Gnome_Berries.png`, `Items/Heal/2 Stars/Ingredient_Icy_Sugar_Cubes.png`, `Items/Heal/2 Stars/Ingredient_Pineapple_Mint.png`, `Items/Heal/2 Stars/Pepperoni_Pizza.png`, `Items/Heal/3 Stars/Ingredient_Distillery_Dough.png`, `Items/Support/2 Stars/Gasoline.png`, `N.M.E/Rope.png`.

### `883c04` Auxiliary Items

- Position: x 108.3, z 22.7, on 'Auxiliary Items Copy'.
- Cards: 59 (59 distinct); back: `MDW/cardback_item.png` 59; card scale: 2.0 (59).
- Folders: `Auxiliary/Items` 47, `Items/Attack/2 Stars` 1, `Items/Deploy/1 Stars` 1, `Items/Equip/2 Stars` 1, `Items/Equip/3 Stars` 1, `Items/Heal/1 Stars` 1, `Items/Heal/2 Stars` 4, `Items/Heal/3 Stars` 1, `Items/Support/2 Stars` 1, `N.M.E` 1.
- Rule: **auxiliary items, +12 listed card(s)**, folders `Auxiliary/Items/*.png`, count 1. Confidence **medium**: 20% of cards come from outside the kind's folders: 12 listed card(s).
- Holds 98% of the repo cards its folders cover.
- Copies: `ac4725` Auxiliary Items, `0b410c` Auxiliary Items.
- Copies per card: 1× 59 cards.
- Missing repo cards (1): `Auxiliary/Items/The_Temple_of_Ahn'Qiraj.png`.
- Outside the kind's folders (12): `Items/Attack/2 Stars/Bomb.png`, `Items/Deploy/1 Stars/Poison_Circle.png`, `Items/Equip/2 Stars/Holy_Card.png`, `Items/Equip/3 Stars/Piko_Piko_Hammer.png`, `Items/Heal/1 Stars/Ingredient_Desert_Limes.png`, `Items/Heal/2 Stars/Ingredient_Gnome_Berries.png`, `Items/Heal/2 Stars/Ingredient_Icy_Sugar_Cubes.png`, `Items/Heal/2 Stars/Ingredient_Pineapple_Mint.png`, `Items/Heal/2 Stars/Pepperoni_Pizza.png`, `Items/Heal/3 Stars/Ingredient_Distillery_Dough.png`, `Items/Support/2 Stars/Gasoline.png`, `N.M.E/Rope.png`.

### `79fd59` Deck of Rejects

- Position: x 116.1, z 2.9; inside Bag 'Specific Item Decks' (position is stale).
- Cards: 7 (7 distinct); back: `MDW/cardback.png` 7; card scale: 3.0 (7).
- Folders: `MDW/The Morgue` 7.
- Rule: **The Morgue (retired cards) (hand-picked subset)**, folders `MDW/The Morgue/*.png`, count 1. Confidence **medium**: 58% of the rule's repo cards: a hand-picked subset, its own card list is the rule.
- Holds 58% of the repo cards its folders cover.
- Copies: none.
- Copies per card: 1× 7 cards.

## Bags

- `89b33d` Infinite_Bag 'Counters' at x 100.8, z -5.1 (table): holds Counter 1.
- `46f627` Infinite_Bag '.5' at x 100.8, z -2.9 (table): holds Custom_Tile 1.
- `479371` Infinite_Bag 'Max HP' at x 100.8, z -7.3 (table): holds CardCustom 1.
- `ef92ba` Infinite_Bag 'DEF' at x 100.8, z -9.5 (table): holds CardCustom 1.
- `de8e4a` Infinite_Bag 'ATK' at x 100.8, z -11.7 (table): holds CardCustom 1.
- `7962c9` Infinite_Bag 'SPD' at x 100.8, z -14.0 (table): holds CardCustom 1.
- `d9c4ac` Infinite_Bag 'SPD' at x 100.8, z 13.9 (table): holds CardCustom 1.
- `1b9ecf` Infinite_Bag '.5' at x 100.8, z 2.8 (table): holds Custom_Tile 1.
- `4591b4` Infinite_Bag 'Counters' at x 100.8, z 5.0 (table): holds Counter 1.
- `cf1305` Infinite_Bag 'Max HP' at x 100.8, z 7.2 (table): holds CardCustom 1.
- `eb5c28` Infinite_Bag 'DEF' at x 100.7, z 9.5 (table): holds CardCustom 1.
- `106068` Infinite_Bag 'ATK' at x 100.8, z 11.7 (table): holds CardCustom 1.
- `4a9f2e` Bag 'Creature Types' at x 106.9, z 12.1 (table): holds Custom_Token 19.
- `32092d` Bag 'Specific Item Decks' at x 106.9, z 14.9 (table): holds Deck 8.
- `b7abdb` Custom_Model_Bag 'Rulebooks' at x -101.2, z 1.1 (table): holds CardCustom 46.

Rulebooks bag: 46 loose page cards, 46 distinct images; repo has 48 rulebook PNGs.
- Repo pages not in the bag: `Auxiliary/Rulebook/0000_Cover.png`, `Auxiliary/Rulebook/0000_Cover_Book.png` (0000_Cover_Book.png is the bag's own texture).
- Bag pages not in the repo: none.
- Page backs: 46 of 46 pages use their own image as the back.
- Nicknames are 'Page N: Title' by design; they are not compared with website names.

Creature Types bag: 19 Custom_Token objects; repo has 91 PNGs in Types/ and Types/Stars/.
- Tokens: `Types/Defensive_Minion.png`, `Types/Girl.png`, `Types/Offensive_Minion.png`, `Types/Stars/Null Star.png`, `Types/Stars/star.png`, `Types/Wind.png`, `Types/dark.png`, `Types/darkmatter.png`, `Types/electric.png`, `Types/fire.png`, `Types/ice.png`, `Types/lightshadow.png`, `Types/machine.png`, `Types/null.png`, `Types/panda.png`, `Types/rock.png`, `Types/undead.png`, `Types/unknown.png`, `Types/water.png`.
- Types PNGs with no token (72): Attack, Counter, Deploy, Equip, Food, Fragile Equip, Infliction, NME, Negation, 6star, 7star, 8star, Crystal Star, Crystal Star PMTTYDNS icon, Diamond Star, Diamond Star PMTTYDNS icon, Dst Star, Elden Ring, Elden Stars, Emerald Star, Emerald Star PMTTYDNS icon, Faith, Fallen Star, Feather, Garnet Star, Garnet Star PMTTYDNS icon, Gold Star, Gold Star PMTTYDNS icon, Greed, Guild Seal, Hk star, Isaac No Circle, Lol star, Mario Star, Monkey D Star, Nebula Star, Nether Star, Ninja Star, Omori star, Patrick Star, REPO Orb, Ruby Star, Ruby Star PMTTYDNS icon, Sapphire Star PMTTYDNS icon, Sapphire Starold, Scrap, Silksong star, Solar Sun, Star of beth, Starstorm, Stuffed Star, The Poorly Drawn Barnstar, Thunderfury Blessed Blade Of The Starseeker, Triforce, Warpstar, YinYangUltra, bFables, bgold, bronze, isaac, nuke, silver, undertale, active, buff, buffstack, debuff, debuffstack, debuffupgrade, field, light, support.

Specific Item Decks bag: `79fd59` 'Deck of Rejects' (7 cards), `493fc7` '3 Star Equips' (0 cards), `82d617` '2 Star Equips' (0 cards), `452af0` '2 Star Attack Items' (0 cards), `280637` '2 Star Healing Items' (0 cards), `b1cb91` '4 Star Attack Items' (0 cards), `886307` '4 Star Equips' (0 cards), `89e02e` '1 Star Equips' (0 cards).

## Repo cards missing from each copy

Complete decks only (hand-picked decks are compared with their copies in the deck sections).

- `6ae2a9` ★★★ (creatures 3★): `Creatures/Isaac/3 Stars/Tainted_Lazarus.png`, `Creatures/Other/3 Stars/John_Ward.png`
- `ac2a14` ★★★ (creatures 3★): `Creatures/Isaac/3 Stars/Tainted_Lazarus.png`, `Creatures/Other/3 Stars/John_Ward.png`
- `cde2bc` ★★★★ (creatures 4★): `Creatures/Other/4 Stars/Militron.png`
- `8dc131` ★★★★ (creatures 4★): `Creatures/Other/4 Stars/Militron.png`
- `bc1e3f` ★★★★★ (creatures 5★): `Creatures/Other/5 Stars/Z!!!!!.png`
- `f05d89` ★★★★★ (creatures 5★): `Creatures/Other/5 Stars/Z!!!!!.png`
- `b53bbf` ★★★★ (fields 4★): `Field/4 Stars/The_Gates_of_Ahn'Qiraj.png`
- `36ee4c` ★★★★ (fields 4★): `Field/4 Stars/The_Gates_of_Ahn'Qiraj.png`
- `ed587f` Minions (minions, + Auxiliary/Creatures, +1 listed card(s)): `Auxiliary/Creatures/Militron_(No_Armor).png`, `Auxiliary/Minions/Anubisath_Guardian.png`, `Auxiliary/Minions/Qiraji_Soldier.png`, `Auxiliary/Minions/Silithid.png`
- `6e935f` Minions (minions, + Auxiliary/Creatures, +1 listed card(s)): `Auxiliary/Creatures/Militron_(No_Armor).png`, `Auxiliary/Minions/Anubisath_Guardian.png`, `Auxiliary/Minions/Qiraji_Soldier.png`, `Auxiliary/Minions/Silithid.png`
- `f8df22` Minions (minions, + Auxiliary/Creatures, +1 listed card(s)): `Auxiliary/Creatures/Militron_(No_Armor).png`, `Auxiliary/Minions/Anubisath_Guardian.png`, `Auxiliary/Minions/Qiraji_Soldier.png`, `Auxiliary/Minions/Silithid.png`
- `0b410c` Auxiliary Items (auxiliary items, +12 listed card(s)): `Auxiliary/Items/The_Temple_of_Ahn'Qiraj.png`
- `ac4725` Auxiliary Items (auxiliary items, +12 listed card(s)): `Auxiliary/Items/The_Temple_of_Ahn'Qiraj.png`
- `883c04` Auxiliary Items (auxiliary items, +12 listed card(s)): `Auxiliary/Items/The_Temple_of_Ahn'Qiraj.png`

## Images not in the repo

Report only (D5). Paths are the URL paths, decoded.

- `Creatures/Other/5 Stars/ZOEY!!!!!.png`: 6 ref(s), CardCustom `026c4f` 'ZOEY!!!!!', Deck `bc1e3f` '★★★★★', Deck `f05d89` '★★★★★', Deck `f33bd9` ''; on disk: False.

Odd links (not plain `main/`):

- `https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/refs/heads/main/Types/Girl.png` (file in HEAD: True): Custom_Token 517a18 'Girl' (ImageURL, in Bag 'Creature Types')
- `https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/refs/heads/main/Creatures/Other/4%20Stars/Militron.png` (file in HEAD: True): CardCustom a371af 'Militron' (FaceURL, in table)

External links (not the repo):

- Custom_Assetbundle '' AssetbundleURL: `https://steamusercontent-a.akamaihd.net/ugc/879750610978795929/723C50F43FAB3DE3DC12CB8460536E8CB34B60A3/` ×4
- Chinese_Checkers_Piece 'Flex Table Control' LuaScriptState (embedded): `https://i.imgur.com/eHXDjyy.jpg` ×1
- Chinese_Checkers_Piece 'Flex Table Control' LuaScriptState (embedded): `https://i.imgur.com/DbPelDi.jpg` ×1
- Chinese_Checkers_Piece 'Flex Table Control' LuaScriptState (embedded): `https://i.imgur.com/N0O6aqj.jpg` ×1
- Custom_Assetbundle '' AssetbundleURL: `https://steamusercontent-a.akamaihd.net/ugc/879750610978796471/14ED0DBD593370733A0309B0950004F33EB9FACA/` ×4
- Custom_Model_Bag 'Rulebooks' MeshURL: `http://pastebin.com/raw/mFbw0N0K` ×1
- Custom_Model '' MeshURL: `https://steamusercontent-a.akamaihd.net/ugc/879750610978796176/4A5A65543B98BCFBF57E910D06EC984208223D38/` ×1
- Global '' global script (embedded): `https://api.tabletopsimulator.com/ui/introUI/` ×1

## Cards in an unexpected deck

Cards whose path is outside the deck's kind folders. The rules keep them (`include`, or an extra folder glob); a copy that lacks one lists it as missing. See Needs a decision.

- `ed587f` Minions (minions, + Auxiliary/Creatures, +1 listed card(s)): `Auxiliary/Creatures/Azamoth_the_Possessed_Vessel.png` (extra folder), only here; `Auxiliary/Creatures/Igor_Roballtowski.png` (extra folder), only here; `Auxiliary/Creatures/Mettaton_EX.png` (extra folder), only here; `Auxiliary/Creatures/Mettaton_NEO.png` (extra folder), only here; `Auxiliary/Creatures/Morpho_Knight.png` (extra folder), only here; `Auxiliary/Creatures/Shadow_Queen.png` (extra folder), only here; `Creatures/Other/2 Stars/Stubborn_Queen.png` (listed), only here
- `6e935f` Minions (minions, + Auxiliary/Creatures, +1 listed card(s)): `Auxiliary/Creatures/Azamoth_the_Possessed_Vessel.png` (extra folder), only here; `Auxiliary/Creatures/Igor_Roballtowski.png` (extra folder), only here; `Auxiliary/Creatures/Mettaton_EX.png` (extra folder), only here; `Auxiliary/Creatures/Mettaton_NEO.png` (extra folder), only here; `Auxiliary/Creatures/Morpho_Knight.png` (extra folder), only here; `Auxiliary/Creatures/Shadow_Queen.png` (extra folder), only here; `Creatures/Other/2 Stars/Stubborn_Queen.png` (listed), only here
- `f8df22` Minions (minions, + Auxiliary/Creatures, +1 listed card(s)): `Auxiliary/Creatures/Azamoth_the_Possessed_Vessel.png` (extra folder), only here; `Auxiliary/Creatures/Igor_Roballtowski.png` (extra folder), only here; `Auxiliary/Creatures/Mettaton_EX.png` (extra folder), only here; `Auxiliary/Creatures/Mettaton_NEO.png` (extra folder), only here; `Auxiliary/Creatures/Morpho_Knight.png` (extra folder), only here; `Auxiliary/Creatures/Shadow_Queen.png` (extra folder), only here; `Creatures/Other/2 Stars/Stubborn_Queen.png` (listed), only here
- `0b410c` Auxiliary Items (auxiliary items, +12 listed card(s)): `Items/Attack/2 Stars/Bomb.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Deploy/1 Stars/Poison_Circle.png` (listed), also `8fb88d` ★ (Items), `42909d` ★ (Items Copy); `Items/Equip/2 Stars/Holy_Card.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Equip/3 Stars/Piko_Piko_Hammer.png` (listed), only here; `Items/Heal/1 Stars/Ingredient_Desert_Limes.png` (listed), also `8fb88d` ★ (Items), `42909d` ★ (Items Copy); `Items/Heal/2 Stars/Ingredient_Gnome_Berries.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/2 Stars/Ingredient_Icy_Sugar_Cubes.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/2 Stars/Ingredient_Pineapple_Mint.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/2 Stars/Pepperoni_Pizza.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/3 Stars/Ingredient_Distillery_Dough.png` (listed), also `213c84` ★★★ (Items), `abb81f` ★★★ (Items Copy), `b630d6` ★★★ (Items Simple Version); `Items/Support/2 Stars/Gasoline.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `N.M.E/Rope.png` (listed), also `d3995a` N.M.E. Deck (N.M.E Items), `444f1f` N.M.E. Deck (N.M.E. Items Copy)
- `ac4725` Auxiliary Items (auxiliary items, +12 listed card(s)): `Items/Attack/2 Stars/Bomb.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Deploy/1 Stars/Poison_Circle.png` (listed), also `8fb88d` ★ (Items), `42909d` ★ (Items Copy); `Items/Equip/2 Stars/Holy_Card.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Equip/3 Stars/Piko_Piko_Hammer.png` (listed), only here; `Items/Heal/1 Stars/Ingredient_Desert_Limes.png` (listed), also `8fb88d` ★ (Items), `42909d` ★ (Items Copy); `Items/Heal/2 Stars/Ingredient_Gnome_Berries.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/2 Stars/Ingredient_Icy_Sugar_Cubes.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/2 Stars/Ingredient_Pineapple_Mint.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/2 Stars/Pepperoni_Pizza.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/3 Stars/Ingredient_Distillery_Dough.png` (listed), also `213c84` ★★★ (Items), `abb81f` ★★★ (Items Copy), `b630d6` ★★★ (Items Simple Version); `Items/Support/2 Stars/Gasoline.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `N.M.E/Rope.png` (listed), also `d3995a` N.M.E. Deck (N.M.E Items), `444f1f` N.M.E. Deck (N.M.E. Items Copy)
- `883c04` Auxiliary Items (auxiliary items, +12 listed card(s)): `Items/Attack/2 Stars/Bomb.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Deploy/1 Stars/Poison_Circle.png` (listed), also `8fb88d` ★ (Items), `42909d` ★ (Items Copy); `Items/Equip/2 Stars/Holy_Card.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Equip/3 Stars/Piko_Piko_Hammer.png` (listed), only here; `Items/Heal/1 Stars/Ingredient_Desert_Limes.png` (listed), also `8fb88d` ★ (Items), `42909d` ★ (Items Copy); `Items/Heal/2 Stars/Ingredient_Gnome_Berries.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/2 Stars/Ingredient_Icy_Sugar_Cubes.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/2 Stars/Ingredient_Pineapple_Mint.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/2 Stars/Pepperoni_Pizza.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `Items/Heal/3 Stars/Ingredient_Distillery_Dough.png` (listed), also `213c84` ★★★ (Items), `abb81f` ★★★ (Items Copy), `b630d6` ★★★ (Items Simple Version); `Items/Support/2 Stars/Gasoline.png` (listed), also `c86c21` ★★ (Items Simple Version), `a7e1aa` ★★ (Items), `7cdb04` ★★ (Items Copy); `N.M.E/Rope.png` (listed), also `d3995a` N.M.E. Deck (N.M.E Items), `444f1f` N.M.E. Deck (N.M.E. Items Copy)

## Nickname vs website name

Website name, as build_site.py: a `MDW/Card Edits.json` rename (0 entries now), else the built site's name (`site/dist/data/cards.json`, 773 cards), else the stem of the PSD beside the PNG (a parsed card is keyed by its PSD: `Abbi.png` + `ABBI.psd` = 'ABBI'), else the PNG stem; _ as spaces. 764 of the 765 images compared are named by cards.json. Counted per (image, Nickname) pair; rulebook pages, markers and The Morgue excluded.

- Pairs compared: 767 (2333 card objects); mismatches: 84 (33 different, 51 case/spacing/punctuation only).
- Empty Nicknames: 0 objects on 0 images.

| Image | Nickname | Website name | Objects | Kind |
|---|---|---|---|---|
| `Auxiliary/Items/Ingredient_Wondertart.png` | Wondertart | Ingredient Wondertart | 3 | different |
| `Auxiliary/Minions/Clot_Black.png` | Black Clot | Clot Black | 3 | different |
| `Auxiliary/Minions/Clot_Blood.png` | Blood Clot | Clot Blood | 3 | different |
| `Auxiliary/Minions/Clot_Bone.png` | Bone Clot | Clot Bone | 3 | different |
| `Auxiliary/Minions/Clot_Gold.png` | Gold Clot | Clot Gold | 3 | different |
| `Auxiliary/Minions/Clot_White.png` | White Clot | Clot White | 3 | different |
| `Auxiliary/Minions/PoD01Red_Bloon.png` | Red Bloon | PoD01Red Bloon | 3 | different |
| `Auxiliary/Minions/PoD02Black_Bloon.png` | Black Bloon | PoD02Black Bloon | 3 | different |
| `Auxiliary/Minions/PoD03White_Bloon.png` | White Bloon | PoD03White Bloon | 3 | different |
| `Auxiliary/Minions/PoD04Zebra_Bloon.png` | Zebra Bloon | PoD04Zebra Bloon | 3 | different |
| `Auxiliary/Minions/PoD05Lead_Bloon.png` | Lead Bloon | PoD05Lead Bloon | 3 | different |
| `Auxiliary/Minions/PoD06Rainbow_Bloon.png` | Rainbow Bloon | PoD06Rainbow Bloon | 3 | different |
| `Auxiliary/Minions/PoD07Ceramic_Bloon.png` | Ceramic Bloon | PoD07Ceramic Bloon | 3 | different |
| `Auxiliary/Minions/PoD08MOAB.png` | M.O.A.B. | PoD08MOAB | 3 | different |
| `Auxiliary/Minions/PoD09DDT.png` | D.D.T. | PoD09DDT | 3 | different |
| `Auxiliary/Minions/PoD10BFB.png` | B.F.B. | PoD10BFB | 3 | different |
| `Auxiliary/Minions/PoD11ZOMG.png` | Z.O.M.G. | PoD11ZOMG | 3 | different |
| `Auxiliary/Minions/PoD12BAD.png` | B.A.D. | PoD12BAD | 3 | different |
| `Creatures/Kirby/5 Stars/Crowned_Magolor.png` | Crowned Magalor | Crowned Magolor | 1 | different |
| `Creatures/Mario/3 Stars/Raw_Cock.png` | Raw Kawk | Raw Cock | 2 | different |
| `Creatures/Other/5 Stars/Kyle.png` | hdckighfkvhvgmk | Kyle | 2 | different |
| `Creatures/Undertale/3 Stars/Papyrus.png` | The Great Papyrus | Papyrus | 3 | different |
| `Creatures/Undertale/5 Stars/Sans.png` | snas. | Sans | 3 | different |
| `Items/Equip/4 Stars/Thunderfury_Blessed_Blade_of_the_Windseeker.png` | Thunderfury: Blessed Blade of the Windseeker | Thunderfury Blessed Blade of the Windseeker | 2 | different |
| `Items/Heal/1 Stars/Ingredient_Desert_Limes.png` | Desert Limes | Ingredient Desert Limes | 5 | different |
| `Items/Heal/2 Stars/Ingredient_Gnome_Berries.png` | Gnome Berries | Ingredient Gnome Berries | 6 | different |
| `Items/Heal/2 Stars/Ingredient_Icy_Sugar_Cubes.png` | Icy Sugar Cubes | Ingredient Icy Sugar Cubes | 6 | different |
| `Items/Heal/2 Stars/Ingredient_Pineapple_Mint.png` | Pineapple Mint | Ingredient Pineapple Mint | 6 | different |
| `Items/Heal/2 Stars/Watermelon2.png` | Watermelon | Inconspicuous Watermelon | 2 | different (duplicate PNG) |
| `Items/Heal/3 Stars/Ingredient_Distillery_Dough.png` | Distillery Dough | Ingredient Distillery Dough | 6 | different |
| `Items/Support/2 Stars/Gust_of_Wind.png` | Gust of Trees | Gust of Wind | 1 | different |
| `Items/Support/2 Stars/NME_Stock.png` | NME Stock™ | NME Stock | 3 | different |
| `Items/Support/2 Stars/NME_Stock2.png` | NME Stock™ | NME Stock | 3 | different (duplicate PNG) |
| `Auxiliary/Creatures/Azamoth_the_Possessed_Vessel.png` | Azamoth The Possessed Vessel | Azamoth the Possessed Vessel | 3 | case/spacing/punctuation only |
| `Auxiliary/Items/Unbreakable_heart.png` | Unbreakable Heart | Unbreakable heart | 3 | case/spacing/punctuation only |
| `Auxiliary/Minions/Jack-In-The-Box_Zombie.png` | Jack-in-the-box Zombie | Jack-In-The-Box Zombie | 3 | case/spacing/punctuation only |
| `Auxiliary/Minions/Spawn_of_the_Forbidden_One.png` | Spawn of The Forbidden One | Spawn of the Forbidden One | 3 | case/spacing/punctuation only |
| `Creatures/BTD/4 Stars/Avatar_Of_Wrath.png` | Avatar of Wrath | Avatar Of Wrath | 3 | case/spacing/punctuation only |
| `Creatures/BTD/5 Stars/Prince_Of_Darkness.png` | Prince of Darkness | Prince Of Darkness | 2 | case/spacing/punctuation only |
| `Creatures/Everhood/2 Stars/Knight_Lost_A_Lot.png` | Knight Lost a Lot | Knight Lost A Lot | 3 | case/spacing/punctuation only |
| `Creatures/Kirby/3 Stars/Dark_Matter.png` | Dark Matter | Dark matter | 3 | case/spacing/punctuation only |
| `Creatures/Kirby/4 Stars/Grand_Doomer.png` | Grand Doomer | grand doomer | 3 | case/spacing/punctuation only |
| `Creatures/Kirby/4 Stars/HR-H.png` | HR-H | hr-h | 3 | case/spacing/punctuation only |
| `Creatures/Mario/2 Stars/Ms_Mowz.png` | Ms. Mowz | Ms Mowz | 3 | case/spacing/punctuation only |
| `Creatures/Mario/4 Stars/DooPliss.png` | Doopliss | DooPliss | 3 | case/spacing/punctuation only |
| `Creatures/Monkey D Folder/2 Stars/Mol_D_Truffy.png` | Mol D. Truffy | Mol D Truffy | 3 | case/spacing/punctuation only |
| `Creatures/Monkey D Folder/2 Stars/Monkey_D_Pression.png` | Monkey D. Pression | Monkey D Pression | 3 | case/spacing/punctuation only |
| `Creatures/Monkey D Folder/2 Stars/Whippy_D_Cream.png` | Whippy D. Cream | Whippy D Cream | 3 | case/spacing/punctuation only |
| `Creatures/Monkey D Folder/3 Stars/Monkey_D_Letion.png` | Monkey D. Letion | Monkey D Letion | 3 | case/spacing/punctuation only |
| `Creatures/Monkey D Folder/3 Stars/Pan_D_Luffy.png` | Pan D. Luffy | Pan D Luffy | 3 | case/spacing/punctuation only |
| `Creatures/Monkey D Folder/3 Stars/Wokey_D_pronouns.png` | Wokey D. Pronouns | Wokey D pronouns | 3 | case/spacing/punctuation only |
| `Creatures/Monkey D Folder/4 Stars/Funky_D_Luffy.png` | Funky D. Luffy | Funky D Luffy | 3 | case/spacing/punctuation only |
| `Creatures/Monkey D Folder/4 Stars/Monkey_D_Goofy.png` | Monkey D. Goofy | Monkey D Goofy | 3 | case/spacing/punctuation only |
| `Creatures/Monkey D Folder/4 Stars/Monkey_D_Vour.png` | Monkey D. Vour | Monkey D Vour | 3 | case/spacing/punctuation only |
| `Creatures/Omori/3 Stars/Mr_Jawsum.png` | Mr. Jawsum | Mr Jawsum | 2 | case/spacing/punctuation only |
| `Creatures/Omori/3 Stars/SOMETHING.png` | Something | SOMETHING | 3 | case/spacing/punctuation only |
| `Creatures/Omori/5 Stars/Omori.png` | OMORI | omori | 3 | case/spacing/punctuation only |
| `Creatures/Other/4 Stars/Mr_Krabs.png` | Mr. Krabs | Mr Krabs | 3 | case/spacing/punctuation only |
| `Creatures/Pandas/3 Stars/P.A.N.D.A._Mk_A.png` | P.A.N.D.A. MK A | P.A.N.D.A. Mk A | 4 | case/spacing/punctuation only |
| `Creatures/Pandas/3 Stars/P.A.N.D.A._Mk_F.png` | P.A.N.D.A. MK F | P.A.N.D.A. Mk F | 4 | case/spacing/punctuation only |
| `Creatures/Pandas/3 Stars/P.A.N.D.A._Mk_T.png` | P.A.N.D.A. MK T | P.A.N.D.A. Mk T | 4 | case/spacing/punctuation only |
| `Creatures/Pandas/3 Stars/Project_P.A.N.D.A.png` | Project P.A.N.D.A. | Project P.A.N.D.A | 2 | case/spacing/punctuation only |
| `Creatures/ROTMG/4 Stars/Oryx_the_Exalted_God.png` | Oryx The Exalted God | Oryx the Exalted God | 2 | case/spacing/punctuation only |
| `Creatures/ROTMG/5 Stars/Azamoth_the_Forgotten_King.png` | Azamoth The Forgotten King | Azamoth the Forgotten King | 3 | case/spacing/punctuation only |
| `Field/2 Stars/Stingy's_Floor_And_Ceiling.png` | Stingy's Floor and Ceiling | Stingy's Floor And Ceiling | 2 | case/spacing/punctuation only |
| `Field/3 Stars/Colosseum_Of_Fools.png` | Colosseum of Fools | Colosseum Of Fools | 2 | case/spacing/punctuation only |
| `Field/4 Stars/Cave_Of_The_Past.png` | Cave of The Past | Cave Of The Past | 2 | case/spacing/punctuation only |
| `Items/Counter/4 Stars/Return_To_Sender.png` | Return to Sender | Return To Sender | 3 | case/spacing/punctuation only |
| `Items/Equip/1 Stars/GrubSong.png` | Grubsong | GrubSong | 3 | case/spacing/punctuation only |
| `Items/Equip/2 Stars/SpiralHorn_Shield.png` | Spiralhorn Shield | SpiralHorn Shield | 3 | case/spacing/punctuation only |
| `Items/Equip/2 Stars/Thorns_Of_Agony.png` | Thorns of Agony | Thorns Of Agony | 3 | case/spacing/punctuation only |
| `Items/Equip/3 Stars/Charm_Of_The_Vampire.png` | Charm of the Vampire | Charm Of The Vampire | 3 | case/spacing/punctuation only |
| `Items/Equip/3 Stars/steam_sale.png` | Steam Sale | steam sale | 2 | case/spacing/punctuation only |
| `Items/Heal/2 Stars/All_Purpose_Medical_Kit.png` | All-Purpose Medical Kit | All Purpose Medical Kit | 3 | case/spacing/punctuation only |
| `Items/Heal/2 Stars/All_Purpose_Medical_Kit2.png` | All-Purpose Medical Kit | All Purpose Medical Kit | 3 | case/spacing/punctuation only (duplicate PNG) |
| `Items/Heal/2 Stars/The_Chicken.png` | The Chicken  | The Chicken | 6 | case/spacing/punctuation only |
| `Items/Heal/3 Stars/Bucket_Of_Lard.png` | Bucket of Lard | Bucket Of Lard | 3 | case/spacing/punctuation only |
| `Items/Heal/4 Stars/Zess_T_Deluxe.png` | Zess T. Deluxe | Zess T Deluxe | 3 | case/spacing/punctuation only |
| `Items/Infliction/2 Stars/Mr_Softener.png` | Mr. Softener | Mr Softener | 6 | case/spacing/punctuation only |
| `Items/Infliction/3 Stars/Flower_Of_Decay.png` | Flower of Decay | Flower Of Decay | 3 | case/spacing/punctuation only |
| `Items/Support/1 Stars/Dr_Robotnik's_Roboticizer.png` | Dr. Robotnik's Roboticizer | Dr Robotnik's Roboticizer | 6 | case/spacing/punctuation only |
| `N.M.E/How_To_Jump.png` | How to Jump | How To Jump | 2 | case/spacing/punctuation only |
| `N.M.E/Sigil_of_Divinity.png` | Sigil Of Divinity | Sigil of Divinity | 2 | case/spacing/punctuation only |
| `N.M.E/chuckya.png` | Chuckya | chuckya | 2 | case/spacing/punctuation only |

## Backs

Majority back per kind (deck, bag and loose cards):

- auxiliary creatures (large cards): `MDW/cardback.png` 18
- auxiliary items: `MDW/cardback_item.png` 141
- creatures: `MDW/cardback.png` 836
- fields: `MDW/cardback_item.png` 98
- items: `MDW/cardback_item.png` 729
- minions: `MDW/cardback.png` 264
- The Morgue (retired cards): `MDW/cardback.png` 7
- N.M.E: `MDW/cardback_item.png` 55
- status effects: `MDW/cardback_statuseffect.png` 192

Minority (wrong) backs: none.

Not cards for this check: marker cards (back = the minus marker), rulebook pages (see Bags).

## Duplicates

Within one deck: the same image under more than one CustomDeck id, or one Nickname on several images. (Several copies of one card under one id is the normal layout; per-deck copy counts are in the deck sections.)

- `8fb88d` ★: image under several deck ids: Items/Equip/1 Stars/Shellphone.png -> 1500, 1565
- `42909d` ★: image under several deck ids: Items/Equip/1 Stars/Shellphone.png -> 1500, 1565
- `a7e1aa` ★★: image under several deck ids: Items/Attack/2 Stars/Firebomb.png -> 1530, 1531
- `a7e1aa` ★★: one Nickname, several images: All-Purpose Medical Kit -> Items/Heal/2 Stars/All_Purpose_Medical_Kit.png, Items/Heal/2 Stars/All_Purpose_Medical_Kit2.png
- `a7e1aa` ★★: one Nickname, several images: Watermelon -> Items/Heal/2 Stars/Watermelon.png, Items/Heal/2 Stars/Watermelon2.png
- `a7e1aa` ★★: one Nickname, several images: NME Stock™ -> Items/Support/2 Stars/NME_Stock.png, Items/Support/2 Stars/NME_Stock2.png
- `7cdb04` ★★: image under several deck ids: Items/Attack/2 Stars/Firebomb.png -> 1530, 1531
- `7cdb04` ★★: one Nickname, several images: All-Purpose Medical Kit -> Items/Heal/2 Stars/All_Purpose_Medical_Kit.png, Items/Heal/2 Stars/All_Purpose_Medical_Kit2.png
- `7cdb04` ★★: one Nickname, several images: Watermelon -> Items/Heal/2 Stars/Watermelon.png, Items/Heal/2 Stars/Watermelon2.png
- `7cdb04` ★★: one Nickname, several images: NME Stock™ -> Items/Support/2 Stars/NME_Stock.png, Items/Support/2 Stars/NME_Stock2.png
- `c86c21` ★★: image under several deck ids: Items/Attack/2 Stars/Firebomb.png -> 1547, 1548
- `c86c21` ★★: one Nickname, several images: Gust of Trees -> Items/Support/2 Stars/Gust_of_Trees.png, Items/Support/2 Stars/Gust_of_Wind.png
- `c86c21` ★★: one Nickname, several images: All-Purpose Medical Kit -> Items/Heal/2 Stars/All_Purpose_Medical_Kit.png, Items/Heal/2 Stars/All_Purpose_Medical_Kit2.png
- `c86c21` ★★: one Nickname, several images: NME Stock™ -> Items/Support/2 Stars/NME_Stock.png, Items/Support/2 Stars/NME_Stock2.png
- `213c84` ★★★: image under several deck ids: Items/Heal/3 Stars/Maxim_Tomato.png -> 1532, 1533, 1534
- `abb81f` ★★★: image under several deck ids: Items/Heal/3 Stars/Maxim_Tomato.png -> 1532, 1533, 1534
- `b630d6` ★★★: image under several deck ids: Items/Heal/3 Stars/Maxim_Tomato.png -> 1549, 1550, 1551

One image with different Nicknames across the save:

- `Creatures/Kirby/5 Stars/Crowned_Magolor.png`: 'Crowned Magalor' ×1, 'Crowned Magolor' ×2
- `Items/Support/2 Stars/Gust_of_Wind.png`: 'Gust of Trees' ×1, 'Gust of Wind' ×4

Cards whose copy count differs from their deck's usual count (complete decks):

- `8fb88d` ★ (usual 2): Poison Trap ×1, Boko Club ×1, Bone's Loans ×1, GrubSong ×1, Lazy Worm ×1, Leaf Shield ×1, Pillow ×1, Steady Body ×1, Ingredient Desert Limes ×1
- `42909d` ★ (usual 2): Poison Trap ×1, Boko Club ×1, Bone's Loans ×1, GrubSong ×1, Lazy Worm ×1, Leaf Shield ×1, Pillow ×1, Steady Body ×1, Ingredient Desert Limes ×1
- `a7e1aa` ★★ (usual 1): Bomb ×3, Firebomb ×2, Ice Bomb ×2, Stone Spikes ×2, Basic Shield ×3, Holy Card ×2, Iron Sword ×2, Tomorrow I'll ×2, Grapes ×2, Mushroom ×2, Pep Drink ×3, Pepperoni Pizza ×2, Regeneration Potion ×2, The Chicken ×2, Watermelon ×2, Bag of Evil ×2, Mr Softener ×2, Metronome ×5, Stopwatch ×5, Gust of Trees ×2, Gust of Wind ×2
- `7cdb04` ★★ (usual 1): Bomb ×3, Firebomb ×2, Ice Bomb ×2, Stone Spikes ×2, Basic Shield ×3, Holy Card ×2, Iron Sword ×2, Tomorrow I'll ×2, Grapes ×2, Mushroom ×2, Pep Drink ×3, Pepperoni Pizza ×2, Regeneration Potion ×2, The Chicken ×2, Watermelon ×2, Bag of Evil ×2, Mr Softener ×2, Metronome ×5, Stopwatch ×5, Gust of Trees ×2, Gust of Wind ×2
- `213c84` ★★★ (usual 1): Big Bomb ×3, Blood Bomb ×2, Burly Bomb ×2, Fireball ×2, Lightning Bolt ×2, POW Block ×2, Shooting Star ×2, Iron Spikes ×2, Metal Shield ×2, Titanium Sword ×2, Dumplings ×2, Feast ×2, Healing Ritual ×2, Life Shroom ×2, Maxim Tomato ×3, Squash Candy ×2, Super Shroom ×2, Ancient Stopwatch ×2
- `abb81f` ★★★ (usual 1): Big Bomb ×3, Blood Bomb ×2, Burly Bomb ×2, Fireball ×2, Lightning Bolt ×2, POW Block ×2, Shooting Star ×2, Iron Spikes ×2, Metal Shield ×2, Titanium Sword ×2, Dumplings ×2, Feast ×2, Healing Ritual ×2, Life Shroom ×2, Maxim Tomato ×3, Squash Candy ×2, Super Shroom ×2, Ancient Stopwatch ×2

## Large cards (Lua resizeTargets vs Auxiliary/Creatures)

Lua keys (6): 'Azamoth The Possessed Vessel', 'Igor Roballtowski', 'Mettaton EX', 'Mettaton NEO', 'Morpho Knight', 'Shadow Queen'. Keyed by Nickname, case-sensitive.

| PNG | Website name | Nicknames in the save | In Lua |
|---|---|---|---|
| `Auxiliary/Creatures/Azamoth_the_Possessed_Vessel.png` | Azamoth the Possessed Vessel | Azamoth The Possessed Vessel | yes |
| `Auxiliary/Creatures/Igor_Roballtowski.png` | Igor Roballtowski | Igor Roballtowski | yes |
| `Auxiliary/Creatures/Mettaton_EX.png` | Mettaton EX | Mettaton EX | yes |
| `Auxiliary/Creatures/Mettaton_NEO.png` | Mettaton NEO | Mettaton NEO | yes |
| `Auxiliary/Creatures/Militron_(No_Armor).png` | Militron (No Armor) | **not in the save** | **no** |
| `Auxiliary/Creatures/Morpho_Knight.png` | Morpho Knight | Morpho Knight | yes |
| `Auxiliary/Creatures/Shadow_Queen.png` | Shadow Queen | Shadow Queen | yes |

- Lua keys with no Auxiliary/Creatures PNG: none.
- Auxiliary/Creatures PNGs not in Lua: Militron (No Armor).

## Loose cards on the table

- `a371af` 'Militron' at x 115.5, z -24.8 on 'Penalty Box Creatures': `https://raw.githubusercontent.com/MichaelJSr/TTSCardMaker/refs/heads/main/Creatures/Other/4%20Stars/Militron.png` (in HEAD: True)

## Non-card images

Every image on objects that are not deck/loose cards: tiles, tokens, board, model, bag, marker cards (Infinite_Bags), rulebook pages, and URLs embedded in scripts.

| Image | In HEAD | On disk | Used by |
|---|---|---|---|
| `https://steamusercontent-a.akamaihd.net/ugc/879750610978795929/723C50F43FAB3DE3DC12CB8460536E8CB34B60A3/` | - | - | Custom_Assetbundle '' ×4 (AssetbundleURL) |
| `https://i.imgur.com/eHXDjyy.jpg` | - | - | Chinese_Checkers_Piece 'Flex Table Control' ×1 (LuaScriptState (embedded)) |
| `https://i.imgur.com/DbPelDi.jpg` | - | - | Chinese_Checkers_Piece 'Flex Table Control' ×1 (LuaScriptState (embedded)) |
| `https://i.imgur.com/N0O6aqj.jpg` | - | - | Chinese_Checkers_Piece 'Flex Table Control' ×1 (LuaScriptState (embedded)) |
| `MDW/cardback.png` | True | True | Chinese_Checkers_Piece 'Flex Table Control' ×1 (LuaScriptState (embedded)) |
| `MDW/Holders/.5 Holder.jpg` | True | True | Custom_Tile 'All Status Effects' ×2; Custom_Tile 'Auxiliary Items' ×2; Custom_Tile 'Minions' ×2; Chinese_Checkers_Piece 'Flex Table Control' ×1; Custom_Tile 'Status Effects Copy' ×1; Custom_Tile 'Minions Copy' ×1; Custom_Tile 'Auxiliary Items Copy' ×1 (ImageURL, LuaScriptState (embedded)) |
| `https://steamusercontent-a.akamaihd.net/ugc/879750610978796471/14ED0DBD593370733A0309B0950004F33EB9FACA/` | - | - | Custom_Assetbundle '' ×4 (AssetbundleURL) |
| `Auxiliary/Markers/Green.png` | True | True | Custom_Tile '' ×36; Custom_Tile '' in .5 ×2 (ImageURL) |
| `Auxiliary/Markers/Red.png` | True | True | Custom_Tile '' ×36; Custom_Tile '' in .5 ×2 (ImageSecondaryURL) |
| `Auxiliary/Markers/health_marker.png` | True | True | CardCustom 'HP' in Max HP ×2 (FaceURL) |
| `Auxiliary/Markers/minus_health_marker.png` | True | True | CardCustom 'HP' in Max HP ×2 (BackURL) |
| `Auxiliary/Markers/defense_marker.png` | True | True | CardCustom 'DEF' in DEF ×2 (FaceURL) |
| `Auxiliary/Markers/minus_defense_marker.png` | True | True | CardCustom 'DEF' in DEF ×2 (BackURL) |
| `Auxiliary/Markers/attack_marker.png` | True | True | CardCustom 'ATK' in ATK ×2 (FaceURL) |
| `Auxiliary/Markers/minus_attack_marker.png` | True | True | CardCustom 'ATK' in ATK ×2 (BackURL) |
| `Auxiliary/Markers/speed_marker.png` | True | True | CardCustom 'SPD' in SPD ×2 (FaceURL) |
| `Auxiliary/Markers/minus_speed_marker.png` | True | True | CardCustom 'SPD' in SPD ×2 (BackURL) |
| `MDW/Holders/Discard.png` | True | True | Custom_Tile 'Discard Pile' ×1; Custom_Tile 'Penalty Box Items' ×1 (ImageURL) |
| `MDW/Holders/Field.png` | True | True | Custom_Tile 'Field Item Holder' ×2 (ImageURL) |
| `MDW/Holders/Item.png` | True | True | Custom_Tile 'Item Holder' ×12; Custom_Tile 'N.M.E Items' ×1; Custom_Tile 'N.M.E. Items Copy' ×1 (ImageSecondaryURL, ImageURL) |
| `MDW/Holders/Graveyard.png` | True | True | Custom_Tile 'Graveyard' ×2; Custom_Tile 'Penalty Box Creatures' ×1 (ImageURL) |
| `MDW/Holders/Creature_Deck.png` | True | True | Custom_Tile 'Creatures' ×1; Custom_Tile 'Creatures Copy' ×1; Custom_Tile 'Creatures Developer Version' ×1; Custom_Tile 'Baseline Creatures' ×1; Custom_Tile 'Creatures Simple Version' ×1 (ImageURL) |
| `MDW/Holders/Field_Deck.png` | True | True | Custom_Tile 'Field Items' ×1; Custom_Tile 'Field Items Copy' ×1 (ImageURL) |
| `MDW/Holders/Item_Deck.png` | True | True | Custom_Tile 'Items' ×1; Custom_Tile 'Items Copy' ×1; Custom_Tile 'Items Simple Version' ×1 (ImageURL) |
| `MDW/Raid_Boss_Table_Top.png` | True | True | Custom_Board '' ×1 (ImageURL) |
| `MDW/Holders/Active.png` | True | True | Custom_Token 'Active Holder' ×2 (ImageURL) |
| `Types/Offensive_Minion.png` | True | True | Custom_Token 'Offensive Minion' in Creature Types ×1 (ImageURL) |
| `Types/Defensive_Minion.png` | True | True | Custom_Token 'Defensive Minion' in Creature Types ×1 (ImageURL) |
| `Types/machine.png` | True | True | Custom_Token 'Machine' in Creature Types ×1 (ImageURL) |
| `Types/Wind.png` | True | True | Custom_Token 'Wind' in Creature Types ×1 (ImageURL) |
| `Types/rock.png` | True | True | Custom_Token 'Rock' in Creature Types ×1 (ImageURL) |
| `Types/panda.png` | True | True | Custom_Token 'Panda' in Creature Types ×1 (ImageURL) |
| `Types/fire.png` | True | True | Custom_Token 'Fire' in Creature Types ×1 (ImageURL) |
| `Types/ice.png` | True | True | Custom_Token 'Ice' in Creature Types ×1 (ImageURL) |
| `Types/water.png` | True | True | Custom_Token 'Water' in Creature Types ×1 (ImageURL) |
| `Types/electric.png` | True | True | Custom_Token 'Electric' in Creature Types ×1 (ImageURL) |
| `Types/undead.png` | True | True | Custom_Token 'Undead' in Creature Types ×1 (ImageURL) |
| `Types/dark.png` | True | True | Custom_Token 'Dark' in Creature Types ×1 (ImageURL) |
| `Types/lightshadow.png` | True | True | Custom_Token 'Light' in Creature Types ×1 (ImageURL) |
| `Types/darkmatter.png` | True | True | Custom_Token 'Dark Matter' in Creature Types ×1 (ImageURL) |
| `Types/unknown.png` | True | True | Custom_Token 'Unknown' in Creature Types ×1 (ImageURL) |
| `Types/Girl.png` | True | True | Custom_Token 'Girl' in Creature Types ×1 (ImageURL) |
| `Types/null.png` | True | True | Custom_Token 'No Type' in Creature Types ×1 (ImageURL) |
| `Types/Stars/star.png` | True | True | Custom_Token 'Star' in Creature Types ×1 (ImageURL) |
| `Types/Stars/Null Star.png` | True | True | Custom_Token 'No Star' in Creature Types ×1 (ImageURL) |
| `MDW/Holders/Creature_Full.png` | True | True | Custom_Tile 'Creature Holder' ×6 (ImageURL) |
| `MDW/Holders/Minion_Full.png` | True | True | Custom_Tile 'Minion Holder' ×2 (ImageURL) |
| `MDW/Holders/Shop_Item.png` | True | True | Custom_Tile 'Item Shop' ×1 (ImageURL) |
| `MDW/Holders/Shop_Field.png` | True | True | Custom_Tile 'Field Shop' ×1 (ImageURL) |
| `MDW/Holders/Shop_NME.png` | True | True | Custom_Tile 'N.M.E. Shop' ×1 (ImageURL) |
| `MDW/Holders/NME.png` | True | True | Custom_Tile 'N.M.E Items' ×1; Custom_Tile 'N.M.E. Items Copy' ×1 (ImageURL) |
| `http://pastebin.com/raw/mFbw0N0K` | - | - | Custom_Model_Bag 'Rulebooks' ×1 (MeshURL) |
| `Auxiliary/Rulebook/0000_Cover_Book.png` | True | True | Custom_Model_Bag 'Rulebooks' ×1 (DiffuseURL) |
| 46 rulebook page images `Auxiliary/Rulebook/*.png` | True | True | 92 CardCustom in Rulebooks |
| `https://steamusercontent-a.akamaihd.net/ugc/879750610978796176/4A5A65543B98BCFBF57E910D06EC984208223D38/` | - | - | Custom_Model '' ×1 (MeshURL) |
| `MDW/DbPelDi.jpeg` | True | True | Custom_Model '' ×1 (DiffuseURL) |
| `https://api.tabletopsimulator.com/ui/introUI/` | - | - | Global '' ×1 (global script (embedded)) |

Objects with no image: Counter 45, HandTrigger 16, Infinite_Bag 12, BlockSquare 6, Bag 2, Quarter 1, Die_6_Rounded 1, go_game_bowl_white 1, go_game_bowl_black 1.

## Militron

- `cdcb58` 'Militron' `Creatures/Other/4 Stars/Militron.png` (main) in `2a34b2` Deck '★★★★' (near 'Creatures Simple Version')
- `a371af` 'Militron' `Creatures/Other/4 Stars/Militron.png` (refs/heads/main) in table at (115.5, -24.8) on 'Penalty Box Creatures'
- Repo: `Auxiliary/Creatures/Militron_(No_Armor).png`, `Creatures/Other/4 Stars/Militron.png`.
- 4★ creature decks: `2a34b2` has it (subset), `cde2bc` lacks it, `bdb082` lacks it (subset), `888cba` lacks it (subset), `8dc131` lacks it.
- Militron (No Armor): in the save: no; in Lua resizeTargets: no; the Minions decks hold the other 6 Auxiliary/Creatures cards.
- The loose Militron sits on the 'Penalty Box Creatures' tile; its link is refs/heads/main while the deck copy's is main, so it was made separately. Only the simple-version 4★ deck holds Militron; the complete 4★ decks list it as missing.

## Repo vs disk

HEAD vs files on disk under Auxiliary, Creatures, Field, Items, N.M.E, Types, MDW, TTS (.DS_Store ignored).

- In git, not on disk (0): none.
- On disk, not in git and not ignored (2): `TTS/Impossibility Simulator.json`, `TTS/decks.json`.
- Git-ignored files on disk: 2074, in `MDW/Fonts/stoogedings-src` 2074.
- Save images in git but not on disk: none.

## Integrity (for the updater)

- CustomDeck ids that mean different images on different objects (0 since 2026-10-22, highest key 1625: see the top): 39 (ids 1128, 1410, 1412, 1413, 1416, 1417, 1419, 1420, 1421, 1422, 1424, 1425, 1426, 1427, 1428, 1429, 1430, 1431, 1432, 1433, 1434, 1435, 1436, 1437, 1438, 1439, 1440, 1441, 1442, 1443, 1447, 1448, 1449, 1450, 1451, 1452, 1453, 1454, 1458). Ids come from CardIDs, decks' CustomDeck maps and cards' own CustomDeck keys. The rulebook pages and the Deck of Rejects reuse ids that deck cards also use; stale own keys (1128) clash too. TTS keeps CustomDeck per object, so this works until two such cards meet in one deck; the updater must take new ids above the highest one.
  - 1128 (stale own key): `Auxiliary/Status Effects/Debuffs/2 Stars/Glued.png`; `Items/Heal/1 Stars/Bolts_and_Screws.png`
  - 1410: `Auxiliary/Rulebook/00_Table_of_Contents.png`; `Field/3 Stars/Elemental_World.png`
  - 1412: `Auxiliary/Rulebook/02_Abbreviations.png`; `Creatures/Monkey D Folder/4 Stars/Funky_D_Luffy.png`
  - 1413: `Auxiliary/Rulebook/03_Setting_Up.png`; `Creatures/Monkey D Folder/3 Stars/Monkey_D_Letion.png`
  - 1416: `Auxiliary/Rulebook/04_Table3.png`; `Items/Heal/3 Stars/Hadal_Stew.png`
  - 1417: `Auxiliary/Rulebook/04_Table2.png`; `Field/2 Stars/Trick_Room.png`
  - 1419: `Auxiliary/Rulebook/04_Table5.png`; `MDW/The Morgue/Developper.png`
  - 1420: `Auxiliary/Rulebook/05_Shops.png`; `MDW/The Morgue/Warcraftian_Rouge.png`
  - 1421: `Auxiliary/Minions/Dark_Esau.png`; `Auxiliary/Rulebook/06_Reading_Cards.png`
  - 1422: `Auxiliary/Rulebook/06_Reading_Cards2.png`; `Creatures/Mario/3 Stars/King_Bob-omb.png`
  - 1424: `Auxiliary/Items/Lit_Bob-omb.png`; `Auxiliary/Rulebook/07_Stats1.png`
  - 1425: `Auxiliary/Minions/Mini_Auto_Croissant.png`; `Auxiliary/Rulebook/07_Stats2.png`
  - 1426: `Auxiliary/Rulebook/07_Stats3.png`; `Creatures/Mario/2 Stars/Ms_Mowz.png`
  - 1427: `Auxiliary/Rulebook/07_Stats4.png`; `Creatures/Other/5 Stars/The_Queen.png`
  - 1428: `Auxiliary/Rulebook/07_Stats5.png`; `N.M.E/Sigil_of_Divinity.png`
  - 1429: `Auxiliary/Minions/Delta.png`; `Auxiliary/Rulebook/08_Global_Turn.png`
  - 1430: `Auxiliary/Minions/Ipsilon.png`; `Auxiliary/Rulebook/09_TakingYourTurn.png`
  - 1431: `Auxiliary/Minions/Sigma.png`; `Auxiliary/Rulebook/10_Attacking.png`
  - 1432: `Auxiliary/Rulebook/10_Attacking2.png`; `Creatures/Hollow Knight/3 Stars/The_Beast.png`
  - 1433: `Auxiliary/Minions/God_Tamer.png`; `Auxiliary/Rulebook/11_Abilities.png`
  - 1434: `Auxiliary/Rulebook/11_Abilities2.png`; `Creatures/Other/5 Stars/The_Forbidden_One.png`
  - 1435: `Auxiliary/Rulebook/11_Abilities3.png`; `Auxiliary/Status Effects/Debuffs/3 Stars/Shell_Shock.png`
  - 1436: `Auxiliary/Rulebook/11_Abilities4.png`; `Auxiliary/Status Effects/Debuffs/1 Stars/Smoldering.png`
  - 1437: `Auxiliary/Minions/Warrior_Dee.png`; `Auxiliary/Rulebook/11_Abilities5.png`
  - 1438: `Auxiliary/Rulebook/11_Abilities6.png`; `Items/Support/2 Stars/Erasure.png`
  - 1439: `Auxiliary/Minions/Spawn_of_the_Forbidden_One.png`; `Auxiliary/Rulebook/11_Abilities7.png`
  - 1440: `Auxiliary/Rulebook/12_Reactions.png`; `Auxiliary/Status Effects/Debuffs/3 Stars/Cheap.png`
  - 1441: `Auxiliary/Minions/Astr_Mionion.png`; `Auxiliary/Rulebook/12_Reactions2.png`
  - 1442: `Auxiliary/Rulebook/12_Reactions3.png`; `Creatures/Other/4 Stars/Astr_Meiana.png`
  - 1443: `Auxiliary/Rulebook/12_Reactions4.png`; `Creatures/Kirby/5 Stars/Butterfly.png`
  - 1447: `Auxiliary/Rulebook/14_Item_Types2.png`; `Creatures/Pandas/2 Stars/Pandanoko.png`
  - 1448: `Auxiliary/Rulebook/15_Minions.png`; `Creatures/Undertale/3 Stars/BergenTRUCK.png`
  - 1449: `Auxiliary/Rulebook/16_The_Field.png`; `Items/Equip/3 Stars/Piko_Piko_Hammer.png`; `MDW/The Morgue/Grandfather_Clock.png`
  - 1450: `Auxiliary/Items/Regenerative_Shield.png`; `Auxiliary/Rulebook/16_The_Field2.png`; `MDW/The Morgue/The_Missile.png`
  - 1451: `Auxiliary/Items/Air_Totem.png`; `Auxiliary/Rulebook/17_Death.png`
  - 1452: `Auxiliary/Items/Fire_Totem.png`; `Auxiliary/Rulebook/18_Field_Cards.png`
  - 1453: `Auxiliary/Items/Earth_Totem.png`; `Auxiliary/Rulebook/19_Status_Effects.png`
  - 1454: `Auxiliary/Items/Water_Totem.png`; `Auxiliary/Rulebook/19_Status_Effects2.png`
  - 1458: `Auxiliary/Rulebook/21_Damage_Types.png`; `Creatures/Other/2 Stars/Slugcat.png`
- Cards whose own CustomDeck lacks their CardID's id (a stale key; reading falls back to that entry, an updater indexing `CustomDeck[str(CardID // 100)]` would fail): 10. The deck's map holds every such id; rewrite the card's map under its CardID's id.
  - `39b80d` 'Return to Sender' CardID 148200, own key 1073, `Items/Counter/4 Stars/Return_To_Sender.png`, in `091586` ★★★★
  - `1b6bf6` 'Stone Spikes' CardID 147900, own key 692, `Items/Counter/2 Stars/Stone_Spikes.png`, in `c86c21` ★★
  - `01a713` 'Stone Spikes' CardID 147900, own key 692, `Items/Counter/2 Stars/Stone_Spikes.png`, in `c86c21` ★★
  - `651e77` 'Wooden Spikes' CardID 147800, own key 688, `Items/Counter/1 Stars/Wooden_Spikes.png`, in `6dbf7e` ★
  - `adee08` 'Wooden Spikes' CardID 147800, own key 688, `Items/Counter/1 Stars/Wooden_Spikes.png`, in `6dbf7e` ★
  - `b815a3` 'Bolts and Screws' CardID 138400, own key 1128, `Items/Heal/1 Stars/Bolts_and_Screws.png`, in `6dbf7e` ★
  - `c178c5` 'Bolts and Screws' CardID 138400, own key 1128, `Items/Heal/1 Stars/Bolts_and_Screws.png`, in `6dbf7e` ★
  - `54af62` 'Crystal Spikes' CardID 148000, own key 695, `Items/Counter/3 Stars/Crystal_Spikes.png`, in `b630d6` ★★★
  - `04acdb` 'Iron Spikes' CardID 148100, own key 696, `Items/Counter/3 Stars/Iron_Spikes.png`, in `b630d6` ★★★
  - `d49b7b` 'Iron Spikes' CardID 148100, own key 696, `Items/Counter/3 Stars/Iron_Spikes.png`, in `b630d6` ★★★
- Decks whose DeckIDs differ from their cards' CardIDs: none.
- Cards whose id is missing from the deck's CustomDeck: none; card vs deck entry mismatches: 0.
- CardIDs not id*100: 0. Highest CustomDeck id 1568: new cards can take 1569 up.
- GUIDs used by more than one object: 839 (2357 objects).
- Role tags in Descriptions: 592 card objects (to be cleared).
