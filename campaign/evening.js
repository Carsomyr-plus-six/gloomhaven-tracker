// Writing an evening: a draft (the form's record of a session) applied to
// a copy of campaign.json, step by step (applyDraft, EVENING_STEPS).

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

// The level a recorded scenario was played at. An older draft's row has
// none: the fallback stands in, which the page gives as tonight's level.
function draftLevel(s, fallback = 0) {
  return Math.max(0, Math.min(7, filled(s.level) ? num(s.level) : num(fallback)));
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
const scenarioGain = (s, r, fallback = 0) => playGain({ level: draftLevel(s, fallback), result: s.result }, r);

// The draft applied to a copy of campaign.json: the steps below, in the
// order an evening happens and the rules want, each on the one context
// the evening shares (eveningContext). Returns the new file, a list of
// what changes, and anything that looks wrong. level: the scenario level
// for a recorded scenario that has none (an older draft), the page's
// tonight's level; 0 if not given.
function applyDraft(raw, d, data, { level = 0 } = {}) {
  const ctx = eveningContext(raw, d, data, level);
  for (const step of EVENING_STEPS) step(ctx);
  return { out: ctx.marked, log: ctx.log, warnings: ctx.warnings, evening: ctx.evening, party: ctx.party };
}

// What the evening's steps share: the file being written, the draft and
// the campaign as it stands, the log and warnings, and the ways a change
// goes onto a sheet.
function eveningContext(raw, d, data, fallbackLevel) {
  const out = JSON.parse(JSON.stringify(raw));
  out.scenarios ||= [];
  out.sessions ||= [];
  out.events ||= [];
  out.characters ||= [];
  const log = [];
  const warnings = notWholeNumbers(d);
  for (const c of out.characters) { c.items ||= []; c.perks ||= []; }
  const who = name => out.characters.find(c => c.name === name);
  // Handing someone an item (bought, looted or a reward): one of each item
  // per character. The caller writes it on the log line it belongs to;
  // false if there's no one to give it to.
  const giveItem = (name, item) => {
    const c = who(name);
    if (!c) return false;
    if (c.items.some(i => sameItem(i, item))) warnings.push(`${name} already has ${item}: a character can own only one of each item.`);
    c.items.push(item);
    return true;
  };
  // Every copy of an item already owned by someone still adventuring.
  const noCopyLeft = item => {
    const copies = Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, item))?.count;
    return Boolean(copies) && out.characters.filter(c => !c.retired && (c.items || []).some(i => sameItem(i, item))).length >= copies;
  };
  const gainFor = new Map();   // name -> { xp, gold, checkmarks }
  const gain = (name, key, amount) => {
    if (!amount) return;
    const g = gainFor.get(name) || { xp: 0, gold: 0, checkmarks: 0 };
    g[key] += amount;
    gainFor.set(name, g);
  };
  // Every change to a sheet other than what a scenario's results give
  // (those the play keeps) is written in the character's log, dated with
  // the evening: a line for each thing that happened, saying what it was
  // for, with all it changed. The one record of it. what: { xp, gold,
  // checkmarks, gained, lost, perks }; why: { for, ... }.
  // The evening's date, read once: the draft's, else today's.
  const when = d.date || today();
  const LISTS = ["gained", "lost", "perks"];
  // always: written even if it changed nothing, as the record of what
  // happened (retiring with no gold and no items).
  const line = (name, what, why, always = false) => {
    const c = who(name);
    const amounts = Object.fromEntries([...SHEET_SUMS.filter(k => what[k]).map(k => [k, what[k]]),
      ...LISTS.filter(k => what[k]?.length).map(k => [k, [...what[k]]])]);
    if (c && (always || Object.keys(amounts).length)) (c.log ||= []).push({ date: when, ...why, ...amounts });
  };
  // One thing that happened, in parts (an event's gold and checkmark, a
  // treasure's gold and item, a scenario's reward and reward item): each
  // part added as it's worked out, then written as one line a character.
  // gain(): a part that counts with the evening's gains (for levels reached
  // tonight); add(): one already on the sheet.
  const happening = why => {
    const parts = new Map();
    const add = (name, what) => {
      const p = parts.get(name) || {};
      for (const k of SHEET_SUMS) if (what[k]) p[k] = (p[k] || 0) + what[k];
      for (const k of LISTS) if (what[k]?.length) p[k] = [...(p[k] || []), ...what[k]];
      parts.set(name, p);
    };
    return {
      add,
      gain: (name, what) => { for (const k of SHEET_SUMS) gain(name, k, what[k] || 0); add(name, what); },
      write: () => { for (const [name, what] of parts) line(name, what, why); },
    };
  };
  // A gain that is a thing of its own (advancing to the prosperity level).
  const credit = (name, what, why) => { const one = happening(why); one.gain(name, what); one.write(); };
  // An event's gold or XP, as part of the event. A gain counts with the
  // evening's; a loss comes off at once, and can't take gold below 0 or XP
  // below the start of the character's level (rulebook p. 42).
  const eventGain = (ev, name, key, amount) => {
    if (amount >= 0) return ev.gain(name, { [key]: amount });
    const c = who(name);
    if (!c) return;
    const was = c[key] || 0;
    if (key === "gold") c.gold = Math.max(0, was + amount);
    else c.xp = Math.max(XP_FOR_LEVEL[stepFor(was, XP_FOR_LEVEL) - 1], was + amount);
    ev.add(name, { [key]: c[key] - was });
  };
  const retiring = new Set((d.retirements || []).map(x => x.character).filter(name => who(name) && !who(name).retired));
  const prosperityTonight = stepFor(data.prosperityCheckmarks + retiring.size, CHECKMARKS_FOR_PROSPERITY);
  const joinLog = [];   // what retirements do, said after the gains
  const joined = [];    // newcomers playing tonight
  return { out, d, data, raw, fallbackLevel, log, warnings, who, giveItem, noCopyLeft, gainFor, gain, when, line, happening, credit,
           eventGain, joinLog, retiring, prosperityTonight, joined };
}

// The party's name, if the form gives one.
function eveningName(ctx) {
  const { out, d, log } = ctx;
  if (String(d.partyName || "").trim()) {
    out.party ||= {};
    out.party.name = String(d.partyName).trim();
    log.push(`The party is named ${out.party.name}`);
  }
}

function eveningNewcomers(ctx) {
  const { out, d, log, warnings, who, when, retiring, prosperityTonight, joined } = ctx;
  // Newcomers before anything else: a newcomer can play tonight's scenarios
  // and go shopping. Retirements come after the scenarios (below). Each
  // retirement tonight is a prosperity checkmark (p. 48), which counts for a
  // newcomer's starting level and for advancing to the prosperity level.
  // How many characters a player has retired, tonight's retirements included
  // (with the player named on the retirement row, if not already known).
  const playerOf = c => String((d.retirements || []).find(x => x.character === c.name)?.player || c.player || "").trim();
  const retiredBy = player => {
    const name = String(player || "").trim();
    if (!name) return 0;
    return out.characters.filter(c => playerOf(c) === name && (c.retired || (d.retirements || []).some(x => x.character === c.name))).length;
  };
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
                          ...(String(x.player || "").trim() ? { player: String(x.player).trim() } : {}), joined: when, notes: "" });
    const perks = level - 1 + bonus;
    log.push(`${name} the ${x.class} joins at level ${level}, with ${xpText(XP_FOR_LEVEL[level - 1])} and ${goldText(startingGold(level))}${perks ? `, and ${plural(perks, "perk")} to choose` : ""}${level > 1 ? `; and ${plural(level - 1, "ability card")} to add, one for each level from 2 to ${level} (each of that level or lower)` : ""}`);
    if (x.playing !== false) joined.push(name);
  }
}

// Who played, which scenarios, and whether it was an evening of play.
function eveningWhoPlayed(ctx) {
  const { out, d, raw, log, warnings, who, when, joined } = ctx;
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
  out.updated = when;
  Object.assign(ctx, { party, played, firstScenario, lastCompleted, evening });
}

function eveningEvents(ctx) {
  const { out, d, data, log, warnings, who, happening, eventGain, party, played, firstScenario, lastCompleted } = ctx;
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
    const ev = happening({ for: "event", deck: e.deck, card: entry.number, option: e.option });
    const outcome = chosenOutcome(data, e.deck, entry.number, e.option, party, entry.paid);
    const pays = JSON.stringify(classRef.events[e.deck][String(entry.number)][e.option] || []).includes('"type":"pay');
    if (!outcome && pays && entry.paid === undefined) { warnings.push(`${label}: say on its row whether the party paid (Paid?).`); continue; }
    if (!outcome) { warnings.push(`${label}: which outcome applied can't be told from what's recorded, so add any gold or XP it gave by hand.`); continue; }
    if (outcome.unsure) warnings.push(`${label}: part of the outcome depends on something not recorded; check the card for gold or XP.`);
    for (const fx of outcome.effects) {
      if (fx.type === "gold" || fx.type === "experience") {
        for (const name of party) eventGain(ev, name, fx.type === "gold" ? "gold" : "xp", fx.amount);
        log.push(`${label}: ${fx.type === "gold" ? goldChange(fx.amount) : xpChange(fx.amount)} each, for ${party.join(", ")}`);
      } else if (fx.type === "collectiveGold") {
        const shares = e.shares || {};
        const total = party.reduce((sum, name) => sum + Math.max(0, num(shares[name])), 0);
        const want = Math.abs(fx.amount);
        if (total !== want) warnings.push(`${label}: ${goldText(want)} to ${fx.amount > 0 ? "share" : "pay"}, but the shares come to ${total}.`);
        for (const name of party) if (num(shares[name]) > 0) eventGain(ev, name, "gold", Math.sign(fx.amount) * num(shares[name]));
        if (total) log.push(`${label}: ${goldText(total)} ${fx.amount > 0 ? "shared" : "paid"} (${party.filter(n => num(shares[n]) > 0).map(n => `${n} ${goldText(num(shares[n]))}`).join(", ")})`);
      } else if (fx.type === "checkmarks") {
        for (const name of party) {
          const c = who(name);
          if (fx.amount > 0) ev.gain(name, { checkmarks: fx.amount });
          // A character can never lose a checkmark that would cost a perk (p. 42).
          else if (c) {
            const was = c.checkmarks || 0;
            c.checkmarks = Math.max(3 * Math.floor(was / 3), was + fx.amount);
            ev.add(name, { checkmarks: c.checkmarks - was });
          }
        }
        log.push(`${label}: ${signed(fx.amount)} battle goal ${Math.abs(fx.amount) === 1 ? "checkmark" : "checkmarks"} each, for ${party.join(", ")}${fx.amount < 0 ? " (never one that would cost a perk)" : ""}`);
      } else if (fx.type === "choose" && fx.of.some(x => x.type === "gold" || x.type === "experience")) {
        warnings.push(`${label}: a choice (${fx.of.map(x => x.amount != null ? (x.type === "experience" ? xpChange(x.amount) : `${signed(x.amount)} ${x.type}`) : x.type).join(" or ")}); add any gold or XP by hand.`);
      } else if (fx.type === "item") {
        warnings.push(`${label} gives ${itemName(fx.item)}: add it to one character's items.`);
      } else if (fx.type === "payItem") {
        warnings.push(`${label}: the party gave up ${itemName(fx.item)}: take it off the sheet of whoever had it.`);
      }
    }
    ev.write();
  }
}

function eveningScenarios(ctx) {
  const { out, d, data, raw, fallbackLevel, log, warnings, who, giveItem, noCopyLeft, gain, happening, party, played } = ctx;
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
    const level = draftLevel(s, fallbackLevel);
    const st = scenarioStats(level);
    const usual = recommendedLevel(party.map(name => stepFor(who(name).xp || 0, XP_FOR_LEVEL)));
    if (party.length && (level < Math.max(0, usual - 1) || level > Math.min(7, usual + 2))) {
      warnings.push(`${label} at level ${level}: for this party that's outside easy to very hard (${Math.max(0, usual - 1)} to ${Math.min(7, usual + 2)}).`);
    }
    const results = party.map(name => ({ character: name, ...scenarioGain(s, s.results[name] || {}, fallbackLevel) }));
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
        const tr = happening({ for: "treasure", treasure: t.number });
        for (const part of treasureParts(t.number)) {
          if (!t.character) { if (["gold", "experience", "item", "battleGoal"].includes(part.type)) warnings.push(`Treasure ${t.number}: who looted it?`); continue; }
          if (part.type === "gold") {
            tr.gain(t.character, { gold: num(part.value) });
            log.push(`${t.character} gains ${goldText(num(part.value))} from treasure ${t.number}`);
          }
          if (part.type === "experience") {
            tr.gain(t.character, { xp: num(part.value) });
            log.push(`${t.character} gains ${xpText(num(part.value))} from treasure ${t.number}`);
          }
          // A battle-goal checkmark, which counts towards a perk as any other.
          if (part.type === "battleGoal") {
            tr.gain(t.character, { checkmarks: num(part.value) });
            log.push(`${t.character} gains ${plural(num(part.value), "battle goal checkmark")} from treasure ${t.number}`);
          }
          if (part.type === "item") {
            const item = itemName(part.value);
            // An item the looter already owns is sold at once to the city's
            // supply (p. 27).
            if (who(t.character)?.items.some(i => sameItem(i, item))) {
              const value = Math.floor((Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, item))?.cost || 0) / 2);
              // Gained and sold at once: the copy goes back to the shop (returnedItems).
              tr.gain(t.character, { gold: value });
              tr.add(t.character, { gained: [item], lost: [item] });
              log.push(`${t.character} already has ${item}, so the one from treasure ${t.number} is sold at once for ${goldText(value)}`);
            } else if (noCopyLeft(item)) {
              // Every copy is someone's: the looter gains its sell value instead (FAQ).
              const value = Math.floor((Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, item))?.cost || 0) / 2);
              tr.gain(t.character, { gold: value });
              log.push(`No copy of ${item} is left, so ${t.character} gains its sell value from treasure ${t.number}: ${goldText(value)}`);
            } else {
              if (giveItem(t.character, item)) tr.add(t.character, { gained: [item] });
              log.push(`${t.character} takes ${item} from treasure ${t.number}`);
            }
          }
        }
        tr.write();
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
    const rw = happening({ for: "reward", scenario: n });
    for (const name of party) rw.gain(name, { gold: r.gold, xp: r.experience, checkmarks: r.battleGoals });
    if (r.battleGoals) log.push(`${label} reward: ${plural(r.battleGoals, "battle goal checkmark")} each`);
    if (r.gold || r.experience) log.push(`${label} reward: ${[r.gold ? goldText(r.gold) : null, r.experience ? xpText(r.experience) : null].filter(Boolean).join(" and ")} each`);
    if (r.collectiveGold) {
      // Shared as the party split it in the form.
      const shares = s.rewardShares || {};
      const total = party.reduce((sum, name) => sum + Math.max(0, num(shares[name])), 0);
      for (const name of party) if (num(shares[name]) > 0) rw.gain(name, { gold: num(shares[name]) });
      if (total !== r.collectiveGold) warnings.push(`${label} gives ${goldText(r.collectiveGold)} to share, but the shares come to ${total}.`);
      else log.push(`${label} reward: ${goldText(total)} shared (${party.filter(n => num(shares[n]) > 0).map(n => `${n} ${goldText(num(shares[n]))}`).join(", ")})`);
    }
    if (r.hints?.gold) warnings.push(`${label}: ${r.hints.gold.replace(/\.?$/, "")} (the scenario book).`);
    // Reward items: one copy each, to one of the characters there (p. 49).
    if (s.result === "success") rewardCopies(info).forEach((item, k) => {
      const taker = (s.rewardTakers || [])[k];
      if (!taker) { warnings.push(`${label} gives ${item}: who takes it?`); return; }
      if (giveItem(taker, item)) rw.add(taker, { gained: [item] });
      log.push(`${taker} takes ${item}, a reward of ${label}`);
    });
    rw.write();
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
  Object.assign(ctx, { apart });
}

function eveningSession(ctx) {
  const { out, d, fallbackLevel, party, played, evening, apart } = ctx;
  // The session itself, if there was one.
  const session = { date: d.date || null };
  if (d.title) session.title = d.title;
  session.scenarios = played.map(s => ({ number: num(s.number), level: draftLevel(s, fallbackLevel), result: s.result,
    ...(apart.get(s)?.casual ? { casual: true } : {}), ...(apart.get(s)?.results?.length ? { results: apart.get(s).results } : {}) }));
  session.characters = [...party];
  session.notes = d.notes || "";
  if (evening) placeSession(out.sessions, session);
}

function eveningOpened(ctx) {
  const { out, d, log, warnings } = ctx;
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
}

function eveningQuests(ctx) {
  const { d, log, warnings, who } = ctx;
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
}

function eveningClaims(ctx) {
  const { out, d, data, log, giveItem, line } = ctx;
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
    // Looted, and since sold (gained and lost: back to the shop), or kept.
    if (x.kept === false) line(x.character, { gained: [c.item], lost: [c.item] }, { for: "treasure", treasure: c.treasure });
    else if (giveItem(x.character, c.item)) line(x.character, { gained: [c.item] }, { for: "treasure", treasure: c.treasure });
    log.push(`Treasure ${c.treasure} in ${c.where}: ${x.character} looted ${c.item}${x.kept !== false ? "" : ", and has since sold it"}`);
  }
}

function eveningRetirements(ctx) {
  const { out, d, data, warnings, who, when, joinLog } = ctx;
  // Retirements, after the evening's scenarios: a character who played tonight
  // keeps tonight's loot until retiring, then it all goes back to the shop.
  for (const x of (d.retirements || []).filter(x => x.character)) {
    const c = who(x.character);
    if (!c || c.retired) { warnings.push(`${x.character} isn't an active character.`); continue; }
    c.retired = true;
    c.retiredOn = when;
    if (String(x.player || "").trim()) c.player = String(x.player).trim();
    // All money the character owned is gone (p. 48): below, with tonight's.
    delete c.inactive;
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
    if (data.classes.some(u => u.id === x.unlocks)
        || (out.city?.unlockedClasses || []).includes(className(x.unlocks))) {
      c.questDraws = { itemDesign: null, scenario: null };
      joinLog.push(`${c.name}'s personal quest opens the box with the ${classIconName(x.unlocks)} icon, which is already open: instead, draw a random item design and a random side scenario`);
      continue;
    }
    out.city ||= {};
    out.city.unlockedClasses = [...(out.city.unlockedClasses || []), className(x.unlocks)];
    joinLog.push(`${c.name}'s personal quest unlocks the class with the ${classIconName(x.unlocks)} icon, and its events go into the decks`);
  }
}

function eveningAdvances(ctx) {
  const { d, log, who, gainFor, credit, prosperityTonight } = ctx;
  // Advancing to the prosperity level: XP up to that level's start (p. 48).
  for (const name of d.advances || []) {
    const c = who(name);
    if (!c || c.retired) continue;
    const short = XP_FOR_LEVEL[prosperityTonight - 1] - (c.xp || 0) - (gainFor.get(name)?.xp || 0);
    if (short <= 0) continue;
    credit(name, { xp: short }, { for: "advance", level: prosperityTonight });
    log.push(`${name} advances to level ${prosperityTonight}, the prosperity level`);
  }
}

function eveningGains(ctx) {
  const { log, who, gainFor } = ctx;
  // XP, gold and checkmarks onto the character sheets. Passing a level means
  // a new ability card; the perk that comes with it the sheet counts.
  for (const [name, g] of gainFor) {
    const c = who(name);
    const was = stepFor(c.xp || 0, XP_FOR_LEVEL);
    c.xp = (c.xp || 0) + g.xp;
    c.gold = (c.gold || 0) + g.gold;
    c.checkmarks = (c.checkmarks || 0) + g.checkmarks;
    log.push(`${name}: ${[g.xp ? xpChange(g.xp) : null, g.gold ? goldChange(g.gold) : null,
                          g.checkmarks ? `${signed(g.checkmarks)} ${g.checkmarks === 1 ? "checkmark" : "checkmarks"}` : null].filter(Boolean).join(", ")}`);
    const now = c.retired ? was : stepFor(c.xp, XP_FOR_LEVEL);
    for (let level = was + 1; level <= now; level++) {
      log.push(`${name} reaches level ${level}: add an ability card of level ${level} or lower, and take a perk`);
    }
  }
}

// What the retirements do, said after the gains.
function eveningRetirementsSaid(ctx) {
  const { log, joinLog } = ctx;
  log.push(...joinLog);
}

function eveningShopping(ctx) {
  const { d, data, log, warnings, who, giveItem, line } = ctx;
  // Shopping and perks, after the scenarios.
  const priceOf = name => data.shop?.stock.find(i => sameItem(i.name, name))?.price;
  for (const b of d.buys.filter(b => b.character && b.item)) {
    const c = who(b.character);
    const price = priceOf(b.item) ?? 0;
    c.gold = (c.gold || 0) - price;
    if (giveItem(b.character, b.item)) line(b.character, { gold: -price, gained: [b.item] }, { for: "buy" });
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
    const [sold] = c.items.splice(i, 1);
    const item = Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, sale.item));
    const value = item ? Math.floor(item.cost / 2) : 0;
    c.gold = (c.gold || 0) + value;
    line(sale.character, { gold: value, lost: [sold] }, { for: "sell" });
    log.push(`${sale.character} sells ${sale.item} for ${goldText(value)}`);
  }
}

// The Sanctuary: donations, and Envelope B.
function eveningSanctuary(ctx) {
  const { out, d, log, warnings, who, line, retiring, party, played } = ctx;
  out.city ||= {};
  const before = out.city.donations || 0;
  const donors = (d.donations || []).filter(x => x.character);
  for (const x of donors) {
    const c = who(x.character);
    c.gold = (c.gold || 0) - DONATION;
    // After the evening's last scenario, "after: true"; between two, the
    // number of scenarios before it.
    const visit = donationVisit(x, played);
    line(x.character, { gold: -DONATION }, { for: "donation", ...(visit ? { after: visit === played.length || visit } : {}) });
    out.city.donations = (out.city.donations || 0) + DONATION;
    c.donated = (c.donated || 0) + DONATION;
    // Two Bless cards for their next scenario (p. 45): tonight's, if they
    // play one after this; otherwise their next (blessPending).
    log.push(`${x.character} donates ${goldText(DONATION)} to the Sanctuary: two Bless cards in their next scenario`);
  }
  // Once per visit (p. 45): a visit follows each scenario (p. 42), so one
  // before tonight's scenarios and one back in town after are two visits.
  for (const name of new Set(donors.map(x => x.character))) {
    const visits = donors.filter(x => x.character === name).map(x => donationVisit(x, played));
    if (new Set(visits).size < visits.length) warnings.push(`${name} donates twice in one visit to the city: it's once per visit.`);
    // Blessings are the donor's (errata): one who retires tonight with no
    // scenario of theirs after the donation never uses them.
    const used = party.includes(name) && visits.some(v => v < played.length);
    if (retiring.has(name) && !used) warnings.push(`${name} donates, then retires: the two Bless cards are theirs, so they go unused (they don't pass to a next character).`);
  }
  if (before < ENVELOPE_B_DONATIONS && (out.city.donations || 0) >= ENVELOPE_B_DONATIONS && !d.envelopeB) {
    log.push(`Donations reach ${goldText(out.city.donations)}: Envelope B can be opened`);
  }
  if (d.envelopeB && !out.city.envelopeB) {
    out.city.envelopeB = true;
    log.push("Envelope B opened");
  }
}

// Enhancements, from the calculator.
function eveningEnhancements(ctx) {
  const { d, log, who, line } = ctx;
  const enhancedClasses = new Set();
  for (const x of (d.enhancements || []).filter(x => x.character)) {
    const c = who(x.character);
    if (!c) continue;
    c.gold = (c.gold || 0) - num(x.cost);
    line(x.character, { gold: -num(x.cost) }, { for: "enhancement", what: x.what });
    c.enhanced = (c.enhanced || 0) + 1;
    enhancedClasses.add(c.class);
    log.push(`${x.character} enhances a card (${x.what}) for ${goldText(num(x.cost))}`);
  }
  Object.assign(ctx, { enhancedClasses });
}

// Perks taken.
function eveningPerks(ctx) {
  const { d, log, who, line } = ctx;
  for (const p of d.perks.filter(p => p.character && p.perk)) {
    who(p.character).perks.push(p.perk);
    line(p.character, { perks: [p.perk] }, { for: "perk" });
    log.push(`${p.character} takes "${p.perk}"`);
  }
}

function eveningRetiringLeaves(ctx) {
  const { who, line, retiring } = ctx;
  // Who retired tonight leaves with nothing: their gold is gone (p. 48),
  // and their items go back to the shop. After the town's business, which
  // they may do first: a donation, a sale, a purchase.
  for (const name of retiring) {
    const c = who(name);
    if (!c?.retired) continue;
    // The record of retiring: the page reads retired and retiredOn from it.
    line(name, { gold: -(c.gold || 0), lost: c.items }, { for: "retirement" }, true);
    c.gold = 0;
    c.items = [];
  }
}

// No one left with less than no gold.
function eveningGoldChecked(ctx) {
  const { out, warnings } = ctx;
  for (const c of out.characters) if (c.gold < 0) warnings.push(`${c.name} would have ${goldText(c.gold)}.`);
}

function eveningMarked(ctx) {
  const { out, d } = ctx;
  // The draft's id, just after "updated" (replacing an earlier one).
  const marked = {};
  for (const [k, v] of Object.entries(out)) {
    if (k === "lastDraft") continue;
    marked[k] = v;
    if (k === "updated") marked.lastDraft = d.id;
  }
  Object.assign(ctx, { marked });
}

function eveningEnhancementLimit(ctx) {
  const { out, warnings, enhancedClasses, marked } = ctx;
  // A class's deck can have no more enhanced cards than the prosperity level
  // (p. 46), and its stickers stay on through every character of the class.
  // The level is the city's after the evening (enhancing comes after the
  // scenarios and events, which can raise it), worked out as the page does.
  // The sheets count stickers, not cards (a card can carry several), so
  // past the limit it can only ask.
  if (enhancedClasses.size) {
    const prosperity = stepFor(deriveCampaign(withDefaults(copyJson(marked))).totals.prosperity.value, CHECKMARKS_FOR_PROSPERITY);
    for (const cls of enhancedClasses) {
      const stickers = out.characters.filter(c => c.class === cls).reduce((n, c) => n + (c.enhanced || 0), 0);
      if (stickers > prosperity) {
        warnings.push(`The ${cls} cards have ${plural(stickers, "enhancement")}: at prosperity ${prosperity}, no more than ${prosperity} of its cards can be enhanced. Check they're on that many cards or fewer.`);
      }
    }
  }
}

// The steps, in order: who's there, then what happened at the table, then
// what was done in town after, then the checks on the file it makes. The
// order is the rules': a newcomer can play tonight; the evening's gains go
// on before anyone advances or shops; a retiree's town business comes
// before retiring takes their gold and items (p. 48); the enhancement
// limit reads the city as the evening leaves it.
const EVENING_STEPS = [
  eveningName,              // the party's name, if given
  eveningNewcomers,         // new characters, before they play
  eveningWhoPlayed,         // the party, the scenarios played, an evening or not
  eveningEvents,            // road and city events, and what they gave
  eveningScenarios,         // each scenario: results, treasure, completion, rewards
  eveningSession,           // the session in the log
  eveningOpened,            // scenarios a personal quest opens
  eveningQuests,            // personal quest progress
  eveningClaims,            // past treasures settled
  eveningRetirements,       // who retires, and what their quest opens
  eveningAdvances,          // advancing to the prosperity level
  eveningGains,             // XP, gold and checkmarks onto the sheets
  eveningRetirementsSaid,   // what the retirements do, in the log
  eveningShopping,          // buying and selling
  eveningSanctuary,         // donations, and Envelope B
  eveningEnhancements,      // enhancements
  eveningPerks,             // perks taken
  eveningRetiringLeaves,    // a retiree's gold gone, items back to the shop
  eveningGoldChecked,       // no one below 0g
  eveningMarked,            // the draft's id on the file
  eveningEnhancementLimit,  // enhanced cards within the prosperity level
];
