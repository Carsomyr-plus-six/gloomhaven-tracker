// The tests in Node: node tests/run.mjs (from anywhere). Exits 1 on a failure.
// node tests/run.mjs --update rewrites each golden file a failing test
// compares with, from what's worked out now: for a change meant to change
// what the page works out. Read the diff in git before committing it.
// The rules (campaign/) are plain scripts for the browser, so they're run
// as such here, in the order index.html loads them, with the tests beside
// them in the order tests/index.html loads those, sharing their globals.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const listed = [...read("index.html").matchAll(/<script src="((?:campaign|app)\/[\w-]+\.js)"/g)].map(m => m[1]);
const rules = listed.filter(file => file.startsWith("campaign/"));
// The test page's own scripts: all but the page's code and the smoke test,
// which needs a browser.
// (Its own paths only: the rules' start with ../.)
const tests = [...read("tests/index.html").matchAll(/<script src="([\w/-][\w./-]*\.js)"/g)].map(m => `tests/${m[1]}`).filter(f => f !== "tests/smoke.js");
for (const file of [...rules, ...tests]) vm.runInThisContext(read(file), { filename: file });

const results = await globalThis.runTests(async path => JSON.parse(read(path)), async path => read(path));
// Every file in campaign/ and app/ is one index.html loads, and each it
// loads is there: a file left off the list would never run. The same for
// tests/campaign/ and the test page. (Node only: a browser can't list a
// folder.)
const inFolder = (dir, prefix = "") => readdirSync(new URL(`${prefix}${dir}/`, root)).filter(f => f.endsWith(".js")).map(f => `${dir}/${f}`);
const onDisk = [...inFolder("campaign"), ...inFolder("app")];
results.push({ name: "every file in campaign/ and app/ is loaded by index.html, and only those",
  ok: JSON.stringify([...listed].sort()) === JSON.stringify([...onDisk].sort()), actual: [...listed].sort(), expected: [...onDisk].sort() });
const testAreas = tests.map(f => f.replace(/^tests\//, "")).filter(f => f.startsWith("campaign/")).sort();
results.push({ name: "every file in tests/campaign/ is loaded by tests/index.html, and only those",
  ok: JSON.stringify(testAreas) === JSON.stringify(inFolder("campaign", "tests/").sort()), actual: testAreas, expected: inFolder("campaign", "tests/").sort() });
const update = process.argv.includes("--update");
let failed = 0;
for (const r of results) {
  if (!r.ok && update && r.golden) {
    writeFileSync(new URL(r.golden, root), JSON.stringify(r.actual, null, 1) + "\n");
    console.log(`updated ${r.golden}`);
    continue;
  }
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}`);
  if (r.ok) continue;
  failed++;
  // The first difference, with a little around it.
  const a = JSON.stringify(r.actual, null, 1).split("\n");
  const b = JSON.stringify(r.expected, null, 1).split("\n");
  const at = a.findIndex((line, i) => line !== b[i]);
  console.log(`     first difference at line ${at + 1}:`);
  console.log(`     expected: ${b.slice(Math.max(0, at - 2), at + 3).join("\n               ")}`);
  console.log(`     actual:   ${a.slice(Math.max(0, at - 2), at + 3).join("\n               ")}`);
}
console.log(`${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
