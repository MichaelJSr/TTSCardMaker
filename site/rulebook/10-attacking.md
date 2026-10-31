# Attacking

## ATTACKS
- Attacks occur when creatures use an action to perform an attack, when an attack item is used, or an ability deals damage (DMG) separate from the ATK stat of a creature.
- Attacks deal ATK - DEF in damage.
- Attacks can only hit the PRIMARY FIELD by defualt. (See: [FIELDS](#/rules/the-field))
- Attacks from abilities cannot trigger counter damage or counter items.

## COMBO DAMAGE
If an attacking creature has TWICE THE SPEED VALUE of the creature being attacked, then the final damage is multiplied by 1.5. If an attacking creature has TRIPLE THE SPEED VALUE, then the final damage is doubled.

---

::: row 1 1.3 1 1.3
::: box
A
HP: 10/10
DEF: 2
ATK: 7
SPD: 4

[L1]{.big}

B
HP: 10/10
DEF: 1
ATK: 6
SPD: 4
:::
::: small
Creature A attacks Creature B. What happens?

Creature B takes
7 minus 1 Damage, for a total of 6. Their HP is reduced to 10 minus 6: they have 4 HP left.
:::
::: box
C
HP: 10/10
DEF: 2
ATK: 7
SPD: 6

[L1]{.big}

D
HP: 10/10
DEF: 1
ATK: 6
SPD: 3
:::
::: small
Creature C attacks Creature D. What happens?

Creature D takes
7 minus 1 Damage, for a total of 6. However, Creature C's speed is DOUBLE that of Creature D's! The final damage value is therefore multiplied by 1.5, resulting in 9 total damage, leaving them at 1 HP.
:::
:::

## SNEAK ATTACKS
Creatures have the option to perform a "sneak attack" in place of a normal attack, which is an attack that deals piercing damage equal to 25% of their attack stat +1, and has the same on-hit effects as a normal attack. This is so creatures with high defense don't become unkillable in certain circumstances.

![Ninja Kirby](kirby-ninja.webp){.end width=10}

=== page ===

## MULTI-HIT ATTACKS
- Multi-hit attacks count as seperate attacks for each hit, and each instance may be reacted to seperately.
- When a creature uses an ability or item to attack multiple enemy creatures at once, the attacks happen left-to-right from the attacker's perspective and counter damage or on death effects both happen after all instances of the attack are resolved.

## REDIRECTIONS
- Redirections & Interceptions, are instances where an attack's target may be forecfully changed.
- **Redirections** change the attack's target to a creature of choice.
- **Interceptions** change the target of an attack to be the creature which is intercepting.
- When a creature moves to intercept an attack, it cancels (and stays out of) defense mode first.

![](kirby-sleepy.webp){.end width=9}

## INFLICTIONS ![](krabs-infliction.webp){height=1.6em}
- If a creature attacks or is attacked, any debuffs or stat changes inflicted on offense or defense are inflicted before the attack strikes, allowing those effects to alter the result of the attack.
- Inflictions that occur from a creatures' attack cannot be separated from the attack itself, and cannot be independently Negated/Reflected/Redirected/Intercepted whereas separate inflictions (from items and non-on attack abilities) can be.
- Only attack actions can proc any “on attack” effects.

## ROUNDING
In the case that damage isn't a .5 multiple, damage rounds up, for example 3.25 DMG rounds to 3.5 DMG

![](kirby-ball.webp){.end width=9}
