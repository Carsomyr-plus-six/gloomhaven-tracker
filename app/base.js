// Gloomhaven campaign tracker, the page: reads campaign.json and shows it,
// and builds an updated campaign.json from a session recorded on the page.
// The rules are in campaign/, loaded first. The page's files are plain
// scripts sharing one scope, loaded in the order index.html lists them:
// this one first, main.js (which starts it all) last.
//
// This file: making elements and icons, and what this browser keeps.

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
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
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

// --- What this browser keeps -------------------------------------------------

// The campaign file the page reads: campaign.json, or another file on this
// site named by ?data= (the sample, or the tests' copies).
function dataUrl() {
  const requested = new URLSearchParams(location.search).get("data");
  if (requested) {
    const url = new URL(requested, location.href);
    if (url.origin === location.origin) return url;
  }
  return new URL("campaign.json", location.href);
}

// What this browser keeps is kept per campaign file: the sample campaign
// (?data=...) doesn't share a character choice or a draft with the real one.
function storeKey(name) {
  return new URLSearchParams(location.search).get("data") ? `${name}:${dataUrl().pathname}` : name;
}

// Every key this browser keeps, in one place: per campaign file, but for
// the scenario list's view, which is how this browser likes it.
const STORE = {
  me: storeKey("myCharacter"),             // the character this phone plays
  draft: storeKey("sessionDraft"),         // the session being recorded
  pick: storeKey("tonightScenario"),       // the scenario picked for tonight
  result: storeKey("tonightResult"),       // how tonight's scenario went
  table: name => storeKey(`table:${name}`),         // a character's tracker
  questCard: name => storeKey(`questCard:${name}`), // a character's quest card
  scenarioView: "scenarioView",            // list or unlock map
};

// Reading and writing what this browser keeps. Storage can be off, or full,
// or refuse a private window: then reading gives null and writing does
// nothing. A value that isn't text is kept as JSON; null takes it out.
const stored = {
  get: key => { try { return localStorage.getItem(key); } catch { return null; } },
  json: key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set: (key, value) => {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch {}
  },
};

// --- The page's state -------------------------------------------------------
// What more than one part of the page reads or sets, in one place. What only
// one part uses stays at the top of its file.

// The campaign as loaded, the session being recorded (kept in this browser),
// and a draft found already in campaign.json on load, and cleared.
let rawCampaign = null;
let draft = null;
let savedDraft = null;
// The data last drawn: what a phone draws later, when a tab is shown.
let latestData = null;
// The character this phone plays: a name, "" for just looking, or null to ask.
let me = stored.get(STORE.me);
// Which sheet a phone shows, and whether its list of characters is open
// (kept, so a redraw draws it open again).
let characterIndex = 0;
let switchOpen = false;
// Tonight: who is playing (for the scenario level; at first the last
// session's party, those still active, or else everyone), at what
// difficulty, the scenario picked, and whether the form's quick picks show
// completed scenarios too (once asked for, until one is picked).
let levelParty = null;
let difficulty = "normal";
let tonightPick = Number(stored.get(STORE.pick)) || null;
let showReplays = false;
// What's open: the sheet on a phone, the session form, and a scenario to
// jump to from elsewhere on the page.
let openSheetId = null;
let recorderOpen = false;
let pendingScenario = null;
// Whose shopping the Shop shows (until someone is picked, this phone's
// character; then a name, or "" for no one), and whether it shows
// everything or only what they can buy ("all", "can").
let shopFor;
let shopFilter = "all";
