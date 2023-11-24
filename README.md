# Impossibility Simulator

A Tabletop-Simulator port of a card game created by https://github.com/JasonBechdolt and maintained by friends since middle school

# Rules
**All rules apply by default unless card descriptions say otherwise**

Above all else: Follow the **Don’t Be Stupid** Rule

Each team starts with 2 points

A game ends when all of one team’s creatures die

Items may be bought only on your turn for 4x POINTS

Field items may be bought only on your turn for 2x BRICKS

Reveal all shops before card reveals while setting up

## Start of the game
### Each team starts with:
- One 5-star creature
- Two 4-star creatures
- Three 3-star creatures
- One 2-star creature

### Each team also starts with:
- Two 4-star items
- Three 3-star items
- Three 2-star items
- Two 1 star items

### Lay out an item shop with:
- One 1-star item
- Two 3-star items
- Two 2-star items
- Two 1-star items

### Lay out a field item shop with:
- One 4-star field item
- Two 3-star field items
- Two 2-star field items
- Two 1-star field items


## Reactions
Items/abilities may be used reactively to any action/ability/item/event, in which case a “reaction” begins.

“Reactions” resolve before the action/ability/item/event/reaction they are reacting to resolve.

A chain of reactions must resolve before a new one begins.

Items/abilities that are played reactively resolve backwards, but attack/offense items and damaging abilities resolve last, all with the same priority.
Attacks from a creature will always be resolved at the very end of a reaction.
For example: If a creature Attacks, the target uses a healing item, and then the attacker uses an attack item, they will resolve in the order of Healing item, Attack Item, Creature Attack.


If a reacion prevents a creature from being targeted by an item, (i.e forcibly switched out/killed before hand) the item and star points aren’t used.

A decision to do attack or use an ability/item cannot be retracted if your opponent reacts to it in some way.

Items may be played from hand reactively only if its your turn.

While a reaction is occuring, items cannot be bought from the shop.

Items may be reactivley unequiped and re-equiped to another creature if it is your turn.


## The Field
The place that creatures are placed on is called the primary field, which is organized into 6 slots, 3 for each team.
Every slot must be filled if possible.

Each slot containing a creature takes one turn during each Global Turn.

If an entire lane of creatures is dead, then skip over that lane, but count time as if that lane had gone.

Behind the primary field is the Secondary field. This is created by something pushing a creature back into it, either a protective minion or active item designated by the shield symbol
If a protective minion gains its own protectve minion, it and the creature it’s equipped to are each pushed back one field.

By default, attacks and enemy items can only hit the primary field.

A creature must be in the primary field to use its actions unless otherwise specified, but can use its ability or switch out in any field.

A creature can swap fields with its protective minions once during its turn, but only if no actions have been used yet..

## Creatures
Creatures at base have 1 “Action” per global turn that allows them to Attack, Defend, Generate Bricks, or be spent on specific abilities.

Right before a creature starts its turn, you can switch it out with another one in your hand for the cost of 2 points.
 If it is the first thing to go in the lane, this may change turn order within the lane.
Equips and Minions will stay equipped to a creature when swapped out. Equips may still be unequipped.

Attacking
When a creature uses an action to attack, it targets something on the field and does damage to it.
The damage from attacks are reduced by half of the defense of the target.
DMG - (1/2*DEF)

Defending
When a creature uses an action to defend, it is turned 90 degrees, and its DEF stat doubles. It stays like this until the beginning of it’s turn.
If all creatures on one side of the field are defending, those creatures take 1 True Damage at the end of their turn
When a creature moves to intercept an attack, it switches (and stays out) of defense mode first.

Mining for Bricks
Point-yielding creatures may consume an action to generate BRICKS equal to their star level. BRICKS can be used to buy Field Items.

At the beginning of a creatures turn (before they use an ability or do any other action) you have the option to switch it out with another from your hand for the cost of 2 Points.

Death
When a creature’s HP reaches 0 it dies, and the opposing team gains Points equal to that creature’s star level.
Creatures composed of multiple targets only award Points when all targets are killed.
Creatures that are revived from on death effects only yeild Points when they are fully killed.
For creatures that are revived by other means, points are kept from killing it, but killing the revived version awards no Points.

When a creature dies, and is revived, it’s HP and all of its stats, abilities, turn timers, or counters are reset to their base unless otherwise specified.

## Stats
Each bar of health represents 2 HP
ATK and SPD, and DEF are valued as displayed, however ever DEF blocks only half it’s value for incoming DMG.
HP and SPD canot be reduced below 1 bar.

HP
An increase to the Max HP of a creature increases their current HP by the same amount. (This counts as healing)
A decrease to the Max HP of a creature does not decrease their current HP unless if their current HP would become greater than their Max HP (in which case it is set to Max HP).
A decrease to the Max HP of a creature does not count as DMG.
If an item or ability has 2 different healing effects it is counted as one instance of healing.

Stat Changes
When calculating stat changes or damage dealt, Additives are applied first and multiplicatives second
Multiplicative effects are applied additively i.e. Chilled (-25% SPD) + Paralyzed (-50% SPD) = -75% SPD

Rounding
Damage dealt rounds to the nearest half in the positive direction, for example 3.75 DMG rounds to 4 DMG. 
Stats are rounded to the nearest half in the positive direction, after reductions or gains are applied. For example, inflicting Chilled (-25% SPD) on a 5 SPD creature (5 SPD - 1.25 SPD = 3.75 SPD) rounds to 4 SPD, and inflicting Empowered on a 5 ATK creature (5 ATK + 1.25 ATK = 6.25 ATK) rounds to 6.5 ATK.
DEF is the exception, as it rounds to the nearest whole number.

## Creature Types
Most creatures and minions will have a type indicated by an icon on the top left of the card.

Certain types have special effects that mostly determine what effects they are immune to or how certain items interact with them. Those are listed on the item icon or item.

“Machine” type cannot have food items be used on them and immune to Sickness, Plague, Poison

“Panda” type immune to Burdened from food items

“Fire” type immune to Smouldering, Burning, Blazing

“Wind” type can swap out for 1 less point

“Rock” type immune to being forcibly swapped out

“Water” type immune to Softened

“Electric” type immune to Paralyzed

“Ice” type immune to Chilled, Frostbite, Frozen

“Undead” type immune to Sickness, Plague

“Dark” type

“Light” type immune to Blindness

“Dark Matter” type immune to Corruption

“Unkown” type upon first summon, may change this type to any other type (including nothing)

## Minions
Shield icon : Non protective minions occupy the same field as the summoner, and do not protect them from attacks.
Sword and ribbon icon :Protective minions push the equipped creature (and the non-protective minions around it) back one field.
A summoner has the option to summon protective minions behind itself in the secondary field.

Minions will stay equipped to a creature even if it is switched out.
If all point-yielding creatures in a slot die, then non-persistant minions in that slot also die.

Minions do not yeild points when killed.
Minions cannot generate BRICKS.


## Attacking
Attacks occour when creatures uses an action to preform an attack, when an attack item is used, or an ability deals damage or inflicts debuffs separate from the attack stat of a creature.
 Attacks from abilities cannot trigger counter damage or counter items.

The damage from attacks are reduced by half of the defense of the target.
DMG - (1/2*DEF)

After calculating damage done past DEF and rounding, apply a multiplier to the damage dealt based on the SPD difference between the attacker and the target, known as Combo Damage:
1.5x DMG if attackers’ speed is double that of the targets,
2x DMG if triple.

If a creature attacks or is attacked, any de-buffs or stat changes inflicted on offense or defense are inflicted before the attack strikes, allowing those effects to alter the result of the attack.

Intercepts make an attack target the interceptor rather then the original target.

Multi-hit Attacks
When a creature uses an ability or item to attack all enemy creatures at once, the attacks happen left-to-right from the attacker's perspective and counter damage or on death effects both happen after all instances of the attack are resolved.

## Damage Types
Multiple damage types can be applied to an instance of damage, combining their effects.
Normal: reduced by half of the defense of the target. 
DMG - (1/2*DEF)
Piercing: Ignores DEF
Counter: Can only be dealt as retaliation to an attack. Does not count as an attack, and can bypass abilities and protective minions as a result
Overkill: Only applies when a card says so: Extra damage from one attack goes to another applicable card of your choosing, and is effected by the DEF of that chosen target. This does not count as an "attack", and other effects of the attack (such as status effects) do not proc on overkill
Life steal: DMG dealt after DEF is healed before the attack resolves, with a percent scalar where 100% is 1:1, 50% is 1:2, 200% is 2:1, etc.
True damage: Is piercing, and cannot be negated, redirected, or reduced by any means.Shockwave: Deals damage to all enemy targets on the primary field aside from the original target, and also the secondary field 

## Abilities
A creatures ability is only active while on the field unless otherwise specified.
Multi turn based abilities such as (EOT) abilities do not count time passing while in the hand.
If a multi turn based ability such as an (EOT) ability is not used when available it can be used on a future turn instead, but the cooldown does not begin until it is used.

A passive ability is any ability that is not time based, that is an ongoing effect and can happen an infinite amount of times.
If an item/ability does something upon being negated, the “upon being negated” effect itself has true negation immunity.

"Counters" are unique per creature unless otherwise stated.

Negation
Multi turn based abilities such as (EOT) abilities count time passing even while they are negated.
On first summon abilities cannot be negated reactively.
5+ star creatures cannot have their abilities negated with few exceptions.True Negation Immunity: Complete immunity to any possible sources of negation, including sources that negate negation-immune creatures.If 2 creatures/sources attempt to negate each other simultaneously, they are both negated.
Minions/Items/Stats/Counters summoned/gained by an ability remain even if the ability that summoned them is negated or if the creature that summoned them dies. 

Ability Copying/Stealing/Swapping
Stolen/Swapped abilities refresh as brand new per creature, if the creature loses that ability then gains it back, it’s not reset but instead incremented by a turn.
If a creature gains an on first summon ability (or if this is the first opportunity that an OFS ability can be procced), proc it now.
If multiple abilities conflict (such as multiple on death abilities), the owner may choose the order/which abilities activate.

Misc.
Abilities that count damage dealt to creatures do not count overkill damage.
When two (BOGT) effects happen simultaneously the team with the higher cumulative SPD among all their creatures takes precedence.

## Turns
A “Global Turn” is defined as when all slots on the field have taken a turn, and is brought to a close by the phrase “Turn Reset”.
Turn order is based on the 3 lanes on the field, each lane being composed of the two slots facing each other from each team.

To determine which lane goes first, identify which creature in each slot has the highest SPD, and combine each highest speed for each lane. The order of lanes is then determined by those values, highest speed first, lowest last
Within each lane the slot with the higher speed creature goes first

In the case of a tie in either of these cases, percentage of health remaining will be the first tiebreaker (higher health going first), and the star level of the creatures will be the second tiebreaker (higher stars go first)

Once a lane has begun taking its turn, no other slot can take its turn until the current lane is done
If a change of turn order occurs while a creature is in the middle of its turn, that creature gets to finish its turn regardless
If a creature switches out to a new creature with a lower speed, then that creature’s turn can be delayed within a lane if its speed is lower than the other creature in the lane
Similarly, if a creature that has used an action dies mid-turn, the creature that replaces it cannot use an action, but may use its ability
## Turn Phases
Phase 0 (when deciding lane/creature turn order (BOGT etc)):
- Can use facedown items
- Can use (AAT) abilities
- Turn order may be manipulated through SPD changes

Phase 1 (before turn start):
- Creature can swap out and change turn order within the lane
- Can use items from facedown (before (BOT) effects proc)

Phase 2 (turn starts, before creature acts):
- Turn order may no longer be manipulated through SPD change
- Can no longer swap out the creature
- Beginning of turn (BOT) effects activate

Phase 3 (creature acts):
- Can use (OYT) abilities
- Can use items from the hand
- Can swap items from hand to facedown and vice versa
- Can buy items from the shop
- May use items from hand, swap items, and buy items

Phase 4 (turn ends):
- Can no longer use (OYT) abilities
- Can no longer use use items from hand, swap items, or buy items
- End of turn (ENDT) effects activate
- Items can be used preemptively for (ENDT) effects

Phase 5 (turn over):
- Status effects proc (unless otherwise stated)
- Status effects' duration ticks down 1 turn

# Abbreviations
Abbreviations marked with a 🕐 icon are considered "Time Based" when used in abilities/item descriptions. These abilities are considered "refreshed" and become usable again in the specified timeframe.

Abbreviations marked with a ⌛ icon are considered "Multi Turn" abilities when used in abilities/item descriptions.
- (OYT) = On your turn
- (AAT) = At any time
- 🕐 (BOT) = Beginning of turn. Implies “Once per turn (OPT)”
- 🕐 (ENDT) = End of turn. Implies “Once per turn (OPT)”
- 🕐 (BOGT) = Beginning of global turn. Implies “Once per turn (OPT)”
- 🕐 (ENDGT) = End of global turn. Implies “Once per turn (OPT)”
- 🕐 (OPT) = Once per turn. Implies "on your turn (OYT)"
- 🕐 (TPT) = Twice per turn. Implies "on your turn (OYT)"
- 🕐 (XPT) = X times per turn (where X is a number). Implies "on your turn (OYT)"
- 🕐⌛ (EOT) = Every other turn i.e. Every second turn after ability initiates
- 🕐⌛ (EXT) = Every X turns (where X is a number)
- 🕐 (OPGT) = Once per global turn. Implies "at any time (AAT)"
- 🕐 (TPGT) = Twice per global turn. Implies "at any time (AAT)"
- 🕐 (XPGT) = X times per global turn (where X is a number). Implies "at any time (AAT)"
- 🕐⌛ (EOGT) = Every other global turn. Implies "at any time (AAT)"
- (OPG) = Once per game
- (TPG) = Twice per game
- (XPG) = X times per game (where X is a number)
- (MAX X) = Ability/passive can only be activated X amount of times per game
- (OFS) = On first summon
- (OD) = On death
- (PF) = Primary field
- (AF) = Any field
- (CD) = Counter damage

# Items
At the beginning of every global turn you are granted 7 Star points, which do not carry over between global turns.
Star points may be expended to use an item of equivalent level.

Items in the hand can only be used during your turn but you may place 3 items facedown for use when it is not your turn.
You cannot use items on creatures in the hand.

During your turn you can sell items for points equal to their star level. You can also sell items that are facedown at any time
You cannot sell items that have already been used, unless they specify their sell price changing.

Shop
Item’s in the shop my be purchased for 4x the star level of the item in points.
After an item is bought from the shop, restock the slot with an item of the same star level.
Once per turn you may reshuffle the shop for 1 point.

Negation
If an item is negated or destroyed during use, the star points expended to use it are still expended.
Items that are negated cannot be sold, or used for any other purpose until the negation ends.
Equip and active items can be negated after their activation while they are still in effect, requiring star points to be used to reactivate them.

Misc.
Some effects require you to draw a random item. In this case, draw from a copy of the deck until an eligible item is drawn. After the eligible item is drawn, do not replace it in the copy deck, and set aside the copy deck for next time a random item is drawn. If the entire deck is drawn and no eligible items were found, the effect will do nothing. 

# Item types
Item types
There are various attributes assigned to the top left corner of items that determine how they work

Single Use
Tomato: “Healing” items that can’t be used on machine types.
Bomb: “Attack” items that count as an attack when used.
Metronome: “Offensive” items that do not count as an attack.
Blue glowy thing: “Support” items.

Infinite Use
Sword and ribbon: “Equip” items that you may equip onto your own creatures and grant a passive effect to the creature they are on which is lost when unequipped. May be unequipped and returned to your hand during your turn. If an equip has a negative effect, cannot be unequipped until the start of the global turn after it was equipped. If equipped creature dies, return equip it to your hand. Equip’s stay equipped onto creatures swapped into the hand, and may be unequipped from creatures in your hand on your turn. 

Sword and ribbon with a clock: “Fragile Equip” items; same as         but cannot be unequipped and are destroyed when the creature they are on dies.

Cellphone tower: “Active” items that stay on the field with a constant effect until they are destroyed. They are not creatures, cannot have items equipped to them, cannot have healing items used on them and cannot be inflicted with status effects. Unless they are protective, they are on their own field.

## Status effects:

Procing
If a status effect deals DMG or Heals, then by default it procs at ENDT.
 Otherwise, by default the status effect procs immediately.

If a status effect deals DMG it is piercing by default, doesn’t count as an attack, and can damage cards that are in the hand.

If a creature has a status effect and the global turn ends without the creature having ended its turn, then the effect ticks at the end of the global turn, even if the creature is in the hand.
Types
Standared status effects can only have one instance of themselves applied to a single creature.
Stacking status effects can have any number of themselves applied.

Certain status effects upgrade themselves when applied Ex:
Smoldering + Smoldering -> Burning
Smoldering/Burning + Burning -> Blazing
Chilled + Chilled -> Frostbite
Chilled/Frostbite + Frostbite -> 1 turn of Frozen
Sickness + Sickness -> Plague

A creature already inflicted by Frozen/Blazing/Plague can have none of the prior debuffs inflicted onto them.

Duration
When a status effect is stacked or upgraded, the duration is set to whatever is longest.
If a creature is inflicted with a status effect it already has, the duration is set to the longest duration.

## Field Items:
Each team may have one Field item active at a time for their side.
Items cannot be used on Field items.
Field items are their own slot, and they do not have a turn.
Field items can be stored in the hand, and swapped onto the field for SP equal to their level.

Obtaining
Point-yielding creatures may consume an action to generate BRICKS equal to their stars
Field items cost 2x their star cost in BRICKS.
If a Field item says -X cost per Y, the cost to buy it is reduced by X BRICKS per every Y type/attribute/other condition.
After a Field item is bought, the shop slot does not restock.
At the exact moment that a Field item is acquired, it may be swapped onto the field for free
Field items cannot be sold.

Negation
At the beginning of the global turn or on your turn, you may spend 1x the star cost of a field item in BRICKS to negate it until the end of the global turn (field item stays on the field and can be swapped out, but loses its effect temporarily)

You may spend 3x the star cost of a field item in BRICKS to destroy it at any time

## Attributes
- Nature
- Monster
- Demon
- Brute
- Military
- Leadership
- Martial Artist
- Mage
- Business
- Performer
- Engineer
- Industrial
- Rogue
- Trickster
- Explorer
- Royalty
- Prodigy
- Spiritual
- Haunted
- Spectral
- Infected
- Mythical
- Higher Being
- God
- Creator

## Rare Rulings
A creature being “destroyed” causes it to take enough DMG to kill it (regardless of healing or any other possible factors).

If a creature has multiple of the same type/attribute and a field items’ effect can be stacked, then the effect is stacked per applicable type/attribute.

If a healing item is used to deal DMG, it is instead treated as an attack item, and vice versa.
