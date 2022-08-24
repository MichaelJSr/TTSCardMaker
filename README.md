# Heroes In The Dark

A Tabletop-Simulator port of a card game created by https://github.com/JasonBechdolt and maintained by friends since middle school

# Rules
**All rules apply by default unless card description says otherwise**

## Start of the game
Each team starts with one 5-star creature, two 4-star creatures, and three 3-star creatures

Additionally, you may add one or two 2-star creatures to your hand or one 6-star creature, as well as four 1 or 2-star items three 3-star items and two 4-star items

A game ends when all of one team’s creatures die

A point shop is laid out, with one 4 star, two 3 stars, and three 1 or 2 stars. These Items may be obtained during your turn by expending points equal to 4 times the star cost of the item

## The Field
No more or less than 3 creatures must occupy a team’s field unless they run out of creatures

The place that creatures are placed on is called the primary field, which is organized into 6 slots, 3 for each team

Each slot containing a creature takes one turn during each full turn

Behind the creatures is the secondary field. A creature in the secondary field, cannot Attack, be Attacked, or Defend, but can use its ability or switch out

Any further fields (usually created by multiple layers of minions spawning) have the same restrictions as the Secondary field

A creature in the hand cannot attack, defend, use their ability, or have items used on it (equip items stay equipped and may be unequipped)

## Creatures
Each bar of health represents 2 units of health

An increase to the max HP of a creature increases their current HP by the same amount

ATK and SPD are valued as displayed

Changes to ATK and SPD are rounded to the nearest half

Every 2 bars of defense block 1 unit of attack

Each of a creature’s stats cannot go below one bar

When calculating a change in stats or amount of damage dealt, additives are calculated first and multiplicatives second

Creatures have 1 “Action” per Full Turn that allows them to either Attack or Defend

At the beginning of a creatures turn (before they use an ability or do any other action) you have the option to switch it out with another from your hand for the cost of 1 point

When a creature dies, the opposing team gains points equal to that creature’s level

If a creature is revived via item you keep the points from killing it, but killing the revived version will award no points

Creatures composed of multiple targets only award points when every single one is killed

Creatures that revive with an ability only reward points when they are fully killed

When a creature dies, and is revived, all of its stats, abilities, turn timers, or counters are reset to default

Time does not pass for a creature's abilities while it is in the hand

## Minions
Protective Minions stand in front of the creature that summoned them, pushing that creature back to the secondary field

Non protective minions occupy the same field as the summoner, and do not protect them from attacks

Minions count as creatures for most purposes, however, are different in a few important ways, such as:
- Awarding no points when killed
- Not being able to go into DEF

All minions summoned on the same creature are placed in the same field as each other, unless some are protective, which will push the creature and the non-protective minions back to the secondary field

Minions will stay with a creature even if it is switched out

If the creature the minions were summoned on dies, then the minions die as well

A creature has the option to summon protective minions behind itself in the secondary field

A creature can swap fields with its minions during its turn

A creature that has already attacked or defended may not attack or defend with the minion they summon

A creature that has attacked cannot move a minion from behind it into a protective position

## Attacking
An attack is classified as any act that could either deal damage or inflict a negative de-buff

After calculating damage done past DEF, apply a multiplier to the damage dealt based on the speed difference between the attacker and the target (1.5x DMG if attackers speed is double that of the targets, 2x DMG if triple, etc.), known as Combo Damage

When a creature uses an ability to attack all creatures at once, the attacks all happen simultaneously and all count as individual attacks

If a creature’s attacks or is attacked, any de-buffs inflicted on offense or defense are inflicted before the attack strikes, allowing effects that change stats to effect damage dealt by that attack

When attacking you cannot retract a decision to attack due to an item being used, but you can retract an attack if a non-counter damage ability is used, such as miracle matter choosing a form

Abilities that deal damage separate from the attack stat of a creature count as an attack, but do not consume an action, and cannot trigger counter damage
Damage dealt is rounded up to the nearest 1/2

## Damage Types
**Normal:** blocked by def at a rate of 1 per 2 DEF

**Piercing:** Ignores Def

**Counter:** Does not count as an attack, and can bypass abilities and minions as a result

**Overkill:** Only applies when a card says so: Extra damage from one attack goes to another applicable card of your choosing, and is reduced by defense

**Life steal:** The creature that deals this damage is healed by the same amount

**Shockwave:** Deals the damage listed on card to a random target on each slot of the primary field besides that of the original target, and also one random target on the secondary field behind the initial target (This does not count as an attack)

**De-buff damage:** Is piercing by default, doesn’t count as an attack, and can damage cards that are in the hand

## Defending
When a creature defends, it is turned 90 degrees, and its DEF stat doubles. This is Defense Mode

A creature that defended stays in defense mode until the beginning of their next turn

If all creatures on the field are in defense mode, they all take 1 piercing counter damage at the end of their turn

## Abilities
5 star creatures cannot have their abilities negated, except by golden metronomes

(EOT) Abilities only start counting time after the ability enters the field

(EOT) abilities count time passing even while they are negated

(EOT) (AAT) Abilities can be used immediately after the 1st turn/3rd turn/ 5th turn of the creature ends

If an (EOT) ability is not used when available it can still be used on the next turn, but cannot be used 2 turns in a row

Minions summoned by an ability remain even if the ability that summoned them is negated or if the creature that summoned them dies (unless they were summoned on that creature)

Items given by an ability remain when the card is negated or dies

If a creature is negated, stats or counters gained or lost permanently via abilities are not negated

Negation from a metronome ends at the end of a full turn

If a creature is killed by an insta kill ability, The HP that that creature had the moment it died is counted as damage for the purpose of abilities or items that track damage taken

## Turns
A “Full Turn” Is defined as when all slots on the field have taken a turn, and is usually brought to a close by the phrase “Turn Reset”

Order of turns are based on pairs of creatures, a pair being the two creatures across from each other. The pair with the highest speed goes first, if two individuals with the same speed are in a pair, the one with the higher health percentage remaining goes first, if they have the same health, flip a coin

If one side of a field has multiple creatures or minions occupying one slot on the primary field, then the creature or minion with the highest speed determines when that group of creatures takes their turn

If a change of turn order occurs while a creature is in the middle of its turn, that creature gets to finish it’s turn

If a creature switches out to a new creature with a lower speed, then that creature’s turn can be delayed if it’s speed effects the turn order

If a creature that already took its turn dies, the creature summoned to replace it cannot take its turn until next turn

Similarly, if a creature that has used an action dies mid-turn the creature that replaces it cannot use an action, but may still use its ability 

# Abbreviations
- (OYT) = On your turn
- (AAT) = At any time
- (OPT) = Once per turn
- (TPT) = Twice per turn
- (EOT) = Every other turn i.e. Every second turn after ability initiates
- (OPG) = Once per game
- (TPG) = Twice per game
- (MAX x) = Ability/passive can only be activated x amount of times per game
- (BOT) = Beginning of Turn
- (FCO) = Friendly creatures only
- (OD) = On Death
- (PF) = Primary Field
- (CD) = Counter Damage

# Items
At the beginning of every turn you are granted 7 Star points

Star points may be spent to use an item of equal level to the points you expended

Items in the hand can only be used during your turn but you may place 3 items facedown for use when it is not your turn

During your turn you can sell items for points equal to their star level. You can also sell items that are facedown at any time

You cannot sell items that have already been used, unless they specify their sell price changing

If an item is negated or destroyed during use, the star points expended to use it are still expended

Items that are negated cannot be sold, or used for any other purpose until the negation ends

In order to prevent the use of an item, it must be revealed by an effect or in use

Equip and active items can be negated after their activation while they are still in effect

# Attributes
There are various attributes assigned to the top left corner of items that determine how they work
- **Tomato:** Healing items that can’t be used on machines

- **Bomb:** Offensive Items that count as an attack when used

- **Metronome:** Offensive items that do not count as an attack when used

- **Shield:** Defensive Item

- **Blue Aura:** Item’s that are difficult to classify as either offensive or defensive, and tend to have complex and unique effects

- **Sword:** Equip Items that can be equipped to only your creatures. An equip item is unequipped if you choose to unequip it during your turn or if the creature dies, returning the item to your hand. Equip items with negative effects cannot be unequipped until the next full turn begins

- **Active:** Item’s that stay on the field with a constant affect until they are destroyed. For all intents and purposes, active items count as minions if they have stats

- **Clock:** Temporary items usually created by a creature’s ability, that cannot be unequipped from the card they equip to, and are destroyed when that equipped creature is destroyed

# Status effects:
## De-buffs:
By default, de-buffs take effect and/or run out at the end of the effected creatures turn

Damage dealing de-buffs still take effect on cards in the hand, dealing damage and/or running out at the end of the full turn

Only one of each de-buff/ buff can be applied to a creature, but certain buffs and de-buffs work in special ways when it is applied to the same creature twice

Poison, Venom, Burdened, Shackled, regen, and peppy are a number of times more powerful equal to the amount of times they were inflicted, the duration of the de-buff is also reset when it is stacked on itself

Fire and Ice based conditions upgrade themselves when inflicted twice

*Smoldering -> Burning -> Blazing*

*Chilled -> Frostbite -> Frozen*

Ex: Chill applied twice becomes Frostbite, when applied again, the target is both chilled and frostbitten, if chilled one more time, then the 2 chilled become another Frostbite which combines with the other Frostbite to Freeze the creature

### Tier 1
- **Chill:** -25% SPD 2 turns, can’t affect ice types

- **Confusion:** 2 turns, Afflicted attacks random creature, and cannot go into DEF mode

- **Poison:** 1DMG 5 turns, can’t affect machines

- **Blindness:** 2 turns, Afflicted attacks random enemy creature

- **Sickness:** -1 DEF -1 ATK -1 SPD 3 turns, can’t affect machines or the undead

- **Burning:** 3DMG 2 turns, can’t affect fire types

- **Smoldering:** 2 DMG 2 turns, can’t affect fire types

- **Frost bite:** -25% SPD 2 DMG 2 turns, can’t affect ice types

- **Sleep:** Afflicted creature cannot Attack, Defend, switch out, or use its ability until the end of the full turn, or until they take damage, if they take damage after they spent a turn asleep, they are given the chance to take that turn again immediately

### Tier 2
- **Frozen:** Creature cannot attack, defend, or switch out for 1 turn, cannot affect ice types

- **Spirit Flame:** 2 DMG, -2 DEF, 2 turns

- **Blazing:** 4 DMG 2 turns, can’t affect fire types

- **Paralyzed:** -50% SPD 2 turns, can’t affect electric types

- **Softened:** -3DEF 3 turns

- **Venom:** 2 DMG 5 turns, can’t affect machines

- **Plague:** -2 DEF-1ATK-2SPD 3 turns, can’t affect machines or the undead

- **Enfeebled:** -2 ATK 2 turns

- **Doused:** -50% DEF and -25% ATK, can only effect fire types

### Tier 3
- **Hexed:** If 3 creatures on one team are afflicted with hexed, then all creatures on that team receive double damage. Cards afflicted with Hex take 2 DMG at the end of the full turn while in the hand

- **Burdened:** -1 SPD 2 turns

- **Imprisoned:** Ends at end of full turn or the end of the affected creatures turn, whichever comes last. Affected creature cannot attack, defend or switch out. The card that dealt the imprisonment and the one imprisoned have any damage dealt to them split between them

- **Cursed Inferno:** 3 DMG until death

- **Condemned:** After the amount of turns said on card have passed, the affected creature receives piercing damage equal to Its max HP that cannot be reduced by damage reduction

- **Corruption:**  3 turns, cannot affect dark matter types. When the afflicted uses its ability, it takes 3 damage. Each time the creature takes damage from this de-buff during a full turn this de-buff does 1 less damage. This resets back to 3 damage at the beginning of the next full turn

### Tier 4
- **Condemned:** Card dies in number of turns written on card. The HP that that card had the moment it died is counted as damage for the purpose of abilities or items that track damage taken

- **Withering:** -2HP -1ATK/DEF/SPD at the end of every turn until death

- **Frozen in time:** The affected Creature cannot use an action, switch out, use its ability, equip items, or be healed until either it’s next turn ends, or the full turn ends, whichever comes last

- **Stasis:** The affected Creature cannot use an action, switch out, use its ability, equip items, or be damaged until either its next turn ends, or the full turn ends, whichever comes last

- **Curse:** -3 stars item usage duration specified on card, this de-buff is inflicted on the entire team rather than a single creature

- **Overridden:** Described on card, this de-buff is inflicted on the entire team rather than a single creature

## Buffs
- **Regen:** 1HP 3 turns, can be stacked
- **Peppy:** +1 SPD 3 turns, can be stacked
- **Hyper:** +25% SPD
- **Inspired:** 1 turn, Creature has 1 extra action (ATK or DEF)
