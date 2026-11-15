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
  const base = e.key === "hex" ? Math.ceil(200 / hexes) : e.base;
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
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.600 2.200c-.700.400-1.100 1-1.100 1.800"/><path d="M12 17h.010"/>',
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
  return h("span", { class: `hex ${kind}`.trim() }, h("span", {}, text));
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
  const earned = perksEarned(level, c.checkmarks);
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
  const name = data.scenarios.find(s => s.number === number)?.name;
  return `#${number}${name ? ` ${name}` : ""}`;
}

// Active characters first, then retired: the order the character picker uses.
function characterOrder(data) {
  return [...data.characters.filter(c => !c.retired), ...data.characters.filter(c => c.retired)];
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
    h("summary", {}, isExact(t.range) ? `From ${plural(t.entries.length, "source")}`
      : `Could be ${rangeText(t.range)}: ${[t.unsure.length ? `${t.unsure.join(", ")} not settled` : null,
                                           t.unknown?.length ? `${t.unknown.join(", ")} not known` : null].filter(Boolean).join("; ")}`),
    h("ul", {}, t.entries.map(e => h("li", {},
      h("span", {}, e.label),
      h("span", { class: "num" }, `${rangeText(e.range)}${unit}`)))));
}

// The track marks where shop prices change (every 4 points past ±3), shades
// the stretch with today's prices, and labels the next step in brass.
function reputationTile(party, ledger) {
  const rep = party.reputation;
  const modifier = shopModifier(rep);
  const next = nextShopStep(rep);
  const at = r => `${Math.max(0, Math.min(100, (r + 20) / 40 * 100))}%`;
  const place = (el, r) => { el.style.left = at(r); return el; };
  let lo = rep, hi = rep;
  while (lo > -20 && shopModifier(lo - 1) === modifier) lo--;
  while (hi < 20 && shopModifier(hi + 1) === modifier) hi++;
  const band = place(h("b", { class: "band" }), lo);
  band.style.width = `${(hi - lo) / 40 * 100}%`;
  const steps = [3, 7, 11, 15, 19].flatMap(r => [-r, r]).map(r => place(h("i", { class: next?.at === r ? "next" : null }), r));
  const said = `Reputation ${signed(rep)}: shop ${modifier === 0 ? "prices normal" : priceText(modifier)}${next ? `, ${priceText(next.modifier)} from ${signed(next.at)}` : ""}.`;
  // The next step's label; the ends give way to it when it's near them.
  const near = next && Math.abs(next.at) > 14;
  return h("div", { class: "card tile" },
    h("div", { class: "tile-top" }, h("span", { class: "label" }, "Reputation"), h("span", { class: "figure" }, signed(rep))),
    h("div", { role: "img", "aria-label": said },
      h("div", { class: "track" }, band, steps, place(h("span", { class: "marker" }), rep)),
      h("div", { class: "track-scale", "aria-hidden": "true" },
        near && next.at < 0 ? null : h("span", {}, "−20"),
        next ? place(h("span", { class: "step" }, `${signed(next.modifier)} gold`), next.at) : null,
        near && next.at > 0 ? null : h("span", {}, "+20"))),
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

function prosperityTile(city, ledger) {
  const level = stepFor(city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const toNext = progressFor(city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const from = CHECKMARKS_FOR_PROSPERITY[level - 1];
  return h("div", { class: "card tile" },
    h("div", { class: "tile-top" }, h("span", { class: "label" }, "Prosperity"), h("span", { class: "figure" }, level)),
    toNext ? h("div", { class: "ticks", role: "img",
        "aria-label": `${city.prosperityCheckmarks - from} of ${toNext.next - from} checkmarks towards prosperity ${level + 1}` },
      Array.from({ length: toNext.next - from }, (_, i) => h("span", { class: i < city.prosperityCheckmarks - from ? "on" : null }))) : null,
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
  const active = data.characters.filter(c => !c.retired).map(c => c.name);
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
  const active = characterOrder(data).filter(c => !c.retired);
  if (!active.length) return null;
  if (!levelParty) levelParty = defaultLevelParty(data);
  const playing = active.filter(c => levelParty.has(c.name));
  const levels = playing.map(c => characterStats(c).level);
  const recommended = recommendedLevel(levels);
  const shift = DIFFICULTIES.find(([key]) => key === difficulty)[2];
  const level = Math.max(0, Math.min(7, recommended + shift));
  const st = scenarioStats(level);
  const prosperity = stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const toggle = name => {
    if (levelParty.has(name)) levelParty.delete(name); else levelParty.add(name);
    render(data);
  };
  const stat = (label, value) => h("div", {}, h("span", { class: "label" }, label), h("span", { class: "num" }, value));

  return h("div", { class: "card tile level-tile" },
    h("div", { class: "tile-top" },
      h("span", { class: "label" }, "Scenario level"),
      h("span", { class: "figure" }, playing.length ? level : "–")),
    h("div", { class: "filters", role: "group", "aria-label": "Who is playing" }, active.map(c =>
      h("button", { type: "button", "data-key": `playing-${c.name}`, "aria-pressed": String(levelParty.has(c.name)),
                    onclick: () => toggle(c.name) },
        c.name, h("span", {}, characterStats(c).level)))),
    playing.length ? [
      h("div", { class: "segmented", role: "group", "aria-label": "Difficulty" }, DIFFICULTIES.map(([key, label]) =>
        h("button", { type: "button", "data-key": `difficulty-${key}`, "aria-pressed": String(difficulty === key),
                      onclick: () => { difficulty = key; render(data); } }, label))),
      h("div", { class: "level-stats" },
        stat("Monsters", `Level ${st.monsters}`), stat("Gold per coin", st.gold),
        stat("Trap damage", st.trap), stat("Bonus XP", st.xp)),
    ] : h("p", { class: "small muted" }, "Pick who is playing."),
    h("div", { class: "tile-foot" },
      h("strong", {}, playing.length
        ? `Average level ${(levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1).replace(/\.0$/, "")}, so ${recommended} on normal`
        : "No one picked"),
      h("span", {}, `New characters start at level ${prosperity === 1 ? "1" : `1 to ${prosperity}`} with ${startingGold(1)}${prosperity > 1 ? ` to ${startingGold(prosperity)}` : ""} gold`)));
}

// Phones: the sections that share a tab but sit far below, as links.
function furtherDown(links) {
  return h("nav", { class: "jump", "aria-label": "Further down this tab" },
    h("span", {}, "Further down:"), links.map(([href, label]) => h("a", { href }, label)));
}

// A few hexes behind the party name, on phones.
function heroDecor() {
  const at = (cx, cy) => [[0, -26], [22.5, -13], [22.5, 13], [0, 26], [-22.5, 13], [-22.5, -13]]
    .map(([dx, dy]) => `${cx + dx},${cy + dy}`).join(" ");
  const cells = [[45, 26], [90, 26], [135, 26], [67.5, 65], [112.5, 65, "lit"], [157.5, 65], [135, 104]];
  return svg("0 0 182 132",
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
        furtherDown([["#events", "Event decks"], ["#record", "Campaign record"]])),
      // Tiles first: the left column reads first on wide screens. The right
      // column pairs what to play with what to sort out before playing.
      // Phones show Ready to play, then the tiles, then the list (styles.css).
      h("div", { class: "tiles" }, reputationTile(party, data.ledger), prosperityTile(city, data.ledger), levelTile(data)),
      h("div", { class: "hero-side" },
        h("div", { class: "ready" },
          h("div", { class: "ready-head" },
            h("h2", {}, "Ready to play"),
            h("a", { href: "#scenarios" }, data.scenarios.length > 1 ? `All ${data.scenarios.length} scenarios` : "Scenarios")),
          ready.length
            ? h("div", { class: "ready-list" }, ready.map(s =>
                h("a", { class: "ready-card", href: "#scenarios", onclick: () => openScenario(data, s.number) },
                  hex(s.number),
                  h("span", {},
                    h("span", { class: "ready-name" }, s.name || "Untitled"),
                    from(s) ? h("span", { class: "ready-from" }, from(s)) : null))))
            : empty("Nothing is unlocked to play right now.")),
        todoList(data))),
    partyList(data),
  ];
}

// Everything waiting on the party before the next scenario, gathered from
// the sections that work it out. Each entry links to where it's handled.
function todoItems(data) {
  const items = [];
  // place: what the link says, if not the section's name.
  const add = (text, href, onclick, action, place) => items.push({ text, href, onclick, action, place });
  const order = characterOrder(data);

  if (draft) add("What's been recorded on this phone isn't saved yet: download it from Sessions and commit it.", "#sessions");

  // No one adventuring yet (a new campaign): nothing can happen until there is.
  if (!order.some(c => !c.retired) && !draft?.newCharacters?.some(x => x.name)) {
    add("The party has no characters yet. Add them, and they can play the first scenario in the same session.", "#sessions", null,
      rawCampaign ? { label: "Add them", run: () => addNewcomer(data) } : null);
  }

  // Who passed a level in the last session: a new ability card to pick. It
  // stays until the next session is recorded, as there's nowhere to tick it.
  const levelUps = lastLevelUps(data);

  for (const c of order.filter(c => !c.retired)) {
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
    // A perk already picked in the session being recorded isn't asked for again.
    const left = perksLeft(c);
    if (left) add(`${c.name} has ${plural(left, "perk")} to choose.`, "#characters", go,
      { label: "Record it", run: () => recordPerk(data, c.name) }, sheet);
    for (const r of perkCheck(c).rows.filter(r => r.note && !r.quiet)) add(`${c.name}: "${r.written}". ${r.note}`, "#characters", go, null, sheet);
    for (const problem of itemCheck(c, st.level)) add(`${c.name}: ${problem}`, "#characters", go, null, sheet);
  }

  for (const d of data.draws || []) add(`Draw ${d.what} (${d.from}).`, "#record");

  // Events with no option recorded go together; other questions one by one.
  const questions = data.eventState?.questions || [];
  const noOption = questions.filter(q => /: which option did you choose/.test(q)).map(q => q.split(":")[0]);
  if (noOption.length) {
    add(`${noOption.join(", ")}: ${noOption.length === 1 ? "no option recorded" : "no options recorded"}, so reputation${data.shop?.pricesUnsure ? " and shop prices" : ""} can't be settled.`, "#events");
  }
  for (const q of questions.filter(q => !/: which option did you choose/.test(q))) add(q.replace(/^(Ledger|Record): /, ""), "#events");

  for (const q of data.shop?.questions || []) add(q, "#shop");

  if (!data.city.envelopeB && data.city.donations >= ENVELOPE_B_DONATIONS) add("Donations have reached 100 gold: Envelope B can be opened.", "#overview");
  return items;
}

// Who passed a level in the last session played, and to which: each owes a
// new ability card until the next session is recorded.
function lastLevelUps(data) { return [...data.sessions].reverse().find(s => s.scenarios?.length)?.levelUps || []; }

// Perks picked in the session being recorded, not yet in campaign.json.
function draftedPerks(name) { return (draft?.perks || []).filter(p => p.character === name && p.perk).length; }
// Perks still to choose, leaving out those already picked in the draft.
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
  recorderOpen = true;
  saveDraft();
  render(data);
  location.hash = "sessions";
  setTimeout(() => {
    const box = document.querySelector(`[data-key="new-${i}-n"]`);
    box?.scrollIntoView({ block: "center" });
    box?.focus({ preventScroll: true });
  }, 80);
}

// "Record it": open the recorder with a perk row for this character, ready
// to pick the perk.
function recordPerk(data, name) {
  if (!draft) draft = newDraft(data);
  let i = draft.perks.findIndex(p => p.character === name && !p.perk);
  if (i < 0) { draft.perks.push({ character: name, perk: "" }); i = draft.perks.length - 1; }
  recorderOpen = true;
  saveDraft();
  render(data);
  location.hash = "sessions";
  // After the tab switch (phones) or the scroll to Sessions (wide screens).
  setTimeout(() => {
    const box = document.querySelector(`[data-key="perk-${i}-p"]`);
    box?.scrollIntoView({ block: "center" });
    box?.focus({ preventScroll: true });
  }, 80);
}

// Wide screens show every sheet: bring this character's into view.
function revealCharacter(name) {
  document.querySelector(`.char-card[data-char="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "start" });
}

function todoList(data) {
  const items = todoItems(data);
  return h("div", { class: "card todo" },
    h("div", { class: "block-head" },
      h("h2", { class: "label" }, "Before you play"),
      h("span", {}, items.length ? plural(items.length, "thing") + " to see to" : "All clear")),
    items.length
      ? h("ul", { class: "rows" }, items.map(item => h("li", {},
          h("span", {}, item.text),
          h("span", { class: "todo-acts" },
            item.action ? h("button", { type: "button", class: "todo-do", onclick: item.action.run }, item.action.label) : null,
            h("a", { class: "todo-go", href: item.href, onclick: item.onclick || null }, item.place || TODO_PLACES[item.href] || "Open")))))
      : h("p", { class: "small muted" }, "Nothing to sort out before the next scenario."));
}

// The party at a glance, on phones. Each row opens that character's sheet.
function partyList(data) {
  const order = characterOrder(data);
  const active = order.filter(c => !c.retired);
  if (!active.length) return null;
  return h("div", { class: "party" },
    h("div", { class: "party-head" }, h("h2", {}, "The party"), h("span", { class: "small muted" }, plural(active.length, "character"))),
    active.map(c => {
      const st = characterStats(c);
      return h("a", { class: "party-row", href: "#characters", onclick: () => pickCharacter(data, order.indexOf(c)) },
        hex(st.level, "level"),
        h("span", { class: "party-who" },
          h("strong", {}, c.name),
          h("span", {}, classIcon(c.class), c.class),
          perksLeft(c) ? h("em", {}, `${plural(perksLeft(c), "perk")} to choose`) : null),
        h("span", { class: "party-xp" },
          h("span", { class: st.close ? "close" : null }, st.nextText),
          meter(st.toNext ? st.toNext.fraction : 1, st.close),
          h("small", {}, `${c.gold} gold`)));
    }));
}

// --- Event decks -------------------------------------------------------------

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
      e.option ? `Option ${e.option}` : null,
      e.effects.length ? capitalize(e.effects.join(", ")) : null,
      !e.effects.length && e.adds.length ? `added ${e.adds.map(([d, n]) => eventLabel(d, n)).join(", ")}` : null,
      e.scenario ? `before #${e.scenario}` : null,
    ].filter(Boolean).join(" · ");
    return h("li", {},
      h("strong", {}, e.label),
      h("span", {}, detail || (e.notes ? null : e.unknown ? "Option not known" : "Option not recorded"),
        e.notes ? h("div", { class: detail ? "small muted" : null }, e.notes) : null,
        (asks.get(e) || []).map(text => h("div", { class: "ask" }, icon("question"), text))),
      h("span", { class: `fate ${e.fate || (e.unknown ? "unknown" : "open")}` },
        // The icons printed on event cards say it; the word is for screen readers and hover.
        e.fate ? h("span", { title: capitalize(e.fate) }, gameIcon(`event-${e.fate}`, capitalize(e.fate))) : e.unknown ? "Not known" : "Needs an answer"));
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

function recordRows(list) {
  if (!list.length) return h("p", { class: "small muted" }, "None yet.");
  return h("ul", { class: "rows" }, list.map(a => h("li", {},
    h("span", {},
      h("strong", {}, a.name, a.count > 1 ? ` ×${a.count}` : null),
      a.notes ? h("span", { class: "sub" }, a.notes) : null),
    a.where ? h("span", { class: "where" }, a.where) : null)));
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
    h("div", { class: "record" },
      card("Party achievements", recordRows(party.achievements)),
      card("Global achievements", recordRows(city.globalAchievements)),
      card("In the shop for good", recordRows(city.itemDesigns)),
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
function itemSlot(name) {
  return Object.values(itemsRef?.items || {}).find(i => i.name.toLowerCase() === String(name).toLowerCase())?.slot || null;
}

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

// The outcomes an option could have had: the first whose condition is met,
// plus any before it that can't be ruled out. "Do what option X says" is
// followed through. Each comes with the conditions that couldn't be told.
function possibleOutcomes(options, letter, ctx, pinned, depth = 0) {
  const outcomes = options[letter] || [];
  const found = [];
  if (pinned) {
    if (outcomes[pinned - 1]) found.push({ number: pinned, outcome: outcomes[pinned - 1], doubts: [] });
  } else {
    let settled = false;
    for (const [i, outcome] of outcomes.entries()) {
      // A blank outcome ahead of the real ones is only the card's lead-in.
      if (outcomes.length > 1 && !outcome.condition && !outcome.card && !outcome.effects) continue;
      const met = testCondition(outcome.condition, ctx);
      if (met === false) continue;
      found.push({ number: i + 1, outcome, doubts: met === null ? [outcome.condition] : [] });
      if (met === true) { settled = true; break; }
    }
    // If no condition is surely met, it may be that none was: nothing
    // happens, and the card goes where all of the option's outcomes send it.
    if (!settled && outcomes.length) {
      const cards = new Set(outcomes.map(o => o.card));
      found.push({ number: null, outcome: cards.size === 1 ? { card: [...cards][0] } : {},
                   doubts: found.length ? [found[0].doubts[0]] : [] });
    }
  }
  return found.flatMap(({ number, outcome, doubts }) => {
    const own = outcome.effects || [];
    const then = own.find(e => e.type === "asOption");
    const base = { option: letter, number, card: outcome.card, effects: own.filter(e => e.type !== "asOption"), doubts };
    if (!then || depth > 2) return [base];
    return possibleOutcomes(options, then.option, ctx, null, depth + 1).map(sub => ({
      ...base, card: base.card || sub.card, effects: [...base.effects, ...sub.effects], doubts: [...doubts, ...sub.doubts],
    }));
  });
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
      case "partyAchievement":
      case "globalAchievement": {
        const kind = e.type === "partyAchievement" ? "party" : "global";
        (maybe ? t.mayGain : t.gains).push({ kind, id: e.id });
        say(achievementName(ref, kind, e.id));
        break;
      }
      case "item":
      case "itemDesign":
        (maybe ? t.mayGain : t.gains).push({ kind: "design", item: e.item });
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
                   draws: [], treasures: new Map() };
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
    if (n && !classInfo(id)?.starting) for (const deck of ["city", "road"]) addCard(deck, n, `${className(evRef, id)} unlocked`);
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
    t.range = plus(t.range, range);
    t.value += settledPart(range);
    t.entries.push({ label, range });
    if (!isExact(range)) (forGood ? t.unknown : t.unsure).push(label);
  };

  // The order things happened: completed scenarios as campaign.json lists
  // them. An event with "scenario" comes just before that scenario; one
  // without comes after the event listed before it. Adjustments with a
  // scenario come before it, the rest at the end.
  const played = data.scenarios.filter(s => s.status === "completed");
  const before = played.map(() => []);
  const after = [];
  let into = before[0] || after;
  for (const e of data.events) {
    if (e.scenario != null) {
      const i = played.findIndex(s => s.number === e.scenario);
      into = i >= 0 ? before[i] : after;
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
    // Items may be written "27:2" (item 27, two copies).
    for (const id of [...(r.items || []), ...(r.itemDesigns || [])]) addDesign(String(id).split(":")[0], where);
    for (const ev of r.events || []) { const [deck, n] = ev.split(":"); addCard(deck, Number(n), `from ${where}`); }
    if (r.unlockCharacter) unlockClass(r.unlockCharacter, where);

    // Treasures: "07", or { "number": "07", "character": "Craig", "drew": 52 }.
    const found = [];
    for (const t of s.treasures || []) {
      // "drawn": false says a random draw was never made, and won't be.
      const { number, character, drew, drawn: never } = typeof t === "object" ? { ...t, drawn: t.drawn === false } : { number: t };
      const from = `treasure ${number}`;
      const parts = treasureParts(ref, number);
      for (const part of parts) {
        if (part.type === "item" || part.type === "itemDesign") addDesign(part.value, from);
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
                     classes: list(record.classes), draws: record.draws, treasures: record.treasures } };
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
                number: n, name: nameOf(n), unlockedBy: parent.get(n), unlockedVia: via.get(n),
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
    ["Unlocked by", s.unlockedBy != null ? scenarioLabel(data, s.unlockedBy) : s.unlockedVia],
    ["Completed", formatDate(s.completed)],
    ["Rewards", s.rewards.length ? capitalize(s.rewards.join(", ")) : null],
    ["Treasure", data.treasureInfo?.get(s.number)?.join("; ")
      || (s.treasures?.length ? `${s.treasures.map(t => t.number || t).join(", ")} looted` : null)],
  ].filter(([, value]) => value);
  return pairs.length ? h("dl", { class: "facts" }, pairs.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))) : null;
}

// How far each depth of the tree is indented, in pixels.
const TREE_STEP = 14;

// One scenario as a row that opens in place. depth indents it in the tree,
// and lines (from treeLayout) draws the tree's lines down its left.
function scenarioRow(data, s, depth = 0, lines = []) {
  const open = scenarioOpen === s.number;
  const blockedWhy = s.status === "blocked" && s.reasons.length ? s.reasons.join(" · ") : null;
  const meta = s.status === "completed"
    ? [formatDate(s.completed), s.treasures?.length ? `treasure ${s.treasures.map(t => t.number || t).join(", ")}` : null].filter(Boolean).join(" · ")
    : s.status === "available"
      ? (s.unlockedBy != null ? `from #${s.unlockedBy}` : s.unlockedVia ? `from ${s.unlockedVia}` : "")
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
        scenarioFacts(data, s)),
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
      h("p", { class: "aside" }, "Each scenario sits under the one that unlocked it."),
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

function itemCheck(c, level) {
  const { used, limits } = slotUse(c, level);
  const names = { head: "head items", body: "body items", legs: "legs items", hands: "hands' worth of items", small: "small items" };
  return Object.keys(limits).filter(k => used[k] > limits[k])
    .map(k => `Carries ${used[k]} ${names[k]}, but has room for ${limits[k]}${k === "small" ? ` at level ${level}` : ""}.`);
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
    h("p", {}, "This phone will open on their sheet. You can change it on the Characters tab."),
    h("div", { class: "who-list" }, active.map(c =>
      h("button", { type: "button", class: "who-row", "aria-label": `${c.name}, level ${characterStats(c).level} ${c.class}`, onclick: answer(c.name) },
        hex(characterStats(c).level, "level"),
        h("span", { class: "party-who" }, h("strong", {}, c.name), h("span", {}, classIcon(c.class), c.class))))),
    h("button", { type: "button", class: "btn quiet", onclick: answer("") }, "Just looking"));
  document.body.append(dialog);
  dialog.showModal();
}

// Under the sheet (phones): a way to change who this phone opens on. The
// "You" in the row of characters already says who that is.
function meLine(data) {
  const mine = data.characters.find(c => !c.retired && c.name === me);
  return h("p", { class: "me-line" },
    h("span", {}, mine ? `Not ${mine.name}?` : "This phone opens on the Overview."),
    h("button", { type: "button", "data-key": "me-change", onclick: () => askWho(data) },
      mine ? "Change who this phone opens on" : "Pick your character"));
}

// The bottom tab shows this phone's character, as it's their home. Phones
// only (styles.css); the words "Characters" stay for wide screens.
function myTab(data) {
  const a = document.querySelector('.tabs a[data-tab="characters"]');
  if (!a) return;
  a.querySelector(".tab-me")?.remove();
  const mine = data.characters.find(c => !c.retired && c.name === me);
  a.classList.toggle("mine", Boolean(mine));
  // A thin hexagon, like the other tabs' outline icons, with the class icon
  // small inside it: the class icon alone is a solid shape, far heavier.
  if (mine) a.append(h("span", { class: "tab-me" },
    h("span", { class: "tab-hex" }, svg("0 0 24 24", '<path d="M12 2.6l8.2 4.7v9.4L12 21.4l-8.2-4.7V7.3z"/>', { "aria-hidden": "true" }), classIcon(mine.class)),
    h("span", {}, mine.name)));
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

function renderCharacters(data) {
  if (!data.characters.length) return [sectionHead("Characters"),
    h("div", { class: "empty" }, h("p", {}, "No characters yet."),
      rawCampaign ? h("button", { type: "button", class: "btn primary", "data-key": "add-first", onclick: () => addNewcomer(data) }, "Add the party's characters") : null)];

  const order = characterOrder(data);
  if (characterIndex >= order.length) characterIndex = 0;

  const card = c => {
    const st = characterStats(c);
    // The same perk taken twice shows once, with a count.
    const check = perkCheck(c);
    const perks = check.rows;
    const itemProblems = itemCheck(c, st.level);
    return h("article", { class: `char-card${order.indexOf(c) === characterIndex ? " current" : ""}`, "data-char": c.name },
      h("header", { class: "char-head" },
        h("div", { class: "char-level" }, hex(st.level, "level"), h("span", { class: "label" }, "Level")),
        h("div", {},
          h("h3", { class: Math.max(...c.name.split(/\s+/).map(w => w.length)) > 9 ? "long" : null }, c.name),
          h("p", {}, classIcon(c.class), [c.class, c.retired ? "retired" : null].filter(Boolean).join(" · ")))),
      h("div", { class: "block" },
        h("div", { class: "block-head" },
          h("span", { class: "xp-now num" }, `${c.xp} XP`),
          h("span", { class: `xp-next${st.close ? " close" : ""}` }, st.nextText)),
        meter(st.toNext ? st.toNext.fraction : 1, st.close),
      ),
      c.retired ? null : lastLevelUps(data).filter(u => u.character === c.name).map(u =>
        nudge("plus", `Reached level ${u.level} last session`, `Add an ability card of level ${u.level} or lower.`)),
      h("div", { class: "char-stats" },
        h("div", {}, h("span", { class: "label" }, "Gold"), h("span", { class: "gold num" }, c.gold)),
        c.personalQuest ? h("div", {},
          h("span", { class: "label" }, "Personal quest"),
          h("span", { class: "quest" }, c.personalQuest),
          h("span", { class: "quest-hint" }, "Secret, progress only")) : null),
      h("div", { class: "block goal-block" },
        h("div", { class: "block-head" },
          h("span", { class: "label" }, gameIcon("checkmark"), "Battle goals")),
        goalBoxes(c.checkmarks)),
      h("div", { class: "block", style: `--boxes: ${Math.max(2, ...perks.map(p => Math.max(p.count, p.match?.count || 0)),
                                                         ...(st.unspent ? check.open.map(p => p.count) : []))}` },
        h("div", { class: "block-head" },
          h("span", { class: "label" }, "Perks"),
        ),
        // Records the perk straight from the sheet, as "Before you play" does.
        perksLeft(c) ? (rawCampaign && !c.retired
          ? h("button", { type: "button", class: "nudge perk-nudge", "data-key": `perk-record-${c.name}`, onclick: () => recordPerk(data, c.name) },
              icon("plus"), h("span", {}, `${plural(perksLeft(c), "perk")} to choose`), h("span", { class: "nudge-go" }, "Record it"))
          : nudge("plus", `${plural(perksLeft(c), "perk")} to choose`, null, "perk-nudge"))
          : draftedPerks(c.name) && st.unspent
            ? nudge("check", `${draftedPerks(c.name) === 1 ? "Perk" : "Perks"} picked`, "In the session being recorded; it counts once that's saved.", "saved")
            : null,
        perks.length
          ? h("ul", { class: "perks" }, perks.map(p => h("li", { class: p.note && !p.quiet ? "unsure" : null },
              // Its boxes, as ticked on the sheet; the game's checkmark is
              // kept for battle goals, so the card shows only one kind of tick.
              p.note && !p.quiet ? icon("question") : perkBoxes(p.count, p.match ? p.match.count - p.count : 0),
              h("span", { class: "perk-text" }, perkText(p.text), p.note ? h("span", { class: "note" }, p.note) : null),
              p.note && !p.quiet && p.count > 1 ? h("span", { class: "times" }, `×${p.count}`) : null)))
          : h("span", { class: "small muted" }, st.earned ? "None taken yet."
              // Only a level 1 character with under 3 checkmarks has none earned.
              : `None yet: the first comes at level 2, or with ${plural(3 - c.checkmarks % 3, "more battle-goal checkmark")}.`),
        st.unspent && check.open.length ? h("details", { class: "open-perks", open: true },
          h("summary", {}, `Perks still open on the ${c.class} sheet`),
          h("ul", {}, check.open.map(p => h("li", {},
            perkBoxes(p.count - p.left, p.left), h("span", {}, perkText(p.text)))))) : null),
      c.items.length ? h("div", { class: "block" },
        h("div", { class: "block-head" }, h("span", { class: "label" }, "Items"), slotStrip(c, st.level)),
        itemProblems.map(text => nudge("question", "Too many items", text)),
        h("div", { class: "chips" }, c.items.map(i => {
          const slot = itemSlot(i);
          return h("span", { class: "chip" }, slot ? gameIcon(`slot-${slot}`) : null, i);
        }))) : null,
      notes(c.notes, "char-notes"));
  };

  const active = order.filter(c => !c.retired);
  const retired = order.filter(c => c.retired);

  // Phones show one sheet at a time, chosen from this row.
  // With a big party it scrolls sideways rather than squeezing the names;
  // retired characters come last, after a divider, dimmed.
  const switcher = h("div", { class: "char-switch", role: "group", "aria-label": "Choose a character" },
    order.map((c, i) => {
      const st = characterStats(c);
      const mine = !c.retired && c.name === me;
      return [c.retired && !order[i - 1]?.retired ? h("span", { class: "switch-sep", "aria-hidden": "true" }) : null,
        h("button", {
          type: "button", "data-key": `char-${i}`, class: c.retired ? "retired" : null,
          "aria-pressed": String(i === characterIndex),
          "aria-label": c.retired ? `${c.name}, retired` : mine ? `${c.name}, you` : null,
          onclick: () => pickCharacter(data, i),
        },
        h("span", {}, hex(st.level, "quiet"),
          perksLeft(c) ? h("span", { class: "dot", role: "img", "aria-label": "Has a perk to choose" }) : null),
        h("span", { class: "switch-name" }, c.name),
        mine ? h("span", { class: "you", "aria-hidden": "true" }, "You") : null)];
    }));

  return [
    sectionHead("Characters", [`${active.length} active`, retired.length ? `${retired.length} retired` : null].filter(Boolean).join(" · ")),
    furtherDown([["#shop", "Shop"]]),
    switcher,
    active.length ? h("div", { class: "char-grid" }, active.map(card)) : empty("No active characters."),
    active.length ? meLine(data) : null,
    retired.length ? [h("h3", { class: "subhead" }, "Retired"), h("div", { class: "char-grid" }, retired.map(card))] : null,
  ];
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
      if (!inShop(item)) {
        const why = item.prosperity ? `the shop only has it from prosperity ${item.prosperity}` : "it only comes from a design";
        questions.push(`${c.name} carries ${item.name}, but ${why}. Check the item, or list its design in itemDesigns if the party found one.`);
      }
      const list = owners.get(item.id) || [];
      list.push(c.name);
      owners.set(item.id, list);
    }
  }

  const stock = all.filter(inShop).map(item => {
    const held = owners.get(item.id) || [];
    if (held.length > item.count) {
      questions.push(`${item.name}: the party carries ${held.length}, but only ${item.count} exist.`);
    }
    return { ...item, price: Math.max(0, item.cost + modifier), sells: Math.floor(item.cost / 2),
             held, left: Math.max(0, item.count - held.length), design: !(item.prosperity && item.prosperity <= level) };
  }).sort((a, b) => a.id - b.id);

  // Reputation that isn't settled may mean other prices.
  const range = ledger?.reputation?.range;
  const modifiers = range ? new Set([shopModifier(range.lo), shopModifier(range.hi), modifier]) : new Set([modifier]);
  const coming = all.filter(item => item.prosperity === level + 1).length;

  return { level, modifier, stock, questions, coming, pricesUnsure: modifiers.size > 1, range };
}

function renderShop(data) {
  const shop = data.shop;
  if (!shop) return null;
  const copies = n => `${n} ${n === 1 ? "copy" : "copies"}`;

  // With this phone's character picked: their gold, the room they have, and
  // on each item whether they could take it.
  const mine = data.characters.find(c => !c.retired && c.name === me);
  const room = mine ? slotUse(mine, characterStats(mine).level) : null;
  const full = item => { const [k, n] = slotNeed(item.slot); return room && k in room.used && room.used[k] + n > room.limits[k]; };
  const dear = item => mine && item.price > mine.gold;

  const row = item => h("li", { class: item.left ? (dear(item) ? "too-dear" : null) : "sold-out" },
    h("span", {},
      h("strong", {}, item.name, item.design ? h("span", { class: "tag" }, "design") : null),
      h("span", { class: "sub" }, copyPips(item), [
        item.left && full(item) ? fullText(mine, item.slot) : null,
        item.held.length ? `sells for ${item.sells}` : null,
      ].filter(Boolean).join(" · "))),
    h("span", { class: "price num" }, `${item.price} gold`));

  // One mark per copy of the item: empty while it's in the shop, the
  // holder's class icon once someone carries it.
  const copyPips = item => {
    const holders = item.held.map(name => data.characters.find(c => c.name === name)).filter(Boolean);
    const said = `${copies(item.count)}: ${item.left ? `${item.left} in the shop` : "none in the shop"}${item.held.length ? `, ${item.held.join(", ")} ${item.held.length === 1 ? "has" : "have"} ${item.held.length === 1 ? "one" : "them"}` : ""}`;
    return h("span", { class: "copies", role: "img", "aria-label": said, title: said },
      holders.map(c => h("i", { class: "held" }, classIcon(c.class))),
      Array.from({ length: item.left }, () => h("i")));
  };

  const groups = SLOTS.map(([slot, label]) => [slot, label, shop.stock.filter(i => i.slot === slot)]).filter(([, , list]) => list.length);
  const priceNote = shop.modifier === 0 ? "normal prices" : `${signed(shop.modifier)} gold per item`;

  return [
    sectionHead("Shop", `Prosperity ${shop.level} · ${priceNote}`),
    mine ? h("p", { class: "shop-me" }, h("span", {}, `${mine.name} has `, h("strong", {}, `${mine.gold} gold`)), slotStrip(mine, characterStats(mine).level)) : null,
    shop.pricesUnsure ? pricesNote(shop, data.ledger?.reputation) : null,
    shop.questions.map(q => nudge("question", "Check an item", q)),
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
      `Reputation could be ${rangeText(shop.range)}, which would change prices. Settle the open events on the Overview.`);
  }
  const lower = shop.modifier - shopModifier(shop.range.hi);
  const higher = shopModifier(shop.range.lo) - shop.modifier;
  const could = [lower > 0 ? `${lower} gold lower` : null, higher > 0 ? `${higher} gold higher` : null].filter(Boolean).join(" or ");
  const names = rep.unknown.join(", ").replace(/, ([^,]*)$/, " and $1");
  return nudge("question", "Prices could differ",
    `Reputation could be ${rangeText(shop.range)}, as ${names} ${rep.unknown.length === 1 ? "isn't" : "aren't"} known, so prices may be ${could}.`, "note");
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

// Why an item wouldn't fit: the slot it needs is taken.
function fullText(c, slot) {
  if (slot === "onehand" || slot === "twohand") return `${c.name}'s hands are full`;
  if (slot === "small") return `${c.name} has no room for another small item`;
  return `${c.name}'s ${slot} slot is full`;
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

// The Enhancer: what a sticker costs, from what's printed on the card. Not
// saved anywhere; buying one is still a hand edit to the character's gold.
const enhancing = { sticker: "attack", level: "1", multi: false, previous: "0", hexes: "3" };

function enhancer(data) {
  if (!data.city.globalAchievements.some(a => a.id === "the-power-of-enhancement")) return null;
  const set = key => e => { enhancing[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value; render(data, "shop"); };
  const field = (label, control) => h("label", { class: "field" }, h("span", {}, label), control);
  const select = (key, options) => h("select", { "data-key": `enh-${key}`, onchange: set(key) },
    options.map(([value, label]) => h("option", { value, selected: String(enhancing[key]) === String(value) }, label)));
  const counting = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [String(from + i), String(from + i)]);

  const key = enhancing.sticker;
  const cost = enhancementCost(enhancing);
  const afford = data.characters.filter(c => !c.retired && c.gold >= cost.total).map(c => c.name);

  return h("div", { class: "enhancer-wrap" },
    h("h3", { class: "subtitle" }, "Enhancing a card"),
    h("div", { class: "card enhancer" },
      h("div", { class: "enhancer-form" },
        h("p", { class: "small muted" }, "Read it off the card: its level, whether the ability targets more than one, and how many stickers that action has already."),
        h("div", { class: "rec-row" },
          field("Sticker", h("select", { "data-key": "enh-sticker", onchange: set("sticker") },
            ENHANCEMENTS.map(([group, list]) => h("optgroup", { label: group },
              list.map(([k, label]) => h("option", { value: k, selected: k === key }, label)))))),
          field("Card level", select("level", counting(1, 9))),
          field("Already on it", select("previous", counting(0, 4))),
          key === "hex" ? field("Hexes it has", select("hexes", counting(1, 12))) : null),
        canDouble(key) ? h("label", { class: "rec-check" },
          h("input", { type: "checkbox", "data-key": "enh-multi", checked: Boolean(enhancing.multi), onchange: set("multi") }),
          "The ability targets more than one figure") : null,
        h("p", { class: "small muted" }, "A level X card counts as level 1.")),
      h("div", { class: "enhancer-cost" },
        h("div", { class: "enhancer-total", "aria-live": "polite" }, h("span", { class: "figure" }, cost.total), h("span", {}, "gold")),
        h("ul", { class: "rows" }, cost.steps.map(([text, gold]) => h("li", {}, h("span", {}, text), h("span", { class: "num" }, `+${gold}`)))),
        h("p", { class: "small muted" }, afford.length
          ? `${afford.join(", ").replace(/, ([^,]*)$/, " and $1")} ${afford.length === 1 ? "has" : "have"} enough gold.`
          : "No one has enough gold yet."))));
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
  return d;
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
}
function dropDraft() {
  draft = null;
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

// Each draft has an id, which campaign.json keeps as "lastDraft" once saved:
// that's how the page knows the draft is in the file, session or not.
const draftId = () => Math.random().toString(36).slice(2, 10);

function newDraft(data) {
  return { id: draftId(), date: today(), title: "", party: [...defaultLevelParty(data)], notes: "",
           scenarios: [], events: [], buys: [], sells: [], perks: [], donations: [],
           retirements: [], newCharacters: [] };
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
  const who = name => out.characters.find(c => c.name === name);
  const gainFor = new Map();   // name -> { xp, gold, checkmarks }
  const gain = (name, key, amount) => {
    if (!amount) return;
    const g = gainFor.get(name) || { xp: 0, gold: 0, checkmarks: 0 };
    g[key] += amount;
    gainFor.set(name, g);
  };
  // Retirements, then newcomers, before anything else: a newcomer can play
  // tonight's scenarios and go shopping. A newcomer's line comes first in the
  // summary; a retirement's after the scenarios, where it reads in order.
  const joinLog = [];
  for (const x of (d.retirements || []).filter(x => x.character)) {
    const c = who(x.character);
    if (!c || c.retired) { warnings.push(`${x.character} isn't an active character.`); continue; }
    c.retired = true;
    joinLog.push(`${c.name} retires: a prosperity checkmark, the ${c.class} retirement events go into the decks, and their items go back to the shop`);
    if (!x.unlocks) continue;
    if (data.city.unlockedClasses.some(u => u.id === x.unlocks)) { warnings.push(`The class with the ${classIconName(x.unlocks)} icon is already unlocked.`); continue; }
    out.city ||= {};
    out.city.unlockedClasses = [...(out.city.unlockedClasses || []), className(classRef, x.unlocks)];
    joinLog.push(`${c.name}'s personal quest unlocks the class with the ${classIconName(x.unlocks)} icon, and its events go into the decks`);
  }
  const prosperity = stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const joined = [];
  for (const x of d.newCharacters || []) {
    const name = String(x.name || "").trim();
    if (!name && !x.class) continue;
    if (!name) { warnings.push(`A new ${x.class} has no name.`); continue; }
    if (who(name)) { warnings.push(`There's already a character called ${name}.`); continue; }
    if (!x.class) { warnings.push(`${name}: pick a class.`); continue; }
    const level = Math.max(1, Math.min(prosperity, num(x.level) || 1));
    const twin = out.characters.find(c => !c.retired && c.class === x.class);
    if (twin) warnings.push(`${twin.name} already plays a ${x.class}: a party can't have two of the same class.`);
    out.characters.push({ name, class: x.class, xp: XP_FOR_LEVEL[level - 1], gold: startingGold(level), checkmarks: 0,
                          perks: [], items: [], personalQuest: "", retired: false, notes: "" });
    log.push(`${name} the ${x.class} joins at level ${level}, with ${XP_FOR_LEVEL[level - 1]} XP and ${startingGold(level)} gold${level > 1 ? `, and ${plural(level - 1, "perk")} to choose` : ""}`);
    if (x.playing !== false) joined.push(name);
  }

  // Who played: those marked, and newcomers unless they sat it out.
  const party = [...d.party.filter(name => who(name) && !joined.includes(name)), ...joined];
  const played = d.scenarios.filter(s => num(s.number));

  // Only an evening of play goes in the session log: a perk taken or an item
  // bought between sessions changes the sheets and nothing else.
  const evening = played.length > 0 || d.events.some(e => num(e.number)) || Boolean(String(d.notes || "").trim());
  if (evening && !party.length) warnings.push("No one is marked as playing.");
  out.updated = d.date || today();

  // Events, in the order drawn.
  for (const e of d.events.filter(e => num(e.number))) {
    const entry = { deck: e.deck, number: num(e.number) };
    if (e.option) entry.option = e.option;
    if (num(e.scenario)) entry.scenario = num(e.scenario);
    else entry.characters = [...party];
    if (e.paid === "yes") entry.paid = true;
    if (e.paid === "no") entry.paid = false;
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
  }

  // Treasures already looted, and where: a tile is looted once.
  const looted = new Map();
  for (const sc of raw.scenarios || []) {
    for (const t of sc.treasures || []) looted.set(String(Number(typeof t === "object" ? t.number : t)), sc.number);
  }

  // Scenarios, in the order played.
  for (const s of played) {
    const n = num(s.number);
    const info = scenarioRef?.scenarios?.[String(n)];
    const known = data.scenarios.find(x => x.number === n);
    const label = `#${n}${info?.name ? ` ${info.name}` : ""}`;
    if (!info) warnings.push(`#${n} isn't a scenario.`);
    else if (!known) warnings.push(`${label} isn't unlocked.`);
    else if (known.status === "completed" && s.result === "success") warnings.push(`${label} is already completed.`);
    else if (known.status === "blocked" && s.result === "success") warnings.push(`${label} is blocked.`);

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

    if (s.result !== "success") { log.push(`${label}: failed`); continue; }

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
    const kept = results.filter(r => r.xp || r.gold || r.checkmarks)
      .map(r => Object.fromEntries(Object.entries(r).filter(([k, v]) => k === "character" || v)));
    if (kept.length) entry.results = kept;
    entry.notes = old.notes || "";
    out.scenarios.push(entry);
    log.push(`${label} completed`);

    // Rewards each character gets, and what treasures gave their looters.
    const r = info?.rewards || {};
    for (const name of party) { gain(name, "gold", r.gold || 0); gain(name, "xp", r.experience || 0); }
    if (r.gold || r.experience) log.push(`${label} reward: ${[r.gold ? `${r.gold} gold` : null, r.experience ? `${r.experience} XP` : null].filter(Boolean).join(" and ")} each`);
    if (r.collectiveGold) warnings.push(`${label} gives ${r.collectiveGold} gold to share: add it to the characters' gold by hand.`);
    if (r.chooseLocation) warnings.push(`${label} lets you choose one of ${r.chooseLocation.map(x => `#${x}`).join(", ")}: note the choice.`);
    for (const t of s.treasures.filter(t => t.number)) {
      const tile = String(Number(t.number));
      if (looted.has(tile)) warnings.push(`Treasure ${t.number} was already looted in #${looted.get(tile)}. Check the number.`);
      looted.set(tile, n);
      for (const part of treasureParts(scenarioRef, t.number)) {
        if (!t.character) { if (["gold", "experience", "item"].includes(part.type)) warnings.push(`Treasure ${t.number}: who looted it?`); continue; }
        if (part.type === "gold") gain(t.character, "gold", num(part.value));
        if (part.type === "experience") gain(t.character, "xp", num(part.value));
        if (part.type === "item") {
          who(t.character)?.items.push(itemName(part.value));
          log.push(`${t.character} takes ${itemName(part.value)} from treasure ${t.number}`);
        }
      }
    }
  }

  // The session itself, if there was one.
  const session = { date: d.date || null };
  if (d.title) session.title = d.title;
  session.scenarios = played.map(s => ({ number: num(s.number), level: draftLevel(s, data), result: s.result }));
  session.characters = [...party];
  session.notes = d.notes || "";
  if (evening) out.sessions.push(session);

  // XP, gold and checkmarks onto the character sheets. Passing a level means
  // a new ability card; the perk that comes with it the Characters tab counts.
  const levelUps = [];
  for (const [name, g] of gainFor) {
    const c = who(name);
    const was = stepFor(c.xp || 0, XP_FOR_LEVEL);
    c.xp = (c.xp || 0) + g.xp;
    c.gold = (c.gold || 0) + g.gold;
    c.checkmarks = (c.checkmarks || 0) + g.checkmarks;
    log.push(`${name}: ${[g.xp ? `${signed(g.xp)} XP` : null, g.gold ? `${signed(g.gold)} gold` : null,
                          g.checkmarks ? `${signed(g.checkmarks)} ${g.checkmarks === 1 ? "checkmark" : "checkmarks"}` : null].filter(Boolean).join(", ")}`);
    const now = stepFor(c.xp, XP_FOR_LEVEL);
    for (let level = was + 1; level <= now; level++) {
      levelUps.push({ character: name, level });
      log.push(`${name} reaches level ${level}: add an ability card of level ${level} or lower, and take a perk`);
    }
  }
  if (levelUps.length) session.levelUps = levelUps;

  log.push(...joinLog);

  // Shopping and perks, after the scenarios.
  const priceOf = name => data.shop?.stock.find(i => i.name === name)?.price;
  for (const b of d.buys.filter(b => b.character && b.item)) {
    const c = who(b.character);
    const price = priceOf(b.item) ?? 0;
    c.gold = (c.gold || 0) - price;
    c.items.push(b.item);
    log.push(`${b.character} buys ${b.item} for ${price} gold`);
  }
  for (const sale of d.sells.filter(x => x.character && x.item)) {
    const c = who(sale.character);
    const i = c.items.indexOf(sale.item);
    if (i < 0) { warnings.push(`${sale.character} doesn't carry ${sale.item}.`); continue; }
    c.items.splice(i, 1);
    const item = Object.values(itemsRef?.items || {}).find(x => x.name === sale.item);
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
    log.push(`${x.character} donates ${DONATION} gold to the Sanctuary: two blessings in their next scenario`);
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
  d.retirements ||= [];
  d.newCharacters ||= [];
  // A change to the form's rows redraws it, and the Overview and sheets too:
  // they leave out what the draft already covers (a perk picked, say).
  const rerender = () => { saveDraft(); render(data, "sessions"); render(data, "overview"); render(data, "characters"); };
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
  const remove = (list, i, what, addKey) => h("button", { type: "button", class: "btn quiet",
    onclick: () => { list.splice(i, 1); rerender(); focusOn(addKey); } }, `Remove ${what}`);
  const addButton = (key, label, onclick, firstKey) => h("button", { type: "button", class: "btn", "data-key": key,
    onclick: () => { onclick(); rerender(); focusOn(firstKey()); } }, icon("plus"), label);

  const active = characterOrder(data).filter(c => !c.retired);
  // Newcomers in this draft count as characters here: they can play tonight,
  // loot, shop and take perks. They play unless marked as sitting it out.
  const prosperityLevel = stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const newcomers = d.newCharacters.filter(x => String(x.name || "").trim()).map(x => {
    const level = Math.max(1, Math.min(prosperityLevel, num(x.level) || 1));
    return { name: x.name.trim(), class: x.class, xp: XP_FOR_LEVEL[level - 1], gold: startingGold(level), checkmarks: 0,
             perks: [], items: [], retired: false, draft: x };
  });
  const party = [...active.filter(c => d.party.includes(c.name)), ...newcomers.filter(c => c.draft.playing !== false)];
  const partyOptions = [["", "Who?"], ...party.map(c => [c.name, c.name])];
  // Perks are taken in town, by anyone still adventuring.
  const activeOptions = [["", "Who?"], ...[...active, ...newcomers].map(c => [c.name, c.name])];
  // A newcomer can buy their first items in the same visit to town.
  const buyOptions = [...partyOptions, ...newcomers.filter(c => !party.includes(c)).map(c => [c.name, c.name])];
  const available = data.scenarios.filter(s => s.status === "available").sort((a, b) => a.number - b.number);

  // What a character's row adds up to, kept current as the boxes are typed in.
  const gainText = (s, r) => {
    const g = scenarioGain(s, r, data);
    return `Comes to ${g.xp} XP and ${g.gold} gold`;
  };
  const scenarioBlock = (s, i) => {
    const n = num(s.number);
    const info = scenarioRef?.scenarios?.[String(n)];
    const rewards = info ? describeRewards(scenarioRef, info.rewards, classRef) : [];
    s.level ??= String(draftLevel(s, data));
    const st = scenarioStats(draftLevel(s, data));
    return h("fieldset", { class: "card rec-block" },
      h("legend", {}, `Scenario ${i + 1}`),
      h("div", { class: "rec-row" },
        field("Number", text(`sc-${i}-n`, s, "number", { type: "number", min: 1, max: 95, list: "rec-available", inputmode: "numeric", "aria-label": "Scenario number" }, true), "short"),
        field("Level", select(`sc-${i}-l`, s, "level", Array.from({ length: 8 }, (_, l) => [String(l), String(l)]))),
        field("Result", select(`sc-${i}-r`, s, "result", [["success", "Success"], ["failure", "Failure"]]))),
      n ? h("p", { class: "small muted" }, info ? `${info.name}${s.result === "success" && rewards.length ? ` · rewards: ${rewards.join(", ")}` : ""}` : "Not a scenario number.") : null,
      party.length ? h("div", { class: "rec-results" },
        h("span", { class: "label" }, "What each character gained there"),
        h("p", { class: "small muted" }, s.result === "success"
          ? `XP as on the dial, and coins picked up. The page adds ${st.xp} bonus XP each, and makes each coin ${st.gold} gold.`
          : `XP as on the dial, and coins picked up: each coin is ${st.gold} gold. A failure gives no bonus XP.`),
        party.map(c => {
          s.results[c.name] ||= {};
          const r = s.results[c.name];
          return h("div", { class: "rec-row" },
            h("strong", { class: "rec-who" }, c.name),
            field("XP", text(`sc-${i}-${c.name}-xp`, r, "xp", { type: "number", min: 0, inputmode: "numeric", "aria-label": `${c.name}: XP on the dial` }), "short"),
            // A draft from before coins were asked for keeps its gold box.
            filled(r.gold) && !filled(r.coins)
              ? field("Gold", text(`sc-${i}-${c.name}-gold`, r, "gold", { type: "number", min: 0, inputmode: "numeric", "aria-label": `${c.name}: gold` }), "short")
              : field("Coins", text(`sc-${i}-${c.name}-coins`, r, "coins", { type: "number", min: 0, inputmode: "numeric", "aria-label": `${c.name}: coins` }), "short"),
            s.result === "success"
              ? field("Checkmarks", text(`sc-${i}-${c.name}-cm`, r, "checkmarks", { type: "number", min: 0, max: 3, inputmode: "numeric", "aria-label": `${c.name}: battle goal checkmarks` }), "short")
              : null,
            h("span", { class: "rec-gain", "data-gain": `${i}|${c.name}` }, gainText(s, r)));
        })) : null,
      s.result === "success" ? h("div", { class: "rec-results" },
        h("span", { class: "label" }, "Treasures looted"),
        s.treasures.map((t, j) => h("div", { class: "rec-row" },
          field("Number", text(`sc-${i}-t${j}-n`, t, "number", { inputmode: "numeric", placeholder: "07", "aria-label": "Treasure number" }, true), "short"),
          field("Looted by", select(`sc-${i}-t${j}-c`, t, "character", partyOptions)),
          t.number ? h("span", { class: "small muted rec-note" }, treasureParts(scenarioRef, t.number).map(describeTreasurePart).join(", ") || "Not in the treasure index") : null,
          remove(s.treasures, j, "treasure", `add-treasure-${i}`))),
        addButton(`add-treasure-${i}`, "Add a treasure", () => s.treasures.push({ number: "", character: "" }),
          () => `sc-${i}-t${s.treasures.length - 1}-n`)) : null,
      remove(d.scenarios, i, "scenario", "add-scenario"));
  };

  const eventBlock = (e, i) => {
    const options = classRef?.events?.[e.deck]?.[String(num(e.number))];
    const pays = options && JSON.stringify(options).includes('"type":"pay');
    return h("div", { class: "rec-row" },
      field("Deck", select(`ev-${i}-d`, e, "deck", [["city", "City"], ["road", "Road"]])),
      field("Number", text(`ev-${i}-n`, e, "number", { type: "number", min: 1, inputmode: "numeric", "aria-label": "Event number" }, true), "short"),
      field("Option", select(`ev-${i}-o`, e, "option", [["", "–"], ["A", "A"], ["B", "B"]])),
      field("Before", select(`ev-${i}-s`, e, "scenario",
        [["", "In town / between"], ...d.scenarios.filter(s => num(s.number)).map(s => [num(s.number), `#${num(s.number)}`])])),
      pays ? field("Paid?", select(`ev-${i}-p`, e, "paid", [["", "Not sure"], ["yes", "Yes"], ["no", "No"]])) : null,
      remove(d.events, i, "event", "add-event"));
  };

  const buyBlock = (b, i) => h("div", { class: "rec-row" },
    field("Who", select(`buy-${i}-c`, b, "character", buyOptions)),
    field("Item", select(`buy-${i}-i`, b, "item", [["", "Pick an item"],
      ...(data.shop?.stock || []).filter(x => x.left > 0).map(x => [x.name, `${x.name} · ${x.price} gold`])], false)),
    remove(d.buys, i, "purchase", "add-buy"));
  const sellBlock = (b, i) => h("div", { class: "rec-row" },
    field("Who", select(`sell-${i}-c`, b, "character", partyOptions)),
    field("Item", select(`sell-${i}-i`, b, "item", [["", "Pick an item"],
      ...(data.characters.find(c => c.name === b.character)?.items || []).map(x => [x, x])], false)),
    remove(d.sells, i, "sale", "add-sell"));
  // Retiring: who, and the class their personal quest unlocks, picked by its
  // icon (the box's name would be a spoiler until it's opened).
  const unlocked = new Set(data.city.unlockedClasses.map(u => u.id));
  const locked = Object.keys(classRef?.classes || {}).filter(id => !unlocked.has(id) && !classRef.classEvents?.[id]?.starting);
  const retireBlock = (x, i) => h("div", { class: "rec-row" },
    field("Who retires", select(`ret-${i}-c`, x, "character", activeOptions)),
    field("Their personal quest unlocks", select(`ret-${i}-u`, x, "unlocks",
      [["", "No class, or not yet"], ...locked.map(id => [id, `The class with the ${classIconName(id)} icon`])]), "wide"),
    x.unlocks ? h("span", { class: "rec-note rec-icon" }, gameIcon(`class-${x.unlocks}`, `${classIconName(x.unlocks)} icon`)) : null,
    remove(d.retirements, i, "retirement", "add-retire"));
  // A newcomer: any unlocked class (or one unlocked tonight), at any level up
  // to the prosperity level.
  const prosperity = stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const classOptions = [...new Set([...data.city.unlockedClasses.map(u => u.name),
    ...d.retirements.filter(x => x.unlocks).map(x => className(classRef, x.unlocks))])].sort();
  const newBlock = (x, i) => {
    const level = Math.max(1, Math.min(prosperity, num(x.level) || 1));
    return h("div", { class: "rec-row" },
      field("Name", text(`new-${i}-n`, x, "name", { autocomplete: "off" }, true), "wide"),
      field("Class", select(`new-${i}-c`, x, "class", [["", "Pick a class"], ...classOptions.map(n => [n, n])])),
      prosperity > 1 ? field("Level", select(`new-${i}-l`, x, "level", Array.from({ length: prosperity }, (_, l) => [String(l + 1), String(l + 1)]))) : null,
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
  const topBar = res => h("div", { class: "rec-top" },
    res.warnings.length
      ? h("span", { class: "rec-checks" }, icon("question"), `${plural(res.warnings.length, "thing")} to check`)
      : h("span", { class: "muted" }, "Nothing to check"),
    h("button", { type: "button", class: "btn quiet", onclick: () => document.querySelector(".rec-summary")?.scrollIntoView({ block: "start" }) },
      "See what changes"));
  const refreshSummary = () => {
    for (const el of document.querySelectorAll("[data-gain]")) {
      const [i, name] = el.dataset.gain.split("|");
      const s = d.scenarios[num(i)];
      if (s) el.textContent = gainText(s, s.results[name] || {});
    }
    const res = applyDraft(rawCampaign, d, data);
    document.querySelector(".rec-summary")?.replaceWith(summary(res));
    document.querySelector(".rec-top")?.replaceWith(topBar(res));
  };
  const first = applyDraft(rawCampaign, d, data);

  // Every part of the form is a heading over its fields, the same way.
  return h("div", { class: "recorder" },
    // On a strip of page background, so nothing scrolling under it shows round it.
    h("div", { class: "rec-pin" }, topBar(first)),
    h("datalist", { id: "rec-available" }, available.map(s => h("option", { value: s.number }, `#${s.number} ${s.name || ""}`))),
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "The evening"),
      h("div", { class: "card rec-block" },
        h("div", { class: "rec-row" },
          field("Date", text("rec-date", d, "date", { type: "date" })),
          field("Title (optional)", text("rec-title", d, "title", { placeholder: "Only if there's no date" }), "wide")),
        h("div", { class: "field" },
          h("span", { id: "rec-who-label" }, "Who played"),
          h("div", { class: "filters", role: "group", "aria-labelledby": "rec-who-label" }, active.map(c =>
            h("button", { type: "button", "data-key": `rec-who-${c.name}`, "aria-pressed": String(d.party.includes(c.name)),
                          onclick: () => { d.party = d.party.includes(c.name) ? d.party.filter(n => n !== c.name) : [...d.party, c.name]; rerender(); } },
              c.name)),
            newcomers.map((c, i) =>
              h("button", { type: "button", "data-key": `rec-who-new-${i}`, "aria-pressed": String(c.draft.playing !== false),
                            onclick: () => { c.draft.playing = c.draft.playing === false; rerender(); } },
                c.name, h("span", {}, "new"))))))),
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "Scenarios"),
      d.scenarios.map(scenarioBlock),
      addButton("add-scenario", "Add a scenario", () => d.scenarios.push(newScenario(data, party)), () => `sc-${d.scenarios.length - 1}-n`)),
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "Events drawn"),
      d.events.length ? h("div", { class: "card rec-block" }, d.events.map(eventBlock)) : null,
      addButton("add-event", "Add an event", () => d.events.push(newEvent()), () => `ev-${d.events.length - 1}-d`)),
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "Retiring and joining"),
      d.retirements.length ? h("div", { class: "card rec-block" }, d.retirements.map(retireBlock)) : null,
      d.newCharacters.length ? h("div", { class: "card rec-block" }, d.newCharacters.map(newBlock)) : null,
      h("div", { class: "rec-buttons" },
        addButton("add-retire", "Retire a character", () => d.retirements.push({ character: "", unlocks: "" }), () => `ret-${d.retirements.length - 1}-c`),
        addButton("add-new", "Add a new character", () => d.newCharacters.push({ name: "", class: "", level: "1", playing: true }), () => `new-${d.newCharacters.length - 1}-n`))),
    h("div", { class: "rec-section" }, h("h3", { class: "subtitle" }, "Shop, perks and the Sanctuary"),
      d.buys.length || d.sells.length || d.perks.length || d.donations.length
        ? h("div", { class: "card rec-block" }, d.buys.map(buyBlock), d.sells.map(sellBlock), d.perks.map(perkBlock),
            d.donations.map((x, i) => h("div", { class: "rec-row" },
              field(`Donates ${DONATION} gold`, select(`don-${i}-c`, x, "character", partyOptions)),
              remove(d.donations, i, "donation", "add-donation")))) : null,
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
  const eventsBefore = number => (data.eventState?.history || []).filter(e => e.scenario === number).map(e => e.label);
  const toggle = () => {
    if (!draft) draft = newDraft(data);
    recorderOpen = !recorderOpen;
    saveDraft();
    render(data, "sessions");
  };
  const head = h("div", { class: "section-head" },
    h("h2", {}, "Sessions"),
    rawCampaign ? h("button", { type: "button", class: `btn${recorderOpen ? "" : " primary"}`, "data-key": "rec-toggle", onclick: toggle },
      recorderOpen ? "Close the form (keep the draft)" : draft ? "Go on recording" : "Record a session") : null);

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
      const long = formatDate(s.date, { day: "numeric", month: "long", year: "numeric" });
      return h("article", { class: "session" },
        h("div", { class: "rail", "aria-hidden": "true" }, h("i")),
        h("div", { class: "session-body" },
          h("div", {},
            h("h3", {}, s.title || long || "Undated session"),
            h("p", {}, [
              s.title && long ? long : null,
              s.date ? formatDate(s.date, { weekday: "long" }) : "Undated",
              s.characters?.length ? s.characters.join(", ") : null,
            ].filter(Boolean).join(" · "))),
          s.scenarios.length ? h("ul", { class: "card played" }, s.scenarios.map(sc => {
            const name = data.scenarios.find(x => x.number === sc.number)?.name;
            const before = eventsBefore(sc.number);
            const won = sc.result === "success";
            const meta = [sc.level != null ? `Level ${sc.level}` : null, before.length ? `${before.join(", ")} drawn before` : null].filter(Boolean);
            return h("li", {},
              hex(sc.number, won ? "completed" : "blocked"),
              h("span", { class: "played-text" },
                h("strong", {}, name || `Scenario ${sc.number}`),
                meta.length ? h("span", {}, meta.join(" · ")) : null),
              h("span", { class: `result ${won ? "success" : "failure"}`, role: "img", "aria-label": won ? "Success" : "Failure", title: won ? "Success" : "Failure" },
                icon(won ? "check" : "cross")));
          })) : null,
          haul.length ? h("div", { class: "haul" },
            h("h4", { class: "label" }, "The evening's haul"),
            resultsList(haul, "+")) : null,
          notes(s.notes)));
    })),
  ];
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

// Which tab each section belongs to on a phone.
const TAB_OF = { overview: "overview", events: "overview", record: "overview",
                 scenarios: "scenarios", characters: "characters", shop: "characters", sessions: "sessions" };

function currentTab() {
  const id = location.hash.slice(1);
  return id.startsWith("scenario-") ? "scenarios" : TAB_OF[id] || "overview";
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

// On a phone, show the current tab's sections and hide the rest.
function showTab() {
  const tab = currentTab();
  for (const el of document.querySelectorAll("main [data-tab]")) el.classList.toggle("off", el.dataset.tab !== tab);
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
  if (TAB_OF[id] === id || !id) window.scrollTo({ top: 0, behavior: "instant" });
  else document.getElementById(id)?.scrollIntoView();
}

// Fill in anything missing, so older or partial files still display.
function withDefaults(raw) {
  const party = { name: "", location: "", achievements: [], notes: "", ...raw.party, reputation: 0 };
  const city = { donations: 0, globalAchievements: [], unlockedClasses: [], itemDesigns: [], ...raw.city, prosperityCheckmarks: 0 };
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
    const response = await fetch(path);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function start() {
  const status = document.getElementById("status");
  const url = dataUrl();
  try {
    const [response, ref, evRef, items] = await Promise.all([
      fetch(url, { cache: "no-cache" }),
      loadReference("data/gloomhaven-scenarios.json"),
      loadReference("data/gloomhaven-events.json"),
      loadReference("data/gloomhaven-items.json"),
    ]);
    itemsRef = items;
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

    render(data);
    status.remove();
    showTab();
    watchSections();
    // Not asked yet, or their character has since retired: ask.
    if (phone.matches && me !== "" && mine < 0) askWho(data);
    myTab(data);
    // The Characters tab is this phone's home: from anywhere, even another
    // character's sheet, it goes back to its player's sheet.
    document.querySelector('.tabs a[data-tab="characters"]')?.addEventListener("click", () => {
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
