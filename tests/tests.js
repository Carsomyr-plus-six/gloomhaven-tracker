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

  // The rules' files load in one order, index.html's: the test page loads
  // the same ones in the same order (tests/run.mjs reads index.html's list).
  // (The test page's own campaign/ is its tests, not the rules.)
  const rulesIn = (html, prefix) => [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1])
    .filter(src => src.startsWith(`${prefix}campaign/`)).map(src => src.slice(prefix.length));
  const pageRules = rulesIn(await loadText("index.html"), "");
  same("the test page loads the rules' files the page does, in its order",
    [rulesIn(await loadText("tests/index.html"), "../"), pageRules.length > 0], [pageRules, true]);

  // The session writer: a draft with every part of the form, applied to
  // campaign.json; the file it writes, worked out again.
  const raw = await load("campaign.json");
  const draft = await load("tests/drafts/evening.json");
  const apply = () => applyDraft(fromFile(copy(raw)), draft, buildData(copy(raw)));
  const res = apply();
  const file = toFile(res.out);

  // An evening of only what's given (no scenarios, events or rows besides),
  // applied to a file: the file it writes. And Azorica's Ring of Skulls sold
  // back to the shop, which the shop's tests and the older layout's use.
  const evening =(file, extra) => toFile(applyDraft(fromFile(copy(file)), { ...copy(draft), scenarios: [], events: [], buys: [], sells: [], perks: [],
    donations: [], enhancements: [], claims: {}, quests: {}, newCharacters: [], retirements: [], ...extra }, buildData(copy(file))).out);
  const ringSold = evening(raw, { sells: [{ character: "Azorica", item: "Ring of Skulls" }] });

  // Each area's tests: a file each under tests/campaign/, named after the
  // campaign/ file it tests, run in the order campaign/ loads.
  const shared = { load, loadText, same, copy, written, raw, draft, apply, res, file, evening, ringSold };
  for (const area of [ledgerTests, eveningTests, historyTests, progressTests, fileTests]) await area(shared);
  return results;
}
