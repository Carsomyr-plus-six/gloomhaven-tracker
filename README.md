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
| `app.js` | Reads `campaign.json` and fills in the page. Also works out levels, prosperity and shop prices. |
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

Achievements, party or global, and item designs look like this. Only `name` is required:

```json
{ "name": "Achievement name", "scenario": 2, "notes": "Optional" }
```

**scenarios**: one entry per scenario you've unlocked. `status` is `available`, `completed` or `blocked`. Dates are written `YYYY-MM-DD`. `treasures` lists the numbers of treasure tiles looted there, as text so leading zeros stay.

```json
{ "number": 2, "name": "Scenario name", "status": "completed", "unlockedBy": 1, "completed": "2026-10-04", "treasures": ["07"], "notes": "" }
```

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
