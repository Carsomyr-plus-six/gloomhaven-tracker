// What the page works out from a campaign file and the reference data, as
// plain sorted JSON: the golden tests compare it with tests/golden/*.json.
// Anything that changes it (a rule, the reference data, the code, the file)
// shows up as a diff there.
function campaignSnapshot(data) {
  const byNumber = (a, b) => a - b;
  const byText = (a, b) => String(a).localeCompare(String(b), "en");
  const range = t => ({ value: t.value, lo: t.range.lo, hi: t.range.hi, ...(t.peak != null ? { peak: t.peak, low: t.low } : {}),
    entries: t.entries.map(e => `${e.label}: ${e.range.lo === e.range.hi ? e.range.lo : `${e.range.lo}..${e.range.hi}`}`) });
  const achievements = list => list.map(a => ({ id: a.id, name: a.name, count: a.count, where: a.where }))
    .sort((a, b) => byText(a.id, b.id));
  const ev = data.eventState;
  const who = completedBy(data);
  return {
    reputation: range(data.ledger.reputation),
    prosperity: { ...range(data.ledger.prosperity), level: stepFor(data.ledger.prosperity.value, CHECKMARKS_FOR_PROSPERITY) },
    donations: data.city.donations || 0,
    achievements: { party: achievements(data.achievements.party), global: achievements(data.achievements.global) },
    designs: data.itemDesigns.map(d => ({ name: d.name, where: d.where })).sort((a, b) => byText(a.name, b.name)),
    classes: data.classes.map(c => ({ id: c.id, where: c.where })).sort((a, b) => byText(a.id, b.id)),
    decks: ev ? {
      city: [...ev.decks.city].sort(byNumber), road: [...ev.decks.road].sort(byNumber),
      removed: { city: [...ev.removed.city.keys()].sort(byNumber), road: [...ev.removed.road.keys()].sort(byNumber) },
    } : null,
    events: ev ? ev.history.map(e => ({ label: e.label, option: e.option || null, fate: e.fate || null, outcome: e.outcome ?? null,
      effects: e.effects })) : null,
    questions: ev ? ev.questions : [],
    scenarios: data.scenarios.map(s => ({ number: s.number, status: s.status, unlockedBy: s.unlockedBy ?? null,
      ...(s.unlockedVia ? { unlockedVia: s.unlockedVia } : {}), reasons: s.reasons }))
      .sort((a, b) => a.number - b.number),
    completedBy: [...who].map(([n, names]) => ({ number: n, characters: names ? [...names].sort(byText) : null }))
      .sort((a, b) => a.number - b.number),
    characters: data.characters.map(c => ({
      name: c.name, class: c.class, xp: c.xp, gold: c.gold, checkmarks: c.checkmarks, level: characterStats(c).level,
      items: [...c.items].sort(byText), perks: [...c.perks].sort(byText),
      donated: c.donated || 0, enhanced: c.enhanced || 0, retired: Boolean(c.retired),
    })).sort((a, b) => byText(a.name, b.name)),
    shop: data.shop ? { level: data.shop.level, modifier: data.shop.modifier,
      stock: data.shop.stock.map(i => ({ name: i.name, price: i.price, left: i.left })) } : null,
    draws: data.draws.map(d => `${d.what} from ${d.from}`),
    claims: data.claims.map(c => `${c.item}: treasure ${c.treasure} in ${c.where}`),
    found: data.foundItems.map(f => `${f.item} from ${f.from}${f.character ? ` (${f.character})` : ""}`),
  };
}
