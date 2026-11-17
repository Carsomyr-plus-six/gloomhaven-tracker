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
}
