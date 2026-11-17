// Scenarios: the list and the unlock map.

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
{
  const saved = stored.get(STORE.scenarioView);
  if (saved === "list" || saved === "tree") scenarioView = saved;
}

function setScenarioView(data, view) {
  scenarioView = view;
  stored.set(STORE.scenarioView, view);
  render(data, "scenarios");
}

// Bring a scenario into view, wherever it is currently drawn.
function revealScenario(number) {
  const shown = [...document.querySelectorAll(`[data-scenario="${number}"]`)].find(el => el.offsetParent !== null);
  shown?.scrollIntoView({ block: "center" });
}

// Jump to a scenario from elsewhere on the page (the "ready to play" cards).
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
    r.gold != null ? h("span", { class: `num${sign ? " gain-gold" : ""}` }, `${sign}${r.gold}`, h("span", {}, "g")) : null,
    sign ? null : h("span", { class: "marks" },
      r.checkmarks ? [gameIcon("checkmark", "Battle goal checkmarks"), String(r.checkmarks)] : null),
    r.notes ? h("span", { class: "extra" }, r.notes) : null)));
}

function scenarioFacts(data, s) {
  // For a scenario you could play, what it would be tonight.
  const t = s.status === "available" ? tonight(data) : null;
  const pairs = [
    ["Tonight", t ? `Scenario level ${t.level} (${t.difficulty.toLowerCase()}): monster level ${t.monsters}, ${goldText(t.gold)} a coin, trap damage ${t.trap}, ${t.xp} bonus XP` : null],
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
  const took = open ? completionResults(data, s.number) : [];
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
      took.length ? resultsList(took) : null,
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
  const took = s ? completionResults(data, s.number) : [];
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
      took.length ? h("div", {}, h("span", { class: "label" }, "What each character took home"), resultsList(took)) : null,
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
