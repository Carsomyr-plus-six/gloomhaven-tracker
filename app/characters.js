// Characters: which one this phone plays, and each sheet: its checks,
// perks, items, quest and attack modifier deck.

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

// The deck as a row of columns, one per card value from worst to best, each
// a stack of one block per card, counted in fives as tally marks are; Curse
// and Bless, shuffled in for a while, are the columns at either end, added
// and taken out there on a phone. A card with an effect (+1 WOUND) stacks in
// its number's column, hollow, and is listed under the columns with its
// icon, as the deck is built at the table; rolling cards share a column. Any
// perk it couldn't read is listed, so nothing is silently left out.
const DECK_VALUES = ["Null", "−2", "−1", "+0", "+1", "+2", "+3", "+4", "2×", "rolling"];
// The standard deck's values: a column each even when perks took every card
// of one out, as that's worth seeing.
const DECK_BASE = new Set(["Null", "−2", "−1", "+0", "+1", "+2", "2×"]);
const deckValue = label => /^rolling\b/.test(label) ? "rolling" : label === "Null" || label === "2×" ? label : /^[+−]\d/.exec(label)?.[0] ?? label;
// A rolling card's colour is its number's (a rolling +1 is above +0).
const deckKind = label => cardKind(label.replace(/^rolling\s*/, ""));

function attackDeckBlock(c, rows) {
  const sheet = classPerks(c.class);
  const inOrder = [...rows].sort((a, b) => (a.match ? sheet.indexOf(a.match) : sheet.length) - (b.match ? sheet.indexOf(b.match) : sheet.length));
  const { cards, total, unread } = attackDeck(inOrder.filter(r => r.match).flatMap(r => Array(r.count).fill(r.match)),
    inOrder.filter(r => !r.match).map(r => r.written));
  // Bless and Curse cards in the deck now, as counted under Conditions; with
  // none counted, Sanctuary blessings in the session being recorded, for the
  // next scenario.
  const conds = tableState(c.name).conds || {};
  const curses = conds.curse || 0;
  const donated = !conds.bless && Boolean(c.blessNext || (draft?.donations || []).some(x => x.character === c.name));
  const blesses = conds.bless || (donated ? 2 : 0);
  // Added and taken out on a phone, at the table; elsewhere they're shown.
  const playing = phone.matches && !c.retired;

  const columns = DECK_VALUES
    .map(v => ({ v, cards: cards.filter(([label]) => deckValue(label) === v) }))
    .filter(col => DECK_BASE.has(col.v) || col.cards.length)
    // The plain cards at the bottom, those with an effect above them.
    .map(col => ({ ...col, cards: [...col.cards].sort(([a], [b]) => (a !== col.v) - (b !== col.v)) }));
  const count = list => list.reduce((sum, [, n]) => sum + n, 0);
  // Every column as tall as the tallest stack, so they share a top and a
  // bottom; on a phone, room above it for the + of Curse and Bless.
  const most = Math.max(curses, blesses, ...columns.map(col => count(col.cards)));
  const height = Math.max(1, most) * 10 - 2 + Math.floor(Math.max(0, most - 1) / 5) * 4 + (playing ? 18 : 0);
  // One block a card, a wider gap after each five.
  const blocks = list => list.flatMap(([kind, fx, n]) => Array(n).fill([kind, fx]))
    .map(([kind, fx], i, all) => h("i", { class: `k-${kind}${fx ? " fx" : ""}${i % 5 === 4 && i < all.length - 1 ? " five" : ""}` }));
  const cardsText = list => list.map(([label, n]) => `${n} ${label}`).join(", ");

  // Bless and Curse, kept with the tracker's conditions as the dock shows
  // them too; each is removed once drawn (rulebook pp. 22-23).
  const change = (key, fn) => () => {
    fn();
    saveTable(c.name, { conds });
    const sheetEl = document.querySelector(`.char-card[data-char="${CSS.escape(c.name)}"]`);
    sheetEl?.querySelector(".dock-conds")?.replaceWith(condStrip(c));
    const deck = attackDeckBlock(c, perkCheck(c).rows);
    sheetEl?.querySelector(".deck-block")?.replaceWith(deck);
    deck.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  };
  const side = id => {
    const [, name] = DECK_CONDITIONS.find(([x]) => x === id);
    const n = id === "bless" ? blesses : curses;
    const said = donated && id === "bless" ? `${name}: 2 cards, from a Sanctuary donation, for the next scenario only` : `${name}: ${plural(n, "card")}`;
    const stack = [blocks([[id, false, n]]), playing ? icon("plus") : null];
    return h("div", { class: `deck-col side ${id}${n ? " on" : ""}`, title: said },
      playing
        ? h("button", { type: "button", class: "deck-stack", style: `height: ${height}px`, "data-key": `cond-${id}-up-${c.name}`,
            "aria-label": `${said}. Add 1`, "aria-disabled": String(n >= 10),
            onclick: change(`cond-${id}-up-${c.name}`, () => { if (n < 10) conds[id] = n + 1; }) }, stack)
        : h("div", { class: "deck-stack", style: `height: ${height}px`, role: "img", "aria-label": said }, stack),
      h("span", { class: "deck-label", "aria-hidden": "true" }, condIcon(id)));
  };
  const less = id => {
    const [, name] = DECK_CONDITIONS.find(([x]) => x === id);
    const n = conds[id] || 0;
    return h("button", { type: "button", class: `deck-less ${id}`, "data-key": `cond-${id}-down-${c.name}`, "aria-label": `1 less ${name} card`,
      "aria-disabled": String(!n), onclick: change(`cond-${id}-down-${c.name}`, () => { if (n > 1) conds[id] = n - 1; else delete conds[id]; }) }, icon("minus"));
  };

  const below = count(cards.filter(([l]) => ["null", "bad"].includes(deckKind(l)))) + curses;
  const at = count(cards.filter(([l]) => deckKind(l) === "zero"));
  const effects = cards.filter(([label]) => label !== deckValue(label));
  const extra = [...Array(curses).fill("curse"), ...Array(blesses).fill("bless")];
  const said = `${plural(total, "card")}${blesses ? ` + ${blesses} Bless` : ""}${curses ? ` + ${curses} Curse` : ""}`;
  return h("div", { class: "block deck-block" },
    // The deck's size, and a pip for each Curse and Bless shuffled in.
    h("div", { class: "block-head" }, h("h4", { class: "label" }, "Attack modifier deck"),
      h("span", { class: "deck-size", role: "img", "aria-label": said, title: said },
        icon("cards"), h("b", { class: "num" }, String(total)),
        extra.length ? h("span", { class: "deck-pips" }, extra.map(k => h("i", { class: `k-${k}` }))) : null)),
    h("div", { class: "deck-cols", role: "group", "aria-label": `${below} below +0, ${at} at +0, ${total + curses + blesses - below - at} above`,
               style: `grid-template-columns: repeat(${columns.length + 2}, minmax(0, 1fr))` },
      side("curse"),
      columns.map(col => {
        const n = count(col.cards);
        const said = `${col.v === "rolling" ? "Rolling" : col.v}: ${plural(n, "card")}${col.cards.some(([l]) => l !== col.v) ? ` (${cardsText(col.cards)})` : ""}`;
        return h("div", { class: `deck-col${["null", "bad"].includes(deckKind(col.v)) ? " dim" : ""}`, title: said },
          h("div", { class: "deck-stack", style: `height: ${height}px`, role: "img", "aria-label": said },
            blocks(col.cards.map(([label, k]) => [deckKind(label), label !== col.v, k]))),
          h("span", { class: "deck-label", "aria-hidden": "true" }, col.v === "rolling" ? h("img", { class: "glyph", src: "icons/rolling.svg", alt: "", width: 16, height: 16 }) : col.v));
      }),
      side("bless"),
      playing ? [less("curse"), less("bless")] : null),
    // The cards with an effect, as they're found to build the deck.
    effects.length ? h("ul", { class: "deck-cards" }, effects.map(([label, n]) => h("li", { class: { null: "bad", bad: "bad", good: "good", crit: "good" }[deckKind(label)] || null },
        h("i", { class: `swatch k-${deckKind(label)} fx`, "aria-hidden": "true" }),
        h("span", {}, perkText(label)), h("span", { class: "sr-only" }, ", "), h("b", { role: "img", "aria-label": plural(n, "card") }, String(n))))) : null,
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
          h("span", { class: "xp-now num" }, xpText(c.xp)),
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
  // A phone shows one sheet, so it builds only that one; picking another
  // draws it then.
  const onScreen = c => !phone.matches || order.indexOf(c) === characterIndex;
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
    active.length ? h("div", { class: "char-grid" }, [...active, ...shownInactive].filter(onScreen).map(card))
      : [empty("No active characters."), shownInactive.length ? h("div", { class: "char-grid" }, shownInactive.filter(onScreen).map(card)) : null],
    retired.length ? [h("h3", { class: "subhead" }, "Retired"), h("div", { class: "char-grid" }, retired.filter(onScreen).map(card))] : null,
  ];
}
