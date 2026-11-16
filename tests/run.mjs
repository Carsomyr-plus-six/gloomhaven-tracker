// The tests in Node: node tests/run.mjs (from anywhere). Exits 1 on a failure.
// node tests/run.mjs --update rewrites each golden file a failing test
// compares with, from what's worked out now: for a change meant to change
// what the page works out. Read the diff in git before committing it.
// campaign.js is a plain script for the browser, so it's run as one here,
// with the tests beside it, sharing its globals.
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
for (const file of ["campaign.js", "tests/snapshot.js", "tests/tests.js"]) vm.runInThisContext(read(file), { filename: file });

const results = await globalThis.runTests(async path => JSON.parse(read(path)), async path => read(path));
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
