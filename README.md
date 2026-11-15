# Gloomhaven Campaign Tracker

A small website for tracking our Gloomhaven (first edition) campaign: the party, the city, scenarios, characters and a session log.

Live site: https://carsomyr-plus-six.github.io/gloomhaven-tracker/

It runs on GitHub Pages, so it works on phones and desktops without installing anything. On a phone it is four tabs along the bottom, made to be read at the table; on a wide screen the whole campaign is one page. The first time a phone opens it, it asks which character you play, and from then on opens on that character's sheet (a link to another part of the page still goes there). That tab then carries the character's name and class icon, marks them "You" among the party, and goes back to their sheet whenever it's tapped; the Shop says how much gold they have and which items would fit. The choice is kept in that phone's browser only, and can be changed at the bottom of the sheet. Campaign data lives in this repository, so every change is a commit and the history of the campaign is the history of the repo.

## Files

| File | What it is |
| --- | --- |
| `campaign.json` | The campaign itself. Edit it by hand, or record a session on the page and replace it with the file that gives you. |
| `index.html` | The page skeleton: header, tabs, empty sections. |
| `styles.css` | How it looks: one dark theme, with the phone layout at the bottom of the file. |
| `app.js` | Reads `campaign.json` and fills in the page, with a "Before you play" list on the Overview of everything waiting on the party (perks to choose, random draws, open questions, item and perk flags). Also works out levels, the scenario level for whoever is playing (with monster level, gold per coin, trap damage and bonus XP), reputation and prosperity, event outcomes and decks, achievements, item designs, unlocked classes, what treasures gave, the shop (stock, prices, who carries what), what an enhancement costs once the Enhancer is open (from the sticker, the card's level, whether the ability targets more than one, and the stickers already on the action), the unlock map, and which scenarios are unlocked or blocked. Builds an updated `campaign.json` from a recorded session. |
| `data/gloomhaven-scenarios.json` | Reference data for all 95 scenarios: unlocks, blocks, requirements, rewards; and what each treasure tile gives. Generated, don't edit by hand. **Contains spoilers.** |
| `data/gloomhaven-events.json` | Reference data for city and road events: starting decks, and each option's outcomes: the condition, what happens to the card, and the effects (reputation, prosperity, gold, XP, achievements, cards added, scenarios unlocked), plus each class's unlock and retirement events and its perks (worded as on the character sheet, with their boxes). No event text. Generated, **contains spoilers**. |
| `data/gloomhaven-items.json` | Reference data for the 150 items: name, cost, copies, slot, and the prosperity that puts them in the shop. No item text. Generated, **contains spoilers**. |
| `tools/update_scenario_data.py` | Regenerates the three reference files: `py tools/update_scenario_data.py` |
| `icons/` | Game icons from the Gloomhaven Creator Pack: elements and conditions in perk text, class icons, item slots, the battle-goal checkmark, and whether an event card was removed or returned. Generated, don't edit by hand. Licensed CC BY-NC-SA 4.0, not AGPL; see `icons/README.md`. |
| `tools/creator_pack_icons.py` | Remakes `icons/` from the Creator Pack zip: `py tools/creator_pack_icons.py "path/to/Creator Pack V2.zip"` (needs `pypdf`). |
| `examples/sample-campaign.json` | Made-up data for testing. View it at `?data=examples/sample-campaign.json`. |

## Recording a session

At the table, open **Sessions** and choose **Record a session**. Fill in:
- the date and who played
- each scenario attempted, with its level, the result, and for each character the XP on their dial, the coins they picked up and their battle goal checkmarks
- the treasures looted and who looted them
- the events drawn, with the option
- characters retiring, with the class their personal quest unlocks (picked by its icon, so nothing is spoiled), and new characters joining
- items bought or sold, perks taken, and donations to the Sanctuary (10 gold each, once per player per visit)
- whether you opened Envelope B, once donations reach 100 gold

The page does the end-of-scenario sums itself:
- **XP and gold.** It adds the bonus XP for the scenario's level on a success, and turns coins into gold at that level's rate. Each character's row shows what it comes to. The level starts at tonight's level from the Overview, and the page says if it's outside easy to very hard for the party.
- **Rewards and treasures.** Scenario rewards and treasure gold and XP go to the characters.
- **Level-ups.** Anyone who passes a level is told to add an ability card and take a perk. Until the next session, **Before you play** reminds them about the card.
- **New characters.** A new character starts at any level up to the prosperity level, with that level's XP and 15 gold per level plus 15. They can buy their first items in the same session.

It lists every change, with anything that looks wrong, before you save. A bar at the top of the form says how many things there are to check.

A perk to choose can also be recorded straight from **Before you play** on the Overview, or from the character's sheet: **Record it** opens the form with a perk row for that character. Once picked, the perk stops being asked for while the draft waits to be saved.

Only an evening of play goes in the session log: a perk taken, an item bought or a donation made between sessions changes the characters and city, and adds no session.

The site has nowhere to save, so it hands you the updated file:
- **Copy and edit on GitHub** (on the live site) copies it and opens `campaign.json` in GitHub's editor, which works on a phone too: select everything, paste, and commit.
- **Download campaign.json** or **Copy to clipboard**: put it in place of `campaign.json` in the repository and commit it.

Until then the draft stays in that browser, so a reload at the table loses nothing; **Discard draft** clears it. The file the page hands you carries the draft's id as `lastDraft`, so once it's in `campaign.json` the page notices on its next load and clears the draft itself, and nothing can be recorded twice.

Some things still need a hand edit afterwards, and the page says what to write: gold to share between the party, a choice of location, a random scenario or item design once drawn, and the option of an event recorded without one.

## Running it locally

Browsers won't load `campaign.json` from a page opened straight from disk, so run a small web server in this folder:

```
py -m http.server 8000
```

Then open http://127.0.0.1:8000/. Stop the server with Ctrl+C.

## The data format

`campaign.json` has these parts. Anything left out falls back to an empty value.

**party**: `name`, `location`, `achievements`, `notes`.

**city**: `donations` (total gold given to the Sanctuary; the Overview counts down to the 100 gold that opens Envelope B), `envelopeB` (`true` once you've opened Envelope B; from then on the page follows what it says about donations, as Gloomhaven Secretariat counts it), `globalAchievements`, `unlockedClasses` (a list of class names), `itemDesigns` (items added to the shop permanently).

Achievements, item designs and unlocked classes are mostly worked out, so these lists are usually empty. The page takes them from scenario rewards, event outcomes and treasures; the starting classes are always unlocked; a new City Rule or Artifact replaces the old one; and lost party achievements are dropped. List something here only when nothing else records it, such as a class unlocked by a retirement. The Overview says when an entry is already worked out.

Hand-listed achievements and item designs look like this. Only `name` is required. Spell achievement names as the game does: scenario requirements are checked against them. Add `"count": 2` for an achievement gained more than once.

```json
{ "name": "Achievement name", "scenario": 2, "notes": "Optional" }
```

Reputation and prosperity aren't written down: the page adds them up from the rewards of completed scenarios, the outcomes of events, one prosperity checkmark per retired character, and any `adjustments`. When an event's outcome isn't known, the Overview shows the range it could be and asks about it. Open the tile to see where the number comes from.

**scenarios**: list the scenarios you've **completed**, in the order you played them. Everything else (which scenarios are unlocked, which are blocked and why, and the rewards) is worked out from the reference data. Dates are written `YYYY-MM-DD`. `treasures` lists the numbers of treasure tiles looted there, as text so leading zeros stay. `name` is optional and only there to make the file easier to read.

```json
{ "number": 2, "name": "Barrow Lair", "status": "completed", "completed": "2026-10-04", "treasures": ["07"], "notes": "" }
```

The page looks up what each treasure gave: item designs go to the shop and unlocked scenarios open. A treasure can also be written out to say who looted it and, for a random side scenario or item design, what you drew. Until a random one is drawn, the Campaign record reminds you; `"drawn": false` says it never was and won't be, and stops the reminder.

```json
"treasures": [{ "number": "07", "character": "Craig", "drew": 52 }, { "number": "11", "drew": "Item name" }]
```

`results` is optional: what each character got from the scenario. `xp` and `gold` are what they gained there; `checkmarks` are from battle goals. These are shown on the scenario but not added to the character totals automatically. A session recorded on the page writes them with the bonus XP and coins already worked in.

```json
"results": [
  { "character": "Azorica", "xp": 15, "gold": 10, "checkmarks": 1 }
]
```

Add an entry that isn't completed only when the reference data can't know about it:

- A scenario unlocked some other way (a choice, a treasure, an event): `{ "number": 15, "status": "available", "unlockedBy": 13 }`
- A scenario you've decided to treat as blocked: `{ "number": 5, "status": "blocked", "notes": "Why" }`

**characters**: the page works out the level from `xp` and the perks earned from `checkmarks`. Set `retired` to `true` when a character retires: the page adds a prosperity checkmark and the class's retirement events. Write `perks` as the character sheet words them: the page matches them to the class's perks, ignoring small differences such as a missing "rolling", flags one that isn't on the sheet (with the closest match) or is taken more often than it has boxes, and lists the perks still open when one is due. It also checks `items` against the slots a character has: one head, body and legs item, two hands, and small items up to half their level, rounded up. Spell `items` as the item cards do: the Shop counts those copies as out of stock (a retired character's items go back) and flags an item it doesn't know or doesn't sell yet. Personal quests are secret, so `personalQuest` holds only the progress (like `"2/15"`), never the quest's name.

```json
{
  "name": "Grunt", "class": "Brute",
  "xp": 102, "gold": 35, "checkmarks": 4,
  "perks": ["..."], "items": ["..."],
  "personalQuest": "", "retired": false, "notes": ""
}
```

**sessions**: one entry per evening of play. `result` is `success` or `failure`, and `level` (optional) is the scenario level it was played at. An optional `title` names a session, for example one without a date. `levelUps` (optional, written by the page) lists who passed a level that evening, so **Before you play** can remind them to add an ability card.

```json
{
  "date": "2026-10-04",
  "scenarios": [{ "number": 2, "level": 1, "result": "success" }],
  "characters": ["Grunt", "Sparks"],
  "notes": "",
  "levelUps": [{ "character": "Grunt", "level": 2 }]
}
```

**events**: city and road events drawn, in order, with the option chosen. The tracker works out which outcome you got, what it did to reputation and prosperity, and the decks. `scenario` is the scenario it was drawn before (optional); an event without one counts as happening just after the event listed before it.

Many outcomes depend on something on the table. The tracker checks these itself where it can:

- **Who was there**: `characters` lists everyone in the party at the event, by character name. Left out, it comes from the session the `scenario` was played in. List the whole party: a class that isn't listed counts as not there.
- **Reputation**: checked against reputation as it stood then.
- **Paying**: add `"paid": true` or `"paid": false`.

The Overview asks when it can't tell. `"outcome": 1` (counting from 1) picks an outcome by hand, and `"card": "removed"` or `"returned"` overrides what happened to the card. If the option can't be known any more, `"unknown": true` stops the questions: reputation and prosperity keep the range the event could have given.

```json
{ "deck": "city", "number": 29, "option": "A", "characters": ["Craig", "Azorica"], "scenario": 8 }
```

**adjustments**: changes to reputation or prosperity that nothing else records, such as a correction. Optional `scenario` puts it just before that scenario; otherwise it counts at the end.

```json
"adjustments": [{ "reputation": -1, "prosperity": 0, "notes": "Why" }]
```

An event that gives a random item design takes `"drew": "Item name"` once you've drawn it.

**eventDecks**: cards added or removed some other way. Events added by other events, scenario rewards, unlocking a class or a retirement are already counted: `{ "added": [{ "deck": "road", "number": 31, "notes": "Why" }], "removed": [] }`.

## Credits and license

Scenario and event data comes from [Gloomhaven Secretariat](https://github.com/Lurkars/gloomhavensecretariat) by Lurkars and contributors, licensed under the GNU Affero General Public License v3.0. This project uses the same license; see [LICENSE](LICENSE).

The icons in `icons/` come from the [Gloomhaven Creator Pack](https://boardgamegeek.com/thread/1733586/files-for-creation) by Isaac Childres / Cephalofair Games, shared under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). They have been converted to SVG, cropped, and in three cases recoloured. They stay under CC BY-NC-SA 4.0, not the AGPL; see [icons/README.md](icons/README.md).

This is an unofficial fan project. Gloomhaven and its content are © Cephalofair Games.
