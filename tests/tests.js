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
  same("evening: asks only what must be settled by hand", fileQuestions(file), []);
  // Each change to a sheet is a line in the log saying what it was for,
  // dated with the evening, its gold and the item it bought on the same
  // line; what the scenarios gave isn't there (the plays say it), and no
  // change goes unexplained. (The amounts are checked above: the sheets
  // match the golden file.)
  same("evening: each change in the logs says what it was for",
    file.characters.map(c => [c.name, c.log.map(e => `${e.date} ${e.for || "unexplained"}`)]),
    [["Azorica", ["2026-11-20 event", "2026-11-20 event", "2026-11-20 sell", "2026-11-20 perk"]],
     ["Craig", ["2026-11-20 event", "2026-11-20 event", "2026-11-20 treasure", "2026-11-20 buy"]],
     ["Flik Flak", ["2026-11-20 event", "2026-11-20 event", "2026-11-20 donation", "2026-11-20 enhancement"]],
     ["Kaktus", []], ["Newbie", []]]);

  // A past treasure settled in the form: who looted it, and the item onto
  // their sheet as a treasure line, or back in the shop's supply if they've
  // since sold it. (#4's treasure 38, made open again for the test.)
  const open38 = copy(raw);
  open38.scenarios.find(s => s.number === 4).treasures = ["38", "46"];
  const azorica = open38.characters.find(c => c.name === "Azorica");
  azorica.start.items = azorica.start.items.filter(i => i !== "Ring of Skulls");
  const settle = x => toFile(applyDraft(fromFile(copy(open38)), { ...copy(draft), claims: { "#4:38": x } }, buildData(copy(open38))).out);
  const kept = settle({ character: "Kaktus" }), sold = settle({ character: "Kaktus", kept: false });
  same("claims: a past treasure settled goes to its looter, or back to the shop if sold",
    [buildData(copy(open38)).claims.map(c => `${c.item}: treasure ${c.treasure} in ${c.where}`),
     kept.characters.find(c => c.name === "Kaktus").log, kept.scenarios.find(s => s.number === 4).treasures[0],
     sold.characters.find(c => c.name === "Kaktus").log, buildData(copy(sold)).city.returnedItems, buildData(copy(kept)).claims.length],
    [["Ring of Skulls: treasure 38 in #4"], [{ date: "2026-11-20", for: "treasure", treasure: "38", gained: ["Ring of Skulls"] }], "38",
     [{ date: "2026-11-20", for: "treasure", treasure: "38", gained: ["Ring of Skulls"], lost: ["Ring of Skulls"] }],
     ["Minor Power Potion", "Ring of Skulls"], 0]);   // (and the evening's potion sold; the shop counts only what it doesn't otherwise sell)

  // Who looted a treasure is said once: by the line for it in their log, or,
  // with no line (looted before the logs, or a tile that changed no sheet),
  // on the scenario's treasure. Said both ways and differently, it's asked about.
  const treasureSays = file => buildData(copy(file)).treasureInfo.get(4);
  const disagree = copy(kept);
  disagree.scenarios.find(s => s.number === 4).treasures[0] = { number: "38", character: "Craig" };
  same("treasure: who looted it is said once, by the log or else the scenario",
    [treasureSays(kept)[0], treasureSays(raw)[0], raw.scenarios.find(s => s.number === 4).treasures[0],
     fileQuestions(disagree).filter(q => q.includes("treasure 38"))],
    ["38: Ring of Skulls, to Kaktus", "38: Ring of Skulls, to Azorica", { number: "38", character: "Azorica" },
     ["#4's treasure 38 says Craig looted it, but the line for it is in Kaktus's log. Correct whichever is wrong."]]);

  // The shop's supply of items it doesn't otherwise sell is worked out from
  // the logs: a sale puts a copy back, buying it takes it out, retiring
  // returns everything carried; the file keeps no list of its own.
  const evening = (file, extra) => toFile(applyDraft(fromFile(copy(file)), { ...copy(draft), scenarios: [], events: [], buys: [], sells: [], perks: [],
    donations: [], enhancements: [], claims: {}, quests: {}, newCharacters: [], retirements: [], ...extra }, buildData(copy(file))).out);
  const ringLeft = file => buildData(copy(file)).shop.stock.find(i => i.name === "Ring of Skulls")?.left ?? 0;
  const ringSold = evening(raw, { sells: [{ character: "Azorica", item: "Ring of Skulls" }] });
  const ringBought = evening(ringSold, { date: "2026-11-27", buys: [{ character: "Craig", item: "Ring of Skulls" }] });
  const azoricaRetires = evening(raw, { retirements: [{ character: "Azorica", unlocks: "envelope-x" }] });
  same("shop: a copy sold comes back, bought back goes, and a retiree's items return",
    [ringLeft(raw), ringLeft(ringSold), ringLeft(ringBought), ringLeft(azoricaRetires),
     buildData(copy(ringBought)).characters.find(c => c.name === "Craig").items.includes("Ring of Skulls"),
     ["returnedItems" in ringSold.city, "returnedItems" in ringBought.city]],
    [0, 1, 0, 1, true, [false, false]]);
  // Two Bless cards from a donation wait for the donor's next scenario: that
  // evening's, unless the donation was made after it; worked out from the
  // donation line and the plays since, so the file keeps no flag. A flag
  // with no donation line (before the logs) stands; one the log contradicts
  // is asked about.
  const blessOf = (file, name) => Boolean(buildData(copy(file)).characters.find(c => c.name === name).blessNext);
  const town = evening(raw, { donations: [{ character: "Azorica" }] });   // a visit to town, no scenario
  const next = evening(town, { date: "2026-11-27", party: ["Azorica", "Craig", "Flik Flak"],
    scenarios: [{ number: "6", level: "2", result: "failure", treasures: [], results: { Azorica: { xp: "1" }, Craig: { xp: "1" }, "Flik Flak": { xp: "1" } } }] });
  const afterIt = evening(raw, { donations: [{ character: "Azorica", when: "after" }],
    scenarios: [{ number: "6", level: "2", result: "failure", treasures: [], results: { Azorica: { xp: "1" }, Craig: { xp: "1" }, "Flik Flak": { xp: "1" } } }] });
  const flagged = copy(raw);
  flagged.characters.find(c => c.name === "Kaktus").blessNext = true;
  const stale = copy(next);
  stale.characters.find(c => c.name === "Azorica").blessNext = true;
  same("bless: waits for the donor's next scenario, worked out from the log",
    [blessOf(file, "Flik Flak"), blessOf(town, "Azorica"), "blessNext" in town.characters.find(c => c.name === "Azorica"), blessOf(next, "Azorica"),
     afterIt.characters.find(c => c.name === "Azorica").log.find(e => e.for === "donation"), blessOf(afterIt, "Azorica"),
     blessOf(flagged, "Kaktus"), fileQuestions(stale).filter(q => q.includes("blessNext")).length],
    [false, true, false, false, { date: "2026-11-20", for: "donation", after: true, gold: -10 }, true, true, 1]);
  // Town rules the form checks: a donation once per character per visit (one
  // before tonight's scenario and one after are two visits); a retiree's
  // Bless cards are theirs, so a donation with no scenario after it goes
  // unused (errata); a class's enhanced cards are at most the prosperity level.
  const warnsOf = extra => applyDraft(fromFile(copy(raw)), { ...copy(draft), scenarios: [], events: [], buys: [], sells: [], perks: [],
    donations: [], enhancements: [], claims: {}, quests: {}, newCharacters: [], retirements: [], ...extra }, buildData(copy(raw))).warnings;
  const scenario6 = [{ number: "6", level: "2", result: "failure", treasures: [], results: { Azorica: { xp: "1" }, Craig: { xp: "1" }, "Flik Flak": { xp: "1" } } }];
  const says = (warns, text) => warns.some(w => w.includes(text));
  const prosperity = stepFor(buildData(copy(raw)).city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const enhance = n => Array.from({ length: n }, () => ({ character: "Azorica", what: "Move", cost: "0" }));
  same("town: donating once per visit, a retiree's blessings, the enhancement limit",
    [says(warnsOf({ donations: [{ character: "Azorica" }, { character: "Azorica" }] }), "twice in one visit"),
     says(warnsOf({ scenarios: scenario6, donations: [{ character: "Azorica" }, { character: "Azorica", when: "after" }] }), "twice in one visit"),
     says(warnsOf({ donations: [{ character: "Azorica" }], retirements: [{ character: "Azorica", unlocks: "envelope-x" }] }), "go unused"),
     says(warnsOf({ scenarios: scenario6, donations: [{ character: "Azorica" }], retirements: [{ character: "Azorica", unlocks: "envelope-x" }] }), "go unused"),
     says(warnsOf({ enhancements: enhance(prosperity) }), "can be enhanced"),
     says(warnsOf({ enhancements: enhance(prosperity + 1) }), "can be enhanced")],
    [true, false, true, false, false, true]);
  // Who passed a level at a session is worked out from XP over time, as the
  // evening's summary says it; the file stores none. A list written in on a
  // session whose plays have no level (the record can't tell) stands; one
  // the XP contradicts is asked about.
  const fileUps = copy(file);
  fileUps.sessions.at(-1).levelUps = [{ character: "Craig", level: 5 }];
  const handUps = copy(raw);
  handUps.sessions.find(s => s.date === "2026-11-13").levelUps = [{ character: "Craig", level: 4 }];
  same("sessions: who passed a level is worked out from XP, as the summary says",
    [file.sessions.at(-1).levelUps ?? null, buildData(copy(file)).sessions.at(-1).levelUps, res.log.filter(l => l.includes("reaches level")),
     fileQuestions(fileUps).filter(q => q.includes("passed a level")).length,
     [buildData(copy(handUps)).sessions.find(s => s.date === "2026-11-13").levelUps, fileQuestions(handUps).filter(q => q.includes("passed a level")).length,
      toFile(fromFile(copy(handUps))).sessions.find(s => s.date === "2026-11-13").levelUps]],
    [null, [{ character: "Azorica", level: 4 }], ["Azorica reaches level 4: add an ability card of level 4 or lower, and take a perk"], 1,
     [[{ character: "Craig", level: 4 }], 0, [{ character: "Craig", level: 4 }]]]);
  // Who was at a session is said once: by its plays' results, which name
  // everyone there; "characters" only where a play has none. Both, naming
  // different people, is asked about.
  const nov13 = raw.sessions.find(s => s.date === "2026-11-13");
  const odd = copy(raw);
  odd.sessions.find(s => s.date === "2026-11-13").characters = ["Azorica", "Craig", "Kaktus"];
  same("sessions: who was there is said once, by the results",
    ["characters" in nov13, buildData(copy(raw)).sessions.find(s => s.date === "2026-11-13").characters,
     raw.sessions.find(s => s.title === "Early sessions").characters ?? null,
     fileQuestions(odd).filter(q => q.startsWith("The session of 2026-11-13")).length,
     toFile(fromFile(copy(odd))).sessions.find(s => s.date === "2026-11-13").characters],
    [false, ["Azorica", "Craig", "Flik Flak"], null, 1, ["Azorica", "Craig", "Kaktus"]]);
  // Retiring is said once: the retirement line in the log, which the page
  // reads retired and retiredOn from, written even with nothing to hand
  // back; on the character only for one who retired before the logs. Both,
  // and differing, is asked about.
  const broke = copy(raw);
  Object.assign(broke.characters.find(c => c.name === "Kaktus").start, { gold: 0, items: [] });
  const kaktusRetires = evening(broke, { retirements: [{ character: "Kaktus", unlocks: "envelope-x" }] });
  const kaktusFile = kaktusRetires.characters.find(c => c.name === "Kaktus");
  const kaktusSheet = buildData(copy(kaktusRetires)).characters.find(c => c.name === "Kaktus");
  const preLog = copy(raw);
  Object.assign(preLog.characters.find(c => c.name === "Kaktus"), { retired: true, retiredOn: "2026-09-01" });
  const contradicts = copy(kaktusRetires);
  Object.assign(contradicts.characters.find(c => c.name === "Kaktus"), { retired: false, retiredOn: "2026-11-01" });
  same("retiring: said once, by the retirement line, read from the log",
    [kaktusFile.log, ["retired" in kaktusFile, "retiredOn" in kaktusFile], [kaktusSheet.retired, kaktusSheet.retiredOn],
     (({ retired, retiredOn }) => [retired, retiredOn])(toFile(fromFile(copy(preLog))).characters.find(c => c.name === "Kaktus")),
     fileQuestions(contradicts).filter(q => q.startsWith("Kaktus")).length],
    [[{ date: "2026-11-20", for: "retirement" }], [false, false], [true, "2026-11-20"], [true, "2026-09-01"], 2]);
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
  // A treasure item the looter already has is sold at once: a treasure line
  // with the item gained and lost, its gold, and the copy back in the shop.
  // Treasure 62 gives Helm of the Mountain and Mountain Hammer; Azorica is
  // given a Mountain Hammer first, so the tile's copy is sold at once.
  const hasHammer = copy(raw);
  hasHammer.scenarios.push({ number: 82 });
  hasHammer.characters.find(c => c.name === "Azorica").start.items.push(itemName(115));
  const soldAtOnce = toFile(applyDraft(fromFile(copy(hasHammer)), { ...copy(draft), scenarios: [{ number: "82", level: "2", result: "failure",
      treasures: [{ number: "62", character: "Azorica" }], results: { Azorica: { xp: "1" }, Craig: { xp: "1" }, "Flik Flak": { xp: "1" } } }],
    events: [], buys: [], sells: [], perks: [], donations: [], enhancements: [], quests: {}, newCharacters: [], claims: {} }, buildData(copy(hasHammer))).out);
  const hammerLine = soldAtOnce.characters.find(c => c.name === "Azorica").log.at(-1);
  same("shop: a treasure item the looter already has is sold at once, and goes back to the shop",
    [hammerLine, buildData(copy(soldAtOnce)).characters.find(c => c.name === "Azorica").items.filter(i => i === itemName(115)).length,
     buildData(copy(soldAtOnce)).city.returnedItems, written(toFile(fromFile(copy(soldAtOnce)))) === written(soldAtOnce)],
    [{ date: "2026-11-20", for: "treasure", treasure: "62", gold: Math.floor(itemsRef.items["115"].cost / 2), gained: [itemName(110), itemName(115)], lost: [itemName(115)] },
     1, [itemName(115)], true]);
  // A copy bought back from the supply is carried legitimately, whatever it
  // came from: an item from an event, written in by hand, sold and bought back.
  const fromEvent = copy(raw);
  fromEvent.characters.find(c => c.name === "Azorica").start.items.push("Necklace of Teeth");
  const necklaceSold = evening(fromEvent, { sells: [{ character: "Azorica", item: "Necklace of Teeth" }] });
  const necklaceBought = evening(necklaceSold, { date: "2026-11-27", buys: [{ character: "Craig", item: "Necklace of Teeth" }] });
  same("shop: a copy bought back from the supply is carried without a question",
    [buildData(copy(necklaceBought)).characters.find(c => c.name === "Craig").items.includes("Necklace of Teeth"),
     buildData(copy(necklaceBought)).shop.questions.filter(q => q.includes("Necklace"))],
    [true, []]);
  same("evening: a purchase is one line, its gold and its item",
    file.characters.find(c => c.name === "Craig").log.find(e => e.for === "buy"),
    { date: "2026-11-20", for: "buy", gold: -10, gained: ["Iron Helmet"] });
  // A play keeps what was played (the dial, the coins); what it gave is
  // worked out from its level.
  const won = file.sessions.at(-1).scenarios[0];
  same("evening: a play keeps the dial and coins, and gives the bonus and a coin's worth at its level",
    [won.results[0], plays(buildData(copy(file))).find(p => p.number === 5).results[0]],
    [{ character: "Azorica", xp: 8, coins: 2, checkmarks: 1 },
     { character: "Azorica", xp: 8 + scenarioStats(2).xp, coins: 2, checkmarks: 1, gold: 2 * scenarioStats(2).gold }]);

  // The changes the evening above doesn't make: a reward item, an event
  // that costs gold, advancing to the prosperity level, and retiring. Each
  // is a line saying what it was for, with nothing left unexplained.
  const more = copy(raw);
  more.scenarios.push({ number: 68 });   // Toxic Moor, open for the test: two Major Healing Potions as its reward
  more.adjustments = [{ prosperity: 30, notes: "Made up for the test" }];
  const moreDraft = { ...copy(draft), scenarios: [{ number: "68", level: "2", result: "success", treasures: [], rewardTakers: ["Azorica", "Craig"],
      results: { Azorica: { xp: "5" }, Craig: { xp: "5", coins: "2" }, "Flik Flak": { xp: "5" } } }],
    events: [{ deck: "road", number: "8", option: "A", scenario: "", paid: "" }],
    buys: [], sells: [], perks: [], donations: [], enhancements: [], claims: {}, quests: {}, newCharacters: [],
    advances: ["Kaktus"], retirements: [{ character: "Craig", unlocks: "envelope-x" }] };
  const moreRes = applyDraft(fromFile(copy(more)), moreDraft, buildData(copy(more)));
  const moreFile = toFile(moreRes.out);
  const lines = name => moreFile.characters.find(c => c.name === name).log.map(e => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "date")));
  const craigBefore = buildData(copy(more)).characters.find(c => c.name === "Craig").gold;
  same("evening: a reward item, an event's cost, advancing and retiring are each a line saying what for",
    [lines("Azorica"), lines("Craig"), lines("Kaktus").map(e => e.for), buildData(copy(moreFile)).characters.find(c => c.name === "Craig").gold,
     written(toFile(fromFile(copy(moreFile))))],
    [[{ for: "event", deck: "road", card: 8, option: "A", gold: -5 }, { for: "reward", scenario: 68, gained: ["Major Healing Potion"] }],
     [{ for: "event", deck: "road", card: 8, option: "A", gold: -5 }, { for: "reward", scenario: 68, gained: ["Major Healing Potion"] },
      { for: "retirement", gold: -(craigBefore - 5 + 2 * scenarioStats(2).gold),
        lost: [...buildData(copy(more)).characters.find(c => c.name === "Craig").items, "Major Healing Potion"] }],
     ["advance"], 0, written(moreFile)]);

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
  same("names: a class, an achievement, a player written another way, asked about", fileQuestions(names).map(q => q.split(":")[0].split(".")[0]), [
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
  same("numbers: a treasure number that isn't one is asked about", fileQuestions(tiles).length, 1);

  // A treasure with two items ("item:110+115", treasure 62) gives both, each
  // by its name, onto the looter's sheet.
  const twoItems = copy(raw);
  twoItems.scenarios.push({ number: 82 });   // Burning Mountain, open for the test: treasure 62 is on its map
  const lootDraft = { ...copy(draft), scenarios: [{ number: "82", level: "3", result: "failure", treasures: [{ number: "62", character: "Azorica" }],
      results: { Azorica: { xp: "5" }, Craig: { xp: "5" }, "Flik Flak": { xp: "5" } } }],
    events: [], buys: [], sells: [], perks: [], donations: [], enhancements: [], claims: {}, quests: {}, newCharacters: [] };
  const looted = toFile(applyDraft(fromFile(copy(twoItems)), lootDraft, buildData(copy(twoItems))).out);
  same("treasure: a tile with two items gives both, by name",
    [treasureParts(scenarioRef, 62).map(describeTreasurePart), looted.characters.find(c => c.name === "Azorica").log.at(-1), fileQuestions(looted)],
    [[itemName(110), itemName(115)], { date: "2026-11-20", for: "treasure", treasure: "62", gained: [itemName(110), itemName(115)] }, []]);

  // Every quest card, for every character in campaign.json and the sample,
  // as the page counts it from the record (which card a character holds is
  // kept on their phone, so each is tried). Progress is left out, so nothing
  // here ties a character to a card.
  const questCase = p => ({
    steps: p.steps.map(x => [`${x.n ?? "?"}/${x.count}`, x.auto ? null : "by hand", x.after ? "after the one before" : null,
      x.maybe.length ? `maybe ${x.maybe.map(n => `#${n}`).join(" ")}` : null, x.extra ? `up to ${x.extra} more` : null,
      x.opens ? `opens #${x.opens}` : null].filter(Boolean).join(", ")),
    text: p.text,
  });
  const questTable = {}, unwritten = [];
  for (const [name, file] of [["campaign", "campaign.json"], ["sample", "examples/sample-campaign.json"]]) {
    const json = copy(await load(file));
    for (const c of json.characters) c.personalQuest = "";
    const data = buildData(json);
    for (const [id, q] of Object.entries(questRef.quests)) {
      for (const c of data.characters) {
        const p = questProgress(data, c, id);
        (questTable[name] ||= {})[`${id} ${q.name}`] ||= {};
        questTable[name][`${id} ${q.name}`][c.name] = questCase(p);
        // What the page offers to record, it can read back, and it fits.
        if (p.text && !(questSteps(p.text)?.length === p.steps.length && p.fits(p.text))) unwritten.push(`${id} for ${c.name}: ${p.text}`);
      }
    }
  }
  // And by hand: for each card, a made-up character (so no real one is tied
  // to it) with nothing the record can count, and 1 written for every step,
  // joined as on the card; then the same joined the other way.
  {
    const data = buildData(copy(raw));
    const test = { ...data.characters[0], name: "Test", items: [], gold: 0, checkmarks: 0, donated: 0, enhanced: 0 };
    for (const [id, q] of Object.entries(questRef.quests)) {
      const own = q.steps.map((x, i) => `${i ? (x.after ? ", then " : " + ") : ""}${Math.min(1, x.count)}/${x.count}`).join("");
      const other = own.replace(/, then | \+ /g, j => j === " + " ? ", then " : " + ");
      const p = questProgress(data, { ...test, personalQuest: own }, id);
      // And what the page offers to set for each step: a count it gives, a
      // check box, or − and + (from, to, and where it stands).
      const inputs = questInputs(p, own);
      (questTable.byHand ||= {})[`${id} ${q.name}`] = { written: own, ...questCase(p), fits: p.fits(own),
        ...(q.steps.length > 1 ? { joinedOtherwise: other, fitsJoinedOtherwise: p.fits(other) } : {}),
        inputs: inputs.steps.map(x => `${x.kind}, ${x.min} to ${x.max}, at ${x.value}`), inputsWrite: inputs.text };
    }
  }

  // The inputs, set: a tap writes the progress, within what each step allows.
  {
    const json = copy(raw);
    json.characters.push({ name: "Test", class: "Brute", start: { xp: 0, gold: 0, checkmarks: 0, items: [], perks: [] }, log: [], personalQuest: "" });
    json.sessions.push({ date: "2026-11-21", characters: ["Test"], scenarios: [{ number: 4, result: "success", casual: true }] });
    const data = buildData(json);
    const test = data.characters.find(c => c.name === "Test");
    const on = (card, written) => questInputs(questProgress(data, { ...test, personalQuest: written }, card), written);
    const seeker = on("510", "");
    const slayer = on("523", "1/1 + 0/1 + 0/1 + 0/1 + 0/1 + 0/1");
    const stand = on("517", "5/20");
    same("quests: the inputs, set with a tap", [
      seeker.steps.map(x => [x.kind, x.value]), seeker.text,
      slayer.steps.map(x => x.kind), questSet(slayer, 2, 1),
      questSet(stand, 0, 6), questSet(stand, 0, 21), questSet(stand, 0, -1),
    ], [
      [["fixed", 1], ["fixed", 0]], "1/3, then 0/1",
      ["check", "check", "check", "check", "check", "check"], "1/1 + 0/1 + 1/1 + 0/1 + 0/1 + 0/1",
      "6/20", "20/20", "0/20",
    ]);
    // Without the card: the steps the record has, a step after ", then"
    // waiting until the one before is done; nothing, with no steps written.
    const shape = written => questInputs(null, written)?.steps.map(x => `${x.kind}, ${x.min} to ${x.max}, at ${x.value}`) ?? null;
    same("quests: without the card, the inputs the record's steps give",
      [shape("2/15"), shape("1/3, then 0/1"), shape("3/3, then 0/1"), shape("1/2 + 0/1"), shape(""), shape("5?")],
      [["count, 0 to 15, at 2"], ["count, 0 to 3, at 1", "fixed, 0 to 0, at 0"], ["count, 0 to 3, at 3", "check, 0 to 1, at 0"],
       ["count, 0 to 2, at 1", "check, 0 to 1, at 0"], null, null]);
  }
  same("quests: every card, counted from the record, matches tests/golden/quests.json", questTable,
    await load("tests/golden/quests.json").catch(() => null), "tests/golden/quests.json");
  same("quests: the count the page offers to record reads back, and fits", unwritten, []);

  // Steps the record can't count take the count written by hand, when it's
  // written in the card's steps and joins; joined otherwise, it doesn't fit.
  {
    const data = buildData(copy(raw));
    const c = { ...data.characters[0], name: "Test", personalQuest: "7/20" };
    const stand = questProgress(data, c, "517");
    const merchant = questProgress(data, { ...c, personalQuest: "" }, "511");
    const seeker = questProgress(data, { ...c, personalQuest: "" }, "510");
    same("quests: a count by hand, and steps joined as on the card",
      [stand.steps[0].n, stand.fits("7/20"), stand.fits("8/20"), merchant.text.includes(", then "),
       merchant.fits(merchant.text), merchant.fits(merchant.text.replaceAll(" + ", ", then ")), seeker.fits("0/3 + 0/1"), seeker.fits("0/3, then 0/1")],
      [7, true, false, false, true, false, false, true]);
  }

  // Who completed a scenario: those its results or players name, or with
  // neither, who was at the session it was won in.
  {
    const json = copy(raw);
    json.sessions.push({ date: "2026-11-21", characters: ["Azorica", "Craig", "Flik Flak", "Kaktus"], scenarios: [
      { number: 5, result: "success", results: [{ character: "Azorica", xp: 8, gold: 4 }] },
      { number: 6, result: "success", casual: true, players: ["Craig", "Kaktus"] },
      { number: 7, result: "success" },
      { number: 9, result: "success", results: [{ character: "Flik Flak", xp: 8, gold: 4 }], players: ["Flik Flak", "Kaktus"] },
    ] });
    const by = completedBy(buildData(json));
    same("quests: who completed a scenario, by results and players, else the session",
      [5, 6, 7, 9].map(n => [...by.get(n)]), [["Azorica"], ["Craig", "Kaktus"], ["Azorica", "Craig", "Flik Flak", "Kaktus"], ["Flik Flak", "Kaktus"]]);
  }

  // What a quest card opens decides a retirement's unlock: a class box by its
  // id, or Envelope X; a retirement with nothing to open is pointed out. A
  // made-up character retires, so nothing here ties a real one to a card.
  {
    const json = copy(raw);
    json.characters.push({ name: "Test", class: "Brute", start: { xp: 0, gold: 0, checkmarks: 0, items: [], perks: [] }, log: [], personalQuest: "" });
    const retire = unlocks => applyDraft(fromFile(copy(json)), { ...copy(draft), retirements: [{ character: "Test", unlocks }] }, buildData(copy(json)));
    const none = retire("");
    const sun = retire(questUnlocks("515"));
    same("quests: a card opens what its data says, and a retirement opens it",
      [questUnlocks("515"), questUnlocks("513"), questUnlocks("999"),
       none.warnings.filter(w => w.includes("nothing says what their personal quest opens")).length,
       (sun.out.city.unlockedClasses || []).map(u => u.name ?? u).includes(className(classRef, "sun"))],
      ["sun", "envelope-x", "", 1, true]);
  }

  // The form records only progress it can read.
  {
    const res = applyDraft(fromFile(copy(raw)), { ...copy(draft), quests: { Craig: "3/4?", "Flik Flak": "1/3 + 1/1" } }, buildData(copy(raw)));
    same("quests: the form records only progress it can read, and says so",
      [res.out.characters.map(c => c.personalQuest), res.warnings.filter(w => w.includes("personal quest progress")).length],
      [["2/15", "2/4", "1/3 + 1/1", "5/20", ""], 1]);
  }

  // A step that waits on another waits on the one just before it, in every
  // card: the page joins it to that one with ", then".
  same("quests: every step that waits, waits on the one before",
    Object.entries(questRef.quests).flatMap(([id, q]) => q.steps.map((x, i) => [x, i]).filter(([x, i]) => x.after && !(x.after.length === 1 && x.after[0] === i)).map(([, i]) => `${id} step ${i + 1}`)), []);

  // Quest progress is written in counts, joined in one of two ways.
  same("quests: progress read only as written in the ways it can be",
    [questSteps("2/15"), questSteps("1/3, then 0/1"), questSteps("2/2 + 1/2"), questSteps("1/3 & 0/1"), questSteps("1/3,then 0/1"), questSteps("1 / 3"), questSteps("5?")],
    [[[2, 15]], [[1, 3], [0, 1]], [[2, 2], [1, 2]], null, null, null, null]);
  same("quests: the joins, as written", questParts("1/2 + 0/2, then 0/1")?.joins, [" + ", ", then "]);

  // The milestones, from the one table, as they stand for campaign.json.
  same("milestones: campaign.json", milestoneStates(buildData(copy(raw))).map(m => [m.id, m.have, m.open, m.ready, m.shown]), [
    ["envelope-a", 0, false, false, true], ["envelope-b", 0, false, false, true], ["town-records", 0, false, false, true],
    ["sun", 2, false, false, true], ["eclipse", 0, false, false, true], ["events-plus-20", 2, false, false, false],
    ["events-minus-20", 0, false, false, false], ["drake", 0, false, false, false], ["envelope-x", 0, false, false, true],
  ]);
  // Reputation milestones count the highest and lowest reached, and say so
  // where reputation now stands elsewhere.
  same("milestones: reputation, as reached and as it stands",
    milestoneStates(buildData(copy(raw))).filter(m => ["sun", "eclipse"].includes(m.id)).map(m => m.says),
    ["+2 of +10 reputation", "0 of −10 reputation: the lowest so far, now +2"]);

  return results;
}
