// Tests of campaign/ledger.js: the campaign record worked out from what
// happened (achievements).
async function ledgerTests({ same, copy, raw }) {
  // A City Rule replaces a City Rule, by its id.
  const rules = copy(raw);
  rules.sessions.push({ date: "2026-12-01", scenarios: [{ number: 11, result: "success" }, { number: 50, result: "success" }] });
  const rulesData = buildData(copy(rules));
  same("achievements: a new City Rule replaces the old, by id",
    [rulesData.achievements.global.map(a => a.id).filter(id => id.startsWith("city-rule-")), rulesData.lostAchievements.map(a => [a.id, a.how])],
    [["city-rule-militaristic"], [["city-rule-economic", "replaced by City Rule: Militaristic"]]]);

  // campaign.json with these scenarios completed after it, in this order,
  // and anything else changed (by hand) by more.
  const playing = (numbers, more = f => f) => {
    const f = more(copy(raw));
    f.sessions.push({ date: "2026-12-01", scenarios: numbers.map(number => ({ number, result: "success" })) });
    return buildData(f);
  };
  const held = (data, kind) => data.achievements[kind].map(a => [a.id, a.count, a.where]);
  const has = (data, kind, id) => data.achievements[kind].some(a => a.id === id);
  const status = (data, n) => { const s = data.scenarios.find(x => x.number === n); return s ? [s.status, Boolean(s.waiting)] : null; };
  const asked = data => data.eventState.questions.filter(q => q.startsWith("Record:"));

  // Only a global achievement without a type is held more than once (p. 40).
  same("achievements: a party achievement is held once, one without a type as often as gained",
    [held(playing([6]), "party").find(a => a[0] === "jekserahs-plans"), held(playing([23, 40]), "global").find(a => a[0] === "ancient-technology")],
    [["jekserahs-plans", 1, "#3, #6"], ["ancient-technology", 2, "#23, #40"]]);
  // Both of the Drake's: The Drake Aided and its two events, at once, and
  // #34 blocked for good (p. 49). #33 gives both treasures (scenario book).
  const drake = playing([25, 33]);
  same("achievements: The Drake's Command and Treasure open The Drake Aided, City 75 and Road 66",
    [held(drake, "global").find(a => a[0] === "the-drake-aided"), drake.eventState.decks.city.has(75), drake.eventState.decks.road.has(66),
     status(drake, 34), milestoneStates(drake).find(m => m.id === "drake").open],
    [["the-drake-aided", 1, "#33"], true, true, ["blocked", false], true]);
  same("achievements: the Voice's way to #33 gives both treasures, and The Drake Aided waits for the Command",
    [has(playing([24, 33]), "party", "the-drakes-treasure"), has(playing([24, 33]), "global", "the-drake-aided"),
     held(playing([24, 33, 25]), "global").find(a => a[0] === "the-drake-aided")],
    [true, false, ["the-drake-aided", 1, "#25"]]);
  // Lost: gone, and kept for the record; one not held, nothing (p. 49).
  same("achievements: a lost one goes, one not held changes nothing",
    [has(playing([25, 34]), "party", "the-drakes-command"), playing([25, 34]).lostAchievements.map(a => [a.id, a.how, a.at]),
     playing([34]).lostAchievements],
    [false, [["the-drakes-command", "lost", "#34"]], []]);
  same("achievements: a new Artifact replaces the old",
    [held(playing([22, 35]), "global").filter(a => a[0].startsWith("artifact-")).map(a => a[0]), playing([22, 35]).lostAchievements.filter(a => a.kind === "global").map(a => a.how)],
    [["artifact-lost"], ["replaced by Artifact: Lost"]]);

  // ×3: #51 waits for three End of Corruption. Not yet (an achievement to
  // gain) is told apart from blocked for good (one held it wants incomplete).
  const reveal51 = f => { f.scenarios.push({ number: 51 }); return f; };
  same("requirements: ×3 counts, and waiting on one is not yet, not blocked for good",
    [status(playing([46, 47], reveal51), 51), playing([46, 47], reveal51).scenarios.find(s => s.number === 51).reasons,
     status(playing([46, 47, 48], reveal51), 51), status(playing([]), 9)],
    [["blocked", true], ["Needs End of Corruption ×3"], ["available", false], ["blocked", false]]);

  // By hand: from before the record, so what came after replaces or loses
  // it; one worked out as well is counted once, and asked about.
  same("by hand: replaced and lost by what came after",
    [playing([11], f => { f.city.globalAchievements = [{ name: "City Rule: Militaristic" }]; return f; }).lostAchievements.map(a => [a.id, a.how]),
     playing([34], f => { f.party.achievements = [{ name: "The Drake's Command" }]; return f; }).lostAchievements.map(a => [a.id, a.how])],
    [[["city-rule-militaristic", "replaced by City Rule: Economic"]], [["the-drakes-command", "lost"]]]);
  const byHand = playing([], f => { f.party.achievements = [{ name: "Jekserah's Plans" }]; return f; });
  same("by hand: one worked out as well counts once, and is asked about",
    [held(byHand, "party").find(a => a[0] === "jekserahs-plans"), asked(byHand)],
    [["jekserahs-plans", 1, "#3"], ["Record: Jekserah's Plans is worked out from #3. Remove it from campaign.json."]]);
  const tech = scenario => playing([23], f => { f.city.globalAchievements = [{ name: "Ancient Technology", count: 2, ...scenario }]; return f; });
  same("by hand: one held more than once adds up, unless it came from the same scenario",
    [held(tech({}), "global").find(a => a[0] === "ancient-technology")[1], asked(tech({})),
     held(tech({ scenario: 23 }), "global").find(a => a[0] === "ancient-technology")[1], asked(tech({ scenario: 23 })).length],
    [3, [], 2, 1]);
  const aided = playing([25, 33], f => { f.city.globalAchievements = [{ name: "The Drake Aided" }]; return f; });
  same("by hand: The Drake Aided listed as well is asked about",
    [held(aided, "global").find(a => a[0] === "the-drake-aided"), asked(aided)],
    [["the-drake-aided", 1, "#33"], ["Record: The Drake Aided is worked out from #33. Remove it from campaign.json."]]);
}
