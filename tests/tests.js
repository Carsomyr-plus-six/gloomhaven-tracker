// The tests, the same in a browser (tests/index.html) and in Node
// (tests/run.mjs, which GitHub runs on every push). load(path) gives a file
// from the repository, parsed; loadText(path), as it is. Each test compares
// what the code works out with what it should be, as JSON; a failure shows
// both.
async function runTests(load, loadText) {
  setReference({
    scenarios: await load("data/gloomhaven-scenarios.json"),
    events: await load("data/gloomhaven-events.json"),
    items: await load("data/gloomhaven-items.json"),
    quests: await load("data/gloomhaven-quests.json"),
  });
  const results = [];
  // golden: the file under tests/golden/ the expectation comes from, which
  // node tests/run.mjs --update rewrites from what's worked out now.
  const same = (name, actual, expected, golden) =>
    results.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected, golden });
  const copy = value => JSON.parse(JSON.stringify(value));
  const written = json => formatJson(json) + "\n";

  // The reference data is pinned: every file names the same commit.
  const commits = await Promise.all(["scenarios", "events", "items", "quests"].map(async f => (await load(`data/gloomhaven-${f}.json`)).commit));
  same("reference data: every file pinned to one commit", commits.every(c => /^[0-9a-f]{40}$/.test(c || "")) && new Set(commits).size === 1, true);

  // What the page asks about each file: only what a person must settle.
  // Kaktus's progress was written "5?"; the sample has made-up achievements
  // and quest on purpose, to show these questions.
  const kaktus = `Kaktus's personal quest progress "5?" can't be read: write it as counts, like "2/15", or "1/3, then 0/1" for a quest in steps.`;
  const asked = {
    campaign: [kaktus],
    sample: [
      `The party achievement "Example party achievement" isn't in the scenario data, so no scenario or event counts it. Check it against the scenario book.`,
      `The global achievement "Example global achievement" isn't in the scenario data, so no scenario or event counts it. Check it against the scenario book.`,
      `Grunt's personal quest progress "Example quest" can't be read: write it as counts, like "2/15", or "1/3, then 0/1" for a quest in steps.`,
    ],
  };
  for (const [name, file, old] of [["campaign", "campaign.json", "tests/fixtures/campaign-v1.json"],
                                   ["sample", "examples/sample-campaign.json", "tests/fixtures/sample-v1.json"]]) {
    const json = await load(file);
    const golden = await load(`tests/golden/${name}.json`);
    // What the page works out from the file, and that it's the same twice.
    same(`${name}: what's worked out matches tests/golden/${name}.json`, campaignSnapshot(buildData(copy(json))), golden, `tests/golden/${name}.json`);
    same(`${name}: worked out twice, the same`, campaignSnapshot(buildData(copy(json))), campaignSnapshot(buildData(copy(json))));
    // The file is in the current layout: read and written back, unchanged,
    // with nothing in it that's worked out anyway.
    same(`${name}: read and written back, byte for byte`, written(toFile(fromFile(copy(json)))), await loadText(file));
    same(`${name}: asks only what must be settled by hand`, fileQuestions(json), asked[name]);
    // The same campaign in the old layout (schemaVersion 1) works out the
    // same, and moves over to exactly this file.
    const v1 = await load(old);
    same(`${name}: the old layout works out the same`, campaignSnapshot(buildData(copy(v1))), golden);
    same(`${name}: the old layout moves over to ${file}`, written(migrate(copy(v1))), await loadText(file));
  }

  // The session writer: a draft with every part of the form, applied to
  // campaign.json; the file it writes, worked out again.
  const raw = await load("campaign.json");
  const draft = await load("tests/drafts/evening.json");
  const apply = () => applyDraft(fromFile(copy(raw)), draft, buildData(copy(raw)));
  const res = apply();
  const file = toFile(res.out);
  same("evening: the written file matches tests/golden/evening.json", {
    snapshot: campaignSnapshot(buildData(copy(file))), log: res.log, warnings: res.warnings, evening: res.evening, party: res.party,
  }, await load("tests/golden/evening.json"), "tests/golden/evening.json");
  same("evening: written twice, the same file", written(toFile(apply().out)), written(file));
  same("evening: the written file reads back unchanged", written(toFile(fromFile(copy(file)))), written(file));
  same("evening: asks only what must be settled by hand", fileQuestions(file), [kaktus]);
  // Each character whose sheet changed has one entry for the evening, and
  // nothing else changed in the logs. (The amounts are checked above: the
  // sheets worked out from the logs match the golden file.)
  same("evening: one log entry an evening, for those whose sheet changed",
    file.characters.map(c => [c.name, c.log.map(e => e.date)]),
    [["Azorica", ["2026-11-20"]], ["Craig", ["2026-11-20"]], ["Flik Flak", ["2026-11-20"]], ["Kaktus", ["2026-11-20"]], ["Newbie", []]]);
  same("evening: the scenario completed is in the session, with its results",
    file.sessions.at(-1).scenarios.map(p => [p.number, p.result, (p.results || []).map(r => r.character)]),
    [[5, "success", ["Azorica", "Craig", "Flik Flak"]], [6, "failure", ["Azorica", "Craig", "Flik Flak"]]]);

  // A hand edit that keeps something the page works out is asked about.
  // (Each counts only the questions its edit adds to campaign.json's own.)
  const added = list => list.filter(q => q !== kaktus);
  const edited = copy(raw);
  edited.scenarios[0].status = "completed";
  edited.scenarios[0].name = "Black Barrow";
  edited.characters[0].xp = 149;
  edited.city.donations = 0;
  same("file: what's kept but worked out is asked about", added(fileQuestions(edited)).map(q => q.split(" ")[0]),
    ["#1's", "#1's", "Azorica's", "The"]);
  same("file: the questions go to the Campaign record, not the event decks",
    [added(buildData(copy(edited)).fileQuestions).length, buildData(copy(edited)).eventState.questions.length], [4, 0]);

  // A completion written on a scenario with no session behind it still
  // counts, is asked about, and survives being written back.
  const stray = copy(raw);
  stray.scenarios.push({ number: 7, status: "completed" });
  same("file: a completion with no session still counts, and is asked about",
    [buildData(copy(stray)).scenarios.find(s => s.number === 7).status, added(fileQuestions(stray)).length,
     toFile(fromFile(copy(stray))).scenarios.find(s => s.number === 7)],
    ["completed", 1, { number: 7, status: "completed" }]);

  // A character written in by hand, with totals and no start: the totals
  // are their start, kept, and nothing to ask.
  const hand = copy(raw);
  hand.characters.push({ name: "Hand", class: "Brute", xp: 45, gold: 30, items: ["Hide Armor"], perks: [] });
  const handSheet = buildData(copy(hand)).characters.find(c => c.name === "Hand");
  same("file: a character written in with totals keeps them, as the start",
    [handSheet.xp, handSheet.gold, handSheet.items, toFile(fromFile(copy(hand))).characters.at(-1).start, added(fileQuestions(hand))],
    [45, 30, ["Hide Armor"], { xp: 45, gold: 30, checkmarks: 0, items: ["Hide Armor"], perks: [] }, []]);

  // The sessions' order is history's: a new evening goes in by its date,
  // one with no date at the end (and its scenario completed last); dates
  // listed out of order are asked about.
  const dated = date => toFile(applyDraft(fromFile(copy(raw)), { ...draft, date }, buildData(copy(raw))).out);
  same("sessions: an evening recorded later goes in by its date", dated("2026-11-01").sessions.map(s => s.date),
    [null, "2026-10-26", "2026-11-01", "2026-11-13"]);
  const undated = dated("");
  same("sessions: an evening with no date goes last, its scenario completed last",
    [undated.sessions.map(s => s.date), [...completions(undated.sessions).keys()].at(-1)], [[null, "2026-10-26", "2026-11-13", null], 5]);
  const swapped = copy(raw);
  swapped.sessions.push(swapped.sessions.splice(1, 1)[0]);
  same("sessions: listed out of date order, asked about", added(fileQuestions(swapped)).length, 1);

  // Moving an old file over: a scenario completed on a date no session has
  // gets a session of its own, in its place; a success the old file didn't
  // count stays uncounted, as a casual replay.
  const v1 = await load("tests/fixtures/campaign-v1.json");
  const later = copy(v1);
  later.scenarios.push({ number: 7, status: "completed", completed: "2026-11-01" });
  const laterFile = migrate(later);
  same("old layout: a completion on a date with no session gets its own, in place",
    [laterFile.sessions.map(s => s.date), laterFile.sessions[2].scenarios], [[null, "2026-10-26", "2026-11-01", "2026-11-13"], [{ number: 7, result: "success" }]]);
  const uncounted = copy(v1);
  uncounted.sessions[1].scenarios.push({ number: 5, result: "success" });
  const uncountedFile = migrate(uncounted);
  same("old layout: a success it didn't count stays uncounted",
    [uncountedFile.sessions[1].scenarios.at(-1), buildData(copy(uncountedFile)).scenarios.find(s => s.number === 5).status],
    [{ number: 5, result: "success", casual: true }, "available"]);

  // Perks are the class's only word for word: every one in campaign.json
  // is, and one worded otherwise is flagged, with the closest as a hint.
  same("perks: every perk in campaign.json is its class's, word for word",
    buildData(copy(raw)).characters.flatMap(c => perkCheck(c).rows.filter(r => !r.match || r.note).map(r => `${c.name}: ${r.written}`)), []);
  const loose = perkCheck({ name: "Test", class: "Tinkerer", perks: ["Add three MUDDLE cards"] }).rows[0];
  same("perks: one worded otherwise isn't taken for the class's, and is flagged",
    [loose.match, loose.note], [null, "Not on the Tinkerer sheet. Closest: Add three rolling MUDDLE cards."]);

  // The attack modifier decks, from the perks' deck changes in the class
  // data (no reading of the perks' wording): as they were before.
  same("decks: campaign.json's characters", buildData(copy(raw)).characters.map(c => {
    const rows = perkCheck(c).rows;
    return [c.name, attackDeck(rows.filter(r => r.match).flatMap(r => Array(r.count).fill(r.match)), rows.filter(r => !r.match).map(r => r.written)).cards];
  }), [
    ["Azorica", [["Null", 1], ["−2", 1], ["−1", 3], ["+0", 2], ["+1", 7], ["+2", 1], ["2×", 1]]],
    ["Craig", [["Null", 1], ["−2", 1], ["−1", 2], ["+0", 2], ["+1", 8], ["+2", 1], ["2×", 1], ["rolling EARTH", 2]]],
    ["Flik Flak", [["Null", 1], ["−1", 1], ["+0", 7], ["+1", 5], ["+2", 1], ["+3", 1], ["2×", 1], ["rolling MUDDLE", 3]]],
    ["Kaktus", [["Null", 1], ["−2", 1], ["−1", 5], ["+0", 6], ["+1", 5], ["+2", 1], ["2×", 1]]],
  ]);
  same("decks: every class perk that changes a card says how, in the data",
    Object.values(classRef.classEvents).flatMap(c => c.perks).filter(p => !p.deck && !/^Ignore negative \w+ effects$/.test(p.text)).map(p => p.text), []);

  // Names are the reference data's, letter for letter: written any other
  // way, they're a different thing, never taken for it, and asked about.
  const names = copy(raw);
  names.characters[1].start.items[0] = "minor power potion";
  names.characters[0].class = "spellweaver";
  names.city.globalAchievements = [{ name: "the merchant flees" }];
  names.characters[2].player = "Mathias";
  names.characters[3].player = "mathias";
  const namesData = buildData(copy(names));
  same("names: an item written another way isn't the item, and is asked about",
    [namesData.shop.questions.some(q => q.includes(`Write it "Minor Power Potion"`)), slotUse(namesData.characters[1], 4).used.small],
    [true, 1]);
  same("names: a class, an achievement, a player written another way, asked about", added(fileQuestions(names)).map(q => q.split(":")[0].split(".")[0]), [
    `Azorica's class "spellweaver" isn't in the class list`,
    `The global achievement "the merchant flees" isn't in the scenario data, so no scenario or event counts it`,
    `The player "Mathias" is also written "mathias"`,
  ]);
  same("names: an achievement written another way doesn't count as it",
    [achievementCounts(namesData).global.get("the-merchant-flees"), achievementCounts(namesData).global.get("the merchant flees")], [1, 1]);
  same("names: a class not in the list leaves who was there unknown",
    eventParty(namesData, classRef, { characters: ["Azorica", "Craig"] }).complete, false);

  // A City Rule replaces a City Rule, by its id.
  const rules = copy(raw);
  rules.sessions.push({ date: "2026-12-01", scenarios: [{ number: 11, result: "success" }, { number: 50, result: "success" }] });
  const rulesData = buildData(copy(rules));
  same("achievements: a new City Rule replaces the old, by id",
    [rulesData.city.globalAchievements.map(a => a.id).filter(id => id.startsWith("city-rule-")), rulesData.lostAchievements.map(a => [a.id, a.how])],
    [["city-rule-militaristic"], [["city-rule-economic", "replaced by City Rule: Militaristic"]]]);

  // Numbers are whole numbers or nothing; treasure numbers as printed.
  const sums = { ...copy(draft), scenarios: [{ ...copy(draft.scenarios[0]), results: { Azorica: { xp: "12.5" }, Craig: { xp: "12abc" }, "Flik Flak": { xp: "6" } } }] };
  same("numbers: what isn't a whole number is said, not read as one",
    [num("12abc"), num("12.5"), num(" 7 "), applyDraft(fromFile(copy(raw)), sums, buildData(copy(raw))).warnings.filter(w => w.includes("whole number"))],
    [0, 0, 7, [`"12.5" (XP) isn't a whole number: check it.`, `"12abc" (XP) isn't a whole number: check it.`]]);
  const tiles = copy(raw);
  tiles.scenarios[2].treasures = ["65a"];
  same("numbers: a treasure number that isn't one is asked about", added(fileQuestions(tiles)).length, 1);

  // Quest progress has one way of being written.
  same("quests: progress read only as written in the one way",
    [questSteps("2/15"), questSteps("1/3, then 0/1"), questSteps("1/3 + 0/1"), questSteps("1 / 3"), questSteps("5?")],
    [[[2, 15]], [[1, 3], [0, 1]], null, null, null]);

  // The milestones, from the one table, as they stand for campaign.json.
  same("milestones: campaign.json", milestoneStates(buildData(copy(raw))).map(m => [m.id, m.have, m.open, m.ready, m.shown]), [
    ["envelope-a", 0, false, false, true], ["envelope-b", 0, false, false, true], ["town-records", 0, false, false, true],
    ["sun", 2, false, false, true], ["eclipse", 0, false, false, true], ["events-plus-20", 2, false, false, false],
    ["events-minus-20", 0, false, false, false], ["drake", 0, false, false, false], ["envelope-x", 0, false, false, true],
  ]);

  return results;
}
