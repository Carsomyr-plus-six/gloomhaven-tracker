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
    same(`${name}: nothing kept that's worked out`, fileQuestions(json), []);
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
  same("evening: nothing kept that's worked out", fileQuestions(file), []);
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
  const edited = copy(raw);
  edited.scenarios[0].status = "completed";
  edited.scenarios[0].name = "Black Barrow";
  edited.characters[0].xp = 149;
  edited.city.donations = 0;
  same("file: what's kept but worked out is asked about", fileQuestions(edited).map(q => q.split(" ")[0]),
    ["#1's", "#1's", "Azorica's", "The"]);
  same("file: the questions go to the Campaign record, not the event decks",
    [buildData(copy(edited)).fileQuestions.length, buildData(copy(edited)).eventState.questions.length], [4, 0]);

  // A completion written on a scenario with no session behind it still
  // counts, is asked about, and survives being written back.
  const stray = copy(raw);
  stray.scenarios.push({ number: 7, status: "completed" });
  same("file: a completion with no session still counts, and is asked about",
    [buildData(copy(stray)).scenarios.find(s => s.number === 7).status, fileQuestions(stray).length,
     toFile(fromFile(copy(stray))).scenarios.find(s => s.number === 7)],
    ["completed", 1, { number: 7, status: "completed" }]);

  // A character written in by hand, with totals and no start: the totals
  // are their start, kept, and nothing to ask.
  const hand = copy(raw);
  hand.characters.push({ name: "Hand", class: "Brute", xp: 45, gold: 30, items: ["Hide Armor"], perks: [] });
  const handSheet = buildData(copy(hand)).characters.find(c => c.name === "Hand");
  same("file: a character written in with totals keeps them, as the start",
    [handSheet.xp, handSheet.gold, handSheet.items, toFile(fromFile(copy(hand))).characters.at(-1).start, fileQuestions(hand)],
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
  same("sessions: listed out of date order, asked about", fileQuestions(swapped).length, 1);

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

  // The milestones, from the one table, as they stand for campaign.json.
  same("milestones: campaign.json", milestoneStates(buildData(copy(raw))).map(m => [m.id, m.have, m.open, m.ready, m.shown]), [
    ["envelope-a", 0, false, false, true], ["envelope-b", 0, false, false, true], ["town-records", 0, false, false, true],
    ["sun", 2, false, false, true], ["eclipse", 0, false, false, true], ["events-plus-20", 2, false, false, false],
    ["events-minus-20", 0, false, false, false], ["drake", 0, false, false, false], ["envelope-x", 0, false, false, true],
  ]);

  return results;
}
