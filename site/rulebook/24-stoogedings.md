# Stoogedings {.web}

::: panel
For card makers, on the website only. Stoogedings draws types, timing badges and costs from what you type in Photoshop. The card's text stays what you typed, so the website and the bot can read it.
:::

## GETTING STARTED
1. Install `MDW/Fonts/stoogedings.ttf`, then restart Photoshop. Do it again whenever the font changes.
2. Type the text in the card's font.
3. Select each thing to draw, such as `[fire]` or `(1CD)`, and set it in stoogedings.

A typo stays as letters, so it shows on the card. A timing tag or cost left in the card's font is set for you when you push; a `[type]` is not.

## TYPES
A type's name in square brackets draws its icon.

| You type | You get |
|:---:|:---:|
| `[fire]` | [fire] |
| `[Defensive Minion]` | [defensive minion] |
| `[darkmatter]` | [darkmatter] |
| `★` | ★ |

Capitals don't matter. A space, `_`, `-` or nothing between words are all the same. On the website, typing `[` in card text lists every type and variant.

## VARIANTS
Put a variant after the name, with a colon and no spaces.

| You type | You get | What it is | Use it for |
|:---:|:---:|---|---|
| `[fire]` | [fire] | The type in its own colours | Almost everything |
| `[fire:tint]` | [fire:tint] | One colour, the text's | A type that matches its line, as on [[Elemental World]] |
| `[dark:sticker]` | [dark:sticker] | Its own colours on an outline in the text's colour | A dark type on dark art, as on [[Afraid]] |
| `[fire:no]` | [fire:no] | A red sign over it | Not that type: non-fire. Every other variant counts as the plain type |
| `[dark:glow]` | [dark:glow] | A soft white halo | A dark type on dark art, in text with no Stroke |
| `[light:darkglow]` | [light:darkglow] | A soft black halo | A pale type on pale art, in text with no Stroke |
{.tags}

The same type on a dark text box:

::: ability
Plain [dark]   Tint [dark:tint]   Sticker [dark:sticker]   No [dark:no]   Glow [dark:glow]   Dark glow [dark:darkglow]
:::

Most cards have a Stroke on their Text group. A Stroke outlines the whole halo and turns it into a disc, so `:glow` and `:darkglow` only suit text without one.

![[Elemental World]] ![[Afraid]]

## TIMING BADGES
A timing tag in parentheses draws its badge. Any letter case works, but only a whole tag: `(1cd)` draws (1cd), `(Actions)` stays letters.

| You type | You get | Colour |
|:---:|:---:|---|
| `(OYT)` | (OYT) | Blue: on your turn |
| `(1GCD)` | (1GCD) | Purple: at any time |
| `(BOT)` | (BOT) | Red: forced |
| `(2U)` | (2U) | Orange: per game, uses and triggers |
| `(Action)` | (Action) | Grey: costs the creature's action |
{.tags}

A cooldown's left end is its ring, worked out from what you type.

| You type | You get | The ring |
|:---:|:---:|---|
| `(2CD)` | (2CD) | Hollow: charge still to come |
| `(1/2CD)` | (1/2CD) | Green: the charge it starts with |
| `(-1/2CD)` | (-1/2CD) | Red: a start below zero |
| `(XCD)` | (XCD) | Dashed: a number the card sets |
{.tags}

The number in the ring is the turns until its first full charge. Numbers go up to 20 or X; a start goes from −9 up to the second number. Meanings: [Timing Tags](#/rules/timing-tags), [Reading the Ring](#/rules/timing-tags/reading-the-ring).

## COSTS
A cost in parentheses draws its badge too.

| You type | You get | What it costs |
|:---:|:---:|---|
| `(2 points)` | (2 points) | Your team's points |
| `(2 bricks)` | (2 bricks) | Your team's BRICKS |
| `(2 SP)` or `(2 star points)` | (2 SP) | Your team's star points |
| `(4 souls)` | (4 souls) | A currency of the card's own |
| `(3 counters)` | (3 counters) | A currency of the card's own |
{.tags}

Use a number from 0 to 50, a half from 0.5 to 9.5, or X, then one space. Singular, plural and any letter case all work. Right after a letter, number or full stop it stays text, for a multiplier: `Deal 2(x counters) DMG`.

Badges and costs sit side by side, as on [[Morpho Knight]]:

::: ability
(1CD)(3U)(2 points) Inflict 3 enemy creatures with 1T Smoldering.
:::

## STYLISTIC ALTERNATES
Every badge and `:sticker` has a one-colour shape that takes the text's colour.

| You type | Normal | With Stylistic Alternates |
|:---:|:---:|:---:|
| `(1CD)` | (1CD) | ![(1CD) as an outline](stoogedings-alt-1cd.webp) |
| `(1/2GCD)` | (1/2GCD) | ![(1/2GCD) as an outline](stoogedings-alt-1-2gcd.webp) |
| `(OYT)` | (OYT) | ![(OYT) as an outline](stoogedings-alt-oyt.webp) |
| `(2 points)` | (2 points) | ![(2 points) as an outline](stoogedings-alt-points.webp) |
| `[dark:sticker]` | [dark:sticker] | ![The dark type as an outline](stoogedings-alt-sticker.webp) |
{.tags}

To turn it on, select the text, open the Character panel's menu, then OpenType > Stylistic Alternates. The text stays as typed, but the badges lose their colours, so use it only under an overlay. When you push, cards under an overlay get it on every badge and `:sticker` by themselves.

![[Morpho Knight]]

## OVERLAYS
A Color, Gradient or Pattern Overlay repaints everything in its layer: every letter, type and badge. Nothing in that layer can keep its own colours, and no font setting changes that.

::: row
::: stack
**Under an overlay**
![Palace of Shadow's ability under a Gradient Overlay: the badge and the types are the overlay's colours](stoogedings-overlay.webp)
:::
::: stack
**A colour per line**
![The same ability with the overlay off: the badge and the types keep their colours](stoogedings-colour-lines.webp)
:::
:::

So when the text has types or badges, don't use an overlay:

1. Turn the overlay off.
2. Select each line and give it a solid colour. To copy a gradient, use its colour at that line.

The letters look almost the same, and every type and badge keeps its colours.

If the overlay has to stay, set the types as `:sticker` or `:tint`. A plain `[fire]` under an overlay is a flat shape.
