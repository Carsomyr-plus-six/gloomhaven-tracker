// The file: campaign.json read in (older layouts moved over) and written
// out, the questions a file raises, and building the page's data.

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
// scenarios gave included, and a play's XP with its bonus; 3 kept the
// shop's returned items as a list of their own.

const SCHEMA_VERSION = 4;
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
// counted from the log's lines for them.
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
    // Gained, then lost: a line can be both (looted, and sold at once).
    t.items.push(...(e.gained || []));
    for (const x of e.lost || []) drop(t.items, x);
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
  // Who was there, where a session doesn't say: everyone its plays'
  // results name, when every play has them.
  const byPlay = readPlays(out);
  for (const s of out.sessions) {
    if (s.characters) continue;
    const named = partyOf(byPlay.filter(p => p.session === s));
    if (named) s.characters = named;
  }
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
    // Retired, and when: by the retirement line in the log, or (retired
    // before the logs began) as written on the character.
    const retiring = retirementOf(c);
    if (retiring) Object.assign(m, { retired: true, retiredOn: retiring.date });
    // Two Bless cards pending, from their last donation line; with none (a
    // donation before the logs began) as written on the character.
    const bless = blessPending(c, byPlay);
    if (bless === true) m.blessNext = true;
    if (bless === false) delete m.blessNext;
    if (t.donated) m.donated = t.donated;
    if (t.enhanced) m.enhanced = t.enhanced;
    return m;
  });
  out.city = { ...out.city, donations: (out.city?.start?.donations || 0) + out.characters.reduce((sum, c) => sum + (c.donated || 0), 0) };
  // Who passed a level at each session, worked out from XP over time. A
  // list in the file stands where the record can't say (an older file's
  // evening sums went into the start), and is asked about if it differs.
  const ups = levelUpsBy(out, byPlay);
  for (const s of out.sessions) if (!s.levelUps && ups.get(s).length) s.levelUps = ups.get(s);
  // An older file kept the shop's returned items as a list (by hand, or
  // the form wrote it): what the logs don't account for was returned before
  // they began, and joins the city's start. (In a current file such a list
  // is worked out, and fileQuestions asks about it.)
  if (version < 4 && out.city.returnedItems) {
    const before = [...(out.city.start?.returnedItems || []), ...minusItems(out.city.returnedItems, logReturns(out))];
    out.city.start = { ...out.city.start, returnedItems: before };
    if (!before.length) delete out.city.start.returnedItems;
    if (!Object.keys(out.city.start).length) delete out.city.start;
  }
  out.city.returnedItems = [...(out.city.start?.returnedItems || []), ...logReturns(out)];
  return out;
}

// Copies the logs put back in the shop's supply, less those bought back:
// every item lost on a line saying what it was for (sold, looted and sold
// at once, retired with) goes back (rulebook p. 43); a correction by hand,
// with no "for", isn't a hand-off. The shop counts only those it doesn't
// otherwise sell. With the city's start, the supply.
function logReturns(m) {
  const lines = (m.characters || []).flatMap(c => c.log || []).filter(e => e.for);
  return minusItems(lines.flatMap(e => e.lost || []), lines.filter(e => e.for === "buy").flatMap(e => e.gained || []));
}
// A list of item names less another, copy for copy.
function minusItems(list, less) {
  const rest = [...list];
  for (const name of less) {
    const i = rest.findIndex(n => sameItem(n, name));
    if (i >= 0) rest.splice(i, 1);
  }
  return rest;
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
  const revealed = revealedByReference(out.scenarios.filter(s => s.status === "completed").map(s => s.number));
  const looters = treasureLooters(out.characters);
  out.scenarios = (out.scenarios || []).map(s => {
    const e = { ...s };
    // Who looted a treasure, where their log already says so, is left to the log.
    if (Array.isArray(e.treasures)) e.treasures = e.treasures.map(t => {
      if (typeof t !== "object" || !t.character || looters.get(String(Number(t.number))) !== t.character) return t;
      const { character, ...rest } = t;
      return Object.keys(rest).length === 1 ? rest.number : rest;
    });
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
  // Who passed a level, as the record says it, is left to it.
  const ups = levelUpsBy(m, readPlays(m));
  m.sessions.forEach((s, i) => { if (out.sessions[i]?.levelUps && sameUps(out.sessions[i].levelUps, ups.get(s))) delete out.sessions[i].levelUps; });
  // Who was at a session, as its results already say, is left to them.
  for (const s of out.sessions) {
    const named = partyOf(s.scenarios || []);
    if (named && JSON.stringify(named) === JSON.stringify(s.characters)) delete s.characters;
  }
  out.characters = (out.characters || []).map(c => {
    const after = sheetOf(c);
    const took = fromPlays.get(c.name);
    const start = c.start ? copyJson(c.start) : withTook(after, took, -1);
    const log = [...(c.log || [])];
    const change = sheetChange(withTook(sheetTotals({ start, log }), took), after);
    if (Object.keys(change).length) log.push({ date: when, ...change });
    const { name, class: cls, xp, gold, checkmarks, items, perks, donated, enhanced, start: _s, log: _l, ...rest } = c;
    // A pending Bless, where a donation line says it, is left to the log.
    if (blessPending({ log }, []) !== null) delete rest.blessNext;
    // Retired, and when, as the retirement line says: left to the log.
    const retiring = retirementOf({ log });
    if (retiring && rest.retired === true) delete rest.retired;
    if (retiring && rest.retiredOn === retiring.date) delete rest.retiredOn;
    return { name, class: cls, start, log, ...rest };
  });
  if (out.city) {
    const { donations, returnedItems, ...city } = out.city;
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
  // Its donations and enhancements were sums too.
  for (const k of ["donated", "enhanced"]) {
    const n = (c.start?.[k] || 0) + (c.log || []).reduce((sum, e) => sum + (e[k] || 0), 0);
    if (n) start[k] = n; else delete start[k];
  }
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
  if ((json?.schemaVersion || 1) < 2) return [];
  const q = [];
  const completing = completions(json.sessions || []);
  const revealed = revealedByReference([...completing.keys()]);
  // A pending Bless is worked out from the last donation line; a flag it contradicts is asked about.
  if (json.characters?.some(c => "blessNext" in c && c.log?.some(e => e.for === "donation"))) {
    const plays = readPlays(fromFile(json));
    for (const c of json.characters) {
      const pending = "blessNext" in c ? blessPending(c, plays) : null;
      if (pending !== null && pending !== Boolean(c.blessNext)) q.push(`${c.name}'s "blessNext" says ${c.blessNext ? "a Bless is waiting" : "none is"}, but their last donation and the scenarios since say ${pending ? "one is" : "it's been used"}. Remove "blessNext" to go by the log.`);
    }
  }
  // Who passed a level is worked out; a list the record contradicts is asked about.
  if (json.sessions?.some(s => s.levelUps)) {
    const model = fromFile(json);
    const ups = levelUpsBy(model, readPlays(model));
    for (const s of model.sessions) {
      const said = (json.sessions || []).find(x => x.date === s.date && x.title === s.title)?.levelUps;
      if (said && ups.get(s).length && !sameUps(said, ups.get(s))) q.push(`The session of ${s.date || s.title || "no date"} lists who passed a level, but its XP says otherwise (${ups.get(s).map(u => `${u.character} ${u.level}`).join(", ")}). Remove its "levelUps" to go by the XP.`);
    }
  }
  // Who was at a session is said once: by its results, or in "characters"
  // where they can't say. Both, naming different people, is asked about.
  for (const s of json.sessions || []) {
    const named = partyOf(s.scenarios || []);
    if (!named || !s.characters) continue;
    const odd = [...named.filter(n => !s.characters.includes(n)), ...s.characters.filter(n => !named.includes(n))];
    if (odd.length) q.push(`The session of ${s.date || s.title || "no date"} lists who was there, but its results name others (${odd.join(", ")} differ). Correct whichever is wrong, or remove its "characters" to go by the results.`);
  }
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
  if (json.city && "returnedItems" in json.city && (json.schemaVersion || 1) >= 4) q.push(`The city's "returnedItems" are worked out from the characters' logs (what was sold or retired with, less what was bought back). Remove it, putting any returned before the logs began in the city's "start".`);
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
    const named = [...(json.city?.itemDesigns || []).map(x => typeof x === "string" ? x : x.name), ...(json.city?.returnedItems || []), ...(json.city?.start?.returnedItems || []),
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
  // Retiring is said once: by the retirement line, or on the character if
  // they retired before the logs began.
  for (const c of json.characters || []) {
    const retiring = retirementOf(c);
    if (!retiring) continue;
    if (c.retired === false) q.push(`${c.name} has a retirement line in their log (${retiring.date}) but says "retired": false. Correct whichever is wrong.`);
    if (c.retiredOn && c.retiredOn !== retiring.date) q.push(`${c.name} says they retired on ${c.retiredOn}, but their retirement line is dated ${retiring.date}. Correct whichever is wrong.`);
  }
  // Treasure numbers as printed on the tile: digits only. Who looted one is
  // said once: by the log's line for it, or on the scenario if it has none.
  const looters = treasureLooters(json.characters);
  for (const s of json.scenarios || []) {
    for (const t of s.treasures || []) {
      const n = typeof t === "object" ? t.number : t;
      if (!/^\d+$/.test(String(n))) q.push(`#${s.number}'s treasure "${n}" isn't a tile number: write it as printed on the tile, like "07".`);
      const logged = looters.get(String(Number(n)));
      if (typeof t === "object" && t.character && logged && logged !== t.character) {
        q.push(`#${s.number}'s treasure ${n} says ${t.character} looted it, but the line for it is in ${logged}'s log. Correct whichever is wrong.`);
      }
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
  const party = { name: "", location: "", achievements: [], notes: "", ...raw.party };
  const city = { donations: 0, globalAchievements: [], unlockedClasses: [], itemDesigns: [], returnedItems: [], ...raw.city };
  return {
    ...raw,
    party,
    city,
    adjustments: raw.adjustments || [],
    scenarios: raw.scenarios || [],
    characters: (raw.characters || []).map(c => ({ xp: 0, gold: 0, checkmarks: 0, perks: [], items: [], ...c })),
    sessions: (raw.sessions || []).map(s => ({ scenarios: [], ...s })),
    events: raw.events || [],
    eventDecks: { added: [], removed: [], ...raw.eventDecks },
  };
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
  const derived = deriveCampaign(data);
  // Anything the file keeps that's worked out anyway, or out of place.
  data.fileQuestions = fileQuestions(json);
  data.eventState = classRef ? derived : null;
  data.ledger = derived.totals;
  // What's worked out goes under names of its own: data.party and data.city
  // stay as the file has them (the lists it keeps by hand), so a field means
  // one thing wherever it's read. Reputation and prosperity an older file
  // kept by hand are compared with the sums above (the ledger's questions)
  // and then dropped, so no one reads a stale number for the live one.
  delete data.party.reputation;
  delete data.city.prosperityCheckmarks;
  data.reputation = derived.totals.reputation.value;
  data.prosperityCheckmarks = derived.totals.prosperity.value;
  data.achievements = { party: derived.record.party, global: derived.record.global };
  data.itemDesigns = derived.record.designs;
  data.classes = derived.record.classes;
  data.lostAchievements = derived.record.lost;
  data.draws = derived.record.draws;
  data.foundItems = derived.record.found;
  data.claims = derived.record.claims;
  data.treasureInfo = derived.record.treasures;
  // The one key replaced: the file's scenario entries become every scenario
  // found, each with its status and why (the file's fields kept on its own).
  data.scenarios = deriveScenarios(data, derived.unlocks);
  data.shop = deriveShop(data, data.ledger);
  return data;
}
