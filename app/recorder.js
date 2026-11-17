// Recording a session: the form, its draft, and the updated campaign.json.

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
// The level a scenario in the draft is recorded at when its row has none
// (an older draft): tonight's, as picked on the Overview.
const draftFallback = data => tonight(data)?.level;

// Does the draft change anything yet? An opened form, or a row added and left
// empty, doesn't: no draft is kept for it, and nothing says one is waiting.
function draftChanges(d, data) {
  if (!d || !rawCampaign) return false;
  const res = applyDraft(rawCampaign, d, data, { level: draftFallback(data) });
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
  // Read once a render: the form is rebuilt when tonight's party or
  // difficulty changes.
  const fallbackLevel = draftFallback(data);
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
    ? deriveCampaign(withDefaults(JSON.parse(JSON.stringify(res.out)))) : null;
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
    const rewards = describeRewards(info.rewards);
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
    const g = scenarioGain(s, r, fallbackLevel);
    return `= ${xpText(g.xp)}, ${goldText(g.gold)}`;
  };
  const reward = n => scenarioRef?.scenarios?.[String(n)]?.rewards;
  const tracked = name => {
    const t = tableState(name);
    return t.xp || t.coins || t.goal ? [xpText(t.xp), plural(t.coins, "coin"), t.goal ? plural(t.goal, "checkmark") : null].filter(Boolean).join(", ") : null;
  };
  const scenarioBlock = (s, i) => {
    const n = num(s.number);
    s.level ??= String(draftLevel(s, fallbackLevel));
    const known = data.scenarios.find(x => x.number === n);
    const casualOk = Boolean(known);
    const casual = isCasual(s, data);
    const st = scenarioStats(draftLevel(s, fallbackLevel));
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
          h("strong", { class: "rec-who" }, `${goldText(reward(n).collectiveGold)} to share`),
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
          t.number ? h("span", { class: "small muted rec-note" }, treasureParts(t.number).map(describeTreasurePart).join(", ") || "Not in the treasure index") : null,
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

  const playedTonight = d.scenarios.filter(s => num(s.number));
  const firstPlayed = num(playedTonight[0]?.number);
  const lastPlayed = num(playedTonight.at(-1)?.number);
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
    const oc = chosenOutcome(data, e.deck, num(e.number), e.option, party.map(c => c.name),
                             e.paid === "yes" ? true : e.paid === "no" ? false : undefined);
    const fx = oc?.effects.find(x => x.type === "collectiveGold");
    if (!fx || !party.length) return null;
    e.shares ||= {};
    return h("div", { class: "rec-row" },
      h("strong", { class: "rec-who" }, `${goldText(Math.abs(fx.amount))} to ${fx.amount > 0 ? "share" : "pay"}`),
      party.map(c => field(c.name, text(`ev-${i}-share-${c.name}`, e.shares, c.name,
        { type: "number", min: 0, inputmode: "numeric", placeholder: "0", "aria-label": `${c.name}'s share` }), "short")));
  };

  const buyBlock = (b, i) => h("div", { class: "rec-row" },
    // Anyone in town can shop, playing tonight or not; newcomers too.
    field("Who", select(`buy-${i}-c`, b, "character", activeOptions)),
    field("Item", select(`buy-${i}-i`, b, "item", [["", "Pick an item"],
      ...(data.shop?.stock || []).filter(x => x.left > 0).map(x => [x.name, `${x.name} · ${goldText(x.price)}`])], false)),
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
    ...d.retirements.filter(x => x.unlocks).map(x => className(x.unlocks))])].sort();
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
      h("span", { class: "small muted rec-note" }, `Starts at level ${level} with ${xpText(XP_FOR_LEVEL[level - 1])} and ${goldText(startingGold(level))}`),
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
    // Written in the file's layout: what happened, each thing once (campaign/file.js).
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
    const res = applyDraft(rawCampaign, d, data, { level: fallbackLevel });
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
  const first = applyDraft(rawCampaign, d, data, { level: fallbackLevel });
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
              field(`Donates ${goldText(DONATION)}, for 2 Bless next scenario`, select(`don-${i}-c`, x, "character", partyOptions)),
              // Before tonight's scenario the Bless is used in it; after, it waits.
              // A visit follows each scenario: before the first, between two, after the last.
              firstPlayed ? field("When", select(`don-${i}-w`, x, "when", [["", `In town, before ${scenarioLabel(data, firstPlayed)}`],
                ...playedTonight.map((s, k) => [k === playedTonight.length - 1 ? "after" : `after-${k + 1}`,
                  playedTonight.length === 1 ? "Back in town, after it" : `Back in town, after ${scenarioLabel(data, num(s.number))}${
                    // A scenario played again (a retry) is told apart by which time.
                    playedTonight.filter(t => num(t.number) === num(s.number)).length > 1
                      ? ` (the ${["first", "second", "third", "fourth"][playedTonight.filter((t, j) => j < k && num(t.number) === num(s.number)).length] || "next"} time)` : ""}`])])) : null,
              remove(d.donations, i, "donation", "add-donation"))),
            // Enhancements, from the calculator's Record it.
            d.enhancements.map((x, i) => h("div", { class: "rec-row" },
              field("Who enhances", select(`enr-${i}-c`, x, "character", activeOptions)),
              h("span", { class: "small muted rec-note" }, `${x.what}: ${goldText(x.cost)}`),
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
