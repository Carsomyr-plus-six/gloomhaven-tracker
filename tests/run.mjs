// The tests in Node: node tests/run.mjs (from anywhere). Exits 1 on a failure.
// node tests/run.mjs --update rewrites each golden file a failing test
// compares with, from what's worked out now: for a change meant to change
// what the page works out. Read the diff in git before committing it.
// The rules (campaign/) are plain scripts for the browser, so they're run
// as such here, in the order index.html loads them, with the tests beside
// them, sharing their globals.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const listed = [...read("index.html").matchAll(/<script src="((?:campaign|app)\/[\w-]+\.js)"/g)].map(m => m[1]);
const rules = listed.filter(file => file.startsWith("campaign/"));
for (const file of [...rules, "tests/snapshot.js", "tests/tests.js"]) vm.runInThisContext(read(file), { filename: file });

const results = await globalThis.runTests(async path => JSON.parse(read(path)), async path => read(path));
// Every file in campaign/ and app/ is one index.html loads, and each it
// loads is there: a file left off the list would never run. (Node only: a
// browser can't list a folder.)
const onDisk = ["campaign", "app"].flatMap(dir => readdirSync(new URL(`${dir}/`, root)).filter(f => f.endsWith(".js")).map(f => `${dir}/${f}`));
results.push({ name: "every file in campaign/ and app/ is loaded by index.html, and only those",
  ok: JSON.stringify([...listed].sort()) === JSON.stringify([...onDisk].sort()), actual: [...listed].sort(), expected: [...onDisk].sort() });
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
