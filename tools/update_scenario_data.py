"""Download Gloomhaven (1st edition) scenario and event data from Gloomhaven Secretariat.

Keeps only what the tracker needs and writes two files:
- data/gloomhaven-scenarios.json: names, unlocks, blocks, requirements,
  rewards and achievement names.
- data/gloomhaven-events.json: the starting city and road decks, and for each
  event option whether the card is removed or returned, which cards it adds
  and which scenarios it unlocks. No event text is copied.

Source: https://github.com/Lurkars/gloomhavensecretariat (AGPL-3.0)

Run from the repository root:
    py tools/update_scenario_data.py
"""

import json
import urllib.request
from datetime import date
from pathlib import Path

REPO = "Lurkars/gloomhavensecretariat"
RAW = f"https://raw.githubusercontent.com/{REPO}/main/data/gh"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUTPUT = DATA_DIR / "gloomhaven-scenarios.json"
EVENTS_OUTPUT = DATA_DIR / "gloomhaven-events.json"

# Fields copied from each scenario file. Map layouts and monsters are left out.
FIELDS = ["name", "unlocks", "blocks", "requires", "requirements", "rewards", "links"]


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


# Requirement values that the source writes as a display name or misspells.
ALIASES = {"dept collection": "debt-collection"}


def normalize_requirements(requirements, labels):
    """Make every requirement an achievement id, keeping "!" (must be incomplete) and ":N" (count)."""
    ids_by_name = {}
    for kind in ("global", "party"):
        for achievement_id, name in labels[f"{kind}Achievements"].items():
            ids_by_name[name.lower()] = achievement_id

    def fix(value):
        negated = value.startswith("!")
        value = value.lstrip("!")
        value, _, count = value.partition(":")
        key = value.lower()
        value = ALIASES.get(key) or ids_by_name.get(key) or value
        return ("!" if negated else "") + value + (f":{count}" if count else "")

    return [{kind: [fix(v) for v in values] for kind, values in alternative.items()}
            for alternative in requirements]


def summarize_outcome(option, outcome):
    """What happens to the decks (and scenarios) for one outcome of an event option."""
    result = {}
    if outcome.get("condition"):
        result["condition"] = {"type": outcome["condition"].get("type"),
                               "values": outcome["condition"].get("values", [])}
    # The flag can sit on the outcome or on the whole option.
    if outcome.get("removeFromDeck") or option.get("removeFromDeck"):
        result["card"] = "removed"
    elif outcome.get("returnToDeck") or option.get("returnToDeck"):
        result["card"] = "returned"

    for effect in outcome.get("effects", []):
        conditional = bool(effect.get("condition"))
        if effect.get("type") == "event":
            deck, number = effect["values"][:2]
            result.setdefault("mayAdd" if conditional else "adds", []).append([deck, int(number)])
        elif effect.get("type") == "unlockScenario":
            for number in effect.get("values", []):
                result.setdefault("mayUnlock" if conditional else "unlocks", []).append(int(number))
    return result


def build_events():
    campaign = fetch(f"{RAW}/campaign.json")
    events = {"city": {}, "road": {}}
    for card in fetch(f"{RAW}/events.json"):
        options = {}
        for option in card.get("options", []):
            outcomes = option.get("outcomes") or [{}]
            options[option["label"]] = [summarize_outcome(option, o) for o in outcomes]
        events[card["type"]][str(int(card["cardId"]))] = options
    return {
        "source": f"https://github.com/{REPO}",
        "license": "AGPL-3.0",
        "retrieved": date.today().isoformat(),
        "startingDecks": {deck: [int(n) for n in cards] for deck, cards in campaign["events"].items()},
        "events": events,
    }


def write_json(path, data):
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main():
    labels = fetch(f"{RAW}/label/en.json")

    scenarios = {}
    for number in range(1, 96):
        data = fetch(f"{RAW}/scenarios/{number:02d}.json")
        scenario = {field: data[field] for field in FIELDS if data.get(field)}
        if "requirements" in scenario:
            scenario["requirements"] = normalize_requirements(scenario["requirements"], labels)
        scenarios[str(number)] = scenario
        print(f"#{number} {data['name']}")

    output = {
        "source": f"https://github.com/{REPO}",
        "license": "AGPL-3.0",
        "retrieved": date.today().isoformat(),
        "achievements": {
            "global": labels.get("globalAchievements", {}),
            "party": labels.get("partyAchievements", {}),
        },
        "scenarios": scenarios,
    }

    write_json(OUTPUT, output)
    print(f"Wrote {len(scenarios)} scenarios to {OUTPUT}")

    events = build_events()
    write_json(EVENTS_OUTPUT, events)
    counts = ", ".join(f"{len(cards)} {deck}" for deck, cards in events["events"].items())
    print(f"Wrote {counts} events to {EVENTS_OUTPUT}")


if __name__ == "__main__":
    main()
