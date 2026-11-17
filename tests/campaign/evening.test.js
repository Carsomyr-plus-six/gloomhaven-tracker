// Tests of campaign/evening.js: a draft applied to campaign.json, and the
// file it writes: the test evening, claims, the shop, the Sanctuary,
// retiring, enhancements, a scenario's level, rewards and treasure.
async function eveningTests({ load, same, copy, written, raw, draft, apply, res, file, evening, ringSold }) {
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

  // The shop's supply of items it doesn't otherwise sell is worked out from
  // the logs: a sale puts a copy back, buying it takes it out, retiring
  // returns everything carried; the file keeps no list of its own.
  const ringLeft =file => buildData(copy(file)).shop.stock.find(i => i.name === "Ring of Skulls")?.left ?? 0;
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
  const party = ["Azorica", "Craig", "Flik Flak"];
  const twice = [scenario6[0], { ...scenario6[0] }];
  same("town: donating once per visit, and a visit after each scenario",
    [says(warnsOf({ donations: [{ character: "Azorica" }, { character: "Azorica" }] }), "twice in one visit"),
     says(warnsOf({ scenarios: scenario6, donations: [{ character: "Azorica" }, { character: "Azorica", when: "after" }] }), "twice in one visit"),
     says(warnsOf({ party, scenarios: twice, donations: [{ character: "Azorica", when: "after-1" }, { character: "Azorica", when: "after" }] }), "twice in one visit"),
     // A "when" left from a scenario since taken out isn't another visit.
     says(warnsOf({ donations: [{ character: "Azorica" }, { character: "Azorica", when: "after" }] }), "twice in one visit")],
    [true, false, false, true]);
  // Between two scenarios: the Bless cards go into the second, so none wait.
  const between = evening(raw, { party, scenarios: twice, donations: [{ character: "Azorica", when: "after-1" }] });
  const afterBoth = evening(raw, { party, scenarios: twice, donations: [{ character: "Azorica", when: "after" }] });
  same("bless: a donation between two scenarios is used in the second",
    [between.characters.find(c => c.name === "Azorica").log.find(e => e.for === "donation").after, blessOf(between, "Azorica"),
     afterBoth.characters.find(c => c.name === "Azorica").log.find(e => e.for === "donation").after, blessOf(afterBoth, "Azorica")],
    [1, false, true, true]);
  // A retiree may do their town business first (p. 48): a donation comes off
  // their gold before retiring takes the rest. Their Bless cards are theirs
  // (errata), so with no scenario after, they go unused.
  const retires = { retirements: [{ character: "Azorica", unlocks: "envelope-x" }] };
  const gaveFirst = evening(raw, { donations: [{ character: "Azorica" }], ...retires });
  same("retiring: town business first, and the Bless cards stay with the retiree",
    [says(warnsOf({ donations: [{ character: "Azorica" }], ...retires }), "go unused"),
     says(warnsOf({ party, scenarios: scenario6, donations: [{ character: "Azorica" }], ...retires }), "go unused"),
     warnsOf({ donations: [{ character: "Azorica" }], ...retires }).filter(w => w.includes("would have")),
     gaveFirst.characters.find(c => c.name === "Azorica").log.slice(-2).map(e => e.for),
     buildData(copy(gaveFirst)).characters.find(c => c.name === "Azorica").gold],
    [true, false, [], ["donation", "retirement"], 0]);
  // The enhancement limit: the class's stickers, every character of it,
  // against the prosperity level after the evening (a scenario's reward can
  // raise it before the party goes to the Enhancer).
  const before = buildData(copy(raw));
  const cls = before.characters.find(c => c.name === "Azorica").class;
  const stickers = before.characters.filter(c => c.class === cls).reduce((n, c) => n + (c.enhanced || 0), 0);
  const prosperity = stepFor(before.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY);
  const raised = stepFor(before.prosperityCheckmarks + 5, CHECKMARKS_FOR_PROSPERITY);   // #51's reward: +5
  const enhance = n => Array.from({ length: n }, () => ({ character: "Azorica", what: "Move", cost: "0" }));
  const won51 = [{ number: "51", level: "2", result: "success", treasures: [], results: { Azorica: { xp: "1" }, Craig: { xp: "1" }, "Flik Flak": { xp: "1" } } }];
  same("enhancements: no more enhanced cards than the prosperity level, after the evening",
    [raised > prosperity,
     says(warnsOf({ enhancements: enhance(prosperity - stickers) }), "can be enhanced"),
     says(warnsOf({ enhancements: enhance(prosperity - stickers + 1) }), "can be enhanced"),
     says(warnsOf({ party, scenarios: won51, enhancements: enhance(raised - stickers) }), "can be enhanced")],
    [true, false, true, false]);
  // A scenario recorded without a level (an older draft) takes the level
  // given for it (the page's tonight's), or 0 with none given: in the
  // session, and in what each character takes from it.
  const noLevel = [{ ...scenario6[0], level: "" }];
  const recorded = level => {
    const res = applyDraft(fromFile(copy(raw)), { ...copy(draft), party, scenarios: noLevel, events: [], buys: [], sells: [], perks: [],
      donations: [], enhancements: [], claims: {}, quests: {}, newCharacters: [], retirements: [] }, buildData(copy(raw)), level === undefined ? undefined : { level });
    return res.out.sessions.find(s => s.date === draft.date)?.scenarios[0]?.level;
  };
  same("evening: a scenario with no level takes the fallback level given, else 0",
    [recorded(3), recorded(undefined), draftLevel({ level: "" }, 5), draftLevel({ level: "2" }, 5), scenarioGain({ level: "", result: "success" }, { xp: "1" }, 3).xp],
    [3, 0, 5, 2, 1 + scenarioStats(3).xp]);
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
  same("evening: the scenario completed is in the session, with its results",
    file.sessions.at(-1).scenarios.map(p => [p.number, p.result, (p.results || []).map(r => r.character)]),
    [[5, "success", ["Azorica", "Craig", "Flik Flak"]], [6, "failure", ["Azorica", "Craig", "Flik Flak"]]]);

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
    [treasureParts(62).map(describeTreasurePart), looted.characters.find(c => c.name === "Azorica").log.at(-1), fileQuestions(looted)],
    [[itemName(110), itemName(115)], { date: "2026-11-20", for: "treasure", treasure: "62", gained: [itemName(110), itemName(115)] }, []]);
}
