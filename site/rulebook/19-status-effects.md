# Status Effects

## STATUS EFFECTS
- A status effect, is either a buff or debuff that has an effect on a creature, represented by Mr. Krabs either suffering or thriving.
- If a status effect deals DMG or Heals, then by default it procs in phase 4, after (ENDT) effects. Otherwise, the status effect takes effect immediately.
- The duration of any status effect counts down in phase 4.

::: panel
::: row 4 3
![Panda with 2 turns of Softened and 2 turns of Smouldering: its counters and markers](status-panda.webp)

This [[Panda]] was just inflicted with both 2 turns of [[Softened]] (-0.5 DEF), and 2 turns of [[Smoldering|Smouldering]] (2 DMG). Instantly, the DEF reduction takes effect. When Panda ends its next turn, it takes 2 damage from smouldering, and the duration for both of the debuffs goes from 2 to 1.
:::
:::

## SPECIFICS
- DMG dealing status effects count as one instance of damage per unique stack. (5 stacks of [[Poison]] is one instance of 5 damage.)
- Per unique status effect in phase 4, the owner of the creature chooses the order in which to resolve these effects. (May choose if Regeneration heals before Smouldering does damage first)
- If a status effect deals DMG it is piercing, and doesn't count as an attack.
- If a creature started the global turn with a status effect and the global turn ends without the creature having ended its turn, then the effect ticks at the end of the global turn, even if the creature is in hand.

=== page ===

## SYNTAX
Statuses are formatted like "[X]T[Y] [Status]", where X is duration and Y is stacks. For example, "5T1 Poison" means 5 turns of 1 stack of Poison.

## TYPES
Standard status effects can only have one instance of themselves applied to a single creature. [buff] [debuff]
Stacking status effects can have any number of themselves applied. [buffstack] [debuffstack]

---

::: row 1 1.5 1 1.5
![[Peppy]]

::: small
This buff can be applied many times to gain as many stacks of it to gain alot of speed. 10 stacks = +10 SPD.
:::

![[Withering]]

::: small
This debuff cannot be applied more than once.
:::
:::

## DURATION
When a status effect is stacked/upgraded/reapplied, set the duration to the longest lasting of the applications.

## UPGRADABLE [debuffupgrade]
Certain status effects upgrade themselves when applied, Ex:
Smouldering + Smouldering -> Burning
Smouldering/Burning + Burning -> Blazing
Chilled + Chilled -> Frostbite
Chilled/Frostbite + Frostbite -> 1 turn of Frozen
Sickness + Sickness -> Plague
A creature already inflicted by Frozen/Blazing/Plague can't have the prior debuffs reapplied onto them, except to refresh the duration (need to upgrade to refresh duration).

---

![[Smoldering]] -> ![[Burning]] -> ![[Blazing]]

![[Chilled]] -> ![[Frostbite]] -> ![[Frozen]]

![[Sickness]] -> ![[Plague]]
