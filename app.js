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
          : h("p", { class: "muted small" }, "None listed.")),
      h("div", { class: "card" }, h("h3", {}, "Item designs"),
        h("p", { class: "muted small" }, "Added to the shop for good."),
        achievementList(city.itemDesigns))),
    renderEventDecks(data),
  ];
}

function renderEventDecks(data) {
  const ev = data.eventState;
  if (!ev) return null;

  const changes = (deck, map, verb) => [...map].sort((a, b) => a[0] - b[0]).map(([number, source]) =>
    h("li", {}, `${verb} ${eventLabel(deck, number)}`, h("span", { class: "muted small" }, ` · ${source}`)));

  return h("div", { class: "card", style: "margin-top:12px" },
    h("h3", {}, "Event decks"),
    stats(Object.keys(DECK_NAMES).map(deck => [`${DECK_NAMES[deck]} deck`, `${ev.decks[deck].size} cards`])),
    ev.questions.length ? h("div", { class: "stack", style: "margin-top:8px" },
      ev.questions.map(q => h("div", { class: "reason small" }, q))) : null,
    h("div", { class: "grid", style: "margin-top:8px" },
      Object.keys(DECK_NAMES).map(deck => {
        const items = [...changes(deck, ev.added[deck], "Added"), ...changes(deck, ev.removed[deck], "Removed")];
        return h("div", {},
          h("div", { class: "muted small" }, `${DECK_NAMES[deck]} deck changes`),
          items.length ? h("ul", { class: "plain" }, items) : h("p", { class: "muted small" }, "None yet."));
      })),
    ev.history.length ? [
      h("div", { class: "muted small", style: "margin-top:12px" }, "Events drawn"),
      h("ul", { class: "plain" }, ev.history.map(e => h("li", {},
        e.option ? `${e.label}: option ${e.option}` : e.label,
        h("span", { class: "muted small" }, [
          e.fate ? ` · ${e.fate}` : null,
          e.adds.length ? ` · added ${e.adds.map(([d, n]) => eventLabel(d, n)).join(", ")}` : null,
          e.scenario ? ` · before #${e.scenario}` : null,
        ].filter(Boolean).join("")),
        e.notes ? h("div", { class: "muted small" }, e.notes) : null))),
    ] : null);
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

function describeRewards(ref, rewards) {
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
  const known = ["gold", "collectiveGold", "experience", "prosperity", "reputation", "globalAchievements",
                 "partyAchievements", "lostPartyAchievements", "chooseLocation"];
  if (Object.keys(r).some(k => !known.includes(k))) parts.push("more in the scenario book");
  return parts;
}

// --- Event decks ------------------------------------------------------------
// data/gloomhaven-events.json says what each event option does to the decks.
// campaign.json's "events" lists the events drawn and the option chosen;
// "eventDecks" holds manual additions and removals the data can't know about.

const DECK_NAMES = { city: "City", road: "Road" };
const eventLabel = (deck, number) => `${DECK_NAMES[deck] || deck} ${number}`;

function describeCondition(c) {
  if (!c || c.type === "otherwise") return "otherwise";
  if (c.type === "reputationGT") return `reputation above ${c.values[0]}`;
  if (c.type === "reputationLT") return `reputation below ${c.values[0]}`;
  if (c.type === "character") return `with ${c.values.join(" or ")}`;
  if (c.type.startsWith("pay")) return "if you paid";
  return c.type;
}

function deriveEvents(data, evRef) {
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

  const add = (deck, number, source) => {
    decks[deck]?.add(number);
    added[deck]?.set(number, source);
    removed[deck]?.delete(number);
  };
  const remove = (deck, number, source) => {
    decks[deck]?.delete(number);
    removed[deck]?.set(number, source);
  };

  for (const e of data.events) {
    const label = eventLabel(e.deck, e.number);
    const options = evRef?.events?.[e.deck]?.[String(e.number)] || {};
    // Without a known option, consider every outcome of every option.
    const outcomes = e.option ? options[e.option] || [] : Object.values(options).flat();
    const outcome = e.option && e.outcome ? outcomes[e.outcome - 1]
                  : outcomes.length === 1 ? outcomes[0] : null;

    // Removed or returned: the campaign entry wins, then the outcome, then
    // all possible outcomes agreeing.
    const fates = new Set(outcomes.map(o => o.card));
    const fate = e.card || outcome?.card || (fates.size === 1 ? [...fates][0] : null);
    if (fate === "removed") remove(e.deck, e.number, e.option ? `${label}, option ${e.option}` : label);

    // With no outcome pinned down, cards added or scenarios unlocked count
    // only if every possible outcome agrees.
    const same = key => {
      const all = outcomes.map(o => JSON.stringify(o[key] || []));
      return new Set(all).size === 1 ? JSON.parse(all[0]) : [];
    };
    const adds = outcome ? outcome.adds || [] : same("adds");
    for (const [deck, number] of adds) add(deck, number, `from ${label}`);
    for (const n of outcome ? outcome.unlocks || [] : same("unlocks")) unlocks.push({ number: n, source: `${label} event` });

    // Settled: the card's fate is known and every possible outcome agrees on
    // what it adds and unlocks, so there is nothing to ask.
    const settled = Boolean(fate) && (Boolean(outcome) ||
      new Set(outcomes.map(o => JSON.stringify([o.adds || [], o.unlocks || []]))).size <= 1);
    if (!settled) {
      if (!e.option) {
        questions.push(`${label}: which option did you choose, and who was there? It decides what happened to the card.`);
      } else if (!outcome && outcomes.length > 1) {
        const choices = outcomes.map((o, i) => `${i + 1}: ${describeCondition(o.condition)}`).join("; ");
        questions.push(`${label}, option ${e.option}: which outcome? (${choices})`);
      } else {
        questions.push(`${label}: check whether the card was removed or returned to the deck.`);
      }
    }
    for (const [deck, number] of outcome?.mayAdd || []) {
      questions.push(`${label}: ${eventLabel(deck, number)} may have been added, depending on the characters present.`);
    }

    history.push({ ...e, label, fate, adds });
  }

  for (const a of data.eventDecks.added) add(a.deck, a.number, a.notes || "added by hand");
  for (const r of data.eventDecks.removed) remove(r.deck, r.number, r.notes || "removed by hand");

  return { decks, added, removed, history, questions, unlocks };
}

// Turn campaign.json's scenario entries plus the reference data into the full
// list of unlocked scenarios, each with a status and, if blocked, the reasons.
// eventUnlocks are scenarios unlocked by events: [{ number, source }].
function deriveScenarios(data, ref, eventUnlocks = []) {
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
      s.rewards = describeRewards(ref, info.rewards);
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

// --- Scenarios tab --------------------------------------------------------

const STATUS_LABELS = { available: "Available", completed: "Completed", blocked: "Blocked" };
let scenarioFilter = "all";

// Remembered per browser; falls back to the list if storage is unavailable.
let scenarioView = "list";
try { if (localStorage.getItem("scenarioView") === "tree") scenarioView = "tree"; } catch {}

function setScenarioView(data, view) {
  scenarioView = view;
  try { localStorage.setItem("scenarioView", view); } catch {}
  render(data, "scenarios");
}

// Jump from the tree to a scenario's card in the list.
function showScenario(data, number) {
  scenarioFilter = "all";
  setScenarioView(data, "list");
  document.getElementById(`scenario-${number}`)?.scrollIntoView({ block: "center" });
}

// Scenarios as a tree: each one sits under the scenario that unlocked it.
function unlockTree(data, all) {
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
  const branch = list => h("ul", {}, list.map(s => {
    if (seen.has(s.number)) return null;
    seen.add(s.number);
    const kids = children.get(s.number) || [];
    return h("li", {},
      h("button", { type: "button", class: `tree-node ${s.status}`, onclick: () => showScenario(data, s.number) },
        h("span", { class: "num" }, `#${s.number}`), " ", s.name || "Untitled", " ",
        h("span", { class: `badge ${s.status}` }, STATUS_LABELS[s.status] || s.status)),
      kids.length ? branch(kids) : null);
  }));

  return h("div", { class: "tree" }, branch(roots));
}

function renderScenarios(data) {
  const all = [...data.scenarios].sort((a, b) => a.number - b.number);
  if (!all.length) return [h("h2", {}, "Scenarios"), empty("No scenarios recorded yet.")];

  const views = h("div", { class: "filters", role: "group", "aria-label": "Scenario view" },
    [["list", "List"], ["tree", "Unlock tree"]].map(([view, label]) =>
      h("button", {
        type: "button",
        "aria-pressed": String(scenarioView === view),
        onclick: () => setScenarioView(data, view),
      }, label)));

  if (scenarioView === "tree") {
    return [
      h("div", { class: "section-head" }, h("h2", {}, "Scenarios"), views),
      h("p", { class: "muted small" }, "Each scenario sits under the one that unlocked it. Tap one to see its notes."),
      unlockTree(data, all),
    ];
  }

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
    h("div", { class: "section-head" }, h("h2", {}, "Scenarios"), views),
    filters,
    h("div", { class: "stack" }, shown.map(s => h("article", { class: "card scenario", id: `scenario-${s.number}` },
      h("span", { class: "num" }, `#${s.number}`),
      h("h3", {}, s.name || "Untitled"),
      h("span", { class: `badge ${s.status}` }, STATUS_LABELS[s.status] || s.status),
      h("div", { class: "body" },
        h("div", { class: "muted small" },
          [s.unlockedBy ? `Unlocked by #${s.unlockedBy}${name(s.unlockedBy) ? ` ${name(s.unlockedBy)}` : ""}`
             : s.unlockedVia ? `Unlocked by ${s.unlockedVia}` : null,
           s.completed ? `Completed ${formatDate(s.completed)}` : null,
           s.treasures?.length ? `${s.treasures.length > 1 ? "Treasures" : "Treasure"} ${s.treasures.join(", ")} looted` : null].filter(Boolean).join(" · ")),
        s.reasons.map(r => h("div", { class: "reason small" }, r)),
        s.rewards.length ? h("div", { class: "small" }, h("span", { class: "muted" }, "Rewards: "), s.rewards.join(", ")) : null,
        s.results?.length ? h("ul", { class: "plain small results" }, s.results.map(r => h("li", {},
          h("strong", {}, r.character), " ",
          [r.xp != null ? `${r.xp} XP` : null, r.gold != null ? `${r.gold} gold` : null,
           r.checkmarks ? `${r.checkmarks} checkmark${r.checkmarks === 1 ? "" : "s"}` : null,
           r.notes].filter(Boolean).join(" · ")))) : null,
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
  const city = { prosperityCheckmarks: 0, donations: 0, globalAchievements: [], unlockedClasses: [], itemDesigns: [], ...raw.city };
  return {
    ...raw,
    party,
    city,
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
    const [response, ref, evRef] = await Promise.all([
      fetch(url, { cache: "no-cache" }),
      loadReference("data/gloomhaven-scenarios.json"),
      loadReference("data/gloomhaven-events.json"),
    ]);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = withDefaults(await response.json());
    data.eventState = evRef ? deriveEvents(data, evRef) : null;
    data.scenarios = deriveScenarios(data, ref, data.eventState?.unlocks);

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
    window.addEventListener("hashchange", showTab);
  } catch (err) {
    status.classList.add("error");
    status.textContent = `Couldn't load the campaign (${url.pathname}): ${err.message}`;
  }
}

start();
