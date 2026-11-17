// The event decks, and the campaign record: milestones, achievements, class boxes.

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
// How far is a block per step (a donation of 10g for Envelope B), filled as
// it's reached and counted in fives, as the attack modifier deck is; the
// figures are for hover and screen readers.
function milestones(data) {
  const envelope = letter => h("span", { class: "mile-env", "aria-hidden": "true" }, letter);
  const MARKS = { "envelope-a": () => envelope("A"), "envelope-b": () => envelope("B"), "envelope-x": () => envelope("X"),
    "town-records": () => icon("book"), sun: () => gameIcon("class-sun"), eclipse: () => gameIcon("class-eclipse"),
    "events-plus-20": () => icon("plus"), "events-minus-20": () => icon("minus"), drake: () => icon("plus") };
  // The blocks' colour: the reputation milestones as the reputation track
  // has them, the rest brass.
  const TONES = { sun: "good", "events-plus-20": "good", eclipse: "bad", "events-minus-20": "bad" };
  return h("ul", { class: "miles" }, milestoneStates(data).filter(x => x.shown).map(x => {
    const step = x.id === "envelope-b" ? DONATION : 1;
    const need = x.need / step;
    const have = Math.max(0, Math.min(need, Math.floor(x.have / step)));
    const said = x.says || (x.need ? `${Math.max(0, x.have)} of ${x.need}${x.unit || ""}${x.what ? ` ${x.what}` : ""}` : x.what);
    return h("li", { class: x.open ? "open" : x.ready ? "ready" : null, title: x.open || x.ready ? null : said },
      h("span", { class: "mile-mark" }, MARKS[x.id]?.()),
      h("span", { class: "mile-text" },
        h("span", { class: "mile-name" }, h("strong", {}, x.name),
          x.open || x.ready ? h("span", { class: "mile-state" }, x.open ? "Open" : "Ready")
            : x.need ? null : h("span", { class: "mile-state" }, x.what)),
        x.need && !x.open ? h("span", { class: `mile-steps ${TONES[x.id] || "brass"}`, role: "img", "aria-label": said },
          Array.from({ length: need }, (_, i) => h("i", { class: `${i < have ? "on" : ""}${i > 0 && i % 5 === 0 ? " five" : ""}`.trim() || null }))) : null,
        x.need && !x.open && x.what ? h("span", { class: "sub", "aria-hidden": "true" }, x.what) : null));
  }));
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
          .map(v => [v.startsWith("!"), achievementName(k, v.replace(/^!/, "").split(":")[0])]));
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
    const said = u ? `${className(id)}${starting ? ", a starting class" : how ? `, unlocked by ${how}` : ", unlocked"}` : `The ${classIconName(id)} box, still closed`;
    return h("li", { class: u ? (starting ? "starting" : "unlocked") : "locked", title: said, role: "img", "aria-label": said },
      gameIcon(`class-${id}`),
      u ? h("span", { class: "box-name", "aria-hidden": "true" }, className(id)) : null,
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
          item ? h("span", { class: "sub" }, `${goldText(item.price)} · ${item.count} ${item.count === 1 ? "copy" : "copies"}`) : null)),
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
