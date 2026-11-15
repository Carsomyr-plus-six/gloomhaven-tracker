# Gloomhaven Campaign Tracker

A small website for tracking our Gloomhaven (first edition) campaign: the party, the city, scenarios, characters and a session log.

Live site: https://carsomyr-plus-six.github.io/gloomhaven-tracker/

It runs on GitHub Pages, so it works on phones and desktops without installing anything. On a phone it is four tabs along the bottom, made to be read at the table; on a wide screen the whole campaign is one page. Campaign data lives in this repository, so every change is a commit and the history of the campaign is the history of the repo.

## Files

| File | What it is |
| --- | --- |
| `campaign.json` | The campaign itself. Edit it by hand, or record a session on the page and replace it with the file that gives you. |
| `index.html` | The page skeleton: header, tabs, empty sections. |
| `styles.css` | How it looks: one dark theme, with the phone layout at the bottom of the file. |
| `app.js` | Reads `campaign.json` and fills in the page, with a "Before you play" list on the Overview of everything waiting on the party (perks to choose, random draws, open questions, item and perk flags). Also works out levels, the scenario level for whoever is playing (with monster level, gold per coin, trap damage and bonus XP), reputation and prosperity, event outcomes and decks, achievements, item designs, unlocked classes, what treasures gave, the shop (stock, prices, who carries what), the unlock map, and which scenarios are unlocked or blocked. Builds an updated `campaign.json` from a recorded session. |
| `data/gloomhaven-scenarios.json` | Reference data for all 95 scenarios: unlocks, blocks, requirements, rewards; and what each treasure tile gives. Generated, don't edit by hand. **Contains spoilers.** |
| `data/gloomhaven-events.json` | Reference data for city and road events: starting decks, and each option's outcomes: the condition, what happens to the card, and the effects (reputation, prosperity, gold, XP, achievements, cards added, scenarios unlocked), plus each class's unlock and retirement events and its perks (worded as on the character sheet, with their boxes). No event text. Generated, **contains spoilers**. |
| `data/gloomhaven-items.json` | Reference data for the 150 items: name, cost, copies, slot, and the prosperity that puts them in the shop. No item text. Generated, **contains spoilers**. |
| `tools/update_scenario_data.py` | Regenerates the three reference files: `py tools/update_scenario_data.py` |
| `examples/sample-campaign.json` | Made-up data for testing. View it at `?data=examples/sample-campaign.json`. |

## Recording a session

At the table, open **Sessions** and choose **Record a session**. Fill in:
- the date and who played
- each scenario attempted, with the result and what each character gained there (XP, gold, battle goal checkmarks)
- the treasures looted and who looted them
- the events drawn, with the option
- items bought or sold, perks taken, and donations to the Sanctuary (10 gold each, once per player per visit)
- whether you opened Envelope B, once donations reach 100 gold

The page adds scenario rewards and treasure gold and XP to the characters itself, and lists every change, with anything that looks wrong, before you save.

The site has nowhere to save, so **Download campaign.json** (or **Copy to clipboard**) gives you the updated file. Put it in place of `campaign.json` in the repository and commit it. Until then the draft stays in that browser, so a reload at the table loses nothing; **Discard draft** clears it.

Some rewards still need a hand edit afterwards, and the page says so: gold to share between the party, and a choice of location.

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

The page looks up what each treasure gave: item designs go to the shop and unlocked scenarios open. A treasure can also be written out to say who looted it and, for a random side scenario or item design, what you drew. Until a random one is drawn, the Campaign record reminds you.

```json
"treasures": [{ "number": "07", "character": "Craig", "drew": 52 }, { "number": "11", "drew": "Item name" }]
```

`results` is optional: what each character got from the scenario. `xp` and `gold` are what they gained there; `checkmarks` are from battle goals. These are shown on the scenario but not added to the character totals automatically.

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
  "name": "Grunt", "class": "Brute", "player": "Alex",
  "xp": 102, "gold": 35, "checkmarks": 4,
  "perks": ["..."], "items": ["..."],
  "personalQuest": "", "retired": false, "notes": ""
}
```

**sessions**: one entry per evening of play. `result` is `success` or `failure`. An optional `title` names a session, for example one without a date.

```json
{
  "date": "2026-10-04",
  "scenarios": [{ "number": 2, "result": "success" }],
  "characters": ["Grunt", "Sparks"],
  "notes": ""
}
```

**events**: city and road events drawn, in order, with the option chosen. The tracker works out which outcome you got, what it did to reputation and prosperity, and the decks. `scenario` is the scenario it was drawn before (optional); an event without one counts as happening just after the event listed before it.

Many outcomes depend on something on the table. The tracker checks these itself where it can:

- **Who was there**: `characters` lists everyone in the party at the event, by character name. Left out, it comes from the session the `scenario` was played in. List the whole party: a class that isn't listed counts as not there.
- **Reputation**: checked against reputation as it stood then.
- **Paying**: add `"paid": true` or `"paid": false`.

The Overview asks when it can't tell. `"outcome": 1` (counting from 1) picks an outcome by hand, and `"card": "removed"` or `"returned"` overrides what happened to the card.

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

This is an unofficial fan project. Gloomhaven and its content are © Cephalofair Games.
