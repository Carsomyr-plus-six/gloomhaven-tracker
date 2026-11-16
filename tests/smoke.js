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

  // The session form, as a recorder fills it in: every kind of row added,
  // each choice in it made (a choice can bring another, as who retires
  // brings their quest card), and each quest shown, without an error. On a
  // copy of the campaign (?data=), which keeps its draft and picks apart
  // from the real ones; what it kept in the browser is cleared after.
  {
    const path = "tests/fixtures/campaign-v1.json";
    const frame = await open(`../index.html?data=${path}`, 1200);
    const errors = [];
    frame.contentWindow.addEventListener("error", e => errors.push(e.message));
    frame.contentWindow.addEventListener("unhandledrejection", e => errors.push(String(e.reason)));
    await ready(frame);
    const doc = frame.contentDocument;
    [...doc.querySelectorAll("button")].find(b => b.innerText.includes("Record the evening"))?.click();
    await wait(150);
    const kinds = ["add-scenario", "add-event", "add-retire", "add-new", "add-buy", "add-sell", "add-perk", "add-donation", "add-opened"];
    const added = [];
    for (const key of kinds) {
      const b = doc.querySelector(`[data-key="${key}"]`);
      if (b) { b.click(); added.push(key); await wait(40); }
    }
    // Stopping at the first error, so a broken form fails quickly.
    let picked = 0;
    for (; picked < 60 && !errors.length; picked++) {
      const sel = [...doc.querySelectorAll(".recorder select")].find(s => !s.value && s.options.length > 1);
      if (!sel) break;
      sel.value = sel.options[1].value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(40);
    }
    const shows = [...doc.querySelectorAll('.recorder [data-key^="pq-now-"]')].map(b => b.dataset.key);
    for (const key of shows) { if (errors.length) break; doc.querySelector(`[data-key="${key}"]`)?.click(); await wait(40); }
    check("form: every kind of row added and filled in, without an error",
      doc.querySelector(".recorder") && added.length === kinds.length && !errors.length,
      errors.join("; ") || `${added.length} of ${kinds.length} kinds of row, ${picked} choices, ${shows.length} quests shown`);
    // The page keys what it keeps by the data file's path as served.
    const store = frame.contentWindow.localStorage;
    const kept = `:${new URL(path, frame.contentWindow.location.href).pathname}`;
    for (const k of Object.keys(store)) if (k.endsWith(kept)) store.removeItem(k);
    frame.remove();
  }

  // A phone draws only the tab on screen (the others when shown), so: every
  // tab has something drawn once opened, and a sheet drawn in another tab's
  // section still opens over this one (the form, from Tonight). On a copy of
  // the campaign, cleared after.
  {
    const path = "tests/fixtures/campaign-v1.json";
    const frame = await open(`../index.html?data=${path}#overview`, 360);
    const errors = [];
    frame.contentWindow.addEventListener("error", e => errors.push(e.message));
    await ready(frame);
    const doc = frame.contentDocument;
    const empty = [];
    for (const tab of ["play", "town", "campaign", "tonight"]) {
      doc.querySelector(`.tabs a[data-tab="${tab}"]`)?.click();
      await wait(150);
      const shown = [...doc.querySelectorAll("main > section, main .pair section")].filter(s => s.dataset.tab?.split(" ").includes(tab));
      if (!shown.some(s => s.innerText.trim())) empty.push(tab);
    }
    check("phone: every tab is drawn once shown", !empty.length, empty.length ? `nothing drawn on ${empty.join(", ")}` : "all drawn");
    // The attack modifier deck, on the Play tab: every column the same box
    // (a shared top, bottom and width), no label wider than its column, and
    // a Curse added at the end shows as a block and a pip, then taken out.
    // A character's table state isn't kept by data file, so it's put back.
    {
      doc.querySelector('.tabs a[data-tab="play"]')?.click();
      await wait(150);
      const deck = () => doc.querySelector(".char-card .deck-block");
      const name = doc.querySelector(".char-card")?.dataset.char;
      const kept = frame.contentWindow.localStorage.getItem(`table:${name}`);
      const boxes = [...(deck()?.querySelectorAll(".deck-stack") || [])].map(s => { const r = s.getBoundingClientRect(); return `${Math.round(r.top)}/${Math.round(r.bottom)}/${Math.round(r.width)}`; });
      const wide = [...(deck()?.querySelectorAll(".deck-label") || [])].filter(l => l.scrollWidth > l.clientWidth + 1).map(l => l.innerText);
      const pips = () => deck()?.querySelectorAll(".deck-pips i").length || 0;
      const blocks = () => deck()?.querySelectorAll(".deck-col.curse i").length || 0;
      doc.querySelector(`[data-key="cond-curse-up-${name}"]`)?.click();
      await wait(80);
      const added = [pips(), blocks()];
      doc.querySelector(`[data-key="cond-curse-down-${name}"]`)?.click();
      await wait(80);
      const store = frame.contentWindow.localStorage;
      if (kept === null) store.removeItem(`table:${name}`); else store.setItem(`table:${name}`, kept);
      check("phone: the deck's columns line up, and a Curse added at the end shows",
        boxes.length > 8 && new Set(boxes).size === 1 && !wide.length && added.join() === "1,1" && pips() === 0 && !errors.length,
        errors.join("; ") || `${boxes.length} columns, ${new Set(boxes).size} sizes, too wide: ${wide.join(", ") || "none"}; a Curse added: ${added[0]} pip, ${added[1]} block; taken out: ${pips()} pips`);
      doc.querySelector('.tabs a[data-tab="tonight"]')?.click();
      await wait(150);
    }
    [...doc.querySelectorAll("button")].find(b => b.innerText.trim().startsWith("Record the evening"))?.click();
    await wait(200);
    check("phone: the form opens over Tonight, drawn from the Campaign tab's section",
      doc.querySelector(".sheet.open .recorder") && doc.body.dataset.tab === "tonight" && !errors.length,
      errors.join("; ") || `${doc.querySelector(".sheet.open")?.dataset.sheet || "no sheet"} on ${doc.body.dataset.tab}`);
    const store = frame.contentWindow.localStorage;
    const kept = `:${new URL(path, frame.contentWindow.location.href).pathname}`;
    for (const k of Object.keys(store)) if (k.endsWith(kept)) store.removeItem(k);
    frame.remove();
  }
  return results;
}
