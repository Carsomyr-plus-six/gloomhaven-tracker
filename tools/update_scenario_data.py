"""Download Gloomhaven (1st edition) scenario and event data from Gloomhaven Secretariat.

Keeps only what the tracker needs and writes three files:
- data/gloomhaven-scenarios.json: names, unlocks, blocks, requirements,
  rewards, achievement names, and what each treasure tile gives.
- data/gloomhaven-events.json: the starting city and road decks, the class
  names the events' conditions use, and for each event option its outcomes:
  the condition, whether the card is removed or returned, and the effects
  (reputation, prosperity, gold, XP, achievements, cards added, scenarios
  unlocked). No event text is copied. Also each class: its name, whether
  it is a starting class, and the events unlocking or retiring it adds.
- data/gloomhaven-items.json: each item's name, cost, number of copies,
  slot and the prosperity level that puts it in the shop. No item text.

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
ITEMS_OUTPUT = DATA_DIR / "gloomhaven-items.json"

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


# Upstream effect types, as (our type, sign). "Additional" effects are extras
# that come with a condition of their own.
AMOUNTS = {
    "reputation": ("reputation", 1), "loseReputation": ("reputation", -1),
    "reputationAdditional": ("reputation", 1),
    "prosperity": ("prosperity", 1), "loseProsperity": ("prosperity", -1),
    "gold": ("gold", 1), "loseGold": ("gold", -1), "goldAdditional": ("gold", 1),
    "collectiveGold": ("collectiveGold", 1), "loseCollectiveGold": ("collectiveGold", -1),
    "collectiveGoldAdditional": ("collectiveGold", 1),
    "experience": ("experience", 1),
}


def summarize_condition(condition):
    return {"type": condition.get("type"), "values": condition.get("values", [])}


def summarize_effect(effect):
    """One effect in the tracker's terms, or None for "no effect"."""
    kind = effect.get("type")
    values = effect.get("values", [])
    if kind == "noEffect":
        return None
    if kind in AMOUNTS:
        name, sign = AMOUNTS[kind]
        result = {"type": name, "amount": sign * int(values[0])}
    elif kind == "event":
        result = {"type": "addEvent", "deck": values[0], "number": int(values[1])}
    elif kind == "unlockScenario":
        # Several scenarios in one effect become one effect each, below.
        result = {"type": "unlockScenario", "numbers": [int(n) for n in values]}
    elif kind in ("partyAchievement", "globalAchievement"):
        result = {"type": kind, "id": values[0]}
    elif kind == "outcome":
        # "Then do what option X says."
        result = {"type": "asOption", "option": values[0]}
    elif kind == "itemDesign":
        result = {"type": "itemDesign", "item": int(values[0])}
    elif kind == "itemCollective":
        result = {"type": "item", "item": int(values[0])}
    elif kind == "randomItemDesign":
        result = {"type": "randomItemDesign"}
    elif kind == "choose":
        result = {"type": "choose", "of": [e for e in map(summarize_effect, values) if e]}
    else:
        # Scenario effects, battle goals and so on: on the card, not tracked here.
        result = {"type": "other", "what": kind}
    if effect.get("condition") and effect["condition"].get("type") != "otherwise":
        result["condition"] = summarize_condition(effect["condition"])
    return result


def summarize_outcome(option, outcome):
    """The condition, the card's fate and the effects of one outcome of an event option."""
    result = {}
    if outcome.get("condition"):
        result["condition"] = summarize_condition(outcome["condition"])
    # The flag can sit on the outcome or on the whole option.
    if outcome.get("removeFromDeck") or option.get("removeFromDeck"):
        result["card"] = "removed"
    elif outcome.get("returnToDeck") or option.get("returnToDeck"):
        result["card"] = "returned"

    effects = []
    for effect in outcome.get("effects", []):
        summary = summarize_effect(effect)
        if summary and summary["type"] == "unlockScenario":
            numbers = summary.pop("numbers")
            effects += [{**summary, "number": n} for n in numbers]
        elif summary:
            effects.append(summary)
    if effects:
        result["effects"] = effects
    return result


def class_names(labels, spoiler_labels):
    """Class id (as event conditions write it) -> class name."""
    names = {}
    for source in (labels, spoiler_labels):
        for class_id, name in source.get("character", {}).get("gh", {}).items():
            names[class_id] = name[""] if isinstance(name, dict) else name
    return names


def class_events(class_ids):
    """Class id -> whether it is a starting class, and the city and road event
    number its unlocking and retiring add."""
    result = {}
    for class_id in class_ids:
        data = fetch(f"{RAW}/character/{class_id}.json")
        info = {"starting": not data.get("spoiler", False)}
        for key, name in (("unlockEvent", "unlockEvent"), ("retireEvent", "retireEvent")):
            if data.get(key):
                info[name] = int(data[key])
        result[class_id] = info
    return result


def build_events(labels, spoiler_labels):
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
        "classes": class_names(labels, spoiler_labels),
        "classEvents": class_events(class_names(labels, spoiler_labels)),
        "events": events,
    }


def write_json(path, data):
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main():
    labels = fetch(f"{RAW}/label/en.json")
    spoiler_labels = fetch(f"{RAW}/label/spoiler/en.json")

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
        # Treasure number -> what it gives, as the source writes it
        # ("gold:10", "itemDesign:107", "randomScenario", ...).
        "treasures": {str(i): reward for i, reward in enumerate(fetch(f"{RAW}/treasures.json"), start=1)},
    }

    write_json(OUTPUT, output)
    print(f"Wrote {len(scenarios)} scenarios to {OUTPUT}")

    events = build_events(labels, spoiler_labels)
    write_json(EVENTS_OUTPUT, events)
    counts = ", ".join(f"{len(cards)} {deck}" for deck, cards in events["events"].items())
    print(f"Wrote {counts} events to {EVENTS_OUTPUT}")

    items = {str(item["id"]): {key: item[key] for key in ("name", "cost", "count", "slot") if key in item}
                              | ({"prosperity": item["unlockProsperity"]} if item.get("unlockProsperity") else {})
             for item in fetch(f"{RAW}/items.json")}
    write_json(ITEMS_OUTPUT, {
        "source": f"https://github.com/{REPO}",
        "license": "AGPL-3.0",
        "retrieved": date.today().isoformat(),
        "items": items,
    })
    print(f"Wrote {len(items)} items to {ITEMS_OUTPUT}")


if __name__ == "__main__":
    main()
