// Tabs, loading the campaign and the reference data, and starting the page.

// --- Tabs and loading -----------------------------------------------------------

const RENDERERS = {
  overview: renderOverview,
  characters: renderCharacters,
  shop: data => [scenarioSummary(data), townJobs(data),
    sheet("shop", "Shop", renderShop(data)), sheet("enhance", "Enhancing a card", enhancer(data))],
  scenarios: renderScenarios,
  sessions: renderSessions,
  events: renderEvents,
  record: renderRecord,
};

// Which tab each section belongs to on a phone: an evening at the table, in
// order. Tonight sets up the scenario, Play is this phone's character, Town
// is the Shop after, and Campaign is the rest of the record, to look up.
const TAB_OF = { overview: "tonight", characters: "play", shop: "town",
                 campaign: "campaign", scenarios: "campaign", sessions: "campaign", events: "campaign", record: "campaign" };
// The addresses that open a tab at its top rather than at a section in it.
const TAB_TOPS = ["overview", "characters", "shop", "campaign"];

function currentTab() {
  const id = location.hash.slice(1);
  return id.startsWith("scenario-") ? "campaign" : TAB_OF[id] || "tonight";
}

// A phone shows one tab at a time, so a section on another tab isn't drawn
// when something changes: it's marked out of date, and drawn when its tab
// is shown (showTab), from the latest data. Wide screens draw everything.
const outOfDate = new Set();
let latestData = null;
const onShownTab = id => document.getElementById(id)?.dataset.tab.split(" ").includes(currentTab());
// The section each phone sheet is drawn in: it opens over any tab, so its
// section is drawn while it's open, whatever tab is shown.
const SHEET_HOME = { level: "overview", ready: "overview", record: "sessions", shop: "shop", enhance: "shop" };
const onScreenNow = id => onShownTab(id) || SHEET_HOME[openSheetId] === id;

function render(data, only) {
  latestData = data;
  // Redrawing replaces the buttons, so put focus and the map's scroll back,
  // and an open sheet's place.
  const sheetScroll = document.querySelector(".sheet.open")?.scrollTop;
  const key = document.activeElement?.dataset?.key;
  const mapScroll = document.querySelector(".map-scroll")?.scrollLeft;

  for (const [id, fn] of Object.entries(RENDERERS)) {
    if (only && id !== only) continue;
    if (phone.matches && !onScreenNow(id)) { outOfDate.add(id); continue; }
    outOfDate.delete(id);
    const nodes = [fn(data)].flat(Infinity).filter(Boolean);
    const panel = document.getElementById(id);
    panel.replaceChildren(...nodes);
    panel.hidden = !nodes.length;
  }

  packGrids();
  // The list of characters, open when it was redrawn (its "+ 1 inactive"),
  // stays open.
  if (switchOpen && phone.matches) document.getElementById("char-switch")?.showPopover?.();
  if (key) document.querySelector(`[data-key="${key}"]`)?.focus({ preventScroll: true });
  const map = document.querySelector(".map-scroll");
  if (map && mapScroll) map.scrollLeft = mapScroll;
  // The first time the map is drawn wider than its box, scroll so the
  // picked scenario (usually the newest, at the deep end) is in view.
  else if (map && map.scrollWidth > map.clientWidth) {
    const picked = map.querySelector('.node[aria-pressed="true"]');
    const over = picked ? picked.getBoundingClientRect().right - map.getBoundingClientRect().right : 0;
    if (over > 0) map.scrollLeft = over + 28;
  }
  // What was drawn afresh is sorted onto its tab again: the Overview's parts
  // belong to two (Tonight and Campaign).
  showTab();
  applySheets();
  const open = document.querySelector(".sheet.open");
  if (open && sheetScroll) open.scrollTop = sheetScroll;
  if (open && key) open.querySelector(`[data-key="${key}"]`)?.focus({ preventScroll: true });
}

// Wide screens: pack the character sheets like bricks (see .char-grid.packed
// in styles.css). Each card spans as many 1px rows as it is tall, plus the
// gap; auto-placement keeps the party's order and puts each sheet in the
// first place it fits. A card that changes size (fonts loading, a wider
// window, a phone with one sheet showing) is measured again.
const CARD_GAP = 16;   // matches .char-grid's gap
const spanCard = card => { card.style.gridRowEnd = `span ${Math.ceil(card.getBoundingClientRect().height) + CARD_GAP}`; };
const packer = typeof ResizeObserver === "function" ? new ResizeObserver(entries => entries.forEach(e => spanCard(e.target))) : null;
function packGrids() {
  if (!packer) return;
  packer.disconnect();
  // Phones stack the sheets: nothing to pack, so nothing to measure.
  if (phone.matches) return;
  for (const grid of document.querySelectorAll(".char-grid")) {
    for (const card of grid.children) { spanCard(card); packer.observe(card); }
    grid.classList.add("packed");
  }
}

// On a phone, show the current tab's sections and hide the rest.
// Phones: each tab keeps its place, so leaving Play in the middle of a round
// and coming back from the tab bar returns to where you were. A link into a
// tab still starts it from the top, or at the section it names.
const tabScroll = {};
let shownTab = null;
let viaTabBar = false;

function showTab() {
  const tab = currentTab();
  // Its sections changed while another tab was shown: drawn now. (render
  // calls back here; by then nothing on this tab is out of date.)
  for (const id of [...outOfDate]) if (latestData && onShownTab(id)) render(latestData, id);
  shownTab = tab;
  document.body.dataset.tab = tab;
  // A section can belong to more than one tab ("tonight campaign").
  for (const el of document.querySelectorAll("main [data-tab]")) el.classList.toggle("off", !el.dataset.tab.split(" ").includes(tab));
  for (const a of document.querySelectorAll(".tabs a[data-tab]")) {
    if (phone.matches && a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else if (a.getAttribute("aria-current") === "page") a.removeAttribute("aria-current");
  }
  markSection();
}

// Wide screens: the top bar marks the section being read, the last one whose
// top has reached the top third of the window (two side by side count as the
// first). At the very bottom, the last section, which may never get there.
function markSection() {
  const links = [...document.querySelectorAll('.tabs a[href^="#"]')];
  let here = null;
  if (!phone.matches) {
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    let top = null;
    for (const a of links) {
      const section = document.getElementById(a.hash.slice(1));
      if (!section || section.hidden) continue;
      const y = Math.round(section.getBoundingClientRect().top);
      if (atEnd) here = a;
      else if (y <= Math.max(140, window.innerHeight / 3) && y !== top) { here = a; top = y; }
    }
    here ||= links[0];
    // A section just picked from the bar wins while it's in view: Event decks
    // sits beside Sessions, so it would otherwise never be marked.
    const picked = links.find(a => a.hash === location.hash);
    const box = picked && document.getElementById(picked.hash.slice(1))?.getBoundingClientRect();
    if (box && box.top <= Math.max(140, window.innerHeight / 3) && box.bottom > 140) here = picked;
  }
  for (const a of links) {
    if (a === here) a.setAttribute("aria-current", "location");
    else if (a.getAttribute("aria-current") === "location") a.removeAttribute("aria-current");
  }
}

function watchSections() {
  let queued = false;
  window.addEventListener("scroll", () => {
    // Each phone tab's place, kept as it's scrolled.
    if (phone.matches && shownTab) tabScroll[shownTab] = window.scrollY;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; markSection(); });
  }, { passive: true });
  markSection();
}

function onNavigate() {
  showTab();
  if (pendingScenario != null) {
    const number = pendingScenario;
    pendingScenario = null;
    revealScenario(number);
    return;
  }
  // Wide screens scroll to the section by themselves. A phone has just
  // swapped what is on screen, so start the new tab from its top.
  if (!phone.matches) return;
  const id = location.hash.slice(1);
  // A section further down the tab is jumped to, not glided to: what's above
  // it has only just appeared.
  const back = viaTabBar ? tabScroll[currentTab()] || 0 : 0;
  viaTabBar = false;
  if (TAB_TOPS.includes(id) || !id) window.scrollTo({ top: back, behavior: "instant" });
  else document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
}

// ?data=examples/sample-campaign.json shows another file from this site (for testing).
// On GitHub Pages (owner.github.io/repo/), the GitHub page that edits the
// campaign file, so a phone at the table can commit a session itself.
// Anywhere else (a local copy), there's no repository to point at: null.
function githubEditUrl(file, at = location) {
  const owner = at.hostname.match(/^([^.]+)\.github\.io$/i)?.[1];
  const repo = at.pathname.split("/")[1];
  if (!owner || !repo || !file.pathname.startsWith(`/${repo}/`)) return null;
  return `https://github.com/${owner}/${repo}/edit/main/${file.pathname.slice(repo.length + 2)}`;
}

// Reference data. Without it the tracker still works, showing only what
// campaign.json lists.
async function loadReference(path) {
  try {
    // Checked with the server each time (cheap when unchanged), so a phone
    // picks up refreshed reference data rather than an old cached copy.
    const response = await fetch(path, { cache: "no-cache" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function start() {
  const status = document.getElementById("status");
  const url = dataUrl();
  try {
    const [response, ref, evRef, items, quests] = await Promise.all([
      fetch(url, { cache: "no-cache" }),
      loadReference("data/gloomhaven-scenarios.json"),
      loadReference("data/gloomhaven-events.json"),
      loadReference("data/gloomhaven-items.json"),
      loadReference("data/gloomhaven-quests.json"),
    ]);
    itemsRef = items;
    questRef = quests;
    classRef = evRef;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const json = await response.json();
    // The file in the shape the page works with (campaign/file.js).
    rawCampaign = fromFile(json);
    scenarioRef = ref;
    draft = loadDraft();
    // Once the downloaded file has been committed, the draft is in
    // campaign.json: clear it, so it isn't recorded (and counted) twice.
    if (draft && draftIsSaved(draft, rawCampaign)) {
      savedDraft = draft;
      dropDraft();
    }
    const data = buildData(json, rawCampaign);

    if (data.party.name) {
      document.getElementById("title").textContent = data.party.name;
      document.getElementById("title").title = data.party.name;   // in full, if the bar cuts it short
      document.title = `${data.party.name} · Gloomhaven`;
    }
    document.getElementById("footer").replaceChildren(
      [data.edition, data.updated ? `updated ${formatDate(data.updated)}` : null,
       url.pathname.endsWith("/campaign.json") ? null : `showing ${url.pathname}`].filter(Boolean).join(" · "),
      h("br"),
      ...(ref ? ["Scenario data from ", h("a", { href: ref.source }, "Gloomhaven Secretariat"), ` (${ref.license}). `]
              : ["Scenario reference data couldn't be loaded. "]),
      "Icons from the Gloomhaven Creator Pack by Isaac Childres (",
      h("a", { href: "https://creativecommons.org/licenses/by-nc-sa/4.0/" }, "CC BY-NC-SA 4.0"), "), converted to SVG. ",
      "Unofficial fan project; Gloomhaven is © Cephalofair Games.");

    // A phone opens on its player's sheet, unless the link was to somewhere else.
    const mine = characterOrder(data).findIndex(c => !c.retired && c.name === me);
    if (mine >= 0) characterIndex = mine;
    // At the start of an evening that's Tonight; with a scenario under way on
    // this phone, the player's sheet.
    clearRecordedTables(data);
    if (phone.matches && mine >= 0 && location.hash.length <= 1) history.replaceState(null, "", tableActive(me) ? "#characters" : "#overview");

    if (draft && !draftChanges(draft, data)) dropDraft();
    render(data);
    status.remove();
    showTab();
    watchSections();
    // Not asked yet, or their character has since retired: ask.
    if (phone.matches && me !== "" && mine < 0) askWho(data);
    myTab(data);
    // The Play tab is this phone's home: from anywhere, even another
    // character's sheet, it goes back to its player's sheet.
    document.querySelector('.tabs a[data-tab="play"]')?.addEventListener("click", () => {
      const i = characterOrder(data).findIndex(c => !c.retired && c.name === me);
      if (!phone.matches || i < 0) return;
      // Another character's sheet was showing: their place isn't this one's.
      if (characterIndex !== i) { characterIndex = i; tabScroll.play = 0; render(data, "characters"); }
      if (location.hash === "#characters") window.scrollTo({ top: 0, behavior: "instant" });
    });
    for (const a of document.querySelectorAll(".tabs a")) a.addEventListener("click", () => { viaTabBar = true; });
    // Town's summary and Tonight's battle goal read the tracker, which the
    // Play tab changes (its reset clears them): drawn afresh on the way
    // there, before the tab's place is put back.
    window.addEventListener("hashchange", () => {
      if (!phone.matches) return;
      if (openSheetId) { openSheetId = null; applySheets(); }
      if (currentTab() === "town") render(data, "shop");
      if (currentTab() === "tonight") render(data, "overview");
    });
    window.addEventListener("hashchange", onNavigate);
    // Skip to content: to the page itself, without changing the address (which
    // on a phone would change the tab).
    document.querySelector(".skip")?.addEventListener("click", e => {
      e.preventDefault();
      const main = document.querySelector("main");
      main.setAttribute("tabindex", "-1");
      main.focus();
    });
    phone.addEventListener("change", () => render(data));
    // Arriving on a link to a section: go there now that it exists.
    if (location.hash.length > 1) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (err) {
    // Nothing to show, so say what probably went wrong and drop the menu,
    // whose links would lead nowhere.
    const requested = new URLSearchParams(location.search).has("data");
    const hint = location.protocol === "file:"
      ? "The page was opened straight from a file, and browsers won't let it read campaign.json that way. Run a small web server in the folder (py -m http.server 8000) and open http://127.0.0.1:8000/."
      : err instanceof SyntaxError
        ? "The file isn't valid JSON. A missing comma or quote is the usual cause; the error above says where."
        : requested
          ? "Check the file named after ?data= in the address exists, or open the page without it."
          : "campaign.json should sit next to index.html.";
    // On the live site, the file's history on GitHub has the last good
    // version; and a draft in this browser is safe until the file loads.
    const history = githubEditUrl(url)?.replace("/edit/", "/commits/");
    const unsaved = loadDraft();
    status.classList.add("error");
    status.replaceChildren(...[
      h("strong", {}, "Couldn't load the campaign"),
      h("span", {}, `${url.pathname}: ${err.message}`),
      h("span", {}, hint),
      history && err instanceof SyntaxError
        ? h("span", {}, "To go back to the last version that worked, open ", h("a", { href: history }, "the file's history on GitHub"), ".") : null,
      unsaved ? h("span", {}, "What you recorded on this phone is still here, and comes back once the file loads.") : null,
    ].filter(Boolean));
    document.querySelector(".tabs")?.style.setProperty("display", "none");
    document.getElementById("footer").hidden = true;
  }
}

start();
