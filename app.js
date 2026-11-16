// Gloomhaven campaign tracker: reads campaign.json and shows it, and builds
// an updated campaign.json from a session recorded on the page.

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
    [e.key === "hex" ? `One more hex: 200 gold over the ${hexes} it has` : e.group === "+1 to a number" ? `${e.label} +1` : e.label, base],
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

// --- Building the page ----------------------------------------------------

// Make an element. Text children become text nodes, so campaign notes can
// never inject HTML into the page.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

function signed(n) { return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0"; }

function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

function capitalize(text) { return text ? text[0].toUpperCase() + text.slice(1) : text; }

function formatDate(iso, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, options);
}

// Icons are drawn from these fixed shapes only; nothing from campaign.json
// ever reaches innerHTML.
const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  check: '<path d="M5 12.500l4.500 4.500L19 7"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.600 2.200c-.700.400-1.100 1-1.100 1.800"/><path d="M12 17h.010"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.400-5.700"/><path d="M4 4v4h4"/>',
  eye: '<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z"/><circle cx="12" cy="12" r="2.800"/>',
};

function svg(viewBox, inner, attrs = {}) {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", viewBox);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.innerHTML = inner;
  return el;
}

// With a label the icon is announced; without one it is decoration.
function icon(name, label) {
  return svg("0 0 24 24", ICONS[name],
    label ? { class: "icon", role: "img", "aria-label": label } : { class: "icon", "aria-hidden": "true" });
}

// A single-colour game icon from icons/ (Creator Pack, CC BY-NC-SA 4.0),
// filled with the colour of the text around it. With a label it is
// announced; without one it is decoration.
function gameIcon(name, label) {
  return h("span", { class: "gicon", style: `--icon: url("icons/${name}.svg")`,
    ...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" }) });
}

// A hex tile holding a scenario number or a level. kind: "" (solid brass),
// "completed", "blocked", "level" or "quiet".
function hex(text, kind = "") {
  // The comma keeps a button's name from running "5Ruinous Crypt".
  return h("span", { class: `hex ${kind}`.trim() }, h("span", {}, text), h("span", { class: "sr-only" }, ", "));
}

function meter(fraction, close) {
  const span = h("span");
  span.style.width = `${Math.round(fraction * 100)}%`;
  return h("div", { class: `meter${close ? " close" : ""}`, role: "presentation" }, span);
}

function notes(text, extra = "") { return text ? h("p", { class: `notes ${extra}`.trim() }, text) : null; }

function empty(message) { return h("div", { class: "empty" }, message); }

function sectionHead(title, aside) {
  return h("div", { class: "section-head" }, h("h2", {}, title), aside ? h("span", { class: "aside" }, aside) : null);
}

// Something the party should look at: a perk to choose, a question to answer.
function nudge(iconName, title, body, extra = "") {
  return h("div", { class: `nudge ${extra}`.trim() }, icon(iconName),
    body ? h("div", {}, h("strong", {}, title), body) : h("span", {}, title));
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

// A mention of a scenario that opens it under Scenarios, as the Ready
// to play cards do.
function scenarioLink(data, number, text = scenarioLabel(data, number)) {
  return h("a", { class: "scenario-link", href: "#scenarios", onclick: () => openScenario(data, number) }, text);
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

// Inactive characters (sitting out for now) stay out of sight until asked
// for: "+ 1 inactive" shows them everywhere at once, "Hide inactive" puts
// them away again. Anyone already picked for something (tonight, the form,
// the shop, the sheet open on a phone) shows regardless.
let showInactive = false;
const hiddenAway = (c, picked = false) => c.inactive && !c.retired && !showInactive && !picked;
function inactiveToggle(data, count, key) {
  if (!count && !showInactive) return null;
  return h("button", { type: "button", class: "chip quiet-chip inactive-toggle", "data-key": key, "aria-expanded": String(showInactive),
      onclick: () => { showInactive = !showInactive; render(data); } },
    showInactive ? "Hide inactive" : `+ ${count} inactive`);
}

// --- Overview ---------------------------------------------------------------

// The next reputation at which the shop gets cheaper, or null at the best price.
function nextShopStep(reputation) {
  const now = shopModifier(reputation);
  for (let r = reputation + 1; r <= 20; r++) {
    if (shopModifier(r) < now) return { at: r, modifier: shopModifier(r) };
  }
  return null;
}

function priceText(modifier) {
  return modifier === 0 ? "normal prices" : `${signed(modifier)} gold per item`;
}

// Where a total comes from, and how sure it is.
function ledgerFoot(t, unit) {
  if (!t?.entries.length) return null;
  return h("details", { class: "ledger" },
    // The track draws what it could be; the fold says how many are open.
    h("summary", {}, isExact(t.range) ? `From ${plural(t.entries.length, "source")}`
      : `Could be ${rangeText(t.range)} · ${[t.unsure.length ? `${t.unsure.length} to answer` : null,
                                              t.unknown?.length ? `${t.unknown.length} not known` : null].filter(Boolean).join(", ")}`),
    h("ul", {}, t.entries.map(e => h("li", {},
      h("span", {}, e.label, isExact(e.range) ? null
        : h("span", { class: "open-tag" }, t.unsure.some(u => e.label.startsWith(u)) ? "to answer" : "not known")),
      h("span", { class: "num" }, `${rangeText(e.range)}${unit}`)))));
}

// A value on a track cut into stretches, each with its own effect:
// reputation's shop prices, prosperity's levels. Today's stretch is lit (and
// any passed, more quietly), the next one edged, a brass hexagon stands on
// the value, a brass rule spans what it could be while that's unsettled, and
// the next step is labelled in brass under where it starts. Positions are
// percentages along the track.
function stepTrack({ zones, at, maybe, step, ends, said }) {
  const place = (el, from, to) => { el.style.left = `${from}%`; el.style.width = `${to - from}%`; return el; };
  const marker = svg("0 0 20 22", '<path d="M10 1.5l8 4.6v9.8l-8 4.6-8-4.6V6.1z"/>', { class: "marker", "aria-hidden": "true" });
  marker.style.left = `${at}%`;
  // The end label on the step's side gives way to it, and right by an end
  // the step lines up with that end instead, so it stays on even a narrow
  // phone tile.
  const low = step && step.at < 50;
  const near = step && (step.at <= 33 || step.at >= 65);
  const atEnd = step && (step.at <= 15 || step.at >= 82);
  const label = step ? h("span", { class: `step${atEnd ? (low ? " start" : " end") : ""}` }, step.text) : null;
  if (label && !atEnd) label.style.left = `${step.at}%`;
  return h("div", { role: "img", "aria-label": said },
    h("div", { class: "track" },
      maybe ? place(h("b", { class: "maybe" }), maybe[0], maybe[1]) : null,
      zones.map(z => {
        const el = place(h("i", { class: z.cls || null }), z.from, z.to);
        el.style.width = `calc(${el.style.width} - var(--gap))`;
        return el;
      }),
      marker),
    h("div", { class: "track-scale", "aria-hidden": "true" },
      near && low ? null : h("span", {}, ends[0]),
      label,
      near && !low ? null : h("span", { class: "end" }, ends[1])));
}

// Reputation's stretches share a shop price (the price changes every 4
// points past ±3), drawn to scale.
function reputationTile(party, ledger) {
  const rep = party.reputation;
  const modifier = shopModifier(rep);
  const next = nextShopStep(rep);
  // 41 places, −20 to +20: a value sits in the middle of its place, and a
  // stretch runs from its first place's left edge to its last's right edge.
  const clamp = r => Math.max(-20, Math.min(20, r));
  const edge = r => (r + 20) / 41 * 100;
  const zones = [];
  for (let r = -20; r <= 20; r++) {
    const last = zones.at(-1);
    if (last && shopModifier(r) === last.modifier) last.to = r;
    else zones.push({ from: r, to: r, modifier: shopModifier(r) });
  }
  const range = ledger?.reputation?.range;
  return h("div", { class: "card tile rep-tile", "data-tab": "campaign" },
    h("div", { class: "tile-top" }, h("h2", { class: "label" }, "Reputation"), h("span", { class: "figure" }, signed(rep))),
    stepTrack({
      zones: zones.map(z => ({ from: edge(z.from), to: edge(z.to + 1),
                               cls: z.modifier === modifier ? "now" : next?.at === z.from ? "next" : null })),
      at: (edge(rep) + edge(rep + 1)) / 2,
      maybe: range && !isExact(range) ? [edge(clamp(range.lo)), edge(clamp(range.hi) + 1)] : null,
      step: next ? { at: edge(next.at), text: next.modifier === 0 ? "Normal" : `${signed(next.modifier)} gold` } : null,
      ends: ["−20", "+20"],
      said: `Reputation ${signed(rep)}${range && !isExact(range) ? `, could be ${rangeText(range)}` : ""}: shop ${modifier === 0 ? "prices normal" : priceText(modifier)}${next ? `, ${priceText(next.modifier)} from ${signed(next.at)}` : ""}.`,
    }),
    h("div", { class: "tile-foot" },
      h("strong", {}, modifier === 0 ? "Prices normal" : `Prices ${signed(modifier)} gold`)),
    ledgerFoot(ledger?.reputation, ""));
}

// Donations to the Sanctuary, a step for each 10 gold, up to the 100 that
// open Envelope B.
function sanctuaryMeter(city) {
  const steps = ENVELOPE_B_DONATIONS / DONATION;
  const given = Math.min(steps, Math.floor(city.donations / DONATION));
  const ready = !city.envelopeB && city.donations >= ENVELOPE_B_DONATIONS;
  return h("div", { class: "sanctuary", role: "img",
      "aria-label": `${city.donations} gold donated to the Sanctuary. ${city.envelopeB ? "Envelope B is open." : ready ? "Envelope B can be opened." : `${ENVELOPE_B_DONATIONS - city.donations} more opens Envelope B.`}` },
    h("div", { class: "sanctuary-head", "aria-hidden": "true" },
      h("span", {}, "Sanctuary"), h("span", { class: ready ? "ready" : null }, city.envelopeB ? "Envelope B open" : "Envelope B")),
    h("div", { class: "pips", "aria-hidden": "true" }, Array.from({ length: steps }, (_, i) => h("i", { class: i < given ? "on" : null }))));
}

// Prosperity's stretches are its levels, each the same width: drawn to
// scale, level 1's 4 checkmarks would be a sliver beside level 8's 14. The
// hexagon moves through the current level as its checkmarks are ticked.
function prosperityTile(city, ledger) {
  const marks = city.prosperityCheckmarks;
  const level = stepFor(marks, CHECKMARKS_FOR_PROSPERITY);
  const toNext = progressFor(marks, CHECKMARKS_FOR_PROSPERITY);
  const from = CHECKMARKS_FOR_PROSPERITY[level - 1];
  const levels = CHECKMARKS_FOR_PROSPERITY.length - 1;   // stretches: levels 1 to 8, then 9 at the end
  const pos = m => {
    const l = stepFor(m, CHECKMARKS_FOR_PROSPERITY);
    if (l > levels) return 100;
    const [lo, hi] = [CHECKMARKS_FOR_PROSPERITY[l - 1], CHECKMARKS_FOR_PROSPERITY[l]];
    return (l - 1 + (m - lo) / (hi - lo)) / levels * 100;
  };
  const range = ledger?.prosperity?.range;
  return h("div", { class: "card tile prosp-tile", "data-tab": "campaign" },
    h("div", { class: "tile-top" }, h("h2", { class: "label" }, "Prosperity"), h("span", { class: "figure" }, level)),
    stepTrack({
      zones: Array.from({ length: levels }, (_, i) => ({ from: i / levels * 100, to: (i + 1) / levels * 100,
        cls: i + 1 < level ? "done" : i + 1 === level ? "now" : i === level ? "next" : null })),
      at: pos(marks),
      maybe: range && !isExact(range) ? [pos(Math.max(0, range.lo)), pos(Math.min(64, range.hi))] : null,
      step: toNext ? { at: level / levels * 100, text: `Level ${level + 1}` } : null,
      ends: ["1", "9"],
      said: `Prosperity ${level}${toNext ? `: ${marks - from} of ${toNext.next - from} checkmarks towards level ${level + 1}` : ", the highest level"}.`,
    }),
    h("div", { class: "tile-foot" },
      h("strong", {}, toNext ? `${toNext.remaining} more to level ${level + 1}` : "Maximum level")),
    sanctuaryMeter(city),
    ledgerFoot(ledger?.prosperity, ""));
}

// Who is playing tonight, for the scenario level. Starts as the last
// session's party (those still active), or everyone.
let levelParty = null;
let difficulty = "normal";

function defaultLevelParty(data) {
  const active = data.characters.filter(playable).map(c => c.name);
  const last = [...data.sessions].filter(s => s.date && s.characters?.length)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const tonight = last ? last.characters.filter(n => active.includes(n)) : [];
  return new Set(tonight.length ? tonight : active);
}

// Tonight's scenario level from the Overview's picker (who is playing,
// difficulty), or null when no one is picked.
function tonight(data) {
  if (!levelParty) levelParty = defaultLevelParty(data);
  const levels = characterOrder(data).filter(c => !c.retired && levelParty.has(c.name)).map(c => characterStats(c).level);
  if (!levels.length) return null;
  const [, label, shift] = DIFFICULTIES.find(([key]) => key === difficulty);
  const level = Math.max(0, Math.min(7, recommendedLevel(levels) + shift));
  return { level, difficulty: label, ...scenarioStats(level) };
}

function levelTile(data) {
  // The inactive come last, quieter, and can be picked for a night: hidden
  // until asked for, unless already picked.
  const everyone = characterOrder(data).filter(c => !c.retired);
  if (!everyone.length) return null;
  if (!levelParty) levelParty = defaultLevelParty(data);
  const active = everyone.filter(c => !hiddenAway(c, levelParty.has(c.name)));
  const away = everyone.length - active.length;
  const playing = active.filter(c => levelParty.has(c.name));
  const levels = playing.map(c => characterStats(c).level);
  const recommended = recommendedLevel(levels);
  const shift = DIFFICULTIES.find(([key]) => key === difficulty)[2];
  const level = Math.max(0, Math.min(7, recommended + shift));
  const st = scenarioStats(level);
  const toggle = name => {
    if (levelParty.has(name)) levelParty.delete(name); else levelParty.add(name);
    render(data);
  };
  const stat = (label, value) => h("div", {}, h("span", { class: "label" }, label), h("span", { class: "num" }, value));
  const average = levels.length ? (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1).replace(/\.0$/, "") : null;
  const diffLabel = DIFFICULTIES.find(([key]) => key === difficulty)[1].toLowerCase();
  const levelAt = d => Math.max(0, Math.min(7, recommended + d));

  // Tonight's level, the tile's figure, beside what it means at the table;
  // under it, how it was reached. The other levels worth seeing are the
  // ones a difficulty gives, so each difficulty says its own.
  return h("div", { class: "card tile level-tile", "data-tab": "tonight" },
    h("h2", { class: "label" }, "Scenario level"),
    playing.length
      ? [h("div", { class: "level-now" },
          h("span", { role: "img", "aria-label": `Scenario level ${level}` }, hex(level, "now")),
          // How it was reached, as a sum: the average of the levels picked
          // below, halved and rounded up, and the difficulty's step.
          h("p", { class: "level-why", role: "img",
                   "aria-label": `Average character level ${average}, halved and rounded up${shift ? `: ${recommended}, ${signed(shift)} on ${diffLabel}` : ""}` },
            h("span", { class: "eq" }, h("small", {}, "avg"), average),
            h("span", { class: "op", title: "Halved, rounded up" }, "÷ 2 ↑ ="),
            h("span", { class: "eq" }, recommended),
            shift ? [h("span", { class: "op" }, `${signed(shift)} ${diffLabel} =`), h("span", { class: "eq" }, level)] : null)),
        // Monster level is the scenario level, which the hex shows.
        h("div", { class: "level-stats" }, stat("Gold per coin", st.gold), stat("Trap damage", st.trap), stat("Bonus XP", st.xp))]
      : h("p", { class: "small muted" }, "Pick who is playing."),
    h("div", { class: "filters party-pick", role: "group", "aria-label": "Who is playing",
               style: `--wide: ${Math.min(active.length, 4)}; --narrow: ${active.length === 3 ? 3 : Math.min(active.length, 2)}` }, active.map(c =>
      h("button", { type: "button", "data-key": `playing-${c.name}`, "aria-pressed": String(levelParty.has(c.name)),
                    class: c.inactive ? "away" : null, title: c.inactive ? `${c.name} is inactive: pick them to count them tonight` : null,
                    "aria-label": `${c.name}, level ${characterStats(c).level}${c.inactive ? ", inactive" : ""}`,
                    onclick: () => toggle(c.name) },
        h("span", { class: "pick-name" }, c.name), h("span", {}, characterStats(c).level)))),
    inactiveToggle(data, away, "level-inactive"),
    playing.length
      ? h("div", { class: "segmented", role: "group", "aria-label": "Difficulty" }, DIFFICULTIES.map(([key, label, d]) =>
          h("button", { type: "button", "data-key": `difficulty-${key}`, "aria-pressed": String(difficulty === key),
                        "aria-label": `${label}: level ${levelAt(d)}`,
                        onclick: () => { difficulty = key; render(data); } },
            h("span", {}, label), h("span", { class: "seg-level" }, levelAt(d)))))
      : null);
}

// Phones: the sections that share a tab but sit far below, as links.
function furtherDown(links) {
  return h("nav", { class: "jump", "data-tab": "campaign", "aria-label": "Further down this tab" },
    h("span", {}, "Further down:"), links.map(([href, label]) => h("a", { href }, label)));
}

// A few hexes behind the party name, one of them lit.
// A band of honeycomb beside the party's name, fading towards it, with one
// cell lit in brass: the map the campaign is played on, quietly. Wide
// screens only; on a phone the name takes the width.
function heroDecor() {
  const at = (cx, cy) => [[0, -26], [22.5, -13], [22.5, 13], [0, 26], [-22.5, 13], [-22.5, -13]]
    .map(([dx, dy]) => `${cx + dx},${cy + dy}`).join(" ");
  const cells = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      const cx = 24 + col * 45 + (row % 2 ? 22.5 : 0);
      cells.push([cx, 27 + row * 39, row === 1 && col === 5 ? "lit" : ""]);
    }
  }
  return svg("0 0 408 132",
    cells.map(([cx, cy, cls]) => `<polygon points="${at(cx, cy)}"${cls ? ` class="${cls}"` : ""}/>`).join(""),
    { class: "hero-decor", "aria-hidden": "true" });
}

// Where the party is, above its name, when the campaign says somewhere more
// particular than Gloomhaven itself. The edition is only in the footer.
function locationText(location) {
  const here = String(location || "").trim();
  return here && here.toLowerCase() !== "gloomhaven" ? here : null;
}

function renderOverview(data) {
  const { party, city } = data;
  const ready = data.scenarios.filter(s => s.status === "available").sort((a, b) => a.number - b.number);
  const from = s => s.unlockedBy != null ? `Opened by ${scenarioLabel(data, s.unlockedBy)}`
                  : s.unlockedVia ? `Opened by ${s.unlockedVia}` : null;

  return [
    h("div", { class: "hero" },
      h("div", { class: "hero-head" },
        heroDecor(),
        locationText(party.location) ? h("div", { class: "eyebrow" }, locationText(party.location)) : null,
        h("h1", { class: (party.name || "").length > 22 ? "party-name long" : "party-name" }, party.name || "Unnamed party"),
        furtherDown([["#scenarios", "Scenarios"], ["#sessions", "Sessions"], ["#events", "Event decks"], ["#record", "Campaign record"]])),
      // The evening, step by step, with a way to record it at the end.
      tonightStrip(data),
      // Tiles first: the left column reads first on wide screens, the
      // scenario level leading, as the table is set up by it. The right
      // column puts what to sort out before playing above what to play.
      // Phones show Ready to play, then the tiles, then the list (styles.css).
      // Phones split the Overview: setting up tonight on the Tonight tab,
      // reputation, prosperity and the party on the Campaign tab (data-tab).
      h("div", { class: "tiles" }, levelTile(data), reputationTile(party, data.ledger), prosperityTile(city, data.ledger)),
      h("div", { class: "hero-side" },
        todoList(data),
        h("div", { class: "ready", "data-tab": "tonight" },
          h("div", { class: "ready-head" },
            h("h2", {}, "Ready to play"),
            h("a", { href: "#scenarios" }, data.scenarios.length > 1 ? `All ${data.scenarios.length} scenarios` : "Scenarios")),
          ready.length
            ? h("div", { class: "ready-list" }, ready.map(s => {
                const tried = attemptsText(data, s.number);
                return h("a", { class: "ready-card", href: "#scenarios", onclick: () => openScenario(data, s.number),
                                "aria-label": [`#${s.number} ${s.name || "Untitled"}`, from(s), tried ? capitalize(tried) : null].filter(Boolean).join(", ") },
                  hex(s.number),
                  h("span", {},
                    h("span", { class: "ready-name" }, s.name || "Untitled"),
                    from(s) ? h("span", { class: "ready-from" }, from(s)) : null,
                    tried ? h("span", { class: "ready-tried" }, capitalize(tried)) : null));
              }))
            : empty("Nothing is unlocked to play right now.")))),
    partyList(data),
  ];
}

// Going straight on from the last scenario played to one linked to it needs
// no road event (rulebook p. 41): say which, if any can be played.
// No road event (rulebook p. 41) for: the same scenario again, one linked
// to the last (going straight on, not back to town), one linked to
// Gloomhaven itself, or anything played in casual mode.
function straightOn(data) {
  const last = [...data.sessions].filter(s => s.date && s.scenarios?.length)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.scenarios.at(-1);
  const open = n => data.scenarios.some(s => s.number === n && s.status === "available");
  const links = (scenarioRef?.scenarios?.[String(last?.number)]?.links || []).map(Number).filter(open);
  const home = data.scenarios.filter(s => s.status === "available" && scenarioRef?.scenarios?.[String(s.number)] && !needsRoadEvent(s.number)).map(s => s.number);
  return [
    links.length ? ` · none straight on to ${links.map(n => `#${n}`).join(" or ")}` : "",
    last && last.result !== "success" && open(last.number) ? ` · none to retry #${last.number}` : "",
    home.length ? ` · none for ${home.map(n => `#${n}`).join(", ")} (from town)` : "",
  ].join("");
}

// Whether travelling from town to a scenario takes a road event: not when
// it's linked to Gloomhaven (the scenario data says which do).
function needsRoadEvent(number) {
  const info = scenarioRef?.scenarios?.[String(number)];
  return !info || info.eventType === "road";
}

// An evening of Gloomhaven, in the order it runs: a city event, the town
// (shop, perks, the Sanctuary), a road event, then the scenario. Each step
// links to where it's handled; the strip ends with recording the evening.
// A donation to the Sanctuary: two Bless cards each for the next scenario
// (p. 45). Said with the donation, in town, where it's made.
function blessings() {
  const who = new Set((draft?.donations || []).filter(x => x.character).map(x => x.character));
  return who.size ? ` (${who.size * 2} Bless)` : "";
}

function tonightStrip(data) {
  const t = tonight(data);
  const decks = data.eventState?.decks;
  const shop = data.shop;
  // A step already in the draft says what it was, ticked; the event steps
  // open the form at an event row for that deck, ready for its number.
  const step = (n, label, value, href, run, done) => h("a", {
      class: `tonight-step${done ? " done" : ""}`, href, "aria-label": `${n}. ${label}: ${value}${done ? ", in the draft" : ""}`,
      onclick: run && rawCampaign ? e => { e.preventDefault(); run(); } : null },
    hex(n, done ? "completed" : "quiet"),
    h("span", { class: "tonight-text" }, h("span", { class: "label" }, label), h("span", { class: "tonight-value" }, value)),
    done ? h("span", { class: "tonight-done" }, icon("check", "In the draft")) : null);
  const recording = draftChanges(draft, data);
  const drawn = deck => (draft?.events || []).filter(e => e.deck === deck && num(e.number))
    .map(e => `${eventLabel(deck, num(e.number))}${e.option ? ` · option ${e.option}` : ""}`).join(", ");
  const town = draft ? [
    [(draft.buys || []).filter(b => b.character && b.item).length, "purchase"],
    [(draft.sells || []).filter(x => x.character && x.item).length, "sale"],
    [(draft.perks || []).filter(p => p.character && p.perk).length, "perk"],
    [(draft.donations || []).filter(x => x.character).length, "donation"],
    [(draft.enhancements || []).filter(x => x.character).length, "enhancement"],
  ].filter(([n]) => n).map(([n, what]) => plural(n, what)).join(", ") + blessings() : "";
  const played = (draft?.scenarios || []).filter(s => num(s.number));
  const firstPlayed = (draft?.scenarios || []).findIndex(s => num(s.number));
  // Anyone to play: a new campaign has no one until characters are added.
  const anyone = data.characters.some(c => !c.retired) || Boolean(draft?.newCharacters?.some(x => x.name));
  return h("nav", { class: "tonight", "data-tab": "tonight", "aria-label": "Tonight, step by step" },
    step(1, "City event", drawn("city") || (decks ? `${decks.city.size} in the deck` : "Draw one"), "#events",
      () => recordEvent(data, "city"), Boolean(drawn("city"))),
    step(2, "In town", town || (shop ? (shop.modifier === 0 ? "Normal prices" : `Prices ${signed(shop.modifier)} gold`) : "Shop, perks, Sanctuary"),
      "#shop", null, Boolean(town)),
    step(3, "Road event", drawn("road") || (decks ? `${decks.road.size} in the deck` : "Draw one") + straightOn(data), "#events",
      () => recordEvent(data, "road"), Boolean(drawn("road"))),
    step(4, "Scenario", (played.length ? played.map(s => scenarioLabel(data, num(s.number))).join(", ")
      : t ? `Level ${t.level} · deal battle goals` : anyone ? "Pick who is playing" : "Add characters first"), anyone ? "#scenarios" : "#sessions",
      played.length ? () => showInRecorder(data, `sc-${firstPlayed}-n`) : anyone ? null : () => addNewcomer(data), played.length > 0),
    rawCampaign ? h("button", { type: "button", class: `btn${recording ? "" : " primary"} tonight-record`, "data-key": "tonight-record",
      onclick: () => { if (!draft) draft = newDraft(data); showInRecorder(data, "rec-date"); } },
      recording ? "Go on recording" : "Record the evening") : null);
}

// Everything waiting on the party before the next scenario, gathered from
// the sections that work it out. Each entry links to where it's handled.
function todoItems(data) {
  const items = [];
  // place: what the link says, if not the section's name.
  // urgent: it stops someone playing, so it goes first, marked.
  const add = (text, href, onclick, action, place, urgent) => items.push({ text, href, onclick, action, place, urgent });
  const order = characterOrder(data);

  if (draftChanges(draft, data)) add("What's been recorded on this phone isn't saved yet: download it from Sessions and commit it.", "#sessions");

  // No one adventuring yet (a new campaign): nothing can happen until there is.
  if (!order.some(c => !c.retired) && !draft?.newCharacters?.some(x => x.name)) {
    add("The party has no characters yet. Add them, and they can play the first scenario in the same session.", "#sessions", null,
      rawCampaign ? { label: "Add them", run: () => addNewcomer(data) } : null);
  }

  // A party with no name: the title says "Unnamed party" until it has one.
  if (!data.party.name && !draft?.partyName) {
    add("The party has no name yet.", "#sessions", null,
      rawCampaign ? { label: "Name it", run: () => { if (!draft) draft = newDraft(data); showInRecorder(data, "rec-party-name"); } } : null);
  }

  // Who passed a level in the last session: a new ability card to pick. It
  // stays until the next session is recorded, as there's nowhere to tick it.
  const levelUps = lastLevelUps(data);

  // Someone sitting out isn't reminded of anything: it waits on their sheet.
  for (const c of order.filter(playable)) {
    const st = characterStats(c);
    // Phones open that character's sheet; wide screens scroll to its card.
    const go = e => {
      pickCharacter(data, order.indexOf(c));
      if (!phone.matches) { e.preventDefault(); revealCharacter(c.name); }
    };
    const sheet = `${c.name}'s sheet`;
    for (const u of levelUps.filter(u => u.character === c.name)) {
      add(`${c.name} reached level ${u.level} last session: add an ability card of level ${u.level} or lower.`, "#characters", go, null, sheet);
    }
    // A fulfilled personal quest: they must retire at this visit (p. 48).
    if (questDone(c.personalQuest) && !draft?.retirements?.some(x => x.character === c.name)) {
      add(`${c.name}'s personal quest is fulfilled: they must retire at this visit to town, before playing again.`, "#characters", go,
        rawCampaign ? { label: "Record it", run: () => recordRetire(data, c.name) } : null, sheet, true);
    }
    // On the phone that knows their quest card: a scenario the quest opens,
    // and a count the record has wrong. Neither names the quest.
    const quest = questCard(c.name) ? questProgress(data, c, questCard(c.name)) : null;
    for (const x of quest?.steps || []) {
      if (!x.opens || data.scenarios.some(s => s.number === x.opens) || draft?.opened?.some(o => num(o.number) === x.opens)) continue;
      add(`${c.name}'s personal quest opens ${scenarioLabel(data, x.opens)}.`, "#characters", go,
        rawCampaign ? { label: "Record it", run: () => recordOpened(data, x.opens) } : null, sheet);
    }
    if (quest?.known && !quest.fits(draft?.quests?.[c.name] || c.personalQuest)) {
      add(`${c.name}'s personal quest count differs from the record: see their sheet.`, "#characters", go, null, sheet);
    }
    // Below the prosperity level: they may advance to it (rulebook p. 48).
    const prosperity = stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
    if (st.level < prosperity && !draft?.advances?.includes(c.name)) {
      add(`Prosperity is ${prosperity}: ${c.name} may advance from level ${st.level} to ${prosperity}.`, "#characters", go,
        rawCampaign ? { label: "Record it", run: () => recordAdvance(data, c.name) } : null, sheet);
    }
    // A perk already picked in the session being recorded isn't asked for again.
    const left = perksLeft(c);
    if (left) add(`${c.name} has ${plural(left, "perk")} to choose.`, "#characters", go,
      { label: "Record it", run: () => recordPerk(data, c.name) }, sheet);
    for (const r of perkCheck(c).rows.filter(r => r.note && !r.quiet)) add(`${c.name}: "${r.written}". ${r.note}`, "#characters", go, null, sheet);
  }

  for (const d of data.draws || []) add(`Draw ${d.what} (${d.from}).`, "#record");
  // Events that bite at the next scenario's start: those in the session being
  // recorded, and saved ones after the last scenario played, still waiting.
  const lastDone = [...data.scenarios].reverse().find(s => s.status === "completed")?.number;
  const waiting = [
    ...data.events.filter(e => e.after != null && e.after === lastDone && e.option)
      .map(e => ({ deck: e.deck, number: e.number, option: e.option, names: e.characters || [], paid: e.paid })),
    ...(draft?.events || []).filter(e => num(e.number) && e.option)
      .map(e => ({ deck: e.deck, number: num(e.number), option: e.option, names: [...(draft.party || [])], paid: e.paid === "yes" ? true : e.paid === "no" ? false : undefined })),
  ];
  for (const e of waiting) {
    const oc = chosenOutcome(data, classRef, e.deck, e.number, e.option, e.names, e.paid);
    for (const fx of (oc?.effects || []).filter(fx => fx.type === "nextScenario")) add(`${eventLabel(e.deck, e.number)}, option ${e.option}: ${nextScenarioText(fx)}.`, "#sessions");
  }
  (data.claims || []).forEach((c, i) => add(`Treasure ${c.treasure} in ${c.where} gave ${c.item}: who looted it?`, "#record", null,
    rawCampaign ? { label: "Record it", run: () => recordClaim(data, i) } : null));

  // What the rulebook opens when the campaign reaches it (p. 49).
  const rep = data.party.reputation;
  const unlocked = new Set(data.city.unlockedClasses.map(u => u.id));
  const inDecks = (deck, n) => data.eventState?.decks?.[deck]?.has(n) || data.eventState?.removed?.[deck]?.has(n);
  const partyHas = new Set(data.party.achievements.map(a => a.id));
  const cityHas = new Map(data.city.globalAchievements.map(a => [a.id, a.count || 1]));
  // Once reached, even if reputation has since moved back (p. 49).
  const peak = Math.max(rep, data.ledger?.reputation?.peak ?? rep), low = Math.min(rep, data.ledger?.reputation?.low ?? rep);
  if (peak >= 10 && !unlocked.has("sun")) add(`Reputation has reached ${signed(peak)}: open the box with the ${classIconName("sun")} icon.`, "#record");
  if (low <= -10 && !unlocked.has("eclipse")) add(`Reputation has reached ${signed(low)}: open the box with the ${classIconName("eclipse")} icon.`, "#record");
  if (peak >= 20 && !(inDecks("city", 76) && inDecks("road", 67))) add("Reputation has reached 20: add City 76 and Road 67 to the event decks.", "#events");
  if (low <= -20 && !(inDecks("city", 77) && inDecks("road", 68))) add("Reputation has reached −20: add City 77 and Road 68 to the event decks.", "#events");
  if ((cityHas.get("ancient-technology") || 0) >= 5 && !data.city.envelopeA) {
    add("Five Ancient Technology achievements: open envelope A, then set envelopeA to true in campaign.json.", "#record");
  }
  if (partyHas.has("the-drakes-command") && partyHas.has("the-drakes-treasure") && !cityHas.has("the-drake-aided")) {
    add("The Drake's Command and The Drake's Treasure: add City 75 and Road 66 to the event decks, and gain The Drake Aided.", "#record");
  }
  if (data.characters.some(c => c.retired) && !data.city.townRecords) {
    add("A character has retired: open the Town Records Book, then set townRecords to true in campaign.json.", "#record");
  }

  // Events with no option recorded go together; other questions one by one.
  const questions = data.eventState?.questions || [];
  const noOption = questions.filter(q => /: which option did you choose/.test(q)).map(q => q.split(":")[0]);
  if (noOption.length) {
    add(`${noOption.join(", ")}: ${noOption.length === 1 ? "no option recorded" : "no options recorded"}, so reputation${data.shop?.pricesUnsure ? " and shop prices" : ""} can't be settled.`, "#events");
  }
  for (const q of questions.filter(q => !/: which option did you choose/.test(q))) add(q.replace(/^(Ledger|Record): /, ""), "#events");

  for (const q of data.shop?.questions || []) add(q, "#shop");

  if (!data.city.envelopeB && data.city.donations >= ENVELOPE_B_DONATIONS) add("Donations have reached 100 gold: Envelope B can be opened.", "#overview");
  return [...items.filter(i => i.urgent), ...items.filter(i => !i.urgent)];
}

// Who passed a level in the last session played, and to which: each owes a
// new ability card until the next session is recorded.
function lastLevelUps(data) { return [...data.sessions].reverse().find(s => s.scenarios?.length)?.levelUps || []; }

// Perks picked in the session being recorded, not yet in campaign.json.
function draftedPerks(name) { return (draft?.perks || []).filter(p => p.character === name && p.perk).length; }
// Perks still to choose, leaving out those already picked in the draft.
// A character's attack modifier deck: the standard twenty cards, changed by
// the perks they've taken, read from the perks' wording ("Remove two −1
// cards", "Replace one +0 card with one +2 card", "Add one +2 FIRE card").
// unread lists any perk it couldn't follow.
const BASE_DECK = [["−2", 1], ["−1", 5], ["+0", 6], ["+1", 5], ["+2", 1], ["2×", 1], ["Null", 1]];
function attackDeck(perkTexts) {
  const deck = new Map(BASE_DECK);
  const unread = [];
  const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const count = w => words[w.toLowerCase()] ?? (Number(w) || 0);
  const card = t => t.replace(/(^|\s)-(\d)/g, "$1−$2").replace(/\s+/g, " ").trim();
  // "two +0 cards and one +0 FIRE card" -> [[2, "+0"], [1, "+0 FIRE"]], or null.
  const cardsIn = list => {
    const parts = list.split(/\s+and\s+/i).map(part => part.match(/^(\w+) (.+?) cards?$/i));
    return parts.every(m => m && count(m[1])) ? parts.map(m => [count(m[1]), card(m[2])]) : null;
  };
  for (const text of perkTexts) {
    // "Ignore negative item effects" changes no card; it may lead an "add".
    const rest = String(text).replace(/\.$/, "").replace(/^ignore negative \w+ effects(\s+and\s+)?/i, "").trim();
    if (!rest) continue;
    const m = rest.match(/^(remove|replace|add)\s+(.+?)(?:\s+with\s+(.+))?$/i);
    const verb = m?.[1].toLowerCase();
    const out = verb === "replace" ? cardsIn(m[2] || "") : verb === "remove" ? cardsIn(m[2]) : [];
    const into = verb === "replace" ? cardsIn(m[3] || "") : verb === "add" ? cardsIn(m[2]) : [];
    // Worked out on a copy, kept only if every card it names can be taken
    // and put: a perk is never half applied.
    const next = new Map(deck);
    const find = t => [...next.keys()].find(k => k.toLowerCase() === t.toLowerCase()) || t;
    let ok = Boolean(m && out && into && (verb !== "replace" || m[3]));
    for (const [n, t] of ok ? out : []) {
      const k = find(t);
      if (!next.has(k) || next.get(k) < n) { ok = false; break; }
      next.set(k, next.get(k) - n);
    }
    if (ok) for (const [n, t] of into) { const k = find(t); next.set(k, (next.get(k) || 0) + n); }
    if (ok) { deck.clear(); for (const [k, v] of next) deck.set(k, v); } else unread.push(text);
  }
  const order = ["Null", "−2", "−1", "+0", "+1", "+2", "+3", "+4", "2×"];
  const rank = k => order.includes(k) ? order.indexOf(k) : order.length;
  const cards = [...deck].filter(([, n]) => n > 0).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  return { cards, total: cards.reduce((sum, [, n]) => sum + n, 0), unread };
}

function perksLeft(c) { return Math.max(0, characterStats(c).unspent - draftedPerks(c.name)); }

// What each "Before you play" link says: the section it goes to.
const TODO_PLACES = { "#characters": "Characters", "#shop": "Shop", "#sessions": "Sessions",
  "#events": "Event decks", "#record": "Campaign record", "#overview": "Overview" };

// Open the recorder with a new character's row, ready for their name.
function addNewcomer(data) {
  if (!draft) draft = newDraft(data);
  draft.newCharacters ||= [];
  let i = draft.newCharacters.findIndex(x => !x.name);
  if (i < 0) { draft.newCharacters.push({ name: "", class: "", level: "1", playing: true }); i = draft.newCharacters.length - 1; }
  showInRecorder(data, `new-${i}-n`);
}

// Open the recorder and bring one of its boxes into view, with focus. It
// waits for the switch to Sessions, which on a phone starts the tab from its
// top, and jumps rather than glides, so nothing scrolls it away again.
function showInRecorder(data, key) {
  recorderOpen = true;
  saveDraft();
  render(data);
  const go = () => setTimeout(() => {
    const box = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
    box?.scrollIntoView({ block: "center", behavior: "instant" });
    box?.focus({ preventScroll: true });
  }, 0);
  if (location.hash === "#sessions") go();
  else { window.addEventListener("hashchange", go, { once: true }); location.hash = "sessions"; }
}

// "Record it" for a character below the prosperity level: advancing to it
// goes in the draft.
function recordAdvance(data, name) {
  if (!draft) draft = newDraft(data);
  draft.advances ||= [];
  if (!draft.advances.includes(name)) draft.advances.push(name);
  showInRecorder(data, `adv-${name}`);
}

// From the Tonight row: the form at an event row for that deck, a new one
// unless the draft already has one.
function recordEvent(data, deck) {
  if (!draft) draft = newDraft(data);
  let i = draft.events.findIndex(e => e.deck === deck);
  if (i < 0) { draft.events.push({ ...newEvent(), deck }); i = draft.events.length - 1; }
  showInRecorder(data, `ev-${i}-n`);
}

// "Record it" on the enhancement calculator: what it worked out, in the
// draft, for whoever is shopping (or to pick in the form).
function recordEnhancement(data, what, cost) {
  if (!draft) draft = newDraft(data);
  draft.enhancements ||= [];
  const who = data.characters.find(c => !c.retired && c.name === (shopFor === undefined ? me : shopFor));
  draft.enhancements.push({ character: who?.name || "", what, cost });
  showInRecorder(data, `enr-${draft.enhancements.length - 1}-c`);
}

// Personal quest progress written as "n/m", or as steps taken in order
// ("1/3, then 0/1": three of something, then one more thing): each step's
// count and target. Any other wording ("2? (noted as II)") gives null.
function questSteps(text) {
  const parts = String(text || "").trim().split(/\s*(?:,\s*then\b|\bthen\b|,|\+)\s*/i);
  const steps = parts.map(p => p.match(/^(\d+)\s*\/\s*(\d+)$/));
  if (!parts[0] || steps.some(m => !m || !Number(m[2]))) return null;
  return steps.map(m => [Number(m[1]), Number(m[2])]);
}

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

// The recorder's quick picks: completed scenarios too, once asked for, until
// one is picked.
let showReplays = false;

// Personal quests are secret at the table, so a sheet's progress shows only
// once its player taps it (until they tap again, or the page reloads). A
// fulfilled quest is no secret: the character retires.
const questShown = new Set();

// "Record it" for a fulfilled personal quest: a retirement row in the form,
// with what the quest opens filled in on the phone that knows the card.
function recordRetire(data, name) {
  if (!draft) draft = newDraft(data);
  const quest = questRef?.quests?.[questCard(name)];
  const unlocks = quest?.unlockClass || (quest?.openEnvelope ? `envelope-${quest.openEnvelope.toLowerCase()}` : "");
  let i = draft.retirements.findIndex(x => x.character === name);
  if (i < 0) { draft.retirements.push({ character: name, unlocks }); i = draft.retirements.length - 1; }
  showInRecorder(data, `ret-${i}-u`);
}

// "Record it" for a scenario a personal quest opens.
function recordOpened(data, number) {
  if (!draft) draft = newDraft(data);
  let i = draft.opened.findIndex(o => num(o.number) === number);
  if (i < 0) { draft.opened.push({ number: String(number) }); i = draft.opened.length - 1; }
  showInRecorder(data, `open-${i}-n`);
}

// "Record it" on an open question about a past treasure: the form at its
// "Looted by".
function recordClaim(data, i) {
  if (!draft) draft = newDraft(data);
  showInRecorder(data, `claim-${i}-c`);
}

// "Buy" and "Sell" in the Shop: into the draft, staying in the Shop so the
// next one is a tap away; the item's row then says "In the draft".
function recordBuy(data, name, item) {
  if (!draft) draft = newDraft(data);
  if (!draft.buys.some(b => b.character === name && b.item === item)) draft.buys.push({ character: name, item });
  saveDraft();
  render(data);
}

function recordSell(data, name, item) {
  if (!draft) draft = newDraft(data);
  if (!draft.sells.some(b => b.character === name && b.item === item)) draft.sells.push({ character: name, item });
  saveDraft();
  render(data);
}

// "Record it" on a scenario you can play: the scenario in the draft, at
// tonight's level, ready for what each character gained.
function recordScenario(data, number) {
  if (!draft) draft = newDraft(data);
  let i = draft.scenarios.findIndex(x => num(x.number) === number);
  if (i < 0) {
    const party = data.characters.filter(c => !c.retired && draft.party.includes(c.name));
    draft.scenarios.push({ ...newScenario(data, party), number: String(number) });
    i = draft.scenarios.length - 1;
  }
  const first = data.characters.find(c => !c.retired && draft.party.includes(c.name));
  showInRecorder(data, first ? `sc-${i}-${first.name}-xp` : `sc-${i}-r`);
}

// "Record it": open the recorder with a perk row for this character, ready
// to pick the perk.
function recordPerk(data, name) {
  if (!draft) draft = newDraft(data);
  let i = draft.perks.findIndex(p => p.character === name && !p.perk);
  if (i < 0) { draft.perks.push({ character: name, perk: "" }); i = draft.perks.length - 1; }
  showInRecorder(data, `perk-${i}-p`);
}

// Wide screens show every sheet: bring this character's into view.
function revealCharacter(name) {
  document.querySelector(`.char-card[data-char="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "start" });
}

function todoList(data) {
  const items = todoItems(data);
  return h("div", { class: "card todo", "data-tab": "tonight" },
    h("div", { class: "block-head" },
      h("h2", { class: "label" }, "Before you play"),
      h("span", {}, items.length ? plural(items.length, "thing") + " to see to" : "All clear")),
    items.length
      ? h("ul", { class: "rows" }, items.map(item => h("li", { class: item.urgent ? "urgent" : null },
          h("span", {}, item.urgent ? icon("lock", "Stops play") : null, item.text),
          h("span", { class: "todo-acts" },
            item.action ? h("button", { type: "button", class: "todo-do", onclick: item.action.run }, item.action.label) : null,
            h("a", { class: "todo-go", href: item.href, onclick: item.onclick || null }, item.place || TODO_PLACES[item.href] || "Open")))))
      : h("p", { class: "small muted" }, "Nothing to sort out before the next scenario."));
}

// The party at a glance, on phones. Each row opens that character's sheet.
function partyList(data) {
  const order = characterOrder(data);
  const everyone = order.filter(c => !c.retired);
  if (!everyone.length) return null;
  const away = everyone.filter(c => c.inactive).length;
  const active = everyone.filter(c => !hiddenAway(c));
  return h("div", { class: "party", "data-tab": "campaign" },
    h("div", { class: "party-head" }, h("h2", {}, "The party"),
      h("span", { class: "small muted" }, plural(everyone.length - away, "character")),
      inactiveToggle(data, away, "party-inactive")),
    // Anyone sitting out comes last, quieter, with "Inactive" in place of
    // what they're working towards.
    active.map(c => {
      const st = characterStats(c);
      return h("a", { class: `party-row${c.inactive ? " inactive" : ""}`, href: "#characters", onclick: () => pickCharacter(data, order.indexOf(c)) },
        hex(st.level, c.inactive ? "quiet" : "level"),
        h("span", { class: "party-who" },
          h("strong", {}, c.name),
          h("span", {}, classIcon(c.class), c.class),
          !c.inactive && perksLeft(c) ? h("em", {}, `${plural(perksLeft(c), "perk")} to choose`) : null),
        c.inactive ? h("span", { class: "party-xp" }, h("span", {}, "Inactive"))
        : h("span", { class: "party-xp" },
          h("span", { class: st.close ? "close" : null }, st.nextText),
          meter(st.toNext ? st.toNext.fraction : 1, st.close),
          h("small", {}, `${c.gold} gold`)));
    }));
}

// --- Event decks -------------------------------------------------------------

// The option an event was resolved with, as a badge: "?" when it wasn't
// recorded, or can't be known.
function optionBadge(e) {
  const said = e.option ? `Option ${e.option}` : e.unknown ? "Option not known" : "Option not recorded";
  return h("span", { class: `opt${e.option ? "" : " unknown"}`, role: "img", title: said, "aria-label": said }, e.option || "?");
}

function renderEvents(data) {
  const ev = data.eventState;
  if (!ev) return null;

  const deckCard = deck => {
    const sorted = map => [...map].sort((a, b) => a[0] - b[0]);
    const added = sorted(ev.added[deck]);
    const removed = sorted(ev.removed[deck]);
    const summary = capitalize([
      added.length ? `added ${added.map(([n]) => n).join(", ")}` : null,
      removed.length ? `removed ${removed.map(([n]) => n).join(", ")}` : null,
    ].filter(Boolean).join(" · "));
    const line = (verb, [number, source]) =>
      h("li", {}, `${verb} ${eventLabel(deck, number)}`, h("span", { class: "muted" }, ` · ${source}`));
    return h("div", { class: "card deck" },
      h("div", { class: "deck-top" },
        h("span", { class: "label" }, `${DECK_NAMES[deck]} deck`),
        h("span", { class: "figure" }, ev.decks[deck].size)),
      summary
        ? h("details", {}, h("summary", {}, summary),
            h("ul", {}, added.map(a => line("Added", a)), removed.map(r => line("Removed", r))))
        : h("span", { class: "small muted" }, "No changes yet"));
  };

  const question = q => {
    const [label, ...rest] = q.split(": ");
    return rest.length ? nudge("question", `${label} needs an answer`, capitalize(rest.join(": "))) : nudge("question", q);
  };

  // A question about a drawn event is asked on that event's row, so the
  // list says it once; any other question stays a box above the list.
  const asks = new Map();
  const loose = [];
  for (const q of ev.questions) {
    const [label, ...rest] = q.split(": ");
    const row = rest.length && ev.history.find(e => label === e.label || label.startsWith(`${e.label}, `));
    if (!row) { loose.push(q); continue; }
    const extra = label === row.label ? "" : `${capitalize(label.slice(row.label.length + 2))}: `;
    asks.set(row, [...(asks.get(row) || []), extra + capitalize(rest.join(": "))]);
  }

  const drawn = e => {
    const detail = [
      e.effects.length ? capitalize(e.effects.join(", ")) : null,
      !e.effects.length && e.adds.length ? `added ${e.adds.map(([d, n]) => eventLabel(d, n)).join(", ")}` : null,
      e.scenario ? `before #${e.scenario}` : null,
    ].filter(Boolean).join(" · ");
    return h("li", {},
      h("strong", {}, e.label, optionBadge(e)),
      // What was recorded at full strength, and notes quietly; the badge
      // says when the option is missing, so a list of unrecorded draws
      // doesn't spell out its gaps.
      h("span", {}, detail || null,
        e.notes ? h("div", { class: "small muted" }, e.notes) : null,
        (asks.get(e) || []).map(text => h("div", { class: "ask" }, icon("question"), text))),
      h("span", { class: `fate ${e.fate || (e.unknown ? "unknown" : "open")}` },
        // The icon printed on event cards, and the word: the two icons look
        // alike at this size.
        e.fate ? [gameIcon(`event-${e.fate}`), h("span", { class: "fate-word" }, capitalize(e.fate))] : e.unknown ? "Not known" : "Needs an answer"));
  };

  return [
    sectionHead("Event decks", ev.history.length ? `${plural(ev.history.length, "event")} drawn` : null),
    h("div", { class: "decks" }, Object.keys(DECK_NAMES).map(deckCard)),
    loose.map(question),
    ev.history.length ? h("ul", { class: "drawn" }, ev.history.map(drawn)) : null,
    // Past events can't be answered on the page, so say where the answer goes.
    asks.size ? h("p", { class: "small muted how" },
      codeText('To answer, add `"option": "A"` or `"B"` to that event in the `"events"` list of `campaign.json`; the page works out the rest.')) : null,
  ];
}

// --- Campaign record ---------------------------------------------------------

// Text with what to type into campaign.json between backticks: those parts
// are set as code, so they stand apart from the sentence around them.
function codeText(text) {
  return text.split("`").map((part, i) => i % 2 ? h("code", {}, part) : part);
}

function recordRows(list, data) {
  if (!list.length) return h("p", { class: "small muted" }, "None yet.");
  // Where it came from: a scenario ("#8") opens that scenario.
  const where = text => {
    const n = /^#(\d+)$/.exec(String(text))?.[1];
    return n && data ? scenarioLink(data, Number(n), text) : text;
  };
  return h("ul", { class: "rows" }, list.map(a => h("li", {},
    h("span", {},
      h("strong", {}, a.name, a.count > 1 ? ` ×${a.count}` : null),
      a.notes ? h("span", { class: "sub" }, a.notes) : null),
    a.where ? h("span", { class: "where" }, where(a.where)) : null)));
}

function renderRecord(data) {
  const { party, city } = data;
  const card = (title, body) => h("div", { class: "card" }, h("h3", { class: "label" }, title), body);
  return [
    sectionHead("Campaign record"),
    // The page can't record a draw itself, so say exactly what to write.
    (data.draws || []).map(d => nudge("question", `Draw ${d.what}`, [
      `From ${d.from}. Not drawn yet.`,
      d.how ? h("span", { class: "how" }, codeText(`Once drawn, record it in \`campaign.json\`: ${d.how}.`)) : null])),
    // The form settles it; without the form, say what to write.
    (data.claims || []).map((c, i) => nudge("question", `Who looted ${c.item}?`, [
      `Treasure ${c.treasure} in ${c.where} gave it, but no one is written down as looting it, and no sheet has it.`,
      rawCampaign
        ? h("div", { class: "nudge-do" }, h("button", { type: "button", class: "todo-do", "data-key": `claim-${i}`, onclick: () => recordClaim(data, i) }, "Record it"))
        : h("span", { class: "how" }, codeText(`Record it in \`campaign.json\`: ${c.how}.`))])),
    h("div", { class: "record" },
      card("Party achievements", recordRows(party.achievements, data)),
      card("Global achievements", recordRows(city.globalAchievements, data)),
      card("In the shop for good", recordRows(city.itemDesigns, data)),
      card("Unlocked classes", city.unlockedClasses.length
        ? h("div", { class: "chips" }, city.unlockedClasses.map(c =>
            h("span", { class: "chip", title: c.where || null }, classIcon(c.name || c), c.name || c)))
        : h("p", { class: "small muted" }, "None listed."))),
    party.notes ? h("div", { class: "party-notes" }, h("h3", { class: "label" }, "Party notes"), notes(party.notes)) : null,
  ];
}

// --- Scenario rules from the reference data ------------------------------
// data/gloomhaven-scenarios.json (from Gloomhaven Secretariat) says what each
// scenario unlocks, blocks, requires and rewards. campaign.json only records
// what happened; everything else is worked out here.

// "Jekserah's Plans" -> "jekserahs-plans", the ids the reference data uses.
function slug(name) {
  return String(name).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function achievementName(ref, kind, id) {
  return ref?.achievements?.[kind]?.[id] || id;
}

// data/gloomhaven-items.json, once loaded: item names by number.
let itemsRef = null;
function itemName(id) { return itemsRef?.items?.[String(id)]?.name || `item ${id}`; }
// Item names as the sheets write them: capitals don't matter.
const sameItem = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
// A scenario's reward items, one entry per copy ("27:2" is two copies).
function rewardCopies(info) {
  return (info?.rewards?.items || []).flatMap(id => {
    const [n, copies] = String(id).split(":");
    return Array.from({ length: Number(copies) || 1 }, () => itemName(n));
  });
}
function itemInfo(name) {
  return Object.values(itemsRef?.items || {}).find(i => i.name.toLowerCase() === String(name).toLowerCase()) || null;
}
function itemSlot(name) { return itemInfo(name)?.slot || null; }

// What a treasure tile gives, from the reference data ("gold:10|...").
function treasureParts(ref, number) {
  const raw = ref?.treasures?.[String(Number(number))];
  return raw ? raw.split("|").map(part => { const [type, value] = part.split(":"); return { type, value }; }) : [];
}

function describeTreasurePart({ type, value }) {
  switch (type) {
    case "gold": return `${value} gold`;
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
      const id = a.id || slug(a.name);
      counts.set(id, (counts.get(id) || 0) + (a.count || 1));
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
  if (r.gold) parts.push(`${r.gold} gold each`);
  if (r.collectiveGold) parts.push(`${r.collectiveGold} gold to share`);
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
  if (c.type === "payCollectiveGold" || c.type === "payGold") return `if you paid ${c.values[0]} gold`;
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
    const id = cls && (ids.find(([, n]) => n.toLowerCase() === cls.toLowerCase())?.[0] || slug(cls));
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
      case "gold": say(`${signed(e.amount)} gold each`); break;
      case "collectiveGold": say(`${signed(e.amount)} gold to share`); break;
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
        say(`choose: ${e.of.map(sub => sub.amount != null ? `${signed(sub.amount)} ${sub.type === "gold" ? "gold" : sub.type}` : sub.type).join(" or ")}`);
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
                   // Items found (treasures, scenario rewards): one copy each, to a
                   // character, not to the shop; and those whose finder isn't known.
                   found: [], claims: [] };
  const note = (entry, where) => { if (where && !entry.where.includes(where)) entry.where.push(where); };
  const gainAchievement = (kind, rawId, where) => {
    const id = String(rawId).split(":")[0];
    const name = achievementName(ref, kind, id);
    const list = record[kind];
    // "City Rule: Economic" replaces any other City Rule; likewise Artifact.
    const type = kind === "global" && name.includes(": ") ? name.split(": ")[0] + ": " : null;
    if (type) for (const [other, a] of list) if (other !== id && a.name.startsWith(type)) list.delete(other);
    const entry = list.get(id) || { id, name, count: 0, where: [] };
    entry.count++;
    note(entry, where);
    list.set(id, entry);
  };
  // The source sometimes names the achievement instead of giving its id.
  const loseAchievement = (kind, id) => record[kind].delete(String(id)) || record[kind].delete(slug(id));
  const isNumber = v => /^\d+$/.test(String(v));
  const addDesign = (item, where) => {
    const name = isNumber(item) ? itemName(item) : String(item);
    const entry = record.designs.get(name) || { id: name, name, count: 1, where: [] };
    note(entry, where);
    record.designs.set(name, entry);
  };
  const classInfo = id => evRef?.classEvents?.[id];
  const classIdOf = name => Object.entries(evRef?.classes || {}).find(([, n]) => n.toLowerCase() === String(name).toLowerCase())?.[0];
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
    for (const id of r.lostPartyAchievements || []) loseAchievement("party", id);
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
        if (part.type === "itemDesign") addDesign(part.value, from);
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
      const id = kind === "classes" ? classIdOf(item.name) || slug(item.name)
               : kind === "designs" ? item.name : item.id || slug(item.name);
      const where = item.scenario != null ? `#${item.scenario}` : "added by hand";
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
                     found: record.found, claims: record.claims } };
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
  if (c?.type?.startsWith("pay")) return `did you pay${c.values?.length && typeof c.values[0] === "number" ? ` ${c.values[0]} gold` : ""}?`;
  if (c?.type === "reputationGT" || c?.type === "reputationLT") {
    return `it turns on ${describeCondition(c, evRef)}, and reputation then could have been ${rangeText(ctx.reputation)}. Which outcome was it?`;
  }
  return "which outcome was it?";
}

// Turn campaign.json's scenario entries plus the reference data into the full
// list of unlocked scenarios, each with a status and, if blocked, the reasons.
// eventUnlocks are scenarios unlocked by events: [{ number, source }].
function deriveScenarios(data, ref, eventUnlocks = [], evRef = null) {
  const entries = new Map(data.scenarios.map(s => [s.number, s]));
  const refOf = n => ref?.scenarios?.[String(n)];
  const done = data.scenarios.filter(s => s.status === "completed").map(s => s.number).sort((a, b) => a - b);
  const completed = new Set(done);

  // Which scenario unlocked each one. An unlockedBy in campaign.json wins.
  const parent = new Map();
  if (ref) parent.set(1, null);
  for (const c of done) {
    for (const u of refOf(c)?.unlocks || []) if (!parent.has(Number(u))) parent.set(Number(u), c);
  }
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

// --- Scenarios ----------------------------------------------------------------

const STATUS_LABELS = { available: "Available", completed: "Completed", blocked: "Blocked" };
const HEX_KIND = { available: "", completed: "completed", blocked: "blocked" };

// Phones get tabs and one-at-a-time views; wide screens get everything at once.
const phone = window.matchMedia("(max-width: 899px)");

let scenarioFilter = "all";
let scenarioOpen = null;     // the row opened in the list
let scenarioPicked = null;   // the scenario shown under the unlock map

// Remembered per browser. Until someone chooses, wide screens start on the
// unlock map and phones on the list.
let scenarioView = phone.matches ? "list" : "tree";
try {
  const saved = localStorage.getItem("scenarioView");
  if (saved === "list" || saved === "tree") scenarioView = saved;
} catch {}

function setScenarioView(data, view) {
  scenarioView = view;
  try { localStorage.setItem("scenarioView", view); } catch {}
  render(data, "scenarios");
}

// Bring a scenario into view, wherever it is currently drawn.
function revealScenario(number) {
  const shown = [...document.querySelectorAll(`[data-scenario="${number}"]`)].find(el => el.offsetParent !== null);
  shown?.scrollIntoView({ block: "center" });
}

// Jump to a scenario from elsewhere on the page (the "ready to play" cards).
let pendingScenario = null;
function openScenario(data, number) {
  scenarioFilter = "all";
  scenarioOpen = number;
  scenarioPicked = number;
  render(data, "scenarios");
  // The link's own navigation comes next; reveal the scenario once it has.
  if (location.hash === "#scenarios") requestAnimationFrame(() => revealScenario(number));
  else pendingScenario = number;
}

// The scenario the map starts on: the most recently completed one.
function defaultPick(all) {
  const dated = all.filter(s => s.completed).sort((a, b) => b.completed.localeCompare(a.completed) || b.number - a.number);
  return (dated[0] || all.find(s => s.status === "available") || all[0])?.number;
}

// Each scenario sits under the one that unlocked it. Returns the scenarios in
// tree order with their depth, plus a column and row for each on the map.
function treeLayout(all) {
  const numbers = new Set(all.map(s => s.number));
  const children = new Map();
  const roots = [];
  for (const s of all) {
    if (s.unlockedBy != null && numbers.has(s.unlockedBy) && s.unlockedBy !== s.number) {
      if (!children.has(s.unlockedBy)) children.set(s.unlockedBy, []);
      children.get(s.unlockedBy).push(s);
    } else {
      roots.push(s);
    }
  }

  const seen = new Set();
  const flat = [];
  const pos = new Map();
  let leaves = 0;
  let cols = 0;
  // A scenario with children sits level with the middle of them.
  const place = (s, depth) => {
    seen.add(s.number);
    flat.push({ s, depth });
    cols = Math.max(cols, depth + 1);
    const kids = [];
    for (const k of children.get(s.number) || []) {
      if (!seen.has(k.number)) kids.push({ number: k.number, row: place(k, depth + 1) });
    }
    const row = kids.length ? (kids[0].row + kids[kids.length - 1].row) / 2 : leaves++;
    pos.set(s.number, { col: depth, row, kids: kids.map(k => k.number) });
    return row;
  };
  for (const s of [...roots, ...all]) if (!seen.has(s.number)) place(s, 0);
  // For the indented rows: at each depth from 1 down to the row's own, whether
  // the line there carries on past this row, as a later sibling (of the row
  // itself, or of the ancestor at that depth) still follows.
  flat.forEach((f, i) => {
    f.lines = [];
    for (let k = 1; k <= f.depth; k++) {
      let j = i + 1;
      while (j < flat.length && flat[j].depth > k) j++;
      f.lines.push(j < flat.length && flat[j].depth === k);
    }
  });
  return { flat, pos, rows: leaves, cols };
}

function resultsList(results, sign = "") {
  return h("ul", { class: "results" }, results.map(r => h("li", {},
    h("strong", {}, r.character),
    r.xp != null ? h("span", { class: "num" }, `${sign}${r.xp} `, h("span", {}, "XP")) : null,
    r.gold != null ? h("span", { class: `num${sign ? " gain-gold" : ""}` }, `${sign}${r.gold} `, h("span", {}, "gold")) : null,
    sign ? null : h("span", { class: "marks" },
      r.checkmarks ? [gameIcon("checkmark", "Battle goal checkmarks"), String(r.checkmarks)] : null),
    r.notes ? h("span", { class: "extra" }, r.notes) : null)));
}

function scenarioFacts(data, s) {
  // For a scenario you could play, what it would be tonight.
  const t = s.status === "available" ? tonight(data) : null;
  const pairs = [
    ["Tonight", t ? `Scenario level ${t.level} (${t.difficulty.toLowerCase()}): monster level ${t.monsters}, ${t.gold} gold a coin, trap damage ${t.trap}, ${t.xp} bonus XP` : null],
    ["Unlocked by", s.unlockedBy != null ? scenarioLink(data, s.unlockedBy) : s.unlockedVia],
    ["Completed", formatDate(s.completed)],
    ["Also played", attemptsOf(data, s.number).map(a => `${a.failed ? "failed" : "replayed casually"} ${formatDate(a.date)}`).join("; ")],
    ["Rewards", s.rewards.length ? capitalize(s.rewards.join(", ")) : null],
    ["Treasure", data.treasureInfo?.get(s.number)?.join("; ")
      || (s.treasures?.length ? `${s.treasures.map(t => t.number || t).join(", ")} looted` : null)],
  ].filter(([, value]) => value);
  return pairs.length ? h("dl", { class: "facts" }, pairs.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))) : null;
}

// The times a scenario was played without completing it for the record: a
// failure, or a casual replay of one already completed. Oldest first.
function attemptsOf(data, n) {
  return data.sessions.filter(s => s.date).sort((a, b) => a.date.localeCompare(b.date))
    .flatMap(s => (s.scenarios || []).filter(x => x.number === n && (x.result !== "success" || x.casual))
      .map(x => ({ date: s.date, failed: x.result !== "success" })));
}

// "failed once (Nov 14)", "replayed twice (last Dec 2)": short, for a row.
function attemptsText(data, n) {
  const all = attemptsOf(data, n);
  const times = k => k === 1 ? "once" : k === 2 ? "twice" : `${k} times`;
  const when = list => {
    const d = formatDate(list.at(-1).date, { day: "numeric", month: "short" });
    return list.length > 1 ? ` (last ${d})` : ` (${d})`;
  };
  return [[all.filter(a => a.failed), "failed"], [all.filter(a => !a.failed), "replayed"]]
    .filter(([list]) => list.length).map(([list, what]) => `${what} ${times(list.length)}${when(list)}`).join(" · ");
}

// After playing a scenario that's open to play: record it, as a perk is.
function scenarioAction(data, s) {
  if (s.status !== "available" || !rawCampaign) return null;
  const inDraft = draft?.scenarios?.some(x => num(x.number) === s.number);
  return h("button", { type: "button", class: "todo-do scenario-record", "data-key": `record-sc-${s.number}`,
    onclick: () => recordScenario(data, s.number) }, inDraft ? "Go to it in the draft" : "Record it");
}

// How far each depth of the tree is indented, in pixels.
const TREE_STEP = 14;

// One scenario as a row that opens in place. depth indents it in the tree,
// and lines (from treeLayout) draws the tree's lines down its left.
function scenarioRow(data, s, depth = 0, lines = []) {
  const open = scenarioOpen === s.number;
  const blockedWhy = s.status === "blocked" && s.reasons.length ? s.reasons.join(" · ") : null;
  const tried = attemptsText(data, s.number);
  const meta = s.status === "completed"
    ? [formatDate(s.completed), s.treasures?.length ? `treasure ${s.treasures.map(t => t.number || t).join(", ")}` : null, tried || null].filter(Boolean).join(" · ")
    : s.status === "available"
      ? [s.unlockedBy != null ? `from #${s.unlockedBy}` : s.unlockedVia ? `from ${s.unlockedVia}` : null, tried || null].filter(Boolean).join(" · ")
      : "";
  // A line runs the full height of the row at each depth that carries on,
  // so siblings far apart are visibly joined; the row's own branch turns
  // off it to the hexagon, and ends there if nothing else follows.
  const elbow = depth ? h("span", { class: `elbow${lines[depth - 1] ? "" : " last"}`, "aria-hidden": "true" }) : null;
  if (elbow) elbow.style.width = `${depth * TREE_STEP}px`;
  const rails = lines.map((on, k) => {
    if (!on) return null;
    const rail = h("i", { class: "tree-rail", "aria-hidden": "true" });
    rail.style.left = `${(k + 1) * TREE_STEP - 2}px`;
    return rail;
  });

  const row = h("article", { class: `row${open ? " open" : ""}${depth ? " in-tree" : ""}`, id: `scenario-${s.number}`, "data-scenario": s.number },
    rails,
    h("button", {
        type: "button", class: "row-head", "data-key": `row-${s.number}`, "aria-expanded": String(open),
        onclick: () => { scenarioOpen = open ? null : s.number; scenarioPicked = s.number; render(data, "scenarios"); },
      },
      elbow,
      hex(s.number, HEX_KIND[s.status]),
      h("span", { class: "row-text" },
        h("span", { class: "row-name" }, s.name || "Untitled"),
        // The hexagon's look says completed or available; only a block, which
        // needs its reason, is written out. Screen readers get the word.
        h("span", { class: "row-meta" },
          s.status === "blocked" ? h("b", { class: "ink-blocked" }, blockedWhy || STATUS_LABELS.blocked)
            : h("span", { class: "sr-only" }, `${STATUS_LABELS[s.status] || s.status}${meta ? ", " : ""}`),
          s.status === "blocked" && meta ? ` · ${meta}` : meta)),
      icon("chevron")),
    open ? h("div", { class: "row-body" },
      scenarioFacts(data, s),
      scenarioAction(data, s),
      s.results?.length ? resultsList(s.results) : null,
      notes(s.notes)) : null);
  // An opened row's details start clear of the tree's lines.
  if (depth) row.style.setProperty("--indent", `${depth * TREE_STEP}px`);
  return row;
}

// The unlock map for wide screens: scenarios laid out left to right, with the
// picked one described underneath.
function unlockMap(data, all, layout) {
  const W = 160, H = 48, GAP = 28, ROW = 64, T = 2;   // W matches .node in styles.css
  const x = n => layout.pos.get(n).col * (W + GAP);
  const y = n => Math.round(layout.pos.get(n).row * ROW);

  const lines = [];
  const line = (left, top, width, height) => {
    const el = h("i", { "aria-hidden": "true" });
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    lines.push(el);
  };
  for (const [number, { kids }] of layout.pos) {
    if (!kids.length) continue;
    const mid = y(number) + H / 2 - T / 2;
    const elbow = x(number) + W + GAP / 2;
    const ys = kids.map(k => y(k) + H / 2 - T / 2);
    const top = Math.min(mid, ...ys);
    const bottom = Math.max(mid, ...ys);
    line(x(number) + W, mid, GAP / 2, T);
    if (bottom > top) line(elbow - T / 2, top, T, bottom - top + T);
    for (const ky of ys) line(elbow, ky, GAP / 2, T);
  }

  // In tree order, so Tab walks down each branch rather than by number.
  const nodes = layout.flat.map(({ s }) => {
    const node = h("button", {
        type: "button", class: `node ${s.status}`, "data-key": `node-${s.number}`, "data-scenario": s.number,
        "aria-pressed": String(s.number === scenarioPicked),
        onclick: () => { scenarioPicked = s.number; render(data, "scenarios"); },
      },
      hex(s.number, HEX_KIND[s.status]),
      h("span", {}, s.name || "Untitled"),
      s.status === "completed" ? h("span", { class: "ink-completed" }, icon("check", "Completed")) : null,
      s.status === "blocked" ? h("span", { class: "ink-blocked" }, icon("lock", "Blocked")) : null);
    Object.assign(node.style, { left: `${x(s.number)}px`, top: `${y(s.number)}px` });
    return node;
  });

  const canvas = h("div", { class: "map-canvas" }, lines, nodes);
  Object.assign(canvas.style, {
    width: `${layout.cols * (W + GAP) - GAP}px`,
    height: `${Math.max(1, layout.rows) * ROW - (ROW - H)}px`,
  });

  const s = all.find(sc => sc.number === scenarioPicked);
  return h("div", { class: "map" },
    h("div", { class: "map-scroll" }, canvas),
    s ? h("div", { class: "map-detail" },
      h("div", {},
        h("div", { class: "detail-head" },
          hex(s.number, HEX_KIND[s.status]),
          h("div", {},
            h("h3", {}, s.name || "Untitled"),
            h("p", {}, h("b", { class: `ink-${s.status}` }, STATUS_LABELS[s.status] || s.status),
              s.status === "available" ? " · ready to play" : null))),
        s.reasons.length ? h("div", { class: "reasons" }, s.reasons.map(r => h("span", {}, r))) : null,
        scenarioFacts(data, s), scenarioAction(data, s)),
      s.results?.length ? h("div", {}, h("span", { class: "label" }, "What each character took home"), resultsList(s.results)) : null,
      s.notes ? h("div", {}, h("span", { class: "label" }, "Notes"), notes(s.notes)) : null) : null);
}

function renderScenarios(data) {
  const all = [...data.scenarios].sort((a, b) => a.number - b.number);
  if (!all.length) return [sectionHead("Scenarios"), empty("No scenarios recorded yet.")];
  if (!all.some(s => s.number === scenarioPicked)) scenarioPicked = defaultPick(all);

  const counts = { all: all.length };
  for (const s of all) counts[s.status] = (counts[s.status] || 0) + 1;

  const head = h("div", { class: "section-head" },
    h("h2", {}, "Scenarios"),
    h("div", { class: "segmented", role: "group", "aria-label": "Scenario view" },
      [["list", "List"], ["tree", "Unlock tree"]].map(([view, label]) =>
        h("button", {
          type: "button", "data-key": `view-${view}`,
          "aria-pressed": String(scenarioView === view),
          onclick: () => setScenarioView(data, view),
        }, label))));

  if (scenarioView === "tree") {
    const layout = treeLayout(all);
    return [
      head,
      h("p", { class: "sr-only" }, "Each scenario sits under the one that unlocked it."),
      h("div", { class: "legend" },
        counts.available ? h("span", {}, h("i", { "aria-hidden": "true" }), `${counts.available} available`) : null,
        counts.completed ? h("span", {}, h("span", { class: "ink-completed" }, icon("check")), `${counts.completed} completed`) : null,
        counts.blocked ? h("span", {}, h("span", { class: "ink-blocked" }, icon("lock")), `${counts.blocked} blocked`) : null),
      unlockMap(data, all, layout),
      h("div", { class: "scenario-list tree-rows" }, layout.flat.map(({ s, depth, lines }) => scenarioRow(data, s, depth, lines))),
    ];
  }

  const filters = h("div", { class: "filters", role: "group", "aria-label": "Filter scenarios" },
    ["all", "available", "completed", "blocked"].filter(f => counts[f]).map(f =>
      h("button", {
        type: "button", "data-key": `filter-${f}`,
        "aria-pressed": String(scenarioFilter === f),
        onclick: () => { scenarioFilter = f; render(data, "scenarios"); },
      }, f === "all" ? "All" : STATUS_LABELS[f], h("span", {}, counts[f]))));

  const shown = all.filter(s => scenarioFilter === "all" || s.status === scenarioFilter);
  return [head, filters, h("div", { class: "scenario-list" }, shown.map(s => scenarioRow(data, s)))];
}

// --- Character checks -------------------------------------------------------------
// data/gloomhaven-events.json lists each class's perks as the character sheet
// words them, with how many boxes each has; data/gloomhaven-items.json gives
// each item's slot. A character's perks are matched against the class's list
// and what they carry against the slots they have.

let classRef = null;   // data/gloomhaven-events.json, once loaded

// A class's id in the reference data: its name, or for a locked class the
// spoiler-free name of its icon.
function classId(cls) {
  return Object.entries(classRef?.classes || {}).find(([, n]) => n.toLowerCase() === String(cls).toLowerCase())?.[0] || null;
}

function classPerks(cls) {
  const id = classId(cls);
  return id ? classRef.classEvents?.[id]?.perks || null : null;
}

// A locked class goes by its icon, so naming it spoils nothing.
const CLASS_ICON_NAMES = { "squidface": "squid face", "two-mini": "two minis" };
function classIconName(id) { return CLASS_ICON_NAMES[id] || id.replace(/-/g, " "); }

function classIcon(cls) {
  const id = classId(cls);
  return id ? gameIcon(`class-${id}`) : null;
}

// Perk text with each keyword shown as the game's icon instead of the word,
// as on the character sheet: "Add one [rolling] [earth] card". The word
// becomes the icon's alt text (and hover title), so a screen reader still
// reads "Add one rolling earth card". Icons: icons/README.md (Creator Pack,
// CC BY-NC-SA 4.0).
const PERK_ICONS = {
  "ADD TARGET": "target", EARTH: "earth", AIR: "air", FIRE: "fire", ICE: "ice", LIGHT: "light", DARK: "dark",
  STUN: "stun", MUDDLE: "muddle", IMMOBILIZE: "immobilize", WOUND: "wound", POISON: "poison", CURSE: "curse",
  DISARM: "disarm", INVISIBLE: "invisible", PIERCE: "pierce", PUSH: "push", PULL: "pull",
  SHIELD: "shield", HEAL: "heal", REFRESH: "refresh",
  rolling: "rolling",   // the only lower-case one, as the sheets write it
};
const PERK_KEYWORD = new RegExp(`\\b(${Object.keys(PERK_ICONS).join("|")})\\b`, "g");

function perkText(text) {
  // Once the icon stands in for REFRESH, the rest needn't shout.
  const plain = String(text).replace(/\bREFRESH AN ITEM\b/g, "REFRESH an item");
  return plain.split(PERK_KEYWORD).map((part, i) => {
    if (i % 2 === 0) return part;
    const word = part.toLowerCase();
    return h("img", { class: "glyph", src: `icons/${PERK_ICONS[part]}.svg`, alt: word, title: word, width: 16, height: 16 });
  });
}

const NUMBER_WORDS = { "1": "one", "2": "two", "3": "three", "4": "four" };

// How a perk reads with the wording differences that don't matter taken out.
// strict keeps "rolling" and "+0"; loose drops them too.
function perkKey(text, loose = false) {
  let t = String(text).toLowerCase().replace(/[−–]/g, "-").replace(/\([^)]*\)/g, " ")
    .replace(/(^|\s)([1-4])(?=\s|$)/g, (m, pre, d) => pre + NUMBER_WORDS[d])
    .replace(/\bcards?\b/g, " ").replace(/[^a-z0-9+\- ]/g, " ");
  if (loose) t = t.replace(/\brolling\b/g, " ").replace(/(^|\s)\+0(?=\s|$)/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

// The class perk a written perk is, or null. Strict match first, then loose
// if that points at exactly one perk.
function matchPerk(text, perks) {
  const strict = perks.find(p => perkKey(p.text) === perkKey(text));
  if (strict) return strict;
  const loose = perks.filter(p => perkKey(p.text, true) === perkKey(text, true));
  return loose.length === 1 ? loose[0] : null;
}

// The class perk sharing the most telling words with a written one, for a
// hint. "Add", "with" and the counts say little about which perk it is.
const PLAIN_WORDS = new Set(["add", "remove", "replace", "with", "and", "one", "two", "three", "four"]);
function closestPerk(text, perks) {
  const telling = t => perkKey(t, true).split(" ").filter(w => w && !PLAIN_WORDS.has(w));
  const words = new Set(telling(text));
  let best = null, score = 0;
  for (const p of perks) {
    const theirs = telling(p.text);
    const shared = theirs.filter(w => words.has(w)).length / (new Set([...words, ...theirs]).size || 1);
    if (shared > score) { best = p; score = shared; }
  }
  return score >= 0.3 ? best : null;
}

// A perk's boxes as on the character sheet: the ticked ones filled, the
// rest empty. A lone ticked box says nothing a screen reader needs.
function perkBoxes(ticked, empty) {
  const total = ticked + empty;
  const box = on => h("i", { class: on ? "perk-box" : "perk-box unticked" });
  return h("span", total > 1 ? { class: "perk-boxes", role: "img", "aria-label": `${ticked} of ${total} boxes ticked` }
                             : { class: "perk-boxes", "aria-hidden": "true" },
    Array.from({ length: total }, (_, i) => box(i < ticked)));
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
    } else if (r.written !== r.match.text) {
      r.note = `Written as "${r.written}".`;
      r.quiet = true;
    }
  }
  const open = (perks || []).map(p => ({ ...p, left: p.count - (rows.find(r => r.match === p)?.count || 0) }))
    .filter(p => p.left > 0);
  return { known: Boolean(perks), rows, open };
}

// Slots: one head, body and legs item; two hands (a two-handed item takes
// both); small items up to half the character's level, rounded up.
// What a character's items take up, and the room they have at their level.
function slotUse(c, level) {
  const byName = new Map(Object.values(itemsRef?.items || {}).map(i => [i.name.toLowerCase(), i]));
  const used = { head: 0, body: 0, legs: 0, hands: 0, small: 0 };
  for (const name of c.items) {
    const slot = byName.get(name.toLowerCase())?.slot;
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

// --- Characters -----------------------------------------------------------------

let characterIndex = 0;   // which sheet a phone shows

function pickCharacter(data, index) {
  characterIndex = index;
  render(data, "characters");
}

// A phone at the table belongs to one player. The first time, it asks which
// character they play, and from then on opens on that sheet. Kept in this
// browser only: a name, or "" for "just looking"; nothing yet means ask.
// What this browser keeps is kept per campaign file: the sample campaign
// (?data=...) doesn't share a character choice or a draft with the real one.
function storeKey(name) {
  return new URLSearchParams(location.search).get("data") ? `${name}:${dataUrl().pathname}` : name;
}
const ME_KEY = storeKey("myCharacter");
let me = null;
try { me = localStorage.getItem(ME_KEY); } catch {}

function chooseMe(data, name) {
  me = name;
  shopFor = undefined;   // the Shop follows this phone's character again
  try { localStorage.setItem(ME_KEY, name); } catch {}
  const index = characterOrder(data).findIndex(c => c.name === name);
  if (index >= 0) characterIndex = index;
  render(data, "characters");
  render(data, "shop");
  myTab(data);
  if (!name) return;
  // To their sheet; hashchange does the rest, unless it's already showing.
  if (location.hash === "#characters") window.scrollTo({ top: 0, behavior: "instant" });
  else location.hash = "characters";
}

// The question, as a sheet over the page. Escape puts it off until next time.
function askWho(data) {
  const active = characterOrder(data).filter(c => !c.retired);
  if (!active.length || document.querySelector("dialog.who[open]")) return;
  document.querySelector("dialog.who")?.remove();
  // Removed at once: the close event can come late, and a closed sheet left
  // in the page would stop Change from asking again.
  const answer = name => () => { dialog.close(); dialog.remove(); chooseMe(data, name); };
  const dialog = h("dialog", { class: "who", "aria-labelledby": "who-title", onclose: () => dialog.remove() },
    h("h2", { id: "who-title" }, "Who are you playing?"),
    h("p", {}, "This phone will open on their sheet. You can change it at the bottom of the sheet."),
    h("div", { class: "who-list" }, active.map(c =>
      h("button", { type: "button", class: "who-row", "aria-label": `${c.name}, level ${characterStats(c).level} ${c.class}`, onclick: answer(c.name) },
        // The frame the Play tab will show once they're picked.
        classHex(c.class),
        h("span", { class: "party-who" }, h("strong", {}, c.name), h("span", {}, `Level ${characterStats(c).level} ${c.class}`))))),
    h("button", { type: "button", class: "btn quiet", onclick: answer("") }, "Just looking"));
  document.body.append(dialog);
  dialog.showModal();
}

// Under the sheet (phones): a way to change who this phone opens on. The
// "You" in the row of characters already says who that is.
function meLine(data) {
  const mine = data.characters.find(c => !c.retired && c.name === me);
  return h("p", { class: "me-line" },
    h("span", {}, mine ? `Not ${mine.name}?` : "This phone opens on Tonight."),
    h("button", { type: "button", "data-key": "me-change", onclick: () => askWho(data) },
      mine ? "Change who this phone opens on" : "Pick your character"));
}

// The bottom tab shows this phone's character, as it's their home. Phones
// only (styles.css); the words "Characters" stay for wide screens.
function myTab(data) {
  const a = document.querySelector('.tabs a[data-tab="play"]');
  if (!a) return;
  a.querySelector(".tab-me")?.remove();
  const mine = data.characters.find(c => !c.retired && c.name === me);
  a.classList.toggle("mine", Boolean(mine));
  if (mine) a.append(h("span", { class: "tab-me" }, classHex(mine.class), h("span", {}, mine.name)));
}

// A class icon, small inside a thin hexagon, like the tabs' outline icons:
// the class icon alone is a solid shape, far heavier.
function classHex(cls) {
  return h("span", { class: "class-hex" },
    svg("0 0 24 24", '<path d="M12 2.6l8.2 4.7v9.4L12 21.4l-8.2-4.7V7.3z"/>', { "aria-hidden": "true" }), classIcon(cls));
}

// Battle-goal checkmarks, drawn as on the character sheet: six groups of
// three, each full group being a perk.
// A full group carries the game's checkmark: the perk it earned. The count
// is said in words to screen readers only, as the boxes show it.
function goalBoxes(checkmarks) {
  const perks = perksFromCheckmarks(checkmarks);
  return h("div", { class: "goals", role: "img", "aria-label": `${plural(checkmarks, "checkmark")}, ${plural(perks, "perk")} earned` },
    Array.from({ length: 6 }, (_, g) => {
      const full = (g + 1) * 3 <= checkmarks;
      return h("span", { class: full ? "full" : null },
        Array.from({ length: 3 }, (_, b) => h("i", { class: g * 3 + b < checkmarks ? "on" : null })),
        full ? gameIcon("checkmark") : null);
    }));
}

// What a modifier card does, for its colour: Null and the 2×, worse or
// better than +0, or +0 (an element or effect on a +0 is still +0).
function cardKind(label) {
  if (label === "Null") return "null";
  if (label === "2×") return "crit";
  const n = /^([+−])(\d)/.exec(label);
  if (!n || n[2] === "0") return "zero";
  return n[1] === "−" ? "bad" : "good";
}

// The deck as counts, with the perks' icons; any perk it couldn't read is
// listed, so nothing is silently left out.
function attackDeckBlock(c, rows) {
  const sheet = classPerks(c.class);
  const inOrder = [...rows].sort((a, b) => (a.match ? sheet.indexOf(a.match) : sheet.length) - (b.match ? sheet.indexOf(b.match) : sheet.length));
  const { cards, total, unread } = attackDeck(inOrder.flatMap(r => Array(r.count).fill(r.match ? r.match.text : r.written)));
  // Sanctuary blessings in the session being recorded: for the next scenario.
  const blessed = c.blessNext || (draft?.donations || []).some(x => x.character === c.name);
  // Worst to best, a segment per card, so a deck's quality reads at a glance
  // and decks compare side by side. The chips under it are its legend.
  const KINDS = ["null", "bad", "zero", "good", "crit", "bless"];
  const segments = [...cards.flatMap(([label, n]) => Array(n).fill(cardKind(label))), ...(blessed ? ["bless", "bless"] : [])]
    .sort((a, b) => KINDS.indexOf(a) - KINDS.indexOf(b));
  const tally = k => segments.filter(x => k.includes(x)).length;
  return h("div", { class: "block deck-block" },
    h("div", { class: "block-head" }, h("h4", { class: "label" }, "Attack modifier deck"),
      h("span", {}, `${total} cards${blessed ? " + 2 Bless" : ""}`)),
    h("div", { class: "deck-bar", role: "img",
               "aria-label": `${tally(["null", "bad"])} below +0, ${tally(["zero"])} at +0, ${tally(["good", "crit", "bless"])} above` },
      segments.map(k => h("i", { class: `k-${k}` }))),
    // Worst to best, the bad cards quieter; each count in a badge of its own,
    // so the 2× card doesn't read "2× ×1".
    h("ul", { class: "deck-cards" }, cards.map(([label, n]) => h("li", { class: { null: "bad", bad: "bad", good: "good", crit: "good" }[cardKind(label)] || null },
        h("i", { class: `swatch k-${cardKind(label)}`, "aria-hidden": "true" }),
        h("span", {}, perkText(label)), h("span", { class: "sr-only" }, ", "), h("b", { role: "img", "aria-label": plural(n, "card") }, String(n)))),
      blessed ? h("li", { class: "bless", title: "From a Sanctuary donation, for the next scenario only" },
        h("i", { class: "swatch k-bless", "aria-hidden": "true" }),
        h("span", {}, "Bless"), h("span", { class: "sr-only" }, ", "), h("b", { role: "img", "aria-label": "2 cards, next scenario only" }, "2")) : null),
    unread.length ? h("p", { class: "small muted" }, `Not counted, as written: ${unread.join("; ")}`) : null);
}

// Personal quest progress written as "2/15" gets a thin bar under it, one
// per step for a quest in steps, each as long as its target; any other
// wording ("2? (noted as II)") stays as written, with no bar.
function questMeter(text) {
  const steps = questSteps(text);
  if (!steps) return null;
  return h("div", { class: "quest-meter" }, steps.map(([n, m]) => {
    const bar = meter(Math.min(1, n / m));
    bar.style.flexGrow = m;
    return bar;
  }));
}

// The personal quest on a sheet: hidden behind a tap while it's a secret.
function questStat(data, c) {
  const open = c.retired || questDone(c.personalQuest);
  const shown = open || questShown.has(c.name);
  const value = [h("span", { class: "quest" }, c.personalQuest || "Not recorded"), questMeter(c.personalQuest)];
  return h("div", { class: "quest-stat" },
    h("span", { class: "label" }, "Personal quest"),
    open ? value : h("button", {
        type: "button", class: `quest-reveal${shown ? " shown" : ""}`, "data-key": `pq-show-${c.name}`,
        "aria-expanded": String(shown), "aria-label": shown ? null : `Show ${c.name}'s personal quest progress`,
        title: shown ? "Tap to hide" : null,
        onclick: () => { toggleQuest(c.name); render(data, "characters"); render(data, "sessions"); },
      },
      shown ? value : h("span", { class: "quest quest-hidden" }, icon("eye"), "Show")));
}

function toggleQuest(name) {
  if (questShown.has(name)) questShown.delete(name); else questShown.add(name);
}

let questRef = null;   // data/gloomhaven-quests.json, once loaded

// Which quest card a character holds is kept on their player's phone only:
// campaign.json is public, and the quest is a secret until it's done.
const questCardKey = name => storeKey(`questCard:${name}`);
function questCard(name) {
  try { return localStorage.getItem(questCardKey(name)) || null; } catch { return null; }
}
function setQuestCard(name, card) {
  try { if (card) localStorage.setItem(questCardKey(name), card); else localStorage.removeItem(questCardKey(name)); } catch {}
}

// Who completed each scenario, as far as campaign.json says: its results,
// its players, and who was there in a session it was won in, casual mode
// included (rulebook p. 34: casual play makes quest progress). null when
// nothing records who played.
const completedByCache = new WeakMap();
function completedBy(data) {
  if (completedByCache.has(data)) return completedByCache.get(data);
  const who = new Map();
  completedByCache.set(data, who);
  for (const s of data.scenarios.filter(s => s.status === "completed")) {
    who.set(s.number, new Set([...(s.results || []).map(r => r.character), ...(s.players || [])]));
  }
  for (const session of data.sessions) {
    for (const x of session.scenarios || []) {
      if (x.result !== "success") continue;
      if (!who.has(x.number)) who.set(x.number, new Set());
      for (const n of session.characters || []) who.get(x.number).add(n);
    }
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
    const out = { text: step.text, count: step.count, after: Boolean(step.after), n: null, auto: true, maybe: [], opens: null };
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
      const fromGoals = [...data.scenarios.flatMap(s => s.results || []), ...data.sessions.flatMap(x => (x.scenarios || []).flatMap(sc => sc.results || []))]
        .filter(r => r.character === c.name).reduce((sum, r) => sum + (r.checkmarks || 0), 0);
      out.n = fromGoals;
      out.extra = Math.max(0, (c.checkmarks || 0) - fromGoals);
      out.extraWhy = "if the sheet's other checkmarks came from battle goals";
    }
    else if (kind === "gold") out.n = c.gold || 0;
    else if (kind === "itemType") out.n = c.items.filter(i => arg.split("|").includes(itemSlot(i))).length;
    else if (kind === "item") {
      const name = itemsRef?.items?.[arg]?.name;
      out.n = c.items.some(i => name && i.toLowerCase() === name.toLowerCase()) ? 1 : 0;
    } else {
      out.auto = false;
      if (sameShape) out.n = recorded[i][0];
    }
    if (!ready) { out.n = out.auto || out.n == null ? 0 : out.n; out.maybe = []; out.extra = 0; }
    if (out.n != null) out.n = Math.min(out.n, step.count);
    steps.push(out);
  });
  // Written out, only when every step is known for certain.
  const text = steps.every(x => x.n != null && !x.maybe.length && !x.extra)
    ? steps.map((x, i) => `${i ? (x.after ? ", then " : " + ") : ""}${x.n}/${x.count}`).join("") : null;
  // A recorded count agrees when each step is between what's counted and
  // that plus the scenarios no one recorded playing.
  const fits = written => {
    const r = questSteps(written);
    return Boolean(r) && r.length === steps.length && r.every(([n, m], i) => m === steps[i].count && steps[i].n != null
      && n >= steps[i].n && n <= Math.min(steps[i].count, steps[i].n + steps[i].maybe.length + (steps[i].extra || 0)));
  };
  const known = steps.every(x => x.n != null);
  return { name: quest.name, card, steps, text, known, fits, unlockClass: quest.unlockClass, openEnvelope: quest.openEnvelope };
}

// Below a sheet's stats, once its quest is shown: which card it is (on this
// phone only), each step as the record counts it, and a way to put the
// count right.
function questDetail(data, c) {
  if (c.retired || !questRef || !questShown.has(c.name) && !questDone(c.personalQuest)) return null;
  const card = questCard(c.name);
  const pick = h("select", { "data-key": `pq-card-${c.name}`, "aria-label": `${c.name}'s personal quest card`,
      onchange: e => { setQuestCard(c.name, e.target.value); render(data); } },
    h("option", { value: "" }, card ? "Forget it on this phone" : "Which card? Kept on this phone only"),
    Object.entries(questRef.quests).map(([id, q]) => {
      const o = h("option", { value: id }, `${id} ${q.name}`);
      if (id === card) o.selected = true;
      return o;
    }));
  const p = card ? questProgress(data, c, card) : null;
  const pending = draft?.quests?.[c.name];
  const differs = p?.known && !p.fits(pending || c.personalQuest);
  return h("div", { class: "block quest-detail" },
    h("div", { class: "block-head" }, h("span", { class: "label" }, "Quest card"), pick),
    p ? h("ul", { class: "quest-steps" }, p.steps.map(x => h("li", {},
      h("span", { class: "quest-step-text" }, x.after ? h("span", { class: "then" }, "then ") : null, x.text,
        h("span", { class: "sub" }, [
          x.auto ? "counted from the record" : "as recorded by hand",
          x.maybe.length ? `${plural(x.maybe.length, "more")} if they played ${x.maybe.map(n => `#${n}`).join(", ")}` : null,
          x.extra ? `up to ${x.extra} more, ${x.extraWhy}` : null,
          x.opens && !data.scenarios.some(s => s.number === x.opens) ? `opens #${x.opens} ${scenarioRef?.scenarios?.[String(x.opens)]?.name || ""}`.trim() : null,
        ].filter(Boolean).join(" · "))),
      h("span", { class: "num" }, x.n == null ? `?/${x.count}` : `${x.n}/${x.count}`)))) : null,
    p && !p.known ? h("p", { class: "small muted" }, "Some steps can't be counted from the record: write the quest as one count per step (like 1/3 + 0/1) to fill them in.") : null,
    differs && !p.text ? h("p", { class: "small muted" }, `The record says ${pending || c.personalQuest || "nothing"}, which doesn't fit the count above.`) : null,
    differs && p.text && rawCampaign ? h("button", { type: "button", class: "todo-do", "data-key": `pq-use-${c.name}`,
        onclick: () => { if (!draft) draft = newDraft(data); draft.quests[c.name] = p.text; showInRecorder(data, `pq-${c.name}`); } },
      `Record ${p.text}`) : null,
    pending ? h("p", { class: "small muted" }, `${pending} is in the session being recorded.`) : null);
}

function renderCharacters(data) {
  if (!data.characters.length) return [h("div", { class: "keep-head" }, sectionHead("Characters")),
    h("div", { class: "empty" }, h("p", {}, "No characters yet."),
      rawCampaign ? h("button", { type: "button", class: "btn primary", "data-key": "add-first", onclick: () => addNewcomer(data) }, "Add the party's characters") : null)];

  const order = characterOrder(data);
  if (characterIndex >= order.length) characterIndex = 0;

  const card = c => {
    const st = characterStats(c);
    // The same perk taken twice shows once, with a count.
    const check = perkCheck(c);
    // While a perk waits to be chosen, the whole class list in the sheet's
    // order, taken boxes filled and untaken perks quiet, as the paper sheet
    // reads; otherwise just the perks taken. Perks not on the sheet come last.
    const choosing = st.unspent && check.known && !c.retired;
    const taken = r => ({ text: r.text, count: r.count, total: r.match ? r.match.count : r.count, note: r.note, quiet: r.quiet });
    const perks = choosing
      ? [...classPerks(c.class).map(p => {
          const row = check.rows.find(r => r.match === p);
          return row ? taken(row) : { text: p.text, count: 0, total: p.count, open: true };
        }), ...check.rows.filter(r => !r.match).map(taken)]
      : check.rows.map(taken);
    const itemProblems = itemCheck(c, st.level);
    return h("article", { class: `char-card${order.indexOf(c) === characterIndex ? " current" : ""}${c.inactive && !c.retired ? " inactive" : ""}`, "data-char": c.name },
      h("header", { class: "char-head" },
        h("div", { class: "char-level" }, hex(st.level, "level"), h("span", { class: "label" }, "Level")),
        h("div", {},
          h("h3", { class: Math.max(...c.name.split(/\s+/).map(w => w.length)) > 9 ? "long" : null }, c.name),
          h("p", {}, classIcon(c.class), [c.class, c.retired ? "retired" : c.inactive ? "inactive" : null].filter(Boolean).join(" · ")))),
      h("div", { class: "block" },
        h("div", { class: "block-head" },
          h("span", { class: "xp-now num" }, `${c.xp} XP`),
          h("span", { class: `xp-next${st.close && !c.retired ? " close" : ""}` }, c.retired ? "Retired" : st.nextText)),
        meter(st.toNext ? st.toNext.fraction : 1, st.close),
      ),
      c.retired ? null : lastLevelUps(data).filter(u => u.character === c.name).map(u =>
        nudge("plus", `Reached level ${u.level} last session`, `Add an ability card of level ${u.level} or lower.`)),
      h("div", { class: "char-stats" },
        h("div", {}, h("span", { class: "label" }, "Gold"), h("span", { class: "gold num" }, c.gold)),
        // Shown from the start, so a new character can pick their card.
        c.personalQuest || questCard(c.name) || (questRef && !c.retired) ? questStat(data, c) : null),
      questDetail(data, c),
      // A fulfilled quest: they retire before playing again (p. 48).
      !c.retired && questDone(c.personalQuest)
        ? (draft?.retirements?.some(x => x.character === c.name)
            ? nudge("check", "Retiring", "In the session being recorded; it counts once that's saved.", "saved")
            : rawCampaign
              ? h("button", { type: "button", class: "nudge perk-nudge", "data-key": `retire-record-${c.name}`, onclick: () => recordRetire(data, c.name) },
                  icon("lock"), h("span", {}, "Quest fulfilled: retire before playing again"), h("span", { class: "nudge-go" }, "Record it"))
              : nudge("lock", "Quest fulfilled: retire before playing again", null, "perk-nudge"))
        : null,
      // A retirement whose quest opened a box already open: what's left to draw.
      c.retired && c.questDraws && (!c.questDraws.itemDesign || !c.questDraws.scenario)
        ? nudge("question", "Still to draw", capitalize([!c.questDraws.itemDesign ? "a random item design" : null,
            !c.questDraws.scenario ? "a random side scenario" : null].filter(Boolean).join(" and ")) + ", for their personal quest.")
        : null,
      h("div", { class: "block goal-block" },
        h("div", { class: "block-head" },
          h("h4", { class: "label" }, "Battle goals")),
        goalBoxes(c.checkmarks)),
      h("div", { class: "block perk-block", style: `--boxes: ${Math.max(2, ...perks.map(p => Math.max(p.count, p.total)))}` },
        h("div", { class: "block-head" },
          h("h4", { class: "label" }, "Perks"),
        ),
        // Records the perk straight from the sheet, as "Before you play" does.
        // A retired sheet asks for nothing.
        perksLeft(c) && !c.retired ? (rawCampaign
          ? h("button", { type: "button", class: "nudge perk-nudge", "data-key": `perk-record-${c.name}`, onclick: () => recordPerk(data, c.name) },
              icon("plus"), h("span", {}, `${plural(perksLeft(c), "perk")} to choose`), h("span", { class: "nudge-go" }, "Record it"))
          : nudge("plus", `${plural(perksLeft(c), "perk")} to choose`, null, "perk-nudge"))
          : draftedPerks(c.name) && st.unspent
            ? nudge("check", `${draftedPerks(c.name) === 1 ? "Perk" : "Perks"} picked`, "In the session being recorded; it counts once that's saved.", "saved")
            : null,
        perks.length
          ? h("ul", { class: "perks" }, perks.map(p => {
              const unsure = p.note && !p.quiet;
              return h("li", { class: unsure ? "unsure" : p.open ? "open" : null },
                // Its boxes, as ticked on the sheet; the game's checkmark is
                // kept for battle goals, so the card shows only one kind of tick.
                unsure ? icon("question") : perkBoxes(p.count, Math.max(0, p.total - p.count)),
                h("span", { class: "perk-text" }, perkText(p.text), p.note ? h("span", { class: "note" }, p.note) : null),
                unsure && p.count > 1 ? h("span", { class: "times" }, `×${p.count}`) : null);
            }))
          : h("span", { class: "small muted" }, st.earned ? "None taken yet."
              // Only a level 1 character with under 3 checkmarks has none earned.
              : `None yet: the first comes at level 2, or with ${plural(3 - c.checkmarks % 3, "more battle-goal checkmark")}.`)),
      // The attack modifier deck those perks make, to build at the table.
      // Phones: the ability cards in hand, discarded and lost.
      c.retired ? null : cardBlock(c),
      attackDeckBlock(c, check.rows),
      // Phones: the conditions on them in the scenario being played.
      c.retired ? null : condBlock(c),
      // Items as a plain list, each with its slot: they aren't buttons.
      c.items.length ? h("div", { class: `block item-block${c.retired ? "" : " tracking"}` },
        h("div", { class: "block-head" }, h("h4", { class: "label" }, "Items"), slotStrip(c, st.level)),
        itemProblems.map(text => nudge("question", "More than can be equipped", text, "note")),
        h("ul", { class: "item-list" }, c.items.map(i => {
          const slot = itemSlot(i);
          return h("li", {}, slot ? gameIcon(`slot-${slot}`) : h("span", { class: "slot-blank", "aria-hidden": "true" }), i);
        })),
        // Phones: the same items, to mark as used at the table.
        c.retired ? null : itemTrack(c)) : null,
      c.notes ? h("div", { class: "block char-notes" }, h("h4", { class: "label" }, "Notes"), notes(c.notes)) : null,
      // Last, so it docks at the foot of the screen from the top of the sheet.
      c.retired ? null : tableDock(c));
  };

  const active = order.filter(playable);
  const inactive = order.filter(c => !c.retired && c.inactive);
  const retired = order.filter(c => c.retired);

  // Phones show one sheet at a time, chosen from this row.
  // With a big party it scrolls sideways rather than squeezing the names;
  // inactive and then retired characters come last, each after a divider,
  // dimmed.
  const group = c => c.retired ? 2 : c.inactive ? 1 : 0;
  const shownInactive = inactive.filter(c => !hiddenAway(c, order.indexOf(c) === characterIndex));
  const switcher = h("div", { class: "char-switch", role: "group", "aria-label": "Choose a character" },
    order.map((c, i) => {
      if (hiddenAway(c, i === characterIndex)) return null;
      const st = characterStats(c);
      const mine = !c.retired && c.name === me;
      const state = c.retired ? "retired" : c.inactive ? "inactive" : null;
      const before = order.slice(0, i).filter((x, k) => !hiddenAway(x, k === characterIndex)).at(-1);
      return [before && group(c) !== group(before) ? h("span", { class: "switch-sep", "aria-hidden": "true" }) : null,
        h("button", {
          type: "button", "data-key": `char-${i}`, class: state,
          "aria-pressed": String(i === characterIndex),
          "aria-label": [c.name, `level ${st.level}`, state || (mine ? "you" : null),
            playable(c) && questDone(c.personalQuest) ? "must retire" : playable(c) && perksLeft(c) ? "has a perk to choose" : null].filter(Boolean).join(", "),
          onclick: () => pickCharacter(data, i),
        },
        h("span", {}, hex(st.level, "quiet"),
          playable(c) && (perksLeft(c) || questDone(c.personalQuest))
            ? h("span", { class: "dot", role: "img", "aria-label": questDone(c.personalQuest) ? "Must retire" : "Has a perk to choose" }) : null),
        h("span", { class: "switch-name" }, c.name),
        mine ? h("span", { class: "you", "aria-hidden": "true" }, "You") : null)];
    }),
    inactiveToggle(data, inactive.length - shownInactive.length, "switch-inactive"));

  return [
    sectionHead("Characters", [[`${active.length} active`, retired.length ? `${retired.length} retired` : null].filter(Boolean).join(" · "),
                               inactiveToggle(data, inactive.length, "chars-inactive")]),
    switcher,
    // Inactive sheets, once shown, follow the active ones in the same grid
    // (dashed, and "inactive" under the name), filling the gaps.
    active.length ? h("div", { class: "char-grid" }, [...active, ...shownInactive].map(card))
      : [empty("No active characters."), shownInactive.length ? h("div", { class: "char-grid" }, shownInactive.map(card)) : null],
    active.length || inactive.length ? meLine(data) : null,
    retired.length ? [h("h3", { class: "subhead" }, "Retired"), h("div", { class: "char-grid" }, retired.map(card))] : null,
  ];
}

// --- At the table ---------------------------------------------------------------
// While a scenario is played, a phone keeps its character's hit points, the
// XP on their dial, the coins they've picked up and which items are used, as
// the dials, tokens and cards do. Kept in this browser only, per character,
// so a locked screen or a reload loses nothing; New scenario starts again at
// full health with every item ready. Hit points by class and level:
// data/gloomhaven-events.json; how items are used: data/gloomhaven-items.json.

function maxHealth(c) {
  const id = classId(c.class);
  return (id && classRef.classEvents?.[id]?.health?.[characterStats(c).level - 1]) || null;
}

const tableKey = name => storeKey(`table:${name}`);
function tableState(name) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(tableKey(name))); } catch {}
  // hp null: at full health, whatever the maximum is by then.
  return { hp: null, xp: 0, coins: 0, items: {}, conds: {}, cards: null, ...(saved && typeof saved === "object" ? saved : {}) };
}
// The tracker and the items each save their own part over what's stored.
function saveTable(name, part) {
  try { localStorage.setItem(tableKey(name), JSON.stringify({ ...tableState(name), ...part })); } catch {}
}

// Items at the table (phones): tapping one marks it used, as its card is
// turned sideways (spent) or face down (consumed); one with circles takes a
// tap for each use, the last one using it up. Tapping a used item readies
// it again, as a refresh does. Refresh readies every spent item, as a long
// rest does (the Cards block's Long rest does it too). Items that are never
// used up are listed, not buttons.
const USED_WORDS = { spent: "Spent", consumed: "Consumed" };

function itemTrack(c) {
  const marks = tableState(c.name).items || {};
  const spent = c.items.filter(n => marks[n]?.down && itemInfo(n)?.use === "spent");
  // One change, saved, and the list drawn again with focus where it was.
  const change = (key, fn) => () => {
    fn();
    saveTable(c.name, { items: marks });
    const next = itemTrack(c);
    box.replaceWith(next);
    (next.querySelector(`[data-key="${CSS.escape(key)}"]`) || next.querySelector(".item-use"))?.focus({ preventScroll: true });
  };
  const box = h("div", { class: "item-track" },
    h("ul", { class: "item-list" }, c.items.map((name, i) => {
      const info = itemInfo(name);
      const slot = info?.slot;
      const glyph = slot ? gameIcon(`slot-${slot}`) : h("span", { class: "slot-blank", "aria-hidden": "true" });
      if (!info?.use) return h("li", {}, glyph, name);
      const m = marks[name] || {};
      const marked = m.down ? info.uses || 0 : m.uses || 0;
      const status = m.down ? USED_WORDS[info.use] : marked ? `${marked} of ${info.uses} uses marked` : "Ready";
      const next = m.down ? "ready it" : info.uses ? (marked + 1 === info.uses ? `mark the last use (${info.use})` : "mark a use") : info.use === "spent" ? "spend it" : "consume it";
      const key = `item-${c.name}-${i}`;
      return h("li", {},
        h("button", {
          type: "button", class: `item-use${m.down ? ` ${info.use}` : ""}`, "data-key": key,
          "aria-label": `${name}, ${status.toLowerCase()}: tap to ${next}`,
          onclick: change(key, () => {
            if (m.down) delete marks[name];
            else if (info.uses && marked + 1 < info.uses) marks[name] = { uses: marked + 1 };
            else marks[name] = { down: true };
          }),
        },
        glyph,
        h("span", { class: "item-name" }, name),
        info.uses ? h("span", { class: "use-dots", "aria-hidden": "true" },
          Array.from({ length: info.uses }, (_, k) => h("i", { class: k < marked ? "on" : null }))) : null,
        h("span", { class: "item-state", "aria-hidden": "true" }, m.down ? USED_WORDS[info.use] : "Ready")));
    })),
    spent.length ? h("button", { type: "button", class: "btn item-rest", "data-key": `item-rest-${c.name}`,
      onclick: change(`item-rest-${c.name}`, () => { for (const n of spent) delete marks[n]; }) },
      icon("replay"), `Refresh ${spent.length === 1 ? "the spent item" : `${spent.length} spent items`}`) : null);
  return box;
}

// Ability cards at the table (phones): how many are in hand, in the discard
// pile and lost, starting from the class's hand size. Cards played go from
// hand to discard or lost; a rest, which needs two cards in the discard pile,
// takes them back into hand but one, which is lost: at random in a short
// rest, chosen in a long one, which also heals 2 and refreshes spent items
// (rulebook p. 17). A character who can't play two cards or rest is
// exhausted. Only counts are kept, not which cards.
function handSize(c) {
  const id = classId(c.class);
  return (id && classRef.classEvents?.[id]?.handSize) || null;
}
function cardPiles(c) {
  return tableState(c.name).cards || { hand: handSize(c) || 0, discard: 0, lost: 0 };
}

// The most rounds left: two cards a round, all to the discard pile, with a
// short rest (which takes no round) whenever the hand runs out.
function roundsLeft({ hand, discard }) {
  let rounds = 0;
  for (;;) {
    if (hand >= 2) { hand -= 2; discard += 2; rounds++; }
    else if (discard >= 2) { hand += discard - 1; discard = 0; }
    else return rounds;
  }
}

const cardUndo = new Map();   // per character, this visit only

function cardBlock(c) {
  const piles = cardPiles(c);
  const undo = cardUndo.get(c.name) || [];
  const card = () => document.querySelector(`.char-card[data-char="${CSS.escape(c.name)}"]`);
  // One move, saved, with what it changes kept to undo: the piles, and for a
  // long rest the hit points and items too.
  const move = (key, can, fn, also) => (...label) => h("button", {
    type: "button", class: "btn pile-move", "data-key": `${key}-${c.name}`, "aria-disabled": String(!can),
    onclick: () => {
      if (!can) return;
      const before = tableState(c.name);
      cardUndo.set(c.name, [...undo, also ? { cards: piles, hp: before.hp, items: before.items } : { cards: piles }].slice(-20));
      const next = { ...piles };
      fn(next);
      saveTable(c.name, { cards: next });
      also?.();
      redraw(`${key}-${c.name}`);
    } }, ...label);
  const redraw = key => {
    const fresh = cardBlock(c);
    block.replaceWith(fresh);
    const target = fresh.querySelector(`[data-key="${CSS.escape(key)}"]`);
    (target?.getAttribute("aria-disabled") === "true" ? fresh.querySelector('.pile-move[aria-disabled="false"]') : target)?.focus({ preventScroll: true });
  };
  const canRest = piles.discard >= 2;
  const left = roundsLeft(piles);
  const exhausted = piles.hand < 2 && !canRest;
  const pile = (name, n, kind) => h("div", { class: `pile ${kind}${n ? "" : " none"}` },
    h("output", { class: "num", "aria-live": "polite" }, String(n), h("span", { class: "sr-only" }, ` ${n === 1 ? "card" : "cards"} ${name === "Hand" ? "in hand" : name === "Discard" ? "in the discard pile" : "lost"}`)),
    h("span", { class: "label", "aria-hidden": "true" }, name));

  const block = h("div", { class: "block card-block", id: `cards-${c.name}` },
    h("div", { class: "block-head" }, h("h4", { class: "label" }, "Ability cards"),
      h("span", { class: `small${exhausted ? " pile-warn" : " muted"}` },
        exhausted ? "Exhausted" : piles.hand < 2 ? "Rest this round" : `Up to ${plural(left, "round")} left`)),
    h("div", { class: "piles" }, pile("Hand", piles.hand, "hand"), pile("Discard", piles.discard, "discard"), pile("Lost", piles.lost, "lost")),
    h("div", { class: "pile-row" }, h("span", { class: "label" }, "Play"),
      move("pile-discard", piles.hand > 0, p => { p.hand--; p.discard++; })("To discard"),
      move("pile-lose", piles.hand > 0, p => { p.hand--; p.lost++; })("To lost")),
    h("div", { class: "pile-row" }, h("span", { class: "label" }, "Rest"),
      move("pile-short", canRest, p => { p.hand += p.discard - 1; p.lost++; p.discard = 0; })("Short rest"),
      move("pile-long", canRest, p => { p.hand += p.discard - 1; p.lost++; p.discard = 0; }, () => {
        // Heal 2 and refresh spent items, on the tracker and the item list.
        const st = tableState(c.name);
        const max = maxHealth(c);
        const marks = st.items || {};
        for (const n of Object.keys(marks)) if (marks[n]?.down && itemInfo(n)?.use === "spent") delete marks[n];
        saveTable(c.name, { hp: max ? Math.min(max, (st.hp ?? max) + 2) : st.hp, items: marks });
        card()?.querySelector(".item-track")?.replaceWith(itemTrack(c));
        card()?.querySelector(".table-dock")?.replaceWith(tableDock(c));
      })("Long rest")),
    h("div", { class: "pile-row pile-more" },
      move("pile-burn", piles.discard > 0, p => { p.discard--; p.lost++; })("Lose from discard"),
      move("pile-recover", piles.lost > 0, p => { p.lost--; p.hand++; })("Recover lost"),
      undo.length ? h("button", { type: "button", class: "btn quiet pile-undo", "data-key": `pile-undo-${c.name}`,
        onclick: () => {
          cardUndo.set(c.name, undo.slice(0, -1));
          saveTable(c.name, undo.at(-1));
          card()?.querySelector(".item-track")?.replaceWith(itemTrack(c));
          card()?.querySelector(".table-dock")?.replaceWith(tableDock(c));
          redraw(`pile-undo-${c.name}`);
        } }, icon("replay"), "Undo") : null),
    h("p", { class: "small muted" }, canRest
      ? "A short rest loses a random card; a long rest takes the round, loses the card you choose, heals 2 and refreshes spent items."
      : "Resting needs two cards in the discard pile."));
  return block;
}

// Conditions at the table (phones), as the tokens on the character's mat:
// each one a toggle, with what it does while it's on (rulebook pp. 22-23).
// Bless and Curse are cards shuffled into the attack modifier deck, so
// they're counted. The tracker's reset clears them all for a new scenario;
// the rest is left to the players, as when a condition ends depends on
// whose turn it was gained in.
const CONDITIONS = [
  ["poison", "Poison", "bad", "Attacks on you gain +1. A heal removes it and does nothing else."],
  ["wound", "Wound", "bad", "1 damage at the start of each of your turns. A heal removes it and still heals."],
  ["immobilize", "Immobilize", "bad", "No move abilities. Removed at the end of your next turn."],
  ["disarm", "Disarm", "bad", "No attack abilities. Removed at the end of your next turn."],
  ["stun", "Stun", "bad", "No abilities or items except a long rest; two cards played are discarded unused. Removed at the end of your next turn."],
  ["muddle", "Muddle", "bad", "Disadvantage on your attacks. Removed at the end of your next turn."],
  ["invisible", "Invisible", "good", "Enemies can't focus on or target you. Removed at the end of your next turn."],
  ["strengthen", "Strengthen", "good", "Advantage on your attacks. Removed at the end of your next turn."],
];
const DECK_CONDITIONS = [
  ["bless", "Bless", "good", "Each Bless card in your deck is removed once it's drawn."],
  ["curse", "Curse", "bad", "Each Curse card in your deck is removed once it's drawn."],
];
const condIcon = (id, alt = "") => h("img", { class: "cond-icon", src: `icons/${id}.svg`, alt, width: 28, height: 28 });

function condBlock(c) {
  const conds = tableState(c.name).conds || {};
  const change = (key, fn) => () => {
    fn();
    saveTable(c.name, { conds });
    const next = condBlock(c);
    block.replaceWith(next);
    next.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
    // The dock shows what's on, too.
    document.querySelector(`.char-card[data-char="${CSS.escape(c.name)}"] .dock-conds`)?.replaceWith(condStrip(c));
  };
  const on = [...CONDITIONS, ...DECK_CONDITIONS].filter(([id]) => conds[id]);
  const block = h("div", { class: "block cond-block", id: `conds-${c.name}` },
    h("div", { class: "block-head" }, h("h4", { class: "label" }, "Conditions"),
      on.length ? h("span", { class: "small muted" }, `${on.length} on`) : null),
    h("div", { class: "cond-grid", role: "group", "aria-label": "Conditions" }, CONDITIONS.map(([id, name, kind]) =>
      h("button", { type: "button", class: `cond ${kind}`, "data-key": `cond-${id}-${c.name}`, "aria-pressed": String(Boolean(conds[id])),
        onclick: change(`cond-${id}-${c.name}`, () => { if (conds[id]) delete conds[id]; else conds[id] = true; }) },
        condIcon(id), h("span", {}, name)))),
    h("div", { class: "cond-cards" }, DECK_CONDITIONS.map(([id, name, kind]) => {
      const n = conds[id] || 0;
      return h("div", { class: `cond-count ${kind}${n ? " on" : ""}` },
        condIcon(id),
        h("span", { class: "cond-count-name" }, name),
        h("button", { type: "button", class: "dock-step", "data-key": `cond-${id}-down-${c.name}`, "aria-label": `1 less ${name} card`,
          "aria-disabled": String(!n), onclick: change(`cond-${id}-down-${c.name}`, () => { if (n > 1) conds[id] = n - 1; else delete conds[id]; }) }, icon("minus")),
        h("output", { class: "num", "aria-live": "polite" }, String(n), h("span", { class: "sr-only" }, ` ${name} ${n === 1 ? "card" : "cards"}`)),
        h("button", { type: "button", class: "dock-step", "data-key": `cond-${id}-up-${c.name}`, "aria-label": `1 more ${name} card`,
          "aria-disabled": String(n >= 10), onclick: change(`cond-${id}-up-${c.name}`, () => { if (n < 10) conds[id] = n + 1; }) }, icon("plus")));
    })),
    // What each one on does, to read at the table.
    on.length ? h("ul", { class: "cond-notes" }, on.map(([id, name, kind, does]) =>
      h("li", { class: kind }, h("strong", {}, name), " ", does))) : null);
  return block;
}

// In the dock: the conditions that are on, as their icons, a tap from the
// toggles. An empty span keeps its place when none are.
function condStrip(c) {
  const conds = tableState(c.name).conds || {};
  const on = [...CONDITIONS, ...DECK_CONDITIONS].filter(([id]) => conds[id]);
  if (!on.length) return h("span", { class: "dock-conds", hidden: true });
  const said = on.map(([id, name]) => typeof conds[id] === "number" ? `${conds[id]} ${name}` : name).join(", ");
  return h("button", { type: "button", class: "dock-conds", "aria-label": `Conditions: ${said}. Go to them`,
    onclick: () => document.getElementById(`conds-${c.name}`)?.scrollIntoView({ block: "center", behavior: "instant" }) },
    on.map(([id]) => h("span", { class: "dock-cond" }, condIcon(id),
      typeof conds[id] === "number" && conds[id] > 1 ? h("b", {}, String(conds[id])) : null)));
}

// Docked at the foot of the screen, above the tabs, while the sheet scrolls
// under it: the counters stay under the thumb. Phones only (styles.css).
// Each tap changes the numbers in place, so the sheet doesn't redraw and a
// screen reader hears the new value.
function tableDock(c) {
  const max = maxHealth(c);
  const state = tableState(c.name);
  const hp = () => Math.max(0, Math.min(max, state.hp ?? max));
  // Each value says what it counts, so a screen reader hears "5 XP".
  const out = () => h("output", { class: "dock-value num", "aria-live": "polite" });
  const hpOut = out(), xpOut = out(), coinsOut = out();
  const bar = h("span");
  const hpLabel = h("span", { class: "label", "aria-hidden": "true" }, "HP");
  const dock = h("section", { class: "table-dock", "aria-label": `${c.name}: this scenario` });
  const steps = [];
  const step = (key, iconName, words, can, change) => {
    const b = h("button", { type: "button", class: "dock-step", "data-key": `dock-${key}-${c.name}`, "aria-label": words,
      onclick: () => { if (!can()) return; change(); saveTable(c.name, { hp: state.hp, xp: state.xp, coins: state.coins }); paint(); } }, icon(iconName));
    steps.push([b, can]);
    return b;
  };
  const paint = () => {
    if (max) {
      hpOut.replaceChildren(String(hp()), h("span", { class: "of" }, ` / ${max}`), h("span", { class: "sr-only" }, hp() ? " hit points" : " hit points: exhausted"));
      // At none, the character is exhausted: out of the scenario.
      hpLabel.textContent = hp() ? "HP" : "Exhausted";
      bar.style.width = `${Math.round(hp() / max * 100)}%`;
      dock.classList.toggle("exhausted", hp() === 0);
      dock.classList.toggle("hurt", hp() > 0 && hp() <= max / 3);
    }
    xpOut.replaceChildren(String(state.xp), h("span", { class: "dock-unit" }, " XP"));
    coinsOut.replaceChildren(String(state.coins), h("span", { class: "dock-unit" }, state.coins === 1 ? " coin" : " coins"));
    for (const [b, can] of steps) b.setAttribute("aria-disabled", String(!can()));
  };
  // Starting over asks twice: a slip of the thumb would lose the evening.
  let armed = null;
  const reset = h("button", { type: "button", class: "dock-reset", "data-key": `dock-reset-${c.name}`,
    "aria-label": "New scenario: full hit points and hand, no XP, coins or conditions, every item ready",
    onclick: () => {
      if (!armed) {
        reset.classList.add("armed");
        reset.replaceChildren("Reset?");
        armed = setTimeout(disarm, 3000);
        return;
      }
      disarm();
      Object.assign(state, { hp: null, xp: 0, coins: 0 });
      saveTable(c.name, { hp: null, xp: 0, coins: 0, items: {}, conds: {}, cards: null });
      cardUndo.delete(c.name);
      paint();
      // Every item ready again, on the sheet above.
      const items = document.querySelector(`.char-card[data-char="${CSS.escape(c.name)}"] .item-track`);
      items?.replaceWith(itemTrack(c));
      document.getElementById(`conds-${c.name}`)?.replaceWith(condBlock(c));
      document.getElementById(`cards-${c.name}`)?.replaceWith(cardBlock(c));
      dock.querySelector(".dock-conds")?.replaceWith(condStrip(c));
    } }, icon("replay"));
  const disarm = () => { clearTimeout(armed); armed = null; reset.classList.remove("armed"); reset.replaceChildren(icon("replay")); };

  dock.append(
    condStrip(c),
    max ? h("div", { class: "dock-row dock-hp-row" },
      step("hp-down", "minus", "Lose 1 hit point", () => hp() > 0, () => { state.hp = hp() - 1; }),
      h("div", { class: "dock-hp-box" },
        h("span", { class: "dock-hp-line" }, hpLabel, hpOut),
        h("span", { class: "dock-bar", "aria-hidden": "true" }, bar)),
      step("hp-up", "plus", "Heal 1 hit point", () => hp() < max, () => { state.hp = hp() + 1 === max ? null : hp() + 1; }),
      reset) : null,
    h("div", { class: "dock-row dock-pair" },
      h("div", { class: "dock-count" },
        step("xp-down", "minus", "1 less XP", () => state.xp > 0, () => { state.xp -= 1; }),
        xpOut,
        step("xp-up", "plus", "1 more XP", () => true, () => { state.xp += 1; })),
      h("div", { class: "dock-count" },
        step("coins-down", "minus", "1 less coin", () => state.coins > 0, () => { state.coins -= 1; }),
        coinsOut,
        step("coins-up", "plus", "1 more coin", () => true, () => { state.coins += 1; })),
      max ? null : reset));
  paint();
  return dock;
}

// --- Shop -----------------------------------------------------------------------
// data/gloomhaven-items.json says what each item costs, how many copies exist
// and at what prosperity it reaches the shop. The shop holds every item up to
// the city's prosperity level plus the item designs the party has found;
// copies carried by active characters are out of stock (a retired character's
// items go back). Prices move with reputation.

const SLOTS = [["head", "Head"], ["body", "Body"], ["legs", "Legs"], ["onehand", "One hand"],
               ["twohand", "Two hands"], ["small", "Small items"]];

function deriveShop(data, items, ledger) {
  if (!items) return null;
  const level = stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const modifier = shopModifier(data.party.reputation);
  const all = Object.entries(items.items).map(([id, item]) => ({ id: Number(id), ...item }));
  const byName = new Map(all.map(item => [item.name.toLowerCase(), item]));
  const designs = new Set(data.city.itemDesigns.map(d => d.name.toLowerCase()));
  const inShop = item => (item.prosperity && item.prosperity <= level) || designs.has(item.name.toLowerCase());
  const questions = [];

  // Who carries what.
  const owners = new Map();
  for (const c of data.characters.filter(c => !c.retired)) {
    for (const name of c.items) {
      const item = byName.get(name.toLowerCase());
      if (!item) {
        questions.push(`${c.name} carries ${name}, which isn't in the item list. Check the spelling against the card.`);
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
    const item = byName.get(String(name).toLowerCase());
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
  const normal = new Set(all.filter(inShop).map(item => item.name.toLowerCase()));

  // Reputation that isn't settled may mean other prices.
  const range = ledger?.reputation?.range;
  const modifiers = range ? new Set([shopModifier(range.lo), shopModifier(range.hi), modifier]) : new Set([modifier]);
  const coming = all.filter(item => item.prosperity === level + 1).length;

  return { level, modifier, stock, questions, coming, pricesUnsure: modifiers.size > 1, range, normal };
}

// Whose shopping the Shop shows: until someone is picked, this phone's
// character; then a name, or "" for no one.
let shopFor;
let shopFilter = "all";   // "all", or "can": only what the shopper can buy

function renderShop(data) {
  const shop = data.shop;
  if (!shop) return null;
  const copies = n => `${n} ${n === 1 ? "copy" : "copies"}`;

  // Whoever is shopping (this phone's character to start with, or anyone
  // picked above the list): their gold, their room, and on each item whether
  // they could take it, with Buy, or Sell on what they carry.
  const everyone = characterOrder(data).filter(c => !c.retired);
  const shopper = everyone.find(c => c.name === (shopFor === undefined ? me : shopFor));
  const active = everyone.filter(c => !hiddenAway(c, c === shopper));
  // The draft counts: what it buys takes slots, gold and copies; what it
  // sells frees them.
  const buys = (draft?.buys || []).filter(b => b.character && b.item);
  const sells = (draft?.sells || []).filter(x => x.character && x.item);
  const mineBuys = shopper ? buys.filter(b => b.character === shopper.name) : [];
  const mineSells = shopper ? sells.filter(x => x.character === shopper.name) : [];
  const owned = shopper ? [...shopper.items.filter(i => !mineSells.some(x => sameItem(x.item, i))), ...mineBuys.map(b => b.item)] : [];
  const room = shopper ? slotUse({ ...shopper, items: owned }, characterStats(shopper).level) : null;
  const priceOf = name => shop.stock.find(i => sameItem(i.name, name));
  const spent = mineBuys.reduce((sum, b) => sum + (priceOf(b.item)?.price || 0), 0)
              - mineSells.reduce((sum, x) => sum + (priceOf(x.item)?.sells || 0), 0);
  const gold = shopper ? shopper.gold - spent : 0;
  const left = item => item.left - buys.filter(b => sameItem(b.item, item.name)).length + sells.filter(x => sameItem(x.item, item.name)).length;
  const full = item => { const [k, n] = slotNeed(item.slot); return room && k in room.used && room.used[k] + n > room.limits[k]; };
  const dear = item => shopper && item.price > gold;
  const has = item => shopper?.items.some(i => sameItem(i, item.name));
  const bought = item => mineBuys.some(b => sameItem(b.item, item.name));
  const sold = item => mineSells.some(x => sameItem(x.item, item.name));
  const canBuy = item => shopper && !has(item) && !bought(item) && left(item) > 0 && !dear(item);

  // On the right: the price, and under it what the shopper can do. It goes
  // into the draft, as "Record it" does for a perk.
  const action = item => !shopper || !rawCampaign ? null
    : has(item) ? (sold(item) ? h("span", { class: "in-draft" }, "Sold in the draft")
        : h("button", { type: "button", class: "buy sell", "data-key": `sell-${item.id}`, "aria-label": `Sell ${item.name} for ${item.sells} gold`,
            onclick: () => recordSell(data, shopper.name, item.name) }, `Sell for ${item.sells}`))
    : bought(item) ? h("span", { class: "in-draft" }, "In the draft")
    : canBuy(item) ? h("button", { type: "button", class: "buy", "data-key": `buy-${item.id}`, "aria-label": `Buy ${item.name} for ${shopper.name}`,
        onclick: () => recordBuy(data, shopper.name, item.name) }, "Buy")
    : null;
  const row = item => h("li", { class: has(item) ? "owned" : left(item) <= 0 && !bought(item) ? "sold-out" : dear(item) && !bought(item) ? "too-dear" : null },
    h("span", {},
      h("strong", {}, item.name, item.design ? h("span", { class: "tag" }, "design") : null,
        item.back ? h("span", { class: "tag", title: "Not sold here otherwise: a copy sold, or left by a retired character" }, "returned") : null),
      h("span", { class: "sub" }, copyPips(item), [
        shopper && !has(item) && !bought(item) && left(item) > 0 && full(item) ? fullText(shopper, item.slot) : null,
        // What it sells for: on the shopper's own items that's their Sell button.
        !shopper && item.held.length ? `sells for ${item.sells}` : null,
      ].filter(Boolean).join(" · "))),
    h("span", { class: "price-col" }, h("span", { class: "price num" }, `${item.price} `, h("span", { class: "unit" }, "gold")), action(item)));

  // One mark per copy of the item: empty while it's in the shop, the
  // holder's class icon once someone carries it.
  const copyPips = item => {
    const holders = item.held.map(name => data.characters.find(c => c.name === name)).filter(Boolean);
    const said = `${copies(item.count)}: ${item.left ? `${item.left} in the shop` : "none in the shop"}${item.held.length ? `, ${item.held.join(", ")} ${item.held.length === 1 ? "has" : "have"} ${item.held.length === 1 ? "one" : "them"}` : ""}`;
    return h("span", { class: "copies", role: "img", "aria-label": said, title: said },
      holders.map(c => h("i", { class: "held" }, classIcon(c.class))),
      Array.from({ length: item.left }, () => h("i")));
  };

  // "Can buy" leaves what the shopper could buy, and what they already
  // have in the draft.
  const showing = item => shopFilter !== "can" || !shopper || canBuy(item) || bought(item);
  const groups = SLOTS.map(([slot, label]) => [slot, label, shop.stock.filter(i => i.slot === slot && showing(i))]).filter(([, , list]) => list.length);
  const priceNote = shop.modifier === 0 ? "normal prices" : `${signed(shop.modifier)} gold per item`;
  const doubt = priceDoubt(shop, data.ledger?.reputation);
  const pick = name => () => { shopFor = shopper?.name === name ? "" : name; render(data, "shop"); };

  return [
    // How far prices could be off, said once beside them all.
    sectionHead("Shop", [`Prosperity ${shop.level} · ${priceNote}`,
      doubt ? h("span", { class: "price-doubt", role: "img", title: doubt.why, "aria-label": doubt.why }, doubt.text) : null]),
    active.length ? h("div", { class: "shop-for" },
      h("span", { class: "label", id: "shop-for-label" }, "Shopping for"),
      h("div", { class: "filters", role: "group", "aria-labelledby": "shop-for-label" }, active.map(c =>
        h("button", { type: "button", "data-key": `shop-for-${c.name}`, "aria-pressed": String(shopper?.name === c.name), onclick: pick(c.name) },
          classIcon(c.class), c.name)),
        inactiveToggle(data, everyone.length - active.length, "shop-inactive"))) : null,
    shopper ? h("div", { class: "shop-me" },
      h("span", {}, `${shopper.name} has `, h("strong", {}, `${shopper.gold} gold`), spent ? `, ${gold} after the draft` : null),
      slotStrip({ ...shopper, items: owned }, characterStats(shopper).level),
      h("div", { class: "segmented", role: "group", "aria-label": "Show" }, [["all", "Everything"], ["can", "Can buy"]].map(([key, label]) =>
        h("button", { type: "button", "data-key": `shop-show-${key}`, "aria-pressed": String(shopFilter === key),
          onclick: () => { shopFilter = key; render(data, "shop"); } }, label)))) : null,
    shop.pricesUnsure ? pricesNote(shop, data.ledger?.reputation) : null,
    shop.questions.map(q => nudge("question", "Check an item", q)),
    groups.length ? null : empty(`Nothing ${shopper?.name} can buy right now.`),
    h("div", { class: "shop" }, groups.map(([slot, label, list]) =>
      h("div", { class: "card" },
        h("h3", { class: "label" }, gameIcon(`slot-${slot}`), label),
        h("ul", { class: "rows" }, list.map(row))))),
    shop.coming ? h("p", { class: "aside" }, `${plural(shop.coming, "more item")} arrive${shop.coming === 1 ? "s" : ""} at prosperity ${shop.level + 1}.`) : null,
    enhancer(data),
  ];
}

// Prices that may be off because reputation isn't certain. If something can
// still be settled, say where; if what's open can never be known, just say
// how far off prices could be, quietly, as there's nothing to do about it.
function pricesNote(shop, rep) {
  if (rep?.unsure.length || !rep?.unknown?.length) {
    return nudge("question", "Prices may be off",
      `Reputation could be ${rangeText(shop.range)}, which would change prices. Settle the open events under Reputation.`);
  }
  // What can never be known needs no box: the Shop's heading carries a tag.
  return null;
}

// How far a price could be off while reputation isn't certain: "−1?", with
// the reason on hover. null when prices are sure.
function priceDoubt(shop, rep) {
  if (!shop.pricesUnsure) return null;
  const lower = shop.modifier - shopModifier(shop.range.hi);
  const higher = shopModifier(shop.range.lo) - shop.modifier;
  if (lower <= 0 && higher <= 0) return null;
  const open = [...(rep?.unsure || []), ...(rep?.unknown || [])].join(", ").replace(/, ([^,]*)$/, " and $1");
  const could = [lower > 0 ? `${lower} gold lower` : null, higher > 0 ? `${higher} gold higher` : null].filter(Boolean).join(" or ");
  return { text: `${[lower > 0 ? `−${lower}` : null, higher > 0 ? `+${higher}` : null].filter(Boolean).join("/")}?`,
           why: `Reputation could be ${rangeText(shop.range)}${open ? ` (${open} open)` : ""}: may be ${could}.` };
}

// A character's item slots, as on the sheet: head, body, legs, two hands and
// the small items their level allows, lit where something's carried (ember
// where they carry more than there's room for).
function slotStrip(c, level) {
  const { used, limits } = slotUse(c, level);
  const slots = [];
  for (const [k, icon, count] of [["head", "head", 1], ["body", "body", 1], ["legs", "legs", 1], ["hands", "onehand", 2], ["small", "small", limits.small]]) {
    for (let i = 0; i < Math.max(count, used[k]); i++) slots.push([icon, i < used[k], i >= count]);
  }
  return h("span", { class: "slots", role: "img", "aria-label": capitalize(`${freeRoom({ used, limits })}.`) },
    slots.map(([icon, on, over]) => h("span", { class: `slot${on ? " on" : ""}${over ? " over" : ""}` }, gameIcon(`slot-${icon}`))));
}

// An item that wouldn't fit in the slots: it can still be bought (owning
// isn't limited), but not equipped alongside what the slot already holds.
function fullText(c, slot) {
  if (slot === "onehand" || slot === "twohand") return `${c.name}'s hands are full: owned, not equipped with the rest`;
  if (slot === "small") return `more small items than ${c.name} can equip`;
  return `${c.name} already has a ${slot} item to equip`;
}

// The room left in a character's slots, in words.
function freeRoom({ used, limits }) {
  const free = [
    ...["head", "body", "legs"].filter(k => used[k] < limits[k]),
    limits.hands - used.hands > 0 ? (limits.hands - used.hands === 2 ? "two hands" : "one hand") : null,
    limits.small - used.small > 0 ? plural(limits.small - used.small, "small item") : null,
  ].filter(Boolean);
  return free.length ? `room for ${free.join(", ").replace(/, ([^,]*)$/, " and $1")}` : "no free slots";
}

// The Enhancer: what a sticker costs, from what's printed on the card.
// "Record it" puts the enhancement in the draft, which takes the gold off.
const enhancing = { sticker: "attack", level: "1", multi: false, previous: "0", hexes: "3", classCards: "0", already: false };

function enhancer(data) {
  if (!data.city.globalAchievements.some(a => a.id === "the-power-of-enhancement")) return null;
  const set = key => e => { enhancing[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value; render(data, "shop"); };
  const field = (label, control) => h("label", { class: "field" }, h("span", {}, label), control);
  const select = (key, options) => h("select", { "data-key": `enh-${key}`, onchange: set(key) },
    options.map(([value, label]) => h("option", { value, selected: String(enhancing[key]) === String(value) }, label)));
  const counting = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [String(from + i), String(from + i)]);

  const key = enhancing.sticker;
  const cost = enhancementCost(enhancing);
  // The active party, lit if they can pay.
  const payers = characterOrder(data).filter(c => !c.retired && !c.inactive);

  return h("div", { class: "enhancer-wrap" },
    h("h3", { class: "subtitle" }, "Enhancing a card"),
    h("div", { class: "card enhancer" },
      h("div", { class: "enhancer-form" },
        h("div", { class: "rec-row" },
          field("Sticker", h("select", { "data-key": "enh-sticker", onchange: set("sticker") },
            ENHANCEMENTS.map(([group, list]) => h("optgroup", { label: group },
              list.map(([k, label]) => h("option", { value: k, selected: k === key }, label)))))),
          // A level X card counts as level 1.
          field("Card level", select("level", [["1", "1 or X"], ...counting(2, 9)])),
          field("Already on it", select("previous", counting(0, 3))),
          key === "hex" ? field("Hexes it has", select("hexes", counting(1, 12))) : null),
        canDouble(key) ? h("label", { class: "rec-check" },
          h("input", { type: "checkbox", "data-key": "enh-multi", checked: Boolean(enhancing.multi), onchange: set("multi") }),
          "The ability targets more than one figure") : null,
        // A class's enhanced cards can't outnumber the prosperity level (p. 46).
        h("div", { class: "rec-row" },
          field("Cards this class has enhanced", select("classCards", counting(0, 9))),
          h("label", { class: "rec-check" },
            h("input", { type: "checkbox", "data-key": "enh-already", checked: Boolean(enhancing.already), onchange: set("already") }),
            "This card is one of them")),
        !enhancing.already && num(enhancing.classCards) >= stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY)
          ? nudge("question", "Over the limit", `A class can have only as many enhanced cards as the prosperity level (${stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY)}), counting every character of the class, retired ones too.`)
          : null,
      ),
      h("div", { class: "enhancer-cost" },
        h("div", { class: "enhancer-total", "aria-live": "polite" }, h("span", { class: "figure" }, cost.total), h("span", {}, "gold")),
        h("ul", { class: "rows" }, cost.steps.map(([text, gold]) => h("li", {}, h("span", {}, text), h("span", { class: "num" }, `+${gold}`)))),
        payers.length ? h("ul", { class: "afford", "aria-label": "Who has the gold" }, payers.map(c => {
          const ok = c.gold >= cost.total;
          return h("li", { class: ok ? "ok" : "short", "aria-label": `${c.name}, ${c.gold} gold${ok ? "" : ", not enough"}` },
            classIcon(c.class), h("span", {}, c.name), h("span", { class: "afford-gold" }, c.gold));
        })) : null,
        rawCampaign ? h("button", { type: "button", class: "todo-do enhancer-record", "data-key": "enh-record",
          onclick: () => recordEnhancement(data, enhancementText(key), cost.total) }, "Record it") : null)));
  function enhancementText(k) {
    const label = ENHANCEMENTS.flatMap(([, list]) => list).find(([key]) => key === k)?.[1] || k;
    return [label, enhancing.multi && canDouble(k) ? "more than one target" : null, `level ${enhancing.level} card`,
            Number(enhancing.previous) ? `${enhancing.previous} already on it` : null].filter(Boolean).join(", ");
  }
}

// --- Recording a session ------------------------------------------------------------
// The site is static, so nothing is saved on a server. The form below builds
// an updated campaign.json from what happened at the table; you download or
// copy it and put it in the repository. The draft is kept in this browser
// until then, so a reload at the table loses nothing.

let rawCampaign = null;   // campaign.json exactly as loaded
let scenarioRef = null;   // data/gloomhaven-scenarios.json
let draft = null;
let savedDraft = null;   // a draft found already in campaign.json on load, and cleared

// Is this draft's session already in campaign.json? The same date (or, if
// undated, title) and the same scenarios played in the same order.
function draftIsSaved(d, raw) {
  if (d.id && raw.lastDraft === d.id) return true;
  const played = (d.scenarios || []).map(s => num(s.number)).filter(Boolean).join(",");
  return (raw.sessions || []).some(s =>
    (s.date || null) === (d.date || null)
    && (d.date || (s.title || "") === (d.title || ""))
    && (s.scenarios || []).map(x => x.number).join(",") === played);
}
const DRAFT_KEY = storeKey("sessionDraft");

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY)) || null; } catch {}
  if (d && !d.id) d.id = draftId();
  if (d) for (const [key, empty] of Object.entries(draftParts())) d[key] ??= empty;
  return d;
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
}
function dropDraft() {
  draft = null;
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}
// Does the draft change anything yet? An opened form, or a row added and left
// empty, doesn't: no draft is kept for it, and nothing says one is waiting.
function draftChanges(d, data) {
  if (!d || !rawCampaign) return false;
  const res = applyDraft(rawCampaign, d, data);
  return res.evening || res.log.length > 0;
}

// Each draft has an id, which campaign.json keeps as "lastDraft" once saved:
// that's how the page knows the draft is in the file, session or not.
const draftId = () => Math.random().toString(36).slice(2, 10);

// What a draft holds besides its date, title, party and notes: empty to start.
// A draft saved by an older version of the page gets any it lacks on loading.
const draftParts = () => ({ advances: [], scenarios: [], events: [], buys: [], sells: [], perks: [], donations: [],
                            enhancements: [], claims: {}, quests: {}, opened: [], retirements: [], newCharacters: [] });

function newDraft(data) {
  // Who's playing: as picked on the Overview's scenario level, if it has been.
  // Anyone inactive picked there plays too, which brings them back once saved.
  const active = new Set(data.characters.filter(c => !c.retired).map(c => c.name));
  const party = [...(levelParty || defaultLevelParty(data))].filter(n => active.has(n));
  return { id: draftId(), date: today(), title: "", party, notes: "", ...draftParts() };
}
// A scenario starts at the level for who is playing in the form (newcomers
// included), at the Overview's difficulty; the form can change it.
function newScenario(data, party = []) {
  const levels = party.map(c => stepFor(c.xp || 0, XP_FOR_LEVEL));
  const shift = DIFFICULTIES.find(([key]) => key === difficulty)[2];
  const level = levels.length ? Math.max(0, Math.min(7, recommendedLevel(levels) + shift)) : tonight(data)?.level ?? 0;
  return { number: "", level: String(level), result: "success", treasures: [], results: {} };
}
const newEvent = () => ({ deck: "city", number: "", option: "", scenario: "", paid: "" });

const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const filled = v => String(v ?? "").trim() !== "";

// The level a recorded scenario was played at (an older draft has none:
// tonight's level stands in).
function draftLevel(s, data) {
  return Math.max(0, Math.min(7, filled(s.level) ? num(s.level) : tonight(data)?.level ?? 0));
}

// What one character takes from a scenario: the XP on their dial, plus the
// bonus XP for the scenario's level if it succeeded, and their coins in gold
// at that level. Battle goals count only on a success. (A draft from before
// coins were asked for has gold instead.)
function scenarioGain(s, r, data) {
  const st = scenarioStats(draftLevel(s, data));
  const won = s.result === "success";
  return {
    xp: num(r.xp) + (won ? st.xp : 0),
    gold: filled(r.coins) ? num(r.coins) * st.gold : num(r.gold),
    checkmarks: won ? num(r.checkmarks) : 0,
  };
}

// The draft applied to a copy of campaign.json. Returns the new file, a list
// of what changes, and anything that looks wrong.
function applyDraft(raw, d, data) {
  const out = JSON.parse(JSON.stringify(raw));
  out.scenarios ||= [];
  out.sessions ||= [];
  out.events ||= [];
  out.characters ||= [];
  const log = [];
  const warnings = [];
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
  const normal = name => data.shop?.normal?.has(String(name).toLowerCase()) ?? true;
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
  // An event's gold or XP. A gain counts with the evening's; a loss comes off
  // at once, and can't take gold below 0 or XP below the start of the
  // character's level (rulebook p. 42).
  const eventGain = (name, key, amount) => {
    if (amount >= 0) return gain(name, key, amount);
    const c = who(name);
    if (!c) return;
    if (key === "gold") c.gold = Math.max(0, (c.gold || 0) + amount);
    else c.xp = Math.max(XP_FOR_LEVEL[stepFor(c.xp || 0, XP_FOR_LEVEL) - 1], (c.xp || 0) + amount);
  };
  const gain = (name, key, amount) => {
    if (!amount) return;
    const g = gainFor.get(name) || { xp: 0, gold: 0, checkmarks: 0 };
    g[key] += amount;
    gainFor.set(name, g);
  };
  // Newcomers before anything else: a newcomer can play tonight's scenarios
  // and go shopping. Retirements come after the scenarios (below). Each
  // retirement tonight is a prosperity checkmark (p. 48), which counts for a
  // newcomer's starting level and for advancing to the prosperity level.
  const joinLog = [];
  // How many characters a player has retired, tonight's retirements included
  // (with the player named on the retirement row, if not already known).
  const playerOf = c => String((d.retirements || []).find(x => x.character === c.name)?.player || c.player || "").trim().toLowerCase();
  const retiredBy = player => {
    const name = String(player || "").trim().toLowerCase();
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
                          perks: [], items: [], personalQuest: "", retired: false, ...(bonus ? { perkBonus: bonus } : {}),
                          ...(String(x.player || "").trim() ? { player: String(x.player).trim() } : {}), joined: d.date || today(), notes: "" });
    const perks = level - 1 + bonus;
    log.push(`${name} the ${x.class} joins at level ${level}, with ${XP_FOR_LEVEL[level - 1]} XP and ${startingGold(level)} gold${perks ? `, and ${plural(perks, "perk")} to choose` : ""}${level > 1 ? `; and ${plural(level - 1, "ability card")} to add, one for each level from 2 to ${level} (each of that level or lower)` : ""}`);
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
    const outcome = chosenOutcome(data, classRef, e.deck, entry.number, e.option, party, entry.paid);
    const pays = JSON.stringify(classRef.events[e.deck][String(entry.number)][e.option] || []).includes('"type":"pay');
    if (!outcome && pays && entry.paid === undefined) { warnings.push(`${label}: say on its row whether the party paid (Paid?).`); continue; }
    if (!outcome) { warnings.push(`${label}: which outcome applied can't be told from what's recorded, so add any gold or XP it gave by hand.`); continue; }
    if (outcome.unsure) warnings.push(`${label}: part of the outcome depends on something not recorded; check the card for gold or XP.`);
    for (const fx of outcome.effects) {
      if (fx.type === "gold" || fx.type === "experience") {
        for (const name of party) eventGain(name, fx.type === "gold" ? "gold" : "xp", fx.amount);
        log.push(`${label}: ${signed(fx.amount)} ${fx.type === "gold" ? "gold" : "XP"} each, for ${party.join(", ")}`);
      } else if (fx.type === "collectiveGold") {
        const shares = e.shares || {};
        const total = party.reduce((sum, name) => sum + Math.max(0, num(shares[name])), 0);
        const want = Math.abs(fx.amount);
        if (total !== want) warnings.push(`${label}: ${want} gold to ${fx.amount > 0 ? "share" : "pay"}, but the shares come to ${total}.`);
        for (const name of party) if (num(shares[name]) > 0) eventGain(name, "gold", Math.sign(fx.amount) * num(shares[name]));
        if (total) log.push(`${label}: ${total} gold ${fx.amount > 0 ? "shared" : "paid"} (${party.filter(n => num(shares[n]) > 0).map(n => `${n} ${num(shares[n])}`).join(", ")})`);
      } else if (fx.type === "checkmarks") {
        for (const name of party) {
          const c = who(name);
          if (fx.amount > 0) gain(name, "checkmarks", fx.amount);
          // A character can never lose a checkmark that would cost a perk (p. 42).
          else if (c) c.checkmarks = Math.max(3 * Math.floor((c.checkmarks || 0) / 3), (c.checkmarks || 0) + fx.amount);
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
    log.push(`${label} at level ${level}: ${st.gold} gold a coin${s.result === "success" ? `, ${st.xp} bonus XP each` : ""}`);
    const kept = results.filter(r => r.xp || r.gold || r.checkmarks)
      .map(r => Object.fromEntries(Object.entries(r).filter(([k, v]) => k === "character" || v)));
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
            gain(t.character, "gold", num(part.value));
            log.push(`${t.character} gains ${num(part.value)} gold from treasure ${t.number}`);
          }
          if (part.type === "experience") {
            gain(t.character, "xp", num(part.value));
            log.push(`${t.character} gains ${num(part.value)} XP from treasure ${t.number}`);
          }
          // A battle-goal checkmark, which counts towards a perk as any other.
          if (part.type === "battleGoal") {
            gain(t.character, "checkmarks", num(part.value));
            log.push(`${t.character} gains ${plural(num(part.value), "battle goal checkmark")} from treasure ${t.number}`);
          }
          if (part.type === "item") {
            const item = itemName(part.value);
            // An item the looter already owns is sold at once to the city's
            // supply (p. 27).
            if (who(t.character)?.items.some(i => sameItem(i, item))) {
              const value = Math.floor((Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, item))?.cost || 0) / 2);
              gain(t.character, "gold", value);
              returnItem(item);
              log.push(`${t.character} already has ${item}, so the one from treasure ${t.number} is sold at once for ${value} gold`);
            } else if (noCopyLeft(item)) {
              // Every copy is someone's: the looter gains its sell value instead (FAQ).
              const value = Math.floor((Object.values(itemsRef?.items || {}).find(x => sameItem(x.name, item))?.cost || 0) / 2);
              gain(t.character, "gold", value);
              log.push(`No copy of ${item} is left, so ${t.character} gains its sell value from treasure ${t.number}: ${value} gold`);
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
    for (const name of party) { gain(name, "gold", r.gold || 0); gain(name, "xp", r.experience || 0); gain(name, "checkmarks", r.battleGoals || 0); }
    if (r.battleGoals) log.push(`${label} reward: ${plural(r.battleGoals, "battle goal checkmark")} each`);
    if (r.gold || r.experience) log.push(`${label} reward: ${[r.gold ? `${r.gold} gold` : null, r.experience ? `${r.experience} XP` : null].filter(Boolean).join(" and ")} each`);
    if (r.collectiveGold) {
      // Shared as the party split it in the form.
      const shares = s.rewardShares || {};
      const total = party.reduce((sum, name) => sum + Math.max(0, num(shares[name])), 0);
      for (const name of party) if (num(shares[name]) > 0) gain(name, "gold", num(shares[name]));
      if (total !== r.collectiveGold) warnings.push(`${label} gives ${r.collectiveGold} gold to share, but the shares come to ${total}.`);
      else log.push(`${label} reward: ${total} gold shared (${party.filter(n => num(shares[n]) > 0).map(n => `${n} ${num(shares[n])}`).join(", ")})`);
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
  if (evening) out.sessions.push(session);

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
    // All money the character owned is gone (p. 48).
    c.gold = 0;
    delete c.inactive;
    for (const item of c.items || []) returnItem(item);
    joinLog.push(`${c.name} retires: a prosperity checkmark, the ${c.class} retirement events go into the decks, and their items go back to the shop, and their gold is gone`);
    if (!x.unlocks) continue;
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
    gain(name, "xp", short);
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
    log.push(`${name}: ${[g.xp ? `${signed(g.xp)} XP` : null, g.gold ? `${signed(g.gold)} gold` : null,
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
  for (const name of retiring) if (who(name)?.retired) who(name).gold = 0;

  log.push(...joinLog);

  // Shopping and perks, after the scenarios.
  const priceOf = name => data.shop?.stock.find(i => sameItem(i.name, name))?.price;
  for (const b of d.buys.filter(b => b.character && b.item)) {
    const c = who(b.character);
    const price = priceOf(b.item) ?? 0;
    c.gold = (c.gold || 0) - price;
    giveItem(b.character, b.item);
    takeReturned(b.item);
    log.push(`${b.character} buys ${b.item} for ${price} gold`);
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
    log.push(`${sale.character} sells ${sale.item} for ${value} gold`);
  }
  out.city ||= {};
  const before = out.city.donations || 0;
  const donors = (d.donations || []).filter(x => x.character);
  for (const x of donors) {
    const c = who(x.character);
    c.gold = (c.gold || 0) - DONATION;
    out.city.donations = (out.city.donations || 0) + DONATION;
    c.donated = (c.donated || 0) + DONATION;
    // Two Bless cards for their next scenario (p. 45): tonight's, if they
    // play one after this; otherwise kept on the sheet until they do.
    if (x.when === "after" || !(playedTonight && party.includes(c.name))) c.blessNext = true;
    log.push(`${x.character} donates ${DONATION} gold to the Sanctuary: two Bless cards in their next scenario`);
  }
  for (const name of new Set(donors.map(x => x.character))) {
    if (donors.filter(x => x.character === name).length > 1) warnings.push(`${name} donates more than once: it's once per visit to the city.`);
  }
  if (before < ENVELOPE_B_DONATIONS && (out.city.donations || 0) >= ENVELOPE_B_DONATIONS && !d.envelopeB) {
    log.push(`Donations reach ${out.city.donations} gold: Envelope B can be opened`);
  }
  if (d.envelopeB && !out.city.envelopeB) {
    out.city.envelopeB = true;
    log.push("Envelope B opened");
  }
  for (const x of (d.enhancements || []).filter(x => x.character)) {
    const c = who(x.character);
    if (!c) continue;
    c.gold = (c.gold || 0) - num(x.cost);
    c.enhanced = (c.enhanced || 0) + 1;
    log.push(`${x.character} enhances a card (${x.what}) for ${num(x.cost)} gold`);
  }
  for (const p of d.perks.filter(p => p.character && p.perk)) {
    who(p.character).perks.push(p.perk);
    log.push(`${p.character} takes "${p.perk}"`);
  }
  for (const c of out.characters) if (c.gold < 0) warnings.push(`${c.name} would have ${c.gold} gold.`);

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

function renderRecorder(data) {
  const d = draft;
  d.donations ||= [];
  d.enhancements ||= [];
  d.quests ||= {};
  d.claims ||= {};
  d.retirements ||= [];
  d.newCharacters ||= [];
  // A change to the form's rows redraws it, and the Overview and sheets too:
  // they leave out what the draft already covers (a perk picked, say).
  const rerender = () => {
    saveDraft();
    for (const part of ["sessions", "overview", "characters", "shop", "scenarios"]) render(data, part);
  };
  const set = (obj, key, again = false) => e => {
    obj[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (again) rerender(); else saveDraft();
  };
  const field = (label, control, extra = "") => h("label", { class: `field ${extra}`.trim() }, h("span", {}, label), control);
  // Typing in a box only refreshes the summary: redrawing the form would
  // replace the box you're moving to, losing your tap or Tab. A box that
  // changes the form (a scenario, treasure or event number, which shows
  // what it is underneath) redraws once you leave it, then puts focus back
  // on whichever box you went to.
  let relayout = false;
  const text = (key, obj, prop, attrs = {}, layout = false) => h("input", {
    "data-key": key, value: obj[prop] ?? "", ...attrs,
    oninput: e => { set(obj, prop)(e); refreshSummary(); },
    onchange: layout ? () => { relayout = true; } : null,
    onfocusout: layout ? e => {
      if (!relayout) return;
      relayout = false;
      const next = e.relatedTarget?.dataset?.key;
      rerender();
      const box = next && document.querySelector(`[data-key="${CSS.escape(next)}"]`);
      box?.focus();
      // A refocused box puts the caret at the start; select its contents
      // instead, so typing replaces the value as a fresh tap would suggest.
      if (box?.tagName === "INPUT") box.select();
    } : null,
  });
  // A choice that doesn't change the form (an item, a perk) still changes the
  // summary, so refresh that.
  const select = (key, obj, prop, options, again = true) => h("select", { "data-key": key,
      onchange: e => { set(obj, prop, again)(e); if (!again) refreshSummary(); } },
    options.map(([value, label]) => h("option", { value, selected: String(obj[prop] ?? "") === String(value) }, label)));
  // Adding something puts focus on its first box; removing it, on the button
  // that adds another. Otherwise the redraw would drop focus to the page.
  const focusOn = key => document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
  const remove = (list, i, what, addKey) => h("button", { type: "button", class: "btn quiet flush",
    onclick: () => { list.splice(i, 1); rerender(); focusOn(addKey); } }, `Remove ${what}`);
  const addButton = (key, label, onclick, firstKey, quiet = false) => h("button", { type: "button", class: quiet ? "chip quiet-chip" : "btn", "data-key": key,
    onclick: () => { onclick(); rerender(); focusOn(firstKey()); } }, icon("plus"), label);

  const active = characterOrder(data).filter(c => !c.retired);
  // Newcomers in this draft count as characters here: they can play tonight,
  // loot, shop and take perks. They play unless marked as sitting it out.
  const prosperityLevel = stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const newcomers = d.newCharacters.filter(x => String(x.name || "").trim()).map(x => {
    const level = Math.max(1, Math.min(prosperityLevel, num(x.level) || 1));
    return { name: x.name.trim(), class: x.class, xp: XP_FOR_LEVEL[level - 1], gold: startingGold(level), checkmarks: 0,
             perks: [], items: [], retired: false, perkBonus: Math.max(0, num(x.bonusPerks)), draft: x };
  });
  const party = [...active.filter(c => d.party.includes(c.name)), ...newcomers.filter(c => c.draft.playing !== false)];
  const partyOptions = [["", "Who?"], ...party.map(c => [c.name, c.name])];
  // Perks are taken in town, by anyone still adventuring.
  const activeOptions = [["", "Who?"], ...[...active, ...newcomers].map(c => [c.name, c.name])];
  const available = data.scenarios.filter(s => s.status === "available").sort((a, b) => a.number - b.number);

  // What the campaign would look like with this draft saved: the events'
  // outcomes come from the same rules the Event decks list uses.
  const after = res => d.events.some(e => num(e.number) && e.option)
    ? deriveCampaign(withDefaults(JSON.parse(JSON.stringify(res.out))), scenarioRef, classRef) : null;
  // Under an event's row: whether that card can be drawn, and once an option
  // is picked, what it did (only that option, so the other isn't spoiled).
  const eventNote = (e, i, derived) => {
    const n = num(e.number);
    if (!n) return "";
    const label = eventLabel(e.deck, n);
    if (!classRef?.events?.[e.deck]?.[String(n)]) return `${label} isn't in the event data.`;
    if (data.eventState?.decks?.[e.deck] && !data.eventState.decks[e.deck].has(n)) return `${label} isn't in the ${e.deck} deck now. Check the number.`;
    if (!e.option) return `${label}: pick the option you chose.`;
    const entry = derived?.history?.findLast(x => x.deck === e.deck && x.number === n);
    const said = [...(entry?.effects || []), entry?.fate ? `card ${entry.fate}` : null].filter(Boolean);
    return said.length ? `Option ${e.option}: ${said.join(", ")}` : `Option ${e.option}: depends on who was there; the Event decks list will ask.`;
  };

  // A scenario's name (with its rewards, on a success) under its number.
  const scenarioNameText = s => {
    const n = num(s.number);
    if (!n) return "";
    const info = scenarioRef?.scenarios?.[String(n)];
    if (!info) return "Not a scenario number.";
    const rewards = describeRewards(scenarioRef, info.rewards, classRef);
    const casual = isCasual(s, data);
    if (casual) return `${info.name} · casual mode: XP, gold, loot, battle goals and quest progress, but no rewards or unlocks`;
    return `${info.name}${s.result === "success" && rewards.length ? ` · rewards: ${rewards.join(", ")}` : ""}`;
  };
  // Playable scenarios not already in this draft.
  const pickable = i => available.filter(sc => !d.scenarios.some((x, j) => j !== i && num(x.number) === sc.number));
  // A scenario's treasure tiles not looted before or already in this row.
  const lootedTiles = new Set((rawCampaign?.scenarios || []).flatMap(sc => (sc.treasures || []).map(t => String(Number(typeof t === "object" ? t.number : t)))));
  const tilesLeft = (s, n) => (scenarioRef?.scenarios?.[String(n)]?.treasures || [])
    .filter(tile => !lootedTiles.has(tile) && !s.treasures.some(t => String(Number(t.number)) === tile));
  // Completed ones, to replay casually: shown on asking.
  const replayable = data.scenarios.filter(sc => sc.status === "completed").sort((a, b) => a.number - b.number);

  // What a character's row adds up to, kept current as the boxes are typed in.
  const gainText = (s, r) => {
    const g = scenarioGain(s, r, data);
    return `= ${g.xp} XP, ${g.gold} gold`;
  };
  const reward = n => scenarioRef?.scenarios?.[String(n)]?.rewards;
  const tracked = name => {
    const t = tableState(name);
    return t.xp || t.coins ? `${t.xp} XP, ${plural(t.coins, "coin")}` : null;
  };
  const scenarioBlock = (s, i) => {
    const n = num(s.number);
    s.level ??= String(draftLevel(s, data));
    const known = data.scenarios.find(x => x.number === n);
    const casualOk = Boolean(known);
    const casual = isCasual(s, data);
    const st = scenarioStats(draftLevel(s, data));
    return h("fieldset", { class: "card rec-block" },
      h("legend", {}, `Scenario ${i + 1}`),
      h("div", { class: "rec-row" },
        field("Number", text(`sc-${i}-n`, s, "number", { type: "number", min: 1, max: 95, list: "rec-available", inputmode: "numeric", "aria-label": "Scenario number" }, true), "short"),
        field("Level", select(`sc-${i}-l`, s, "level", Array.from({ length: 8 }, (_, l) => [String(l), String(l)]))),
        field("Result", select(`sc-${i}-r`, s, "result", [["success", "Success"], ["failure", "Failure"]]))),
      // Casual: a scenario already completed, replayed for XP, gold and loot.
      // Next to the result, as it changes what the scenario gives.
      casualOk ? h("label", { class: "rec-check" },
        h("input", { type: "checkbox", "data-key": `sc-${i}-casual`, checked: casual, onchange: set(s, "casual", true) }),
        "Casual mode: no rewards or unlocks, and its record stays as it was") : null,
      // Its name, kept current as you type; and while it's empty, the
      // scenarios the party can play, to tap (phones don't list a number
      // box's suggestions).
      h("p", { class: "small muted", "data-sc-name": i }, scenarioNameText(s)),
      !n && (pickable(i).length || replayable.length) ? h("div", { class: "rec-picks", "data-sc-picks": i, role: "group", "aria-label": "Playable scenarios" },
        [...pickable(i), ...(showReplays ? replayable : [])].map(sc => h("button", { type: "button", class: "chip", "data-key": `sc-${i}-pick-${sc.number}`,
          onclick: () => { s.number = String(sc.number); showReplays = false; rerender(); focusOn(party.length ? `sc-${i}-${party[0].name}-xp` : `sc-${i}-r`); } },
          hex(sc.number, sc.status === "completed" ? "completed" : ""), sc.name || `#${sc.number}`)),
        replayable.length && !showReplays ? h("button", { type: "button", class: "chip quiet-chip", "data-key": `sc-${i}-replays`,
          onclick: () => { showReplays = true; rerender(); focusOn(`sc-${i}-pick-${replayable[0].number}`); } },
          icon("replay"), "Replay a completed one") : null) : null,
      party.length ? h("div", { class: "rec-results" },
        h("span", { class: "label" }, "What each character gained there"),
        party.map(c => {
          s.results[c.name] ||= {};
          const r = s.results[c.name];
          return h("div", { class: "rec-row" },
            h("strong", { class: "rec-who" }, c.name),
            // XP as on the dial, plus the bonus on a success; coins picked up, each worth the level's gold.
            field(["XP", s.result === "success" ? h("b", { class: "field-op" }, ` +${st.xp}`) : null],
              text(`sc-${i}-${c.name}-xp`, r, "xp", { type: "number", min: 0, inputmode: "numeric", "aria-label": `${c.name}: XP on the dial${s.result === "success" ? `, plus ${st.xp} bonus` : ""}` }), "short"),
            // A draft from before coins were asked for keeps its gold box.
            filled(r.gold) && !filled(r.coins)
              ? field("Gold", text(`sc-${i}-${c.name}-gold`, r, "gold", { type: "number", min: 0, inputmode: "numeric", "aria-label": `${c.name}: gold` }), "short")
              : field(["Coins", h("b", { class: "field-op" }, ` ×${st.gold}`)],
                  text(`sc-${i}-${c.name}-coins`, r, "coins", { type: "number", min: 0, inputmode: "numeric", "aria-label": `${c.name}: coins, ${st.gold} gold each` }), "short"),
            // What this phone tracked at the table, to fill in with a tap.
            tracked(c.name) && !filled(r.xp) && !filled(r.coins) && !filled(r.gold)
              ? h("button", { type: "button", class: "chip rec-tracked", "data-key": `sc-${i}-${c.name}-tracked`,
                  onclick: () => { const t = tableState(c.name); r.xp = String(t.xp); r.coins = String(t.coins); rerender(); focusOn(`sc-${i}-${c.name}-xp`); } },
                  `From this phone: ${tracked(c.name)}`)
              : null,
            s.result === "success"
              ? field("Checkmarks", text(`sc-${i}-${c.name}-cm`, r, "checkmarks", { type: "number", min: 0, max: 3, inputmode: "numeric", "aria-label": `${c.name}: battle goal checkmarks` }), "short")
              : null,
            h("span", { class: "rec-gain", "data-gain": `${i}|${c.name}` }, gainText(s, r)));
        })) : null,
      // A reward item goes to one of the characters there: who takes it.
      s.result === "success" && !casual && rewardCopies(scenarioRef?.scenarios?.[String(n)]).length ? h("div", { class: "rec-results" },
        h("span", { class: "label" }, "Reward items"),
        // The scenario book sometimes says who: the reference data keeps it.
        (scenarioRef?.scenarios?.[String(n)]?.rewards?.hints?.items || []).map(t => h("p", { class: "small muted" }, t)),
        rewardCopies(scenarioRef?.scenarios?.[String(n)]).map((item, k) => {
          s.rewardTakers ||= [];
          return h("div", { class: "rec-row" },
            h("strong", { class: "rec-who" }, item),
            field("Taken by", select(`sc-${i}-rw${k}`, s.rewardTakers, k, partyOptions)));
        })) : null,
      // Rewards the party settles: gold to share, a location to choose.
      s.result === "success" && !casual && (reward(n)?.collectiveGold || reward(n)?.chooseLocation || reward(n)?.hints?.gold) ? h("div", { class: "rec-results" },
        h("span", { class: "label" }, "Rewards to settle"),
        reward(n)?.hints?.gold ? h("p", { class: "small muted" }, reward(n).hints.gold) : null,
        reward(n)?.collectiveGold ? h("div", { class: "rec-row" },
          h("strong", { class: "rec-who" }, `${reward(n).collectiveGold} gold to share`),
          party.map(c => field(c.name, text(`sc-${i}-rs-${c.name}`, (s.rewardShares ||= {}), c.name,
            { type: "number", min: 0, inputmode: "numeric", placeholder: "0", "aria-label": `${c.name}'s share` }), "short"))) : null,
        reward(n)?.chooseLocation ? field("New location", select(`sc-${i}-loc`, s, "chosen",
          [["", "Choose"], ...reward(n).chooseLocation.map(x => [x, scenarioLabel(data, Number(x))])])) : null) : null,
      // Treasures are looted on a failure too: what they give comes at once.
      h("div", { class: "rec-results" },
        h("span", { class: "label" }, "Treasures looted"),
        s.treasures.map((t, j) => h("div", { class: "rec-row" },
          field("Number", text(`sc-${i}-t${j}-n`, t, "number", { inputmode: "numeric", placeholder: "07", "aria-label": "Treasure number" }, true), "short"),
          field("Looted by", select(`sc-${i}-t${j}-c`, t, "character", partyOptions)),
          t.number ? h("span", { class: "small muted rec-note" }, treasureParts(scenarioRef, t.number).map(describeTreasurePart).join(", ") || "Not in the treasure index") : null,
          remove(s.treasures, j, "treasure", `add-treasure-${i}`))),
        // The scenario's own tiles, not yet looted or entered: tap one to add it.
        tilesLeft(s, n).length ? h("div", { class: "rec-picks", role: "group", "aria-label": "Treasure tiles in this scenario" },
          tilesLeft(s, n).map(tile => h("button", { type: "button", class: "chip", "data-key": `sc-${i}-tile-${tile}`,
            onclick: () => {
              let j = s.treasures.findIndex(t => !t.number);
              if (j < 0) { s.treasures.push({ number: "", character: "" }); j = s.treasures.length - 1; }
              s.treasures[j].number = tile;
              rerender(); focusOn(`sc-${i}-t${j}-c`);
            } }, `Treasure ${tile}`))) : null,
        addButton(`add-treasure-${i}`, "Add a treasure", () => s.treasures.push({ number: "", character: "" }),
          () => `sc-${i}-t${s.treasures.length - 1}-n`)),
      remove(d.scenarios, i, "scenario", "add-scenario"));
  };

  const firstPlayed = num(d.scenarios.find(s => num(s.number))?.number);
  const lastPlayed = num(d.scenarios.filter(s => num(s.number)).at(-1)?.number);
  // Paying for an event isn't a choice: the party pays if it has the gold.
  const payDefault = e => {
    const { could } = eventPayment(data, e.deck, num(e.number), e.option, party);
    return could === null ? "Not sure" : could ? "Yes (they had the gold)" : "No (not enough gold)";
  };
  const eventBlock = (e, i) => {
    const options = classRef?.events?.[e.deck]?.[String(num(e.number))];
    const pays = options && JSON.stringify(options).includes('"type":"pay');
    return h("div", { class: "rec-event" }, h("div", { class: "rec-row" },
      field("Deck", select(`ev-${i}-d`, e, "deck", [["city", "City"], ["road", "Road"]])),
      field("Number", text(`ev-${i}-n`, e, "number", { type: "number", min: 1, inputmode: "numeric", "aria-label": "Event number" }, true), "short"),
      field("Option", select(`ev-${i}-o`, e, "option", [["", "–"], ["A", "A"], ["B", "B"]])),
      // A road event is drawn on the way to a scenario: the first tonight
      // unless another is picked. A city event can come in town, between.
      field("Before", select(`ev-${i}-s`, e, "scenario",
        [["", e.deck === "road" ? (firstPlayed ? `${scenarioLabel(data, firstPlayed)} (the first)` : "Tonight's scenario")
              : firstPlayed ? `In town, before ${scenarioLabel(data, firstPlayed)}` : "In town"],
         ...d.scenarios.filter(s => num(s.number)).map(s => [num(s.number), scenarioLabel(data, num(s.number))]),
         // A city event back in town at the end of the evening.
         ...(e.deck === "city" && lastPlayed ? [["after", `Back in town, after ${scenarioLabel(data, lastPlayed)}`]] : [])])),
      pays ? field("Paid?", select(`ev-${i}-p`, e, "paid", [["", payDefault(e)], ["yes", "Yes"], ["no", "No"]])) : null,
      remove(d.events, i, "event", "add-event")),
      h("p", { class: "small muted", "data-ev-note": i }, eventNote(e, i, firstAfter)),
      shareRow(e, i));
  };
  // Gold the event gives the party to share, or makes it pay: how it was split.
  const shareRow = (e, i) => {
    const oc = chosenOutcome(data, classRef, e.deck, num(e.number), e.option, party.map(c => c.name),
                             e.paid === "yes" ? true : e.paid === "no" ? false : undefined);
    const fx = oc?.effects.find(x => x.type === "collectiveGold");
    if (!fx || !party.length) return null;
    e.shares ||= {};
    return h("div", { class: "rec-row" },
      h("strong", { class: "rec-who" }, `${Math.abs(fx.amount)} gold to ${fx.amount > 0 ? "share" : "pay"}`),
      party.map(c => field(c.name, text(`ev-${i}-share-${c.name}`, e.shares, c.name,
        { type: "number", min: 0, inputmode: "numeric", placeholder: "0", "aria-label": `${c.name}'s share` }), "short")));
  };

  const buyBlock = (b, i) => h("div", { class: "rec-row" },
    // Anyone in town can shop, playing tonight or not; newcomers too.
    field("Who", select(`buy-${i}-c`, b, "character", activeOptions)),
    field("Item", select(`buy-${i}-i`, b, "item", [["", "Pick an item"],
      ...(data.shop?.stock || []).filter(x => x.left > 0).map(x => [x.name, `${x.name} · ${x.price} gold`])], false)),
    remove(d.buys, i, "purchase", "add-buy"));
  const sellBlock = (b, i) => h("div", { class: "rec-row" },
    field("Who", select(`sell-${i}-c`, b, "character", activeOptions)),
    field("Item", select(`sell-${i}-i`, b, "item", [["", "Pick an item"],
      ...(data.characters.find(c => c.name === b.character)?.items || []).map(x => [x, x])], false)),
    remove(d.sells, i, "sale", "add-sell"));
  // Retiring: who, and the class their personal quest unlocks, picked by its
  // icon (the box's name would be a spoiler until it's opened).
  const unlocked = new Set(data.city.unlockedClasses.map(u => u.id));
  // Every class box, the still-closed ones first. A quest can point at a box
  // that's already open: that gives a random item design and a random side
  // scenario instead (rulebook p. 48).
  const boxes = Object.keys(classRef?.classes || {}).filter(id => !classRef.classEvents?.[id]?.starting);
  const locked = [...boxes.filter(id => !unlocked.has(id)), ...boxes.filter(id => unlocked.has(id))];
  const retireBlock = (x, i) => h("div", { class: "rec-row" },
    field("Who retires", select(`ret-${i}-c`, x, "character", activeOptions)),
    // Who played them: their next characters get a perk for each retirement (p. 48).
    field("Player (optional)", text(`ret-${i}-p`, x, "player", { autocomplete: "off", "aria-label": "Who played the retiring character",
      placeholder: data.characters.find(c => c.name === x.character)?.player || "" })),
    field("Their personal quest unlocks", select(`ret-${i}-u`, x, "unlocks",
      [["", "No class, or not yet"], ...locked.map(id => [id, `The class with the ${classIconName(id)} icon${unlocked.has(id) ? " (already open)" : ""}`]),
       ["envelope-x", `Envelope X${data.city.envelopeX ? " (already open)" : ""}`]]), "wide"),
    x.unlocks && x.unlocks !== "envelope-x" ? h("span", { class: "rec-note rec-icon" }, gameIcon(`class-${x.unlocks}`, `${classIconName(x.unlocks)} icon`)) : null,
    remove(d.retirements, i, "retirement", "add-retire"));
  // A newcomer: any unlocked class (or one unlocked tonight), at any level up
  // to the prosperity level, counting a checkmark for each retirement tonight
  // (as the save step does).
  const retiringTonight = d.retirements.filter(x => active.some(c => c.name === x.character)).length;
  // A player's retired characters, tonight's included: their newcomer's extra perks.
  const retiredByPlayer = player => {
    const name = String(player || "").trim().toLowerCase();
    if (!name) return 0;
    const playerOf = c => String(d.retirements.find(x => x.character === c.name)?.player || c.player || "").trim().toLowerCase();
    return data.characters.filter(c => playerOf(c) === name && (c.retired || d.retirements.some(x => x.character === c.name))).length;
  };
  const prosperity = stepFor(data.city.prosperityCheckmarks + retiringTonight, CHECKMARKS_FOR_PROSPERITY);
  d.advances ||= [];
  const behind = active.filter(c => characterStats(c).level < prosperity);
  const classOptions = [...new Set([...data.city.unlockedClasses.map(u => u.name),
    ...d.retirements.filter(x => x.unlocks).map(x => className(classRef, x.unlocks))])].sort();
  const newBlock = (x, i) => {
    const level = Math.max(1, Math.min(prosperity, num(x.level) || 1));
    return h("div", { class: "rec-row" },
      field("Name", text(`new-${i}-n`, x, "name", { autocomplete: "off" }, true), "wide"),
      field("Class", select(`new-${i}-c`, x, "class", [["", "Pick a class"], ...classOptions.map(n => [n, n])])),
      prosperity > 1 ? field("Level", select(`new-${i}-l`, x, "level", Array.from({ length: prosperity }, (_, l) => [String(l + 1), String(l + 1)]))) : null,
      // Each character their player has retired gives one more perk (p. 48):
      // counted from the player's name, or entered.
      field("Player (optional)", text(`new-${i}-p`, x, "player", { autocomplete: "off", "aria-label": "Who plays this character" })),
      field("Perks from retirements", text(`new-${i}-b`, x, "bonusPerks", { type: "number", min: 0, inputmode: "numeric",
        placeholder: String(retiredByPlayer(x.player)),
        "aria-label": "Extra perks: one for each character this player has retired" }), "short"),
      h("span", { class: "small muted rec-note" }, `Starts at level ${level} with ${XP_FOR_LEVEL[level - 1]} XP and ${startingGold(level)} gold`),
      remove(d.newCharacters, i, "new character", "add-new"));
  };

  const perkBlock = (p, i) => {
    const c = data.characters.find(x => x.name === p.character) || newcomers.find(x => x.name === p.character);
    return h("div", { class: "rec-row" },
      field("Who", select(`perk-${i}-c`, p, "character", activeOptions)),
      field("Perk", select(`perk-${i}-p`, p, "perk", [["", "Pick a perk"], ...(c ? perkCheck(c).open.map(x => [x.text, x.text]) : [])]), "wide"),
      remove(d.perks, i, "perk", "add-perk"));
  };

  // What the draft changes, with the download. Rebuilt on its own as you type.
  const summary = res => {
    const { out, log, warnings, evening, party: played } = res;
    const json = formatJson(out) + "\n";
    const edit = githubEditUrl(dataUrl());
    const download = () => {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = h("a", { href: url, download: "campaign.json" });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const copy = async e => {
      const button = e.currentTarget;
      try { await navigator.clipboard.writeText(json); button.textContent = "Copied"; }
      catch { button.textContent = "Couldn't copy"; }
    };
    if (!evening && !log.length) return h("div", { class: "card rec-block rec-summary" },
      h("h3", { class: "subtitle" }, "What changes"),
      warnings.map(w => nudge("question", "Check", w)),
      h("p", { class: "small muted" }, "Nothing recorded yet. What you enter above shows up here, ready to save."));
    return h("div", { class: "card rec-block rec-summary" },
      h("h3", { class: "subtitle" }, "What changes"),
      warnings.map(w => nudge("question", "Check", w)),
      h("ul", {}, [evening ? `A session on ${formatDate(d.date) || "an undated evening"} with ${played.join(", ") || "no one"}`
                           : "Between sessions: nothing is added to the session log", ...log].map(line => h("li", {}, line))),
      h("p", { class: "small muted" }, edit
        ? "Copy and edit on GitHub copies the new campaign.json and opens the file on GitHub, phones included: select everything there, paste, and commit. Or download it and put it in place of the old one."
        : "Download the new campaign.json and put it in place of the old one in the repository.",
        " Nothing is saved anywhere else; the draft stays in this browser until you discard it, or until the page finds it in campaign.json."),
      h("div", { class: "rec-buttons" },
        h("button", { type: "button", class: "btn primary", onclick: download }, "Download campaign.json"),
        edit ? h("a", { class: "btn", href: edit, target: "_blank", rel: "noopener",
                        onclick: () => { navigator.clipboard?.writeText(json).catch(() => {}); } }, "Copy and edit on GitHub") : null,
        h("button", { type: "button", class: "btn", onclick: copy }, "Copy to clipboard"),
        h("button", { type: "button", class: "btn quiet", onclick: () => { if (confirm("Discard this draft?")) { dropDraft(); render(data); } } }, "Discard draft")));
  };
  // A slim bar pinned above the form: how many checks are waiting, and a way
  // down to them, so they're seen while filling it in, not only at the end.
  // The count is a status: a screen reader hears it when it changes.
  const topBar = res => h("div", { class: "rec-top" },
    res.warnings.length
      ? h("span", { class: "rec-checks", role: "status" }, icon("question"), `${plural(res.warnings.length, "thing")} to check`)
      : h("span", { class: "muted", role: "status" }, "Nothing to check"),
    h("button", { type: "button", class: "btn quiet", onclick: () => document.querySelector(".rec-summary")?.scrollIntoView({ block: "start" }) },
      "See what changes"));
  const refreshSummary = () => {
    const res = applyDraft(rawCampaign, d, data);
    for (const el of document.querySelectorAll("[data-sc-name]")) {
      const s = d.scenarios[num(el.dataset.scName)];
      if (s) el.textContent = scenarioNameText(s);
    }
    const derived = after(res);
    for (const el of document.querySelectorAll("[data-ev-note]")) {
      const e = d.events[num(el.dataset.evNote)];
      if (e) el.textContent = eventNote(e, num(el.dataset.evNote), derived);
    }
    for (const el of document.querySelectorAll("[data-sc-picks]")) {
      el.hidden = filled(d.scenarios[num(el.dataset.scPicks)]?.number);
    }
    for (const el of document.querySelectorAll("[data-gain]")) {
      const [i, name] = el.dataset.gain.split("|");
      const s = d.scenarios[num(i)];
      if (s) el.textContent = gainText(s, s.results[name] || {});
    }
    // The button above the form says whether closing it keeps a draft.
    const close = document.querySelector('[data-key="rec-toggle"]');
    if (close) close.textContent = res.evening || res.log.length ? "Close the form (keep the draft)" : "Close the form";
    document.querySelector(".rec-summary")?.replaceWith(summary(res));
    // Only the count changes, in place, so it's announced once, not at
    // every keystroke.
    const status = document.querySelector(".rec-top [role=status]");
    const next = topBar(res).firstChild;
    if (status && status.textContent !== next.textContent) { status.className = next.className; status.replaceChildren(...next.childNodes); }
  };
  const first = applyDraft(rawCampaign, d, data);
  const firstAfter = after(first);

  // Every part of the form is a heading over its fields, the same way.
  return h("div", { class: "recorder" },
    // On a strip of page background, so nothing scrolling under it shows round it.
    h("div", { class: "rec-pin" }, topBar(first)),
    h("datalist", { id: "rec-available" }, available.map(s => h("option", { value: s.number }, `#${s.number} ${s.name || ""}`))),
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "The evening"),
      h("div", { class: "card rec-block" },
        h("div", { class: "rec-row" },
          field("Date", text("rec-date", d, "date", { type: "date" })),
          field("Title (optional)", text("rec-title", d, "title", { placeholder: "Under the date, or instead of it" }), "wide")),
        // A party without a name gets it here (a new campaign).
        !data.party.name || d.partyName ? field("Party name", text("rec-party-name", d, "partyName", { placeholder: "What the party calls itself" })) : null,
        h("div", { class: "field" },
          h("span", { id: "rec-who-label" }, "Who played"),
          h("div", { class: "filters", role: "group", "aria-labelledby": "rec-who-label" }, active.filter(c => !hiddenAway(c, d.party.includes(c.name))).map(c =>
            h("button", { type: "button", "data-key": `rec-who-${c.name}`, "aria-pressed": String(d.party.includes(c.name)),
                          onclick: () => { d.party = d.party.includes(c.name) ? d.party.filter(n => n !== c.name) : [...d.party, c.name]; rerender(); } },
              // Someone sitting out can still be marked: it brings them back.
              c.name, c.inactive ? h("span", {}, "inactive") : null)),
            newcomers.map((c, i) =>
              h("button", { type: "button", "data-key": `rec-who-new-${i}`, "aria-pressed": String(c.draft.playing !== false),
                            onclick: () => { c.draft.playing = c.draft.playing === false; rerender(); } },
                c.name, h("span", {}, "new"))),
            inactiveToggle(data, active.filter(c => hiddenAway(c, d.party.includes(c.name))).length, "rec-who-inactive"))))),
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "Scenarios"),
      d.scenarios.map(scenarioBlock),
      // A scenario a personal quest opens, ready to play next time.
      // Whose quest isn't asked: it would give the quest away.
      d.opened.length ? h("div", { class: "card rec-block" }, d.opened.map((o, i) => h("div", { class: "rec-row" },
        field("Opened by a quest: #", text(`open-${i}-n`, o, "number", { type: "number", min: 1, max: 95, inputmode: "numeric", "aria-label": "Scenario a personal quest opens" }, true), "short"),
        h("span", { class: "small muted rec-note" }, scenarioRef?.scenarios?.[String(num(o.number))]?.name || ""),
        remove(d.opened, i, "scenario", "add-opened")))) : null,
      h("div", { class: "rec-buttons" },
        addButton("add-scenario", "Add a scenario", () => d.scenarios.push(newScenario(data, party)), () => `sc-${d.scenarios.length - 1}-n`),
        // Rare: a few times a campaign, so quiet.
        addButton("add-opened", "A personal quest opens one", () => d.opened.push({ number: "" }), () => `open-${d.opened.length - 1}-n`, true))),
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "Events drawn"),
      d.events.length ? h("div", { class: "card rec-block" }, d.events.map(eventBlock)) : null,
      addButton("add-event", "Add an event", () => d.events.push(newEvent()), () => `ev-${d.events.length - 1}-d`)),
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "Retiring and joining"),
      d.retirements.length ? h("div", { class: "card rec-block" }, d.retirements.map(retireBlock)) : null,
      d.newCharacters.length ? h("div", { class: "card rec-block" }, d.newCharacters.map(newBlock)) : null,
      // Personal quest progress, for those who track it as "n/m".
      // The current progress is a secret, as on the sheet: tap to see it.
      active.length ? h("div", { class: "field" },
        h("span", {}, "Personal quests that moved"),
        h("div", { class: "rec-row" }, active.map(c => h("div", { class: "pq-field" },
          field(c.name, text(`pq-${c.name}`, d.quests, c.name,
            { autocomplete: "off", placeholder: "3/15", "aria-label": `${c.name}'s personal quest progress, if it changed, as 3/15, or 1/3, then 0/1` })),
          c.personalQuest ? h("button", { type: "button", class: "pq-now", "data-key": `pq-now-${c.name}`, "aria-expanded": String(questShown.has(c.name)),
              onclick: () => { toggleQuest(c.name); rerender(); focusOn(`pq-now-${c.name}`); } },
            questShown.has(c.name) || questDone(c.personalQuest) ? `Now ${c.personalQuest}` : [icon("eye"), "Now"]) : null)))) : null,
      // Anyone below the prosperity level may advance to it (p. 48).
      behind.length ? h("div", { class: "field" },
        h("span", { id: "rec-adv-label" }, `Advance to level ${prosperity}, the prosperity level`),
        h("div", { class: "filters", role: "group", "aria-labelledby": "rec-adv-label" }, behind.map(c =>
          h("button", { type: "button", "data-key": `adv-${c.name}`, "aria-pressed": String(d.advances.includes(c.name)),
            onclick: () => { d.advances = d.advances.includes(c.name) ? d.advances.filter(n => n !== c.name) : [...d.advances, c.name]; rerender(); } },
            c.name, h("span", {}, characterStats(c).level))))) : null,
      h("div", { class: "rec-buttons" },
        active.length ? addButton("add-retire", "Retire a character", () => d.retirements.push({ character: "", unlocks: "" }), () => `ret-${d.retirements.length - 1}-c`) : null,
        addButton("add-new", "Add a new character", () => d.newCharacters.push({ name: "", class: "", level: "1", playing: true }), () => `new-${d.newCharacters.length - 1}-n`))),
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "Shop, perks and the Sanctuary"),
      d.buys.length || d.sells.length || d.perks.length || d.donations.length || d.enhancements.length
        ? h("div", { class: "card rec-block" }, d.buys.map(buyBlock), d.sells.map(sellBlock), d.perks.map(perkBlock),
            d.donations.map((x, i) => h("div", { class: "rec-row" },
              field(`Donates ${DONATION} gold, for 2 Bless next scenario`, select(`don-${i}-c`, x, "character", partyOptions)),
              // Before tonight's scenario the Bless is used in it; after, it waits.
              firstPlayed ? field("When", select(`don-${i}-w`, x, "when", [["", `In town, before ${scenarioLabel(data, firstPlayed)}`], ["after", "Back in town, after it"]])) : null,
              remove(d.donations, i, "donation", "add-donation"))),
            // Enhancements, from the calculator's Record it.
            d.enhancements.map((x, i) => h("div", { class: "rec-row" },
              field("Who enhances", select(`enr-${i}-c`, x, "character", activeOptions)),
              h("span", { class: "small muted rec-note" }, `${x.what}: ${x.cost} gold`),
              remove(d.enhancements, i, "enhancement", "add-buy")))) : null,
      h("div", { class: "rec-buttons" },
        addButton("add-buy", "Buy an item", () => d.buys.push({ character: "", item: "" }), () => `buy-${d.buys.length - 1}-c`),
        addButton("add-sell", "Sell an item", () => d.sells.push({ character: "", item: "" }), () => `sell-${d.sells.length - 1}-c`),
        addButton("add-perk", "Take a perk", () => d.perks.push({ character: "", perk: "" }), () => `perk-${d.perks.length - 1}-c`),
        addButton("add-donation", "Donate to the Sanctuary", () => d.donations.push({ character: "" }), () => `don-${d.donations.length - 1}-c`)),
      !rawCampaign.city?.envelopeB && (rawCampaign.city?.donations || 0) + DONATION * d.donations.filter(x => x.character).length >= ENVELOPE_B_DONATIONS
        ? h("label", { class: "rec-check" },
            h("input", { type: "checkbox", "data-key": "rec-envelope-b", checked: Boolean(d.envelopeB), onchange: set(d, "envelopeB", true) }),
            "We opened Envelope B")
        : null),
    // Open questions about past treasures, settled here rather than by
    // editing campaign.json.
    (data.claims || []).length ? h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "Settling the record"),
      h("div", { class: "card rec-block" }, data.claims.map((c, i) => {
        const x = d.claims[`${c.where}:${c.treasure}`] ||= { character: "", kept: true };
        return h("div", { class: "rec-row" },
          h("strong", { class: "rec-who" }, `Treasure ${c.treasure} in ${c.where}: ${c.item}`),
          field("Looted by", select(`claim-${i}-c`, x, "character", [["", "Not settled"], ...data.characters.map(ch => [ch.name, ch.name])])),
          x.character ? h("label", { class: "rec-check" },
            h("input", { type: "checkbox", "data-key": `claim-${i}-k`, checked: x.kept !== false, onchange: set(x, "kept", true) }),
            `${x.character} still has it`) : null);
      }))) : null,
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle", id: "rec-notes-label" }, "Notes"),
      h("div", { class: "card rec-block" },
        h("textarea", { "data-key": "rec-notes", rows: 3, "aria-labelledby": "rec-notes-label", oninput: set(d, "notes") }, d.notes))),
    summary(first));
}

// --- Sessions -------------------------------------------------------------------

// What each character gained over an evening: the results of the scenarios
// completed in that session, added up.
function sessionHaul(data, session) {
  const totals = new Map();
  for (const played of session.scenarios) {
    // A failure or casual replay keeps its results with the session.
    if (played.results) {
      for (const r of played.results) {
        const total = totals.get(r.character) || { character: r.character, xp: 0, gold: 0 };
        total.xp += r.xp || 0;
        total.gold += r.gold || 0;
        totals.set(r.character, total);
      }
      continue;
    }
    if (played.result !== "success") continue;
    const entry = data.scenarios.find(s => s.number === played.number);
    if (!entry?.results) continue;
    if (entry.completed && session.date && entry.completed !== session.date) continue;
    for (const r of entry.results) {
      const total = totals.get(r.character) || { character: r.character, xp: 0, gold: 0 };
      total.xp += r.xp || 0;
      total.gold += r.gold || 0;
      totals.set(r.character, total);
    }
  }
  return [...totals.values()];
}

let recorderOpen = false;

function renderSessions(data) {
  const sorted = [...data.sessions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const history = data.eventState?.history || [];
  // An event drawn on the way to a scenario, or in town around it, as a row
  // of its own in the evening's order: a small card, then what it did.
  const eventRow = e => h("li", { class: "played-event" },
    h("a", { class: "played-link", href: "#events" },
      h("span", { class: `ev-card ${e.deck}`, "aria-hidden": "true" }, h("b", {}, e.number)),
      h("span", { class: "played-text" },
        // The card shows the number; the words say which deck.
        h("strong", {}, h("span", { class: "sr-only" }, `${e.label}: `), `${DECK_NAMES[e.deck]} event`),
        e.effects.length ? h("span", {}, capitalize(e.effects.join(", "))) : null)),
    optionBadge(e));
  // Which session each event was drawn in: the one dated as it is; failing
  // that (an event saved before events carried a date), the first session
  // that played the scenario it came before or after. Each shows in one only.
  const chrono = [...sorted].reverse();
  const playedIn = (s, n) => (s.scenarios || []).some(x => x.number === n);
  const home = new Map();
  for (const e of history) {
    const s = (e.date && sorted.find(x => x.date === e.date))
      || (e.scenario != null && chrono.find(x => playedIn(x, e.scenario)))
      || (e.after != null && chrono.find(x => playedIn(x, e.after)));
    if (s) home.set(e, s);
  }
  const toggle = () => {
    if (!draft) draft = newDraft(data);
    recorderOpen = !recorderOpen;
    // Closing a form with nothing in it leaves no draft behind.
    if (!recorderOpen && !draftChanges(draft, data)) dropDraft(); else saveDraft();
    render(data);
  };
  const head = h("div", { class: "section-head" },
    h("h2", {}, "Sessions"),
    rawCampaign ? h("button", { type: "button", class: `btn${recorderOpen ? "" : " primary"}`, "data-key": "rec-toggle", onclick: toggle },
      recorderOpen ? (draftChanges(draft, data) ? "Close the form (keep the draft)" : "Close the form")
        : draftChanges(draft, data) ? "Go on recording" : "Record a session") : null);

  // Wide screens: an open form takes the full width, Event decks below it.
  document.querySelector(".pair")?.classList.toggle("form-open", recorderOpen && Boolean(draft));
  const saved = savedDraft ? formatDate(savedDraft.date) || savedDraft.title || "an undated evening" : null;
  return [
    head,
    saved ? nudge("check", "Saved", `What you recorded on ${saved} is in campaign.json now, so its draft has been cleared.`, "saved") : null,
    recorderOpen && draft ? renderRecorder(data) : null,
    sorted.length ? null : empty("No sessions recorded yet."),
    sorted.length ? h("p", { class: "aside" }, "Newest first") : null,
    h("div", {}, sorted.map(s => {
      const haul = sessionHaul(data, s);
      const rows = playedRows(s);
      const long = formatDate(s.date, { day: "numeric", month: "long", year: "numeric" });
      return h("article", { class: "session" },
        h("div", { class: "rail", "aria-hidden": "true" }, h("i")),
        h("div", { class: "session-body" },
          h("div", {},
            // One style: the date heads a session, so the timeline reads by
            // date; a title goes on the line under it. Only an undated
            // session is headed by its title.
            h("h3", {}, long || s.title || "Undated session"),
            h("p", {}, [
              long && s.title ? s.title : null,
              s.date ? formatDate(s.date, { weekday: "long" }) : "Undated",
              s.characters?.length ? s.characters.join(", ") : null,
            ].filter(Boolean).join(" · "))),
          rows.length ? h("ul", { class: "card played" }, rows) : null,
          haul.length ? h("div", { class: "haul" },
            h("h4", { class: "label" }, "The evening's haul"),
            resultsList(haul, "+")) : null,
          notes(s.notes)));
    })),
  ];

  // A session's scenarios in the order played, each with the events drawn
  // on the way to it or back in town after it; events from an evening in
  // town only, or tied to no scenario that evening, come last.
  function playedRows(s) {
    const mine = history.filter(e => home.get(e) === s);
    const used = new Set();
    const take = test => mine.filter(e => !used.has(e) && test(e)).map(e => { used.add(e); return e; });
    const rows = (s.scenarios || []).flatMap(sc => [
      take(e => e.scenario === sc.number).map(eventRow),
      scenarioRow(sc),
      take(e => e.scenario == null && e.after === sc.number).map(eventRow),
    ]).flat();
    return [...rows, ...take(() => true).map(eventRow)];
  }

  function scenarioRow(sc) {
    const name = data.scenarios.find(x => x.number === sc.number)?.name;
    const won = sc.result === "success";
    const replay = won && sc.casual;
    const meta = [sc.level != null ? `Level ${sc.level}` : null].filter(Boolean);
    const outcome = !won ? "Failed" : replay ? "Replayed casually" : null;
    // The scenario opens under Scenarios.
    return h("li", {},
      h("a", { class: "played-link", href: "#scenarios", onclick: () => openScenario(data, sc.number) },
        hex(sc.number, !won ? "failed" : replay ? "replay" : "completed"),
        h("span", { class: "played-text" },
          h("strong", {}, name || `Scenario ${sc.number}`),
          outcome || meta.length ? h("span", {},
            outcome ? h("b", { class: won ? "ink-replay" : "ink-failed" }, outcome) : null,
            outcome && meta.length ? " · " : null, meta.join(" · ")) : null)),
      // Failures and replays say so in words; a plain clear says it here.
      h("span", { class: `result ${!won ? "failure" : replay ? "replay" : "success"}`,
        ...(outcome ? { "aria-hidden": "true" } : { role: "img", "aria-label": "Success" }) },
        icon(!won ? "cross" : replay ? "replay" : "check")));
  }
}

// --- Tabs and loading -----------------------------------------------------------

const RENDERERS = {
  overview: renderOverview,
  characters: renderCharacters,
  shop: renderShop,
  scenarios: renderScenarios,
  sessions: renderSessions,
  events: renderEvents,
  record: renderRecord,
};

// Which tab each section belongs to on a phone: an evening at the table, in
// order. Tonight sets up the scenario, Play is this phone's character, Town
// is the Shop after, and Campaign is the rest of the record, to look up.
const TAB_OF = { overview: "tonight", characters: "play", shop: "town",
                 campaign: "campaign", scenarios: "campaign", sessions: "campaign", events: "campaign", record: "campaign" };
// The addresses that open a tab at its top rather than at a section in it.
const TAB_TOPS = ["overview", "characters", "shop", "campaign"];

function currentTab() {
  const id = location.hash.slice(1);
  return id.startsWith("scenario-") ? "campaign" : TAB_OF[id] || "tonight";
}

function render(data, only) {
  // Redrawing replaces the buttons, so put focus and the map's scroll back.
  const key = document.activeElement?.dataset?.key;
  const mapScroll = document.querySelector(".map-scroll")?.scrollLeft;
  const switchScroll = document.querySelector(".char-switch")?.scrollLeft;

  for (const [id, fn] of Object.entries(RENDERERS)) {
    if (only && id !== only) continue;
    const nodes = [fn(data)].flat(Infinity).filter(Boolean);
    const panel = document.getElementById(id);
    panel.replaceChildren(...nodes);
    panel.hidden = !nodes.length;
  }

  packGrids();
  if (key) document.querySelector(`[data-key="${key}"]`)?.focus({ preventScroll: true });
  const map = document.querySelector(".map-scroll");
  if (map && mapScroll) map.scrollLeft = mapScroll;
  // The first time the map is drawn wider than its box, scroll so the
  // picked scenario (usually the newest, at the deep end) is in view.
  else if (map && map.scrollWidth > map.clientWidth) {
    const picked = map.querySelector('.node[aria-pressed="true"]');
    const over = picked ? picked.getBoundingClientRect().right - map.getBoundingClientRect().right : 0;
    if (over > 0) map.scrollLeft = over + 28;
  }
  // The phone's character row scrolls when the party is big: keep its place,
  // and keep the picked character in view.
  const row = document.querySelector(".char-switch");
  if (row && row.scrollWidth > row.clientWidth) {
    if (switchScroll) row.scrollLeft = switchScroll;
    const picked = row.querySelector('[aria-pressed="true"]');
    if (picked) {
      const b = picked.getBoundingClientRect(), r = row.getBoundingClientRect();
      if (b.right > r.right) row.scrollLeft += b.right - r.right + 8;
      else if (b.left < r.left) row.scrollLeft -= r.left - b.left + 8;
    }
  }
}

// Wide screens: pack the character sheets like bricks (see .char-grid.packed
// in styles.css). Each card spans as many 1px rows as it is tall, plus the
// gap; auto-placement keeps the party's order and puts each sheet in the
// first place it fits. A card that changes size (fonts loading, a wider
// window, a phone with one sheet showing) is measured again.
const CARD_GAP = 16;   // matches .char-grid's gap
const spanCard = card => { card.style.gridRowEnd = `span ${Math.ceil(card.getBoundingClientRect().height) + CARD_GAP}`; };
const packer = typeof ResizeObserver === "function" ? new ResizeObserver(entries => entries.forEach(e => spanCard(e.target))) : null;
function packGrids() {
  if (!packer) return;
  packer.disconnect();
  for (const grid of document.querySelectorAll(".char-grid")) {
    for (const card of grid.children) { spanCard(card); packer.observe(card); }
    grid.classList.add("packed");
  }
}

// On a phone, show the current tab's sections and hide the rest.
function showTab() {
  const tab = currentTab();
  // A section can belong to more than one tab ("tonight campaign").
  for (const el of document.querySelectorAll("main [data-tab]")) el.classList.toggle("off", !el.dataset.tab.split(" ").includes(tab));
  for (const a of document.querySelectorAll(".tabs a[data-tab]")) {
    if (phone.matches && a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else if (a.getAttribute("aria-current") === "page") a.removeAttribute("aria-current");
  }
  markSection();
}

// Wide screens: the top bar marks the section being read, the last one whose
// top has reached the top third of the window (two side by side count as the
// first). At the very bottom, the last section, which may never get there.
function markSection() {
  const links = [...document.querySelectorAll('.tabs a[href^="#"]')];
  let here = null;
  if (!phone.matches) {
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    let top = null;
    for (const a of links) {
      const section = document.getElementById(a.hash.slice(1));
      if (!section || section.hidden) continue;
      const y = Math.round(section.getBoundingClientRect().top);
      if (atEnd) here = a;
      else if (y <= Math.max(140, window.innerHeight / 3) && y !== top) { here = a; top = y; }
    }
    here ||= links[0];
    // A section just picked from the bar wins while it's in view: Event decks
    // sits beside Sessions, so it would otherwise never be marked.
    const picked = links.find(a => a.hash === location.hash);
    const box = picked && document.getElementById(picked.hash.slice(1))?.getBoundingClientRect();
    if (box && box.top <= Math.max(140, window.innerHeight / 3) && box.bottom > 140) here = picked;
  }
  for (const a of links) {
    if (a === here) a.setAttribute("aria-current", "location");
    else if (a.getAttribute("aria-current") === "location") a.removeAttribute("aria-current");
  }
}

function watchSections() {
  let queued = false;
  window.addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; markSection(); });
  }, { passive: true });
  markSection();
}

function onNavigate() {
  showTab();
  if (pendingScenario != null) {
    const number = pendingScenario;
    pendingScenario = null;
    revealScenario(number);
    return;
  }
  // Wide screens scroll to the section by themselves. A phone has just
  // swapped what is on screen, so start the new tab from its top.
  if (!phone.matches) return;
  const id = location.hash.slice(1);
  // A section further down the tab is jumped to, not glided to: what's above
  // it has only just appeared.
  if (TAB_TOPS.includes(id) || !id) window.scrollTo({ top: 0, behavior: "instant" });
  else document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
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

// ?data=examples/sample-campaign.json shows another file from this site (for testing).
// On GitHub Pages (owner.github.io/repo/), the GitHub page that edits the
// campaign file, so a phone at the table can commit a session itself.
// Anywhere else (a local copy), there's no repository to point at: null.
function githubEditUrl(file, at = location) {
  const owner = at.hostname.match(/^([^.]+)\.github\.io$/i)?.[1];
  const repo = at.pathname.split("/")[1];
  if (!owner || !repo || !file.pathname.startsWith(`/${repo}/`)) return null;
  return `https://github.com/${owner}/${repo}/edit/main/${file.pathname.slice(repo.length + 2)}`;
}

function dataUrl() {
  const requested = new URLSearchParams(location.search).get("data");
  if (requested) {
    const url = new URL(requested, location.href);
    if (url.origin === location.origin) return url;
  }
  return new URL("campaign.json", location.href);
}

// Reference data. Without it the tracker still works, showing only what
// campaign.json lists.
async function loadReference(path) {
  try {
    // Checked with the server each time (cheap when unchanged), so a phone
    // picks up refreshed reference data rather than an old cached copy.
    const response = await fetch(path, { cache: "no-cache" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function start() {
  const status = document.getElementById("status");
  const url = dataUrl();
  try {
    const [response, ref, evRef, items, quests] = await Promise.all([
      fetch(url, { cache: "no-cache" }),
      loadReference("data/gloomhaven-scenarios.json"),
      loadReference("data/gloomhaven-events.json"),
      loadReference("data/gloomhaven-items.json"),
      loadReference("data/gloomhaven-quests.json"),
    ]);
    itemsRef = items;
    questRef = quests;
    classRef = evRef;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const json = await response.json();
    rawCampaign = JSON.parse(JSON.stringify(json));
    scenarioRef = ref;
    draft = loadDraft();
    // Once the downloaded file has been committed, the draft is in
    // campaign.json: clear it, so it isn't recorded (and counted) twice.
    if (draft && draftIsSaved(draft, rawCampaign)) {
      savedDraft = draft;
      dropDraft();
    }
    const data = withDefaults(json);
    const derived = deriveCampaign(data, ref, evRef);
    data.eventState = evRef ? derived : null;
    data.ledger = derived.totals;
    data.party.reputation = derived.totals.reputation.value;
    data.city.prosperityCheckmarks = derived.totals.prosperity.value;
    data.party.achievements = derived.record.party;
    data.city.globalAchievements = derived.record.global;
    data.city.itemDesigns = derived.record.designs;
    data.city.unlockedClasses = derived.record.classes;
    data.draws = derived.record.draws;
    data.foundItems = derived.record.found;
    data.claims = derived.record.claims;
    data.treasureInfo = derived.record.treasures;
    data.scenarios = deriveScenarios(data, ref, derived.unlocks, evRef);
    data.shop = deriveShop(data, items, data.ledger);

    if (data.party.name) {
      document.getElementById("title").textContent = data.party.name;
      document.getElementById("title").title = data.party.name;   // in full, if the bar cuts it short
      document.title = `${data.party.name} · Gloomhaven`;
    }
    document.getElementById("footer").replaceChildren(
      [data.edition, data.updated ? `updated ${formatDate(data.updated)}` : null,
       url.pathname.endsWith("/campaign.json") ? null : `showing ${url.pathname}`].filter(Boolean).join(" · "),
      h("br"),
      ...(ref ? ["Scenario data from ", h("a", { href: ref.source }, "Gloomhaven Secretariat"), ` (${ref.license}). `]
              : ["Scenario reference data couldn't be loaded. "]),
      "Icons from the Gloomhaven Creator Pack by Isaac Childres (",
      h("a", { href: "https://creativecommons.org/licenses/by-nc-sa/4.0/" }, "CC BY-NC-SA 4.0"), "), converted to SVG. ",
      "Unofficial fan project; Gloomhaven is © Cephalofair Games.");

    // A phone opens on its player's sheet, unless the link was to somewhere else.
    const mine = characterOrder(data).findIndex(c => !c.retired && c.name === me);
    if (mine >= 0) characterIndex = mine;
    if (phone.matches && mine >= 0 && location.hash.length <= 1) history.replaceState(null, "", "#characters");

    if (draft && !draftChanges(draft, data)) dropDraft();
    render(data);
    status.remove();
    showTab();
    watchSections();
    // Not asked yet, or their character has since retired: ask.
    if (phone.matches && me !== "" && mine < 0) askWho(data);
    myTab(data);
    // The Play tab is this phone's home: from anywhere, even another
    // character's sheet, it goes back to its player's sheet.
    document.querySelector('.tabs a[data-tab="play"]')?.addEventListener("click", () => {
      const i = characterOrder(data).findIndex(c => !c.retired && c.name === me);
      if (!phone.matches || i < 0) return;
      if (characterIndex !== i) { characterIndex = i; render(data, "characters"); }
      if (location.hash === "#characters") window.scrollTo({ top: 0, behavior: "instant" });
    });
    window.addEventListener("hashchange", onNavigate);
    // Skip to content: to the page itself, without changing the address (which
    // on a phone would change the tab).
    document.querySelector(".skip")?.addEventListener("click", e => {
      e.preventDefault();
      const main = document.querySelector("main");
      main.setAttribute("tabindex", "-1");
      main.focus();
    });
    phone.addEventListener("change", showTab);
    // Arriving on a link to a section: go there now that it exists.
    if (location.hash.length > 1) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (err) {
    // Nothing to show, so say what probably went wrong and drop the menu,
    // whose links would lead nowhere.
    const requested = new URLSearchParams(location.search).has("data");
    const hint = location.protocol === "file:"
      ? "The page was opened straight from a file, and browsers won't let it read campaign.json that way. Run a small web server in the folder (py -m http.server 8000) and open http://127.0.0.1:8000/."
      : err instanceof SyntaxError
        ? "The file isn't valid JSON. A missing comma or quote is the usual cause; the error above says where."
        : requested
          ? "Check the file named after ?data= in the address exists, or open the page without it."
          : "campaign.json should sit next to index.html.";
    // On the live site, the file's history on GitHub has the last good
    // version; and a draft in this browser is safe until the file loads.
    const history = githubEditUrl(url)?.replace("/edit/", "/commits/");
    const unsaved = loadDraft();
    status.classList.add("error");
    status.replaceChildren(...[
      h("strong", {}, "Couldn't load the campaign"),
      h("span", {}, `${url.pathname}: ${err.message}`),
      h("span", {}, hint),
      history && err instanceof SyntaxError
        ? h("span", {}, "To go back to the last version that worked, open ", h("a", { href: history }, "the file's history on GitHub"), ".") : null,
      unsaved ? h("span", {}, "What you recorded on this phone is still here, and comes back once the file loads.") : null,
    ].filter(Boolean));
    document.querySelector(".tabs")?.style.setProperty("display", "none");
    document.getElementById("footer").hidden = true;
  }
}

start();
