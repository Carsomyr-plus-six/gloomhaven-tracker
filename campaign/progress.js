// What characters and the campaign work towards: perks and the attack
// modifier deck, item slots, and the milestones.

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
  { id: "sun", name: `The ${classIconName("sun")} box`, need: 10, what: "highest reputation",
    have: m => m.peak, open: m => m.unlocked.has("sun"), says: m => reputationSays(m, m.peak, 10),
    todo: m => [`Reputation has reached ${signed(m.peak)}: open the box with the ${classIconName("sun")} icon.`, "#record"] },
  { id: "eclipse", name: `The ${classIconName("eclipse")} box`, need: 10, what: "lowest reputation",
    have: m => -m.low, open: m => m.unlocked.has("eclipse"), says: m => reputationSays(m, m.low, -10),
    todo: m => [`Reputation has reached ${signed(m.low)}: open the box with the ${classIconName("eclipse")} icon.`, "#record"] },
  { id: "events-plus-20", name: "City 76, Road 67", need: 20, what: "highest reputation", shown: m => m.peak >= 10,
    have: m => m.peak, open: m => m.inDecks("city", 76) && m.inDecks("road", 67), says: m => reputationSays(m, m.peak, 20),
    todo: () => ["Reputation has reached 20: add City 76 and Road 67 to the event decks.", "#events"] },
  { id: "events-minus-20", name: "City 77, Road 68", need: 20, what: "lowest reputation", shown: m => m.low <= -10,
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
  const rep = data.reputation;
  const partyHas = new Set(data.achievements.party.map(a => a.id));
  const m = {
    city: data.city,
    rep,
    tech: achievementCounts(data).global.get("ancient-technology") || 0,
    retired: data.characters.filter(c => c.retired).length,
    peak: Math.max(rep, data.ledger?.reputation?.peak ?? rep),
    low: Math.min(rep, data.ledger?.reputation?.low ?? rep),
    unlocked: new Set(data.classes.map(u => u.id)),
    cityHas: new Map(data.achievements.global.map(a => [a.id, a.count || 1])),
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
