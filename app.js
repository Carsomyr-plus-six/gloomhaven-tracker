// Gloomhaven campaign tracker: reads campaign.json and shows it.
// Read-only for now; editing and saving come in a later branch.

// --- Rules (Gloomhaven 1st edition) -------------------------------------

// XP needed to reach level 1, 2, 3 ... 9.
const XP_FOR_LEVEL = [0, 45, 95, 150, 210, 280, 360, 450, 550];

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
                                      : `Could be ${rangeText(t.range)}: ${t.unsure.join(", ")} not settled`),
    h("ul", {}, t.entries.map(e => h("li", {},
      h("span", {}, e.label),
      h("span", { class: "num" }, `${rangeText(e.range)}${unit}`)))));
}

function reputationTile(party, ledger) {
  const modifier = shopModifier(party.reputation);
  const next = nextShopStep(party.reputation);
  const marker = h("span");
  marker.style.left = `${Math.max(0, Math.min(100, (party.reputation + 20) / 40 * 100))}%`;
  return h("div", { class: "card tile" },
    h("div", { class: "tile-top" }, h("span", { class: "label" }, "Reputation"), h("span", { class: "display" }, signed(party.reputation))),
    h("div", {},
      h("div", { class: "track", role: "presentation" }, marker),
      h("div", { class: "track-scale" }, h("span", {}, "−20"), h("span", {}, "0"), h("span", {}, "+20"))),
    h("div", { class: "tile-foot" },
      h("strong", {}, modifier === 0 ? "Shop prices normal" : `Shop ${priceText(modifier)}`),
      next ? h("span", {}, `${capitalize(priceText(next.modifier))} from ${signed(next.at)}`) : null),
    ledgerFoot(ledger?.reputation, ""));
}

function prosperityTile(city, ledger) {
  const level = stepFor(city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const toNext = progressFor(city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const from = CHECKMARKS_FOR_PROSPERITY[level - 1];
  return h("div", { class: "card tile" },
    h("div", { class: "tile-top" }, h("span", { class: "label" }, "Prosperity"), h("span", { class: "display" }, level)),
    toNext ? h("div", { class: "ticks", role: "img",
        "aria-label": `${city.prosperityCheckmarks - from} of ${toNext.next - from} checkmarks towards prosperity ${level + 1}` },
      Array.from({ length: toNext.next - from }, (_, i) => h("span", { class: i < city.prosperityCheckmarks - from ? "on" : null }))) : null,
    h("div", { class: "tile-foot" },
      h("strong", {}, toNext ? `${toNext.remaining} more to level ${level + 1}` : "Maximum level"),
      h("span", {}, `${plural(city.prosperityCheckmarks, "checkmark")} · ${city.donations} gold donated`)),
    ledgerFoot(ledger?.prosperity, ""));
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

function renderOverview(data) {
  const { party, city } = data;
  const ready = data.scenarios.filter(s => s.status === "available").sort((a, b) => a.number - b.number);
  const from = s => s.unlockedBy != null ? `Opened by ${scenarioLabel(data, s.unlockedBy)}`
                  : s.unlockedVia ? `Opened by ${s.unlockedVia}` : null;

  return [
    h("div", { class: "hero" },
      h("div", { class: "hero-head" },
        heroDecor(),
        h("div", { class: "eyebrow" }, [data.edition || "Gloomhaven", party.location].filter(Boolean).join(" · ")),
        h("h1", { class: "party-name" }, party.name || "Unnamed party")),
      h("div", { class: "ready" },
        h("div", { class: "ready-head" },
          h("h2", {}, "Ready to play"),
          h("a", { href: "#scenarios" }, `All ${plural(data.scenarios.length, "scenario")}`)),
        ready.length
          ? h("div", { class: "ready-list" }, ready.map(s =>
              h("a", { class: "ready-card", href: "#scenarios", onclick: () => openScenario(data, s.number) },
                hex(s.number),
                h("span", {},
                  h("span", { class: "ready-name" }, s.name || "Untitled"),
                  from(s) ? h("span", { class: "ready-from" }, from(s)) : null))))
          : empty("Nothing is unlocked to play right now.")),
      h("div", { class: "tiles" }, reputationTile(party, data.ledger), prosperityTile(city, data.ledger))),
    partyList(data),
  ];
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
          h("span", {}, [c.class, c.player].filter(Boolean).join(" · ")),
          st.unspent ? h("em", {}, `${plural(st.unspent, "perk")} to choose`) : null),
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
        h("span", { class: "display num" }, ev.decks[deck].size)),
      summary
        ? h("details", {}, h("summary", {}, summary),
            h("ul", {}, added.map(a => line("Added", a)), removed.map(r => line("Removed", r))))
        : h("span", { class: "small muted" }, "No changes yet"));
  };

  const question = q => {
    const [label, ...rest] = q.split(": ");
    return rest.length ? nudge("question", `${label} needs an answer`, capitalize(rest.join(": "))) : nudge("question", q);
  };

  const drawn = e => {
    const detail = [
      e.option ? `Option ${e.option}` : null,
      e.effects.length ? capitalize(e.effects.join(", ")) : null,
      !e.effects.length && e.adds.length ? `added ${e.adds.map(([d, n]) => eventLabel(d, n)).join(", ")}` : null,
      e.scenario ? `before #${e.scenario}` : null,
    ].filter(Boolean).join(" · ");
    return h("li", {},
      h("strong", {}, e.label),
      h("span", {}, detail || (e.notes ? null : "Option not recorded"),
        e.notes ? h("div", { class: detail ? "small muted" : null }, e.notes) : null),
      h("span", { class: `fate ${e.fate || "open"}` }, e.fate ? capitalize(e.fate) : "Needs an answer"));
  };

  return [
    sectionHead("Event decks", ev.history.length ? `${plural(ev.history.length, "event")} drawn` : null),
    h("div", { class: "decks" }, Object.keys(DECK_NAMES).map(deckCard)),
    ev.questions.map(question),
    ev.history.length ? h("ul", { class: "drawn" }, ev.history.map(drawn)) : null,
  ];
}

// --- Campaign record ---------------------------------------------------------

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
    (data.draws || []).map(d => nudge("question", `Draw ${d.what}`, `From ${d.from}. Not drawn yet.`)),
    h("div", { class: "record" },
      card("Party achievements", recordRows(party.achievements)),
      card("Global achievements", recordRows(city.globalAchievements)),
      card("In the shop for good", recordRows(city.itemDesigns)),
      card("Unlocked classes", city.unlockedClasses.length
        ? h("div", { class: "chips" }, city.unlockedClasses.map(c =>
            h("span", { class: "chip", title: c.where || null }, c.name || c)))
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
  const track = () => ({ value: 0, range: exact(0), entries: [], unsure: [] });
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
  const gain = (key, range, label) => {
    if (!range.lo && !range.hi) return;
    const t = totals[key];
    t.range = plus(t.range, range);
    t.value += settledPart(range);
    t.entries.push({ label, range });
    if (!isExact(range)) t.unsure.push(label);
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
        else record.draws.push({ what: "a random item design", from: label });
      } else gainAchievement(g.kind, g.id, label);
    }

    for (const k of ["reputation", "prosperity"]) {
      if (found.length) gain(k, found.map(o => o[k]).reduce(either), label);
    }

    // What to ask, if anything is still open.
    const one = found.length === 1 ? found[0] : null;
    if (!found.length) {
      questions.push(`${label}: check the option. The event data has no option ${e.option || ""} for this card.`.replace(" .", "."));
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
    for (const [deck, number] of [...mayAdds].map(a => JSON.parse(a))) {
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
      const { number, character, drew } = typeof t === "object" ? t : { number: t };
      const from = `treasure ${number}`;
      const parts = treasureParts(ref, number);
      for (const part of parts) {
        if (part.type === "item" || part.type === "itemDesign") addDesign(part.value, from);
        if (part.type === "scenario") unlocks.push({ number: Number(part.value), source: from });
        if (part.type === "randomScenario") {
          if (drew != null) unlocks.push({ number: Number(drew), source: from });
          else record.draws.push({ what: "a random side scenario", from: `${from}, looted in ${where}` });
        }
        if (part.type === "randomItemDesign") {
          if (drew != null) addDesign(drew, from);
          else record.draws.push({ what: "a random item design", from: `${from}, looted in ${where}` });
        }
      }
      const gives = parts.map(describeTreasurePart).join(", ") || "not in the treasure index";
      const scenarioDraw = parts.some(part => part.type === "randomScenario");
      const drawn = drew == null ? "" : ` (drew ${scenarioDraw ? `#${drew}` : drew})`;
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
  return { flat, pos, rows: leaves, cols };
}

function resultsList(results, sign = "") {
  return h("ul", { class: "results" }, results.map(r => h("li", {},
    h("strong", {}, r.character),
    r.xp != null ? h("span", { class: "num" }, `${sign}${r.xp} `, h("span", {}, "XP")) : null,
    r.gold != null ? h("span", { class: `num${sign ? " gain-gold" : ""}` }, `${sign}${r.gold} `, h("span", {}, "gold")) : null,
    sign ? null : h("span", { class: "marks" },
      r.checkmarks ? [icon("check", "Battle goal checkmarks"), String(r.checkmarks)] : null),
    r.notes ? h("span", { class: "extra" }, r.notes) : null)));
}

function scenarioFacts(data, s) {
  const pairs = [
    ["Unlocked by", s.unlockedBy != null ? scenarioLabel(data, s.unlockedBy) : s.unlockedVia],
    ["Completed", formatDate(s.completed)],
    ["Rewards", s.rewards.length ? capitalize(s.rewards.join(", ")) : null],
    ["Treasure", data.treasureInfo?.get(s.number)?.join("; ")
      || (s.treasures?.length ? `${s.treasures.map(t => t.number || t).join(", ")} looted` : null)],
  ].filter(([, value]) => value);
  return pairs.length ? h("dl", { class: "facts" }, pairs.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))) : null;
}

// One scenario as a row that opens in place. depth indents it in the tree.
function scenarioRow(data, s, depth = 0) {
  const open = scenarioOpen === s.number;
  const blockedWhy = s.status === "blocked" && s.reasons.length ? s.reasons.join(" · ") : null;
  const meta = s.status === "completed"
    ? [formatDate(s.completed), s.treasures?.length ? `treasure ${s.treasures.map(t => t.number || t).join(", ")}` : null].filter(Boolean).join(" · ")
    : s.status === "available"
      ? (s.unlockedBy != null ? `from #${s.unlockedBy}` : s.unlockedVia ? `from ${s.unlockedVia}` : "")
      : "";
  const elbow = depth ? h("span", { class: "elbow", "aria-hidden": "true" }, svg("0 0 14 22", '<path d="M2 1v10h10"/>')) : null;
  if (elbow) elbow.style.width = `${depth * 14}px`;

  return h("article", { class: `row${open ? " open" : ""}`, id: `scenario-${s.number}`, "data-scenario": s.number },
    h("button", {
        type: "button", class: "row-head", "data-key": `row-${s.number}`, "aria-expanded": String(open),
        onclick: () => { scenarioOpen = open ? null : s.number; scenarioPicked = s.number; render(data, "scenarios"); },
      },
      elbow,
      hex(s.number, HEX_KIND[s.status]),
      h("span", { class: "row-text" },
        h("span", { class: "row-name" }, s.name || "Untitled"),
        h("span", { class: "row-meta" },
          h("b", { class: `ink-${s.status}` }, blockedWhy || STATUS_LABELS[s.status] || s.status),
          meta ? ` · ${meta}` : null)),
      icon("chevron")),
    open ? h("div", { class: "row-body" },
      scenarioFacts(data, s),
      s.results?.length ? resultsList(s.results) : null,
      notes(s.notes)) : null);
}

// The unlock map for wide screens: scenarios laid out left to right, with the
// picked one described underneath.
function unlockMap(data, all, layout) {
  const W = 176, H = 48, GAP = 36, ROW = 64, T = 2;
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

  const nodes = all.map(s => {
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
      h("div", { class: "scenario-list tree-rows" }, layout.flat.map(({ s, depth }) => scenarioRow(data, s, depth))),
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

// --- Characters -----------------------------------------------------------------

let characterIndex = 0;   // which sheet a phone shows

function pickCharacter(data, index) {
  characterIndex = index;
  render(data, "characters");
}

// Battle-goal checkmarks, drawn as on the character sheet: six groups of
// three, each full group being a perk.
function goalBoxes(checkmarks) {
  return h("div", { class: "goals", role: "img", "aria-label": plural(checkmarks, "checkmark") },
    Array.from({ length: 6 }, (_, g) => h("span", { class: (g + 1) * 3 <= checkmarks ? "full" : null },
      Array.from({ length: 3 }, (_, b) => h("i", { class: g * 3 + b < checkmarks ? "on" : null })))));
}

function renderCharacters(data) {
  if (!data.characters.length) return [sectionHead("Characters"), empty("No characters recorded yet.")];

  const order = characterOrder(data);
  if (characterIndex >= order.length) characterIndex = 0;

  const card = c => {
    const st = characterStats(c);
    const fromGoals = perksFromCheckmarks(c.checkmarks);
    // The same perk taken twice shows once, with a count.
    const perks = [];
    for (const text of c.perks) {
      const same = perks.find(p => p.text === text);
      if (same) same.count++; else perks.push({ text, count: 1 });
    }
    return h("article", { class: `char-card${order.indexOf(c) === characterIndex ? " current" : ""}` },
      h("header", { class: "char-head" },
        h("div", { class: "char-level" }, hex(st.level, "level"), h("span", { class: "label" }, "Level")),
        h("div", {},
          h("h3", {}, c.name),
          h("p", {}, [c.class, c.player ? `played by ${c.player}` : null, c.retired ? "retired" : null].filter(Boolean).join(" · ")))),
      h("div", { class: "block" },
        h("div", { class: "block-head" },
          h("span", { class: "xp-now num" }, `${c.xp} XP`),
          h("span", { class: `xp-next${st.close ? " close" : ""}` }, st.nextText)),
        meter(st.toNext ? st.toNext.fraction : 1, st.close),
        st.toNext ? h("div", { class: "xp-scale num" },
          h("span", {}, `Level ${st.level} at ${XP_FOR_LEVEL[st.level - 1]}`),
          h("span", {}, `Level ${st.level + 1} at ${st.toNext.next}`)) : null),
      h("div", { class: "char-stats" },
        h("div", {}, h("span", { class: "label" }, "Gold"), h("span", { class: "gold num" }, c.gold)),
        c.personalQuest ? h("div", {},
          h("span", { class: "label" }, "Personal quest"),
          h("span", { class: "quest" }, c.personalQuest),
          h("span", { class: "quest-hint" }, "Secret, progress only")) : null),
      h("div", { class: "block goal-block" },
        h("div", { class: "block-head" },
          h("span", { class: "label" }, "Battle goals"),
          h("span", {}, `${plural(c.checkmarks, "checkmark")} · ${plural(fromGoals, "perk")}`)),
        goalBoxes(c.checkmarks)),
      h("div", { class: "block" },
        h("div", { class: "block-head" },
          h("span", { class: "label" }, "Perks"),
          h("span", {}, `${c.perks.length} of ${st.earned} taken`)),
        st.unspent ? nudge("plus", `${plural(st.unspent, "perk")} to choose`, null, "perk-nudge") : null,
        perks.length
          ? h("ul", { class: "perks" }, perks.map(p => h("li", {},
              icon("check"), h("span", {}, p.text), p.count > 1 ? h("span", { class: "times" }, `×${p.count}`) : null)))
          : h("span", { class: "small muted" }, "None taken yet.")),
      c.items.length ? h("div", { class: "block" },
        h("div", { class: "block-head" }, h("span", { class: "label" }, "Items"), h("span", {}, `${c.items.length} carried`)),
        h("div", { class: "chips" }, c.items.map(i => h("span", { class: "chip" }, i)))) : null,
      notes(c.notes, "char-notes"));
  };

  const active = order.filter(c => !c.retired);
  const retired = order.filter(c => c.retired);

  // Phones show one sheet at a time, chosen from this row.
  const switcher = h("div", { class: "char-switch", role: "group", "aria-label": "Choose a character" },
    order.map((c, i) => {
      const st = characterStats(c);
      return h("button", {
          type: "button", "data-key": `char-${i}`,
          "aria-pressed": String(i === characterIndex),
          onclick: () => pickCharacter(data, i),
        },
        h("span", {}, hex(st.level, "quiet"),
          st.unspent ? h("span", { class: "dot", role: "img", "aria-label": "Has a perk to choose" }) : null),
        h("span", {}, c.name));
    }));

  return [
    sectionHead("Characters", [`${active.length} active`, retired.length ? `${retired.length} retired` : null].filter(Boolean).join(" · ")),
    switcher,
    active.length ? h("div", { class: "char-grid" }, active.map(card)) : empty("No active characters."),
    retired.length ? [h("h3", { class: "subhead" }, "Retired"), h("div", { class: "char-grid" }, retired.map(card))] : null,
  ];
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

function renderSessions(data) {
  if (!data.sessions.length) return [sectionHead("Sessions"), empty("No sessions recorded yet.")];
  const sorted = [...data.sessions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const eventsBefore = number => (data.eventState?.history || []).filter(e => e.scenario === number).map(e => e.label);

  return [
    sectionHead("Sessions", "Newest first"),
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
              s.scenarios.length ? plural(s.scenarios.length, "scenario") : null,
              s.characters?.length ? s.characters.join(", ") : null,
            ].filter(Boolean).join(" · "))),
          s.scenarios.length ? h("ul", { class: "card played" }, s.scenarios.map(sc => {
            const name = data.scenarios.find(x => x.number === sc.number)?.name;
            const before = eventsBefore(sc.number);
            const won = sc.result === "success";
            return h("li", {},
              hex(sc.number, won ? "completed" : "blocked"),
              h("span", { class: "played-text" },
                h("strong", {}, name || `Scenario ${sc.number}`),
                before.length ? h("span", {}, `${before.join(", ")} drawn before`) : null),
              h("span", { class: `result ${won ? "success" : "failure"}` }, icon(won ? "check" : "cross"), won ? "Success" : "Failure"));
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
  scenarios: renderScenarios,
  sessions: renderSessions,
  events: renderEvents,
  record: renderRecord,
};

// Which tab each section belongs to on a phone.
const TAB_OF = { overview: "overview", events: "overview", record: "overview",
                 scenarios: "scenarios", characters: "characters", sessions: "sessions" };

function currentTab() {
  const id = location.hash.slice(1);
  return id.startsWith("scenario-") ? "scenarios" : TAB_OF[id] || "overview";
}

function render(data, only) {
  // Redrawing replaces the buttons, so put focus and the map's scroll back.
  const key = document.activeElement?.dataset?.key;
  const mapScroll = document.querySelector(".map-scroll")?.scrollLeft;

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
}

// On a phone, show the current tab's sections and hide the rest.
function showTab() {
  const tab = currentTab();
  for (const el of document.querySelectorAll("main [data-tab]")) el.classList.toggle("off", el.dataset.tab !== tab);
  for (const a of document.querySelectorAll(".tabs a[data-tab]")) {
    if (phone.matches && a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
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
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = withDefaults(await response.json());
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

    if (data.party.name) {
      document.getElementById("title").textContent = data.party.name;
      document.title = `${data.party.name} · Gloomhaven`;
    }
    document.getElementById("footer").replaceChildren(
      [data.edition, data.updated ? `updated ${formatDate(data.updated)}` : null,
       url.pathname.endsWith("/campaign.json") ? null : `showing ${url.pathname}`].filter(Boolean).join(" · "),
      h("br"),
      ...(ref ? ["Scenario data from ", h("a", { href: ref.source }, "Gloomhaven Secretariat"), ` (${ref.license}). `]
              : ["Scenario reference data couldn't be loaded. "]),
      "Unofficial fan project; Gloomhaven is © Cephalofair Games.");

    render(data);
    status.remove();
    showTab();
    window.addEventListener("hashchange", onNavigate);
    phone.addEventListener("change", showTab);
    // Arriving on a link to a section: go there now that it exists.
    if (location.hash.length > 1) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (err) {
    status.classList.add("error");
    status.textContent = `Couldn't load the campaign (${url.pathname}): ${err.message}`;
  }
}

start();
