// What the record says happened: each scenario played and what it gave,
// who played, level-ups, blessings waiting, treasure looters, and personal
// quest progress.

// Every play campaign.json records, in file order, with who played and
// what they got: its results and players, wherever fromFile keeps them (the
// win that completed a scenario gave them to the scenario); then each
// scenario marked completed with no session behind it. The one way to read
// a play's results: each says what the character took (playGain).
// The page's data doesn't change once built, so its plays are read once;
// fromFile and toFile read them afresh (readPlays), as what they're given
// may be a shape still being changed.
const playsCache = new WeakMap();
function plays(data) {
  if (!playsCache.has(data)) playsCache.set(data, readPlays(data));
  return playsCache.get(data);
}
function readPlays(data) {
  const done = completions(data.sessions);
  const entry = new Map(data.scenarios.map(s => [s.number, s]));
  const out = [];
  for (const session of data.sessions) {
    for (const [i, play] of (session.scenarios || []).entries()) {
      const from = done.get(play.number)?.play === play ? entry.get(play.number) || play : play;
      out.push({ number: play.number, level: play.level ?? null, result: play.result, casual: Boolean(play.casual), session, order: i + 1,
                 results: tookFrom(play, from.results), players: from.players || [] });
    }
  }
  for (const s of data.scenarios) {
    if (s.status === "completed" && !done.has(s.number)) {
      out.push({ number: s.number, level: null, result: "success", casual: false, session: null, results: tookFrom({}, s.results), players: s.players || [] });
    }
  }
  return out;
}
const tookFrom = (play, results) => (results || []).map(r => ({ ...r, ...playGain(play, r) }));

// Who was at a session, as its plays' results say: everyone they name, in
// order; null when a play has no results (lost, or none kept), as they
// can't say who else was there.
function partyOf(plays) {
  if (!plays.length || plays.some(p => !p.results?.length)) return null;
  const names = [];
  for (const p of plays) for (const r of p.results) if (!names.includes(r.character)) names.push(r.character);
  return names;
}

// Who passed a level at each session, from XP over time: a character
// joining above level 1 (an ability card for each level from 2), then
// anyone whose XP crossed a level there, by its plays and the log lines
// dated with it (lines dated between sessions count before the next). One
// retiring that evening gains none. An undated session counts its plays
// only. session -> [{ character, level }].
function levelUpsBy(m, plays) {
  const xp = new Map((m.characters || []).map(c => [c.name, c.start?.xp || 0]));
  const lines = (m.characters || []).flatMap(c => (c.log || []).filter(e => e.xp).map(e => ({ name: c.name, date: e.date || "", xp: e.xp })));
  const applied = new Set();
  const add = test => lines.forEach((l, i) => { if (!applied.has(i) && test(l)) { applied.add(i); xp.set(l.name, xp.get(l.name) + l.xp); } });
  const level = name => stepFor(xp.get(name), XP_FOR_LEVEL);
  const out = new Map();
  for (const s of m.sessions || []) {
    if (s.date) add(l => l.date < s.date);
    const was = new Map([...xp.keys()].map(name => [name, level(name)]));
    for (const p of plays.filter(p => p.session === s)) {
      for (const r of p.results) if (xp.has(r.character)) xp.set(r.character, xp.get(r.character) + r.xp);
    }
    if (s.date) add(l => l.date === s.date);
    // A play with no level was written in before plays kept one: its
    // rewards and events are in the start, not dated, so its evening's
    // levels can't be told (the XP still counts towards the next).
    if (plays.some(p => p.session === s && p.level == null)) { out.set(s, []); continue; }
    const ups = [];
    for (const c of m.characters || []) {
      if (s.date && c.joined === s.date) for (let l = 2; l <= stepFor(c.start?.xp || 0, XP_FOR_LEVEL); l++) ups.push({ character: c.name, level: l });
    }
    for (const c of m.characters || []) {
      if (s.date && retirementOf(c)?.date === s.date) continue;
      for (let l = was.get(c.name) + 1; l <= level(c.name); l++) ups.push({ character: c.name, level: l });
    }
    out.set(s, ups);
  }
  return out;
}
const sameUps = (a, b) => JSON.stringify((a || []).map(u => `${u.character}:${u.level}`).sort()) === JSON.stringify((b || []).map(u => `${u.character}:${u.level}`).sort());

// Two Bless cards waiting for a character's next scenario, from a donation
// (p. 45): their last donation line, with no scenario of theirs after it.
// One that evening counts, unless the donation was made back in town after
// it ("after": true after the last; a number, after that many of them). null when no donation line says (one before the logs began
// is written on the character as "blessNext").
function blessPending(c, plays) {
  const gift = [...(c.log || [])].reverse().find(e => e.for === "donation");
  if (!gift) return null;
  const later = p => p.session.date > gift.date
    || (p.session.date === gift.date && gift.after !== true && p.order > (Number(gift.after) || 0));
  return !plays.some(p => p.session?.date && later(p) && playedBy(p).includes(c.name));
}

// A character's retirement line, if their log has one.
const retirementOf = c => (c.log || []).find(e => e.for === "retirement") || null;

// Who looted each treasure tile, by the line for it in their log: tile -> name.
function treasureLooters(characters) {
  const by = new Map();
  for (const c of characters || []) {
    for (const e of c.log || []) if (e.for === "treasure" && e.treasure != null) by.set(String(Number(e.treasure)), c.name);
  }
  return by;
}

// What each character took from the play that completed scenario n.
const completionResults = (data, n) => plays(data).find(p => p.number === n && p.result === "success" && !p.casual)?.results || [];

// What each character took from every play: name -> { xp, gold, checkmarks }.
function tookFromPlays(data) {
  const sums = new Map();
  for (const p of readPlays(data)) {
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
