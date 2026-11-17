// Gloomhaven campaign tracker, the rules: what a campaign file and the
// reference data mean. Nothing in campaign/ touches the page, so the same
// code runs in the browser and in the tests. Its files are plain scripts
// sharing one scope, loaded in the order index.html lists them (which the
// tests read, and check), this one first. The page's code is in app/.
//
// This file: the rulebook's numbers, and the scenarios' rules from the
// reference data.

// --- Rules (Gloomhaven 1st edition) -------------------------------------

// XP needed to reach level 1, 2, 3 ... 9, as printed under the level boxes on
// the character sheet (and in Gloomhaven Secretariat's CharacterManager).
const XP_FOR_LEVEL = [0, 45, 95, 150, 210, 275, 345, 420, 500];

// Prosperity checkmarks needed to reach prosperity level 1, 2, 3 ... 9.
const CHECKMARKS_FOR_PROSPERITY = [0, 4, 9, 15, 22, 30, 39, 50, 64];

// Which step of a threshold table a value has reached (1-based).
function stepFor(value, table) {
  let step = 1;
  table.forEach((needed, i) => { if (value >= needed) step = i + 1; });
  return step;
}

// Progress towards the next step, or null at the top of the table.
function progressFor(value, table) {
  const step = stepFor(value, table);
  if (step >= table.length) return null;
  const from = table[step - 1];
  const to = table[step];
  return { next: to, remaining: to - value, fraction: (value - from) / (to - from) };
}

// Shop price change from reputation: every 4 points past ±3 shifts it by 1, up to ±5.
function shopModifier(reputation) {
  const steps = Math.min(5, Math.floor((Math.abs(reputation) + 1) / 4));
  return reputation >= 0 ? -steps : steps;
}

// Battle-goal checkmarks: every 3 earns a perk, up to 6 perks (18 checkmarks).
function perksFromCheckmarks(checkmarks) {
  return Math.min(6, Math.floor(checkmarks / 3));
}

// Scenario level: half the party's average level, rounded up. Easy is one
// lower, hard one higher, very hard two higher; it runs from 0 to 7.
function recommendedLevel(levels) {
  if (!levels.length) return 0;
  return Math.ceil(levels.reduce((a, b) => a + b, 0) / levels.length / 2);
}

const DIFFICULTIES = [["easy", "Easy", -1], ["normal", "Normal", 0], ["hard", "Hard", 1], ["veryhard", "Very hard", 2]];

// What a scenario level means at the table.
function scenarioStats(level) {
  return {
    monsters: level,
    gold: [2, 2, 3, 3, 4, 4, 5, 6][level],
    trap: 2 + level,
    xp: 4 + 2 * level,
    hazard: 1 + Math.ceil(level / 3),
  };
}

// The Sanctuary of the Great Oak: a donation is 10 gold, once per character
// per visit to the city, for two blessings in that character's next scenario
// (p. 45, where the errata reads "character" for "player": a retiring
// character's blessings don't pass to the player's next one). When
// the city's donations reach 100 gold in all, Envelope B may be opened.
const DONATION = 10;
const ENVELOPE_B_DONATIONS = 100;

// Which visit to the city a donation in the form was made on, as the number
// of the evening's scenarios played before it: 0 before the first, n after
// the last (a visit follows each scenario, p. 42). x.when is "" (before),
// "after-k" (back in town after the k-th) or "after" (after the last). One
// the form no longer offers, as its scenario was taken out, means the
// nearest visit there still is.
function donationVisit(x, scenarios) {
  const n = scenarios.length;
  if (!n) return 0;
  if (x.when === "after") return n;
  return Math.min(n, Number(/^after-(\d+)$/.exec(x.when || "")?.[1] || 0));
}

// Once Envelope B is open, donations also count towards prosperity. Counted
// as Gloomhaven Secretariat does, in donations of 10 gold: opening the
// envelope gives a checkmark; past the first 10 donations, every 5 more give
// a checkmark, up to 40 donations; past 40, every 10 more give one.
// (Spoiler: this is what Envelope B says. The page shows none of it until
// campaign.json says the envelope is open.)
function donationCheckmarks(gold) {
  const n = Math.floor(gold / DONATION);
  return Math.floor(Math.min(Math.max(n - 10, 0), 30) / 5) + Math.floor(Math.max(n - 40, 0) / 10);
}

// A new character may start at any level up to the prosperity level, with
// 15 gold for each level plus one.
const startingGold = level => 15 * (level + 1);

// Enhancing an ability card at the Enhancer, once The Power of Enhancement is
// gained: the sticker's base cost, doubled if the ability targets more than
// one figure (not for an attack hex, nor a summon's stats), plus 25 gold for
// each card level above 1 and 75 gold for each enhancement already on that
// action. Costs as Gloomhaven Secretariat's EnhancementsManager has them for
// the 1st edition. An attack hex costs 200 gold shared by the hexes the
// attack has now, rounded down (p. 47).
const ENHANCEMENTS = [
  ["+1 to a number", [["move", "Move", 30], ["attack", "Attack", 50], ["range", "Range", 30], ["target", "Target", 50],
                      ["shield", "Shield", 100], ["retaliate", "Retaliate", 100], ["pierce", "Pierce", 30], ["heal", "Heal", 30],
                      ["push", "Push", 30], ["pull", "Pull", 30]]],
  ["On a move", [["jump", "Jump", 50]]],
  ["An element", [["element", "One element", 100], ["wild", "Any element", 150]]],
  ["A condition, on an attack", [["poison", "Poison", 75], ["wound", "Wound", 75], ["muddle", "Muddle", 50],
                                 ["immobilize", "Immobilize", 100], ["disarm", "Disarm", 150], ["curse", "Curse", 75]]],
  ["A condition, on a heal or buff", [["strengthen", "Strengthen", 50], ["bless", "Bless", 50]]],
  ["An attack's area", [["hex", "One more hex", null]]],
  ["A summon's stats", [["summon-move", "Summon move +1", 100], ["summon-attack", "Summon attack +1", 100],
                        ["summon-range", "Summon range +1", 50], ["summon-hp", "Summon HP +1", 50]]],
];
const ENHANCEMENT_BY_KEY = new Map(ENHANCEMENTS.flatMap(([group, list]) => list.map(([key, label, base]) => [key, { key, label, base, group }])));

// Doubling for more than one target leaves out an attack hex and a summon's stats.
const canDouble = key => key !== "hex" && !key.startsWith("summon-");

// The cost of one enhancement, step by step. x: { sticker, level, multi,
// previous, hexes }, as the calculator holds them.
function enhancementCost(x) {
  const e = ENHANCEMENT_BY_KEY.get(x.sticker);
  const hexes = Math.max(1, num(x.hexes));
  // Rounded down: the rulebook's example makes 200 over 3 hexes 66 gold.
  const base = e.key === "hex" ? Math.floor(200 / hexes) : e.base;
  const doubles = canDouble(e.key) && Boolean(x.multi);
  const level = Math.max(1, Math.min(9, num(x.level) || 1));
  const previous = Math.max(0, num(x.previous));
  const steps = [
    [e.key === "hex" ? `One more hex: ${goldText(200)} over the ${hexes} it has` : e.group === "+1 to a number" ? `${e.label} +1` : e.label, base],
    doubles ? ["Targets more than one: doubled", base] : null,
    level > 1 ? [`Level ${level} card: 25 a level above 1`, 25 * (level - 1)] : null,
    previous ? [`${previous} already on the action: 75 each`, 75 * previous] : null,
  ].filter(Boolean);
  return { steps, total: steps.reduce((sum, [, gold]) => sum + gold, 0) };
}

// One perk per level gained after 1, plus the checkmark perks.
function perksEarned(level, checkmarks) {
  return level - 1 + perksFromCheckmarks(checkmarks);
}

function signed(n) { return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0"; }
// Gold as the rulebook's tables write it (the enhancement costs, p. 47):
// "25g", and a change as "+5g" or "−5g". Words for screen readers say "gold".
const goldText = n => n < 0 ? `−${Math.abs(n)}g` : `${n}g`;
const goldChange = n => `${signed(n)}g`;
// XP the same way, as the rulebook writes it: "15 XP", "+5 XP".
const xpText = n => `${n} XP`;
const xpChange = n => `${signed(n)} XP`;

function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

function capitalize(text) { return text ? text[0].toUpperCase() + text.slice(1) : text; }

function formatDate(iso, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, options);
}

// Level, perks and progress for one character, from the rules above.
function characterStats(c) {
  const level = stepFor(c.xp, XP_FOR_LEVEL);
  const toNext = progressFor(c.xp, XP_FOR_LEVEL);
  // perkBonus: extra perks a player gets for each character they've retired
  // before (rulebook p. 48).
  const earned = perksEarned(level, c.checkmarks) + (Number(c.perkBonus) || 0);
  return {
    level,
    toNext,
    earned,
    unspent: Math.max(0, earned - c.perks.length),
    // About to level up: worth a glance before the next scenario.
    close: Boolean(toNext) && toNext.remaining <= 5,
    nextText: toNext ? `${xpText(toNext.remaining)} to level ${level + 1}` : "Maximum level",
  };
}

function scenarioLabel(data, number) {
  const name = data.scenarios.find(s => s.number === number)?.name || scenarioRef?.scenarios?.[String(number)]?.name;
  return `#${number}${name ? ` ${name}` : ""}`;
}

// Active characters first, then inactive (sitting out for now: still the
// party's, with their items, but not playing), then retired. The order the
// character picker uses.
function characterOrder(data) {
  return [...data.characters.filter(c => !c.retired && !c.inactive),
          ...data.characters.filter(c => !c.retired && c.inactive),
          ...data.characters.filter(c => c.retired)];
}

// Adventuring: neither retired nor sitting out.
const playable = c => !c.retired && !c.inactive;

// Whether travelling from town to a scenario takes a road event: not when
// it's linked to Gloomhaven (the scenario data says which do).
function needsRoadEvent(number) {
  const info = scenarioRef?.scenarios?.[String(number)];
  return !info || info.eventType === "road";
}

// Personal quest progress written as "n/m", or as steps: taken in order
// ("1/3, then 0/1": three of something, then one more thing), or side by
// side, in any order ("2/2 + 1/2": two of one thing and two of another).
// questParts: each step's count and target, and the joins between them; any
// other wording ("2? (noted as II)") gives null. questSteps: the steps.
const QUEST_HOW = 'write it as counts, like "2/15", "1/3, then 0/1" for steps in order, or "2/2 + 1/2" for steps side by side';
function questParts(text) {
  const parts = String(text || "").trim().split(/(, then | \+ )/);
  const steps = parts.filter((_, i) => i % 2 === 0).map(p => p.match(/^(\d+)\/(\d+)$/));
  if (steps.some(m => !m || !Number(m[2]))) return null;
  return { steps: steps.map(m => [Number(m[1]), Number(m[2])]), joins: parts.filter((_, i) => i % 2 === 1) };
}
const questSteps = text => questParts(text)?.steps || null;

// Reached: every step done.
function questDone(text) {
  const steps = questSteps(text);
  return Boolean(steps) && steps.every(([n, m]) => n >= m);
}

// A scenario in the form is played in casual mode (rulebook p. 34): any
// revealed scenario can be, completed or not. XP, gold, loot, battle goals
// and personal quest progress count; its rewards and unlocks don't, and its
// record stays as it was.
function isCasual(s, data) {
  const status = data.scenarios.find(x => x.number === num(s.number))?.status;
  if (!status) return false;
  // Ticked or not as the form says; on to start with for one that can't be
  // played in campaign mode (completed, or blocked by an achievement).
  return s.casual ?? (status === "completed" || status === "blocked");
}

// --- Scenario rules from the reference data ------------------------------
// data/gloomhaven-scenarios.json (from Gloomhaven Secretariat) says what each
// scenario unlocks, blocks, requires and rewards. campaign.json only records
// what happened; everything else is worked out here.

// Global achievements of which the party holds one at a time, by id prefix.
const ACHIEVEMENT_GROUPS = ["city-rule-", "artifact-"];
// Only a global achievement without a type can be held more than once
// (rulebook p. 40): another of a party achievement, or of a typed one,
// changes nothing.
const achievementStacks = (kind, id) => kind === "global" && !ACHIEVEMENT_GROUPS.some(g => String(id).startsWith(g));
// Reputation reaching +20 or −20 adds two events to the decks, once
// (rulebook p. 49).
const REPUTATION_EVENTS = [{ at: 20, events: [["city", 76], ["road", 67]] }, { at: -20, events: [["city", 77], ["road", 68]] }];
// A party holding both of these gains The Drake Aided, and City 75 and
// Road 66 go into the decks (rulebook p. 49).
const DRAKE_AIDED = { needs: ["the-drakes-command", "the-drakes-treasure"], gains: "the-drake-aided",
                      events: [["city", 75], ["road", 66]] };

function achievementName(kind, id) {
  return scenarioRef?.achievements?.[kind]?.[id] || id;
}

// data/gloomhaven-items.json, once loaded: item names by number.
let itemsRef = null;
function itemName(id) { return itemsRef?.items?.[String(id)]?.name || `item ${id}`; }
// Item names are the item list's, letter for letter: a name written any
// other way is a different (unknown) item, which the page asks about.
const sameItem = (a, b) => String(a) === String(b);
// A scenario's reward items, one entry per copy ("27:2" is two copies).
function rewardCopies(info) {
  return (info?.rewards?.items || []).flatMap(id => {
    const [n, copies] = String(id).split(":");
    return Array.from({ length: Number(copies) || 1 }, () => itemName(n));
  });
}
function itemInfo(name) {
  return Object.values(itemsRef?.items || {}).find(i => i.name === String(name)) || null;
}
function itemSlot(name) { return itemInfo(name)?.slot || null; }

// What a treasure tile gives, from the reference data ("gold:10|..."). A
// tile with several items or designs lists them joined by "+" ("item:110+115"
// is both): each is a part of its own.
function treasureParts(number) {
  const raw = scenarioRef?.treasures?.[String(Number(number))];
  return raw ? raw.split("|").flatMap(part => {
    const [type, value] = part.split(":");
    return (type === "item" || type === "itemDesign") && value?.includes("+")
      ? value.split("+").map(v => ({ type, value: v })) : [{ type, value }];
  }) : [];
}

function describeTreasurePart({ type, value }) {
  switch (type) {
    case "gold": return goldText(value);
    case "experience": return xpText(value);
    case "item": return itemName(value);
    case "itemDesign": return `${itemName(value)} design`;
    case "randomItemDesign": return "a random item design";
    case "randomScenario": return "a random side scenario";
    case "scenario": return `unlocks #${value}`;
    case "damage": return `${value} damage`;
    case "condition": return value;
    case "battleGoal": return `${plural(Number(value), "battle goal checkmark")}`;
    default: return "see the treasure index";
  }
}

// How many times the party has each achievement, by kind ("global" / "party").
function achievementCounts(data) {
  const count = list => {
    const counts = new Map();
    for (const a of list) {
      counts.set(a.id, (counts.get(a.id) || 0) + (a.count || 1));
    }
    return counts;
  };
  return { global: count(data.achievements.global), party: count(data.achievements.party) };
}

// Requirements are alternatives (any one will do); each lists achievements
// that are needed, "!" meaning must be incomplete and ":N" meaning N times.
// Returns null when met, otherwise a sentence saying what is missing.
function unmetRequirements(requirements, have) {
  const failures = [];
  for (const alternative of requirements) {
    const unmet = [];
    for (const [kind, values] of Object.entries(alternative)) {
      for (const value of values) {
        const negated = value.startsWith("!");
        const [id, times] = value.replace(/^!/, "").split(":");
        const needed = Number(times || 1);
        const count = have[kind]?.get(id) || 0;
        const name = achievementName(kind, id);
        if (negated && count >= needed) unmet.push(`${name} to be incomplete`);
        if (!negated && count < needed) unmet.push(needed > 1 ? `${name} ×${needed}` : name);
      }
    }
    if (!unmet.length) return null;
    failures.push(unmet.join(" and "));
  }
  return `Needs ${failures.join(", or ")}`;
}

// Whether requirements not met now could still be: some alternative wants
// only achievements gained, none held that it wants incomplete.
function couldYetMeet(requirements, have) {
  return requirements.some(alternative => Object.entries(alternative).every(([kind, values]) =>
    values.filter(v => v.startsWith("!")).every(v => {
      const [id, times] = v.slice(1).split(":");
      return (have[kind]?.get(id) || 0) < Number(times || 1);
    })));
}

function describeRewards(rewards) {
  if (!rewards) return [];
  const parts = [];
  const r = rewards;
  if (r.gold) parts.push(`${goldText(r.gold)} each`);
  if (r.collectiveGold) parts.push(`${goldText(r.collectiveGold)} to share`);
  if (r.experience) parts.push(`${xpText(r.experience)} each`);
  if (r.battleGoals) parts.push(`${plural(r.battleGoals, "battle goal checkmark")} each`);
  if (r.prosperity) parts.push(`${signed(r.prosperity)} prosperity`);
  if (r.reputation) parts.push(`${signed(r.reputation)} reputation`);
  for (const id of r.globalAchievements || []) parts.push(achievementName("global", String(id).split(":")[0]));
  for (const id of r.partyAchievements || []) parts.push(achievementName("party", String(id).split(":")[0]));
  for (const id of r.lostPartyAchievements || []) parts.push(`lose ${achievementName("party", id)}`);
  if (r.chooseLocation) parts.push(`choose one of ${r.chooseLocation.map(n => `#${n}`).join(", ")}`);
  for (const id of r.items || []) parts.push(itemName(String(id).split(":")[0]));
  for (const id of r.itemDesigns || []) parts.push(`${itemName(id)} design`);
  for (const ev of r.events || []) { const [deck, n] = ev.split(":"); parts.push(`adds ${eventLabel(deck, Number(n))}`); }
  if (r.unlockCharacter) parts.push(`unlocks the ${className(r.unlockCharacter)}`);
  const known = ["gold", "collectiveGold", "experience", "prosperity", "reputation", "globalAchievements",
                 "partyAchievements", "lostPartyAchievements", "chooseLocation", "items", "itemDesigns", "events",
                 "unlockCharacter"];
  if (Object.keys(r).some(k => !known.includes(k))) parts.push("more in the scenario book");
  return parts;
}
