// Tests of campaign/progress.js: perks and the attack modifier deck, and
// the milestones.
async function progressTests({ same, copy, raw }) {
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
}
