// At the table (phones): ability cards, conditions, items, the tracker dock,
// and what a scenario gave; in town after.

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
  // The piles as the attack modifier deck is drawn: a column each, a small
  // card per card, in rows of five from the bottom; every column as tall as
  // the whole hand would make it, so nothing moves as cards do.
  const total = piles.hand + piles.discard + piles.lost;
  const rows = Math.max(1, Math.ceil(total / 5));
  const pile = (name, n, kind) => h("div", { class: `pile ${kind}${n ? "" : " none"}` },
    h("div", { class: "pile-cards", style: `--rows: ${rows}`, "aria-hidden": "true" }, Array.from({ length: n }, () => h("i"))),
    h("span", { class: "label", "aria-hidden": "true" }, name));
  const said = `${piles.hand} in hand, ${piles.discard} in the discard pile, ${piles.lost} lost`;
  const roundsSaid = `Up to ${plural(left, "round")} left`;

  const block = h("div", { class: "block card-block", id: `cards-${c.name}` },
    // Rounds left as the deck shows its size: an hourglass and the number;
    // exhausted, or a rest due, said in words.
    h("div", { class: "block-head" }, h("h4", { class: "label" }, "Ability cards"),
      exhausted || piles.hand < 2
        ? h("span", { class: `small${exhausted ? " pile-warn" : " muted"}` }, exhausted ? "Exhausted" : "Rest this round")
        : h("span", { class: "pile-rounds", role: "img", "aria-label": roundsSaid, title: roundsSaid }, icon("hourglass"), h("b", { class: "num" }, String(left)))),
    h("div", { class: "piles", title: said }, pile("Hand", piles.hand, "hand"), pile("Discard", piles.discard, "discard"), pile("Lost", piles.lost, "lost"),
      h("output", { class: "sr-only", "aria-live": "polite" }, said)),
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
        row("Gold", [eq(st.coins, st.coins === 1 ? "coin" : "coins"), t ? [op("×"), eq(t.gold)] : null, op("=")], gold != null ? `+${goldText(gold)}` : "?"),
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
          `Then ${xpText(c.xp + xp)}`,
          after.level === before.level && after.toNext ? ` · ${after.toNext.remaining} to level ${after.level + 1}` : "",
          gold != null ? ` · ${goldText(c.gold + gold - draftSpend(data, c.name))}${draftSpend(data, c.name) ? " after the draft" : ""}` : "",
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
  jobs.push([c ? h("span", {}, `${c.name} has `, h("strong", { class: "town-gold" }, goldText(c.gold)), " to spend",
      spent ? `, ${goldText(c.gold - spent)} after the draft` : "", ".") : "The Shop.",
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
      : `The Sanctuary: ${goldText(DONATION)} for 2 Bless in your next scenario, once a visit.`,
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
