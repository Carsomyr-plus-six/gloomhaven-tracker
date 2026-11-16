// Gloomhaven campaign tracker: the rules, and what follows from a campaign
// file and the reference data. Nothing here touches the page, so the same
// code runs in the browser (loaded before app.js) and in the tests
// (tests/run.mjs, tests/index.html). The page's code is in app.js.


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

// The Sanctuary of the Great Oak: a donation is 10 gold, once per player per
// visit to the city, for two blessings in that player's next scenario. When
// the city's donations reach 100 gold in all, Envelope B may be opened.
const DONATION = 10;
const ENVELOPE_B_DONATIONS = 100;

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
// attack has now, rounded up.
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
const goldText = n => `${n}g`;
const goldChange = n => `${signed(n)}g`;

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
    nextText: toNext ? `${toNext.remaining} XP to level ${level + 1}` : "Maximum level",
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

function achievementName(ref, kind, id) {
  return ref?.achievements?.[kind]?.[id] || id;
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

// What a treasure tile gives, from the reference data ("gold:10|...").
function treasureParts(ref, number) {
  const raw = ref?.treasures?.[String(Number(number))];
  return raw ? raw.split("|").map(part => { const [type, value] = part.split(":"); return { type, value }; }) : [];
}

function describeTreasurePart({ type, value }) {
  switch (type) {
    case "gold": return goldText(value);
    case "experience": return `${value} XP`;
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
  return { global: count(data.city.globalAchievements), party: count(data.party.achievements) };
}

// Requirements are alternatives (any one will do); each lists achievements
// that are needed, "!" meaning must be incomplete and ":N" meaning N times.
// Returns null when met, otherwise a sentence saying what is missing.
function unmetRequirements(ref, requirements, have) {
  const failures = [];
  for (const alternative of requirements) {
    const unmet = [];
    for (const [kind, values] of Object.entries(alternative)) {
      for (const value of values) {
        const negated = value.startsWith("!");
        const [id, times] = value.replace(/^!/, "").split(":");
        const needed = Number(times || 1);
        const count = have[kind]?.get(id) || 0;
        const name = achievementName(ref, kind, id);
        if (negated && count >= needed) unmet.push(`${name} to be incomplete`);
        if (!negated && count < needed) unmet.push(needed > 1 ? `${name} ×${needed}` : name);
      }
    }
    if (!unmet.length) return null;
    failures.push(unmet.join(" and "));
  }
  return `Needs ${failures.join(", or ")}`;
}

function describeRewards(ref, rewards, evRef) {
  if (!rewards) return [];
  const parts = [];
  const r = rewards;
  if (r.gold) parts.push(`${goldText(r.gold)} each`);
  if (r.collectiveGold) parts.push(`${goldText(r.collectiveGold)} to share`);
  if (r.experience) parts.push(`${r.experience} XP each`);
  if (r.battleGoals) parts.push(`${plural(r.battleGoals, "battle goal checkmark")} each`);
  if (r.prosperity) parts.push(`${signed(r.prosperity)} prosperity`);
  if (r.reputation) parts.push(`${signed(r.reputation)} reputation`);
  for (const id of r.globalAchievements || []) parts.push(achievementName(ref, "global", String(id).split(":")[0]));
  for (const id of r.partyAchievements || []) parts.push(achievementName(ref, "party", String(id).split(":")[0]));
  for (const id of r.lostPartyAchievements || []) parts.push(`lose ${achievementName(ref, "party", id)}`);
  if (r.chooseLocation) parts.push(`choose one of ${r.chooseLocation.map(n => `#${n}`).join(", ")}`);
  for (const id of r.items || []) parts.push(itemName(String(id).split(":")[0]));
  for (const id of r.itemDesigns || []) parts.push(`${itemName(id)} design`);
  for (const ev of r.events || []) { const [deck, n] = ev.split(":"); parts.push(`adds ${eventLabel(deck, Number(n))}`); }
  if (r.unlockCharacter) parts.push(`unlocks the ${className(evRef, r.unlockCharacter)}`);
  const known = ["gold", "collectiveGold", "experience", "prosperity", "reputation", "globalAchievements",
                 "partyAchievements", "lostPartyAchievements", "chooseLocation", "items", "itemDesigns", "events",
                 "unlockCharacter"];
  if (Object.keys(r).some(k => !known.includes(k))) parts.push("more in the scenario book");
  return parts;
}

// --- Events and the ledger ----------------------------------------------------
// data/gloomhaven-events.json says what each event option does. campaign.json's
// "events" lists the events drawn, in order, with the option chosen and who was
// there; "eventDecks" holds cards added or removed some other way. One pass
// over the campaign, in the order things happened, works out the decks, which
// outcome each event had, the party's reputation and the city's prosperity,
// and the campaign record: achievements, item designs, unlocked classes and
// what each treasure gave.

const DECK_NAMES = { city: "City", road: "Road" };
const eventLabel = (deck, number) => `${DECK_NAMES[deck] || deck} ${number}`;

// A number that may not be known exactly: the lowest and highest it can be.
const exact = n => ({ lo: n, hi: n });
const plus = (a, b) => ({ lo: a.lo + b.lo, hi: a.hi + b.hi });
const either = (a, b) => ({ lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) });
const isExact = r => r.lo === r.hi;
const rangeText = r => isExact(r) ? signed(r.lo) : `${signed(r.lo)} to ${signed(r.hi)}`;

function className(evRef, id) { return evRef?.classes?.[id] || capitalize(id); }

function describeCondition(c, evRef) {
  if (!c || c.type === "otherwise") return "otherwise";
  if (c.type === "reputationGT") return `reputation above ${signed(c.values[0])}`;
  if (c.type === "reputationLT") return `reputation below ${signed(c.values[0])}`;
  if (c.type === "character") return `with a ${c.values.map(id => className(evRef, id)).join(" or ")}`;
  if (c.type === "payCollectiveGold" || c.type === "payGold") return `if you paid ${goldText(c.values[0])}`;
  if (c.type.startsWith("pay")) return "if you paid";
  return c.type;
}

// Who was at an event, as class ids. The event's own "characters" win; an
// event drawn before a scenario played in only one session takes that
// session's party. complete is false when someone's class isn't known.
function eventParty(data, evRef, e) {
  let names = e.characters;
  if (!names && e.scenario != null) {
    const sessions = data.sessions.filter(s => s.scenarios.some(sc => sc.number === e.scenario));
    if (sessions.length === 1) names = sessions[0].characters;
  }
  if (!names?.length) return { classes: null, complete: false };
  const ids = Object.entries(evRef?.classes || {});
  const classes = new Set();
  let complete = true;
  for (const name of names) {
    const cls = data.characters.find(c => c.name === name)?.class;
    // A class name not in the list is a class not known: who was there
    // isn't complete, so the event asks rather than guessing.
    const id = cls && ids.find(([, n]) => n === cls)?.[0];
    if (id) classes.add(id); else complete = false;
  }
  return { classes, complete };
}

// true, false, or null when campaign.json doesn't say enough to tell.
function testCondition(c, ctx) {
  if (!c || c.type === "otherwise") return true;
  if (c.type === "character") {
    if (!ctx.classes) return null;
    if (c.values.some(id => ctx.classes.has(id))) return true;
    return ctx.complete ? false : null;
  }
  const v = c.values[0];
  if (c.type === "reputationGT") return ctx.reputation.lo > v ? true : ctx.reputation.hi <= v ? false : null;
  if (c.type === "reputationLT") return ctx.reputation.hi < v ? true : ctx.reputation.lo >= v ? false : null;
  if (c.type.startsWith("pay")) return typeof ctx.paid === "boolean" ? ctx.paid : null;
  return null;
}

// What an option could have done. A choice is read top to bottom,
// resolving every outcome that applies; "otherwise" applies only if none
// before it did (rulebook p. 41). Where a condition can't be told, each way
// it could have gone is a possibility of its own, with that condition as a
// doubt. "Do what option X says" is followed through.
function possibleOutcomes(options, letter, ctx, pinned, depth = 0) {
  const outcomes = options[letter] || [];
  // A blank outcome ahead of the real ones is only the card's lead-in.
  const real = outcomes.map((outcome, i) => ({ outcome, number: i + 1 }))
    .filter(({ outcome }) => outcomes.length === 1 || outcome.condition || outcome.card || outcome.effects);
  const found = [];
  if (pinned) {
    if (outcomes[pinned - 1]) found.push({ applied: [{ outcome: outcomes[pinned - 1], number: pinned }], doubts: [] });
  } else {
    const conditional = o => o.condition && o.condition.type !== "otherwise";
    const tests = real.map(({ outcome }) => conditional(outcome) ? testCondition(outcome.condition, ctx) : true);
    const unsure = tests.map((t, i) => t === null ? i : -1).filter(i => i >= 0);
    for (let mask = 0; mask < 2 ** unsure.length; mask++) {
      const met = tests.map((t, i) => t === null ? Boolean(mask & (1 << unsure.indexOf(i))) : t);
      const applied = [];
      let any = false;
      real.forEach(({ outcome, number }, i) => {
        if (outcome.condition?.type === "otherwise") { if (!any) applied.push({ outcome, number }); return; }
        if (!met[i]) return;
        any = true;
        applied.push({ outcome, number });
      });
      found.push({ applied, doubts: unsure.map(i => real[i].outcome.condition) });
    }
  }
  // The card goes where an applied outcome sends it; if none says, where all
  // of the option's outcomes agree.
  const agreed = new Set(outcomes.map(o => o.card));
  return found.flatMap(({ applied, doubts }) => {
    const outcome = {
      card: applied.find(a => a.outcome.card)?.outcome.card ?? (agreed.size === 1 ? [...agreed][0] : undefined),
      condition: applied.find(a => a.outcome.condition?.type?.startsWith("pay"))?.outcome.condition,
      effects: applied.flatMap(a => a.outcome.effects || []),
    };
    const number = applied.length ? applied[0].number : null;
    const own = outcome.effects || [];
    const then = own.find(e => e.type === "asOption");
    const base = { option: letter, number, card: outcome.card, condition: outcome.condition, effects: own.filter(e => e.type !== "asOption"), doubts };
    if (!then || depth > 2) return [base];
    return possibleOutcomes(options, then.option, ctx, null, depth + 1).map(sub => ({
      ...base, card: base.card || sub.card, effects: [...base.effects, ...sub.effects], doubts: [...doubts, ...sub.doubts],
    }));
  });
}

// What a recorded event's chosen option did for the characters there: the
// effects whose conditions are met. null when which outcome applied can't be
// told from what's recorded.
function chosenOutcome(data, evRef, deck, number, option, names, paid) {
  const options = evRef?.events?.[deck]?.[String(number)];
  if (!options || !option) return null;
  const ctx = { ...eventParty(data, evRef, { characters: names }),
                reputation: data.ledger?.reputation?.range || exact(data.party.reputation || 0), paid };
  const found = possibleOutcomes(options, option, ctx, null);
  if (found.length !== 1 || found[0].doubts.length) return null;
  const effects = [];
  let unsure = false;
  for (const e of found[0].effects) {
    const met = e.condition ? testCondition(e.condition, ctx) : true;
    if (met === null) unsure = true;
    else if (met) effects.push(e);
  }
  // Paying was the outcome's condition: what it cost comes off too.
  if (paid && found[0].condition?.type?.startsWith("pay")) {
    const cost = paymentFor(found[0].condition, ctx.reputation);
    if (cost) effects.push(cost); else unsure = true;
  }
  return { effects, unsure };
}

// The payment an event option asks for, and whether these characters could
// make it: { condition, could } (could is null when the price can't be told).
function eventPayment(data, deck, number, option, characters) {
  const condition = (classRef?.events?.[deck]?.[String(number)]?.[option] || []).find(o => o.condition?.type?.startsWith("pay"))?.condition;
  const could = condition ? couldPay(condition, characters, data.ledger?.reputation?.range || exact(data.party.reputation || 0)) : null;
  return { condition, could };
}

// Whether the party could pay: if it has the gold between them (or each
// has it, for gold each), it's lost and the outcome applies (rulebook p. 41).
// null when the price can't be told.
function couldPay(condition, characters, reputation) {
  const cost = paymentFor(condition, reputation);
  if (!cost) return null;
  const need = Math.abs(cost.amount || 0);
  if (cost.type === "gold") return characters.every(c => (c.gold || 0) >= need);
  if (cost.type === "collectiveGold") return characters.reduce((sum, c) => sum + (c.gold || 0), 0) >= need;
  return null;
}

// An event effect that comes at the start of the next scenario, in words.
function nextScenarioText(e) {
  const [a, b] = e.values || [];
  switch (e.what) {
    case "scenarioCondition": return `start the next scenario with ${(e.values || []).map(v => String(v).toUpperCase()).join(" and ")}`;
    case "scenarioDamage": return `start the next scenario with ${a} damage`;
    case "discard": return `discard ${a} cards at the start of the next scenario`;
    case "discardOne": return "one character discards a card at the start of the next scenario";
    case "consumeItem": return `consume ${a} ${b || ""} item${a === 1 ? "" : "s"} at the start of the next scenario`.replace(/\s+/g, " ");
    case "consumeCollectiveItem": return `one character consumes ${a} ${b || ""} item at the start of the next scenario`.replace(/\s+/g, " ");
    case "scenarioSingleMinus1": return `one character adds ${a} −1 cards to their deck for the next scenario`;
    default: return "an effect at the start of the next scenario (see the card)";
  }
}

// What paying for an event cost, as an effect: gold from the party (split as
// they paid it), gold from each character, or an item given up. A price that
// depends on reputation needs reputation settled; null when it isn't.
function paymentFor(condition, reputation) {
  const [first] = condition.values || [];
  if (condition.type === "payCollectiveGold") return { type: "collectiveGold", amount: -Number(first) };
  if (condition.type === "payGold") return { type: "gold", amount: -Number(first) };
  if (condition.type === "payCollectiveItem") return { type: "payItem", item: Number(first) };
  if (condition.type === "payCollectiveGoldConditional") {
    const priceAt = rep => condition.values.find(c =>
      c.type.endsWith("ReputationLT") ? rep < c.values[1] : c.type.endsWith("ReputationGT") ? rep > c.values[1] : false)?.values[0];
    const lo = priceAt(reputation.lo), hi = priceAt(reputation.hi);
    return lo != null && lo === hi ? { type: "collectiveGold", amount: -Number(lo) } : null;
  }
  return null;
}

// What one outcome's effects come to. An effect with a condition that can't
// be told counts as "may": a range for numbers, a question for cards.
function tally(effects, ctx, ref, evRef) {
  const t = { reputation: exact(0), prosperity: exact(0), adds: [], mayAdd: [], unlocks: [], mayUnlock: [],
              gains: [], mayGain: [], text: [], effectDoubts: [] };
  const amount = e => ["reputation", "prosperity"].includes(e.type) ? { [e.type]: exact(e.amount) } : {};
  let more = false;
  for (const e of effects) {
    const met = e.condition ? testCondition(e.condition, ctx) : true;
    if (met === false) continue;
    const maybe = met === null;
    if (maybe) t.effectDoubts.push(e.condition);
    const say = text => t.text.push(maybe ? `${text} ${describeCondition(e.condition, evRef)}` : text);
    const add = (key, r) => { t[key] = plus(t[key], maybe ? either(exact(0), r) : r); };
    switch (e.type) {
      case "reputation":
      case "prosperity":
        add(e.type, exact(e.amount));
        say(`${signed(e.amount)} ${e.type}`);
        break;
      case "gold": say(`${goldChange(e.amount)} each`); break;
      case "collectiveGold": say(`${goldChange(e.amount)} to share`); break;
      case "experience": say(`${signed(e.amount)} XP each`); break;
      case "checkmarks": say(`${signed(e.amount)} battle goal ${Math.abs(e.amount) === 1 ? "checkmark" : "checkmarks"} each`); break;
      case "partyAchievement":
      case "globalAchievement": {
        const kind = e.type === "partyAchievement" ? "party" : "global";
        (maybe ? t.mayGain : t.gains).push({ kind, id: e.id });
        say(achievementName(ref, kind, e.id));
        break;
      }
      case "item":
      case "itemDesign":
        // A design puts every copy in the shop; a named item is one copy.
        (maybe ? t.mayGain : t.gains).push({ kind: e.type === "item" ? "found" : "design", item: e.item });
        say(e.type === "item" ? itemName(e.item) : `${itemName(e.item)} design`);
        break;
      case "randomItemDesign":
        (maybe ? t.mayGain : t.gains).push({ kind: "randomDesign" });
        say("a random item design");
        break;
      case "addEvent": (maybe ? t.mayAdd : t.adds).push([e.deck, e.number]); say(`adds ${eventLabel(e.deck, e.number)}`); break;
      case "unlockScenario": (maybe ? t.mayUnlock : t.unlocks).push(e.number); say(`unlocks #${e.number}`); break;
      case "choose": {
        // One of several; without knowing which, anything in between.
        for (const key of ["reputation", "prosperity"]) {
          const ranges = e.of.map(sub => amount(sub)[key] || exact(0));
          if (ranges.some(r => r.lo || r.hi)) add(key, ranges.reduce(either));
        }
        say(`choose: ${e.of.map(sub => sub.amount != null ? (sub.type === "gold" ? goldChange(sub.amount) : `${signed(sub.amount)} ${sub.type}`) : sub.type).join(" or ")}`);
        break;
      }
      case "nextScenario": say(nextScenarioText(e)); break;
      default: more = true;
    }
  }
  if (more) t.text.push("more on the card");
  return t;
}

// The part of a range that is certain: the smallest change it could be.
const settledPart = r => r.lo > 0 ? r.lo : r.hi < 0 ? r.hi : 0;

function deriveCampaign(data, ref, evRef) {
  const decks = {};
  const added = {};
  const removed = {};
  for (const deck of Object.keys(DECK_NAMES)) {
    decks[deck] = new Set(evRef?.startingDecks?.[deck] || []);
    added[deck] = new Map();
    removed[deck] = new Map();
  }
  const history = [];
  const questions = [];
  const unlocks = [];
  // unsure: what could still be settled; unknown: what never will be.
  const track = () => ({ value: 0, range: exact(0), entries: [], unsure: [], unknown: [] });
  const totals = { reputation: track(), prosperity: track() };

  // The campaign record. Each list maps an id to { name, count, where }.
  const record = { party: new Map(), global: new Map(), designs: new Map(), classes: new Map(),
                   draws: [], treasures: new Map(),
                   // Achievements lost (a scenario takes it away) or replaced (one
                   // City Rule or Artifact by another), kept for the record.
                   lost: [],
                   // Items found (treasures, scenario rewards): one copy each, to a
                   // character, not to the shop; and those whose finder isn't known.
                   found: [], claims: [] };
  const note = (entry, where) => { if (where && !entry.where.includes(where)) entry.where.push(where); };
  const gainAchievement = (kind, rawId, where) => {
    const id = String(rawId).split(":")[0];
    const name = achievementName(ref, kind, id);
    const list = record[kind];
    // "City Rule: Economic" replaces any other City Rule; likewise Artifact:
    // a group by its ids (city-rule-economic), not by how its name reads.
    const group = kind === "global" ? ACHIEVEMENT_GROUPS.find(g => id.startsWith(g)) : null;
    if (group) for (const [other, a] of list) if (other !== id && other.startsWith(group)) {
      list.delete(other);
      record.lost.push({ ...a, kind, where: a.where.join(", "), how: `replaced by ${name}`, at: where });
    }
    const entry = list.get(id) || { id, name, count: 0, where: [] };
    entry.count++;
    note(entry, where);
    list.set(id, entry);
  };
  // By id: the update script turns the source's names into ids.
  const loseAchievement = (kind, id, at) => {
    const a = record[kind].get(String(id));
    if (!a) return;
    record[kind].delete(String(id));
    record.lost.push({ ...a, kind, where: a.where.join(", "), how: "lost", at });
  };
  const isNumber = v => /^\d+$/.test(String(v));
  const addDesign = (item, where) => {
    const name = isNumber(item) ? itemName(item) : String(item);
    const entry = record.designs.get(name) || { id: name, name, count: 1, where: [] };
    note(entry, where);
    record.designs.set(name, entry);
  };
  const classInfo = id => evRef?.classEvents?.[id];
  const classIdOf = name => Object.entries(evRef?.classes || {}).find(([, n]) => n === String(name))?.[0];
  const unlockClass = (id, where) => {
    if (record.classes.has(id)) return;
    record.classes.set(id, { id, name: className(evRef, id), count: 1, where: where ? [where] : [] });
    // A new class brings its city and road events.
    const n = classInfo(id)?.unlockEvent;
    if (n && !classInfo(id)?.starting) for (const deck of ["city", "road"]) {
      if (!removed[deck].has(n)) addCard(deck, n, `${className(evRef, id)} unlocked`);
    }
  };
  for (const [id, info] of Object.entries(evRef?.classEvents || {})) if (info.starting) unlockClass(id, "starting class");

  const addCard = (deck, number, source) => {
    decks[deck]?.add(number);
    added[deck]?.set(number, source);
    removed[deck]?.delete(number);
  };
  const removeCard = (deck, number, source) => {
    decks[deck]?.delete(number);
    removed[deck]?.set(number, source);
  };
  const gain = (key, range, label, forGood = false) => {
    if (!range.lo && !range.hi) return;
    const t = totals[key];
    const before = t.value;
    t.range = plus(t.range, range);
    t.value += settledPart(range);
    // Reputation stays within −20 to +20, and the city never falls below the
    // start of its prosperity level (rulebook p. 42).
    const hold = (lo, hi) => {
      t.value = Math.max(lo, Math.min(hi, t.value));
      t.range = { lo: Math.max(lo, Math.min(hi, t.range.lo)), hi: Math.max(lo, Math.min(hi, t.range.hi)) };
    };
    if (key === "reputation") hold(-20, 20);
    // The highest and lowest reputation reached: milestones count once reached.
    if (key === "reputation") { t.peak = Math.max(t.peak ?? 0, t.value); t.low = Math.min(t.low ?? 0, t.value); }
    if (key === "prosperity" && range.lo < 0) hold(CHECKMARKS_FOR_PROSPERITY[stepFor(before, CHECKMARKS_FOR_PROSPERITY) - 1], Infinity);
    t.entries.push({ label, range });
    if (!isExact(range)) (forGood ? t.unknown : t.unsure).push(label);
  };

  // The order things happened: completed scenarios as campaign.json lists
  // them. An event with "scenario" comes just before that scenario, one
  // with "after" just after that one; one with neither comes after the
  // event listed before it. Adjustments with a
  // scenario come before it, the rest at the end.
  const played = data.scenarios.filter(s => s.status === "completed");
  const before = played.map(() => []);
  const after = [];
  let into = before[0] || after;
  for (const e of data.events) {
    if (e.scenario != null) {
      const i = played.findIndex(s => s.number === e.scenario);
      into = i >= 0 ? before[i] : after;
    } else if (e.after != null) {
      const i = played.findIndex(s => s.number === e.after);
      into = i >= 0 ? before[i + 1] || after : after;
    }
    into.push({ event: e });
  }
  for (const a of data.adjustments) {
    const i = a.scenario != null ? played.findIndex(s => s.number === a.scenario) : -1;
    (i >= 0 ? before[i] : after).push({ adjustment: a });
  }

  const doEvent = e => {
    const label = eventLabel(e.deck, e.number);
    const options = evRef?.events?.[e.deck]?.[String(e.number)] || {};
    const party = eventParty(data, evRef, e);
    const ctx = { ...party, reputation: totals.reputation.range, paid: e.paid };
    const letters = e.option ? [e.option] : Object.keys(options);
    const found = letters.flatMap(l => possibleOutcomes(options, l, ctx, e.option ? e.outcome : null))
      .map(o => ({ ...o, ...tally(o.effects, ctx, ref, evRef) }));

    // Everything that every possible outcome agrees on happened.
    const key = o => JSON.stringify([o.card, o.reputation, o.prosperity, o.adds, o.unlocks, o.mayAdd, o.mayUnlock, o.gains]);
    const agreed = found.length > 0 && new Set(found.map(key)).size === 1;
    const fates = new Set(found.map(o => o.card));
    const fate = e.card || (fates.size === 1 ? [...fates][0] : null);
    if (fate === "removed") removeCard(e.deck, e.number, e.option ? `${label}, option ${e.option}` : label);

    const inAll = list => found.length ? found[0][list].filter(x => found.every(o => o[list].some(y => JSON.stringify(y) === JSON.stringify(x)))) : [];
    const adds = inAll("adds");
    for (const [deck, number] of adds) addCard(deck, number, `from ${label}`);
    const sure = inAll("unlocks");
    for (const n of sure) unlocks.push({ number: n, source: `${label} event` });
    for (const g of inAll("gains")) {
      if (g.kind === "design") addDesign(g.item, label);
      else if (g.kind === "found") record.found.push({ item: itemName(g.item), from: label });
      else if (g.kind === "randomDesign") {
        if (e.drew) addDesign(e.drew, label);
        else if (e.drawn !== false) record.draws.push({ what: "a random item design", from: label,
          how: `add \`"drew": "Item name"\` to ${label} in the \`"events"\` list` });
      } else gainAchievement(g.kind, g.id, label);
    }

    for (const k of ["reputation", "prosperity"]) {
      if (found.length) gain(k, found.map(o => o[k]).reduce(either), label, Boolean(e.unknown && !e.option));
    }

    // What to ask, if anything is still open.
    const one = found.length === 1 ? found[0] : null;
    if (!found.length) {
      questions.push(`${label}: check the option. The event data has no option ${e.option || ""} for this card.`.replace(" .", "."));
    } else if (e.unknown && !e.option) {
      // "unknown": true says the option can't be known any more: the range
      // stays, the questions go.
    } else if (!agreed && !e.option) {
      const who = found.some(o => o.doubts.some(c => c?.type === "character")) ? ", and who was there" : "";
      questions.push(`${label}: which option did you choose${who}? It decides ${describeStakes(found)}.`);
    } else if (!agreed || (one && one.effectDoubts.length)) {
      const doubt = found.flatMap(o => [...o.doubts, ...o.effectDoubts])[0];
      questions.push(`${label}, option ${e.option}: ${askAbout(doubt, ctx, evRef)}`);
    }
    if (!fate && agreed) questions.push(`${label}: check whether the card was removed or returned to the deck.`);
    const sureAdds = new Set(adds.map(a => JSON.stringify(a)));
    const mayAdds = new Set(found.flatMap(o => [...o.mayAdd, ...o.adds]).map(a => JSON.stringify(a)).filter(a => !sureAdds.has(a)));
    for (const [deck, number] of e.unknown && !e.option ? [] : [...mayAdds].map(a => JSON.parse(a))) {
      questions.push(`${label}: ${eventLabel(deck, number)} may have been added, depending on ${one ? "who was there" : "the outcome"}.`);
    }

    history.push({ ...e, label, fate, adds, option: e.option, outcome: one?.number, effects: one ? one.text : [] });
  };

  const doScenario = s => {
    const r = ref?.scenarios?.[String(s.number)]?.rewards || {};
    const label = `#${s.number}${s.name ? ` ${s.name}` : ""}`;
    const where = `#${s.number}`;
    if (r.reputation) gain("reputation", exact(r.reputation), label);
    if (r.prosperity) gain("prosperity", exact(r.prosperity), label);
    for (const id of r.globalAchievements || []) gainAchievement("global", id, where);
    for (const id of r.partyAchievements || []) gainAchievement("party", id, where);
    for (const id of r.lostPartyAchievements || []) loseAchievement("party", id, where);
    // A design puts every copy in the shop; an item is one copy, given to one
    // of the characters there (rulebook p. 49). Items may be written "27:2"
    // (item 27, two copies).
    for (const id of r.itemDesigns || []) addDesign(String(id).split(":")[0], where);
    for (const id of r.items || []) {
      const [n, copies] = String(id).split(":");
      for (let k = 0; k < (Number(copies) || 1); k++) record.found.push({ item: itemName(n), from: where });
    }
    for (const ev of r.events || []) { const [deck, n] = ev.split(":"); addCard(deck, Number(n), `from ${where}`); }
    if (r.unlockCharacter) unlockClass(r.unlockCharacter, where);

    doTreasures(s, where);
  };

  // What a scenario's treasures gave. Looted on a success, a failure or a
  // casual replay alike: a treasure is gained the moment it's looted (p. 27).
  const doTreasures = (s, where) => {
    // Treasures: "07", or { "number": "07", "character": "Craig", "drew": 52 }.
    const found = [];
    for (const t of s.treasures || []) {
      // "drawn": false says a random draw was never made, and won't be.
      const { number, character, drew, drawn: never } = typeof t === "object" ? { ...t, drawn: t.drawn === false } : { number: t };
      const from = `treasure ${number}`;
      const parts = treasureParts(ref, number);
      for (const part of parts) {
        // A design puts every copy in the shop; a named item goes to whoever
        // looted it, one copy (rulebook p. 14). If no one is written down as
        // looting it, and no sheet has it, ask.
        if (part.type === "itemDesign") addDesign(part.value, `${from} in ${where}`);
        if (part.type === "item") {
          const item = itemName(part.value);
          record.found.push({ item, from, character });
          if (!character && !data.characters.some(c => (c.items || []).some(i => sameItem(i, item)))) {
            record.claims.push({ item, treasure: number, where,
              how: `in scenario ${where}'s \`"treasures"\`, write \`"${number}"\` as \`{ "number": "${number}", "character": "Name" }\`, and add ${item} to their \`items\` unless they've since sold it` });
          }
        }
        if (part.type === "scenario") unlocks.push({ number: Number(part.value), source: from });
        if (part.type === "randomScenario") {
          if (drew != null) unlocks.push({ number: Number(drew), source: from });
          else if (!never) record.draws.push({ what: "a random side scenario", from: `${from}, looted in ${where}`,
            how: `in scenario ${where}'s \`"treasures"\`, write \`"${number}"\` as \`{ "number": "${number}", "drew": 52 }\`, putting the number of the scenario you drew in place of 52` });
        }
        if (part.type === "randomItemDesign") {
          if (drew != null) addDesign(drew, from);
          else if (!never) record.draws.push({ what: "a random item design", from: `${from}, looted in ${where}`,
            how: `in scenario ${where}'s \`"treasures"\`, write \`"${number}"\` as \`{ "number": "${number}", "drew": "Item name" }\`` });
        }
      }
      const gives = parts.map(describeTreasurePart).join(", ") || "not in the treasure index";
      const scenarioDraw = parts.some(part => part.type === "randomScenario");
      const drawn = drew != null ? ` (drew ${scenarioDraw ? `#${drew}` : drew})` : never ? " (never drawn)" : "";
      found.push(`${number}: ${gives}${drawn}${character ? `, to ${character}` : ""}`);
    }
    if (found.length) record.treasures.set(s.number, found);
  };

  const doAdjustment = a => {
    const label = a.notes || "Adjustment";
    if (a.reputation) gain("reputation", exact(a.reputation), label);
    if (a.prosperity) gain("prosperity", exact(a.prosperity), label);
  };

  const step = item => item.event ? doEvent(item.event) : doAdjustment(item.adjustment);
  played.forEach((s, i) => { before[i].forEach(step); doScenario(s); });
  for (const s of data.scenarios.filter(x => x.status !== "completed" && x.treasures?.length)) doTreasures(s, `#${s.number}`);
  after.forEach(step);
  if (data.city.envelopeB) {
    gain("prosperity", exact(1), "Envelope B opened");
    gain("prosperity", exact(donationCheckmarks(data.city.donations)), "Sanctuary donations");
  }

  // Every retirement adds a checkmark to prosperity, and the class's
  // retirement events to the decks (unless one was since drawn and removed).
  for (const c of data.characters.filter(c => c.retired)) {
    gain("prosperity", exact(1), `${c.name} retired`);
    const n = classInfo(classIdOf(c.class))?.retireEvent;
    if (n) for (const deck of ["city", "road"]) if (!removed[deck].has(n)) addCard(deck, n, `${c.name} retired`);
    // Their quest opened a box already open: a random design and scenario.
    const q = c.questDraws;
    if (q) {
      const from = `${c.name}'s retirement`;
      if (q.itemDesign) addDesign(q.itemDesign, from);
      else record.draws.push({ what: "a random item design", from,
        how: `in ${c.name}'s entry in \`"characters"\`, set \`"questDraws"\`' \`"itemDesign"\` to the item's name` });
      if (q.scenario) unlocks.push({ number: Number(q.scenario), source: from });
      else record.draws.push({ what: "a random side scenario", from,
        how: `in ${c.name}'s entry in \`"characters"\`, set \`"questDraws"\`' \`"scenario"\` to its number` });
    }
  }

  // What campaign.json lists by hand: things nothing above accounts for.
  const byHand = (list, entries, kind) => {
    for (const a of entries) {
      const item = typeof a === "string" ? { name: a } : a;
      // By the reference data's id or its exact name; anything else keeps
      // its own name as its id, so it can't pass for one the data has (and
      // the Campaign record asks about it).
      const named = kind === "party" || kind === "global"
        ? Object.entries(ref?.achievements?.[kind] || {}).find(([, n]) => n === item.name)?.[0] : null;
      const id = kind === "classes" ? classIdOf(item.name)
               : kind === "designs" ? item.name : item.id || named || item.name;
      const where = item.scenario != null ? `#${item.scenario}` : "added by hand";
      if (kind === "classes" && !id) continue;
      if (list.has(id)) {
        const known = list.get(id);
        questions.push(`Record: ${known.name} is already worked out (${known.where.join(", ")}). Remove it from campaign.json.`);
      } else if (kind === "classes") {
        unlockClass(id, where);
      } else {
        list.set(id, { id, name: item.name, count: item.count || 1, where: [where], notes: item.notes });
      }
    }
  };
  byHand(record.party, data.party.achievements, "party");
  byHand(record.global, data.city.globalAchievements, "global");
  byHand(record.designs, data.city.itemDesigns, "designs");
  byHand(record.classes, data.city.unlockedClasses, "classes");

  for (const a of data.eventDecks.added) addCard(a.deck, a.number, a.notes || "added by hand");
  for (const r of data.eventDecks.removed) removeCard(r.deck, r.number, r.notes || "removed by hand");

  // Older files kept the totals by hand. Say so if they disagree.
  for (const [key, stored, name] of [["reputation", data.stored.reputation, "reputation"],
                                     ["prosperity", data.stored.prosperityCheckmarks, "prosperity checkmarks"]]) {
    if (typeof stored === "number" && stored !== totals[key].value) {
      questions.push(`Ledger: ${name} in campaign.json says ${stored}, but the scenarios and events add up to ${totals[key].value}. The page uses ${totals[key].value}; remove the number, or add an adjustment for the difference.`);
    }
  }

  const list = map => [...map.values()].map(a => ({ ...a, where: a.where.join(", ") }));
  return { decks, added, removed, history, questions, unlocks, totals,
           record: { party: list(record.party), global: list(record.global), designs: list(record.designs),
                     classes: list(record.classes), draws: record.draws, treasures: record.treasures,
                     found: record.found, claims: record.claims, lost: record.lost } };
}

// What hangs on the choice of option: its effect on the deck and the numbers.
function describeStakes(found) {
  const differs = key => new Set(found.map(o => JSON.stringify(o[key]))).size > 1;
  const stakes = [
    differs("card") ? "what happened to the card" : null,
    differs("reputation") ? "reputation" : null,
    differs("prosperity") ? "prosperity" : null,
    differs("adds") || differs("mayAdd") ? "which cards were added" : null,
    differs("unlocks") || differs("mayUnlock") ? "which scenarios opened" : null,
  ].filter(Boolean);
  return stakes.length ? stakes.join(", ").replace(/, ([^,]*)$/, " and $1") : "what happened";
}

function askAbout(c, ctx, evRef) {
  if (c?.type === "character") {
    return `who was there? It turns on having a ${c.values.map(id => className(evRef, id)).join(" or ")} in the party.`;
  }
  if (c?.type?.startsWith("pay")) return `did you pay${c.values?.length && typeof c.values[0] === "number" ? ` ${goldText(c.values[0])}` : ""}?`;
  if (c?.type === "reputationGT" || c?.type === "reputationLT") {
    return `it turns on ${describeCondition(c, evRef)}, and reputation then could have been ${rangeText(ctx.reputation)}. Which outcome was it?`;
  }
  return "which outcome was it?";
}

// Turn campaign.json's scenario entries plus the reference data into the full
// list of unlocked scenarios, each with a status and, if blocked, the reasons.
// eventUnlocks are scenarios unlocked by events: [{ number, source }].
// The scenarios the reference data alone reveals, each with the one that
// revealed it: #1 (by none), then each unlocked by a completed scenario,
// the lowest-numbered first. The page's scenario list starts from this, and
// so does the file writer, to leave out an unlockedBy it says already.
function revealedByReference(ref, completed) {
  const parent = new Map();
  if (ref) parent.set(1, null);
  for (const c of [...completed].sort((a, b) => a - b)) {
    for (const u of ref?.scenarios?.[String(c)]?.unlocks || []) if (!parent.has(Number(u))) parent.set(Number(u), c);
  }
  return parent;
}

function deriveScenarios(data, ref, eventUnlocks = [], evRef = null) {
  const entries = new Map(data.scenarios.map(s => [s.number, s]));
  const refOf = n => ref?.scenarios?.[String(n)];
  const done = data.scenarios.filter(s => s.status === "completed").map(s => s.number).sort((a, b) => a - b);
  const completed = new Set(done);

  // Which scenario unlocked each one. An unlockedBy in campaign.json wins.
  const parent = revealedByReference(ref, done);
  const via = new Map();
  for (const { number, source } of eventUnlocks) {
    if (!parent.has(number)) { parent.set(number, null); via.set(number, source); }
  }
  for (const s of data.scenarios) {
    if (s.unlockedBy != null) parent.set(s.number, s.unlockedBy);
    else if (!parent.has(s.number)) parent.set(s.number, null);
  }

  const have = achievementCounts(data);
  const nameOf = n => entries.get(n)?.name || refOf(n)?.name || "";

  return [...parent.keys()].map(n => {
    const entry = entries.get(n) || {};
    const info = refOf(n) || {};
    const s = { treasures: [], notes: "", completed: null, ...entry,
                number: n, name: nameOf(n), unlockedBy: parent.get(n), unlockedVia: via.get(n) ?? entry.unlockedVia,
                reasons: [], rewards: [] };

    if (completed.has(n)) {
      s.status = "completed";
      s.rewards = describeRewards(ref, info.rewards, evRef);
      return s;
    }

    const blockers = done.filter(c => (refOf(c)?.blocks || []).includes(String(n)));
    if (blockers.length) s.reasons.push(`Blocked by ${blockers.map(c => `#${c} ${nameOf(c)}`).join(", ")}`);
    const unmet = info.requirements ? unmetRequirements(ref, info.requirements, have) : null;
    if (unmet) s.reasons.push(unmet);
    s.status = entry.status === "blocked" || s.reasons.length ? "blocked" : "available";
    return s;
  });
}

let classRef = null;   // data/gloomhaven-events.json, once loaded

// A class's id in the reference data: its name, or for a locked class the
// spoiler-free name of its icon.
function classId(cls) {
  return Object.entries(classRef?.classes || {}).find(([, n]) => n === String(cls))?.[0] || null;
}

function classPerks(cls) {
  const id = classId(cls);
  return id ? classRef.classEvents?.[id]?.perks || null : null;
}

// A locked class goes by its icon, so naming it spoils nothing.
const CLASS_ICON_NAMES = { "squidface": "squid face", "two-mini": "two minis" };

function classIconName(id) { return CLASS_ICON_NAMES[id] || id.replace(/-/g, " "); }

let questRef = null;   // data/gloomhaven-quests.json, once loaded

const SLOTS = [["head", "Head"], ["body", "Body"], ["legs", "Legs"], ["onehand", "One hand"],
               ["twohand", "Two hands"], ["small", "Small items"]];

function deriveShop(data, items, ledger) {
  if (!items) return null;
  const level = stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const modifier = shopModifier(data.party.reputation);
  const all = Object.entries(items.items).map(([id, item]) => ({ id: Number(id), ...item }));
  const byName = new Map(all.map(item => [item.name, item]));
  const designs = new Set(data.city.itemDesigns.map(d => d.name));
  const inShop = item => (item.prosperity && item.prosperity <= level) || designs.has(item.name);
  const questions = [];

  // Who carries what.
  const owners = new Map();
  for (const c of data.characters.filter(c => !c.retired)) {
    for (const name of c.items) {
      const item = byName.get(name);
      if (!item) {
        questions.push(`${c.name} carries ${name}, which isn't in the item list. ${spelledAs(name, all.map(i => i.name)) || "Check the spelling against the card."}`);
        continue;
      }
      // An item found (treasure or reward) or bought back is carried legitimately.
      const found = (data.foundItems || []).some(f => sameItem(f.item, item.name))
                 || (data.city.returnedItems || []).some(n => sameItem(n, item.name));
      if (!inShop(item) && !found) {
        const why = item.prosperity ? `the shop only has it from prosperity ${item.prosperity}` : "it only comes from a design";
        questions.push(`${c.name} carries ${item.name}, but ${why}. Check the item, or list its design in itemDesigns if the party found one.`);
      }
      const list = owners.get(item.id) || [];
      list.push(c.name);
      owners.set(item.id, list);
    }
  }

  // Copies of items the shop doesn't otherwise sell, back in its supply: sold,
  // or carried by a character who retired (rulebook p. 43).
  const returned = new Map();
  for (const name of data.city.returnedItems || []) {
    const item = byName.get(String(name));
    if (item && !inShop(item)) returned.set(item.id, (returned.get(item.id) || 0) + 1);
  }

  const stock = all.filter(item => inShop(item) || returned.get(item.id)).map(item => {
    const held = owners.get(item.id) || [];
    if (held.length > item.count) {
      questions.push(`${item.name}: the party carries ${held.length}, but only ${item.count} exist.`);
    }
    const back = !inShop(item);
    return { ...item, price: Math.max(0, item.cost + modifier), sells: Math.floor(item.cost / 2), held,
             left: back ? Math.min(returned.get(item.id), Math.max(0, item.count - held.length)) : Math.max(0, item.count - held.length),
             design: !back && !(item.prosperity && item.prosperity <= level), back };
  }).sort((a, b) => a.id - b.id);
  // Names the shop sells anyway, so a sale or retirement needn't put them back.
  const normal = new Set(all.filter(inShop).map(item => item.name));

  // Reputation that isn't settled may mean other prices.
  const range = ledger?.reputation?.range;
  const modifiers = range ? new Set([shopModifier(range.lo), shopModifier(range.hi), modifier]) : new Set([modifier]);
  const coming = all.filter(item => item.prosperity === level + 1).length;

  return { level, modifier, stock, questions, coming, pricesUnsure: modifiers.size > 1, range, normal };
}

let scenarioRef = null;   // data/gloomhaven-scenarios.json

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A whole number as written ("12", "-3"), or 0 for anything else: "12abc"
// and "12.5" aren't read as 12. applyDraft says when a field isn't one.
const num = v => /^\s*-?\d+\s*$/.test(String(v ?? "")) ? Number(v) : 0;
const NUMBER_FIELDS = { number: "number", level: "level", xp: "XP", coins: "coins", gold: "gold", checkmarks: "checkmarks",
                        cost: "cost", bonusPerks: "extra perks", chosen: "chosen scenario" };
// Every number box in a draft that's filled with something that isn't a
// whole number, as a warning each.
function notWholeNumbers(d) {
  const out = [];
  const walk = (value, key) => {
    if (Array.isArray(value)) return value.forEach(v => walk(v, key));
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, key === "shares" || key === "rewardShares" ? "share" : k);
      return;
    }
    const field = key === "share" ? "share" : NUMBER_FIELDS[key];
    if (field && filled(value) && !/^\s*-?\d+\s*$/.test(String(value))) out.push(`"${value}" (${field}) isn't a whole number: check it.`);
  };
  for (const [k, v] of Object.entries(d)) if (k !== "id" && k !== "date") walk(v, k);
  return out;
}

const filled = v => String(v ?? "").trim() !== "";

// The level a recorded scenario was played at (an older draft has none:
// tonight's level stands in).
function draftLevel(s, data) {
  // tonight() is the page's (who's playing, picked on the Overview): absent in the tests.
  const fallback = typeof tonight === "function" ? tonight(data)?.level ?? 0 : 0;
  return Math.max(0, Math.min(7, filled(s.level) ? num(s.level) : fallback));
}

// What one character takes from a scenario played: the XP on their dial,
// plus the bonus XP for the scenario's level if it succeeded, and their
// coins in gold at that level; battle goals count only on a success. The one
// place these rules are applied: a play's results keep what was played (the
// dial, the coins), and everything that shows or adds up what they gave
// comes here. A result with gold instead of coins (an older draft) gives
// that gold. A play with no level (recorded before plays kept one) can't
// apply the rules, so its results are what each took, as written.
function playGain(play, r) {
  if (play.level == null) return { xp: num(r.xp), gold: num(r.gold), checkmarks: num(r.checkmarks) };
  const st = scenarioStats(play.level);
  const won = play.result === "success";
  return {
    xp: num(r.xp) + (won ? st.xp : 0),
    gold: filled(r.coins) ? num(r.coins) * st.gold : num(r.gold),
    checkmarks: won ? num(r.checkmarks) : 0,
  };
}
// The same for a scenario in the draft, at the level it's being recorded at.
const scenarioGain = (s, r, data) => playGain({ level: draftLevel(s, data), result: s.result }, r);

// The draft applied to a copy of campaign.json. Returns the new file, a list
// of what changes, and anything that looks wrong.
function applyDraft(raw, d, data) {
  const out = JSON.parse(JSON.stringify(raw));
  out.scenarios ||= [];
  out.sessions ||= [];
  out.events ||= [];
  out.characters ||= [];
  const log = [];
  const warnings = notWholeNumbers(d);
  for (const c of out.characters) { c.items ||= []; c.perks ||= []; }
  if (String(d.partyName || "").trim()) {
    out.party ||= {};
    out.party.name = String(d.partyName).trim();
    log.push(`The party is named ${out.party.name}`);
  }
  const who = name => out.characters.find(c => c.name === name);
  // Handing someone an item (bought, looted or a reward): one of each item
  // per character, and whoever's items change gets the slot check below.
  const changed = new Set();
  const giveItem = (name, item) => {
    const c = who(name);
    if (!c) return;
    if (c.items.some(i => sameItem(i, item))) warnings.push(`${name} already has ${item}: a character can own only one of each item.`);
    c.items.push(item);
    changed.add(name);
  };
  // Every copy of an item already owned by someone still adventuring.
  const noCopyLeft = item => {
    const copies = Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, item))?.count;
    return Boolean(copies) && out.characters.filter(c => !c.retired && (c.items || []).some(i => sameItem(i, item))).length >= copies;
  };
  // A copy of an item the shop doesn't otherwise sell goes back into its
  // supply when sold or when its owner retires; buying it takes it out.
  const normal = name => data.shop?.normal?.has(String(name)) ?? true;
  const returnItem = name => {
    if (normal(name)) return;
    out.city ||= {};
    // Spelled as the item list does, however the sheet had it.
    (out.city.returnedItems ||= []).push(Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, name))?.name || name);
  };
  const takeReturned = name => {
    const list = out.city?.returnedItems || [];
    const i = list.findIndex(n => sameItem(n, name));
    if (i >= 0) list.splice(i, 1);
  };
  const gainFor = new Map();   // name -> { xp, gold, checkmarks }
  const gain = (name, key, amount) => {
    if (!amount) return;
    const g = gainFor.get(name) || { xp: 0, gold: 0, checkmarks: 0 };
    g[key] += amount;
    gainFor.set(name, g);
  };
  // Every change to a sheet's XP, gold or checkmarks other than what a
  // scenario's results give (those the play keeps) is a line in the
  // character's log, dated with the evening, saying what it was for: the
  // one record of it. what: { xp, gold, checkmarks }; why: { for, ... }.
  const when = d.date || today();
  // Two changes for the same thing (an event's gold and checkmark) are one line.
  const line = (name, what, why) => {
    const c = who(name);
    const amounts = Object.fromEntries(SHEET_SUMS.filter(k => what[k]).map(k => [k, what[k]]));
    if (!c || !Object.keys(amounts).length) return;
    const last = (c.log ||= []).at(-1);
    const cause = e => JSON.stringify(Object.entries(e).filter(([k]) => k !== "date" && !SHEET_SUMS.includes(k)));
    if (last && last.date === when && last.for && cause(last) === cause(why)) {
      for (const [k, v] of Object.entries(amounts)) { last[k] = (last[k] || 0) + v; if (!last[k]) delete last[k]; }
    } else c.log.push({ date: when, ...why, ...amounts });
  };
  // A gain that counts with the evening's (for levels reached tonight).
  const credit = (name, what, why) => {
    for (const k of ["xp", "gold", "checkmarks"]) gain(name, k, what[k] || 0);
    line(name, what, why);
  };
  // An event's gold or XP. A gain counts with the evening's; a loss comes off
  // at once, and can't take gold below 0 or XP below the start of the
  // character's level (rulebook p. 42).
  const eventGain = (name, key, amount, why) => {
    if (amount >= 0) return credit(name, { [key]: amount }, why);
    const c = who(name);
    if (!c) return;
    const was = c[key] || 0;
    if (key === "gold") c.gold = Math.max(0, was + amount);
    else c.xp = Math.max(XP_FOR_LEVEL[stepFor(was, XP_FOR_LEVEL) - 1], was + amount);
    line(name, { [key]: c[key] - was }, why);
  };
  // Newcomers before anything else: a newcomer can play tonight's scenarios
  // and go shopping. Retirements come after the scenarios (below). Each
  // retirement tonight is a prosperity checkmark (p. 48), which counts for a
  // newcomer's starting level and for advancing to the prosperity level.
  const joinLog = [];
  // How many characters a player has retired, tonight's retirements included
  // (with the player named on the retirement row, if not already known).
  const playerOf = c => String((d.retirements || []).find(x => x.character === c.name)?.player || c.player || "").trim();
  const retiredBy = player => {
    const name = String(player || "").trim();
    if (!name) return 0;
    return out.characters.filter(c => playerOf(c) === name && (c.retired || (d.retirements || []).some(x => x.character === c.name))).length;
  };
  const retiring = new Set((d.retirements || []).map(x => x.character).filter(name => who(name) && !who(name).retired));
  const prosperityTonight = stepFor(data.city.prosperityCheckmarks + retiring.size, CHECKMARKS_FOR_PROSPERITY);
  const joined = [];
  const newLevels = [];
  for (const x of d.newCharacters || []) {
    const name = String(x.name || "").trim();
    if (!name && !x.class) continue;
    if (!name) { warnings.push(`A new ${x.class} has no name.`); continue; }
    if (who(name)) { warnings.push(`There's already a character called ${name}.`); continue; }
    if (!x.class) { warnings.push(`${name}: pick a class.`); continue; }
    const level = Math.max(1, Math.min(prosperityTonight, num(x.level) || 1));
    const twin = out.characters.find(c => !c.retired && !retiring.has(c.name) && c.class === x.class);
    if (twin) warnings.push(`${twin.name} already plays a ${x.class}: a party can't have two of the same class.`);
    // One extra perk for each character this player has retired (p. 48):
    // as entered, or counted from the player's retired characters.
    const bonus = filled(x.bonusPerks) ? Math.max(0, num(x.bonusPerks)) : retiredBy(x.player);
    out.characters.push({ name, class: x.class, xp: XP_FOR_LEVEL[level - 1], gold: startingGold(level), checkmarks: 0,
                          perks: [], items: [], start: { xp: XP_FOR_LEVEL[level - 1], gold: startingGold(level), checkmarks: 0, items: [], perks: [] },
                          log: [], personalQuest: "", retired: false, ...(bonus ? { perkBonus: bonus } : {}),
                          ...(String(x.player || "").trim() ? { player: String(x.player).trim() } : {}), joined: d.date || today(), notes: "" });
    const perks = level - 1 + bonus;
    log.push(`${name} the ${x.class} joins at level ${level}, with ${XP_FOR_LEVEL[level - 1]} XP and ${goldText(startingGold(level))}${perks ? `, and ${plural(perks, "perk")} to choose` : ""}${level > 1 ? `; and ${plural(level - 1, "ability card")} to add, one for each level from 2 to ${level} (each of that level or lower)` : ""}`);
    for (let l = 2; l <= level; l++) newLevels.push({ character: name, level: l });
    if (x.playing !== false) joined.push(name);
  }

  const playedTonight = d.scenarios.some(s => num(s.number));
  // Who played: those marked, and newcomers unless they sat it out.
  const party = [...d.party.filter(name => who(name) && !joined.includes(name)), ...joined];
  const played = d.scenarios.filter(s => num(s.number));
  // The first scenario tonight: where a road event with none picked led.
  const firstScenario = num(played[0]?.number) || null;
  // The last scenario completed before tonight: an event in town on an
  // evening without one came after it.
  const lastCompleted = [...(raw.scenarios || [])].reverse().find(s => s.status === "completed")?.number ?? null;

  // Only an evening of play goes in the session log: a perk taken or an item
  // bought between sessions changes the sheets and nothing else.
  const evening = played.length > 0 || d.events.some(e => num(e.number)) || Boolean(String(d.notes || "").trim());
  if (evening && !party.length) warnings.push("No one is marked as playing.");
  // Someone sitting out who plays this evening is back.
  if (evening) for (const name of party) {
    const c = who(name);
    if (c?.inactive) { delete c.inactive; log.push(`${name} plays again, so is no longer inactive`); }
  }
  out.updated = d.date || today();

  // Events, in the order drawn.
  for (const e of d.events.filter(e => num(e.number))) {
    const entry = { deck: e.deck, number: num(e.number) };
    // The evening it was drawn, so the session log shows it there, even when
    // it names a scenario played on other evenings too.
    if (d.date) entry.date = d.date;
    if (e.option) entry.option = e.option;
    if (num(e.scenario)) entry.scenario = num(e.scenario);
    else entry.characters = [...party];
    if (e.paid === "yes") entry.paid = true;
    if (e.paid === "no") entry.paid = false;
    // Not said: paid if the party had the gold, as the rule has it.
    if (e.paid !== "yes" && e.paid !== "no" && e.option) {
      const { could } = eventPayment(data, e.deck, entry.number, e.option, party.map(who).filter(Boolean));
      if (could !== null) entry.paid = could;
    }
    // A city event with no scenario picked came in town before tonight's
    // first scenario, or, on an evening in town only, after the last one
    // played; a road event, on the way to the first scenario tonight.
    // "After" points at a scenario in the campaign's order: the last one
    // newly completed tonight, else the last completed before tonight (a
    // failure or casual replay doesn't move it).
    const lastTonight = num(played.filter(s => s.result === "success" && !isCasual(s, data)
      && data.scenarios.find(x => x.number === num(s.number))?.status !== "completed").at(-1)?.number) || lastCompleted;
    if (e.deck === "city" && e.scenario === "after" && lastTonight) entry.after = lastTonight;
    else if (e.deck === "city" && !entry.scenario && firstScenario) entry.scenario = firstScenario;
    else if (e.deck === "city" && !entry.scenario && lastCompleted) entry.after = lastCompleted;
    if (e.deck === "road" && !entry.scenario && firstScenario) entry.scenario = firstScenario;
    // A road event for a scenario that doesn't take one (p. 41).
    const toward = e.deck === "road" ? played.find(s => num(s.number) === entry.scenario) : null;
    if (toward && isCasual(toward, data)) warnings.push(`${eventLabel(e.deck, entry.number)}: no road event is drawn for a scenario in casual mode.`);
    // Only from town: the first scenario tonight. Travelling on from an
    // earlier one needs a road event unless the two are linked (p. 41).
    else if (toward && toward === played[0] && !needsRoadEvent(entry.scenario)) warnings.push(`${eventLabel(e.deck, entry.number)}: #${entry.scenario} is linked to Gloomhaven, so it takes no road event from town.`);
    if (!classRef?.events?.[e.deck]?.[String(entry.number)]) warnings.push(`${eventLabel(e.deck, entry.number)} isn't in the event data.`);
    // A card that isn't in its deck can't be drawn: most likely a typo.
    else if (data.eventState?.decks?.[e.deck] && !data.eventState.decks[e.deck].has(entry.number)) {
      const label = eventLabel(e.deck, entry.number);
      const why = data.eventState.removed?.[e.deck]?.get(entry.number);
      const how = !why ? "" : why.startsWith(label) ? ": it was removed when it was drawn before" : `: it was removed by ${why}`;
      warnings.push(`${label} isn't in the ${e.deck} deck now${how}. Check the number.`);
    }
    if (!e.option) warnings.push(`${eventLabel(e.deck, entry.number)}: no option chosen.`);
    out.events.push(entry);
    log.push(`${eventLabel(e.deck, entry.number)} drawn${e.option ? `, option ${e.option}` : ""}${entry.scenario ? `, before #${entry.scenario}` : ""}`);

    // Its gold and XP onto the sheets: "each" to everyone there, shared gold
    // as the party split it (rulebook p. 42).
    if (!e.option || !classRef?.events?.[e.deck]?.[String(entry.number)]) continue;
    const label = `${eventLabel(e.deck, entry.number)}, option ${e.option}`;
    const because = { for: "event", deck: e.deck, card: entry.number, option: e.option };
    const outcome = chosenOutcome(data, classRef, e.deck, entry.number, e.option, party, entry.paid);
    const pays = JSON.stringify(classRef.events[e.deck][String(entry.number)][e.option] || []).includes('"type":"pay');
    if (!outcome && pays && entry.paid === undefined) { warnings.push(`${label}: say on its row whether the party paid (Paid?).`); continue; }
    if (!outcome) { warnings.push(`${label}: which outcome applied can't be told from what's recorded, so add any gold or XP it gave by hand.`); continue; }
    if (outcome.unsure) warnings.push(`${label}: part of the outcome depends on something not recorded; check the card for gold or XP.`);
    for (const fx of outcome.effects) {
      if (fx.type === "gold" || fx.type === "experience") {
        for (const name of party) eventGain(name, fx.type === "gold" ? "gold" : "xp", fx.amount, because);
        log.push(`${label}: ${fx.type === "gold" ? goldChange(fx.amount) : `${signed(fx.amount)} XP`} each, for ${party.join(", ")}`);
      } else if (fx.type === "collectiveGold") {
        const shares = e.shares || {};
        const total = party.reduce((sum, name) => sum + Math.max(0, num(shares[name])), 0);
        const want = Math.abs(fx.amount);
        if (total !== want) warnings.push(`${label}: ${goldText(want)} to ${fx.amount > 0 ? "share" : "pay"}, but the shares come to ${total}.`);
        for (const name of party) if (num(shares[name]) > 0) eventGain(name, "gold", Math.sign(fx.amount) * num(shares[name]), because);
        if (total) log.push(`${label}: ${goldText(total)} ${fx.amount > 0 ? "shared" : "paid"} (${party.filter(n => num(shares[n]) > 0).map(n => `${n} ${goldText(num(shares[n]))}`).join(", ")})`);
      } else if (fx.type === "checkmarks") {
        for (const name of party) {
          const c = who(name);
          if (fx.amount > 0) credit(name, { checkmarks: fx.amount }, because);
          // A character can never lose a checkmark that would cost a perk (p. 42).
          else if (c) {
            const was = c.checkmarks || 0;
            c.checkmarks = Math.max(3 * Math.floor(was / 3), was + fx.amount);
            line(name, { checkmarks: c.checkmarks - was }, because);
          }
        }
        log.push(`${label}: ${signed(fx.amount)} battle goal ${Math.abs(fx.amount) === 1 ? "checkmark" : "checkmarks"} each, for ${party.join(", ")}${fx.amount < 0 ? " (never one that would cost a perk)" : ""}`);
      } else if (fx.type === "choose" && fx.of.some(x => x.type === "gold" || x.type === "experience")) {
        warnings.push(`${label}: a choice (${fx.of.map(x => x.amount != null ? `${signed(x.amount)} ${x.type === "experience" ? "XP" : x.type}` : x.type).join(" or ")}); add any gold or XP by hand.`);
      } else if (fx.type === "item") {
        warnings.push(`${label} gives ${itemName(fx.item)}: add it to one character's items.`);
      } else if (fx.type === "payItem") {
        warnings.push(`${label}: the party gave up ${itemName(fx.item)}: take it off the sheet of whoever had it.`);
      }
    }
  }

  // Treasures already looted, and where: a tile is looted once.
  const looted = new Map();
  for (const sc of raw.scenarios || []) {
    for (const t of sc.treasures || []) looted.set(String(Number(typeof t === "object" ? t.number : t)), sc.number);
  }

  // Scenarios, in the order played. A failure or casual replay keeps its
  // results with the session, as it has no completion to keep them.
  const apart = new Map();
  for (const s of played) {
    const n = num(s.number);
    const info = scenarioRef?.scenarios?.[String(n)];
    const known = data.scenarios.find(x => x.number === n);
    const label = `#${n}${info?.name ? ` ${info.name}` : ""}`;
    if (!info) warnings.push(`#${n} isn't a scenario.`);
    else if (!known) warnings.push(`${label} isn't unlocked.`);
    // A scenario already completed can be replayed in casual mode: its XP,
    // gold, loot and battle goals count, but not its rewards or unlocks, and
    // its record stays as it was (rulebook p. 34).
    const casual = isCasual(s, data);
    if (info && known && !casual) {
      if (known.status === "completed" && s.result === "success") warnings.push(`${label} is already completed: tick Casual mode to replay it.`);
      else if (known.status === "blocked" && s.result === "success") warnings.push(`${label} is blocked.`);
    }

    // The level it was played at decides the bonus XP and what a coin is worth.
    const level = draftLevel(s, data);
    const st = scenarioStats(level);
    const usual = recommendedLevel(party.map(name => stepFor(who(name).xp || 0, XP_FOR_LEVEL)));
    if (party.length && (level < Math.max(0, usual - 1) || level > Math.min(7, usual + 2))) {
      warnings.push(`${label} at level ${level}: for this party that's outside easy to very hard (${Math.max(0, usual - 1)} to ${Math.min(7, usual + 2)}).`);
    }
    const results = party.map(name => ({ character: name, ...scenarioGain(s, s.results[name] || {}, data) }));
    for (const r of results) { gain(r.character, "xp", r.xp); gain(r.character, "gold", r.gold); gain(r.character, "checkmarks", r.checkmarks); }
    // Easy to skip someone at the table; a failed scenario keeps XP and gold too.
    const blank = party.filter(name => !["xp", "coins", "gold"].some(k => filled(s.results[name]?.[k])));
    if (info && blank.length) warnings.push(`${label}: no XP or coins entered for ${blank.join(", ")}.`);
    log.push(`${label} at level ${level}: ${goldText(st.gold)} a coin${s.result === "success" ? `, ${st.xp} bonus XP each` : ""}`);
    // What the play keeps is what was played, for everyone there: the XP
    // on their dial, their coins, a battle goal made (playGain works out
    // the rest from the play's level).
    const kept = party.map(name => {
      const x = s.results[name] || {};
      const r = { character: name };
      if (num(x.xp)) r.xp = num(x.xp);
      if (filled(x.coins)) { if (num(x.coins)) r.coins = num(x.coins); } else if (num(x.gold)) r.gold = num(x.gold);
      if (s.result === "success" && num(x.checkmarks)) r.checkmarks = num(x.checkmarks);
      return r;
    });
    // What the treasures gave, looted on a success or a failure alike: a
    // treasure's contents are gained the moment it's looted (rulebook p. 27).
    const loot = () => {
      for (const t of s.treasures.filter(t => t.number)) {
        const tile = String(Number(t.number));
        if (looted.has(tile)) warnings.push(`Treasure ${t.number} was already looted in #${looted.get(tile)}. Check the number.`);
        const tiles = info?.treasures;
        if (tiles && !tiles.includes(tile)) warnings.push(`Treasure ${t.number} isn't in ${label}${tiles.length ? ` (its ${tiles.length === 1 ? "tile is" : "tiles are"} ${tiles.join(", ")})` : ""}. Check the number.`);
        looted.set(tile, n);
        for (const part of treasureParts(scenarioRef, t.number)) {
          if (!t.character) { if (["gold", "experience", "item", "battleGoal"].includes(part.type)) warnings.push(`Treasure ${t.number}: who looted it?`); continue; }
          if (part.type === "gold") {
            credit(t.character, { gold: num(part.value) }, { for: "treasure", treasure: t.number });
            log.push(`${t.character} gains ${goldText(num(part.value))} from treasure ${t.number}`);
          }
          if (part.type === "experience") {
            credit(t.character, { xp: num(part.value) }, { for: "treasure", treasure: t.number });
            log.push(`${t.character} gains ${num(part.value)} XP from treasure ${t.number}`);
          }
          // A battle-goal checkmark, which counts towards a perk as any other.
          if (part.type === "battleGoal") {
            credit(t.character, { checkmarks: num(part.value) }, { for: "treasure", treasure: t.number });
            log.push(`${t.character} gains ${plural(num(part.value), "battle goal checkmark")} from treasure ${t.number}`);
          }
          if (part.type === "item") {
            const item = itemName(part.value);
            // An item the looter already owns is sold at once to the city's
            // supply (p. 27).
            if (who(t.character)?.items.some(i => sameItem(i, item))) {
              const value = Math.floor((Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, item))?.cost || 0) / 2);
              credit(t.character, { gold: value }, { for: "treasure", treasure: t.number, item });
              returnItem(item);
              log.push(`${t.character} already has ${item}, so the one from treasure ${t.number} is sold at once for ${goldText(value)}`);
            } else if (noCopyLeft(item)) {
              // Every copy is someone's: the looter gains its sell value instead (FAQ).
              const value = Math.floor((Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, item))?.cost || 0) / 2);
              credit(t.character, { gold: value }, { for: "treasure", treasure: t.number, item });
              log.push(`No copy of ${item} is left, so ${t.character} gains its sell value from treasure ${t.number}: ${goldText(value)}`);
            } else {
              giveItem(t.character, item);
              log.push(`${t.character} takes ${item} from treasure ${t.number}`);
            }
          }
        }
      }
    };

    // A failure, or a casual replay: what was earned, and the loot, but no
    // completion or rewards. The results go with the session.
    if (s.result !== "success" || casual) {
      log.push(s.result !== "success" ? `${label}: failed` : `${label}: played casually, so no rewards or unlocks`);
      apart.set(s, { casual: casual && s.result === "success", results: kept });
      loot();
      const taken = s.treasures.filter(t => t.number).map(t => t.character ? { number: t.number, character: t.character } : t.number);
      if (taken.length) {
        const entry = out.scenarios.find(x => x.number === n);
        if (entry) entry.treasures = [...(entry.treasures || []), ...taken];
        else out.scenarios.push({ number: n, ...(info?.name ? { name: info.name } : {}), treasures: taken });
      }
      continue;
    }

    // Completed: the scenario moves to the end of the list, which is the order played.
    const old = out.scenarios.find(x => x.number === n) || {};
    out.scenarios = out.scenarios.filter(x => x.number !== n);
    const treasures = s.treasures.filter(t => t.number).map(t => t.character ? { number: t.number, character: t.character } : t.number);
    const entry = { number: n };
    if (old.name || info?.name) entry.name = old.name || info.name;
    entry.status = "completed";
    entry.completed = d.date || null;
    if (old.unlockedBy != null) entry.unlockedBy = old.unlockedBy;
    const allTreasures = [...(old.treasures || []), ...treasures];
    if (allTreasures.length) entry.treasures = allTreasures;
    if (kept.length) entry.results = kept;
    entry.notes = old.notes || "";
    out.scenarios.push(entry);
    log.push(`${label} completed`);

    // Rewards each character gets, and what treasures gave their looters.
    const r = info?.rewards || {};
    for (const name of party) credit(name, { gold: r.gold, xp: r.experience, checkmarks: r.battleGoals }, { for: "reward", scenario: n });
    if (r.battleGoals) log.push(`${label} reward: ${plural(r.battleGoals, "battle goal checkmark")} each`);
    if (r.gold || r.experience) log.push(`${label} reward: ${[r.gold ? goldText(r.gold) : null, r.experience ? `${r.experience} XP` : null].filter(Boolean).join(" and ")} each`);
    if (r.collectiveGold) {
      // Shared as the party split it in the form.
      const shares = s.rewardShares || {};
      const total = party.reduce((sum, name) => sum + Math.max(0, num(shares[name])), 0);
      for (const name of party) if (num(shares[name]) > 0) credit(name, { gold: num(shares[name]) }, { for: "reward", scenario: n });
      if (total !== r.collectiveGold) warnings.push(`${label} gives ${goldText(r.collectiveGold)} to share, but the shares come to ${total}.`);
      else log.push(`${label} reward: ${goldText(total)} shared (${party.filter(n => num(shares[n]) > 0).map(n => `${n} ${goldText(num(shares[n]))}`).join(", ")})`);
    }
    if (r.hints?.gold) warnings.push(`${label}: ${r.hints.gold.replace(/\.?$/, "")} (the scenario book).`);
    // Reward items: one copy each, to one of the characters there (p. 49).
    if (s.result === "success") rewardCopies(info).forEach((item, k) => {
      const taker = (s.rewardTakers || [])[k];
      if (!taker) { warnings.push(`${label} gives ${item}: who takes it?`); return; }
      giveItem(taker, item);
      log.push(`${taker} takes ${item}, a reward of ${label}`);
    });
    if (r.chooseLocation) {
      const chosen = num(s.chosen);
      if (!chosen) warnings.push(`${label} lets you choose one of ${r.chooseLocation.map(x => `#${x}`).join(", ")}: pick it in the form.`);
      else if (!out.scenarios.some(x => x.number === chosen)) {
        out.scenarios.push({ number: chosen, name: scenarioRef?.scenarios?.[String(chosen)]?.name, status: "available", unlockedBy: n });
        log.push(`${label}: #${chosen} chosen as the party's new location`);
      }
    }
    loot();
  }

  // The session itself, if there was one.
  const session = { date: d.date || null };
  if (d.title) session.title = d.title;
  session.scenarios = played.map(s => ({ number: num(s.number), level: draftLevel(s, data), result: s.result,
    ...(apart.get(s)?.casual ? { casual: true } : {}), ...(apart.get(s)?.results?.length ? { results: apart.get(s).results } : {}) }));
  session.characters = [...party];
  session.notes = d.notes || "";
  if (evening) placeSession(out.sessions, session);

  // Scenarios a personal quest opens (the second step of some quests).
  for (const o of d.opened || []) {
    const n = num(o.number);
    if (!n) continue;
    const name = scenarioRef?.scenarios?.[String(n)]?.name;
    if (!name) { warnings.push(`#${o.number} isn't a scenario number.`); continue; }
    if (out.scenarios.some(s => s.number === n)) { warnings.push(`#${n} ${name} is already on the list.`); continue; }
    // Saved without naming whose quest: only one card opens each of these
    // scenarios, so a name would give the quest away in the public file.
    out.scenarios.push({ number: n, name, status: "available", unlockedVia: "a personal quest" });
    log.push(`#${n} ${name} opens, from a personal quest`);
  }

  // Personal quest progress, as updated in the form; once fulfilled, the
  // character must retire before playing again (p. 48).
  for (const [name, value] of Object.entries(d.quests || {})) {
    if (!filled(value)) continue;
    const c = who(name);
    if (!c || c.retired && !(d.retirements || []).some(x => x.character === name)) continue;
    // Only progress that can be counted goes into the file.
    if (!questSteps(value)) {
      warnings.push(`${name}'s personal quest progress "${String(value).trim()}" can't be read, so it isn't recorded: ${QUEST_HOW}.`);
      continue;
    }
    c.personalQuest = String(value).trim();
    log.push(`${name}'s personal quest: ${c.personalQuest}${questDone(c.personalQuest) ? ", fulfilled" : ""}`);
    if (questDone(c.personalQuest) && !(d.retirements || []).some(x => x.character === name)) {
      warnings.push(`${name}'s personal quest is fulfilled: they must retire before playing again (Retiring and joining).`);
    }
  }

  // Past treasures settled: who looted them, and the item onto their sheet,
  // or back in the shop's supply if they've sold it since (p. 43).
  for (const c of data.claims || []) {
    const x = d.claims?.[`${c.where}:${c.treasure}`];
    if (!x?.character) continue;
    const sc = out.scenarios.find(s => `#${s.number}` === c.where);
    const k = (sc?.treasures || []).findIndex(t => String(typeof t === "object" ? t.number : t) === String(c.treasure));
    if (k < 0) continue;
    const t = sc.treasures[k];
    sc.treasures[k] = { ...(typeof t === "object" ? t : { number: t }), character: x.character };
    if (x.kept !== false) giveItem(x.character, c.item); else returnItem(c.item);
    log.push(`Treasure ${c.treasure} in ${c.where}: ${x.character} looted ${c.item}${x.kept !== false ? "" : ", and has since sold it"}`);
  }

  // Retirements, after the evening's scenarios: a character who played tonight
  // keeps tonight's loot until retiring, then it all goes back to the shop.
  for (const x of (d.retirements || []).filter(x => x.character)) {
    const c = who(x.character);
    if (!c || c.retired) { warnings.push(`${x.character} isn't an active character.`); continue; }
    c.retired = true;
    c.retiredOn = d.date || today();
    if (String(x.player || "").trim()) c.player = String(x.player).trim();
    // All money the character owned is gone (p. 48): below, with tonight's.
    delete c.inactive;
    for (const item of c.items || []) returnItem(item);
    joinLog.push(`${c.name} retires: a prosperity checkmark, the ${c.class} retirement events go into the decks, and their items go back to the shop, and their gold is gone`);
    // What their quest opens comes from their quest card, in the form.
    if (!x.unlocks) {
      warnings.push(`${c.name} retires, but nothing says what their personal quest opens: pick their quest card in the form (Retiring and joining).`);
      continue;
    }
    // Two quests open Envelope X instead of a class box.
    if (x.unlocks === "envelope-x") {
      if (data.city.envelopeX || out.city?.envelopeX) {
        c.questDraws = { itemDesign: null, scenario: null };
        joinLog.push(`${c.name}'s personal quest opens Envelope X, which is already open: instead, draw a random item design and a random side scenario`);
      } else {
        out.city ||= {};
        out.city.envelopeX = true;
        joinLog.push(`${c.name}'s personal quest opens Envelope X`);
      }
      continue;
    }
    // A box already opened gives a random item design and a random side
    // scenario instead (rulebook p. 48): the Campaign record asks for both.
    if (data.city.unlockedClasses.some(u => u.id === x.unlocks)
        || (out.city?.unlockedClasses || []).includes(className(classRef, x.unlocks))) {
      c.questDraws = { itemDesign: null, scenario: null };
      joinLog.push(`${c.name}'s personal quest opens the box with the ${classIconName(x.unlocks)} icon, which is already open: instead, draw a random item design and a random side scenario`);
      continue;
    }
    out.city ||= {};
    out.city.unlockedClasses = [...(out.city.unlockedClasses || []), className(classRef, x.unlocks)];
    joinLog.push(`${c.name}'s personal quest unlocks the class with the ${classIconName(x.unlocks)} icon, and its events go into the decks`);
  }

  // Advancing to the prosperity level: XP up to that level's start (p. 48).
  for (const name of d.advances || []) {
    const c = who(name);
    if (!c || c.retired) continue;
    const short = XP_FOR_LEVEL[prosperityTonight - 1] - (c.xp || 0) - (gainFor.get(name)?.xp || 0);
    if (short <= 0) continue;
    credit(name, { xp: short }, { for: "advance", level: prosperityTonight });
    log.push(`${name} advances to level ${prosperityTonight}, the prosperity level`);
  }

  // XP, gold and checkmarks onto the character sheets. Passing a level means
  // a new ability card; the perk that comes with it the sheet counts.
  const levelUps = [];
  for (const [name, g] of gainFor) {
    const c = who(name);
    const was = stepFor(c.xp || 0, XP_FOR_LEVEL);
    c.xp = (c.xp || 0) + g.xp;
    c.gold = (c.gold || 0) + g.gold;
    c.checkmarks = (c.checkmarks || 0) + g.checkmarks;
    log.push(`${name}: ${[g.xp ? `${signed(g.xp)} XP` : null, g.gold ? goldChange(g.gold) : null,
                          g.checkmarks ? `${signed(g.checkmarks)} ${g.checkmarks === 1 ? "checkmark" : "checkmarks"}` : null].filter(Boolean).join(", ")}`);
    const now = c.retired ? was : stepFor(c.xp, XP_FOR_LEVEL);
    for (let level = was + 1; level <= now; level++) {
      levelUps.push({ character: name, level });
      log.push(`${name} reaches level ${level}: add an ability card of level ${level} or lower, and take a perk`);
    }
  }
  if (levelUps.length || newLevels.length) session.levelUps = [...newLevels, ...levelUps];
  // Bless cards kept from an earlier donation are used in tonight's scenario.
  if (playedTonight) for (const name of party) if (who(name)?.blessNext && !(d.donations || []).some(x => x.character === name && x.when === "after")) delete who(name).blessNext;
  // Who retired tonight leaves with nothing: their gold is gone (p. 48).
  for (const name of retiring) {
    const c = who(name);
    if (!c?.retired) continue;
    line(name, { gold: -(c.gold || 0) }, { for: "retirement" });
    c.gold = 0;
  }

  log.push(...joinLog);

  // Shopping and perks, after the scenarios.
  const priceOf = name => data.shop?.stock.find(i => sameItem(i.name, name))?.price;
  for (const b of d.buys.filter(b => b.character && b.item)) {
    const c = who(b.character);
    const price = priceOf(b.item) ?? 0;
    c.gold = (c.gold || 0) - price;
    line(b.character, { gold: -price }, { for: "buy", item: b.item });
    giveItem(b.character, b.item);
    takeReturned(b.item);
    log.push(`${b.character} buys ${b.item} for ${goldText(price)}`);
  }
  // No more copies bought than the shop has, counting any sold back tonight.
  const bought = new Map();
  for (const b of d.buys.filter(b => b.character && b.item)) bought.set(b.item, (bought.get(b.item) || 0) + 1);
  for (const [name, n] of bought) {
    const left = data.shop?.stock.find(i => i.name === name)?.left;
    const back = d.sells.filter(x => x.character && x.item === name).length;
    if (left != null && n > left + back) {
      warnings.push(`${name}: the draft buys ${n}, but ${left ? `only ${left} ${left === 1 ? "is" : "are"}` : "none are"} left in the shop.`);
    }
  }
  for (const sale of d.sells.filter(x => x.character && x.item)) {
    const c = who(sale.character);
    const i = c.items.findIndex(x => sameItem(x, sale.item));
    if (i < 0) { warnings.push(`${sale.character} doesn't carry ${sale.item}.`); continue; }
    c.items.splice(i, 1);
    changed.add(sale.character);
    returnItem(sale.item);
    const item = Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, sale.item));
    const value = item ? Math.floor(item.cost / 2) : 0;
    c.gold = (c.gold || 0) + value;
    line(sale.character, { gold: value }, { for: "sell", item: sale.item });
    log.push(`${sale.character} sells ${sale.item} for ${goldText(value)}`);
  }
  out.city ||= {};
  const before = out.city.donations || 0;
  const donors = (d.donations || []).filter(x => x.character);
  for (const x of donors) {
    const c = who(x.character);
    c.gold = (c.gold || 0) - DONATION;
    line(x.character, { gold: -DONATION }, { for: "donation" });
    out.city.donations = (out.city.donations || 0) + DONATION;
    c.donated = (c.donated || 0) + DONATION;
    // Two Bless cards for their next scenario (p. 45): tonight's, if they
    // play one after this; otherwise kept on the sheet until they do.
    if (x.when === "after" || !(playedTonight && party.includes(c.name))) c.blessNext = true;
    log.push(`${x.character} donates ${goldText(DONATION)} to the Sanctuary: two Bless cards in their next scenario`);
  }
  for (const name of new Set(donors.map(x => x.character))) {
    if (donors.filter(x => x.character === name).length > 1) warnings.push(`${name} donates more than once: it's once per visit to the city.`);
  }
  if (before < ENVELOPE_B_DONATIONS && (out.city.donations || 0) >= ENVELOPE_B_DONATIONS && !d.envelopeB) {
    log.push(`Donations reach ${goldText(out.city.donations)}: Envelope B can be opened`);
  }
  if (d.envelopeB && !out.city.envelopeB) {
    out.city.envelopeB = true;
    log.push("Envelope B opened");
  }
  for (const x of (d.enhancements || []).filter(x => x.character)) {
    const c = who(x.character);
    if (!c) continue;
    c.gold = (c.gold || 0) - num(x.cost);
    line(x.character, { gold: -num(x.cost) }, { for: "enhancement", what: x.what });
    c.enhanced = (c.enhanced || 0) + 1;
    log.push(`${x.character} enhances a card (${x.what}) for ${goldText(num(x.cost))}`);
  }
  for (const p of d.perks.filter(p => p.character && p.perk)) {
    who(p.character).perks.push(p.perk);
    log.push(`${p.character} takes "${p.perk}"`);
  }
  for (const c of out.characters) if (c.gold < 0) warnings.push(`${c.name} would have ${goldText(c.gold)}.`);

  // The draft's id, just after "updated" (replacing an earlier one).
  const marked = {};
  for (const [k, v] of Object.entries(out)) {
    if (k === "lastDraft") continue;
    marked[k] = v;
    if (k === "updated") marked.lastDraft = d.id;
  }
  return { out: marked, log, warnings, evening, party };
}

// campaign.json written the way the file is laid out by hand: short lists of
// plain values on one line; a list of entries (events, results) one entry
// per line when every entry fits, otherwise each entry spread out.
// mode: "auto", "inline" (one line) or "block" (spread out).
function formatJson(value, indent = "", mode = "auto") {
  const flat = v => v === null || typeof v !== "object";
  const shallow = v => flat(v) || (Array.isArray(v) ? v.every(flat) : Object.values(v).every(x => flat(x) || (Array.isArray(x) && x.every(flat))));
  const inline = v => flat(v) ? JSON.stringify(v)
    : Array.isArray(v) ? `[${v.map(inline).join(", ")}]`
    : Object.keys(v).length ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }` : "{}";
  const canInline = (v, ind, inList) => ind.length >= 4 && (Array.isArray(v) ? v.every(shallow) : shallow(v))
    && ind.length + inline(v).length <= (inList ? 240 : 130);
  if (flat(value)) return JSON.stringify(value);
  if (mode === "inline" || (mode === "auto" && canInline(value, indent, false))) return inline(value);
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const entries = value.filter(v => !flat(v));
    const together = entries.length > 0 && entries.every(v => canInline(v, inner, true));
    return `[\n${value.map(v => inner + formatJson(v, inner, together ? "inline" : "block")).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`).join(",\n")}\n${indent}}`;
}

// Fill in anything missing, so older or partial files still display.
function withDefaults(raw) {
  const party = { name: "", location: "", achievements: [], notes: "", ...raw.party, reputation: 0 };
  const city = { donations: 0, globalAchievements: [], unlockedClasses: [], itemDesigns: [], returnedItems: [], ...raw.city, prosperityCheckmarks: 0 };
  return {
    ...raw,
    party,
    city,
    // Reputation and prosperity are worked out; older files kept them by hand.
    stored: { reputation: raw.party?.reputation, prosperityCheckmarks: raw.city?.prosperityCheckmarks },
    adjustments: raw.adjustments || [],
    scenarios: raw.scenarios || [],
    characters: (raw.characters || []).map(c => ({ xp: 0, gold: 0, checkmarks: 0, perks: [], items: [], ...c })),
    sessions: (raw.sessions || []).map(s => ({ scenarios: [], ...s })),
    events: raw.events || [],
    eventDecks: { added: [], removed: [], ...raw.eventDecks },
  };
}

// Every play campaign.json records, in file order, with who played and
// what they got: its results and players, wherever fromFile keeps them (the
// win that completed a scenario gave them to the scenario); then each
// scenario marked completed with no session behind it. The one way to read
// a play's results: each says what the character took (playGain), with what
// was played beside it (dial XP as played, coins).
const playsCache = new WeakMap();
function plays(data) {
  if (playsCache.has(data)) return playsCache.get(data);
  const done = completions(data.sessions);
  const entry = new Map(data.scenarios.map(s => [s.number, s]));
  const out = [];
  for (const session of data.sessions) {
    for (const play of session.scenarios || []) {
      const from = done.get(play.number)?.play === play ? entry.get(play.number) || play : play;
      out.push({ number: play.number, level: play.level ?? null, result: play.result, casual: Boolean(play.casual), session,
                 results: tookFrom(play, from.results), players: from.players || [] });
    }
  }
  for (const s of data.scenarios) {
    if (s.status === "completed" && !done.has(s.number)) {
      out.push({ number: s.number, level: null, result: "success", casual: false, session: null, results: tookFrom({}, s.results), players: s.players || [] });
    }
  }
  playsCache.set(data, out);
  return out;
}
const tookFrom = (play, results) => (results || []).map(r => ({ ...r, played: { xp: r.xp, coins: r.coins }, ...playGain(play, r) }));

// What each character took from the play that completed scenario n.
const completionResults = (data, n) => plays(data).find(p => p.number === n && p.result === "success" && !p.casual)?.results || [];

// What each character took from every play: name -> { xp, gold, checkmarks }.
function tookFromPlays(data) {
  const sums = new Map();
  for (const p of plays(data)) {
    for (const r of p.results) {
      const t = sums.get(r.character) || { xp: 0, gold: 0, checkmarks: 0 };
      for (const k of ["xp", "gold", "checkmarks"]) t[k] += r[k];
      sums.set(r.character, t);
    }
  }
  return sums;
}

// Who played: those its results or its players name (players say who played
// where results were lost, so both count); with neither, who was there in
// its session.
function playedBy(p) {
  const named = new Set([...p.results.map(r => r.character), ...p.players]);
  return named.size ? [...named] : p.session?.characters || [];
}

// Who completed each scenario, as far as campaign.json says, casual mode
// included (rulebook p. 34: casual play makes quest progress): who played
// each win. null when nothing records who played.
const completedByCache = new WeakMap();
function completedBy(data) {
  if (completedByCache.has(data)) return completedByCache.get(data);
  const who = new Map();
  completedByCache.set(data, who);
  for (const p of plays(data)) {
    if (p.result !== "success") continue;
    if (!who.has(p.number)) who.set(p.number, new Set());
    for (const n of playedBy(p)) who.get(p.number).add(n);
  }
  for (const [n, names] of who) if (!names.size) who.set(n, null);
  return who;
}

// A personal quest's steps, counted from what campaign.json records where it
// can be (scenarios completed: by name, with a boss, side scenarios, any; a
// scenario chain followed to its end; battle-goal checkmarks; gold; items).
// Steps it can't count (kills, exhaustion, regions, donations) take the
// count as recorded, when the record has one per step. A step that waits on
// another counts nothing until that one is done. maybe: scenarios that would
// count, but nothing records who played them. opens: the scenario the step
// starts with, once it can begin.
function questProgress(data, c, card) {
  const quest = questRef?.quests?.[card];
  if (!quest) return null;
  const by = completedBy(data);
  const recorded = questSteps(c.personalQuest);
  const sameShape = recorded && recorded.length === quest.steps.length;
  const refOf = n => scenarioRef?.scenarios?.[String(n)];
  const steps = [];
  quest.steps.forEach((step, i) => {
    const out = { text: step.text, count: step.count, after: Boolean(step.after), n: null, auto: true, maybe: [], opens: null, ready: true };
    const ready = (step.after || []).every(k => steps[k - 1]?.n != null && steps[k - 1].n >= steps[k - 1].count);
    const [kind, arg = ""] = (step.track || "").split(":");
    const scenarios = test => {
      let n = 0;
      for (const [number, names] of by) {
        if (!test(number)) continue;
        if (!names) out.maybe.push(number); else if (names.has(c.name)) n++;
      }
      return n;
    };
    if (kind === "scenarioName") out.n = scenarios(n => (refOf(n)?.name || "").includes(arg));
    else if (kind === "scenarioIn") out.n = scenarios(n => arg.split(",").map(Number).includes(n));
    else if (kind === "bossScenarios") out.n = scenarios(n => refOf(n)?.boss);
    else if (kind === "scenariosCompleted") out.n = scenarios(() => true);
    else if (kind === "sideScenarios") {
      const [lo, hi] = arg.split("-").map(Number);
      out.n = scenarios(n => n >= lo && n <= hi);
    } else if (kind === "scenario") {
      const [first, last] = arg.split("|").map(Number);
      out.n = scenarios(n => n === last);
      if (ready) out.opens = first;
    } else if (kind === "retiredChars") {
      // Other characters' quests fulfilled while this one adventured: those
      // retired since it joined; one with no date may or may not count.
      const others = data.characters.filter(o => o.retired && o.name !== c.name);
      const dated = others.filter(o => o.retiredOn && (!c.joined || o.retiredOn >= c.joined));
      out.n = dated.length;
      out.extra = others.filter(o => !o.retiredOn).length;
      out.extraWhy = "if retirements without a date came after they joined";
    } else if (kind === "donatedGold" || kind === "enhancements") {
      // Counted since the page began recording them: any higher count fits.
      out.n = kind === "donatedGold" ? c.donated || 0 : c.enhanced || 0;
      out.extra = Math.max(0, step.count - out.n);
      out.extraWhy = `from before the page recorded ${kind === "donatedGold" ? "donations" : "enhancements"}`;
    } else if (kind === "battleGoals") {
      // Only checkmarks from completed battle goals count (FAQ, quest 519),
      // which a scenario's results record; others on the sheet may be from
      // battle goals played before results were kept, or from treasures.
      const fromGoals = plays(data).flatMap(p => p.results)
        .filter(r => r.character === c.name).reduce((sum, r) => sum + (r.checkmarks || 0), 0);
      out.n = fromGoals;
      out.extra = Math.max(0, (c.checkmarks || 0) - fromGoals);
      out.extraWhy = "if the sheet's other checkmarks came from battle goals";
    }
    else if (kind === "gold") out.n = c.gold || 0;
    else if (kind === "itemType") out.n = c.items.filter(i => arg.split("|").includes(itemSlot(i))).length;
    else if (kind === "item") {
      const name = itemsRef?.items?.[arg]?.name;
      out.n = c.items.some(i => name && sameItem(i, name)) ? 1 : 0;
    } else {
      out.auto = false;
      if (sameShape) out.n = recorded[i][0];
    }
    if (!ready) { out.n = out.auto || out.n == null ? 0 : out.n; out.maybe = []; out.extra = 0; out.ready = false; }
    if (out.n != null) out.n = Math.min(out.n, step.count);
    steps.push(out);
  });
  // Written out, only when every step is known for certain: a step that
  // waits on the one before joins it with ", then", the others with " + ".
  const joins = steps.slice(1).map(x => x.after ? ", then " : " + ");
  const text = steps.every(x => x.n != null && !x.maybe.length && !x.extra)
    ? steps.map((x, i) => `${i ? joins[i - 1] : ""}${x.n}/${x.count}`).join("") : null;
  // A recorded count agrees when it's joined as the card's steps are, and
  // each step is between what's counted and that plus the scenarios no one
  // recorded playing.
  const fits = written => {
    const { steps: r, joins: joined } = questParts(written) || {};
    return Boolean(r) && r.length === steps.length && joined.every((j, i) => j === joins[i]) && r.every(([n, m], i) => m === steps[i].count && steps[i].n != null
      && n >= steps[i].n && n <= Math.min(steps[i].count, steps[i].n + steps[i].maybe.length + (steps[i].extra || 0)));
  };
  const known = steps.every(x => x.n != null);
  return { name: quest.name, card, steps, text, known, fits, unlockClass: quest.unlockClass, openEnvelope: quest.openEnvelope };
}

// What a personal quest card opens once fulfilled: a class box (its id), or
// "envelope-x"; "" for a card the data doesn't know.
function questUnlocks(card) {
  const quest = questRef?.quests?.[card];
  return quest?.unlockClass || (quest?.openEnvelope ? `envelope-${quest.openEnvelope.toLowerCase()}` : "");
}

// A personal quest's progress as the page takes it in: one input per step,
// so nobody writes it out. With the card (questProgress, on the phone that
// knows it): a step the record counts is that count, or anywhere up to what
// may have been missed; a step only the table knows (kills, exhaustion)
// goes from 0 to its target; a step that waits on another stays where it
// is until that one is done. Without the card, from the steps the record
// already has: each from 0 to its target, a step after ", then" waiting on
// the one before. Each step: value, min, max, and kind: "fixed" (nothing to
// set), "check" (one thing, a check box) or "count" (− and +). text: the
// progress the values make. null when neither says what the steps are.
function questInputs(p, written) {
  const parts = questParts(written);
  let steps, joins;
  if (p) {
    joins = p.steps.slice(1).map(x => x.after ? ", then " : " + ");
    const same = parts && parts.steps.length === p.steps.length && parts.steps.every(([, m], i) => m === p.steps[i].count);
    steps = p.steps.map((x, i) => {
      const n = x.n ?? 0;
      const [min, max] = !x.ready ? [0, n]
        : x.auto ? [n, Math.min(x.count, n + x.maybe.length + (x.extra || 0))] : [0, x.count];
      const wrote = same ? parts.steps[i][0] : x.auto ? min : n;
      return { text: x.text, count: x.count, after: x.after, auto: x.auto, min, max, value: Math.max(min, Math.min(max, wrote)) };
    });
  } else if (parts) {
    joins = parts.joins;
    steps = [];
    parts.steps.forEach(([n, m], i) => {
      const after = i > 0 && joins[i - 1] === ", then ";
      const ready = !after || steps[i - 1].value >= steps[i - 1].count;
      steps.push({ text: null, count: m, after, auto: false, min: 0, max: ready ? m : Math.min(n, m), value: Math.min(n, m) });
    });
  } else return null;
  for (const x of steps) x.kind = x.min === x.max ? "fixed" : x.count === 1 ? "check" : "count";
  const text = steps.map((x, i) => `${i ? joins[i - 1] : ""}${x.value}/${x.count}`).join("");
  return { steps, joins, text };
}

// The progress with one step set to a value: what a tap on − or + or a check
// box writes.
function questSet(inputs, i, value) {
  return inputs.steps.map((x, k) => `${k ? inputs.joins[k - 1] : ""}${k === i ? Math.max(x.min, Math.min(x.max, value)) : x.value}/${x.count}`).join("");
}

// --- Perks --------------------------------------------------------------------

// A perk is the class's perk only when it's written word for word as the
// character sheet (the reference data) has it: anything else is flagged, with
// the closest perk as a hint, never taken for one. The form writes the
// sheet's wording, so only a hand edit can differ.
function matchPerk(text, perks) {
  return perks.find(p => p.text === text) || null;
}

// For the hint only: a perk's telling words, with what says little about
// which perk it is taken out (counts, "rolling", "+0", "card").
const NUMBER_WORDS = { "1": "one", "2": "two", "3": "three", "4": "four" };
const PLAIN_WORDS = new Set(["add", "remove", "replace", "with", "and", "one", "two", "three", "four"]);
function perkWords(text) {
  return String(text).toLowerCase().replace(/[−–]/g, "-").replace(/\([^)]*\)/g, " ")
    .replace(/(^|\s)([1-4])(?=\s|$)/g, (m, pre, d) => pre + NUMBER_WORDS[d])
    .replace(/\bcards?\b/g, " ").replace(/[^a-z0-9+\- ]/g, " ")
    .replace(/\brolling\b/g, " ").replace(/(^|\s)\+0(?=\s|$)/g, " ")
    .split(/\s+/).filter(w => w && !PLAIN_WORDS.has(w));
}

// The class perk sharing the most telling words with a written one, for the
// hint beside a perk that isn't on the sheet.
function closestPerk(text, perks) {
  const words = new Set(perkWords(text));
  let best = null, score = 0;
  for (const p of perks) {
    const theirs = perkWords(p.text);
    const shared = theirs.filter(w => words.has(w)).length / (new Set([...words, ...theirs]).size || 1);
    if (shared > score) { best = p; score = shared; }
  }
  return score >= 0.3 ? best : null;
}

// The perks a character has taken, matched to the class's list, and the ones
// still open.
function perkCheck(c) {
  const perks = classPerks(c.class);
  const rows = [];
  for (const text of c.perks) {
    const match = perks ? matchPerk(text, perks) : null;
    const key = match ? match.text : text;
    const row = rows.find(r => r.key === key);
    if (row) row.count++;
    else rows.push({ key, text: match ? match.text : text, written: text, match, count: 1 });
  }
  for (const r of rows) {
    if (!perks) continue;
    if (!r.match) {
      const near = closestPerk(r.written, perks);
      r.note = `Not on the ${c.class} sheet.${near ? ` Closest: ${near.text}.` : ""}`;
    } else if (r.count > r.match.count) {
      r.note = `Taken ${r.count} times, but the sheet has ${plural(r.match.count, "box").replace("boxs", "boxes")}.`;
    }
  }
  const open = (perks || []).map(p => ({ ...p, left: p.count - (rows.find(r => r.match === p)?.count || 0) }))
    .filter(p => p.left > 0);
  return { known: Boolean(perks), rows, open };
}

// A character's attack modifier deck: the standard twenty cards, changed by
// each perk taken, as the class's data says (data/gloomhaven-events.json:
// each perk's "deck", the cards it removes and adds). taken: the class's
// perks, each as often as taken; unknown: perks written that aren't the
// class's, which change nothing and are listed as such. A perk that would
// take a card the deck hasn't got is never half applied: it's listed too.
const BASE_DECK = [["−2", 1], ["−1", 5], ["+0", 6], ["+1", 5], ["+2", 1], ["2×", 1], ["Null", 1]];
function attackDeck(taken, unknown = []) {
  let deck = new Map(BASE_DECK);
  const unread = [...unknown];
  for (const perk of taken) {
    if (!perk.deck) continue;
    const next = new Map(deck);
    let ok = true;
    for (const [n, card] of perk.deck.remove || []) {
      if ((next.get(card) || 0) < n) { ok = false; break; }
      next.set(card, next.get(card) - n);
    }
    if (!ok) { unread.push(perk.text); continue; }
    for (const [n, card] of perk.deck.add || []) next.set(card, (next.get(card) || 0) + n);
    deck = next;
  }
  const order = ["Null", "−2", "−1", "+0", "+1", "+2", "+3", "+4", "2×"];
  const rank = k => order.includes(k) ? order.indexOf(k) : order.length;
  const cards = [...deck].filter(([, n]) => n > 0).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  return { cards, total: cards.reduce((sum, [, n]) => sum + n, 0), unread };
}

// --- Item slots ----------------------------------------------------------------

// Slots: one head, body and legs item; two hands (a two-handed item takes
// both); small items up to half the character's level, rounded up.
// What a character's items take up, and the room they have at their level.
function slotUse(c, level) {
  const byName = new Map(Object.values(itemsRef?.items || {}).map(i => [i.name, i]));
  const used = { head: 0, body: 0, legs: 0, hands: 0, small: 0 };
  for (const name of c.items) {
    const slot = byName.get(name)?.slot;
    if (slot === "onehand") used.hands += 1;
    else if (slot === "twohand") used.hands += 2;
    else if (slot in used) used[slot] += 1;
  }
  return { used, limits: { head: 1, body: 1, legs: 1, hands: 2, small: Math.ceil(level / 2) } };
}
// How much of that room an item takes, by the slot the item cards print.
const slotNeed = slot => slot === "onehand" ? ["hands", 1] : slot === "twohand" ? ["hands", 2] : [slot, 1];

// A character can own any number of items, but equip only what the slots
// hold (rulebook p. 43): where they own more, which to take is their pick.
function itemCheck(c, level) {
  const { used, limits } = slotUse(c, level);
  const names = { head: "head items", body: "body items", legs: "legs items", hands: "hands' worth of items", small: "small items" };
  return Object.keys(limits).filter(k => used[k] > limits[k])
    .map(k => `Owns ${used[k]} ${names[k]} and can equip ${limits[k]}${k === "small" ? ` at level ${level}` : ""}: pick which to take into a scenario.`);
}

// --- Milestones ---------------------------------------------------------------

// What the campaign works towards, and what it opens when it gets there
// (rulebook p. 49): one table, read by Before you play (what's ready to be
// done) and the Campaign record (how far each has come). Each says:
// have/need: how far (need 0: no count, ready once have is above 0); open:
// done already; shown: listed at all (the ±20 events once a box is near);
// todo: what Before you play says once it's ready, and where that's done.
const ANCIENT_TECHNOLOGY_FOR_ENVELOPE_A = 5;
const MILESTONES = [
  { id: "envelope-a", name: "Envelope A", need: ANCIENT_TECHNOLOGY_FOR_ENVELOPE_A, what: "Ancient Technology achievements",
    have: m => m.tech, open: m => Boolean(m.city.envelopeA),
    todo: () => ["Five Ancient Technology achievements: open envelope A, then set envelopeA to true in campaign.json.", "#record"] },
  { id: "envelope-b", name: "Envelope B", need: ENVELOPE_B_DONATIONS, unit: "g", what: "donated at the Sanctuary",
    have: m => m.city.donations || 0, open: m => Boolean(m.city.envelopeB),
    todo: () => [`Donations have reached ${goldText(ENVELOPE_B_DONATIONS)}: Envelope B can be opened.`, "#overview"] },
  { id: "town-records", name: "Town Records Book", need: 0, what: "At the first retirement",
    have: m => m.retired, open: m => Boolean(m.city.townRecords),
    todo: () => ["A character has retired: open the Town Records Book, then set townRecords to true in campaign.json.", "#record"] },
  // Reputation, at its highest and lowest so far: once reached, it counts
  // even if reputation has since moved back (p. 49). Where that isn't where
  // it stands now, it says both.
  { id: "sun", name: `The ${classIconName("sun")} box`, need: 10,
    have: m => m.peak, open: m => m.unlocked.has("sun"), says: m => reputationSays(m, m.peak, 10),
    todo: m => [`Reputation has reached ${signed(m.peak)}: open the box with the ${classIconName("sun")} icon.`, "#record"] },
  { id: "eclipse", name: `The ${classIconName("eclipse")} box`, need: 10,
    have: m => -m.low, open: m => m.unlocked.has("eclipse"), says: m => reputationSays(m, m.low, -10),
    todo: m => [`Reputation has reached ${signed(m.low)}: open the box with the ${classIconName("eclipse")} icon.`, "#record"] },
  { id: "events-plus-20", name: "City 76, Road 67", need: 20, shown: m => m.peak >= 10,
    have: m => m.peak, open: m => m.inDecks("city", 76) && m.inDecks("road", 67), says: m => reputationSays(m, m.peak, 20),
    todo: () => ["Reputation has reached 20: add City 76 and Road 67 to the event decks.", "#events"] },
  { id: "events-minus-20", name: "City 77, Road 68", need: 20, shown: m => m.low <= -10,
    have: m => -m.low, open: m => m.inDecks("city", 77) && m.inDecks("road", 68), says: m => reputationSays(m, m.low, -20),
    todo: () => ["Reputation has reached −20: add City 77 and Road 68 to the event decks.", "#events"] },
  // Listed only once it's ready: its two achievements would spoil it.
  { id: "drake", name: "City 75, Road 66", need: 2, shown: m => m.drakes >= 2,
    have: m => m.drakes, open: m => m.cityHas.has("the-drake-aided"),
    todo: () => ["The Drake's Command and The Drake's Treasure: add City 75 and Road 66 to the event decks, and gain The Drake Aided.", "#record"] },
  { id: "envelope-x", name: "Envelope X", need: 0, what: "Sealed", have: () => 0, open: m => Boolean(m.city.envelopeX) },
];

// "+2 of +10 reputation", or, once reputation has moved back from its
// highest (lowest) so far, "0 of −10 reputation: the lowest so far, now +2".
function reputationSays(m, reached, goal) {
  const says = `${signed(reached)} of ${signed(goal)} reputation`;
  return reached === m.rep ? says : `${says}: the ${goal > 0 ? "highest" : "lowest"} so far, now ${signed(m.rep)}`;
}

// Each milestone as it stands: { ...the table's entry, have, open, ready, shown, says, todo }.
function milestoneStates(data) {
  const rep = data.party.reputation;
  const partyHas = new Set(data.party.achievements.map(a => a.id));
  const m = {
    city: data.city,
    rep,
    tech: achievementCounts(data).global.get("ancient-technology") || 0,
    retired: data.characters.filter(c => c.retired).length,
    peak: Math.max(rep, data.ledger?.reputation?.peak ?? rep),
    low: Math.min(rep, data.ledger?.reputation?.low ?? rep),
    unlocked: new Set(data.city.unlockedClasses.map(u => u.id)),
    cityHas: new Map(data.city.globalAchievements.map(a => [a.id, a.count || 1])),
    drakes: ["the-drakes-command", "the-drakes-treasure"].filter(id => partyHas.has(id)).length,
    inDecks: (deck, n) => Boolean(data.eventState?.decks?.[deck]?.has(n) || data.eventState?.removed?.[deck]?.has(n)),
  };
  return MILESTONES.map(x => {
    const have = x.have(m);
    const open = x.open(m);
    const ready = !open && (x.need ? have >= x.need : have > 0);
    return { ...x, have, open, ready, shown: x.shown ? x.shown(m) : true, says: x.says?.(m) || null, todo: ready && x.todo ? x.todo(m) : null };
  });
}

// --- The file: campaign.json ------------------------------------------------
// campaign.json keeps what happened, each thing once (schemaVersion 3):
// - sessions: every evening, and in it every scenario played: its number,
//   level and result, and what each character did there (results: the XP on
//   their dial, their coins, a battle goal made; who played, if not the
//   session's characters). What that gave them is worked out from the
//   play's level (playGain). A scenario is completed by its first success
//   that wasn't a casual replay, and the sessions, by date (undated ones
//   first, as the file lists them), are the order things happened in.
// - scenarios: what belongs to a scenario rather than to an evening: its
//   treasures and notes; how it was found, where the reference data can't
//   say (unlockedBy, unlockedVia); "blocked" set by hand.
// - characters: each sheet as its log began (start), and every change
//   since (log), dated. A change to XP, gold or checkmarks is a line of its
//   own saying what it was for: a scenario's reward, a treasure, an event, a
//   purchase or sale, a donation, an enhancement, advancing to the
//   prosperity level, retiring. Items gained and lost and perks taken are
//   an entry an evening. A sheet's XP, gold and checkmarks are its start,
//   its log, and what its scenarios gave: each counted once, in one place.
// - city: what's opened by hand (envelopes, the Town Records Book) and
//   anything the rules can't work out; donations made before the log
//   began, in start.
// Everything else is worked out. fromFile() turns the file into the shape
// the page works with (completed scenarios with their results, characters
// with their totals); toFile() turns that shape back into the file. An
// older file is moved over as it's read, every sheet's totals as they were,
// and written in the new layout next time: schemaVersion 1 kept totals and
// statuses; 2 kept each evening's change to a sheet as one sum, what the
// scenarios gave included, and a play's XP with its bonus.

const SCHEMA_VERSION = 3;
const SHEET_SUMS = ["xp", "gold", "checkmarks"];
const copyJson = value => JSON.parse(JSON.stringify(value));

// The sessions are in the order they happened, as the file lists them. A
// new one goes in by its date: after the last one dated on or before it (a
// forgotten evening recorded later still lands in its place); one without
// a date, at the end. Nothing reorders them after that, so the order never
// depends on how dates compare with no date.
function placeSession(sessions, session) {
  const later = session.date ? sessions.findIndex(s => s.date && s.date > session.date) : -1;
  if (later < 0) sessions.push(session); else sessions.splice(later, 0, session);
}

// The play that completed each scenario: its first success that wasn't a
// casual replay. number -> { session, play }.
function completions(sessions) {
  const done = new Map();
  for (const session of sessions) {
    for (const play of session.scenarios || []) {
      if (play.result === "success" && !play.casual && !done.has(play.number)) done.set(play.number, { session, play });
    }
  }
  return done;
}


// A character's sheet from its start and its log; what the scenarios gave
// is added by the caller (tookFromPlays). Donations and enhancements are
// counted from the log's lines for them. (A schemaVersion 2 log kept them
// as sums: read here, so it moves over.)
function sheetTotals(c) {
  const start = c.start || {};
  const t = Object.fromEntries(SHEET_SUMS.map(k => [k, start[k] || 0]));
  t.donated = start.donated || 0;
  t.enhanced = start.enhanced || 0;
  t.items = [...(start.items || [])];
  t.perks = [...(start.perks || [])];
  const drop = (list, x) => { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); };
  for (const e of c.log || []) {
    for (const k of SHEET_SUMS) t[k] += e[k] || 0;
    if (e.for === "donation") t.donated -= e.gold || 0;
    if (e.for === "enhancement") t.enhanced += 1;
    t.donated += e.donated || 0;
    t.enhanced += e.enhanced || 0;
    for (const x of e.lost || []) drop(t.items, x);
    t.items.push(...(e.gained || []));
    for (const x of e.perksDropped || []) drop(t.perks, x);
    t.perks.push(...(e.perks || []));
  }
  return t;
}

// A sheet with what the scenarios gave added, or taken off.
const withTook = (t, took, sign = 1) => took
  ? { ...t, ...Object.fromEntries(SHEET_SUMS.map(k => [k, (t[k] || 0) + sign * took[k]])) } : t;

// From one sheet to another, as a log entry: only what changed.
function sheetChange(before, after) {
  const minus = (a, b) => { const rest = [...b]; return a.filter(x => { const i = rest.indexOf(x); if (i < 0) return true; rest.splice(i, 1); return false; }); };
  const e = {};
  for (const k of SHEET_SUMS) if ((after[k] || 0) !== (before[k] || 0)) e[k] = (after[k] || 0) - (before[k] || 0);
  const gained = minus(after.items, before.items), lost = minus(before.items, after.items);
  const perks = minus(after.perks, before.perks), perksDropped = minus(before.perks, after.perks);
  if (gained.length) e.gained = gained;
  if (lost.length) e.lost = lost;
  if (perks.length) e.perks = perks;
  if (perksDropped.length) e.perksDropped = perksDropped;
  return e;
}

// The sheet as the page keeps it on a character.
function sheetOf(c) {
  const t = { xp: c.xp || 0, gold: c.gold || 0, checkmarks: c.checkmarks || 0, items: [...(c.items || [])], perks: [...(c.perks || [])] };
  if (c.donated) t.donated = c.donated;
  if (c.enhanced) t.enhanced = c.enhanced;
  return t;
}

// The file -> the shape the page works with.
function fromFile(json) {
  const version = json?.schemaVersion || 1;
  const out = version < 2 ? oldLayout(json) : copyJson(json);
  out.sessions ||= [];
  // schemaVersion 2 kept a play's XP with its bonus in it: what was on the dial.
  if (version === 2) for (const s of out.sessions) for (const p of s.scenarios || []) dialOnly(p);
  // Each completed scenario, in the order completed, with what it gave
  // (moved from its play, so nothing reads it twice); then the rest.
  const entries = new Map((out.scenarios || []).map(e => [e.number, e]));
  const done = [...completions(out.sessions)].map(([n, { session, play }]) => {
    const e = { ...(entries.get(n) || { number: n }), status: "completed", completed: session.date || null };
    entries.delete(n);
    if (play.results) { e.results = play.results; delete play.results; }
    if (play.players) { e.players = play.players; delete play.players; }
    return e;
  });
  // A completion written on the scenario with no session behind it still
  // counts (after those the sessions hold) while the question asks to move it.
  const rest = [...entries.values()];
  out.scenarios = [...done, ...rest.filter(e => e.status === "completed"),
    ...rest.filter(e => e.status !== "completed").map(e => ({ ...e, status: e.status === "blocked" ? "blocked" : "available" }))];
  // Each named, from the scenario data unless the file names it itself.
  for (const e of out.scenarios) e.name ||= scenarioRef?.scenarios?.[String(e.number)]?.name;
  for (const e of out.scenarios) if (!e.name) delete e.name;
  // Each sheet: its start, its log, and what its scenarios gave.
  const fromPlays = tookFromPlays(out);
  out.characters = (out.characters || []).map(c => {
    const took = fromPlays.get(c.name);
    // Totals with no start (written in by hand, or a schemaVersion 1 file):
    // they stand, so the start is what was had before the plays recorded.
    if (!c.start) c = { ...c, start: withTook(sheetOf(c), took, -1), log: c.log || [] };
    else if (version === 2) c = fromSums(c, took);
    const t = withTook(sheetTotals(c), took);
    const m = { ...c, xp: t.xp, gold: t.gold, checkmarks: t.checkmarks, items: t.items, perks: t.perks };
    if (t.donated) m.donated = t.donated;
    if (t.enhanced) m.enhanced = t.enhanced;
    return m;
  });
  out.city = { ...out.city, donations: (out.city?.start?.donations || 0) + out.characters.reduce((sum, c) => sum + (c.donated || 0), 0) };
  return out;
}

// The page's shape -> the file. A character's sheet that changed in a way
// its log and scenarios don't say gets an entry dated with the evening
// (when: the draft's date): items gained and lost, perks taken.
function toFile(m, when = m.updated || today()) {
  const fromPlays = tookFromPlays(m);
  const out = copyJson(m);
  out.schemaVersion = SCHEMA_VERSION;
  out.sessions ||= [];
  const completing = completions(out.sessions);
  const revealed = revealedByReference(scenarioRef, out.scenarios.filter(s => s.status === "completed").map(s => s.number));
  out.scenarios = (out.scenarios || []).map(s => {
    const e = { ...s };
    const play = completing.get(e.number)?.play;
    if (e.status === "completed" && play) {
      if (e.results?.length) play.results = e.results;
      if (e.players?.length) play.players = e.players;
      for (const k of ["status", "completed", "results", "players"]) delete e[k];
    }
    // A completion no session holds stays as it was, and is asked about.
    if (e.status === "available") delete e.status;
    if (e.name && e.name === scenarioRef?.scenarios?.[String(e.number)]?.name) delete e.name;
    if (e.unlockedBy != null && e.unlockedBy === revealed.get(e.number)) delete e.unlockedBy;
    // Nothing said is left out: an empty note, no treasures, no date.
    for (const k of ["notes", "completed", "unlockedBy"]) if (e[k] == null || e[k] === "") delete e[k];
    if (Array.isArray(e.treasures) && !e.treasures.length) delete e.treasures;
    return e;
  }).filter(e => Object.keys(e).length > 1 || (!completing.has(e.number) && !revealed.has(e.number)))
    .sort((a, b) => a.number - b.number);
  out.characters = (out.characters || []).map(c => {
    const after = sheetOf(c);
    const took = fromPlays.get(c.name);
    const start = c.start ? copyJson(c.start) : withTook(after, took, -1);
    const log = [...(c.log || [])];
    const change = sheetChange(withTook(sheetTotals({ start, log }), took), after);
    if (Object.keys(change).length) log.push({ date: when, ...change });
    const { name, class: cls, xp, gold, checkmarks, items, perks, donated, enhanced, start: _s, log: _l, ...rest } = c;
    return { name, class: cls, start, log, ...rest };
  });
  if (out.city) {
    const { donations, ...city } = out.city;
    out.city = city;
  }
  return out;
}

// A schemaVersion 2 play kept each character's XP with the bonus for its
// level in it, on a success: what was on the dial is that less the bonus.
function dialOnly(play) {
  if (play.level == null || play.result !== "success") return;
  const bonus = scenarioStats(play.level).xp;
  for (const r of play.results || []) {
    const dial = num(r.xp) - bonus;
    if (dial > 0) r.xp = dial; else delete r.xp;
  }
}

// A schemaVersion 2 sheet: each evening's change was one sum, what its
// scenarios gave included. Those sums go into the start (less what the
// scenarios gave, which the plays now say), so the totals stand; the log
// keeps its items and perks.
function fromSums(c, took) {
  const t = withTook(sheetTotals(c), took, -1);
  const start = { ...c.start, ...Object.fromEntries(SHEET_SUMS.map(k => [k, t[k]])) };
  for (const k of ["donated", "enhanced"]) if (t[k]) start[k] = t[k]; else delete start[k];
  const log = (c.log || []).map(e => Object.fromEntries(Object.entries(e).filter(([k]) => ![...SHEET_SUMS, "donated", "enhanced"].includes(k))))
    .filter(e => Object.keys(e).some(k => k !== "date"));
  return { ...c, start, log };
}

// A schemaVersion 1 file (totals on the sheets, statuses and results on
// the scenarios) laid out as the sessions keep it. Each completed scenario
// goes into the session it was played in: the one already listing it, else
// the one on its completion date, else the first undated one (made if
// there's none). The sheets keep their totals, for fromFile.
function oldLayout(json) {
  const m = copyJson(json);
  m.sessions ||= [];
  // The old file said what was completed, on the scenarios. A success in a
  // session that it didn't count (a replay not marked as one) stays not
  // counted: it's marked casual, as the form marks a replay.
  const counted = new Set((m.scenarios || []).filter(s => s.status === "completed").map(s => s.number));
  for (const session of m.sessions) {
    for (const play of session.scenarios || []) {
      if (play.result === "success" && !play.casual && !counted.has(play.number)) play.casual = true;
    }
  }
  for (const s of (m.scenarios || []).filter(s => s.status === "completed")) {
    if (completions(m.sessions).has(s.number)) continue;
    // The session on its completion date; failing that, one made for that
    // date, in its place among the others. Undated: the first undated one,
    // or one made before all others.
    let session = s.completed ? m.sessions.find(x => x.date === s.completed) : m.sessions.find(x => !x.date);
    if (!session) {
      session = { title: s.completed ? "" : "Before the session log", date: s.completed || null, scenarios: [], notes: "" };
      if (!session.title) delete session.title;
      if (s.completed) placeSession(m.sessions, session); else m.sessions.unshift(session);
    }
    (session.scenarios ||= []).push({ number: s.number, result: "success" });
  }
  const donated = (m.characters || []).reduce((sum, c) => sum + (c.donated || 0), 0);
  const before = (m.city?.donations || 0) - donated;
  if (m.city) {
    if (before > 0) m.city.start = { ...m.city.start, donations: before };
    delete m.city.donations;
  }
  return m;
}

// An older file in the current layout, as it would be written.
const migrate = json => toFile(fromFile(json), null);

// What's in the file that the page works out anyway, or that contradicts
// it: each said once, so the file stays one record. (toFile never writes
// these; a hand edit might.) Shown in the Campaign record and Before you play.
function fileQuestions(json) {
  if ((json?.schemaVersion || 1) < SCHEMA_VERSION) return [];
  const q = [];
  const completing = completions(json.sessions || []);
  const revealed = revealedByReference(scenarioRef, [...completing.keys()]);
  // History is the sessions' order: dates going backwards are a session in
  // the wrong place.
  let last = "";
  for (const s of json.sessions || []) {
    if (s.date && s.date < last) q.push(`The session of ${s.date} is listed after one of ${last}: the sessions' order is the order things happened, so move it to its place.`);
    if (s.date && s.date > last) last = s.date;
  }
  for (const s of json.scenarios || []) {
    const extra = ["completed", "results", "players"].filter(k => k in s);
    if (s.status && s.status !== "blocked") extra.unshift("status");
    if (extra.length) q.push(`#${s.number}'s ${extra.map(k => `"${k}"`).join(", ")} ${extra.length === 1 ? "is" : "are"} worked out from the sessions (a scenario is completed by its first success there). Move ${extra.length === 1 ? "it" : "them"} into the session that played it${completing.has(s.number) ? ", or remove " + (extra.length === 1 ? "it" : "them") : ""}.`);
    if (s.name && s.name === scenarioRef?.scenarios?.[String(s.number)]?.name) q.push(`#${s.number}'s "name" comes from the scenario data. Remove it from campaign.json.`);
    if (s.unlockedBy != null && s.unlockedBy === revealed.get(s.number)) q.push(`#${s.number}'s "unlockedBy" is worked out from #${s.unlockedBy}. Remove it from campaign.json.`);
  }
  // Totals beside a start: two records of one sheet. (Totals with no start
  // stand, and the start is worked out from them.)
  for (const c of (json.characters || []).filter(c => c.start)) {
    const totals = ["xp", "gold", "checkmarks", "items", "perks", "donated", "enhanced"].filter(k => k in c);
    if (totals.length) q.push(`${c.name}'s ${totals.map(k => `"${k}"`).join(", ")} ${totals.length === 1 ? "is" : "are"} worked out from "start", "log" and the sessions. Remove ${totals.length === 1 ? "it" : "them"}, and put any change in the log.`);
  }
  if (json.city && "donations" in json.city) q.push(`The city's "donations" are worked out from the characters' logs. Remove it, putting any made before the log in the city's "start".`);

  // Names are the reference data's, letter for letter.
  const classNames = Object.values(classRef?.classes || {});
  const itemNames = Object.values(itemsRef?.items || {}).map(i => i.name);
  const unknown = (what, name, names) => `${what} "${name}" isn't in the ${names === itemNames ? "item" : names === classNames ? "class" : "achievement"} list. ${spelledAs(name, names) || "Check the spelling against the card."}`;
  for (const c of json.characters || []) {
    if (classRef && !classNames.includes(c.class)) q.push(unknown(`${c.name}'s class`, c.class, classNames));
  }
  for (const n of (json.city?.unlockedClasses || []).map(x => typeof x === "string" ? x : x.name)) {
    if (classRef && !classNames.includes(n)) q.push(unknown("The unlocked class", n, classNames));
  }
  if (itemsRef) {
    const named = [...(json.city?.itemDesigns || []).map(x => typeof x === "string" ? x : x.name), ...(json.city?.returnedItems || []),
      ...(json.scenarios || []).flatMap(s => (s.treasures || []).map(t => typeof t === "object" && typeof t.drew === "string" ? t.drew : null)),
      ...(json.events || []).map(e => typeof e.drew === "string" ? e.drew : null),
      ...(json.characters || []).flatMap(c => [...(c.log || []).flatMap(e => [...(e.gained || []), ...(e.lost || [])])])].filter(Boolean);
    for (const n of new Set(named)) if (!itemNames.includes(n)) q.push(unknown("The item", n, itemNames));
  }
  for (const [kind, list] of [["party", json.party?.achievements], ["global", json.city?.globalAchievements]]) {
    const ids = Object.keys(scenarioRef?.achievements?.[kind] || {});
    const names = Object.values(scenarioRef?.achievements?.[kind] || {});
    for (const a of (list || []).map(x => typeof x === "string" ? { name: x } : x)) {
      if (!scenarioRef || (a.id ? ids.includes(a.id) : names.includes(a.name))) continue;
      q.push(`${kind === "party" ? "The party achievement" : "The global achievement"} "${a.id || a.name}" isn't in the scenario data, so no scenario or event counts it. ${spelledAs(a.name, names) || "Check it against the scenario book."}`);
    }
  }
  // One player, one spelling: their retirements are counted by it.
  const players = [...new Set((json.characters || []).map(c => String(c.player || "").trim()).filter(Boolean))];
  for (const p of players) {
    const other = players.find(x => x !== p && x.toLowerCase() === p.toLowerCase());
    if (other && p < other) q.push(`The player "${p}" is also written "${other}": write them one way, as their retired characters are counted by it.`);
  }
  // Treasure numbers as printed on the tile: digits only.
  for (const s of json.scenarios || []) {
    for (const t of s.treasures || []) {
      const n = typeof t === "object" ? t.number : t;
      if (!/^\d+$/.test(String(n))) q.push(`#${s.number}'s treasure "${n}" isn't a tile number: write it as printed on the tile, like "07".`);
    }
  }
  // Quest progress as counts, so it can be counted.
  for (const c of json.characters || []) {
    if (c.personalQuest && !questSteps(c.personalQuest)) {
      q.push(`${c.name}'s personal quest progress "${c.personalQuest}" can't be read: ${QUEST_HOW}.`);
    }
  }
  return q;
}

// A name written almost as one the reference data has (only capitals or
// spaces differ): how to write it, or "" if none is that close.
function spelledAs(name, names) {
  const flat = t => String(t).toLowerCase().replace(/\s+/g, " ").trim();
  const match = names.find(n => flat(n) === flat(name));
  return match ? `Write it "${match}".` : "";
}

// --- Building it all ------------------------------------------------------

// The reference data, once loaded (the page, or the tests).
function setReference({ scenarios = null, events = null, items = null, quests = null }) {
  scenarioRef = scenarios;
  classRef = events;
  itemsRef = items;
  questRef = quests;
}

// A campaign file and the reference data (set beforehand: scenarioRef,
// classRef, itemsRef, questRef) -> everything the page shows: what
// campaign.json says, and all that's worked out from it. shaped: the file
// already through fromFile(), if the caller has it (a copy is used).
function buildData(json, shaped = null) {
  const data = withDefaults(shaped ? copyJson(shaped) : fromFile(json));
  const derived = deriveCampaign(data, scenarioRef, classRef);
  // Anything the file keeps that's worked out anyway, or out of place.
  data.fileQuestions = fileQuestions(json);
  data.eventState = classRef ? derived : null;
  data.ledger = derived.totals;
  data.party.reputation = derived.totals.reputation.value;
  data.city.prosperityCheckmarks = derived.totals.prosperity.value;
  data.party.achievements = derived.record.party;
  data.city.globalAchievements = derived.record.global;
  data.city.itemDesigns = derived.record.designs;
  data.city.unlockedClasses = derived.record.classes;
  data.lostAchievements = derived.record.lost;
  data.draws = derived.record.draws;
  data.foundItems = derived.record.found;
  data.claims = derived.record.claims;
  data.treasureInfo = derived.record.treasures;
  data.scenarios = deriveScenarios(data, scenarioRef, derived.unlocks, classRef);
  data.shop = deriveShop(data, itemsRef, data.ledger);
  return data;
}
