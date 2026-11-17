// The Overview's tiles: reputation and prices, prosperity and the
// Sanctuary, and tonight's scenario level for whoever is playing.

// --- Overview ---------------------------------------------------------------

// The next reputation at which the shop gets cheaper, or null at the best price.
function nextShopStep(reputation) {
  const now = shopModifier(reputation);
  for (let r = reputation + 1; r <= 20; r++) {
    if (shopModifier(r) < now) return { at: r, modifier: shopModifier(r) };
  }
  return null;
}

function priceText(modifier) {
  return modifier === 0 ? "normal prices" : `${goldChange(modifier)} per item`;
}

// Where a total comes from, and how sure it is.
function ledgerFoot(t, unit) {
  if (!t?.entries.length) return null;
  return h("details", { class: "ledger" },
    // The track draws what it could be; the fold says how many are open.
    h("summary", {}, isExact(t.range) ? `From ${plural(t.entries.length, "source")}`
      : `Could be ${rangeText(t.range)} · ${[t.unsure.length ? `${t.unsure.length} to answer` : null,
                                              t.unknown?.length ? `${t.unknown.length} not known` : null].filter(Boolean).join(", ")}`),
    h("ul", {}, t.entries.map(e => h("li", {},
      h("span", {}, e.label, isExact(e.range) ? null
        : h("span", { class: "open-tag" }, t.unsure.some(u => e.label.startsWith(u)) ? "to answer" : "not known")),
      h("span", { class: "num" }, `${rangeText(e.range)}${unit}`)))));
}

// A value on a track cut into stretches, each with its own effect:
// reputation's shop prices, prosperity's levels. Today's stretch is lit (and
// any passed, more quietly), the next one edged, a brass hexagon stands on
// the value, a brass rule spans what it could be while that's unsettled, and
// the next step is labelled in brass under where it starts. Positions are
// percentages along the track.
function stepTrack({ zones, at, maybe, step, ends, said }) {
  const place = (el, from, to) => { el.style.left = `${from}%`; el.style.width = `${to - from}%`; return el; };
  const marker = svg("0 0 20 22", '<path d="M10 1.5l8 4.6v9.8l-8 4.6-8-4.6V6.1z"/>', { class: "marker", "aria-hidden": "true" });
  marker.style.left = `${at}%`;
  // The end label on the step's side gives way to it, and right by an end
  // the step lines up with that end instead, so it stays on even a narrow
  // phone tile.
  const low = step && step.at < 50;
  const near = step && (step.at <= 33 || step.at >= 65);
  const atEnd = step && (step.at <= 15 || step.at >= 82);
  const label = step ? h("span", { class: `step${atEnd ? (low ? " start" : " end") : ""}` }, step.text) : null;
  if (label && !atEnd) label.style.left = `${step.at}%`;
  return h("div", { role: "img", "aria-label": said },
    h("div", { class: "track" },
      maybe ? place(h("b", { class: "maybe" }), maybe[0], maybe[1]) : null,
      zones.map(z => {
        const el = place(h("i", { class: z.cls || null }), z.from, z.to);
        el.style.width = `calc(${el.style.width} - var(--gap))`;
        return el;
      }),
      marker),
    h("div", { class: "track-scale", "aria-hidden": "true" },
      near && low ? null : h("span", {}, ends[0]),
      label,
      near && !low ? null : h("span", { class: "end" }, ends[1])));
}

// Reputation's stretches share a shop price (the price changes every 4
// points past ±3), drawn to scale.
function reputationTile(ledger) {
  const rep = ledger.reputation.value;
  const modifier = shopModifier(rep);
  const next = nextShopStep(rep);
  // 41 places, −20 to +20: a value sits in the middle of its place, and a
  // stretch runs from its first place's left edge to its last's right edge.
  const clamp = r => Math.max(-20, Math.min(20, r));
  const edge = r => (r + 20) / 41 * 100;
  const zones = [];
  for (let r = -20; r <= 20; r++) {
    const last = zones.at(-1);
    if (last && shopModifier(r) === last.modifier) last.to = r;
    else zones.push({ from: r, to: r, modifier: shopModifier(r) });
  }
  const range = ledger?.reputation?.range;
  return h("div", { class: "card tile rep-tile", "data-tab": "campaign" },
    h("div", { class: "tile-top" }, h("h2", { class: "label" }, "Reputation"), h("span", { class: "figure" }, signed(rep))),
    stepTrack({
      zones: zones.map(z => ({ from: edge(z.from), to: edge(z.to + 1),
                               cls: z.modifier === modifier ? "now" : next?.at === z.from ? "next" : null })),
      at: (edge(rep) + edge(rep + 1)) / 2,
      maybe: range && !isExact(range) ? [edge(clamp(range.lo)), edge(clamp(range.hi) + 1)] : null,
      step: next ? { at: edge(next.at), text: next.modifier === 0 ? "Normal" : goldChange(next.modifier) } : null,
      ends: ["−20", "+20"],
      said: `Reputation ${signed(rep)}${range && !isExact(range) ? `, could be ${rangeText(range)}` : ""}: shop ${modifier === 0 ? "prices normal" : priceText(modifier)}${next ? `, ${priceText(next.modifier)} from ${signed(next.at)}` : ""}.`,
    }),
    h("div", { class: "tile-foot" },
      h("strong", {}, modifier === 0 ? "Prices normal" : `Prices ${goldChange(modifier)}`)),
    ledgerFoot(ledger?.reputation, ""));
}

// Donations to the Sanctuary, a step for each 10 gold, up to the 100 that
// open Envelope B.
function sanctuaryMeter(city) {
  const steps = ENVELOPE_B_DONATIONS / DONATION;
  const given = Math.min(steps, Math.floor(city.donations / DONATION));
  const ready = !city.envelopeB && city.donations >= ENVELOPE_B_DONATIONS;
  return h("div", { class: "sanctuary", role: "img",
      "aria-label": `${city.donations} gold donated to the Sanctuary. ${city.envelopeB ? "Envelope B is open." : ready ? "Envelope B can be opened." : `${ENVELOPE_B_DONATIONS - city.donations} more opens Envelope B.`}` },
    h("div", { class: "sanctuary-head", "aria-hidden": "true" },
      h("span", {}, "Sanctuary"), h("span", { class: ready ? "ready" : null }, city.envelopeB ? "Envelope B open" : "Envelope B")),
    h("div", { class: "pips", "aria-hidden": "true" }, Array.from({ length: steps }, (_, i) => h("i", { class: i < given ? "on" : null }))));
}

// Prosperity's stretches are its levels, each the same width: drawn to
// scale, level 1's 4 checkmarks would be a sliver beside level 8's 14. The
// hexagon moves through the current level as its checkmarks are ticked.
function prosperityTile(city, ledger) {
  const marks = ledger.prosperity.value;
  const level = stepFor(marks, CHECKMARKS_FOR_PROSPERITY);
  const toNext = progressFor(marks, CHECKMARKS_FOR_PROSPERITY);
  const from = CHECKMARKS_FOR_PROSPERITY[level - 1];
  const levels = CHECKMARKS_FOR_PROSPERITY.length - 1;   // stretches: levels 1 to 8, then 9 at the end
  const pos = m => {
    const l = stepFor(m, CHECKMARKS_FOR_PROSPERITY);
    if (l > levels) return 100;
    const [lo, hi] = [CHECKMARKS_FOR_PROSPERITY[l - 1], CHECKMARKS_FOR_PROSPERITY[l]];
    return (l - 1 + (m - lo) / (hi - lo)) / levels * 100;
  };
  const range = ledger?.prosperity?.range;
  return h("div", { class: "card tile prosp-tile", "data-tab": "campaign" },
    h("div", { class: "tile-top" }, h("h2", { class: "label" }, "Prosperity"), h("span", { class: "figure" }, level)),
    stepTrack({
      zones: Array.from({ length: levels }, (_, i) => ({ from: i / levels * 100, to: (i + 1) / levels * 100,
        cls: i + 1 < level ? "done" : i + 1 === level ? "now" : i === level ? "next" : null })),
      at: pos(marks),
      maybe: range && !isExact(range) ? [pos(Math.max(0, range.lo)), pos(Math.min(64, range.hi))] : null,
      step: toNext ? { at: level / levels * 100, text: `Level ${level + 1}` } : null,
      ends: ["1", "9"],
      said: `Prosperity ${level}${toNext ? `: ${marks - from} of ${toNext.next - from} checkmarks towards level ${level + 1}` : ", the highest level"}.`,
    }),
    h("div", { class: "tile-foot" },
      h("strong", {}, toNext ? `${toNext.remaining} more to level ${level + 1}` : "Maximum level")),
    sanctuaryMeter(city),
    ledgerFoot(ledger?.prosperity, ""));
}

// Who is playing tonight, for the scenario level. Starts as the last
// session's party (those still active), or everyone.
let levelParty = null;
let difficulty = "normal";

function defaultLevelParty(data) {
  const active = data.characters.filter(playable).map(c => c.name);
  const last = [...data.sessions].filter(s => s.date && s.characters?.length)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const tonight = last ? last.characters.filter(n => active.includes(n)) : [];
  return new Set(tonight.length ? tonight : active);
}

// Tonight's scenario level from the Overview's picker (who is playing,
// difficulty), or null when no one is picked.
function tonight(data) {
  if (!levelParty) levelParty = defaultLevelParty(data);
  const levels = characterOrder(data).filter(c => !c.retired && levelParty.has(c.name)).map(c => characterStats(c).level);
  if (!levels.length) return null;
  const [, label, shift] = DIFFICULTIES.find(([key]) => key === difficulty);
  const level = Math.max(0, Math.min(7, recommendedLevel(levels) + shift));
  return { level, difficulty: label, ...scenarioStats(level) };
}

function levelTile(data) {
  // The inactive come last, quieter, and can be picked for a night: hidden
  // until asked for, unless already picked.
  const everyone = characterOrder(data).filter(c => !c.retired);
  if (!everyone.length) return null;
  if (!levelParty) levelParty = defaultLevelParty(data);
  const active = everyone.filter(c => !hiddenAway(c, levelParty.has(c.name)));
  const away = everyone.length - active.length;
  const playing = active.filter(c => levelParty.has(c.name));
  const levels = playing.map(c => characterStats(c).level);
  const recommended = recommendedLevel(levels);
  const shift = DIFFICULTIES.find(([key]) => key === difficulty)[2];
  const level = Math.max(0, Math.min(7, recommended + shift));
  const st = scenarioStats(level);
  const toggle = name => {
    if (levelParty.has(name)) levelParty.delete(name); else levelParty.add(name);
    render(data);
  };
  const stat = (label, value) => h("div", {}, h("span", { class: "label" }, label), h("span", { class: "num" }, value));
  const average = levels.length ? (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1).replace(/\.0$/, "") : null;
  const diffLabel = DIFFICULTIES.find(([key]) => key === difficulty)[1].toLowerCase();
  const levelAt = d => Math.max(0, Math.min(7, recommended + d));

  // Tonight's level, the tile's figure, beside what it means at the table;
  // under it, how it was reached. The other levels worth seeing are the
  // ones a difficulty gives, so each difficulty says its own.
  // Phones: one line, opening the tile as a sheet.
  const line = h("button", { type: "button", class: "level-line", "data-tab": "tonight", "data-key": "level-line", onclick: () => openSheet("level") },
    playing.length ? hex(level, "now") : null,
    h("span", { class: "level-line-text" },
      h("strong", {}, playing.length ? `Level ${level}` : "Pick who is playing"),
      playing.length ? h("span", {}, `${diffLabel} · ${plural(playing.length, "player")}`) : null),
    icon("chevron"));
  const tile = h("div", { class: "card tile level-tile", "data-tab": "tonight" },
    h("h2", { class: "label" }, "Scenario level"),
    playing.length
      ? [h("div", { class: "level-now" },
          h("span", { role: "img", "aria-label": `Scenario level ${level}` }, hex(level, "now")),
          // How it was reached, as a sum: the average of the levels picked
          // below, halved and rounded up, and the difficulty's step.
          h("p", { class: "level-why", role: "img",
                   "aria-label": `Average character level ${average}, halved and rounded up${shift ? `: ${recommended}, ${signed(shift)} on ${diffLabel}` : ""}` },
            h("span", { class: "eq" }, h("small", {}, "avg"), average),
            h("span", { class: "op", title: "Halved, rounded up" }, "÷ 2 ↑ ="),
            h("span", { class: "eq" }, recommended),
            shift ? [h("span", { class: "op" }, `${signed(shift)} ${diffLabel} =`), h("span", { class: "eq" }, level)] : null)),
        // Monster level is the scenario level, which the hex shows.
        h("div", { class: "level-stats" }, stat("Gold per coin", st.gold), stat("Trap damage", st.trap), stat("Bonus XP", st.xp))]
      : h("p", { class: "small muted" }, "Pick who is playing."),
    h("div", { class: "filters party-pick", role: "group", "aria-label": "Who is playing",
               style: `--wide: ${Math.min(active.length, 4)}; --narrow: ${active.length === 3 ? 3 : Math.min(active.length, 2)}` }, active.map(c =>
      h("button", { type: "button", "data-key": `playing-${c.name}`, "aria-pressed": String(levelParty.has(c.name)),
                    class: c.inactive ? "away" : null, title: c.inactive ? `${c.name} is inactive: pick them to count them tonight` : null,
                    "aria-label": `${c.name}, level ${characterStats(c).level}${c.inactive ? ", inactive" : ""}`,
                    onclick: () => toggle(c.name) },
        h("span", { class: "pick-name" }, c.name), h("span", {}, characterStats(c).level)))),
    inactiveToggle(data, away, "level-inactive"),
    playing.length
      ? h("div", { class: "segmented", role: "group", "aria-label": "Difficulty" }, DIFFICULTIES.map(([key, label, d]) =>
          h("button", { type: "button", "data-key": `difficulty-${key}`, "aria-pressed": String(difficulty === key),
                        "aria-label": `${label}: level ${levelAt(d)}`,
                        onclick: () => { difficulty = key; render(data); } },
            h("span", {}, label), h("span", { class: "seg-level" }, levelAt(d)))))
      : null);
  return [line, sheet("level", "Scenario level", tile)];
}
