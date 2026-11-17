// Tonight (phones): the scenario picked and how to set it up, blessings
// waiting, and what to see to before playing (todoItems).

// --- Tonight's scenario (phones) ----------------------------------------------
// Tapping a Ready to play card on a phone picks it for tonight, and the
// Tonight tab shows what setting it up needs: its level's numbers, whether a
// road event comes first, its treasure tiles, and each player's hand size
// and hit points. Kept in this browser; a scenario no longer open to play is
// forgotten. Without a pick, the first scenario in the draft stands in.

function pickTonight(data, number) {
  if (openSheetId === "ready") { openSheetId = null; if (history.state?.sheet) history.back(); }
  tonightPick = number;
  stored.set(STORE.pick, number ? String(number) : null);
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
    step(2, "In town", town || (shop ? (shop.modifier === 0 ? "Normal prices" : `Prices ${goldChange(shop.modifier)}`) : "Shop, perks, Sanctuary"),
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
    const prosperity = stepFor(data.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
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
    const oc = chosenOutcome(data, e.deck, e.number, e.option, e.names, e.paid);
    for (const fx of (oc?.effects || []).filter(fx => fx.type === "nextScenario")) add(`${eventLabel(e.deck, e.number)}, option ${e.option}: ${nextScenarioText(fx)}.`, "#sessions");
  }
  whose(fromEvents, "table");
  (data.claims || []).forEach((c, i) => add(`Treasure ${c.treasure} in ${c.where} gave ${c.item}: who looted it?`, "#record", null,
    rawCampaign ? { label: "Record it", run: () => recordClaim(data, i) } : null));

  // What the rulebook opens when the campaign reaches it (p. 49): the
  // milestones that are ready (campaign/progress.js).
  for (const x of milestoneStates(data)) if (x.todo) add(...x.todo);

  // Events with no option recorded go together; other questions one by one.
  const questions = data.eventState?.questions || [];
  const noOption = questions.filter(q => /: which option did you choose/.test(q)).map(q => q.split(":")[0]);
  if (noOption.length) {
    add(`${noOption.join(", ")}: ${noOption.length === 1 ? "no option recorded" : "no options recorded"}, so reputation${data.shop?.pricesUnsure ? " and shop prices" : ""} can't be settled.`, "#events");
  }
  for (const q of questions.filter(q => !/: which option did you choose/.test(q))) add(q.replace(/^(Ledger|Record): /, ""), "#events");

  for (const q of data.shop?.questions || []) add(q, "#shop");
  // campaign.json keeping something it needn't, or out of place (campaign/file.js).
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
          h("small", {}, goldText(c.gold))));
    }));
}
