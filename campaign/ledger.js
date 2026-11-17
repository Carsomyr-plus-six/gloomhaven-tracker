// The ledger: events and what they did, reputation and prosperity,
// achievements, unlocks, the scenarios' state, classes, and the shop: all
// worked out from campaign.json and the reference data.

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

function className(id) { return classRef?.classes?.[id] || capitalize(id); }

function describeCondition(c) {
  if (!c || c.type === "otherwise") return "otherwise";
  if (c.type === "reputationGT") return `reputation above ${signed(c.values[0])}`;
  if (c.type === "reputationLT") return `reputation below ${signed(c.values[0])}`;
  if (c.type === "character") return `with a ${c.values.map(id => className(id)).join(" or ")}`;
  if (c.type === "payCollectiveGold" || c.type === "payGold") return `if you paid ${goldText(c.values[0])}`;
  if (c.type.startsWith("pay")) return "if you paid";
  return c.type;
}

// Who was at an event, as class ids. The event's own "characters" win; an
// event drawn before a scenario played in only one session takes that
// session's party. complete is false when someone's class isn't known.
function eventParty(data, e) {
  let names = e.characters;
  if (!names && e.scenario != null) {
    const sessions = data.sessions.filter(s => s.scenarios.some(sc => sc.number === e.scenario));
    if (sessions.length === 1) names = sessions[0].characters;
  }
  if (!names?.length) return { classes: null, complete: false };
  const ids = Object.entries(classRef?.classes || {});
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
function chosenOutcome(data, deck, number, option, names, paid) {
  const options = classRef?.events?.[deck]?.[String(number)];
  if (!options || !option) return null;
  const ctx = { ...eventParty(data, { characters: names }),
                reputation: data.ledger?.reputation?.range || exact(data.reputation || 0), paid };
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
  const could = condition ? couldPay(condition, characters, data.ledger?.reputation?.range || exact(data.reputation || 0)) : null;
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
function tally(effects, ctx) {
  const t = { reputation: exact(0), prosperity: exact(0), adds: [], mayAdd: [], unlocks: [], mayUnlock: [],
              gains: [], mayGain: [], text: [], effectDoubts: [] };
  const amount = e => ["reputation", "prosperity"].includes(e.type) ? { [e.type]: exact(e.amount) } : {};
  let more = false;
  for (const e of effects) {
    const met = e.condition ? testCondition(e.condition, ctx) : true;
    if (met === false) continue;
    const maybe = met === null;
    if (maybe) t.effectDoubts.push(e.condition);
    const say = text => t.text.push(maybe ? `${text} ${describeCondition(e.condition)}` : text);
    const add = (key, r) => { t[key] = plus(t[key], maybe ? either(exact(0), r) : r); };
    switch (e.type) {
      case "reputation":
      case "prosperity":
        add(e.type, exact(e.amount));
        say(`${signed(e.amount)} ${e.type}`);
        break;
      case "gold": say(`${goldChange(e.amount)} each`); break;
      case "collectiveGold": say(`${goldChange(e.amount)} to share`); break;
      case "experience": say(`${xpChange(e.amount)} each`); break;
      case "checkmarks": say(`${signed(e.amount)} battle goal ${Math.abs(e.amount) === 1 ? "checkmark" : "checkmarks"} each`); break;
      case "partyAchievement":
      case "globalAchievement": {
        const kind = e.type === "partyAchievement" ? "party" : "global";
        (maybe ? t.mayGain : t.gains).push({ kind, id: e.id });
        say(achievementName(kind, e.id));
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

function deriveCampaign(data) {
  const decks = {};
  const added = {};
  const removed = {};
  for (const deck of Object.keys(DECK_NAMES)) {
    decks[deck] = new Set(classRef?.startingDecks?.[deck] || []);
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
    const name = achievementName(kind, id);
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
  const classInfo = id => classRef?.classEvents?.[id];
  const classIdOf = name => Object.entries(classRef?.classes || {}).find(([, n]) => n === String(name))?.[0];
  const unlockClass = (id, where) => {
    if (record.classes.has(id)) return;
    record.classes.set(id, { id, name: className(id), count: 1, where: where ? [where] : [] });
    // A new class brings its city and road events.
    const n = classInfo(id)?.unlockEvent;
    if (n && !classInfo(id)?.starting) for (const deck of ["city", "road"]) {
      if (!removed[deck].has(n)) addCard(deck, n, `${className(id)} unlocked`);
    }
  };
  for (const [id, info] of Object.entries(classRef?.classEvents || {})) if (info.starting) unlockClass(id, "starting class");

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
    const options = classRef?.events?.[e.deck]?.[String(e.number)] || {};
    const party = eventParty(data, e);
    const ctx = { ...party, reputation: totals.reputation.range, paid: e.paid };
    const letters = e.option ? [e.option] : Object.keys(options);
    const found = letters.flatMap(l => possibleOutcomes(options, l, ctx, e.option ? e.outcome : null))
      .map(o => ({ ...o, ...tally(o.effects, ctx) }));

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
      questions.push(`${label}, option ${e.option}: ${askAbout(doubt, ctx)}`);
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
    const r = scenarioRef?.scenarios?.[String(s.number)]?.rewards || {};
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
  // Who looted it: the character whose log has its line, else as the
  // scenario's treasure names them (loot from before the logs, or a tile
  // that changed no sheet).
  const looters = treasureLooters(data.characters);
  const doTreasures = (s, where) => {
    // Treasures: "07", or { "number": "07", "character": "Craig", "drew": 52 }.
    const found = [];
    for (const t of s.treasures || []) {
      // "drawn": false says a random draw was never made, and won't be.
      const { number, character: named, drew, drawn: never } = typeof t === "object" ? { ...t, drawn: t.drawn === false } : { number: t };
      const character = looters.get(String(Number(number))) || named;
      const from = `treasure ${number}`;
      const parts = treasureParts(number);
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
        ? Object.entries(scenarioRef?.achievements?.[kind] || {}).find(([, n]) => n === item.name)?.[0] : null;
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
  for (const [key, stored, name] of [["reputation", data.party.reputation, "reputation"],
                                     ["prosperity", data.city.prosperityCheckmarks, "prosperity checkmarks"]]) {
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

function askAbout(c, ctx) {
  if (c?.type === "character") {
    return `who was there? It turns on having a ${c.values.map(id => className(id)).join(" or ")} in the party.`;
  }
  if (c?.type?.startsWith("pay")) return `did you pay${c.values?.length && typeof c.values[0] === "number" ? ` ${goldText(c.values[0])}` : ""}?`;
  if (c?.type === "reputationGT" || c?.type === "reputationLT") {
    return `it turns on ${describeCondition(c)}, and reputation then could have been ${rangeText(ctx.reputation)}. Which outcome was it?`;
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
function revealedByReference(completed) {
  const parent = new Map();
  if (scenarioRef) parent.set(1, null);
  for (const c of [...completed].sort((a, b) => a - b)) {
    for (const u of scenarioRef?.scenarios?.[String(c)]?.unlocks || []) if (!parent.has(Number(u))) parent.set(Number(u), c);
  }
  return parent;
}

function deriveScenarios(data, eventUnlocks = []) {
  const entries = new Map(data.scenarios.map(s => [s.number, s]));
  const refOf = n => scenarioRef?.scenarios?.[String(n)];
  const done = data.scenarios.filter(s => s.status === "completed").map(s => s.number).sort((a, b) => a - b);
  const completed = new Set(done);

  // Which scenario unlocked each one. An unlockedBy in campaign.json wins.
  const parent = revealedByReference(done);
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
      s.rewards = describeRewards(info.rewards);
      return s;
    }

    const blockers = done.filter(c => (refOf(c)?.blocks || []).includes(String(n)));
    if (blockers.length) s.reasons.push(`Blocked by ${blockers.map(c => `#${c} ${nameOf(c)}`).join(", ")}`);
    const unmet = info.requirements ? unmetRequirements(info.requirements, have) : null;
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

function deriveShop(data, ledger) {
  if (!itemsRef) return null;
  const level = stepFor(data.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const modifier = shopModifier(data.reputation);
  const all = Object.entries(itemsRef.items).map(([id, item]) => ({ id: Number(id), ...item }));
  const byName = new Map(all.map(item => [item.name, item]));
  const designs = new Set(data.itemDesigns.map(d => d.name));
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
      // An item found (treasure or reward), back in the supply, or bought
      // (from it) is carried legitimately.
      const found = (data.foundItems || []).some(f => sameItem(f.item, item.name))
                 || (data.city.returnedItems || []).some(n => sameItem(n, item.name))
                 || (c.log || []).some(e => e.for === "buy" && (e.gained || []).some(n => sameItem(n, item.name)));
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

  // Reputation that isn't settled may mean other prices.
  const range = ledger?.reputation?.range;
  const modifiers = range ? new Set([shopModifier(range.lo), shopModifier(range.hi), modifier]) : new Set([modifier]);
  const coming = all.filter(item => item.prosperity === level + 1).length;

  return { level, modifier, stock, questions, coming, pricesUnsure: modifiers.size > 1, range };
}

let scenarioRef = null;   // data/gloomhaven-scenarios.json
