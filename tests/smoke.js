// The page itself, opened in a frame as a person would open it: what the
// tests of campaign.js can't see (app.js, index.html, styles.css). Browser
// only: tests/index.html runs it after the others, and GitHub runs that
// page in headless Chrome. Each check says what it found when it fails.
async function runSmoke() {
  const results = [];
  const check = (name, ok, found) => results.push({ name, ok: Boolean(ok), actual: found, expected: "see the check's name" });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  const open = (path, width) => new Promise(resolve => {
    const frame = document.createElement("iframe");
    frame.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;height:800px;border:0`;
    frame.addEventListener("load", () => resolve(frame), { once: true });
    frame.src = path;
    document.body.append(frame);
  });
  // Drawn once the "Loading campaign…" line is gone (or says what failed).
  const ready = async frame => {
    for (let i = 0; i < 200; i++) {
      const status = frame.contentDocument?.getElementById("status");
      if (!status || !/^Loading/.test(status.textContent)) return;
      await wait(50);
    }
  };

  const cases = [
    { name: "campaign.json, wide", path: "../index.html", width: 1200, cards: 3 },
    { name: "the sample, wide", path: "../index.html?data=examples/sample-campaign.json", width: 1200, cards: 2 },
    { name: "the old layout, wide", path: "../index.html?data=tests/fixtures/campaign-v1.json", width: 1200, cards: 3 },
    { name: "campaign.json, phone", path: "../index.html", width: 360, phone: true },
  ];
  for (const c of cases) {
    const frame = await open(c.path, c.width);
    const errors = [];
    frame.contentWindow.addEventListener("error", e => errors.push(e.message));
    frame.contentWindow.addEventListener("unhandledrejection", e => errors.push(String(e.reason)));
    await ready(frame);
    const doc = frame.contentDocument;
    const status = doc.getElementById("status")?.textContent;
    check(`page, ${c.name}: loads, without an error`, !status && !errors.length, status || errors.join("; ") || "loaded");
    if (status) { frame.remove(); continue; }

    const text = sel => doc.querySelector(sel)?.innerText.trim() || "";
    if (!c.phone) {
      const cards = doc.querySelectorAll(".char-card").length;
      check(`page, ${c.name}: a sheet for each active character`, cards === c.cards, `${cards} sheets`);
      const empty = ["#overview", "#scenarios", "#sessions", "#events", "#record", "#shop"].filter(sel => !text(sel));
      check(`page, ${c.name}: every section drawn`, !empty.length, empty.length ? `empty: ${empty.join(", ")}` : "all drawn");
    } else {
      // Each tab in turn, from the tab bar: shown, and nothing wider than the screen.
      const seen = [];
      for (const tab of ["tonight", "play", "town", "campaign"]) {
        doc.querySelector(`.tabs a[data-tab="${tab}"]`)?.click();
        await wait(150);
        const wide = doc.documentElement.scrollWidth > frame.contentWindow.innerWidth;
        seen.push(`${tab}: ${doc.body.dataset.tab}${wide ? `, ${doc.documentElement.scrollWidth}px wide` : ""}`);
      }
      check(`page, ${c.name}: every tab opens, none wider than the screen`,
        seen.every(s => /^(\w+): \1$/.test(s)), seen.join("; "));
    }
    check(`page, ${c.name}: no error while used`, !errors.length, errors.join("; ") || "none");
    frame.remove();
  }
  return results;
}
