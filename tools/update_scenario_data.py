"""Download Gloomhaven (1st edition) scenario data from Gloomhaven Secretariat.

Keeps only what the tracker needs (names, unlocks, blocks, requirements,
rewards and achievement names) and writes it to data/gloomhaven-scenarios.json.

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
OUTPUT = Path(__file__).resolve().parent.parent / "data" / "gloomhaven-scenarios.json"

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

    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {len(scenarios)} scenarios to {OUTPUT}")


if __name__ == "__main__":
    main()
