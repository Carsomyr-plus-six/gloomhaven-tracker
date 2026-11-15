# Gloomhaven Campaign Tracker

A small website for tracking our Gloomhaven (first edition) campaign: the party, the city, scenarios, characters and a session log.

Live site: https://carsomyr-plus-six.github.io/gloomhaven-tracker/

It runs on GitHub Pages, so it works on phones and desktops without installing anything. Campaign data lives in this repository, so every change is a commit and the history of the campaign is the history of the repo.

## Files

| File | What it is |
| --- | --- |
| `campaign.json` | The campaign itself. This is the file you edit. |
| `index.html` | The page skeleton: header, tabs, empty sections. |
| `styles.css` | How it looks, including dark mode. |
| `app.js` | Reads `campaign.json` and fills in the page. Also works out levels, prosperity, shop prices, and which scenarios are unlocked or blocked. |
| `data/gloomhaven-scenarios.json` | Reference data for all 95 scenarios: unlocks, blocks, requirements, rewards. Generated, don't edit by hand. **Contains spoilers.** |
| `tools/update_scenario_data.py` | Regenerates the reference data: `py tools/update_scenario_data.py` |
| `examples/sample-campaign.json` | Made-up data for testing. View it at `?data=examples/sample-campaign.json`. |

## Running it locally

Browsers won't load `campaign.json` from a page opened straight from disk, so run a small web server in this folder:

```
py -m http.server 8000
```

Then open http://127.0.0.1:8000/. Stop the server with Ctrl+C.

## The data format

`campaign.json` has these parts. Anything left out falls back to an empty value.

**party**: `name`, `reputation` (a number, can be negative), `location`, `achievements`, `notes`.

**city**: `prosperityCheckmarks` (the total; the page works out the prosperity level), `donations` (total gold given to the Sanctuary), `globalAchievements`, `unlockedClasses` (a list of class names), `itemDesigns` (items added to the shop permanently).

Achievements, party or global, and item designs look like this. Only `name` is required. Spell achievement names as the game does: scenario requirements are checked against them. Add `"count": 2` for an achievement gained more than once.

```json
{ "name": "Achievement name", "scenario": 2, "notes": "Optional" }
```

**scenarios**: list the scenarios you've **completed**. Everything else (which scenarios are unlocked, which are blocked and why, and the rewards) is worked out from the reference data. Dates are written `YYYY-MM-DD`. `treasures` lists the numbers of treasure tiles looted there, as text so leading zeros stay. `name` is optional and only there to make the file easier to read.

```json
{ "number": 2, "name": "Barrow Lair", "status": "completed", "completed": "2026-10-04", "treasures": ["07"], "notes": "" }
```

Add an entry that isn't completed only when the reference data can't know about it:

- A scenario unlocked some other way (a choice, a treasure, an event): `{ "number": 15, "status": "available", "unlockedBy": 13 }`
- A scenario you've decided to treat as blocked: `{ "number": 5, "status": "blocked", "notes": "Why" }`

**characters**: the page works out the level from `xp` and the perks earned from `checkmarks`. Set `retired` to `true` when a character retires.

```json
{
  "name": "Grunt", "class": "Brute", "player": "Alex",
  "xp": 102, "gold": 35, "checkmarks": 4,
  "perks": ["..."], "items": ["..."],
  "personalQuest": "", "retired": false, "notes": ""
}
```

**sessions**: one entry per evening of play. `result` is `success` or `failure`.

```json
{
  "date": "2026-10-04",
  "scenarios": [{ "number": 2, "result": "success" }],
  "characters": ["Grunt", "Sparks"],
  "notes": ""
}
```

## Credits and license

Scenario data comes from [Gloomhaven Secretariat](https://github.com/Lurkars/gloomhavensecretariat) by Lurkars and contributors, licensed under the GNU Affero General Public License v3.0. This project uses the same license; see [LICENSE](LICENSE).

This is an unofficial fan project. Gloomhaven and its content are © Cephalofair Games.
