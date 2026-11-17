// Tests of campaign/history.js: what the record says happened: level-ups,
// who was at a session, a retirement read from the log, and personal
// quests counted from the record.
async function historyTests({ load, same, copy, written, raw, draft, res, file, evening }) {
  // Who looted a treasure is said once: by the line for it in their log, or,
  // with no line (looted before the logs, or a tile that changed no sheet),
  // on the scenario's treasure. Said both ways and differently, it's asked about.
  // (#4's treasure 38, made open again, then settled in the form: Kaktus.)
  const open38 = copy(raw);
  open38.scenarios.find(s => s.number === 4).treasures = ["38", "46"];
  const azorica = open38.characters.find(c => c.name === "Azorica");
  azorica.start.items = azorica.start.items.filter(i => i !== "Ring of Skulls");
  const kept = toFile(applyDraft(fromFile(copy(open38)), { ...copy(draft), claims: { "#4:38": { character: "Kaktus" } } }, buildData(copy(open38))).out);
  const treasureSays = file => buildData(copy(file)).treasureInfo.get(4);
  const disagree = copy(kept);
  disagree.scenarios.find(s => s.number === 4).treasures[0] = { number: "38", character: "Craig" };
  same("treasure: who looted it is said once, by the log or else the scenario",
    [treasureSays(kept)[0], treasureSays(raw)[0], raw.scenarios.find(s => s.number === 4).treasures[0],
     fileQuestions(disagree).filter(q => q.includes("treasure 38"))],
    ["38: Ring of Skulls, to Kaktus", "38: Ring of Skulls, to Azorica", { number: "38", character: "Azorica" },
     ["#4's treasure 38 says Craig looted it, but the line for it is in Kaktus's log. Correct whichever is wrong."]]);

  // Who passed a level at a session is worked out from XP over time, as the
  // evening's summary says it; the file stores none. A list written in on a
  // session whose plays have no level (the record can't tell) stands; one
  // the XP contradicts is asked about.
  const fileUps = copy(file);
  fileUps.sessions.at(-1).levelUps = [{ character: "Craig", level: 5 }];
  const handUps = copy(raw);
  handUps.sessions.find(s => s.date === "2026-11-13").levelUps = [{ character: "Craig", level: 4 }];
  same("sessions: who passed a level is worked out from XP, as the summary says",
    [file.sessions.at(-1).levelUps ?? null, buildData(copy(file)).sessions.at(-1).levelUps, res.log.filter(l => l.includes("reaches level")),
     fileQuestions(fileUps).filter(q => q.includes("passed a level")).length,
     [buildData(copy(handUps)).sessions.find(s => s.date === "2026-11-13").levelUps, fileQuestions(handUps).filter(q => q.includes("passed a level")).length,
      toFile(fromFile(copy(handUps))).sessions.find(s => s.date === "2026-11-13").levelUps]],
    [null, [{ character: "Azorica", level: 4 }], ["Azorica reaches level 4: add an ability card of level 4 or lower, and take a perk"], 1,
     [[{ character: "Craig", level: 4 }], 0, [{ character: "Craig", level: 4 }]]]);
  // Who was at a session is said once: by its plays' results, which name
  // everyone there; "characters" only where a play has none. Both, naming
  // different people, is asked about.
  const nov13 = raw.sessions.find(s => s.date === "2026-11-13");
  const odd = copy(raw);
  odd.sessions.find(s => s.date === "2026-11-13").characters = ["Azorica", "Craig", "Kaktus"];
  same("sessions: who was there is said once, by the results",
    ["characters" in nov13, buildData(copy(raw)).sessions.find(s => s.date === "2026-11-13").characters,
     raw.sessions.find(s => s.title === "Early sessions").characters ?? null,
     fileQuestions(odd).filter(q => q.startsWith("The session of 2026-11-13")).length,
     toFile(fromFile(copy(odd))).sessions.find(s => s.date === "2026-11-13").characters],
    [false, ["Azorica", "Craig", "Flik Flak"], null, 1, ["Azorica", "Craig", "Kaktus"]]);
  // Retiring is said once: the retirement line in the log, which the page
  // reads retired and retiredOn from, written even with nothing to hand
  // back; on the character only for one who retired before the logs. Both,
  // and differing, is asked about.
  const broke = copy(raw);
  Object.assign(broke.characters.find(c => c.name === "Kaktus").start, { gold: 0, items: [] });
  const kaktusRetires = evening(broke, { retirements: [{ character: "Kaktus", unlocks: "envelope-x" }] });
  const kaktusFile = kaktusRetires.characters.find(c => c.name === "Kaktus");
  const kaktusSheet = buildData(copy(kaktusRetires)).characters.find(c => c.name === "Kaktus");
  const preLog = copy(raw);
  Object.assign(preLog.characters.find(c => c.name === "Kaktus"), { retired: true, retiredOn: "2026-09-01" });
  const contradicts = copy(kaktusRetires);
  Object.assign(contradicts.characters.find(c => c.name === "Kaktus"), { retired: false, retiredOn: "2026-11-01" });
  same("retiring: said once, by the retirement line, read from the log",
    [kaktusFile.log, ["retired" in kaktusFile, "retiredOn" in kaktusFile], [kaktusSheet.retired, kaktusSheet.retiredOn],
     (({ retired, retiredOn }) => [retired, retiredOn])(toFile(fromFile(copy(preLog))).characters.find(c => c.name === "Kaktus")),
     fileQuestions(contradicts).filter(q => q.startsWith("Kaktus")).length],
    [[{ date: "2026-11-20", for: "retirement" }], [false, false], [true, "2026-11-20"], [true, "2026-09-01"], 2]);

  // Every quest card, for every character in campaign.json and the sample,
  // as the page counts it from the record (which card a character holds is
  // kept on their phone, so each is tried). Progress is left out, so nothing
  // here ties a character to a card.
  const questCase = p => ({
    steps: p.steps.map(x => [`${x.n ?? "?"}/${x.count}`, x.auto ? null : "by hand", x.after ? "after the one before" : null,
      x.maybe.length ? `maybe ${x.maybe.map(n => `#${n}`).join(" ")}` : null, x.extra ? `up to ${x.extra} more` : null,
      x.opens ? `opens #${x.opens}` : null].filter(Boolean).join(", ")),
    text: p.text,
  });
  const questTable = {}, unwritten = [];
  for (const [name, file] of [["campaign", "campaign.json"], ["sample", "examples/sample-campaign.json"]]) {
    const json = copy(await load(file));
    for (const c of json.characters) c.personalQuest = "";
    const data = buildData(json);
    for (const [id, q] of Object.entries(questRef.quests)) {
      for (const c of data.characters) {
        const p = questProgress(data, c, id);
        (questTable[name] ||= {})[`${id} ${q.name}`] ||= {};
        questTable[name][`${id} ${q.name}`][c.name] = questCase(p);
        // What the page offers to record, it can read back, and it fits.
        if (p.text && !(questSteps(p.text)?.length === p.steps.length && p.fits(p.text))) unwritten.push(`${id} for ${c.name}: ${p.text}`);
      }
    }
  }
  // And by hand: for each card, a made-up character (so no real one is tied
  // to it) with nothing the record can count, and 1 written for every step,
  // joined as on the card; then the same joined the other way.
  {
    const data = buildData(copy(raw));
    const test = { ...data.characters[0], name: "Test", items: [], gold: 0, checkmarks: 0, donated: 0, enhanced: 0 };
    for (const [id, q] of Object.entries(questRef.quests)) {
      const own = q.steps.map((x, i) => `${i ? (x.after ? ", then " : " + ") : ""}${Math.min(1, x.count)}/${x.count}`).join("");
      const other = own.replace(/, then | \+ /g, j => j === " + " ? ", then " : " + ");
      const p = questProgress(data, { ...test, personalQuest: own }, id);
      // And what the page offers to set for each step: a count it gives, a
      // check box, or − and + (from, to, and where it stands).
      const inputs = questInputs(p, own);
      (questTable.byHand ||= {})[`${id} ${q.name}`] = { written: own, ...questCase(p), fits: p.fits(own),
        ...(q.steps.length > 1 ? { joinedOtherwise: other, fitsJoinedOtherwise: p.fits(other) } : {}),
        inputs: inputs.steps.map(x => `${x.kind}, ${x.min} to ${x.max}, at ${x.value}`), inputsWrite: inputs.text };
    }
  }

  // The inputs, set: a tap writes the progress, within what each step allows.
  {
    const json = copy(raw);
    json.characters.push({ name: "Test", class: "Brute", start: { xp: 0, gold: 0, checkmarks: 0, items: [], perks: [] }, log: [], personalQuest: "" });
    json.sessions.push({ date: "2026-11-21", characters: ["Test"], scenarios: [{ number: 4, result: "success", casual: true }] });
    const data = buildData(json);
    const test = data.characters.find(c => c.name === "Test");
    const on = (card, written) => questInputs(questProgress(data, { ...test, personalQuest: written }, card), written);
    const seeker = on("510", "");
    const slayer = on("523", "1/1 + 0/1 + 0/1 + 0/1 + 0/1 + 0/1");
    const stand = on("517", "5/20");
    same("quests: the inputs, set with a tap", [
      seeker.steps.map(x => [x.kind, x.value]), seeker.text,
      slayer.steps.map(x => x.kind), questSet(slayer, 2, 1),
      questSet(stand, 0, 6), questSet(stand, 0, 21), questSet(stand, 0, -1),
    ], [
      [["fixed", 1], ["fixed", 0]], "1/3, then 0/1",
      ["check", "check", "check", "check", "check", "check"], "1/1 + 0/1 + 1/1 + 0/1 + 0/1 + 0/1",
      "6/20", "20/20", "0/20",
    ]);
    // Without the card: the steps the record has, a step after ", then"
    // waiting until the one before is done; nothing, with no steps written.
    const shape = written => questInputs(null, written)?.steps.map(x => `${x.kind}, ${x.min} to ${x.max}, at ${x.value}`) ?? null;
    same("quests: without the card, the inputs the record's steps give",
      [shape("2/15"), shape("1/3, then 0/1"), shape("3/3, then 0/1"), shape("1/2 + 0/1"), shape(""), shape("5?")],
      [["count, 0 to 15, at 2"], ["count, 0 to 3, at 1", "fixed, 0 to 0, at 0"], ["count, 0 to 3, at 3", "check, 0 to 1, at 0"],
       ["count, 0 to 2, at 1", "check, 0 to 1, at 0"], null, null]);
  }
  same("quests: every card, counted from the record, matches tests/golden/quests.json", questTable,
    await load("tests/golden/quests.json").catch(() => null), "tests/golden/quests.json");
  same("quests: the count the page offers to record reads back, and fits", unwritten, []);

  // Steps the record can't count take the count written by hand, when it's
  // written in the card's steps and joins; joined otherwise, it doesn't fit.
  {
    const data = buildData(copy(raw));
    const c = { ...data.characters[0], name: "Test", personalQuest: "7/20" };
    const stand = questProgress(data, c, "517");
    const merchant = questProgress(data, { ...c, personalQuest: "" }, "511");
    const seeker = questProgress(data, { ...c, personalQuest: "" }, "510");
    same("quests: a count by hand, and steps joined as on the card",
      [stand.steps[0].n, stand.fits("7/20"), stand.fits("8/20"), merchant.text.includes(", then "),
       merchant.fits(merchant.text), merchant.fits(merchant.text.replaceAll(" + ", ", then ")), seeker.fits("0/3 + 0/1"), seeker.fits("0/3, then 0/1")],
      [7, true, false, false, true, false, false, true]);
  }

  // Who completed a scenario: those its results or players name, or with
  // neither, who was at the session it was won in.
  {
    const json = copy(raw);
    json.sessions.push({ date: "2026-11-21", characters: ["Azorica", "Craig", "Flik Flak", "Kaktus"], scenarios: [
      { number: 5, result: "success", results: [{ character: "Azorica", xp: 8, gold: 4 }] },
      { number: 6, result: "success", casual: true, players: ["Craig", "Kaktus"] },
      { number: 7, result: "success" },
      { number: 9, result: "success", results: [{ character: "Flik Flak", xp: 8, gold: 4 }], players: ["Flik Flak", "Kaktus"] },
    ] });
    const by = completedBy(buildData(json));
    same("quests: who completed a scenario, by results and players, else the session",
      [5, 6, 7, 9].map(n => [...by.get(n)]), [["Azorica"], ["Craig", "Kaktus"], ["Azorica", "Craig", "Flik Flak", "Kaktus"], ["Flik Flak", "Kaktus"]]);
  }

  // What a quest card opens decides a retirement's unlock: a class box by its
  // id, or Envelope X; a retirement with nothing to open is pointed out. A
  // made-up character retires, so nothing here ties a real one to a card.
  {
    const json = copy(raw);
    json.characters.push({ name: "Test", class: "Brute", start: { xp: 0, gold: 0, checkmarks: 0, items: [], perks: [] }, log: [], personalQuest: "" });
    const retire = unlocks => applyDraft(fromFile(copy(json)), { ...copy(draft), retirements: [{ character: "Test", unlocks }] }, buildData(copy(json)));
    const none = retire("");
    const sun = retire(questUnlocks("515"));
    same("quests: a card opens what its data says, and a retirement opens it",
      [questUnlocks("515"), questUnlocks("513"), questUnlocks("999"),
       none.warnings.filter(w => w.includes("nothing says what their personal quest opens")).length,
       (sun.out.city.unlockedClasses || []).map(u => u.name ?? u).includes(className("sun"))],
      ["sun", "envelope-x", "", 1, true]);
  }

  // The form records only progress it can read.
  {
    const res = applyDraft(fromFile(copy(raw)), { ...copy(draft), quests: { Craig: "3/4?", "Flik Flak": "1/3 + 1/1" } }, buildData(copy(raw)));
    same("quests: the form records only progress it can read, and says so",
      [res.out.characters.map(c => c.personalQuest), res.warnings.filter(w => w.includes("personal quest progress")).length],
      [["2/15", "2/4", "1/3 + 1/1", "5/20", ""], 1]);
  }

  // A step that waits on another waits on the one just before it, in every
  // card: the page joins it to that one with ", then".
  same("quests: every step that waits, waits on the one before",
    Object.entries(questRef.quests).flatMap(([id, q]) => q.steps.map((x, i) => [x, i]).filter(([x, i]) => x.after && !(x.after.length === 1 && x.after[0] === i)).map(([, i]) => `${id} step ${i + 1}`)), []);

  // Quest progress is written in counts, joined in one of two ways.
  same("quests: progress read only as written in the ways it can be",
    [questSteps("2/15"), questSteps("1/3, then 0/1"), questSteps("2/2 + 1/2"), questSteps("1/3 & 0/1"), questSteps("1/3,then 0/1"), questSteps("1 / 3"), questSteps("5?")],
    [[[2, 15]], [[1, 3], [0, 1]], [[2, 2], [1, 2]], null, null, null, null]);
  same("quests: the joins, as written", questParts("1/2 + 0/2, then 0/1")?.joins, [" + ", ", then "]);
}
