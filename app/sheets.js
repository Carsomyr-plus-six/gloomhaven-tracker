// Sheets (phones): panels that open over the page. And the Overview
// section itself (renderOverview), which the tiles make up.

// --- Sheets (phones) ---------------------------------------------------------
// A screen opened, used and closed (the Shop, enhancing, the session form,
// the scenarios to pick from, who's playing): on a phone it slides up over
// the tab, full height, with its title and Close, and Back or Escape closes
// it; the page behind is out of reach meanwhile. On a wide screen it's part
// of the page as before. Which is open survives a redraw.
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
  // Its section, if held back while another tab was shown, is drawn first
  // (render opens the sheet as it finishes).
  if (outOfDate.has(SHEET_HOME[id]) && latestData) render(latestData, SHEET_HOME[id]);
  else applySheets();
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
      h("div", { class: "tiles" }, levelTile(data), reputationTile(data.ledger), prosperityTile(city, data.ledger)),
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
