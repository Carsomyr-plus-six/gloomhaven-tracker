// Tests of campaign/file.js: the reference data, each campaign file read,
// worked out and written back (and its old layout moved over), the
// questions a file raises, sessions placed by date, names written another
// way, and the built data.
async function fileTests({ load, loadText, same, copy, written, raw, draft, file, ringSold }) {
  // The reference data is pinned: every file names the same commit.
  const commits = await Promise.all(["scenarios", "events", "items", "quests"].map(async f => (await load(`data/gloomhaven-${f}.json`)).commit));
  same("reference data: every file pinned to one commit", commits.every(c => /^[0-9a-f]{40}$/.test(c || "")) && new Set(commits).size === 1, true);

  // What the page asks about each file: only what a person must settle.
  // The sample has made-up achievements and quest on purpose, to show these
  // questions; campaign.json has nothing to settle.
  const asked = {
    campaign: [],
    sample: [
      `The party achievement "Example party achievement" isn't in the scenario data, so no scenario or event counts it. Check it against the scenario book.`,
      `The global achievement "Example global achievement" isn't in the scenario data, so no scenario or event counts it. Check it against the scenario book.`,
      `Grunt's personal quest progress "Example quest" can't be read: write it as counts, like "2/15", "1/3, then 0/1" for steps in order, or "2/2 + 1/2" for steps side by side.`,
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

  // The built data keeps party and city as the file has them; what's
  // worked out has its own names. A reputation or prosperity the file kept
  // by hand is asked about when it disagrees with the sums, then dropped.
  const asFiled = withDefaults(fromFile(copy(raw)));
  const built = buildData(copy(raw));
  const keptByHand = copy(raw);
  keptByHand.party.reputation = 99;
  keptByHand.city.prosperityCheckmarks = 1;
  const handBuilt = buildData(copy(keptByHand));
  same("built data: party and city as the file has them; a number kept by hand asked about, then dropped",
    [built.party, built.city, typeof built.reputation, typeof built.prosperityCheckmarks,
     handBuilt.eventState.questions.filter(q => q.startsWith("Ledger:")).map(q => q.split(",")[0]),
     ["reputation" in handBuilt.party, "prosperityCheckmarks" in handBuilt.city, handBuilt.reputation]],
    [asFiled.party, asFiled.city, "number", "number",
     ["Ledger: reputation in campaign.json says 99", "Ledger: prosperity checkmarks in campaign.json says 1"],
     [false, false, built.reputation]]);
  // A list in an older file (schemaVersion 3 and before, kept by hand or
  // written by the form): what the logs account for is left to them, the
  // rest joins the city's start. In a current file the list is worked out,
  // so one written in is asked about, and changes nothing.
  const listed = { ...copy(ringSold), schemaVersion: 3 };
  listed.city.start = { returnedItems: ["Winged Shoes"] };
  listed.city.returnedItems = ["Ring of Skulls", "Boots of Speed"];
  const current = { ...copy(ringSold), city: { ...ringSold.city, returnedItems: ["Boots of Speed"] } };
  same("shop: an older file's list of returned items joins the city's start, less what the logs say; a current file's is asked about",
    [toFile(fromFile(copy(listed))).city.start, buildData(copy(listed)).city.returnedItems,
     fileQuestions(current).filter(q => q.includes("returnedItems")).length, buildData(copy(current)).city.returnedItems],
    [{ returnedItems: ["Winged Shoes", "Boots of Speed"] }, ["Winged Shoes", "Boots of Speed", "Ring of Skulls"], 1, ["Ring of Skulls"]]);

  // A schemaVersion 2 file (each evening one sum on the sheet, a play's XP
  // with its bonus) moves over with the same totals: the sums go into the
  // start, less what the plays gave, and the log keeps its items.
  const v2 = { schemaVersion: 2, party: {}, city: {}, scenarios: [],
    sessions: [{ date: "2026-01-01", scenarios: [{ number: 1, level: 1, result: "success", results: [{ character: "Old", xp: 11, gold: 6 }] }], characters: ["Old"] }],
    characters: [{ name: "Old", class: "Brute", start: { xp: 10, gold: 20, checkmarks: 0, items: [], perks: [] },
      log: [{ date: "2026-01-01", xp: 13, gold: 9, donated: 10, gained: ["Hide Armor"] }] }] };
  const v2Sheet = buildData(copy(v2)).characters[0];
  const v2File = migrate(copy(v2));
  same("file: a schemaVersion 2 file moves over with the same totals",
    [[v2Sheet.xp, v2Sheet.gold, v2Sheet.donated, v2Sheet.items], v2File.characters[0].start, v2File.characters[0].log,
     v2File.sessions[0].scenarios[0].results, (({ xp, gold, donated }) => [xp, gold, donated])(buildData(copy(v2File)).characters[0])],
    [[23, 29, 10, ["Hide Armor"]], { xp: 12, gold: 23, checkmarks: 0, items: [], perks: [], donated: 10 }, [{ date: "2026-01-01", gained: ["Hide Armor"] }],
     [{ character: "Old", xp: 11 - scenarioStats(1).xp, gold: 6 }], [23, 29, 10]]);

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
    [null, "2026-10-07", "2026-10-26", "2026-11-01", "2026-11-13"]);
  const undated = dated("");
  same("sessions: an evening with no date goes last, its scenario completed last",
    [undated.sessions.map(s => s.date), [...completions(undated.sessions).keys()].at(-1)], [[null, "2026-10-07", "2026-10-26", "2026-11-13", null], 5]);
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
    [laterFile.sessions.map(s => s.date), laterFile.sessions[3].scenarios], [[null, "2026-10-07", "2026-10-26", "2026-11-01", "2026-11-13"], [{ number: 7, result: "success" }]]);
  const uncounted = copy(v1);
  uncounted.sessions[1].scenarios.push({ number: 5, result: "success" });
  const uncountedFile = migrate(uncounted);
  same("old layout: a success it didn't count stays uncounted",
    [uncountedFile.sessions[1].scenarios.at(-1), buildData(copy(uncountedFile)).scenarios.find(s => s.number === 5).status],
    [{ number: 5, result: "success", casual: true }, "available"]);

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
  same("names: a class, an achievement, a player written another way, asked about", fileQuestions(names).map(q => q.split(":")[0].split(".")[0]), [
    `Azorica's class "spellweaver" isn't in the class list`,
    `The global achievement "the merchant flees" isn't in the scenario data, so no scenario or event counts it`,
    `The player "Mathias" is also written "mathias"`,
  ]);
  same("names: an achievement written another way doesn't count as it",
    [achievementCounts(namesData).global.get("the-merchant-flees"), achievementCounts(namesData).global.get("the merchant flees")], [1, 1]);
  same("names: a class not in the list leaves who was there unknown",
    eventParty(namesData, { characters: ["Azorica", "Craig"] }).complete, false);
}
