// Sessions: each evening as recorded.

// --- Sessions -------------------------------------------------------------------

// What each character took from the scenarios played in an evening, added up.
function sessionHaul(data, session) {
  const totals = new Map();
  for (const p of plays(data).filter(p => p.session === session)) {
    for (const r of p.results) {
      const total = totals.get(r.character) || { character: r.character, xp: 0, gold: 0 };
      total.xp += r.xp;
      total.gold += r.gold;
      totals.set(r.character, total);
    }
  }
  return [...totals.values()];
}

let recorderOpen = false;

function renderSessions(data) {
  const sorted = [...data.sessions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const history = data.eventState?.history || [];
  // An event drawn on the way to a scenario, or in town around it, as a row
  // of its own in the evening's order: a small card, then what it did.
  const eventRow = e => h("li", { class: "played-event" },
    h("a", { class: "played-link", href: "#events" },
      h("span", { class: `ev-card ${e.deck}`, "aria-hidden": "true" }, h("b", {}, e.number)),
      h("span", { class: "played-text" },
        // The card shows the number; the words say which deck.
        h("strong", {}, h("span", { class: "sr-only" }, `${e.label}: `), `${DECK_NAMES[e.deck]} event`),
        e.effects.length ? h("span", {}, capitalize(e.effects.join(", "))) : null)),
    optionBadge(e));
  // Which session each event was drawn in: the one dated as it is; failing
  // that (an event saved before events carried a date), the first session
  // that played the scenario it came before or after. Each shows in one only.
  const chrono = [...sorted].reverse();
  const playedIn = (s, n) => (s.scenarios || []).some(x => x.number === n);
  const home = new Map();
  for (const e of history) {
    const s = (e.date && sorted.find(x => x.date === e.date))
      || (e.scenario != null && chrono.find(x => playedIn(x, e.scenario)))
      || (e.after != null && chrono.find(x => playedIn(x, e.after)));
    if (s) home.set(e, s);
  }
  const toggle = () => {
    if (!draft) draft = newDraft(data);
    recorderOpen = !recorderOpen;
    // Closing a form with nothing in it leaves no draft behind.
    if (!recorderOpen && !draftChanges(draft, data)) dropDraft(); else saveDraft();
    render(data);
    if (recorderOpen) openSheet("record");
  };
  const head = h("div", { class: "section-head" },
    h("h2", {}, "Sessions"),
    rawCampaign ? h("button", { type: "button", class: `btn${recorderOpen ? "" : " primary"}`, "data-key": "rec-toggle", onclick: toggle },
      recorderOpen ? (draftChanges(draft, data) ? "Close the form (keep the draft)" : "Close the form")
        : draftChanges(draft, data) ? "Go on recording" : "Record a session") : null);

  // Wide screens: an open form takes the full width, Event decks below it.
  document.querySelector(".pair")?.classList.toggle("form-open", recorderOpen && Boolean(draft));
  const saved = savedDraft ? formatDate(savedDraft.date) || savedDraft.title || "an undated evening" : null;
  return [
    head,
    saved ? nudge("check", "Saved", `What you recorded on ${saved} is in campaign.json now, so its draft has been cleared.`, "saved") : null,
    // Phones: a sheet over whichever tab it was opened from; closing it
    // closes the form, keeping the draft.
    recorderOpen && draft ? sheet("record", "Record the evening", renderRecorder(data), () => {
      recorderOpen = false;
      if (!draftChanges(draft, data)) dropDraft(); else saveDraft();
      render(data);
    }) : null,
    sorted.length ? null : empty("No sessions recorded yet."),
    sorted.length ? h("p", { class: "aside" }, "Newest first") : null,
    h("div", {}, sorted.map(s => {
      const haul = sessionHaul(data, s);
      const rows = playedRows(s);
      const long = formatDate(s.date, { day: "numeric", month: "long", year: "numeric" });
      return h("article", { class: "session" },
        h("div", { class: "rail", "aria-hidden": "true" }, h("i")),
        h("div", { class: "session-body" },
          h("div", {},
            // One style: the date heads a session, so the timeline reads by
            // date; a title goes on the line under it. Only an undated
            // session is headed by its title.
            h("h3", {}, long || s.title || "Undated session"),
            h("p", {}, [
              long && s.title ? s.title : null,
              s.date ? formatDate(s.date, { weekday: "long" }) : "Undated",
              s.characters?.length ? s.characters.join(", ") : null,
            ].filter(Boolean).join(" · "))),
          rows.length ? h("ul", { class: "card played" }, rows) : null,
          haul.length ? h("div", { class: "haul" },
            h("h4", { class: "label" }, "The evening's haul"),
            resultsList(haul, "+")) : null,
          notes(s.notes)));
    })),
  ];

  // A session's scenarios in the order played, each with the events drawn
  // on the way to it or back in town after it; events from an evening in
  // town only, or tied to no scenario that evening, come last.
  function playedRows(s) {
    const mine = history.filter(e => home.get(e) === s);
    const used = new Set();
    const take = test => mine.filter(e => !used.has(e) && test(e)).map(e => { used.add(e); return e; });
    const rows = (s.scenarios || []).flatMap(sc => [
      take(e => e.scenario === sc.number).map(eventRow),
      scenarioRow(sc),
      take(e => e.scenario == null && e.after === sc.number).map(eventRow),
    ]).flat();
    return [...rows, ...take(() => true).map(eventRow)];
  }

  function scenarioRow(sc) {
    const name = data.scenarios.find(x => x.number === sc.number)?.name;
    const won = sc.result === "success";
    const replay = won && sc.casual;
    const meta = [sc.level != null ? `Level ${sc.level}` : null].filter(Boolean);
    const outcome = !won ? "Failed" : replay ? "Replayed casually" : null;
    // The scenario opens under Scenarios.
    return h("li", {},
      h("a", { class: "played-link", href: "#scenarios", onclick: () => openScenario(data, sc.number) },
        hex(sc.number, !won ? "failed" : replay ? "replay" : "completed"),
        h("span", { class: "played-text" },
          h("strong", {}, name || `Scenario ${sc.number}`),
          outcome || meta.length ? h("span", {},
            outcome ? h("b", { class: won ? "ink-replay" : "ink-failed" }, outcome) : null,
            outcome && meta.length ? " · " : null, meta.join(" · ")) : null)),
      // Failures and replays say so in words; a plain clear says it here.
      h("span", { class: `result ${!won ? "failure" : replay ? "replay" : "success"}`,
        ...(outcome ? { "aria-hidden": "true" } : { role: "img", "aria-label": "Success" }) },
        icon(!won ? "cross" : replay ? "replay" : "check")));
  }
}
