// The Shop and the Enhancer.

// --- Shop -----------------------------------------------------------------------
// data/gloomhaven-items.json says what each item costs, how many copies exist
// and at what prosperity it reaches the shop. The shop holds every item up to
// the city's prosperity level plus the item designs the party has found;
// copies carried by active characters are out of stock (a retired character's
// items go back). Prices move with reputation.

// What the draft spends of a character's gold: purchases less sales, at
// the Shop's prices.
function draftSpend(data, name) {
  const priceOf = item => data.shop?.stock.find(i => sameItem(i.name, item));
  return (draft?.buys || []).filter(b => b.character === name && b.item).reduce((sum, b) => sum + (priceOf(b.item)?.price || 0), 0)
       - (draft?.sells || []).filter(x => x.character === name && x.item).reduce((sum, x) => sum + (priceOf(x.item)?.sells || 0), 0);
}

// Whose shopping the Shop shows: until someone is picked, this phone's
// character; then a name, or "" for no one.
let shopFor;
let shopFilter = "all";   // "all", or "can": only what the shopper can buy

function renderShop(data) {
  const shop = data.shop;
  if (!shop) return null;

  // Whoever is shopping (this phone's character to start with, or anyone
  // picked above the list): their gold, their room, and on each item whether
  // they could take it, with Buy, or Sell on what they carry.
  const everyone = characterOrder(data).filter(c => !c.retired);
  const shopper = everyone.find(c => c.name === (shopFor === undefined ? me : shopFor));
  const active = everyone.filter(c => !hiddenAway(c, c === shopper));
  // The draft counts: what it buys takes slots, gold and copies; what it
  // sells frees them.
  const buys = (draft?.buys || []).filter(b => b.character && b.item);
  const sells = (draft?.sells || []).filter(x => x.character && x.item);
  const mineBuys = shopper ? buys.filter(b => b.character === shopper.name) : [];
  const mineSells = shopper ? sells.filter(x => x.character === shopper.name) : [];
  const owned = shopper ? [...shopper.items.filter(i => !mineSells.some(x => sameItem(x.item, i))), ...mineBuys.map(b => b.item)] : [];
  const room = shopper ? slotUse({ ...shopper, items: owned }, characterStats(shopper).level) : null;
  const spent = shopper ? draftSpend(data, shopper.name) : 0;
  const gold = shopper ? shopper.gold - spent : 0;
  const left = item => item.left - buys.filter(b => sameItem(b.item, item.name)).length + sells.filter(x => sameItem(x.item, item.name)).length;
  const full = item => { const [k, n] = slotNeed(item.slot); return room && k in room.used && room.used[k] + n > room.limits[k]; };
  const dear = item => shopper && item.price > gold;
  const has = item => shopper?.items.some(i => sameItem(i, item.name));
  const bought = item => mineBuys.some(b => sameItem(b.item, item.name));
  const sold = item => mineSells.some(x => sameItem(x.item, item.name));
  const canBuy = item => shopper && !has(item) && !bought(item) && left(item) > 0 && !dear(item);

  // On the right: the price, and under it what the shopper can do. It goes
  // into the draft, as "Record it" does for a perk.
  const action = item => !shopper || !rawCampaign || !isRecorder() ? null
    : has(item) ? (sold(item) ? h("span", { class: "in-draft" }, "Sold in the draft")
        : h("button", { type: "button", class: "buy sell", "data-key": `sell-${item.id}`, "aria-label": `Sell ${item.name} for ${item.sells} gold`,
            onclick: () => recordSell(data, shopper.name, item.name) }, `Sell for ${goldText(item.sells)}`))
    : bought(item) ? h("span", { class: "in-draft" }, "In the draft")
    : canBuy(item) ? h("button", { type: "button", class: "buy", "data-key": `buy-${item.id}`, "aria-label": `Buy ${item.name} for ${shopper.name}`,
        onclick: () => recordBuy(data, shopper.name, item.name) }, "Buy")
    : null;
  // Each item's row: its name, and under it a mark per copy (copyMarks). Its
  // state shows rather than says: the shopper's own copies are verdigris,
  // what they can't afford or the shop has none of reads faded with no Buy,
  // and a slot already full is said once, in the group's heading.
  const state = item => has(item) ? "owned" : bought(item) ? "bought" : left(item) <= 0 ? "sold-out"
    : dear(item) ? "too-dear" : null;
  const row = item => {
    const s = state(item);
    return h("li", { class: s && s !== "bought" ? s : null },
      h("span", {},
        h("strong", {}, item.name, item.design ? h("span", { class: "tag" }, "design") : null,
          item.back ? h("span", { class: "tag", title: "Not sold here otherwise: a copy sold, or left by a retired character" }, "returned") : null),
        h("span", { class: "sub stock" }, copyMarks(item),
          // What it sells for: on the shopper's own items that's their Sell button.
          !shopper && item.held.length ? h("span", {}, `sells for ${goldText(item.sells)}`) : null)),
      h("span", { class: "price-col" }, h("span", { class: "price num" }, String(item.price), h("span", { class: "unit" }, "g")), action(item)));
  };

  // One mark per copy of the item, as cards on a shelf: those someone
  // carries show their class icon (the shopper's in verdigris, one bought in
  // the draft dashed), and an empty one is still in the shop. The words are
  // there for screen readers and on hover.
  const copyMarks = item => {
    const sold = new Set(sells.filter(x => sameItem(x.item, item.name)).map(x => x.character));
    const carried = item.held.filter(name => !sold.has(name)).map(name => ({ name, drafted: false }));
    const drafted = buys.filter(b => sameItem(b.item, item.name)).map(b => ({ name: b.character, drafted: true }));
    const marks = [...carried, ...drafted].map(x => ({ ...x, c: data.characters.find(c => c.name === x.name) }));
    const inShop = Math.max(0, left(item));
    const names = marks.map(x => x.name).join(", ").replace(/, ([^,]*)$/, " and $1");
    const said = `${inShop ? `${inShop} of ${item.count} in the shop` : "None in the shop"}${names ? `; carried by ${names}` : ""}`;
    return h("span", { class: "copies", role: "img", "aria-label": said, title: said },
      marks.map(x => h("i", { class: `held${x.name === shopper?.name ? " mine" : ""}${x.drafted ? " drafted" : ""}` }, x.c ? classIcon(x.c.class) : null)),
      Array.from({ length: inShop }, () => h("i")));
  };

  // "Can buy" leaves what the shopper could buy, and what they already
  // have in the draft.
  const showing = item => shopFilter !== "can" || !shopper || canBuy(item) || bought(item);
  const groups = SLOTS.map(([slot, label]) => [slot, label, shop.stock.filter(i => i.slot === slot && showing(i))]).filter(([, , list]) => list.length);
  const priceNote = shop.modifier === 0 ? "normal prices" : `${goldChange(shop.modifier)} per item`;
  const doubt = priceDoubt(shop, data.ledger?.reputation);
  const pick = name => () => { shopFor = shopper?.name === name ? "" : name; render(data, "shop"); };

  // Why, under the heading on a tap: a phone has no hover.
  const why = doubt ? h("p", { class: "small muted price-why" }, doubt.why) : null;
  if (why) why.hidden = true;
  return [
    // How far prices could be off, said once beside them all.
    sectionHead("Shop", [`Prosperity ${shop.level} · ${priceNote}`,
      doubt ? h("button", { type: "button", class: "price-doubt", title: doubt.why, "aria-expanded": "false", "aria-label": `Prices ${doubt.text} Why?`,
        onclick: e => { why.hidden = !why.hidden; e.currentTarget.setAttribute("aria-expanded", String(!why.hidden)); } }, doubt.text) : null]),
    why,
    active.length ? h("div", { class: "shop-for" },
      h("span", { class: "label", id: "shop-for-label" }, "Shopping for"),
      h("div", { class: "filters", role: "group", "aria-labelledby": "shop-for-label" }, active.map(c =>
        h("button", { type: "button", "data-key": `shop-for-${c.name}`, "aria-pressed": String(shopper?.name === c.name), onclick: pick(c.name) },
          classIcon(c.class), c.name)),
        inactiveToggle(data, everyone.length - active.length, "shop-inactive"))) : null,
    shopper ? h("div", { class: "shop-me" },
      h("span", {}, `${shopper.name} has `, h("strong", {}, goldText(shopper.gold)), spent ? `, ${goldText(gold)} after the draft` : null),
      slotStrip({ ...shopper, items: owned }, characterStats(shopper).level),
      h("div", { class: "segmented", role: "group", "aria-label": "Show" }, [["all", "Everything"], ["can", "Can buy"]].map(([key, label]) =>
        h("button", { type: "button", "data-key": `shop-show-${key}`, "aria-pressed": String(shopFilter === key),
          onclick: () => { shopFilter = key; render(data, "shop"); } }, label))),
      isRecorder() ? null : h("p", { class: "small muted shop-rec" }, "Buying and selling go in on the phone recording the evening.")) : null,
    shop.pricesUnsure ? pricesNote(shop, data.ledger?.reputation) : null,
    shop.questions.map(q => nudge("question", "Check an item", q)),
    groups.length ? null : empty(`Nothing ${shopper?.name} can buy right now.`),
    h("div", { class: "shop" }, groups.map(([slot, label, list]) =>
      h("div", { class: "card" },
        h("h3", { class: "label" }, gameIcon(`slot-${slot}`), label,
          shopper && full({ slot }) ? h("span", { class: "slot-note" }, slotNote(owned, slot)) : null),
        h("ul", { class: "rows" }, list.map(row))))),
    shop.coming ? h("p", { class: "aside" }, `${plural(shop.coming, "more item")} arrive${shop.coming === 1 ? "s" : ""} at prosperity ${shop.level + 1}.`) : null,
  ];
}

// Prices that may be off because reputation isn't certain. If something can
// still be settled, say where; if what's open can never be known, just say
// how far off prices could be, quietly, as there's nothing to do about it.
function pricesNote(shop, rep) {
  if (rep?.unsure.length || !rep?.unknown?.length) {
    return nudge("question", "Prices may be off",
      `Reputation could be ${rangeText(shop.range)}, which would change prices. Settle the open events under Reputation.`);
  }
  // What can never be known needs no box: the Shop's heading carries a tag.
  return null;
}

// How far a price could be off while reputation isn't certain: "−1?", with
// the reason on hover. null when prices are sure.
function priceDoubt(shop, rep) {
  if (!shop.pricesUnsure) return null;
  const lower = shop.modifier - shopModifier(shop.range.hi);
  const higher = shopModifier(shop.range.lo) - shop.modifier;
  if (lower <= 0 && higher <= 0) return null;
  const open = [...(rep?.unsure || []), ...(rep?.unknown || [])].join(", ").replace(/, ([^,]*)$/, " and $1");
  const could = [lower > 0 ? `${goldText(lower)} lower` : null, higher > 0 ? `${goldText(higher)} higher` : null].filter(Boolean).join(" or ");
  return { text: `${[lower > 0 ? `−${lower}` : null, higher > 0 ? `+${higher}` : null].filter(Boolean).join("/")}?`,
           why: `Reputation could be ${rangeText(shop.range)}${open ? ` (${open} open)` : ""}: may be ${could}.` };
}

// A character's item slots, as on the sheet: head, body, legs, two hands and
// the small items their level allows, lit where something's carried (ember
// where they carry more than there's room for).
function slotStrip(c, level) {
  const { used, limits } = slotUse(c, level);
  const slots = [];
  for (const [k, icon, count] of [["head", "head", 1], ["body", "body", 1], ["legs", "legs", 1], ["hands", "onehand", 2], ["small", "small", limits.small]]) {
    for (let i = 0; i < Math.max(count, used[k]); i++) slots.push([icon, i < used[k], i >= count]);
  }
  return h("span", { class: "slots", role: "img", "aria-label": capitalize(`${freeRoom({ used, limits })}.`) },
    slots.map(([icon, on, over]) => h("span", { class: `slot${on ? " on" : ""}${over ? " over" : ""}` }, gameIcon(`slot-${icon}`))));
}

// Beside a slot's heading in the Shop, when the shopper's is full: what fills
// it. Its items can still be bought (owning isn't limited), not equipped too.
function slotNote(owned, slot) {
  const hands = s => s === "onehand" || s === "twohand";
  const wearing = owned.filter(i => hands(slot) ? hands(itemSlot(i)) : itemSlot(i) === slot);
  if (hands(slot)) return "hands full";
  if (slot === "small") return "small items full";
  return wearing.length ? `wearing ${wearing.join(", ")}` : "full";
}

// The room left in a character's slots, in words.
function freeRoom({ used, limits }) {
  const free = [
    ...["head", "body", "legs"].filter(k => used[k] < limits[k]),
    limits.hands - used.hands > 0 ? (limits.hands - used.hands === 2 ? "two hands" : "one hand") : null,
    limits.small - used.small > 0 ? plural(limits.small - used.small, "small item") : null,
  ].filter(Boolean);
  return free.length ? `room for ${free.join(", ").replace(/, ([^,]*)$/, " and $1")}` : "no free slots";
}

// The Enhancer: what a sticker costs, from what's printed on the card.
// "Record it" puts the enhancement in the draft, which takes the gold off.
const enhancing = { sticker: "attack", level: "1", multi: false, previous: "0", hexes: "3", classCards: "0", already: false };

function enhancer(data) {
  if (!data.city.globalAchievements.some(a => a.id === "the-power-of-enhancement")) return null;
  const set = key => e => { enhancing[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value; render(data, "shop"); };
  const field = (label, control) => h("label", { class: "field" }, h("span", {}, label), control);
  const select = (key, options) => h("select", { "data-key": `enh-${key}`, onchange: set(key) },
    options.map(([value, label]) => h("option", { value, selected: String(enhancing[key]) === String(value) }, label)));
  const counting = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [String(from + i), String(from + i)]);

  const key = enhancing.sticker;
  const cost = enhancementCost(enhancing);
  // The active party, lit if they can pay.
  const payers = characterOrder(data).filter(c => !c.retired && !c.inactive);

  return h("div", { class: "enhancer-wrap", id: "enhancing" },
    h("h3", { class: "subtitle" }, "Enhancing a card"),
    h("div", { class: "card enhancer" },
      h("div", { class: "enhancer-form" },
        h("div", { class: "rec-row" },
          field("Sticker", h("select", { "data-key": "enh-sticker", onchange: set("sticker") },
            ENHANCEMENTS.map(([group, list]) => h("optgroup", { label: group },
              list.map(([k, label]) => h("option", { value: k, selected: k === key }, label)))))),
          // A level X card counts as level 1.
          field("Card level", select("level", [["1", "1 or X"], ...counting(2, 9)])),
          field("Already on it", select("previous", counting(0, 3))),
          key === "hex" ? field("Hexes it has", select("hexes", counting(1, 12))) : null),
        canDouble(key) ? h("label", { class: "rec-check" },
          h("input", { type: "checkbox", "data-key": "enh-multi", checked: Boolean(enhancing.multi), onchange: set("multi") }),
          "The ability targets more than one figure") : null,
        // A class's enhanced cards can't outnumber the prosperity level (p. 46).
        h("div", { class: "rec-row" },
          field("Cards this class has enhanced", select("classCards", counting(0, 9))),
          h("label", { class: "rec-check" },
            h("input", { type: "checkbox", "data-key": "enh-already", checked: Boolean(enhancing.already), onchange: set("already") }),
            "This card is one of them")),
        !enhancing.already && num(enhancing.classCards) >= stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY)
          ? nudge("question", "Over the limit", `A class can have only as many enhanced cards as the prosperity level (${stepFor(data.city.prosperityCheckmarks, CHECKMARKS_FOR_PROSPERITY)}), counting every character of the class, retired ones too.`)
          : null,
      ),
      h("div", { class: "enhancer-cost" },
        h("div", { class: "enhancer-total", "aria-live": "polite" }, h("span", { class: "figure" }, cost.total), h("span", {}, "g")),
        h("ul", { class: "rows" }, cost.steps.map(([text, gold]) => h("li", {}, h("span", {}, text), h("span", { class: "num" }, `+${goldText(gold)}`)))),
        payers.length ? h("ul", { class: "afford", "aria-label": "Who has the gold" }, payers.map(c => {
          const ok = c.gold >= cost.total;
          return h("li", { class: ok ? "ok" : "short", "aria-label": `${c.name}, ${c.gold} gold${ok ? "" : ", not enough"}` },
            classIcon(c.class), h("span", {}, c.name), h("span", { class: "afford-gold" }, c.gold));
        })) : null,
        // Recorded by the phone that records the evening (any wide screen).
        rawCampaign && (!phone.matches || draft) ? h("button", { type: "button", class: "todo-do enhancer-record", "data-key": "enh-record",
          onclick: () => recordEnhancement(data, enhancementText(key), cost.total) }, "Record it") : null)));
  function enhancementText(k) {
    const label = ENHANCEMENTS.flatMap(([, list]) => list).find(([key]) => key === k)?.[1] || k;
    return [label, enhancing.multi && canDouble(k) ? "more than one target" : null, `level ${enhancing.level} card`,
            Number(enhancing.previous) ? `${enhancing.previous} already on it` : null].filter(Boolean).join(", ");
  }
}
