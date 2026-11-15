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

function signed(n) { return n > 0 ? `+${n}` : String(n); }

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function stats(pairs) {
  return h("dl", { class: "stats" },
    pairs.filter(([, v]) => v !== "" && v != null).map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
}

function meter(fraction) {
  const span = h("span");
  span.style.width = `${Math.round(fraction * 100)}%`;
  return h("div", { class: "meter", role: "presentation" }, span);
}

function notes(text) { return text ? h("p", { class: "notes" }, text) : null; }

function empty(message) { return h("div", { class: "empty" }, message); }

function achievementList(list) {
  if (!list.length) return h("p", { class: "muted small" }, "None yet.");
  return h("ul", { class: "plain" }, list.map(a => h("li", {},
    a.name,
    a.scenario ? h("span", { class: "muted small" }, ` · scenario ${a.scenario}`) : null,
    a.notes ? h("div", { class: "muted small" }, a.notes) : null)));
}

// --- Sections -------------------------------------------------------------

function renderOverview(data) {
  const { party, city } = data;
  const prosperity = stepFor(city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const toNext = progressFor(city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const modifier = shopModifier(party.reputation);

  return [
    h("div", { class: "grid" },
      h("div", { class: "card" },
        h("h2", {}, party.name || "Unnamed party"),
        stats([["Location", party.location], ["Reputation", signed(party.reputation)],
               ["Shop prices", modifier === 0 ? "normal" : `${signed(modifier)} gold per item`]]),
        notes(party.notes)),
      h("div", { class: "card" },
        h("h2", {}, "Gloomhaven"),
        h("div", { class: "big" }, `Prosperity ${prosperity}`),
        toNext
          ? [meter(toNext.fraction),
             h("p", { class: "muted small" }, `${city.prosperityCheckmarks} checkmarks · ${toNext.remaining} more to level ${prosperity + 1}`)]
          : h("p", { class: "muted small" }, `${city.prosperityCheckmarks} checkmarks · maximum level`),
        stats([["Sanctuary donations", `${city.donations} gold`]])),
    ),
    h("div", { class: "grid", style: "margin-top:12px" },
      h("div", { class: "card" }, h("h3", {}, "Party achievements"), achievementList(party.achievements)),
      h("div", { class: "card" }, h("h3", {}, "Global achievements"), achievementList(city.globalAchievements)),
      h("div", { class: "card" }, h("h3", {}, "Unlocked classes"),
        city.unlockedClasses.length
          ? h("ul", { class: "plain" }, city.unlockedClasses.map(c => h("li", {}, c)))
          : h("p", { class: "muted small" }, "None listed."))),
  ];
}

const STATUS_LABELS = { available: "Available", completed: "Completed", blocked: "Blocked" };
let scenarioFilter = "all";

function renderScenarios(data) {
  const all = [...data.scenarios].sort((a, b) => a.number - b.number);
  if (!all.length) return [h("h2", {}, "Scenarios"), empty("No scenarios recorded yet.")];

  const counts = { all: all.length };
  for (const s of all) counts[s.status] = (counts[s.status] || 0) + 1;

  const filters = h("div", { class: "filters", role: "group", "aria-label": "Filter scenarios" },
    ["all", "available", "completed", "blocked"].filter(f => counts[f]).map(f =>
      h("button", {
        type: "button",
        "aria-pressed": String(scenarioFilter === f),
        onclick: () => { scenarioFilter = f; render(data, "scenarios"); },
      }, `${f === "all" ? "All" : STATUS_LABELS[f]} (${counts[f]})`)));

  const shown = all.filter(s => scenarioFilter === "all" || s.status === scenarioFilter);
  const name = n => all.find(s => s.number === n)?.name;

  return [
    h("h2", {}, "Scenarios"),
    filters,
    h("div", { class: "stack" }, shown.map(s => h("article", { class: "card scenario" },
      h("span", { class: "num" }, `#${s.number}`),
      h("h3", {}, s.name || "Untitled"),
      h("span", { class: `badge ${s.status}` }, STATUS_LABELS[s.status] || s.status),
      h("div", { class: "body" },
        h("div", { class: "muted small" },
          [s.unlockedBy ? `Unlocked by #${s.unlockedBy}${name(s.unlockedBy) ? ` ${name(s.unlockedBy)}` : ""}` : null,
           s.completed ? `Completed ${formatDate(s.completed)}` : null,
           s.treasures?.length ? `Treasure ${s.treasures.join(", ")} looted` : null].filter(Boolean).join(" · ")),
        notes(s.notes))))),
  ];
}

function renderCharacters(data) {
  if (!data.characters.length) return [h("h2", {}, "Characters"), empty("No characters recorded yet.")];

  const card = c => {
    const level = stepFor(c.xp, XP_FOR_LEVEL);
    const toNext = progressFor(c.xp, XP_FOR_LEVEL);
    return h("article", { class: "card" },
      h("h3", {}, c.name, c.retired ? h("span", { class: "muted small" }, " · retired") : null),
      h("div", { class: "muted small" }, [c.class, c.player ? `played by ${c.player}` : null].filter(Boolean).join(" · ")),
      h("div", { class: "big" }, `Level ${level}`),
      toNext ? [meter(toNext.fraction), h("p", { class: "muted small" }, `${c.xp} XP · ${toNext.remaining} to level ${level + 1}`)]
             : h("p", { class: "muted small" }, `${c.xp} XP · maximum level`),
      stats([["Gold", c.gold],
             ["Checkmarks", `${c.checkmarks} (${perksFromCheckmarks(c.checkmarks)} perk${perksFromCheckmarks(c.checkmarks) === 1 ? "" : "s"} earned)`],
             ["Personal quest", c.personalQuest],
             ["Perks", c.perks.length ? c.perks.join("; ") : ""],
             ["Items", c.items.length ? c.items.join(", ") : ""]]),
      notes(c.notes));
  };

  const active = data.characters.filter(c => !c.retired);
  const retired = data.characters.filter(c => c.retired);
  return [
    h("h2", {}, "Characters"),
    active.length ? h("div", { class: "grid" }, active.map(card)) : empty("No active characters."),
    retired.length ? [h("h2", { style: "margin-top:24px" }, "Retired"), h("div", { class: "grid" }, retired.map(card))] : null,
  ];
}

function renderSessions(data) {
  if (!data.sessions.length) return [h("h2", {}, "Sessions"), empty("No sessions recorded yet.")];
  const name = n => data.scenarios.find(s => s.number === n)?.name;
  const sorted = [...data.sessions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return [
    h("h2", {}, "Sessions"),
    h("div", { class: "stack" }, sorted.map(s => h("article", { class: "card" },
      h("h3", {}, formatDate(s.date) || "Undated session"),
      h("ul", { class: "plain" }, s.scenarios.map(sc => h("li", {},
        `#${sc.number}${name(sc.number) ? ` ${name(sc.number)}` : ""} `,
        h("span", { class: `badge ${sc.result}` }, sc.result === "success" ? "Success" : "Failure")))),
      s.characters?.length ? h("p", { class: "muted small" }, s.characters.join(", ")) : null,
      notes(s.notes)))),
  ];
}

// --- Tabs and loading -----------------------------------------------------

const RENDERERS = {
  overview: renderOverview,
  scenarios: renderScenarios,
  characters: renderCharacters,
  sessions: renderSessions,
};

function currentTab() {
  const tab = location.hash.slice(1);
  return tab in RENDERERS ? tab : "overview";
}

function render(data, only) {
  for (const [id, fn] of Object.entries(RENDERERS)) {
    if (only && id !== only) continue;
    document.getElementById(id).replaceChildren(...[fn(data)].flat(Infinity).filter(Boolean));
  }
}

function showTab() {
  const tab = currentTab();
  for (const id of Object.keys(RENDERERS)) document.getElementById(id).hidden = id !== tab;
  for (const a of document.querySelectorAll(".tabs a")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

// Fill in anything missing, so older or partial files still display.
function withDefaults(raw) {
  const party = { name: "", reputation: 0, location: "", achievements: [], notes: "", ...raw.party };
  const city = { prosperityCheckmarks: 0, donations: 0, globalAchievements: [], unlockedClasses: [], ...raw.city };
  return {
    ...raw,
    party,
    city,
    scenarios: raw.scenarios || [],
    characters: (raw.characters || []).map(c => ({ xp: 0, gold: 0, checkmarks: 0, perks: [], items: [], ...c })),
    sessions: (raw.sessions || []).map(s => ({ scenarios: [], ...s })),
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

async function start() {
  const status = document.getElementById("status");
  const url = dataUrl();
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = withDefaults(await response.json());

    if (data.party.name) {
      document.getElementById("title").textContent = data.party.name;
      document.title = `${data.party.name} · Gloomhaven`;
    }
    document.getElementById("footer").textContent =
      [data.edition, data.updated ? `updated ${formatDate(data.updated)}` : null,
       url.pathname.endsWith("/campaign.json") ? null : `showing ${url.pathname}`].filter(Boolean).join(" · ");

    render(data);
    status.remove();
    showTab();
    window.addEventListener("hashchange", showTab);
  } catch (err) {
    status.classList.add("error");
    status.textContent = `Couldn't load the campaign (${url.pathname}): ${err.message}`;
  }
}

start();
