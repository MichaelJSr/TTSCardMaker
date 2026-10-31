# Stats

## HEALTH {.hp}
![The stat bars, health lit: 8 bars, 16 HP](bars-hp.webp)
- Each bar of health represents 2 HP. For example, this creature with 8 bars of health has 16 HP.
- When attacked, HP goes down by ATK value after DEF. When a creature's HP reaches 0, it dies and goes to the graveyard. (See: [“ATTACKING”](#/rules/attacking))

- A creature's MAX HP is the HP a creature starts with. They cannot be healed above this amount naturally.
- An increase to the MAX HP of a creature increases their current HP by the same amount (This counts as healing). For instance, if a [[Mushroom]] (+3.5 HP) is used on this creature, the MAX and current HP would go both from 16 HP to 19.5 HP. Then, if it's later damaged, it can be healed back up to 19.5 HP through regular means of healing.
- If a creature's current HP becomes greater than its MAX HP, but its MAX HP is not increased, regular healing cannot go above MAX.

::: row 5 2
![16 HP plus Heal 4 HP stays 16; 14 HP plus Heal 4 HP is 16; 16 HP plus +3.5 Max HP is 19.5; 16 HP plus Heal 3 HP (can go above max) is 19](stats-heal.webp)
::: small {.center}
Increases to MAX HP are indicated with these markers. For increments of 0.5, use a marker turned to its side.

![The 0.5 chip and three and a half MAX HP up markers](stats-heal-markers.webp)

+3.5
If this goes below 16, it can only heal up to 16 again with regular healing, as MAX HP was not increased.
:::
:::

---

> [!professor] If an item or ability has 2 different healing effects, it is counted as one instance of healing. For instance, if an item healed +2 MAX HP, and then +1 HP, that would only be one instance of 3 healing.

=== page ===

## HEALTH REDUCTION {.hp2}
![The stat bars, health lit](bars-hp.webp)
- A decrease to the MAX HP of a creature does not decrease their current HP, unless if their current HP would become greater than their Max HP (in which case it is set to Max HP).

For instance, A stat stealing creature steals 1 bar (2 MAX HP) of HP. This creature would fall from 16 HP to 14 HP. If the creature was damaged and only at 10 HP, it would not lose HP, but would not be able to heal past 14.
- A decrease to the Max HP of a creature does not count as damage.

::: row 5 2
::: stack
![16 HP minus 2 MAX HP is 14; 12 HP minus 2 MAX HP stays 12](stats-maxhp.webp)

::: small {.center}
1 Bar of HP is 2 MAX HP
:::
:::
::: small {.center}
![Two MAX HP down markers](stats-maxhp-markers.webp){width=45}

Decreases to MAX HP are indicated with these markers.
:::
:::

=== page ===

## DEFENSE {.def}
![The stat bars, defense lit: 4 bars, 2 DEF](bars-def.webp)
- Each bar of Defense represents 0.5 DEF. 4 Bars = 2 DEF.
- When a creature is attacked, they take damage = ATK-DEF (See: [“ATTACKING”](#/rules/attacking))

::: row 3 1
::: stack
![2 DEF minus 1 DEF is 1; 2 DEF minus 1 DEF bar is 1 and a 0.5 chip](stats-def.webp)

::: small {.center}
1 Bar of DEF is 0.5 DEF
:::
:::
::: small {.center}
![The 0.5 chip and the DEF down markers](stats-def-markers.webp)

Decreases to DEF are indicated with these markers. For increments of 0.5, use a marker turned to its side.
:::
:::

::: row
![A fox with a sword and shield](fox-shield.webp)
![Link blocking with his shield](link.webp)
:::

=== page ===

## ATTACK {.atk}
![The stat bars, attack lit: 4 bars, 4 ATK](bars-atk.webp)
::: center
- Each bar of Attack represents 1 ATK.
- This is how much damage a creature does minus DEF when attacking. (See: [“ATTACKING”](#/rules/attacking))
:::

::: row 5 1
![4 ATK plus 1.5 ATK is 5 and a 0.5 chip](stats-atk.webp)
![The ATK up markers](stats-atk-markers.webp)
:::

::: row 1 2
![Buff Kirby](kirby-buff.webp)
::: small {.right}
Increases to ATK are indicated with these markers. For increments of 0.5, use a marker turned to its side.
:::
:::

## SPEED {.spd}
![The stat bars, speed lit: 6 bars, 6 SPD](bars-spd.webp)
::: center
- Each bar of Speed represents 1 SPD.
- This stat determines turn order and combo damage. (See: [“GLOBAL TURN”](#/rules/the-global-turn), [“ATTACKING”](#/rules/attacking))
:::

::: row 5 1
![6 SPD plus 1.5 SPD is 7 and a 0.5 chip](stats-spd.webp)
![The SPD up markers](stats-spd-markers.webp)
:::

::: row 1 4
![Sonic running](sonic-run.webp){width=60}
::: small {.right}
Increases to SPD are indicated with these markers. For increments of 0.5, use a marker turned to its side.
:::
:::

=== page ===

## ROUNDING + STAT CHANGES
- Stats are rounded to the nearest half in the positive direction, *after* reductions or gains are applied. For example, inflicting [[Chilled]] (-25% SPD) on a 5 SPD creature (5 SPD - 1.25 SPD = 3.75 SPD) rounds to 4 SPD, and inflicting [[Enraged]] on a 5 ATK creature (5 ATK + 1.25 ATK = 6.25 ATK) rounds to 6.5 ATK.

- When calculating stat changes or damage dealt, Additives are applied first and multiplicatives second.
- Multiplicative effects are applied additively i.e. Chilled (-25% SPD) + [[Paralyzed]] (-50% SPD) = -75% SPD
- SPD can't go below 1. ATK and DEF can't go below 0. MAX HP can't be reduced below 1 bar (2 HP).

---

| ±0% | -25% | -50% | -75% | +25% | +50% | +75% |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 0.5 | 0.5 | 0.5 | 0 | 0.5 | 1 | 1 |
| 1 | 1 | 0.5 | 0.5 | 1.5 | 1.5 | 2 |
| 1.5 | 1 | 1 | 0.5 | 2 | 2.5 | 2.5 |
| 2 | 1.5 | 1 | 0.5 | 2.5 | 3 | 3.5 |
| 2.5 | 2 | 1.5 | 0.5 | 3 | 4 | 4.5 |
| 3 | 2.5 | 1.5 | 1 | 4 | 4.5 | 5.5 |
| 3.5 | 2.5 | 2 | 1 | 4.5 | 5.5 | 6 |
| 4 | 3 | 2 | 1 | 5 | 6 | 7 |
| 4.5 | 3.5 | 2.5 | 1 | 5.5 | 7 | 8 |
| 5 | 4 | 2.5 | 1.5 | 6.5 | 7.5 | 9 |
| 5.5 | 4 | 3 | 1.5 | 7 | 8.5 | 9.5 |
| 6 | 4.5 | 3 | 1.5 | 7.5 | 9 | 10.5 |
| 6.5 | 5 | 3.5 | 1.5 | 8 | 10 | 11.5 |
| 7 | 5.5 | 3.5 | 2 | 9 | 10.5 | 12.5 |
| 7.5 | 5.5 | 4 | 2 | 9.5 | 11.5 | 13 |
| 8 | 6 | 4 | 2 | 10 | 12 | 14 |
| 8.5 | 6.5 | 4.5 | 2 | 10.5 | 13 | 15 |
| 9 | 7 | 4.5 | 2.5 | 11.5 | 13.5 | 16 |
| 9.5 | 7 | 5 | 2.5 | 12 | 14.5 | 16.5 |
| 10 | 7.5 | 5 | 2.5 | 12.5 | 15 | 17.5 |
{.grid cols=-,red,red,red,green,green,green}
