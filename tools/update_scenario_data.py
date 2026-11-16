"""Download Gloomhaven (1st edition) scenario and event data from Gloomhaven Secretariat.

Keeps only what the tracker needs and writes three files:
- data/gloomhaven-scenarios.json: names, unlocks, blocks, requirements,
  rewards, achievement names, and what each treasure tile gives.
- data/gloomhaven-events.json: the starting city and road decks, the class
  names the events' conditions use, and for each event option its outcomes:
  the condition, whether the card is removed or returned, and the effects
  (reputation, prosperity, gold, XP, achievements, cards added, scenarios
  unlocked). No event text is copied. Also each class: its name, whether
  it is a starting class, the events unlocking or retiring it adds, its
  perks (written out as on the character sheet, with how many boxes each
  has), its hit points at each level and its hand size.
- data/gloomhaven-items.json: each item's name, cost, number of copies,
  slot, the prosperity level that puts it in the shop, and whether using it
  spends or consumes it (and after how many uses). No item text.
- data/gloomhaven-quests.json: each personal quest card: its name, its steps
  (a short label, the count, which step must come first, and how the source
  tracks it), and the class box or envelope it opens; and each battle goal
  card's name and checkmarks (no text). Characters' quests and battle goals
  are secret: campaign.json never says which card anyone holds.

Each scenario also notes whether it has a boss (from the monster files), as
a personal quest counts boss scenarios, and the treasure tiles on its map.

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
QUESTS_OUTPUT = DATA_DIR / "gloomhaven-quests.json"

# Fields copied from each scenario file. Map layouts and monsters are left out.
FIELDS = ["name", "unlocks", "blocks", "requires", "requirements", "rewards", "links", "eventType"]


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


# Requirement values that the source writes as a display name or misspells.
ALIASES = {"dept collection": "debt-collection", "the demmon's errand": "a-demons-errand"}


def achievement_ids(labels):
    """Achievement display name (lower case) -> id, both kinds."""
    ids = {}
    for kind in ("global", "party"):
        for achievement_id, name in labels[f"{kind}Achievements"].items():
            ids[name.lower()] = achievement_id
            ids[achievement_id] = achievement_id
    return ids


def normalize_rewards(rewards, labels, number):
    """Make every achievement a reward gains or loses an id; stop on one that isn't known."""
    ids = achievement_ids(labels)
    for key in ("globalAchievements", "partyAchievements", "lostGlobalAchievements", "lostPartyAchievements"):
        if key in rewards:
            fixed = []
            for value in rewards[key]:
                found = ALIASES.get(value.lower()) or ids.get(value.lower()) or ids.get(value)
                if not found:
                    raise SystemExit(f"Scenario {number}: unknown achievement {value!r} in {key}")
                fixed.append(found)
            rewards[key] = fixed
    return rewards


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
    elif kind in ("scenarioCondition", "scenarioDamage", "discard", "discardOne", "consumeItem",
                  "consumeCollectiveItem", "scenarioSingleMinus1"):
        # At the start of the next scenario: kept so the page can remind the party.
        result = {"type": "nextScenario", "what": kind, "values": values}
    elif kind in ("battleGoal", "loseBattleGoal"):
        # Battle-goal checkmarks gained or lost (each character).
        result = {"type": "checkmarks", "amount": (1 if kind == "battleGoal" else -1) * int(values[0] if values else 1)}
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


NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"]
MODIFIERS = {"plus0": "+0", "plus1": "+1", "plus2": "+2", "plus3": "+3", "plus4": "+4",
             "minus1": "-1", "minus2": "-2"}
CUSTOM_PERKS = {
    "%game.custom.perks.ignoreNegativeItem%": "Ignore negative item effects",
    "%game.custom.perks.ignoreNegativeScenario%": "Ignore negative scenario effects",
}


def effect_text(effect):
    kind, value = effect.get("type"), effect.get("value")
    self_target = any(e.get("value") == "self" for e in effect.get("effects", []))
    if kind in ("condition", "element"):
        return str(value).upper()
    if kind in ("push", "pull", "pierce", "heal", "shield"):
        return f"{kind.upper()} {value}" + (", self" if self_target else "")
    if kind == "target":
        return "ADD TARGET"
    if kind == "refreshItem":
        return "REFRESH AN ITEM"
    return kind.upper()


def cards_text(card):
    """"one +1 IMMOBILIZE card", "two rolling PUSH 2 cards"."""
    am = card["attackModifier"]
    count = card.get("count", 1)
    words = [NUMBER_WORDS[count]]
    if am.get("rolling"):
        words.append("rolling")
    if not (am.get("rolling") and am["type"] == "plus0" and am.get("effects")):
        words.append(MODIFIERS.get(am["type"], am["type"]))
    words += [effect_text(e) for e in am.get("effects", []) or []]
    words.append("card" if count == 1 else "cards")
    return " ".join(words)


def perk_text(perk):
    """A perk as the character sheet words it."""
    if perk["type"] == "custom":
        return CUSTOM_PERKS.get(perk["custom"], perk["custom"])
    cards = [cards_text(c) for c in perk.get("cards", [])]
    # Some "add" perks also ignore negative item or scenario effects, as the
    # sheet words it: "Ignore negative item effects and add one +1 card".
    if perk.get("custom") and perk["type"] == "add":
        return CUSTOM_PERKS.get(perk["custom"], perk["custom"]) + " and add " + " and ".join(cards)
    if perk["type"] == "remove":
        return "Remove " + " and ".join(cards)
    if perk["type"] == "replace":
        return f"Replace {cards[0]} with " + " and ".join(cards[1:])
    return "Add " + " and ".join(cards)


def class_events(class_ids):
    """Class id -> whether it is a starting class, the city and road event
    number its unlocking and retiring add, its perks, its hit points at each
    level and its hand size."""
    result = {}
    for class_id in class_ids:
        data = fetch(f"{RAW}/character/{class_id}.json")
        info = {"starting": not data.get("spoiler", False)}
        for key, name in (("unlockEvent", "unlockEvent"), ("retireEvent", "retireEvent")):
            if data.get(key):
                info[name] = int(data[key])
        info["perks"] = [{"text": perk_text(p), "count": p.get("count", 1)} for p in data.get("perks", [])]
        # Hit points at levels 1 to 9 and the hand size, for the table tracker.
        stats = sorted(data.get("stats", []), key=lambda x: x["level"])
        if stats:
            info["health"] = [int(x["health"]) for x in stats]
        if data.get("handSize"):
            info["handSize"] = int(data["handSize"])
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


def label(path, *sources):
    """A label by its dotted key ("game.items.slots.head"), from the first
    source that has it; a key naming a group gives the group's own label."""
    for source in sources:
        node = source
        for part in path.split("."):
            node = node.get(part) if isinstance(node, dict) else None
            if node is None:
                break
        if isinstance(node, dict):
            node = node.get("")
        if isinstance(node, str):
            return node
    return None


# The source app's own interface words, which its game data refers to but
# doesn't hold.
APP_LABELS = {
    "game.items.slots.head": "Head", "game.items.slots.body": "Body", "game.items.slots.legs": "Legs",
    "game.items.slots.onehand": "One Hand", "game.items.slots.twohand": "Two Hands",
    "game.items.slots.small": "Small", "character.progress.gold": "Gold",
    "game.checkmark": "checkmarks", "game.exhausted": "Times exhausted",
}


def resolve(text, labels, spoiler_labels, item_names):
    """Fill in a label's %placeholders% until none are left."""
    import re
    def one(match):
        key = match.group(1).removeprefix("data.")
        return label(key, spoiler_labels, labels) or APP_LABELS.get(key) or match.group(0)
    for _ in range(4):
        text = re.sub(r"%([\w.-]+)%", one, text)
    if text.startswith("items.gh-"):
        return item_names.get(text.removeprefix("items.gh-"), text)
    return label(text, labels, spoiler_labels) or APP_LABELS.get(text) or text


# How the tracker counts a step the source leaves to the players, when
# campaign.json records enough to count it.
# Regions follow the official FAQ's lists (Dagger Forest for 521, Lingering
# Swamp for 529).
TRACK_OVERRIDES = {
    ("510", 1): "scenarioName:Crypt",
    ("521", 1): "scenarioIn:3,28,29,38,43,44,48,55,56,59,81,91",
    ("529", 1): "scenarioIn:19,32,45,49,61,62,68,79",
}


def build_quests(labels, spoiler_labels, item_names):
    cards = {}
    for quest in fetch(f"{RAW}/personal-quests.json"):
        card = quest["cardId"]
        steps = []
        for i, req in enumerate(quest["requirements"], start=1):
            step = {"text": resolve(req["name"], labels, spoiler_labels, item_names), "count": req.get("counter", 1)}
            track = TRACK_OVERRIDES.get((card, i)) or req.get("autotrack")
            if track:
                step["track"] = track
            if req.get("requires"):
                step["after"] = req["requires"]
            steps.append(step)
        cards[card] = {
            "name": label(f"personalQuest.gh.{card}.", spoiler_labels, labels) or card,
            "steps": steps,
            **({"unlockClass": quest["unlockCharacter"]} if quest.get("unlockCharacter") else {}),
            **({"openEnvelope": quest["openEnvelope"]} if quest.get("openEnvelope") else {}),
        }
    return cards


def boss_monsters(names):
    """Of these monster ids, the bosses: each monster file fetched once."""
    return {name for name in sorted(names) if fetch(f"{RAW}/monster/{name}.json").get("boss")}


def write_json(path, data):
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main():
    labels = fetch(f"{RAW}/label/en.json")
    spoiler_labels = fetch(f"{RAW}/label/spoiler/en.json")

    # The scenarios first, then only the monsters they name, to find which
    # have a boss.
    # A scenario can name a monster with a level change ("stone-golem:+1").
    sources = {number: fetch(f"{RAW}/scenarios/{number:02d}.json") for number in range(1, 96)}
    monsters = {number: {m.partition(":")[0] for m in data.get("monsters", [])} for number, data in sources.items()}
    bosses = boss_monsters(set().union(*monsters.values()))
    scenarios = {}
    for number, data in sources.items():
        scenario = {field: data[field] for field in FIELDS if data.get(field)}
        if bosses & monsters[number]:
            scenario["boss"] = True
        # The treasure tiles on its map, so the form can offer them.
        tiles = {str(tile) for room in data.get("rooms", []) for tile in room.get("treasures", []) if str(tile).isdigit()}
        if tiles:
            scenario["treasures"] = sorted(tiles, key=int)
        if "requirements" in scenario:
            scenario["requirements"] = normalize_requirements(scenario["requirements"], labels)
        if "rewards" in scenario:
            scenario["rewards"] = normalize_rewards(scenario["rewards"], labels, number)
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

    # How each is used up in a scenario, for the table tracker: "spent" or
    # "consumed" (none: always ready), and "uses", the circles to mark first.
    items = {str(item["id"]): {key: item[key] for key in ("name", "cost", "count", "slot") if key in item}
                              | ({"prosperity": item["unlockProsperity"]} if item.get("unlockProsperity") else {})
                              | ({"use": "consumed"} if item.get("consumed") else {"use": "spent"} if item.get("spent") else {})
                              | ({"uses": int(item["slots"])} if item.get("slots") else {})
             for item in fetch(f"{RAW}/items.json")}
    write_json(ITEMS_OUTPUT, {
        "source": f"https://github.com/{REPO}",
        "license": "AGPL-3.0",
        "retrieved": date.today().isoformat(),
        "items": items,
    })
    print(f"Wrote {len(items)} items to {ITEMS_OUTPUT}")

    quests = build_quests(labels, spoiler_labels, {k: v["name"] for k, v in items.items()})
    write_json(QUESTS_OUTPUT, {
        "source": f"https://github.com/{REPO}",
        "license": "AGPL-3.0",
        "retrieved": date.today().isoformat(),
        "quests": quests,
        # Battle goal cards: the name and the checkmarks each gives. No text.
        "battleGoals": {str(int(g["cardId"])): {"name": g["name"], "checks": int(g.get("checks", 1))}
                        for g in fetch(f"{RAW}/battle-goals.json")},
    })
    print(f"Wrote {len(quests)} personal quests to {QUESTS_OUTPUT}")


if __name__ == "__main__":
    main()
