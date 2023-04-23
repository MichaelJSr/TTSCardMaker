# Impossibility Simulator

A Tabletop-Simulator port of a card game created by https://github.com/JasonBechdolt and maintained by friends since middle school

# Rules
**All rules apply by default unless card descriptions say otherwise**

## Start of the game
Each team starts with:
One   5-star creature
Two   4-star creatures
Three 3-star creatures
One   2 star creature (Optional, if both sides want to play with it)

Each team also starts with:
Two   4-star items
Three 3-star items
Three 2-star items
Two   1 star items

Each team starts with 2 points

A game ends when all of one team’s creatures die

A point shop is laid out, with one 4 star, two 3 stars, two 2 stars, and two 1 star. These Items may be obtained during your turn by expending points equal to 4 times the star cost of the item.

## The Field
No more or less than 3 creatures must occupy a team’s field unless they run out of creatures

The place that creatures are placed on is called the primary field, which is organized into 6 slots, 3 for each team

Each slot containing a creature takes one turn during each Global Turn

Behind the primary field is the secondary field. A creature in the secondary field cannot use its actions, but can use its ability or switch out

Any further fields (usually created by multiple layers of minions spawning) have the same restrictions as the Secondary field

A creature in the hand cannot use actions, use their ability, or have items used on it (equip items stay equipped and may be unequipped)

## Creatures and Stats
Each bar of health represents 2 HP

An increase to the max HP of a creature increases their current HP by the same amount

ATK and SPD are valued as displayed
- Changes to ATK and SPD are rounded to the nearest half

Every 2 bars of DEF block 1 bar of ATK
- Changes to DEF are rounded to the nearest whole number

Each of a creature’s stats cannot be reduced below 1 bar, except DEF and ATK which can be reduced to 0 bars

When calculating a change in stats or amount of damage dealt, Additives are Applied first and multiplicatives second

Multiplicative effects are applied additively i.e. chilled + Paralyzed = -75% SPD

Creatures have 1 “Action” per Full Turn that allows them to Attack, Defend, generate bricks, or various other card specific things

At the beginning of a creatures turn (before they use an ability or do any other action) you have the option to switch it out with another from your hand for the cost of 2 points

When a creature dies, the opposing team gains points equal to that creature’s level

If a creature is revived via item you keep the points from killing it, but killing the revived version will award no points

Creatures composed of multiple targets only award points when every single one is killed

Creatures that revive with an ability only reward points when they are fully killed

When a creature dies, and is revived, all of its stats, abilities, turn timers, or counters are reset to default

Time does not pass for a creature's abilities while it is in the hand

## Creature Types

Most creatures and minions will have a type indicated by an icon on the top left of the card.

Certain types have special effects that mostly determine what effects they are immune to or how certain items interact with them. Those are listed on the item icon or item.

Machine types (indicated by the "gears" icon) cannot have healing items be used on them

## Minions
Non protective minions occupy the same field as the summoner, and do not protect them from attacks
- Non Protective minions are designated by a sword symbol
- Protective minions are designated by a shield symbol

Protective Minions stand in front of the creature that summoned them, pushing that creature (and the non portective minions around it) back to the secondary field

Minions count as creatures for most purposes, however, are different in a few important ways, such as:
- Awarding no points when killed
- Not being able to use actions to generate bricks

Minions will stay with a creature even if it is switched out

If the creature the minions were summoned on dies, then the minions die as well

A creature has the option to summon protective minions behind itself in the secondary field

A creature can swap fields with its protective minions once during its turn, but only if both of them have 1 or more actions remaining (it does not cost an action to swap fields)

A creature that has already used an action may not use an action with a protective minion they summon

## Attacking
An attack is classified as any act that could either deal damage or inflict a negative de-buff

Damage dealt is rounded up to the nearest 1/2

After calculating damage done past DEF, apply a multiplier to the damage dealt based on the speed difference between the attacker and the target, known as Combo Damage;
- 1.5x DMG if attackers speed is double that of the targets,
- 2x DMG if triple

When a creature uses an ability to attack all creatures at once, the attacks all happen simultaneously and all count as individual attacks

Abilities that deal damage or inflict debuffs separate from the attack stat of a creature count as an attack, but do not consume an action, and cannot trigger counter damage

A decision to attack cannot be retracted if your opponent activates an item or ability during the attack 

If a creature attacks or is attacked, any de-buffs or stat changes inflicted on offense or defense are inflicted before the attack strikes, allowing those effects to alter the result of the attack

## Damage Types
Multiple damage types can be applied to an instance of damage, combining their effects.

**Normal:** Non Piercing (blocked by def at a rate of 1 per 2 DEF) 

**Piercing:** Ignores Def

**Counter:** Can only be dealt as retaliation to an attack. Does not count as an attack, and can bypass abilities and protective minions as a result

**Overkill:** Only applies when a card says so: Extra damage from one attack goes to another applicable card of your choosing, and is effected by the DEF of that chosen target

**Life steal:** The creature that deals this damage is healed by the same amount

**Shockwave:** Deals the damage listed on card to a random target on each slot of the targeted team's primary field excluding the slot of the original target, and also one random target on the secondary field behind the initial target (This does not count as an attack)

**De-buff damage:** Is piercing by default, doesn’t count as an attack, and can damage cards that are in the hand

**True damage:** Is piercing, and cannot be negated, redirected, or reduced by any means

## Defending
When a creature defends, it is turned 90 degrees, and its DEF stat doubles. This is Defense Mode

A creature that defended stays in defense mode until the beginning of their next turn

If all creatures on one side of the field are in defense mode, those creatures take 1 True Damage at the end of their turn

When a creature moves to intercept an attack, it switches out of defense mode first

## Abilities
5+ star creatures cannot have their abilities negated, except by golden metronomes

Multi Turn based abilities such as (EOT) abilities count time passing even while they are negated

Multi Turn based abilities that can be used (AAT) gain an actavation upon the start of the Global Turn after that creature has taken its turn

If an (EOT) ability is not used when available it can still be used on the next turn, but cannot be used 2 turns in a row

Minions summoned by an ability remain even if the ability that summoned them is negated or if the creature that summoned them dies (unless they were summoned on that creature that died)

Items given by an ability remain when the card is negated or dies

If a creature is negated, stats or counters gained or lost permanently via abilities are not negated

If 2 creatures attempt to negate each other simultaneously, they are both negated

Abilities that count damage dealt to creatures do not count overkill damage

## Turns
A “Global Turn” Is defined as when all slots on the field have taken a turn, and is usually brought to a close by the phrase “Turn Reset”

Order of turns are based on the 3 pairs of slots on the field, each pair composed of the two slots facing each other from each team. 

To determine which pair or "lane" goes first, identify which creature in each primary field has the highest speed, and combine each highest speed for each lane. The order of lanes is then determined by those values, highest speed first, lowest last

Within each lane the creature with the higher speed goes first

In the case of a tie in either of these cases, percentage of health remaining will be the first tiebreaker (higher health going first), and the star level of the creatures will be the second tiebreaker (higher stars go first)

Once a pair of slots have begun taking their turn, no other slot can take their turn until both of them end their turns

If a change of turn order occurs while a creature is in the middle of its turn, that creature gets to finish it’s turn

If a creature switches out to a new creature with a lower speed, then that creature’s turn can be delayed within a pair if it’s speed is lower than the other creature in the pair

Similarly, if a creature that has used an action dies mid-turn the creature that replaces it cannot use an action, but may still use its ability

# Abbreviations
- (OYT) = On your turn
- (AAT) = At any time
- (BOT) = Beginning of turn
- (ENDT) = End of turn
- (BOGT) = Beginning of global turn
- (ENDGT) = End of global turn
- (OPT) = Once per turn. Implies "on your turn (OYT)"
- (TPT) = Twice per turn. Implies "on your turn (OYT)"
- (XPT) = X times per turn (where X is a number). Implies "on your turn (OYT)"
- (EOT) = Every other turn i.e. Every second turn after ability initiates
- (EXT) = Every X turns (where X is a number)
- (OPGT) = Once per global turn. Implies "at any time (AAT)"
- (TPGT) = Twice per global turn. Implies "at any time (AAT)"
- (XPGT) = X times per global turn (where X is a number). Implies "at any time (AAT)"
- (OPG) = Once per game
- (TPG) = Twice per game
- (XPG) = X times per game (where X is a number)
- (MAX X) = Ability/passive can only be activated X amount of times per game
- (FCO) = Friendly creatures only
- (ECO) = Enemy creatures only
- (OD) = On death
- (ENF) = On entering field
- (PF) = Primary field
- (AF) = Any field
- (CD) = Counter damage

# Items
At the beginning of every Global turn you are granted 7 Star points, which do not carry over between turns

Star points may be expended to use an item of equivalent level

Items in the hand can only be used during your turn but you may place 3 items facedown for use when it is not your turn

Items can not be bought and then used from the item shop as a reactive play

Once per global turn per team, a team may pay 1 point to shuffle the item shop

During your turn you can sell items for points equal to their star level. You can also sell items that are facedown at any time

You cannot sell items that have already been used, unless they specify their sell price changing

If an item is negated or destroyed during use, the star points expended to use it are still expended

Items that are negated cannot be sold, or used for any other purpose until the negation ends

Equip and active items can be negated after their activation while they are still in effect, requiring star points to be used to reactivate them

# Item types
There are various attributes assigned to the top left corner of items that determine how they work
- **Tomato:** Healing items that can’t be used on machine types

- **Bomb:** Offensive Items that count as an attack when used

- **Metronome:** Offensive items that do not count as an attack when used

- **Blue Aura:** Support Items

- **Sword:** Equip Items that can be equipped to only your creatures. An equip item is unequipped if you choose to unequip it during your turn or if the creature dies, returning the item to your hand. Equip items with negative effects cannot be unequipped until the next full turn begins

- **Clock:** Temporary items that cannot be unequipped from the card they equip to, and are destroyed when that equipped creature is destroyed

- **Active:** Item’s that stay on the field with a constant affect until they are destroyed. Even if they have stats, they do not count as creatures, cannot have items equipped to them, and cannot be inflicted with status effects

## Field Items
Each team may have one field item active at a time for their side

Items cannot be used on field items

Field items are their own slot, and they do not have a turn

At the beginning of the game, 7 field items will be on display:
- One 4 star
- Two 3 stars
- Two 2 stars
- Two 1 stars

Field items cost 2x their star cost in BRICKS

Field items may occasionally have a clause that reduces their buy price

After a field item is bought from the shop, a new one of equal level is drawn to replace it

At the exact moment that a field item is acquired, the team that acquired it may swap it onto their field for free

Point-yielding creatures may consume an action to generate BRICKS equal to their stars

Field items can be stored in the hand, and swapped onto the field for SP equal to their level

# Status effects:
## De-buffs:
By default, de-buffs take effect and/or run out at the end of the effected creatures turn

Damage dealing de-buffs still take effect on cards in the hand, dealing damage and/or running out at the end of the Global Turn

Mutliple debuffs dealing damage at the end of a creatures turn count as separate instances of damage

Debuff durations will be specified on the card

Standard Debuffs can only have one instance of themselves applied to a creature, but stacking debuffs can have any number of themselves applied

Certain Debuffs/Buffs upgrade themselves when applied  Ex: 
- *Smoldering + Smoldering -> Burning* 
- *Smoldering/Burning + Burning -> Blazing*
- *Chilled + Chilled -> Frostbite*
- *Chilled/Frostbite + Frostbite -> Frozen*
- *Chilled/Frostbite + Smoldering/Burning -> FrostBurn*

A creature already inflicted by frozen/blazing can have none of the prior debuffs inflicted onto them

### Tier 1
- **Blindness:** Afflicted attacks random enemy creature

- **Burdened:** -1 SPD, stackable, cannot effect Pandas

- **Burning:** 3DMG, can’t affect fire types

- **Chill:** -25% SPD, can’t affect ice types

- **Disgusted:** Cannot consume food

- **Enfeebled:** -1ATK, Stackable

- **Poison:** 1DMG, can’t affect machines, Stackable

- **Sickness:** -1 DEF -1 ATK -1 SPD, can’t affect machines or the undead

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
## Profession
- Business
- Dancer
- Engineer
- Vehicle
- Industrial
- Brute
- Rogue
- Reconnaissance
- Military
- Veteran
- Martial Artist
- Mage
- Trickster
- Leadership
- Royalty
- Prodigy
- Higher Being
- God

## Aspect
- Nature
- Humanoid
- Mythical
- Monster
- Demon
- Spiritual
- Haunted
- Spectral
- Vessel
- Infected

# Rare Rulings
- When two effects happen simultaneously at the beginning of a global turn, the team with the higher cumulative SPD among all their creatures takes precedence

- If multiple attacks happen simultaneously and one of those attacks are intercepted, then the intercepted attack takes precedence and if the creature that intercepted it dies, then the creature summoned in its slot takes its share of damage
