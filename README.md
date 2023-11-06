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

## The Field
No more or less than 3 creatures must occupy a team’s field unless they run out of creatures

The place that creatures are placed on is called the primary field, which is organized into 6 slots, 3 for each team

Each slot containing a creature takes one turn during each Global Turn

If an entire lane of creatures is dead, then skip over that lane, but count time as if that lane had gone

Behind the primary field is the secondary field. A creature in the secondary field cannot use its actions, but can use its ability or switch out

Any further fields (usually created by multiple layers of minions spawning) have the same restrictions as the Secondary field

A creature in the hand cannot use actions, use their ability, or have items used on it (equip items stay equipped and may be unequipped)

## Creatures and Stats
Each bar of health represents 2 HP

An increase to the max HP of a creature increases their current HP by the same amount

A decrease to the max HP of a creature does not decrease their current HP unless if their current HP would become greater than their max HP (in which case it is set to max HP)

A decrease to the max HP of a creature does not count as DMG

ATK and SPD are valued as displayed

Every bar of DEF blocks 1/2 a bar of ATK

Stats cannot be reduced below 1 bar, except DEF and ATK which can be reduced to 0 bars

When calculating stat changes or damage dealt, Additives are applied first and multiplicatives second

Multiplicative effects are applied additively.
- For example Chilled + Paralyzed = -75% SPD

Damage dealt rounds to the nearest half in the positive direction.
- For example 3.75 DMG rounds to 4 DMG
- Overrules the next rule

Stats (and reductions or gains) are rounded to the nearest half in the positive direction, calculated after they would have been applied.
- For example, inflicting Chilled on a 5 SPD creature (5 - 1.25 SPD = 3.75 SPD) rounds to 4 SPD
- Inflicting Empowered on a 5 ATK creature (5 + 1.25 ATK = 6.25 ATK) rounds to 6.5 ATK
- DEF is the exception, it rounds to the nearest whole number

Creatures at base have 1 “Action” per global turn that allows them to Attack, Defend, generate bricks, or various other things

At the beginning of a creatures turn (before they use an ability or do any other action) you have the option to switch it out with another from your hand for the cost of 2 points

When a creature dies, the opposing team gains points equal to that creature’s level

If a creature is revived via an item, points are kept from killing it, but killing the revived version awards no points

Creatures composed of multiple targets only award points when all targets are killed

Creatures that revive with an ability only reward points when they are fully killed

When a creature dies, and is revived, all of its stats, abilities, turn timers, or counters are reset to default

Time does not pass for a creature's abilities while it is in the hand

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
Non protective minions occupy the same field as the summoner, and do not protect them from attacks
- Non Protective minions are designated by a sword symbol
- Protective minions are designated by a shield symbol

Protective Minions stand in front of the creature that summoned them, pushing that creature (and the non portective minions around it) back to the secondary field

Minions count as creatures for most purposes, however, are different in a few important ways, such as:
- Awarding no points when killed
- Not being able to use actions to generate bricks

Minions will stay with a creature even if it is switched out

If all point-yielding creatures in a slot die, then non-persistant minions in that slot also die

A creature has the option to summon protective minions behind itself in the secondary field

A creature can swap fields with its protective minions once during its turn, but only if both of them have 1 or more actions remaining (it does not cost an action to swap fields)

A creature that has already used an action may not use an action with a protective minion they summon

## Attacking
An attack is classified as any act that could either deal damage or inflict a negative de-buff

After calculating damage done past DEF and rounding, apply a multiplier to the damage dealt based on the SPD difference between the attacker and the target, known as Combo Damage:
- 1.5x DMG if attackers' speed is double that of the targets
- 2x DMG if triple

When a creature uses an ability or item to attack all enemy creatures at once, the attacks happen left-to-right from the attacker's perspective and counter damage is dealt only after all the attacks have occured

Abilities that deal damage or inflict debuffs separate from the attack stat of a creature count as an attack, but do not consume an action, and cannot trigger counter damage or counter items

A decision to attack cannot be retracted if your opponent activates an item or ability during the attack

If a creature attacks or is attacked, any de-buffs or stat changes inflicted on offense or defense are inflicted before the attack strikes, allowing those effects to alter the result of the attack

## Damage Types
Multiple damage types can be applied to an instance of damage, combining their effects.

**Normal:** Non Piercing (blocked by def at a rate of 1 per 2 DEF) 

**Piercing:** Ignores Def

**Counter:** Can only be dealt as retaliation to an attack. Does not count as an attack, and can bypass abilities and protective minions as a result

**Overkill:** Only applies when a card says so: Extra damage from one attack goes to another applicable card of your choosing, and is effected by the DEF of that chosen target

**Life steal:** DMG dealt is healed before the attack resolves, with a percent scalar where 100% is 1:1, 50% is 1:2, 200% is 2:1, etc.

**Shockwave:** Deals damage to all enemy targets on the primary field aside from the original target, and also the secondary field slot behind the main target (This does not count as an attack)

**De-buff damage:** Is piercing by default, doesn’t count as an attack, and can damage cards that are in the hand

**True damage:** Is piercing, and cannot be negated, redirected, or reduced by any means

## Defending
When a creature defends, it is turned 90 degrees, and its DEF stat doubles. This is Defense Mode

A creature that defended stays in defense mode until the beginning of their next turn

If all creatures on one side of the field are in defense mode, those creatures take 1 True Damage at the end of their turn

When a creature moves to intercept an attack, it switches out of defense mode first

## Abilities
5+ star creatures cannot have their abilities negated with few exceptions

On first summon abilities cannot be negated reactively

If a creature gains an on first summon ability (or if this is the first opportunity that an OFS ability can be procced), proc it now

Multi turn based abilities such as (EOT) abilities count time passing even while they are negated

If a multi turn based ability such as an (EOT) ability is not used when available it can be used on a future turn instead

Minions summoned by an ability remain even if the ability that summoned them is negated or if the creature that summoned them dies (unless they were summoned on that creature that died)

Items given by an ability remain when the card is negated or dies

If a creature is negated, stats or counters gained or lost permanently via abilities are not negated/removed

If 2 creatures/sources attempt to negate each other simultaneously, they are both negated

Abilities that count damage dealt to creatures do not count overkill damage

Stolen/Swapped abilities refresh as brand new per creature, if the creature loses that ability then gains it back, it’s not reset but instead incremented by a turn

A passive ability is any ability that is not time based, that is an ongoing effect and can happen an infinite amount of times

If multiple abilities conflict (such as multiple on death abilities), the owner may choose the order/which abilities activate

If an item/ability does something upon being negated, the “upon being negated” effect itself has true negation immunity

**True Negation Immunity:** Complete immunity to any possible sources of negation, including sources that negate negation-immune creatures

## Turns
A “Global Turn” is defined as when all slots on the field have taken a turn, and is brought to a close by the phrase “Turn Reset”

Turn order is based on the 3 lanes on the field, each lane being composed of the two slots facing each other from each team

To determine which lane goes first, identify which creature in each slot has the highest speed, and combine each highest speed for each lane. The order of lanes is then determined by those values, highest speed first, lowest last

Within each lane the slot with the higher speed creature goes first

In the case of a tie in either of these cases, percentage of health remaining will be the first tiebreaker (higher health going first), and the star level of the creatures will be the second tiebreaker (higher stars go first)

Once a lane has begun taking its turn, no other slot can take its turn until the current lane is done

If a change of turn order occurs while a creature is in the middle of its turn, that creature gets to finish its turn regardless

If a creature switches out to a new creature with a lower speed, then that creature’s turn can be delayed within a lane if its speed is lower than the other creature in the lane

Similarly, if a creature that has used an action dies mid-turn, the creature that replaces it cannot use an action, but may use its ability

## Turn Phases
Phase 0 (when deciding lane/creature turn order (BOGT etc)):
- Can use facedown items only
- Can use (AAT) abilities
- Turn order may be manipulated through SPD changes

Phase 1 (before turn start):
- Creature can swap out
- Can equip items from facedown (before (BOT) effects proc)

Phase 2 (turn starts, before creature acts):
- Turn order may no longer be manipulated through SPD change
- Can no longer swap out the creature
- Beginning of turn (BOT) effects activate

Phase 3 (creature acts):
- Can use (OYT) abilities
- Can use items from the hand
- Can swap items from hand to facedown and vice versa
- Can buy items from the shop
- Last chance to use items from hand, swap items, and buy items

Phase 4 (turn ends):
- Can no longer use (OYT) abilities
- End of turn (ENDT) effects activate
- Items can be used preemptively for (ENDT) effects

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
At the beginning of every global turn you are granted 7 Star points, which do not carry over between global turns

Star points may be expended to use an item of equivalent level

Items in the hand can only be used during your turn but you may place 3 items facedown for use when it is not your turn

You cannot use items on creatures in the hand

Once per global turn per team, a team may pay 1 point to shuffle the item shop during their turn

During your turn you can sell items for points equal to their star level. You can also sell items that are facedown at any time

You cannot sell items that have already been used, unless they specify their sell price changing

If an item is negated or destroyed during use, the star points expended to use it are still expended

Items that are negated cannot be sold, or used for any other purpose until the negation ends

Equip and active items can be negated after their activation while they are still in effect, requiring star points to be used to reactivate them

Some effects require you to draw a random item. In this case, draw from a copy of the deck until an eligible item is drawn. After the eligible item is drawn, do not replace it in the copy deck, and set aside the copy deck for next time a random item is drawn. If the entire deck is drawn and no eligible items were found, the effect will do nothing. 

Items/abilities may be used reactively to any action/ability/item/event, in which case a “reaction” begins

“Reactions” resolve before the action/ability/item/event they are reacting to resolve, and there can only be one reaction at a time

Items/abilities that are played reactively resolve backwards, except that offensive items/abilities (bomb/metronome type, or damaging abilities) resolve last and resolve forwards in the order they’re played

Items may be played from hand reactively only if its your turn

While a reaction is occuring, items cannot be bought from the shop

# Item types
There are various attributes assigned to the top left corner of items that determine how they work
- **Tomato:** Healing items that can’t be used on machine types

- **Bomb:** Offensive Items that count as an attack when used

- **Metronome:** Offensive items that do not count as an attack

- **Blue Aura:** Support Items

- **Sword:** Items that you may equip onto your own creatures. May be unequipped during your turn or if the creature dies, returning it to your hand. May be unequipped from creatures in your hand at any time. If it has a negative effect, cannot be unequipped until the start of the next global turn

- **Clock:** Same as the **Sword** icon but cannot be unequipped and are destroyed when the creature they are on die

- **Active:** Items that stay on the field with a constant affect until they are destroyed. They are not creatures, cannot have items equipped to them, and cannot be inflicted with status effects

## Field Items
Each team may have one field item active at a time for their side

Items cannot be used on field items

Field items are their own slot, and they do not have a turn

Field items cost 2x their star cost in BRICKS

You may spend 3x the star cost of a field item in BRICKS to destroy it at any time

At the beginning of the global turn or on your turn, you may spend 1x the star cost of a field item in BRICKS to negate it until the end of the global turn (field item stays on the field and can be swapped out, but loses its effect temporarily)

Field items occasionally have a clause that reduces their buy price

After a field item is bought, the shop slot does not refill

At the exact moment that a field item is acquired, the team that acquired it may swap it onto their field for free

Field items cannot be sold

Point-yielding creatures may consume an action to generate BRICKS equal to their stars

Field items can be stored in the hand, and swapped onto the field for SP equal to their level

# Status effects:
## De-buffs:
By default, de-buffs take effect and/or run out at the end of the effected creatures turn

Damage dealing de-buffs still take effect on cards in the hand, dealing damage and/or running out at the end of the Global Turn

Mutliple debuffs dealing damage at the end of a creatures turn count as separate instances of damage

Debuff durations will be specified on the card

Standard buffs/debuffs can only have one instance of themselves applied, but stacking buffs/debuffs can have any number of themselves applied

Status effects (standard and stacking) set their duration to the application with the longest duration (or longest remaining duration)

Certain Debuffs/Buffs upgrade themselves when applied  Ex: 
- *Smoldering + Smoldering -> Burning* 
- *Smoldering/Burning + Burning -> Blazing*
- *Chilled + Chilled -> Frostbite*
- *Chilled/Frostbite + Frostbite -> 1 turn of Frozen*
- *Sickness + Sickness -> Plague*

A creature already inflicted by frozen/blazing/plague can have none of the prior debuffs inflicted onto them

When upgrading effects, the upgraded effects’ duration is the highest duration from the effects used in the upgrade unless otherwise specified

### Tier 1
- **Blindness:** Afflicted attacks random enemy creature

- **Burdened:** -1 SPD, stackable, cannot effect Pandas

- **Burning:** 3DMG, can’t affect fire types

- **Chill:** -25% SPD, can’t affect ice types

- **Disgusted:** Cannot consume food

- **Enfeebled:** -1ATK, Stackable

- **Poison:** 1DMG, can’t affect machines, Stackable

- **Sickness:** -1 DEF -1 ATK -1 SPD, can’t affect machines or the undead

- **Smeckeldorfed:** 1 DMG, Stackable

- **Smoldering:** 2 DMG, can’t affect fire types

- **Softened:** -1DEF, stackable, can't affect water types

- **Thinned:** -1 MaxHP, Stackable

### Tier 2
- **Afraid:** -2 ATK, -2 SPD

- **Blazing:** 4 DMG, can’t affect fire types

- **Confusion:** Afflicted attacks random creature, and may only use actions for attacking

- **Frostbite:** -25% SPD, 2 DMG, can’t affect ice types

- **Paralyzed:** -50% SPD, can’t affect electric types

- **Plague:** -2 DEF-1ATK-2SPD, can’t affect machines or the undead

- **Restrained:** -1 Action. Stackable

- **Spirit Flame:** 2 DMG, -2 DEF

### Tier 3
- **Corruption:** Cannot affect dark matter types. When the afflicted uses its ability, it takes 3 damage. Each time the creature takes damage from this de-buff during a Global turn this de-buff does 1 less damage. This resets back to 3 damage at the beginning of the next Global turn. This debuff wears off at the end of Global Turns

- **Cursed Inferno:** 3 DMG until death

- **Frozen:** Creature cannot use actions or switch out, cannot affect ice types

- **Hexed:** If 3 creatures on one team are afflicted with hexed, then all creatures on that team receive double damage. Cards afflicted with Hex take 2 DMG at the end of the Global turn while in the hand

- **Imprisoned:** Ends at end of full turn or the end of the affected creatures turn, whichever comes last. Affected creature cannot use actions or switch out. 

- **Resentful Glare:** Each time the afflicted damages an enemy creature it takes 3 damage 

- **Suffocation:** 1 DMG, stackable

### Tier 4
- **Condemned:** Card dies in number of turns written on card. The HP that that card had the moment it died is counted as damage for the purpose of abilities or items that track damage taken

- **Contracted:** Lasts until the afflicted exits the field

- **Curse:** -1 star of item usage, this de-buff is inflicted on the entire team rather than a single creature, stackable

- **Despair:** -3ATK -1DEF -3SPD

- **Frozen in time:** The affected Creature cannot use an action, switch out, use its ability, equip items, or be healed until either it’s next turn ends, or the full turn ends, whichever comes last

- **Hemorrhaging:** 0.5 True Damage, Stackable

- **Infected:** -2 DEF +2 ATK, ability negated

- **Overridden:** Inflicted on the entire enemy team. Allows you to see all of that teams' 3 star or lower items, and use 4 stars total of these items throughout these debuff's duration(priority given to your usage over theirs) without consuming SP.

- **Withering:** 2 DMG -1ATK/DEF/SPD at the end of every turn until death

## Buffs
- **Regen:** 1HP, stackable
- **Thickened:** +1 MaxHP, stackable
- **Hardened:** +1 DEF, stackable
- **Empowered:** +1ATK, stackable
- **Peppy:** +1 SPD, stackable
- **Hyper:** +25% SPD
- **Inspired:** +1 Action on creature's next or current turn

# Attributes
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

# Rare Rulings
- When two effects happen simultaneously at the beginning of a global turn, the team with the higher cumulative SPD among all their creatures takes precedence

- If multiple attacks happen simultaneously and one of those attacks are intercepted, then the intercepted attack takes precedence and if the creature that intercepted it dies, then the creature summoned in its slot takes its share of damage

- If a simultaneous attack hits multiple creatures within the same slot, resolve all simultaneous attacks before dealing counter damage or resolving on death effects

- A creature cannot intercept while it is not on the field unless otherwise stated (cannot intercept while in hand)

- A creature being “destroyed” causes it to take enough DMG to kill it (regardless of healing or any other possible factors)

- If a creature has a debuff and the global turn ends without the creature having ended it's turn, then the debuff will tick at the end of the global turn

- If an entire copy deck is exhausted (if there are no more viable items in the entire deck), then replace it with a new copy deck

- If a creature has multiple of the same type/attribute and a field items’ effect can be stacked, then the effect is stacked per applicable type/attribute

- "Counters" are unique per creature unless otherwise stated
