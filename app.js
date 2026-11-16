// Gloomhaven campaign tracker: reads campaign.json and shows it, and builds
// an updated campaign.json from a session recorded on the page.

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
  book: '<path d="M5 5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2z"/><path d="M5 20a2 2 0 0 0 2 2h12v-4"/>',
  cards: '<rect x="4" y="6.500" width="11" height="14" rx="2"/><path d="M8.500 3.500H18a2 2 0 0 1 2 2V17"/>',
  heart: '<path d="M12 20s-7.500-4.600-7.500-10.200A4.200 4.200 0 0 1 12 7.300a4.200 4.200 0 0 1 7.500 2.500C19.500 15.400 12 20 12 20z"/>',
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

// A mention of a scenario that opens it under Scenarios, as the Ready
// to play cards do.
function scenarioLink(data, number, text = scenarioLabel(data, number)) {
  return h("a", { class: "scenario-link", href: "#scenarios", onclick: () => openScenario(data, number) }, text);
}

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
  // Phones: one line, opening the tile as a sheet.
  const line = h("button", { type: "button", class: "level-line", "data-tab": "tonight", "data-key": "level-line", onclick: () => openSheet("level") },
    playing.length ? hex(level, "now") : null,
    h("span", { class: "level-line-text" },
      h("strong", {}, playing.length ? `Level ${level}` : "Pick who is playing"),
      playing.length ? h("span", {}, `${diffLabel} · ${plural(playing.length, "player")}`) : null),
    icon("chevron"));
  const tile = h("div", { class: "card tile level-tile", "data-tab": "tonight" },
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
  return [line, sheet("level", "Scenario level", tile)];
}

// --- Sheets (phones) ---------------------------------------------------------
// A screen opened, used and closed (the Shop, enhancing, the session form,
// the scenarios to pick from, who's playing): on a phone it slides up over
// the tab, full height, with its title and Close, and Back or Escape closes
// it; the page behind is out of reach meanwhile. On a wide screen it's part
// of the page as before. Which is open survives a redraw.
let openSheetId = null;
let sheetOpener = null;
const sheetOnClose = {};
let sheetInert = [];

function sheet(id, title, content, onClose) {
  if (onClose) sheetOnClose[id] = onClose; else delete sheetOnClose[id];
  return h("div", { class: "sheet", "data-sheet": id },
    h("div", { class: "sheet-head" },
      h("h2", { id: `sheet-${id}-title`, tabindex: "-1" }, title),
      h("button", { type: "button", class: "btn quiet sheet-close", "data-key": `sheet-close-${id}`, onclick: () => closeSheet() }, icon("cross"), "Close")),
    h("div", { class: "sheet-body" }, content));
}

function openSheet(id) {
  if (!phone.matches) return;
  if (!openSheetId) {
    sheetOpener = document.activeElement;
    history.pushState({ sheet: id }, "", location.href);
  }
  openSheetId = id;
  applySheets();
  const el = document.querySelector(`[data-sheet="${id}"]`);
  if (el) el.scrollTop = 0;
  document.getElementById(`sheet-${id}-title`)?.focus({ preventScroll: true });
}

function closeSheet(fromHistory = false) {
  const id = openSheetId;
  if (!id) return;
  openSheetId = null;
  applySheets();
  if (!fromHistory && history.state?.sheet) history.back();
  sheetOnClose[id]?.();
  // Back to what opened it, or, if a redraw replaced it, what took its place.
  const key = sheetOpener?.dataset?.key;
  const back = sheetOpener?.isConnected ? sheetOpener : key ? document.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
  back?.focus({ preventScroll: true });
  sheetOpener = null;
}

// The open sheet, marked as a dialog, and everything around it inert. While
// open it's lifted out to the top of the page, above every layer the page
// makes, with a marker left where it lives; closing puts it back (or drops
// it, if a redraw has drawn it afresh there).
function applySheets() {
  for (const el of sheetInert) el.inert = false;
  sheetInert = [];
  for (const el of document.querySelectorAll("body > .sheet")) {
    if (el._home?.isConnected) el._home.replaceWith(el); else el.remove();
  }
  let open = null;
  for (const el of document.querySelectorAll("[data-sheet]")) {
    const on = phone.matches && el.dataset.sheet === openSheetId;
    el.classList.toggle("open", on);
    if (on) {
      open = el;
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-labelledby", `sheet-${el.dataset.sheet}-title`);
    } else {
      for (const a of ["role", "aria-modal", "aria-labelledby"]) el.removeAttribute(a);
    }
  }
  if (openSheetId && !open) openSheetId = null;   // gone in a redraw
  document.documentElement.classList.toggle("sheet-open", Boolean(open));
  if (open) {
    open._home = document.createComment(`sheet ${open.dataset.sheet}`);
    open.before(open._home);
    document.body.append(open);
  }
  for (let node = open; node && node !== document.body; node = node.parentElement) {
    for (const sib of node.parentElement.children) {
      if (sib !== node && !sib.inert) { sib.inert = true; sheetInert.push(sib); }
    }
  }
}

window.addEventListener("popstate", () => { if (openSheetId) closeSheet(true); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && openSheetId) { e.preventDefault(); closeSheet(); } });

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
  return here && here !== "Gloomhaven" ? here : null;
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
      // Phones: the scenario picked for tonight, to set up by.
      scenarioCard(data),
      // Phones: the battle goal this phone's player kept, hidden until asked.
      battleGoalCard(data),
      h("div", { class: "hero-side" },
        todoList(data),
        // Once one is picked, the rest open as a sheet from its Change.
        (tonightScenario(data) ? (el => sheet("ready", "Pick tonight's scenario", el)) : el => el)(h("div", { class: "ready", "data-tab": "tonight" },
          h("div", { class: "ready-head" },
            h("h2", {}, "Ready to play"),
            h("a", { href: "#scenarios" }, data.scenarios.length > 1 ? `All ${data.scenarios.length} scenarios` : "Scenarios")),
          ready.length
            ? h("div", { class: "ready-list" }, ready.map(s => {
                const tried = attemptsText(data, s.number);
                // A phone picks it for tonight, here; a wide screen opens its details.
                const picked = tonightScenario(data)?.number === s.number;
                return h("a", { class: `ready-card${picked ? " picked" : ""}`, href: "#scenarios", "data-key": `ready-${s.number}`,
                                onclick: e => { if (phone.matches) { e.preventDefault(); pickTonight(data, s.number); } else openScenario(data, s.number); },
                                "aria-current": picked ? "true" : null,
                                "aria-label": [`#${s.number} ${s.name || "Untitled"}`, from(s), tried ? capitalize(tried) : null, picked ? "tonight's scenario" : null].filter(Boolean).join(", ") },
                  hex(s.number),
                  h("span", {},
                    h("span", { class: "ready-name" }, s.name || "Untitled"),
                    from(s) ? h("span", { class: "ready-from" }, from(s)) : null,
                    tried ? h("span", { class: "ready-tried" }, capitalize(tried)) : null));
              }))
            : empty("Nothing is unlocked to play right now."))))),
    partyList(data),
  ];
}

// --- Tonight's scenario (phones) ----------------------------------------------
// Tapping a Ready to play card on a phone picks it for tonight, and the
// Tonight tab shows what setting it up needs: its level's numbers, whether a
// road event comes first, its treasure tiles, and each player's hand size
// and hit points. Kept in this browser; a scenario no longer open to play is
// forgotten. Without a pick, the first scenario in the draft stands in.
const PICK_KEY = storeKey("tonightScenario");
let tonightPick = null;
try { tonightPick = Number(localStorage.getItem(PICK_KEY)) || null; } catch {}

function pickTonight(data, number) {
  if (openSheetId === "ready") { openSheetId = null; if (history.state?.sheet) history.back(); }
  tonightPick = number;
  try { if (number) localStorage.setItem(PICK_KEY, String(number)); else localStorage.removeItem(PICK_KEY); } catch {}
  // The Play tab names it too, over the cards.
  render(data, "characters");
  render(data, "overview");
  const card = document.querySelector(".scen-ref");
  if (card) { card.scrollIntoView({ block: "start", behavior: "instant" }); card.focus({ preventScroll: true }); }
  else document.querySelector(".ready-card")?.focus();
}

function tonightScenario(data) {
  const open = n => data.scenarios.find(s => s.number === n && s.status === "available") || null;
  const drafted = (draft?.scenarios || []).map(s => num(s.number)).find(n => n && open(n));
  return open(tonightPick) || (drafted ? open(drafted) : null);
}

// The last scenario played, as straightOn() reads it.
function lastPlayed(data) {
  return [...data.sessions].filter(s => s.date && s.scenarios?.length)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.scenarios.at(-1) || null;
}

// Whether a road event comes before this scenario (rulebook p. 41).
function roadEventText(data, number) {
  if (!needsRoadEvent(number)) return "None: it's linked to Gloomhaven";
  const last = lastPlayed(data);
  if (last && last.number === number && last.result !== "success") return `None to retry it straight away; from town, draw one`;
  const links = (scenarioRef?.scenarios?.[String(last?.number)]?.links || []).map(Number);
  if (links.includes(number)) return `None going straight on from #${last.number}; from town, draw one`;
  return "Draw one on the way";
}

function scenarioCard(data) {
  const s = tonightScenario(data);
  if (!s) return null;
  const ref = scenarioRef?.scenarios?.[String(s.number)] || {};
  const t = tonight(data);
  const playing = characterOrder(data).filter(c => !c.retired && levelParty?.has(c.name));
  const looted = new Set((s.treasures || []).map(x => String(x.number ?? x)));
  const tiles = ref.treasures || [];
  const facts = [
    ["Road event", roadEventText(data, s.number)],
    ["Treasure", tiles.length ? tiles.map(n => looted.has(String(n)) ? `${n} (looted)` : String(n)).join(", ") : "None"],
    ["Boss", ref.boss ? "Yes" : null],
    ["Rewards", s.rewards?.length ? capitalize(s.rewards.join(", ")) : null],
  ].filter(([, v]) => v);
  return h("section", { class: "card scen-ref", "data-tab": "tonight", tabindex: "-1", "aria-labelledby": "scen-ref-title" },
    h("div", { class: "scen-ref-head" },
      hex(s.number),
      h("div", {},
        h("span", { class: "label" }, "Tonight's scenario"),
        h("h2", { id: "scen-ref-title" }, s.name || `Scenario ${s.number}`)),
      tonightPick === s.number ? h("button", { type: "button", class: "btn quiet scen-ref-change", "data-key": "scen-ref-change",
        onclick: () => openSheet("ready") }, "Change") : null),
    staleTracker(data, s),
    // The level's numbers, as the monster stat cards and the map need them.
    t ? h("div", { class: "level-stats ref-stats" },
          [["Monster level", t.level], ["Trap damage", t.trap], ["Hazardous terrain", t.hazard], ["Gold per coin", t.gold], ["Bonus XP", `+${t.xp}`]]
            .map(([label, value]) => h("div", {}, h("span", { class: "label" }, label), h("span", { class: "num" }, value))))
      : h("p", { class: "small muted" }, "Pick who is playing, under Scenario level, for the numbers."),
    h("dl", { class: "facts" }, facts.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))),
    // Each player's setup.
    playing.length ? h("div", { class: "ref-players" },
      h("h3", { class: "label" }, "Each player"),
      h("ul", {}, playing.map(c => h("li", {},
        h("strong", {}, c.name),
        // Cards to pick and hit points, as marks rather than words.
        h("span", { class: "ref-nums" },
          handSize(c) ? h("span", {}, icon("cards"), h("b", { class: "num" }, handSize(c)), h("span", { class: "sr-only" }, " cards")) : null,
          maxHealth(c) ? h("span", {}, icon("heart"), h("b", { class: "num" }, maxHealth(c)), h("span", { class: "sr-only" }, " hit points")) : null)))),
      h("p", { class: "small muted" }, "Deal each player two battle goals; each keeps one.")) : null,
    h("div", { class: "ref-actions" },
      // The recorder's phone (the one with a draft) records it from here.
      rawCampaign && draft ? h("button", { type: "button", class: "btn", "data-key": "scen-ref-record", onclick: () => recordScenario(data, s.number) },
        draft.scenarios?.some(x => num(x.number) === s.number) ? "Go to it in the draft" : "Record it") : null,
      h("a", { class: "ref-more", href: "#scenarios", onclick: () => openScenario(data, s.number) }, "Its details under Scenarios")));
}

// This phone's tracker still holding numbers from another scenario, or an
// earlier day: said on tonight's scenario, with a way to start fresh (asked
// twice, as on the dock).
function staleTracker(data, s) {
  const c = data.characters.find(x => !x.retired && x.name === me);
  if (!c || !tableActive(c.name)) return null;
  const st = tableState(c.name);
  const earlier = !st.since || st.since < today();
  if (!earlier && (!st.scenario || st.scenario === s.number)) return null;
  const from = !st.since ? "an earlier scenario" : earlier ? formatDate(st.since, { day: "numeric", month: "short" }) : scenarioLabel(data, st.scenario);
  let armed = null;
  const fresh = h("button", { type: "button", class: "btn quiet", "data-key": "ref-fresh", onclick: () => {
    if (!armed) {
      fresh.textContent = "Tap again to clear";
      armed = setTimeout(() => { armed = null; fresh.textContent = "Start fresh"; }, 3000);
      return;
    }
    clearTimeout(armed);
    resetTable(c.name);
    render(data);
    document.querySelector(".scen-ref")?.focus({ preventScroll: true });
  } }, "Start fresh");
  return h("div", { class: "ref-stale" }, icon("replay"), h("span", {}, `${c.name}'s tracker still holds the numbers from ${from}.`), fresh);
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

// An evening of Gloomhaven, in the order it runs: a city event, the town
// (shop, perks, the Sanctuary), a road event, then the scenario. Each step
// links to where it's handled; the strip ends with recording the evening.
// A donation to the Sanctuary: two Bless cards each for the next scenario
// (p. 45). Said with the donation, in town, where it's made.
function blessings() {
  const who = new Set((draft?.donations || []).filter(x => x.character).map(x => x.character));
  return who.size ? ` (${who.size * 2} Bless)` : "";
}

// One phone records the evening: the one holding a draft. Wide screens are
// for keeping the campaign, so they always record. On the other phones
// nothing starts a draft but "Record the evening on this phone".
function isRecorder() { return !phone.matches || Boolean(draft); }

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
  // On the phones that aren't recording, the event steps open the decks to
  // read, not the form.
  const recorder = isRecorder();
  // Anyone to play: a new campaign has no one until characters are added.
  const anyone = data.characters.some(c => !c.retired) || Boolean(draft?.newCharacters?.some(x => x.name));
  const nav = h("nav", { class: "tonight", "data-tab": "tonight", "aria-label": "Tonight, step by step" },
    step(1, "City event", drawn("city") || (decks ? `${decks.city.size} in the deck` : "Draw one"), "#events",
      recorder ? () => recordEvent(data, "city") : null, Boolean(drawn("city"))),
    step(2, "In town", town || (shop ? (shop.modifier === 0 ? "Normal prices" : `Prices ${signed(shop.modifier)} gold`) : "Shop, perks, Sanctuary"),
      "#shop", null, Boolean(town)),
    step(3, "Road event", drawn("road") || (decks ? `${decks.road.size} in the deck` : "Draw one") + straightOn(data), "#events",
      recorder ? () => recordEvent(data, "road") : null, Boolean(drawn("road"))),
    step(4, "Scenario", (played.length ? played.map(s => scenarioLabel(data, num(s.number))).join(", ")
      : t ? (tonightScenario(data) ? `${scenarioLabel(data, tonightScenario(data).number)} · level ${t.level}` : `Level ${t.level} · deal battle goals`)
      : anyone ? "Pick who is playing" : "Add characters first"), anyone ? "#scenarios" : "#sessions",
      played.length ? () => showInRecorder(data, `sc-${firstPlayed}-n`) : anyone ? null : () => addNewcomer(data), played.length > 0),
    // On a phone that isn't recording, a quiet link rather than a button.
    rawCampaign ? h("button", { type: "button", class: recorder ? `btn${recording ? "" : " primary"} tonight-record` : "tonight-record quiet-link", "data-key": "tonight-record",
      onclick: () => { if (!draft) draft = newDraft(data); showInRecorder(data, "rec-date"); } },
      recording ? "Go on recording" : recorder ? "Record the evening" : "Record the evening on this phone") : null);
  // Phones: the Scenario step goes to tonight's scenario, or what's ready to
  // play, on this tab rather than the Campaign tab's list.
  nav.querySelectorAll(".tonight-step")[3]?.addEventListener("click", e => {
    if (!phone.matches || played.length || !anyone) return;
    e.preventDefault();
    const to = document.querySelector(".scen-ref") || document.querySelector(".ready");
    to?.scrollIntoView({ block: "start", behavior: "instant" });
    (to?.matches(".scen-ref") ? to : to?.querySelector(".ready-card"))?.focus({ preventScroll: true });
  });
  // The first step not yet in the draft is the one to see to now.
  const now = nav.querySelector(".tonight-step:not(.done)");
  if (now) { now.classList.add("current"); now.setAttribute("aria-current", "step"); }
  return nav;
}

// Everything waiting on the party before the next scenario, gathered from
// the sections that work it out. Each entry links to where it's handled.
function todoItems(data) {
  const items = [];
  // place: what the link says, if not the section's name.
  // urgent: it stops someone playing, so it goes first, marked.
  const add = (text, href, onclick, action, place, urgent) => items.push({ text, href, onclick, action, place, urgent });
  // Whose each is: a character's name, "table" for what everyone plays by,
  // or none for keeping the record.
  const whose = (from, who) => { for (const item of items.slice(from)) item.who = who; };
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
    const from = items.length;
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
    if (quest?.known && !quest.fits(questWritten(c))) {
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
    for (const r of perkCheck(c).rows.filter(r => r.note)) add(`${c.name}: "${r.written}". ${r.note}`, "#characters", go, null, sheet);
    whose(from, c.name);
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
  const fromEvents = items.length;
  for (const e of waiting) {
    const oc = chosenOutcome(data, classRef, e.deck, e.number, e.option, e.names, e.paid);
    for (const fx of (oc?.effects || []).filter(fx => fx.type === "nextScenario")) add(`${eventLabel(e.deck, e.number)}, option ${e.option}: ${nextScenarioText(fx)}.`, "#sessions");
  }
  whose(fromEvents, "table");
  (data.claims || []).forEach((c, i) => add(`Treasure ${c.treasure} in ${c.where} gave ${c.item}: who looted it?`, "#record", null,
    rawCampaign ? { label: "Record it", run: () => recordClaim(data, i) } : null));

  // What the rulebook opens when the campaign reaches it (p. 49): the
  // milestones that are ready (campaign.js).
  for (const x of milestoneStates(data)) if (x.todo) add(...x.todo);

  // Events with no option recorded go together; other questions one by one.
  const questions = data.eventState?.questions || [];
  const noOption = questions.filter(q => /: which option did you choose/.test(q)).map(q => q.split(":")[0]);
  if (noOption.length) {
    add(`${noOption.join(", ")}: ${noOption.length === 1 ? "no option recorded" : "no options recorded"}, so reputation${data.shop?.pricesUnsure ? " and shop prices" : ""} can't be settled.`, "#events");
  }
  for (const q of questions.filter(q => !/: which option did you choose/.test(q))) add(q.replace(/^(Ledger|Record): /, ""), "#events");

  for (const q of data.shop?.questions || []) add(q, "#shop");
  // campaign.json keeping something it needn't, or out of place (campaign.js).
  for (const q of data.fileQuestions || []) add(q, "#record");

  return [...items.filter(i => i.urgent), ...items.filter(i => !i.urgent)];
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
  // A phone opens it as a sheet over the tab it's on.
  if (phone.matches) { openSheet("record"); go(); return; }
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

// The recorder's quick picks: completed scenarios too, once asked for, until
// one is picked.
let showReplays = false;

// Personal quests are secret at the table, so a sheet's progress shows only
// once its player taps it (until they tap again, or the page reloads). A
// fulfilled quest is no secret: the character retires.
const questShown = new Set();

// What each retirement in a draft opens: what the retiring character's
// quest card opens, on a device that knows the card (fromCard says it came
// from one). Once the card is forgotten, or someone else is picked, it goes;
// a box picked by hand in an older draft stays until the card is picked.
// Run before anything reads the draft's retirements.
function syncRetirements(d) {
  let changed = false;
  for (const x of d.retirements || []) {
    const opens = x.character ? questUnlocks(questCard(x.character)) : "";
    if (opens && (x.unlocks !== opens || !x.fromCard)) { x.unlocks = opens; x.fromCard = true; changed = true; }
    else if (!opens && x.fromCard) { x.unlocks = ""; delete x.fromCard; changed = true; }
  }
  if (changed) saveDraft();
}

// "Record it" for a fulfilled personal quest: a retirement row in the form,
// which their quest card fills in (on a device that knows it).
function recordRetire(data, name) {
  if (!draft) draft = newDraft(data);
  let i = draft.retirements.findIndex(x => x.character === name);
  if (i < 0) { draft.retirements.push({ character: name, unlocks: "" }); i = draft.retirements.length - 1; }
  syncRetirements(draft);
  showInRecorder(data, `ret-${i}-c`);
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
  const all = todoItems(data);
  // A player's phone: their own character's, what stops anyone playing, and
  // what the table plays by. The record's loose ends wait for the recorder.
  const player = phone.matches && !isRecorder() && data.characters.some(c => !c.retired && c.name === me);
  const items = player ? all.filter(i => i.urgent || i.who === me || i.who === "table") : all;
  const rest = all.length - items.length;
  return h("div", { class: "card todo", "data-tab": "tonight" },
    h("div", { class: "block-head" },
      h("h2", { class: "label" }, "Before you play"),
      h("span", {}, items.length ? plural(items.length, "thing") + " to see to" : player ? `Nothing for ${me}` : "All clear")),
    items.length
      ? h("ul", { class: "rows" }, items.map(item => h("li", { class: item.urgent ? "urgent" : null },
          h("span", {}, item.urgent ? icon("lock", "Stops play") : null, item.text),
          h("span", { class: "todo-acts" },
            item.action && isRecorder() ? h("button", { type: "button", class: "todo-do", onclick: item.action.run }, item.action.label) : null,
            h("a", { class: "todo-go", href: item.href, onclick: item.onclick || null }, item.place || TODO_PLACES[item.href] || "Open")))))
      : rest ? null : h("p", { class: "small muted" }, "Nothing to sort out before the next scenario."),
    rest ? h("p", { class: "small muted todo-rest" }, `${rest} more for whoever records the evening.`) : null);
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

function renderRecord(data) {
  const { party } = data;
  const card = (title, body, extra, aside) => h("div", { class: `card${extra ? ` ${extra}` : ""}` },
    h("div", { class: "block-head" }, h("h3", { class: "label" }, title), aside ? h("span", {}, aside) : null), body);
  const classes = Object.keys(classRef?.classEvents || {});
  return [
    sectionHead("Campaign record"),
    recordStats(data),
    (data.fileQuestions || []).map(q => nudge("question", "Tidy campaign.json", q)),
    // The page can't record a draw itself, so say exactly what to write.
    (data.draws || []).map(d => nudge("question", `Draw ${d.what}`, [
      `From ${d.from}. Not drawn yet.`,
      d.how ? h("span", { class: "how" }, codeText(`Once drawn, record it in \`campaign.json\`: ${d.how}.`)) : null])),
    // The form settles it; without the form, say what to write.
    (data.claims || []).map((c, i) => nudge("question", `Who looted ${c.item}?`, [
      `Treasure ${c.treasure} in ${c.where} gave it, but no one is written down as looting it, and no sheet has it.`,
      // Recorded on the phone recording the evening (any wide screen).
      rawCampaign && isRecorder()
        ? h("div", { class: "nudge-do" }, h("button", { type: "button", class: "todo-do", "data-key": `claim-${i}`, onclick: () => recordClaim(data, i) }, "Record it"))
        : rawCampaign ? null
        : h("span", { class: "how" }, codeText(`Record it in \`campaign.json\`: ${c.how}.`))])),
    h("div", { class: "record" },
      card("Milestones", milestones(data), "record-miles"),
      card("Party achievements", achievementRows(data, "party"), "record-wide"),
      card("Global achievements", achievementRows(data, "global"), "record-wide"),
      classes.length ? card("Classes", classBoxes(data, classes), "record-classes",
        `${classes.filter(id => data.city.unlockedClasses.some(u => u.id === id)).length} of ${classes.length}`) : null,
      card("In the shop for good", designRows(data)),
      card("Retired", retiredRows(data))),
    party.notes ? h("div", { class: "party-notes" }, h("h3", { class: "label" }, "Party notes"), notes(party.notes)) : null,
  ];
}

// The campaign at a glance, as the level's numbers are shown: big numbers,
// small labels.
function recordStats(data) {
  const done = data.scenarios.filter(s => s.status === "completed").length;
  const stats = [
    ["Completed", [String(done), h("small", {}, ` of ${data.scenarios.length}`)]],
    ["Sessions", data.sessions.length],
    ["Retired", data.characters.filter(c => c.retired).length],
    ["Prosperity", stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY)],
    ["Reputation", signed(data.party.reputation)],
  ];
  return h("div", { class: "level-stats record-stats" },
    stats.map(([label, value]) => h("div", {}, h("span", { class: "label" }, label), h("span", { class: "num" }, value))));
}

// What the campaign is working towards, each with how far it has come: the
// envelopes, the Town Records Book and the class boxes reputation opens
// (rulebook p. 49). Done is "Open", reached but not yet done is "Ready".
function milestones(data) {
  const envelope = letter => h("span", { class: "mile-env", "aria-hidden": "true" }, letter);
  const MARKS = { "envelope-a": () => envelope("A"), "envelope-b": () => envelope("B"), "envelope-x": () => envelope("X"),
    "town-records": () => icon("book"), sun: () => gameIcon("class-sun"), eclipse: () => gameIcon("class-eclipse"),
    "events-plus-20": () => icon("plus"), "events-minus-20": () => icon("minus"), drake: () => icon("plus") };
  return h("ul", { class: "miles" }, milestoneStates(data).filter(x => x.shown).map(x =>
    h("li", { class: x.open ? "open" : x.ready ? "ready" : null },
      h("span", { class: "mile-mark" }, MARKS[x.id]?.()),
      h("span", { class: "mile-text" },
        h("span", { class: "mile-name" }, h("strong", {}, x.name), h("span", { class: "mile-state" },
          x.open ? "Open" : x.ready ? "Ready" : x.says || (x.need ? `${Math.max(0, x.have)} of ${x.need}${x.unit ? ` ${x.unit}` : ""}` : x.what))),
        x.need && !x.open ? meter(Math.max(0, Math.min(1, x.have / x.need)), x.ready) : null,
        x.need && !x.open && x.what ? h("span", { class: "sub" }, x.what) : null))));
}

// Each achievement with what it does to the scenarios found so far: which
// it opened or opens, which it blocks (none not yet found, which would
// spoil them). Lost and replaced ones follow, struck through.
function achievementRows(data, kind) {
  const list = kind === "party" ? data.party.achievements : data.city.globalAchievements;
  const lost = (data.lostAchievements || []).filter(a => a.kind === kind);
  if (!list.length && !lost.length) return h("p", { class: "small muted" }, "None yet.");
  const counts = achievementCounts(data)[kind];
  const does = id => {
    const out = [];
    if (id === "the-power-of-enhancement") out.push(h("a", { href: "#enhancing" }, "Enhancing open"));
    if (id === "ancient-technology") out.push(`${Math.min(counts.get(id) || 0, ANCIENT_TECHNOLOGY_FOR_ENVELOPE_A)} of ${ANCIENT_TECHNOLOGY_FOR_ENVELOPE_A} for Envelope A`);
    for (const s of data.scenarios) {
      const alts = scenarioRef?.scenarios?.[String(s.number)]?.requirements || [];
      const has = (alt, negated) => Object.entries(alt).some(([k, vs]) => k === kind
        && vs.some(v => v.startsWith("!") === negated && v.replace(/^!/, "").split(":")[0] === id));
      const link = scenarioLink(data, s.number, `#${s.number}`);
      const alt = alts.find(a => has(a, false));
      if (alt) {
        // What else that scenario needs alongside it.
        const others = Object.entries(alt).flatMap(([k, vs]) => vs.filter(v => !(k === kind && v.split(":")[0] === id))
          .map(v => [v.startsWith("!"), achievementName(scenarioRef, k, v.replace(/^!/, "").split(":")[0])]));
        const said = (not, word) => others.filter(([n]) => n === not).map(([, name]) => name).join(" and ").replace(/^(.)/, `${word} $1`);
        out.push([s.status === "completed" ? "opened " : "opens ", link,
          [said(false, "with"), said(true, "without")].filter(Boolean).map(x => ` ${x}`).join(" and")]);
      } else if (alts.some(a => has(a, true)) && s.status !== "completed") out.push(["blocks ", link]);
    }
    return out.length ? h("span", { class: "sub" }, out.flatMap((x, i) => i ? [" · ", x] : [x])) : null;
  };
  const where = text => {
    const n = /^#(\d+)$/.exec(String(text))?.[1];
    return n ? scenarioLink(data, Number(n), text) : text;
  };
  return h("ul", { class: "rows" },
    list.map(a => h("li", {},
      h("span", {}, h("strong", {}, a.name, a.count > 1 ? ` ×${a.count}` : null), a.notes ? h("span", { class: "sub" }, a.notes) : null, does(a.id)),
      a.where ? h("span", { class: "where" }, where(a.where)) : null)),
    lost.map(a => h("li", { class: "lost" },
      h("span", {}, h("s", {}, a.name), h("span", { class: "sub" }, capitalize(a.how), a.at ? [" at ", where(a.at)] : null)),
      a.where ? h("span", { class: "where" }, where(a.where)) : null)));
}

// The class boxes, as on the shelf: the starting six, those opened (with
// how), and the rest by their icon alone, as the boxes are known until opened.
function classBoxes(data, ids) {
  const opened = new Map(data.city.unlockedClasses.map(u => [u.id, u]));
  return h("ul", { class: "class-boxes" }, ids.map(id => {
    const u = opened.get(id);
    const starting = classRef.classEvents[id]?.starting;
    const how = u && !starting && /^#|event|retire/i.test(u.where || "") ? u.where : null;
    const said = u ? `${className(classRef, id)}${starting ? ", a starting class" : how ? `, unlocked by ${how}` : ", unlocked"}` : `The ${classIconName(id)} box, still closed`;
    return h("li", { class: u ? (starting ? "starting" : "unlocked") : "locked", title: said, role: "img", "aria-label": said },
      gameIcon(`class-${id}`),
      u ? h("span", { class: "box-name", "aria-hidden": "true" }, className(classRef, id)) : null,
      how ? h("span", { class: "box-how", "aria-hidden": "true" }, how) : null);
  }));
}

// Item designs: every copy in the shop for good, shown as the Shop shows an item.
function designRows(data) {
  const list = data.city.itemDesigns;
  if (!list.length) return h("p", { class: "small muted" }, "None yet.");
  return h("ul", { class: "rows" }, list.map(a => {
    const item = data.shop?.stock.find(i => sameItem(i.name, a.name));
    const n = /#(\d+)/.exec(a.where || "")?.[1];
    const where = capitalize(a.where || "");
    return h("li", {},
      h("span", { class: "design-name" }, item ? gameIcon(`slot-${item.slot}`) : null,
        h("span", {}, h("strong", {}, a.name),
          item ? h("span", { class: "sub" }, `${item.price} gold · ${item.count} ${item.count === 1 ? "copy" : "copies"}`) : null)),
      a.where ? h("span", { class: "where" }, n ? scenarioLink(data, Number(n), where) : where) : null);
  }));
}

// Those who retired: the Town Records Book's company.
function retiredRows(data) {
  const gone = data.characters.filter(c => c.retired);
  if (!gone.length) return h("p", { class: "small muted" }, "None yet.");
  return h("ul", { class: "rows" }, gone.map(c => h("li", {},
    h("span", { class: "design-name" }, classIcon(c.class),
      h("span", {}, h("strong", {}, c.name),
        h("span", { class: "sub" }, [`Level ${characterStats(c).level} ${c.class}`, c.player || null].filter(Boolean).join(" · ")))),
    c.retiredOn ? h("span", { class: "where" }, formatDate(c.retiredOn)) : null)));
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

  const row = h("article", { class: `row${open ? " open" : ""}${depth ? " in-tree" : ""}${s.status === "blocked" ? " blocked" : ""}`, id: `scenario-${s.number}`, "data-scenario": s.number },
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

// A perk's boxes as on the character sheet: the ticked ones filled, the
// rest empty. A lone ticked box says nothing a screen reader needs.
function perkBoxes(ticked, empty) {
  const total = ticked + empty;
  const box = on => h("i", { class: on ? "perk-box" : "perk-box unticked" });
  return h("span", total > 1 ? { class: "perk-boxes", role: "img", "aria-label": `${ticked} of ${total} boxes ticked` }
                             : { class: "perk-boxes", "aria-hidden": "true" },
    Array.from({ length: total }, (_, i) => box(i < ticked)));
}

// --- Characters -----------------------------------------------------------------

let characterIndex = 0;   // which sheet a phone shows
let switchOpen = false;   // the list of characters is open (phones), so drawn open again

function pickCharacter(data, index) {
  characterIndex = index;
  switchOpen = false;
  render(data, "characters");
  window.scrollTo({ top: 0, behavior: "instant" });
  document.querySelector(".char-card.current .char-pick")?.focus({ preventScroll: true });
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
    h("p", {}, "This phone will open on their sheet. To change it, tap the name at the top of the sheet."),
    h("div", { class: "who-list" }, active.map(c =>
      h("button", { type: "button", class: "who-row", "aria-label": `${c.name}, level ${characterStats(c).level} ${c.class}`, onclick: answer(c.name) },
        // The frame the Play tab will show once they're picked.
        classHex(c.class),
        h("span", { class: "party-who" }, h("strong", {}, c.name), h("span", {}, `Level ${characterStats(c).level} ${c.class}`))))),
    h("button", { type: "button", class: "btn quiet", onclick: answer("") }, "Just looking"));
  document.body.append(dialog);
  dialog.showModal();
}

// At the foot of the list of characters (phones): a way to change who this
// phone opens on. The "You" in the list already says who that is.
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
  const { cards, total, unread } = attackDeck(inOrder.filter(r => r.match).flatMap(r => Array(r.count).fill(r.match)),
    inOrder.filter(r => !r.match).map(r => r.written));
  // Bless and Curse cards in the deck now, as counted under Conditions; with
  // none counted, Sanctuary blessings in the session being recorded, for the
  // next scenario.
  const live = tableState(c.name).conds || {};
  const curses = live.curse || 0;
  const donated = !live.bless && (c.blessNext || (draft?.donations || []).some(x => x.character === c.name));
  const blesses = live.bless || (donated ? 2 : 0);
  const blessed = blesses > 0;
  // Worst to best, a segment per card, so a deck's quality reads at a glance
  // and decks compare side by side. The chips under it are its legend.
  const KINDS = ["curse", "null", "bad", "zero", "good", "crit", "bless"];
  const segments = [...cards.flatMap(([label, n]) => Array(n).fill(cardKind(label))), ...Array(blesses).fill("bless"), ...Array(curses).fill("curse")]
    .sort((a, b) => KINDS.indexOf(a) - KINDS.indexOf(b));
  const tally = k => segments.filter(x => k.includes(x)).length;
  return h("div", { class: "block deck-block" },
    h("div", { class: "block-head" }, h("h4", { class: "label" }, "Attack modifier deck"),
      h("span", {}, `${total} cards${blesses ? ` + ${blesses} Bless` : ""}${curses ? ` + ${curses} Curse` : ""}`)),
    h("div", { class: "deck-bar", role: "img",
               "aria-label": `${tally(["curse", "null", "bad"])} below +0, ${tally(["zero"])} at +0, ${tally(["good", "crit", "bless"])} above` },
      segments.map(k => h("i", { class: `k-${k}` }))),
    // Worst to best, the bad cards quieter; each count in a badge of its own,
    // so the 2× card doesn't read "2× ×1".
    h("ul", { class: "deck-cards" }, cards.map(([label, n]) => h("li", { class: { null: "bad", bad: "bad", good: "good", crit: "good" }[cardKind(label)] || null },
        h("i", { class: `swatch k-${cardKind(label)}`, "aria-hidden": "true" }),
        h("span", {}, perkText(label)), h("span", { class: "sr-only" }, ", "), h("b", { role: "img", "aria-label": plural(n, "card") }, String(n)))),
      blessed ? h("li", { class: "bless", title: donated ? "From a Sanctuary donation, for the next scenario only" : "In the deck now, as counted under Conditions" },
        h("i", { class: "swatch k-bless", "aria-hidden": "true" }),
        h("span", {}, "Bless"), h("span", { class: "sr-only" }, ", "),
        h("b", { role: "img", "aria-label": donated ? "2 cards, next scenario only" : plural(blesses, "card") }, String(blesses))) : null,
      curses ? h("li", { class: "bad", title: "In the deck now, as counted under Conditions" },
        h("i", { class: "swatch k-curse", "aria-hidden": "true" }),
        h("span", {}, "Curse"), h("span", { class: "sr-only" }, ", "), h("b", { role: "img", "aria-label": plural(curses, "card") }, String(curses))) : null),
    unread.length ? h("p", { class: "small muted" }, `Not counted, as written: ${unread.join("; ")}`) : null,
    // Phones: Bless and Curse cards shuffled in during a scenario, counted here.
    c.retired ? null : deckCounters(c));
}

// Bless and Curse cards in the deck now, each with − and +: kept with the
// tracker's conditions, as the dock shows them too. Each is removed once drawn
// (rulebook pp. 22-23).
function deckCounters(c) {
  const conds = tableState(c.name).conds || {};
  const change = (key, fn) => () => {
    fn();
    saveTable(c.name, { conds });
    const sheetEl = document.querySelector(`.char-card[data-char="${CSS.escape(c.name)}"]`);
    sheetEl?.querySelector(".dock-conds")?.replaceWith(condStrip(c));
    const deck = attackDeckBlock(c, perkCheck(c).rows);
    sheetEl?.querySelector(".deck-block")?.replaceWith(deck);
    deck.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  };
  return h("div", { class: "deck-counters" }, DECK_CONDITIONS.map(([id, name, kind]) => {
    const n = conds[id] || 0;
    return h("div", { class: `cond-count ${kind}${n ? " on" : ""}`, title: `Each ${name} card is removed once drawn` },
      condIcon(id),
      h("span", { class: "cond-count-name" }, name),
      h("button", { type: "button", class: "dock-step", "data-key": `cond-${id}-down-${c.name}`, "aria-label": `1 less ${name} card`,
        "aria-disabled": String(!n), onclick: change(`cond-${id}-down-${c.name}`, () => { if (n > 1) conds[id] = n - 1; else delete conds[id]; }) }, icon("minus")),
      h("output", { class: "num", "aria-live": "polite" }, String(n), h("span", { class: "sr-only" }, ` ${name} ${n === 1 ? "card" : "cards"}`)),
      h("button", { type: "button", class: "dock-step", "data-key": `cond-${id}-up-${c.name}`, "aria-label": `1 more ${name} card`,
        "aria-disabled": String(n >= 10), onclick: change(`cond-${id}-up-${c.name}`, () => { if (n < 10) conds[id] = n + 1; }) }, icon("plus")));
  }));
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

// The battle goal a player kept (phones), as secret as the card: kept with
// the tracker in their phone's browser only, and on Tonight shown only when
// asked. Which cards there are and the checkmarks each gives:
// data/gloomhaven-quests.json. After the scenario, the Town summary asks
// whether it was made, for its checkmarks.
const goalShown = new Set();

function battleGoal(name) {
  const id = tableState(name).battleGoal;
  const card = id && questRef?.battleGoals?.[id];
  return card ? { id, ...card } : null;
}

function battleGoalCard(data) {
  const c = data.characters.find(x => !x.retired && x.name === me);
  const goals = Object.entries(questRef?.battleGoals || {});
  if (!c || !goals.length) return null;
  const kept = battleGoal(c.name);
  // Dealt as the scenario is set up: shown once one is picked, or kept.
  if (!kept && !tonightScenario(data)) return null;
  const shown = goalShown.has(c.name);
  const redraw = key => { render(data, "overview"); document.querySelector(`[data-key="${key}"]`)?.focus(); };
  const choose = id => { saveTable(c.name, { battleGoal: id || null, goalMet: null }); goalShown.delete(c.name); redraw(id ? "goal-show" : "goal-pick"); };
  return h("div", { class: "card goal-card", "data-tab": "tonight" },
    h("div", { class: "block-head" }, h("h2", { class: "label" }, `${c.name}'s battle goal`),
      kept && shown ? h("button", { type: "button", class: "btn quiet goal-change", "data-key": "goal-change", onclick: () => choose(null) }, "Change") : null),
    kept
      ? h("button", { type: "button", class: `quest-reveal goal-reveal${shown ? " shown" : ""}`, "data-key": "goal-show",
          "aria-expanded": String(shown), "aria-label": shown ? null : `Show ${c.name}'s battle goal`, title: shown ? "Tap to hide" : null,
          onclick: () => { if (shown) goalShown.delete(c.name); else goalShown.add(c.name); redraw("goal-show"); } },
          shown
            ? h("span", { class: "goal-face" }, h("span", { class: "goal-name" }, kept.name),
                h("span", { class: "goal-checks", role: "img", "aria-label": `${plural(kept.checks, "checkmark")} if made` },
                  Array.from({ length: kept.checks }, () => gameIcon("checkmark"))),
                h("span", { class: "goal-hint", "aria-hidden": "true" }, "Tap to hide"))
            : h("span", { class: "goal-back" }, h("span", { class: "brand-mark", "aria-hidden": "true" }), h("span", {}, "Tap to look")))
      : h("label", { class: "field" },
          h("span", {}, "Which card did you keep?"),
          h("select", { "data-key": "goal-pick", onchange: e => choose(e.target.value) },
            h("option", { value: "" }, "Pick it after the deal"),
            // By name, as it's read off the card.
            goals.sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([id, g]) =>
              h("option", { value: id }, `${g.name} (${plural(g.checks, "checkmark")})`)))),
    null);
}

function toggleQuest(name) {
  if (questShown.has(name)) questShown.delete(name); else questShown.add(name);
}

// Which quest card a character holds is kept on their player's phone only:
// campaign.json is public, and the quest is a secret until it's done.
const questCardKey = name => storeKey(`questCard:${name}`);
function questCard(name) {
  try { return localStorage.getItem(questCardKey(name)) || null; } catch { return null; }
}
function setQuestCard(name, card) {
  try { if (card) localStorage.setItem(questCardKey(name), card); else localStorage.removeItem(questCardKey(name)); } catch {}
}

// The progress to check against the card: what's typed in the session being
// recorded, if the form can read it (it warns about what it can't), or else
// the record's.
function questWritten(c) {
  const typed = draft?.quests?.[c.name];
  return filled(typed) && questSteps(typed) ? String(typed).trim() : c.personalQuest;
}

// Progress set with the inputs below goes into the session being recorded,
// and the page stays where it is (as Buy does). Setting it back to what the
// record says takes it out again.
function setQuest(data, c, progress) {
  if (!draft) draft = newDraft(data);
  if (progress === c.personalQuest) delete draft.quests[c.name]; else draft.quests[c.name] = progress;
  saveDraft();
  render(data);
}

// The picker for which card a character holds, kept on this device only.
function questCardPick(data, c) {
  const card = questCard(c.name);
  return h("select", { class: "quest-pick", "data-key": `pq-card-${c.name}`, "aria-label": `${c.name}'s personal quest card`,
      onchange: e => { setQuestCard(c.name, e.target.value); render(data); } },
    h("option", { value: "" }, card ? "Forget it on this device" : "Which card? Kept on this device only"),
    Object.entries(questRef.quests).map(([id, q]) => {
      const o = h("option", { value: id }, `${id} ${q.name}`);
      if (id === card) o.selected = true;
      return o;
    }));
}

// A quest's steps (questInputs), each with what it takes: a count the record
// gives, a check box for one thing, − and + for a count. notes: a line under
// each step. With nothing to record into, each is shown as it stands.
function questStepList(data, c, inputs, notes = [], key = `pq-${c.name}`) {
  return h("ul", { class: "quest-steps" }, inputs.steps.map((x, i) => {
    const what = x.text || (inputs.steps.length > 1 ? `Step ${i + 1}` : "Progress");
    const name = `${c.name}'s personal quest: ${what}`;
    const to = v => setQuest(data, c, questSet(inputs, i, v));
    const kind = rawCampaign ? x.kind : "fixed";
    const control = kind === "check"
      ? h("label", { class: "quest-check" },
          h("input", { type: "checkbox", "data-key": `${key}-${i}`, checked: x.value >= 1, "aria-label": name, onchange: e => to(e.target.checked ? 1 : 0) }), "Done")
      : kind === "count"
        ? h("span", { class: "quest-count" },
            h("button", { type: "button", class: "quest-step-btn", "data-key": `${key}-${i}-down`, "aria-label": `1 less: ${name}`,
              "aria-disabled": String(x.value <= x.min), onclick: () => { if (x.value > x.min) to(x.value - 1); } }, icon("minus")),
            h("span", { class: "num" }, `${x.value}/${x.count}`),
            h("button", { type: "button", class: "quest-step-btn", "data-key": `${key}-${i}-up`, "aria-label": `1 more: ${name}`,
              "aria-disabled": String(x.value >= x.max), onclick: () => { if (x.value < x.max) to(x.value + 1); } }, icon("plus")))
        : h("span", { class: "num" }, `${x.value}/${x.count}`);
    return h("li", { class: `quest-step ${kind}` },
      h("span", { class: "quest-step-text" }, x.after ? h("span", { class: "then" }, "then ") : null, what,
        notes[i] ? h("span", { class: "sub" }, notes[i]) : null),
      control);
  }));
}

// Under each of a card's steps: where its count comes from.
function questNotes(data, p) {
  return p.steps.map(x => [
    x.auto ? "counted from the record" : "kept by hand",
    !x.ready ? "once the step before is done" : null,
    x.maybe.length ? `${plural(x.maybe.length, "more")} if they played ${x.maybe.map(n => `#${n}`).join(", ")}` : null,
    x.extra ? `up to ${x.extra} more, ${x.extraWhy}` : null,
    x.opens && !data.scenarios.some(s => s.number === x.opens) ? `opens #${x.opens} ${scenarioRef?.scenarios?.[String(x.opens)]?.name || ""}`.trim() : null,
  ].filter(Boolean).join(" · "));
}

// A character's quest as the page takes it in: the progress (as being
// recorded, or the record's), the card's count where this device knows the
// card, and the inputs for each step.
function questState(data, c) {
  const card = questCard(c.name);
  const written = questWritten(c);
  const p = card ? questProgress(data, { ...c, personalQuest: written }, card) : null;
  return { card, written, p, inputs: questInputs(p, written) };
}

// Below a sheet's stats, once its quest is shown: which card it is (on this
// device only), and each step, set with a tap; without the card, the steps
// the record has.
function questDetail(data, c) {
  if (c.retired || !questRef || !questShown.has(c.name) && !questDone(c.personalQuest)) return null;
  const { card, written, p, inputs } = questState(data, c);
  const pending = written !== c.personalQuest ? written : null;
  // The record has it otherwise than the card counts it: what it should say.
  const fix = p && inputs && !p.fits(written) && inputs.text !== written ? inputs.text : null;
  return h("div", { class: "block quest-detail" },
    h("div", { class: "block-head" }, h("span", { class: "label" }, "Quest card"), questCardPick(data, c)),
    inputs ? questStepList(data, c, inputs, p ? questNotes(data, p) : []) : null,
    !card && !inputs ? h("p", { class: "small muted" }, "Pick the card to see its steps and keep count of them.") : null,
    fix && rawCampaign ? h("button", { type: "button", class: "todo-do", "data-key": `pq-use-${c.name}`, onclick: () => setQuest(data, c, fix) },
      `Record ${fix}`) : null,
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
    const taken = r => ({ text: r.text, count: r.count, total: r.match ? r.match.count : r.count, note: r.note });
    const perks = choosing
      ? [...classPerks(c.class).map(p => {
          const row = check.rows.find(r => r.match === p);
          return row ? taken(row) : { text: p.text, count: 0, total: p.count, open: true };
        }), ...check.rows.filter(r => !r.match).map(taken)]
      : check.rows.map(taken);
    const itemProblems = itemCheck(c, st.level);
    const article = h("article", { class: `char-card${order.indexOf(c) === characterIndex ? " current" : ""}${c.inactive && !c.retired ? " inactive" : ""}`, "data-char": c.name },
      h("header", { class: "char-head" },
        h("div", { class: "char-level" }, hex(st.level, "level"), h("span", { class: "label" }, "Level")),
        h("div", {},
          h("h3", { class: Math.max(...c.name.split(/\s+/).map(w => w.length)) > 9 ? "long" : null },
            // Phones: the name opens the list of characters, to look at another.
            phone.matches ? namePick(c) : c.name),
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
              const unsure = Boolean(p.note);
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
    // A phone at the table: what's played with comes first, under the name,
    // with tonight's numbers; what's kept between scenarios follows.
    if (phone.matches && !c.retired) {
      const play = [playLine(data), ...["card-block", "cond-block", "item-block", "deck-block"]
        .map(k => article.querySelector(`:scope > .${k}`))].filter(Boolean);
      article.querySelector(":scope > .char-head").after(...play, h("h4", { class: "label sheet-divider" }, "Between scenarios"));
    }
    return article;
  };

  const active = order.filter(playable);
  const inactive = order.filter(c => !c.retired && c.inactive);
  const retired = order.filter(c => c.retired);

  // Phones show one sheet at a time. The name at its head opens this list,
  // a sheet from the bottom, to pick another: inactive and then retired
  // characters come last, each after a divider, dimmed. Anyone with a perk
  // to choose or a quest done has a brass dot, and so does the name while
  // someone else in the list has one.
  const waiting = c => playable(c) && (perksLeft(c) || questDone(c.personalQuest));
  const namePick = c => h("button", { type: "button", class: "char-pick", popovertarget: "char-switch", "data-key": `char-pick-${c.name}`,
      "aria-label": `${c.name}: show another character` },
    c.name, h("span", { class: "char-pick-mark" }, icon("chevron"),
      order.some(x => x !== c && waiting(x)) ? h("span", { class: "dot", "aria-hidden": "true" }) : null));
  const group = c => c.retired ? 2 : c.inactive ? 1 : 0;
  const shownInactive = inactive.filter(c => !hiddenAway(c, order.indexOf(c) === characterIndex));
  const switcher = h("div", { class: "char-switch", id: "char-switch", popover: "auto", role: "group", "aria-label": "Choose a character",
      ontoggle: e => { switchOpen = e.newState === "open"; } },
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
        h("span", { class: "switch-hex" }, hex(st.level, "quiet"),
          waiting(c) ? h("span", { class: "dot", "aria-hidden": "true" }) : null),
        h("span", { class: "switch-name" }, c.name),
        mine ? h("span", { class: "you", "aria-hidden": "true" }, "You") : null)];
    }),
    inactiveToggle(data, inactive.length - shownInactive.length, "switch-inactive"),
    // And which of them this phone opens on.
    active.length || inactive.length ? meLine(data) : null);

  return [
    sectionHead("Characters", [[`${active.length} active`, retired.length ? `${retired.length} retired` : null].filter(Boolean).join(" · "),
                               inactiveToggle(data, inactive.length, "chars-inactive")]),
    switcher,
    // Inactive sheets, once shown, follow the active ones in the same grid
    // (dashed, and "inactive" under the name), filling the gaps.
    active.length ? h("div", { class: "char-grid" }, [...active, ...shownInactive].map(card))
      : [empty("No active characters."), shownInactive.length ? h("div", { class: "char-grid" }, shownInactive.map(card)) : null],
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
// A scenario under way on this phone: anything tracked since the last reset.
function tableActive(name) { return tracking(tableState(name)); }
function tracking(st) {
  return Boolean(st.hp != null || st.xp || st.coins || st.goal || st.cards
    || Object.keys(st.items || {}).length || Object.keys(st.conds || {}).length);
}
function tableState(name) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(tableKey(name))); } catch {}
  // hp null: at full health, whatever the maximum is by then.
  return { hp: null, xp: 0, coins: 0, items: {}, conds: {}, cards: null, goal: 0, ...(saved && typeof saved === "object" ? saved : {}) };
}
// The tracker and the items each save their own part over what's stored.
// The first number tracked notes the day and the scenario picked: the
// numbers belong to that scenario, and that evening.
function saveTable(name, part) {
  const was = tableState(name);
  const next = { ...was, ...part };
  if (!tracking(was) && tracking(next)) Object.assign(next, { since: today(), scenario: tonightPick || null });
  try { localStorage.setItem(tableKey(name), JSON.stringify(next)); } catch {}
}

// A new scenario: full hit points and hand, nothing gained, every item
// ready, no conditions, no battle goal, and the result asked afresh.
function resetTable(name) {
  saveTable(name, { hp: null, xp: 0, coins: 0, items: {}, conds: {}, cards: null, goal: 0, battleGoal: null, goalMet: null, since: null, scenario: null });
  cardUndo.delete(name);
  if (name === me) setTonightResult("success");
}

// A tracker whose evening is in campaign.json now (a session from the day it
// started on, with its scenario) has been recorded: cleared, so the next
// evening starts fresh, on Tonight.
function clearRecordedTables(data) {
  for (const c of data.characters) {
    const st = tableState(c.name);
    if (!st.since) continue;
    const recorded = data.sessions.some(s => s.date >= st.since && s.scenarios?.length
      && (!st.scenario || s.scenarios.some(x => num(x.number) === st.scenario)));
    if (!recorded) continue;
    try { localStorage.removeItem(tableKey(c.name)); } catch {}
    cardUndo.delete(c.name);
    if (c.name === me) setTonightResult("success");
  }
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
        m.down ? h("span", { class: "item-state", "aria-hidden": "true" }, USED_WORDS[info.use]) : null));
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
      cardUndo.set(c.name, [...undo, also ? { cards: piles, hp: before.hp, items: before.items, conds: before.conds } : { cards: piles }].slice(-20));
      const next = { ...piles };
      fn(next);
      saveTable(c.name, { cards: next });
      also?.();
      card()?.querySelector(".dock-conds")?.replaceWith(condStrip(c));
      redraw(`${key}-${c.name}`);
    } }, ...label);
  const redraw = key => {
    const fresh = cardBlock(c);
    block.replaceWith(fresh);
    const target = fresh.querySelector(`[data-key="${CSS.escape(key)}"]`);
    (target?.getAttribute("aria-disabled") === "true" ? fresh.querySelector('.pile-move[aria-disabled="false"]') : target)?.focus({ preventScroll: true });
  };
  const canRest = piles.discard >= 2;
  const poisoned = Boolean(tableState(c.name).conds?.poison);
  const left = roundsLeft(piles);
  const exhausted = piles.hand < 2 && !canRest;
  const pile = (name, n, kind) => h("div", { class: `pile ${kind}${n ? "" : " none"}${n > 1 ? " stack" : ""}` },
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
      move("pile-short", canRest, p => { p.hand += p.discard - 1; p.lost++; p.discard = 0; })(
        h("span", {}, "Short rest"), h("small", {}, canRest ? "lose 1 at random" : "needs 2 discarded")),
      move("pile-long", canRest, p => { p.hand += p.discard - 1; p.lost++; p.discard = 0; }, () => {
        // Heal 2 and refresh spent items, on the tracker and the item list.
        // The heal removes poison and wound; while poisoned it does nothing
        // else (rulebook pp. 22-23).
        const st = tableState(c.name);
        const max = maxHealth(c);
        const marks = st.items || {};
        for (const n of Object.keys(marks)) if (marks[n]?.down && itemInfo(n)?.use === "spent") delete marks[n];
        const conds = { ...st.conds };
        const hp = max && !conds.poison ? Math.min(max, (st.hp ?? max) + 2) : st.hp;
        delete conds.poison;
        delete conds.wound;
        saveTable(c.name, { hp, items: marks, conds });
        card()?.querySelector(".item-track")?.replaceWith(itemTrack(c));
        document.getElementById(`conds-${c.name}`)?.replaceWith(condBlock(c));
        card()?.querySelector(".table-dock")?.replaceWith(tableDock(c));
      })(h("span", {}, "Long rest"), h("small", {}, canRest ? `${poisoned ? "ends poison" : "heal 2"} · refresh` : "needs 2 discarded"))),
    h("div", { class: "pile-row pile-more" },
      move("pile-burn", piles.discard > 0, p => { p.discard--; p.lost++; })("Lose from discard"),
      move("pile-recover", piles.lost > 0, p => { p.lost--; p.hand++; })("Recover lost"),
      undo.length ? h("button", { type: "button", class: "btn quiet pile-undo", "data-key": `pile-undo-${c.name}`,
        onclick: () => {
          cardUndo.set(c.name, undo.slice(0, -1));
          saveTable(c.name, undo.at(-1));
          card()?.querySelector(".item-track")?.replaceWith(itemTrack(c));
          document.getElementById(`conds-${c.name}`)?.replaceWith(condBlock(c));
          card()?.querySelector(".table-dock")?.replaceWith(tableDock(c));
          redraw(`pile-undo-${c.name}`);
        } }, icon("replay"), "Undo") : null));
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
    // The dock shows what's on, too, and the deck its Bless and Curse cards.
    document.querySelector(`.char-card[data-char="${CSS.escape(c.name)}"] .dock-conds`)?.replaceWith(condStrip(c));
    if (key.startsWith("cond-poison-")) document.getElementById(`cards-${c.name}`)?.replaceWith(cardBlock(c));
  };
  // Bless and Curse are counted in the deck block, where they act.
  const on = CONDITIONS.filter(([id]) => conds[id]);
  const block = h("div", { class: "block cond-block", id: `conds-${c.name}` },
    h("div", { class: "block-head" }, h("h4", { class: "label" }, "Conditions"),
      on.length ? h("span", { class: "small muted" }, `${on.length} on`) : null),
    h("div", { class: "cond-grid", role: "group", "aria-label": "Conditions" }, CONDITIONS.map(([id, name, kind]) =>
      h("button", { type: "button", class: `cond ${kind}`, "data-key": `cond-${id}-${c.name}`, "aria-pressed": String(Boolean(conds[id])),
        onclick: change(`cond-${id}-${c.name}`, () => { if (conds[id]) delete conds[id]; else conds[id] = true; }) },
        condIcon(id), h("span", {}, name)))),
    // What each one on does, to read at the table.
    on.length ? h("ul", { class: "cond-notes" }, on.map(([id, name, kind, does]) =>
      h("li", { class: kind }, h("strong", {}, name), " ", does))) : null);
  return block;
}

// The top of the dock: the conditions that are on, as their icons, and the
// cards in hand, each a tap from its block on the sheet.
function condStrip(c) {
  const conds = tableState(c.name).conds || {};
  const on = [...CONDITIONS, ...DECK_CONDITIONS].filter(([id]) => conds[id]);
  const said = on.map(([id, name]) => typeof conds[id] === "number" ? `${conds[id]} ${name}` : name).join(", ");
  const go = id => () => document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "instant" });
  const piles = cardPiles(c);
  const state = piles.hand < 2 ? (piles.discard >= 2 ? "rest" : "exhausted") : null;
  return h("div", { class: "dock-conds" },
    on.length ? h("button", { type: "button", class: "dock-cond-list", "aria-label": `Conditions: ${said}. Go to them`, onclick: go(`conds-${c.name}`) },
      on.map(([id]) => h("span", { class: "dock-cond" }, condIcon(id),
        typeof conds[id] === "number" && conds[id] > 1 ? h("b", {}, String(conds[id])) : null))) : null,
    handSize(c) ? h("button", { type: "button", class: `dock-hand${state ? ` ${state}` : ""}`,
      "aria-label": `${plural(piles.hand, "card")} in hand${state ? `: ${state}` : ""}. Go to the cards`, onclick: go(`cards-${c.name}`) },
      h("b", { class: "num" }, String(piles.hand)), " in hand", state ? ` · ${state}` : "") : null);
}

// Phones, at the top of the sheet: tonight's scenario and the numbers wanted
// in the middle of a round.
function playLine(data) {
  const t = tonight(data);
  if (!t) return null;
  const s = tonightScenario(data);
  return h("p", { class: "play-line" },
    s ? h("strong", {}, scenarioLabel(data, s.number)) : null,
    // Monsters are at the scenario level, so it's said once.
    h("span", {}, `Scenario level ${t.level} · traps ${t.trap} · hazards ${t.hazard}`));
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
      resetTable(c.name);
      paint();
      // Every item ready again, on the sheet above.
      const items = document.querySelector(`.char-card[data-char="${CSS.escape(c.name)}"] .item-track`);
      items?.replaceWith(itemTrack(c));
      document.getElementById(`conds-${c.name}`)?.replaceWith(condBlock(c));
      document.querySelector(`.char-card[data-char="${CSS.escape(c.name)}"] .deck-block`)?.replaceWith(attackDeckBlock(c, perkCheck(c).rows));
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

// --- After the scenario (phones) ---------------------------------------------
// At the top of the Town tab: what each character this phone tracked takes
// from the scenario, to read out to whoever records the evening. XP is the
// dial's plus, on a success, the bonus for tonight's level; gold is the coins
// at that level's rate; a battle goal's checkmarks count on a success only.
// Then where that leaves them: XP, gold and any new level. The result is
// this phone's; the checkmarks are kept with the tracker.
const RESULT_KEY = storeKey("tonightResult");
let tonightResult = "success";
try { tonightResult = localStorage.getItem(RESULT_KEY) || "success"; } catch {}
function setTonightResult(r) {
  tonightResult = r;
  try { if (r === "success") localStorage.removeItem(RESULT_KEY); else localStorage.setItem(RESULT_KEY, r); } catch {}
}

function scenarioSummary(data) {
  const t = tonight(data);
  const shown = characterOrder(data).filter(c => !c.retired).filter(c => {
    return tableActive(c.name);
  });
  if (!shown.length) return null;
  const won = tonightResult === "success";
  // The scenario the numbers were tracked in, rather than whatever is picked now.
  const tracked = shown.map(c => tableState(c.name).scenario).find(Boolean);
  const sc = tracked ? { number: tracked } : tonightScenario(data);
  const setResult = r => () => { setTonightResult(r); render(data, "shop"); };
  // A sum as it's worked: each part in a pill, then what it comes to.
  const eq = (n, what) => h("span", { class: "eq" }, String(n), what ? h("small", {}, what) : null);
  const op = text => h("span", { class: "op" }, text);
  const row = (label, sum, total) => h("div", { class: "sum-row" },
    h("span", { class: "label" }, label), h("span", { class: "sum-how" }, sum), h("b", { class: "num" }, total));

  return h("section", { class: "summary", "aria-labelledby": "summary-title" },
    h("div", { class: "section-head" }, h("h2", { id: "summary-title" }, "After the scenario"),
      // Whose level: phones that disagree show it here.
      h("span", { class: "aside" }, [sc ? scenarioLabel(data, sc.number) : null,
        t ? `level ${t.level}, ${t.difficulty.toLowerCase()}, ${plural(characterOrder(data).filter(x => !x.retired && levelParty?.has(x.name)).length, "player")}` : null].filter(Boolean).join(" · "))),
    h("div", { class: "segmented", role: "group", "aria-label": "Result" },
      [["success", "Success"], ["failure", "Failure"]].map(([key, label]) =>
        h("button", { type: "button", "data-key": `result-${key}`, "aria-pressed": String(tonightResult === key), onclick: setResult(key) }, label))),
    // Each phone works the level out from its own picks: said, so phones that
    // disagree are noticed.
    t ? null
      : h("p", { class: "small muted" }, "Pick who is playing under Scenario level, on Tonight, for the bonus XP and the gold a coin is worth."),
    shown.map(c => {
      const st = tableState(c.name);
      const bonus = won && t ? t.xp : 0;
      const xp = st.xp + bonus;
      const gold = t ? st.coins * t.gold : null;
      const goal = won ? st.goal || 0 : 0;
      const before = characterStats(c);
      const after = characterStats({ ...c, xp: c.xp + xp, checkmarks: c.checkmarks + goal });
      // A new level brings an ability card and a perk; three checkmarks, a perk.
      const perks = after.earned - before.earned;
      const gains = [after.level > before.level ? `level ${after.level}: a new ability card` : null,
                     perks ? `${plural(perks, "perk")} to choose` : null].filter(Boolean).join(" and ");
      const setGoal = n => () => { saveTable(c.name, { goal: n }); render(data, "shop"); };
      return h("div", { class: "card sum-card" },
        h("h3", {}, c.name),
        row("XP", [eq(st.xp, "dial"), bonus ? [op("+"), eq(bonus, "bonus")] : null, op("=")], `+${xp}`),
        row("Gold", [eq(st.coins, st.coins === 1 ? "coin" : "coins"), t ? [op("×"), eq(t.gold)] : null, op("=")], gold != null ? `+${gold}` : "?"),
        won && battleGoal(c.name) ? h("div", { class: "sum-row" },
          h("span", { class: "label sum-goal-label" }, battleGoal(c.name).name,
            h("span", { class: "goal-checks", role: "img", "aria-label": plural(battleGoal(c.name).checks, "checkmark") },
              Array.from({ length: battleGoal(c.name).checks }, () => gameIcon("checkmark")))),
          h("span", { class: "segmented sum-made", role: "group", "aria-label": `Battle goal ${battleGoal(c.name).name}` },
            [[true, "Made it"], [false, "Missed"]].map(([made, label]) =>
              h("button", { type: "button", "data-key": `goal-${made ? "made" : "missed"}-${c.name}`, "aria-pressed": String(st.goalMet === made),
                onclick: () => { saveTable(c.name, { goalMet: made, goal: made ? battleGoal(c.name).checks : 0 }); render(data, "shop"); } }, label))))
        : won ? h("div", { class: "sum-row" },
          h("span", { class: "label sum-goal-label" }, "Battle goal checkmarks"),
          h("span", { class: "sum-goal" },
            h("button", { type: "button", class: "dock-step", "data-key": `goal-down-${c.name}`, "aria-label": "1 less checkmark",
              "aria-disabled": String(!st.goal), onclick: st.goal ? setGoal(st.goal - 1) : null }, icon("minus")),
            h("b", { class: "num", "aria-live": "polite" }, String(st.goal || 0), h("span", { class: "sr-only" }, " checkmarks")),
            h("button", { type: "button", class: "dock-step", "data-key": `goal-up-${c.name}`, "aria-label": "1 more checkmark",
              "aria-disabled": String((st.goal || 0) >= 3), onclick: (st.goal || 0) < 3 ? setGoal((st.goal || 0) + 1) : null }, icon("plus"))))
          : h("p", { class: "small muted" }, "A failure gives no bonus XP and no battle goal checkmarks."),
        h("p", { class: "sum-after" },
          `Then ${c.xp + xp} XP`,
          after.level === before.level && after.toNext ? ` · ${after.toNext.remaining} to level ${after.level + 1}` : "",
          gold != null ? ` · ${c.gold + gold - draftSpend(data, c.name)} gold${draftSpend(data, c.name) ? " after the draft" : ""}` : "",
          gains ? h("strong", { class: "sum-gains" }, capitalize(gains)) : null));
    }),
    null);
}

// --- In town (phones) ----------------------------------------------------------
// Above the Shop: what this phone's character has to see to in town, from
// the sheet, the last session and the Sanctuary, so the town is one tab. On
// the recorder's phone (the one with a draft) each can be recorded here.
function townJobs(data) {
  const c = data.characters.find(x => playable(x) && x.name === me);
  const recording = rawCampaign && draft;
  const jobs = [];
  // The Shop and enhancing open as sheets over the tab.
  const opener = (key, label, run) => h("button", { type: "button", class: "todo-open", "data-key": key, onclick: run }, label, icon("chevron"));
  const spent = c ? draftSpend(data, c.name) : 0;
  jobs.push([c ? h("span", {}, `${c.name} has `, h("strong", { class: "town-gold" }, `${c.gold} gold`), " to spend",
      spent ? `, ${c.gold - spent} after the draft` : "", ".") : "The Shop.",
    opener("town-shop", "Shop", () => { shopFor = undefined; shopFilter = c ? "can" : "all"; render(data, "shop"); openSheet("shop"); })]);
  if (!c) {
    jobs.push(["Enhance an ability card.", opener("town-enhance", "Enhancing", () => openSheet("enhance"))]);
    return h("div", { class: "card todo town-jobs" }, h("div", { class: "block-head" }, h("h2", { class: "label" }, "In town")),
      h("ul", { class: "rows" }, jobs.map(([text, act]) => h("li", {}, h("span", {}, text), h("span", { class: "todo-acts" }, act)))));
  }
  for (const u of lastLevelUps(data).filter(u => u.character === c.name)) {
    jobs.push([`Reached level ${u.level}: add an ability card of level ${u.level} or lower.`, null]);
  }
  const left = perksLeft(c);
  if (left) jobs.push([`${plural(left, "perk")} to choose.`, recording
    ? h("button", { type: "button", class: "todo-do", "data-key": "town-perk", onclick: () => recordPerk(data, c.name) }, "Record it")
    : h("a", { class: "todo-go", href: "#characters" }, "Your sheet")]);
  const donated = (draft?.donations || []).some(x => x.character === c.name);
  jobs.push([donated ? "Donated at the Sanctuary: 2 Bless in your next scenario."
      : "The Sanctuary: 10 gold for 2 Bless in your next scenario, once a visit.",
    recording && !donated ? h("button", { type: "button", class: "todo-do", "data-key": "town-donate", onclick: () => recordDonation(data, c.name) }, "Record it") : null]);
  jobs.push(["Enhance an ability card.", opener("town-enhance", "Enhancing", () => openSheet("enhance"))]);
  return h("div", { class: "card todo town-jobs" },
    h("div", { class: "block-head" }, h("h2", { class: "label" }, `${c.name} in town`)),
    h("ul", { class: "rows" }, jobs.map(([text, act]) => h("li", {}, h("span", {}, text), act ? h("span", { class: "todo-acts" }, act) : null))));
}

// "Record it" for a donation to the Sanctuary, on the recorder's phone.
function recordDonation(data, name) {
  if (!draft) draft = newDraft(data);
  draft.donations ||= [];
  let i = draft.donations.findIndex(x => x.character === name);
  if (i < 0) { draft.donations.push({ character: name }); i = draft.donations.length - 1; }
  showInRecorder(data, `don-${i}-c`);
}

// --- Shop -----------------------------------------------------------------------
// data/gloomhaven-items.json says what each item costs, how many copies exist
// and at what prosperity it reaches the shop. The shop holds every item up to
// the city's prosperity level plus the item designs the party has found;
// copies carried by active characters are out of stock (a retired character's
// items go back). Prices move with reputation.

// What the draft spends of a character's gold: purchases less sales, at
// the Shop's prices.
function draftSpend(data, name) {
  const priceOf = item => data.shop?.stock.find(i => sameItem(i.name, item));
  return (draft?.buys || []).filter(b => b.character === name && b.item).reduce((sum, b) => sum + (priceOf(b.item)?.price || 0), 0)
       - (draft?.sells || []).filter(x => x.character === name && x.item).reduce((sum, x) => sum + (priceOf(x.item)?.sells || 0), 0);
}

// Whose shopping the Shop shows: until someone is picked, this phone's
// character; then a name, or "" for no one.
let shopFor;
let shopFilter = "all";   // "all", or "can": only what the shopper can buy

function renderShop(data) {
  const shop = data.shop;
  if (!shop) return null;

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
  const spent = shopper ? draftSpend(data, shopper.name) : 0;
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
  const action = item => !shopper || !rawCampaign || !isRecorder() ? null
    : has(item) ? (sold(item) ? h("span", { class: "in-draft" }, "Sold in the draft")
        : h("button", { type: "button", class: "buy sell", "data-key": `sell-${item.id}`, "aria-label": `Sell ${item.name} for ${item.sells} gold`,
            onclick: () => recordSell(data, shopper.name, item.name) }, `Sell for ${item.sells}`))
    : bought(item) ? h("span", { class: "in-draft" }, "In the draft")
    : canBuy(item) ? h("button", { type: "button", class: "buy", "data-key": `buy-${item.id}`, "aria-label": `Buy ${item.name} for ${shopper.name}`,
        onclick: () => recordBuy(data, shopper.name, item.name) }, "Buy")
    : null;
  // Each item's row: its name, and under it a mark per copy (copyMarks). Its
  // state shows rather than says: the shopper's own copies are verdigris,
  // what they can't afford or the shop has none of reads faded with no Buy,
  // and a slot already full is said once, in the group's heading.
  const state = item => has(item) ? "owned" : bought(item) ? "bought" : left(item) <= 0 ? "sold-out"
    : dear(item) ? "too-dear" : null;
  const row = item => {
    const s = state(item);
    return h("li", { class: s && s !== "bought" ? s : null },
      h("span", {},
        h("strong", {}, item.name, item.design ? h("span", { class: "tag" }, "design") : null,
          item.back ? h("span", { class: "tag", title: "Not sold here otherwise: a copy sold, or left by a retired character" }, "returned") : null),
        h("span", { class: "sub stock" }, copyMarks(item),
          // What it sells for: on the shopper's own items that's their Sell button.
          !shopper && item.held.length ? h("span", {}, `sells for ${item.sells}`) : null)),
      h("span", { class: "price-col" }, h("span", { class: "price num" }, `${item.price} `, h("span", { class: "unit" }, "gold")), action(item)));
  };

  // One mark per copy of the item, as cards on a shelf: those someone
  // carries show their class icon (the shopper's in verdigris, one bought in
  // the draft dashed), and an empty one is still in the shop. The words are
  // there for screen readers and on hover.
  const copyMarks = item => {
    const sold = new Set(sells.filter(x => sameItem(x.item, item.name)).map(x => x.character));
    const carried = item.held.filter(name => !sold.has(name)).map(name => ({ name, drafted: false }));
    const drafted = buys.filter(b => sameItem(b.item, item.name)).map(b => ({ name: b.character, drafted: true }));
    const marks = [...carried, ...drafted].map(x => ({ ...x, c: data.characters.find(c => c.name === x.name) }));
    const inShop = Math.max(0, left(item));
    const names = marks.map(x => x.name).join(", ").replace(/, ([^,]*)$/, " and $1");
    const said = `${inShop ? `${inShop} of ${item.count} in the shop` : "None in the shop"}${names ? `; carried by ${names}` : ""}`;
    return h("span", { class: "copies", role: "img", "aria-label": said, title: said },
      marks.map(x => h("i", { class: `held${x.name === shopper?.name ? " mine" : ""}${x.drafted ? " drafted" : ""}` }, x.c ? classIcon(x.c.class) : null)),
      Array.from({ length: inShop }, () => h("i")));
  };

  // "Can buy" leaves what the shopper could buy, and what they already
  // have in the draft.
  const showing = item => shopFilter !== "can" || !shopper || canBuy(item) || bought(item);
  const groups = SLOTS.map(([slot, label]) => [slot, label, shop.stock.filter(i => i.slot === slot && showing(i))]).filter(([, , list]) => list.length);
  const priceNote = shop.modifier === 0 ? "normal prices" : `${signed(shop.modifier)} gold per item`;
  const doubt = priceDoubt(shop, data.ledger?.reputation);
  const pick = name => () => { shopFor = shopper?.name === name ? "" : name; render(data, "shop"); };

  // Why, under the heading on a tap: a phone has no hover.
  const why = doubt ? h("p", { class: "small muted price-why" }, doubt.why) : null;
  if (why) why.hidden = true;
  return [
    // How far prices could be off, said once beside them all.
    sectionHead("Shop", [`Prosperity ${shop.level} · ${priceNote}`,
      doubt ? h("button", { type: "button", class: "price-doubt", title: doubt.why, "aria-expanded": "false", "aria-label": `Prices ${doubt.text} Why?`,
        onclick: e => { why.hidden = !why.hidden; e.currentTarget.setAttribute("aria-expanded", String(!why.hidden)); } }, doubt.text) : null]),
    why,
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
          onclick: () => { shopFilter = key; render(data, "shop"); } }, label))),
      isRecorder() ? null : h("p", { class: "small muted shop-rec" }, "Buying and selling go in on the phone recording the evening.")) : null,
    shop.pricesUnsure ? pricesNote(shop, data.ledger?.reputation) : null,
    shop.questions.map(q => nudge("question", "Check an item", q)),
    groups.length ? null : empty(`Nothing ${shopper?.name} can buy right now.`),
    h("div", { class: "shop" }, groups.map(([slot, label, list]) =>
      h("div", { class: "card" },
        h("h3", { class: "label" }, gameIcon(`slot-${slot}`), label,
          shopper && full({ slot }) ? h("span", { class: "slot-note" }, slotNote(owned, slot)) : null),
        h("ul", { class: "rows" }, list.map(row))))),
    shop.coming ? h("p", { class: "aside" }, `${plural(shop.coming, "more item")} arrive${shop.coming === 1 ? "s" : ""} at prosperity ${shop.level + 1}.`) : null,
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

// Beside a slot's heading in the Shop, when the shopper's is full: what fills
// it. Its items can still be bought (owning isn't limited), not equipped too.
function slotNote(owned, slot) {
  const hands = s => s === "onehand" || s === "twohand";
  const wearing = owned.filter(i => hands(slot) ? hands(itemSlot(i)) : itemSlot(i) === slot);
  if (hands(slot)) return "hands full";
  if (slot === "small") return "small items full";
  return wearing.length ? `wearing ${wearing.join(", ")}` : "full";
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

  return h("div", { class: "enhancer-wrap", id: "enhancing" },
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
        // Recorded by the phone that records the evening (any wide screen).
        rawCampaign && (!phone.matches || draft) ? h("button", { type: "button", class: "todo-do enhancer-record", "data-key": "enh-record",
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
  const d = { id: draftId(), date: today(), title: "", party, notes: "", ...draftParts() };
  // Tonight's scenario, picked on this phone, starts the form.
  const pick = tonightPick && data.scenarios.find(s => s.number === tonightPick && s.status === "available");
  if (pick) d.scenarios.push({ ...newScenario(data, data.characters.filter(c => party.includes(c.name))), number: String(pick.number) });
  return d;
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

function renderRecorder(data) {
  const d = draft;
  d.donations ||= [];
  d.enhancements ||= [];
  d.quests ||= {};
  d.claims ||= {};
  d.retirements ||= [];
  d.newCharacters ||= [];
  // What each retirement opens, before anything below reads the draft.
  syncRetirements(d);
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
  // On a phone, the rows it adds (a purchase, a sale, a perk, a donation)
  // start with the phone's own character, as the Shop does.
  const mine = phone.matches && active.some(c => c.name === me) ? me : "";
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
    return t.xp || t.coins || t.goal ? [`${t.xp} XP`, plural(t.coins, "coin"), t.goal ? plural(t.goal, "checkmark") : null].filter(Boolean).join(", ") : null;
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
                  onclick: () => { const t = tableState(c.name); r.xp = String(t.xp); r.coins = String(t.coins); if (t.goal) r.checkmarks = String(t.goal); rerender(); focusOn(`sc-${i}-${c.name}-xp`); } },
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
  // Retiring: who, and what their personal quest opens, which their quest
  // card decides (syncRetirements, above): a class box (shown by its icon, as
  // the box's name would be a spoiler until it's opened) or Envelope X. A
  // quest done is no secret, so a device that doesn't know the card asks for
  // it here. A box already open, or opened by a retirement above, gives a
  // random item design and a random side scenario instead (rulebook p. 48).
  const unlocked = new Set(data.city.unlockedClasses.map(u => u.id));
  const boxLabel = opens => opens === "envelope-x" ? "Envelope X"
    : [gameIcon(`class-${opens}`, `${classIconName(opens)} icon`), `The box with the ${classIconName(opens)} icon`];
  const questOpens = (x, i) => {
    const c = data.characters.find(c => c.name === x.character);
    if (!c) return null;
    const pick = label => field(label, questCardPick(data, c), "wide");
    // An older draft's box, picked by hand: kept until the card is picked.
    if (!x.fromCard) {
      return x.unlocks ? [h("div", { class: "field wide" }, h("span", {}, "Their personal quest opens"),
          h("span", { class: "rec-opens", "data-key": `ret-${i}-u`, tabindex: "-1" }, boxLabel(x.unlocks), h("span", { class: "muted" }, " (picked by hand)"))),
          pick("Their quest card, to be sure")]
        : pick("Their quest card, for what it opens");
    }
    const before = d.retirements.slice(0, i).some(r => r.character && r.unlocks === x.unlocks);
    const open = before || (x.unlocks === "envelope-x" ? data.city.envelopeX : unlocked.has(x.unlocks));
    // The card stays to hand, to put right a wrong pick.
    return [pick("Their quest card"), h("div", { class: "field wide" }, h("span", {}, "Their personal quest opens"),
      h("span", { class: "rec-opens", "data-key": `ret-${i}-u`, tabindex: "-1" }, boxLabel(x.unlocks),
        open ? h("span", { class: "muted" }, ` (${before ? "opened by a retirement above" : "already open"}: a random item design and a random side scenario instead)`) : null))];
  };
  const retireBlock = (x, i) => h("div", { class: "rec-row" },
    field("Who retires", select(`ret-${i}-c`, x, "character", activeOptions)),
    // Who played them: their next characters get a perk for each retirement (p. 48).
    field("Player (optional)", text(`ret-${i}-p`, x, "player", { autocomplete: "off", "aria-label": "Who played the retiring character",
      placeholder: data.characters.find(c => c.name === x.character)?.player || "" })),
    questOpens(x, i),
    remove(d.retirements, i, "retirement", "add-retire"));
  // A newcomer: any unlocked class (or one unlocked tonight), at any level up
  // to the prosperity level, counting a checkmark for each retirement tonight
  // (as the save step does).
  const retiringTonight = d.retirements.filter(x => active.some(c => c.name === x.character)).length;
  // A player's retired characters, tonight's included: their newcomer's extra perks.
  const retiredByPlayer = player => {
    const name = String(player || "").trim();
    if (!name) return 0;
    const playerOf = c => String(d.retirements.find(x => x.character === c.name)?.player || c.player || "").trim();
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
    // Written in the file's layout: what happened, each thing once (campaign.js).
    const json = formatJson(toFile(out)) + "\n";
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
      // Personal quest progress: each step, set with a tap (questInputs), from
      // the card on the device that knows it, or else from the steps the
      // record has; with neither, the card to pick. A secret, as on the
      // sheet: tap to see it.
      active.length ? h("div", { class: "field pq-section" },
        h("span", {}, "Personal quests that moved"),
        h("div", { class: "pq-list" }, active.map(c => {
          const shown = questShown.has(c.name) || questDone(c.personalQuest);
          const { p, inputs } = shown ? questState(data, c) : {};
          return h("div", { class: "pq-field", "data-key": `pq-${c.name}`, tabindex: "-1" },
            h("div", { class: "pq-head" }, h("span", { class: "pq-name" }, c.name),
              h("button", { type: "button", class: "pq-now", "data-key": `pq-now-${c.name}`, "aria-expanded": String(shown),
                  "aria-label": shown ? `Hide ${c.name}'s personal quest` : `Show ${c.name}'s personal quest`,
                  onclick: () => { toggleQuest(c.name); rerender(); focusOn(`pq-now-${c.name}`); } },
                shown ? "Hide" : [icon("eye"), "Show"])),
            !shown ? null
              : inputs ? questStepList(data, c, inputs, p ? questNotes(data, p) : [], `pq-rec-${c.name}`)
              : questRef ? h("label", { class: "field" }, h("span", {}, "Their card, to count its steps"), questCardPick(data, c)) : null);
        }))) : null,
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
        // On a phone, for its own character to start with; the next box is
        // then what they buy, sell, take or give.
        addButton("add-buy", "Buy an item", () => d.buys.push({ character: mine, item: "" }), () => `buy-${d.buys.length - 1}-${mine ? "i" : "c"}`),
        addButton("add-sell", "Sell an item", () => d.sells.push({ character: mine, item: "" }), () => `sell-${d.sells.length - 1}-${mine ? "i" : "c"}`),
        addButton("add-perk", "Take a perk", () => d.perks.push({ character: mine, perk: "" }), () => `perk-${d.perks.length - 1}-${mine ? "p" : "c"}`),
        addButton("add-donation", "Donate to the Sanctuary", () => d.donations.push({ character: party.some(c => c.name === mine) ? mine : "" }), () => `don-${d.donations.length - 1}-c`)),
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
    if (recorderOpen) openSheet("record");
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
    // Phones: a sheet over whichever tab it was opened from; closing it
    // closes the form, keeping the draft.
    recorderOpen && draft ? sheet("record", "Record the evening", renderRecorder(data), () => {
      recorderOpen = false;
      if (!draftChanges(draft, data)) dropDraft(); else saveDraft();
      render(data);
    }) : null,
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
  shop: data => [scenarioSummary(data), townJobs(data),
    sheet("shop", "Shop", renderShop(data)), sheet("enhance", "Enhancing a card", enhancer(data))],
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
  // Redrawing replaces the buttons, so put focus and the map's scroll back,
  // and an open sheet's place.
  const sheetScroll = document.querySelector(".sheet.open")?.scrollTop;
  const key = document.activeElement?.dataset?.key;
  const mapScroll = document.querySelector(".map-scroll")?.scrollLeft;

  for (const [id, fn] of Object.entries(RENDERERS)) {
    if (only && id !== only) continue;
    const nodes = [fn(data)].flat(Infinity).filter(Boolean);
    const panel = document.getElementById(id);
    panel.replaceChildren(...nodes);
    panel.hidden = !nodes.length;
  }

  packGrids();
  // The list of characters, open when it was redrawn (its "+ 1 inactive"),
  // stays open.
  if (switchOpen && phone.matches) document.getElementById("char-switch")?.showPopover?.();
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
  // What was drawn afresh is sorted onto its tab again: the Overview's parts
  // belong to two (Tonight and Campaign).
  showTab();
  applySheets();
  const open = document.querySelector(".sheet.open");
  if (open && sheetScroll) open.scrollTop = sheetScroll;
  if (open && key) open.querySelector(`[data-key="${key}"]`)?.focus({ preventScroll: true });
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
// Phones: each tab keeps its place, so leaving Play in the middle of a round
// and coming back from the tab bar returns to where you were. A link into a
// tab still starts it from the top, or at the section it names.
const tabScroll = {};
let shownTab = null;
let viaTabBar = false;

function showTab() {
  const tab = currentTab();
  shownTab = tab;
  document.body.dataset.tab = tab;
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
    // Each phone tab's place, kept as it's scrolled.
    if (phone.matches && shownTab) tabScroll[shownTab] = window.scrollY;
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
  const back = viaTabBar ? tabScroll[currentTab()] || 0 : 0;
  viaTabBar = false;
  if (TAB_TOPS.includes(id) || !id) window.scrollTo({ top: back, behavior: "instant" });
  else document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
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
    // The file in the shape the page works with (campaign.js).
    rawCampaign = fromFile(json);
    scenarioRef = ref;
    draft = loadDraft();
    // Once the downloaded file has been committed, the draft is in
    // campaign.json: clear it, so it isn't recorded (and counted) twice.
    if (draft && draftIsSaved(draft, rawCampaign)) {
      savedDraft = draft;
      dropDraft();
    }
    const data = buildData(json, rawCampaign);

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
    // At the start of an evening that's Tonight; with a scenario under way on
    // this phone, the player's sheet.
    clearRecordedTables(data);
    if (phone.matches && mine >= 0 && location.hash.length <= 1) history.replaceState(null, "", tableActive(me) ? "#characters" : "#overview");

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
      // Another character's sheet was showing: their place isn't this one's.
      if (characterIndex !== i) { characterIndex = i; tabScroll.play = 0; render(data, "characters"); }
      if (location.hash === "#characters") window.scrollTo({ top: 0, behavior: "instant" });
    });
    for (const a of document.querySelectorAll(".tabs a")) a.addEventListener("click", () => { viaTabBar = true; });
    // Town's summary and Tonight's battle goal read the tracker, which the
    // Play tab changes (its reset clears them): drawn afresh on the way
    // there, before the tab's place is put back.
    window.addEventListener("hashchange", () => {
      if (!phone.matches) return;
      if (openSheetId) { openSheetId = null; applySheets(); }
      if (currentTab() === "town") render(data, "shop");
      if (currentTab() === "tonight") render(data, "overview");
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
    phone.addEventListener("change", () => render(data));
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
