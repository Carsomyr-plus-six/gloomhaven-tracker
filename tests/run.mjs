// The tests in Node: node tests/run.mjs (from anywhere). Exits 1 on a failure.
// node tests/run.mjs --update rewrites each golden file a failing test
// compares with, from what's worked out now: for a change meant to change
// what the page works out. Read the diff in git before committing it. It
// also writes the version of the page's scripts and styles into index.html.
// The rules (campaign/) are plain scripts for the browser, so they're run
// as such here, in the order index.html loads them, with the tests beside
// them in the order tests/index.html loads those, sharing their globals.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const listed = [...read("index.html").matchAll(/<script src="((?:campaign|app)\/[\w-]+\.js)(?:\?v=\w+)?"/g)].map(m => m[1]);
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
// Only base.js's stored reads or writes what the browser keeps: anything
// else that did could throw where storage is off, and stop the page.
const touches = listed.filter(f => f !== "app/base.js" && /\blocalStorage\b/.test(read(f)));
results.push({ name: "only app/base.js (stored) reads or writes localStorage", ok: !touches.length, actual: touches, expected: [] });

const update = process.argv.includes("--update");
// The page's scripts and styles carry one version (?v=), worked out from
// their contents: a browser that cached an older page keeps that page's
// files, and a newer page gets its own, never a mix of the two. A change to
// any of them changes the version, and --update writes it into index.html.
const version = createHash("sha256").update([...listed, "styles.css"].map(read).join("\n")).digest("hex").slice(0, 10);
const page = read("index.html");
const address = /((?:src|href)="(?:(?:campaign|app)\/[\w-]+\.js|styles\.css))(\?v=\w+)?"/g;
const versions = [...page.matchAll(address)].map(m => `${m[1]}${m[2] || ""}`);
const wanted = [...page.matchAll(address)].map(m => `${m[1]}?v=${version}`);
if (update && JSON.stringify(versions) !== JSON.stringify(wanted)) {
  writeFileSync(new URL("index.html", root), page.replace(address, `$1?v=${version}"`));
  console.log(`updated index.html's version to ${version}`);
} else {
  results.push({ name: "index.html's scripts and styles carry the version their contents make (node tests/run.mjs --update writes it)",
    ok: versions.length === listed.length + 1 && JSON.stringify(versions) === JSON.stringify(wanted), actual: versions, expected: wanted });
}
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
