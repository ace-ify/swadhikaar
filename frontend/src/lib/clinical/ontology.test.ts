/**
 * Self-check for the clinical ontology. Run: npm test (node --test).
 *
 * The check that matters most is the last one. A red-flag rule referring to a choice
 * value that does not exist — "breathlessness" where the ontology says "breathless" —
 * is a rule that can never fire. Nothing errors, no screen breaks, and a patient with
 * chest pain and dyspnoea queues normally. That is the written-but-never-read failure
 * in its most dangerous form, and a typo is all it takes, so the values are checked
 * against the ontology rather than trusted.
 *
 * No network, no rendering, no fixtures.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// Specifier kept in a variable so tsc doesn't reject the .ts extension
// (moduleResolution: bundler) while node's native type stripping still needs it.
const spec = "./ontology.ts";
const {
  ONTOLOGY,
  RED_FLAG_RULES,
  SECTION_HEADINGS,
  SECTION_ORDER,
  DASHAVIDHA,
  DASHAVIDHA_FACTORS,
  completeness,
  evaluateRedFlags,
  isApplicable,
  nextItem,
  promptOutline,
  vayaStage,
} = (await import(spec)) as typeof import("./ontology");
type Answers = import("./ontology").Answers;

const byCode = new Map(ONTOLOGY.map((i) => [i.code, i]));

test("codes are unique", () => {
  assert.equal(byCode.size, ONTOLOGY.length);
});

test("every item belongs to a declared section", () => {
  for (const item of ONTOLOGY) {
    assert.ok(SECTION_ORDER.includes(item.section), `${item.code} -> ${item.section}`);
  }
});

test("choice-based items actually carry choices", () => {
  for (const item of ONTOLOGY) {
    if (item.kind === "single" || item.kind === "multi") {
      assert.ok(item.choices?.length, `${item.code} is ${item.kind} with no choices`);
    }
  }
});

test("choice values are unique within an item", () => {
  for (const item of ONTOLOGY) {
    if (!item.choices) continue;
    const values = item.choices.map((c) => c.value);
    assert.equal(new Set(values).size, values.length, `${item.code} has a duplicate value`);
  }
});

test("every choice is labelled in both languages", () => {
  for (const item of ONTOLOGY) {
    assert.ok(item.prompt.en.trim() && item.prompt.hi.trim(), `${item.code} prompt`);
    for (const c of item.choices ?? []) {
      assert.ok(c.label.en.trim() && c.label.hi.trim(), `${item.code}/${c.value} label`);
    }
  }
});

test("a when clause points at an item that is asked earlier", () => {
  const order = new Map(ONTOLOGY.map((i, idx) => [i.code, idx]));
  for (const item of ONTOLOGY) {
    if (!item.when) continue;
    const target = order.get(item.when.code);
    assert.notEqual(target, undefined, `${item.code} depends on unknown ${item.when.code}`);
    assert.ok(
      target! < order.get(item.code)!,
      `${item.code} depends on ${item.when.code}, which is asked later — it could never fire`,
    );
  }
});

test("a when clause only names values its target actually offers", () => {
  for (const item of ONTOLOGY) {
    if (!item.when) continue;
    const target = byCode.get(item.when.code)!;
    const offered = new Set((target.choices ?? []).map((c) => c.value));
    for (const v of [...(item.when.equalsAny ?? []), ...(item.when.includesAny ?? [])]) {
      assert.ok(offered.has(v), `${item.code} waits for ${item.when.code}=${v}, never offered`);
    }
  }
});

test("branching skips what a physician would not ask", () => {
  const rash: Answers = { "cc.main": "itching all over", "hpi.site": ["whole_body"] };
  const radiation = byCode.get("hpi.radiation")!;
  assert.equal(isApplicable(radiation, rash, "allopathic"), false);

  const chest: Answers = { "cc.main": "chest pain", "hpi.site": ["chest"] };
  assert.equal(isApplicable(radiation, chest, "allopathic"), true);
});

test("a bare when waits for any answer at all", () => {
  const adherence = byCode.get("da.adherence")!;
  assert.equal(isApplicable(adherence, {}, "allopathic"), false);
  assert.equal(isApplicable(adherence, { "da.current_meds": "" }, "allopathic"), false);
  assert.equal(isApplicable(adherence, { "da.current_meds": "metformin" }, "allopathic"), true);
});

test("ayush-only items stay out of an allopathic interview", () => {
  const ayushOnly = ONTOLOGY.filter((i) => i.modes?.length === 1 && i.modes[0] === "ayush");
  assert.ok(ayushOnly.length > 0, "expected at least one ayush-only item");
  for (const item of ayushOnly) {
    assert.equal(isApplicable(item, { "cc.main": "x" }, "allopathic"), false);
    assert.equal(isApplicable(item, { "cc.main": "x" }, "ayush"), true);
  }
});

test("the walk starts at the chief complaint and terminates", () => {
  const answers: Answers = {};
  assert.equal(nextItem(answers, "allopathic")?.code, "cc.main");

  // Answer whatever it asks, up to a bound that is comfortably above the ontology size
  // so a cycle fails the test instead of hanging it.
  let guard = 0;
  for (let item = nextItem(answers, "ayush"); item; item = nextItem(answers, "ayush")) {
    assert.ok(++guard <= ONTOLOGY.length + 5, `walk did not terminate, stuck at ${item.code}`);
    answers[item.code] =
      item.kind === "multi"
        ? [item.choices![0].value]
        : item.kind === "single"
          ? item.choices![0].value
          : item.kind === "scale" || item.kind === "number"
            ? 5
            : "answered";
  }
  assert.equal(nextItem(answers, "ayush"), null);
  assert.equal(completeness(answers, "ayush").fraction, 1);
});

test("completeness reports a half-finished interview as half-finished", () => {
  const empty = completeness({}, "allopathic");
  assert.equal(empty.answered, 0);
  assert.ok(empty.asked > 0);
  assert.equal(empty.fraction, 0);
});

// ------------------------------------------------------------------- red flags

test("THE ONE THAT MATTERS: every red-flag condition names a real item and a real value", () => {
  assert.ok(RED_FLAG_RULES.length > 0);
  for (const rule of RED_FLAG_RULES) {
    for (const c of rule.all) {
      const item = byCode.get(c.code);
      assert.ok(item, `rule ${rule.id} watches unknown item ${c.code}`);
      if (c.min !== undefined) {
        assert.ok(
          item!.kind === "scale" || item!.kind === "number",
          `rule ${rule.id} compares ${c.code} numerically but it is ${item!.kind}`,
        );
        continue;
      }
      const offered = new Set((item!.choices ?? []).map((ch) => ch.value));
      for (const v of [...(c.includesAny ?? []), ...(c.equalsAny ?? [])]) {
        assert.ok(
          offered.has(v),
          `rule ${rule.id} watches ${c.code}=${v}, which the ontology never offers — ` +
            `this rule can never fire`,
        );
      }
    }
  }
});

test("red flag ids are unique and each carries a source", () => {
  const ids = RED_FLAG_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const rule of RED_FLAG_RULES) {
    assert.ok(rule.source.trim(), `${rule.id} has no source`);
    assert.ok(rule.reason.en.trim() && rule.reason.hi.trim(), `${rule.id} reason`);
    assert.ok(rule.all.length > 0, `${rule.id} has no conditions and would always fire`);
  }
});

test("the two red flags the PS names by name both fire", () => {
  const chestAndBreathless = evaluateRedFlags({
    "hpi.site": ["chest"],
    "hpi.associated": ["breathless"],
  });
  assert.ok(
    chestAndBreathless.some((r) => r.id === "chest_pain_with_dyspnoea"),
    "acute chest pain with dyspnoea must fire",
  );

  const stroke = evaluateRedFlags({ "ros.neurological": ["face_droop"] });
  assert.ok(stroke.some((r) => r.id === "stroke_fast"), "stroke signs must fire");
  assert.equal(stroke[0].severity, "critical");
});

test("half of a red flag is not a red flag", () => {
  assert.deepEqual(evaluateRedFlags({ "hpi.site": ["chest"] }), []);
  assert.deepEqual(evaluateRedFlags({ "hpi.associated": ["breathless"] }), []);
  assert.deepEqual(evaluateRedFlags({ "ros.general": ["fever"] }), []);
});

test("nothing fires on an empty or reassuring interview", () => {
  assert.deepEqual(evaluateRedFlags({}), []);
  assert.deepEqual(
    evaluateRedFlags({
      "cc.main": "cough for two days",
      "hpi.site": ["throat"],
      "hpi.associated": ["none"],
      "ros.general": ["none"],
      "ros.cardiorespiratory": ["cough"],
      "ros.neurological": ["none"],
      "ros.gastrointestinal": ["none"],
      "ros.genitourinary": ["none"],
      "hpi.severity": 3,
      "hpi.onset": "gradual",
    }),
    [],
  );
});

test("critical sorts ahead of high", () => {
  const both = evaluateRedFlags({
    "ros.cardiorespiratory": ["breathless_rest", "blood_in_sputum"],
  });
  assert.ok(both.length >= 2, `expected two rules, got ${both.map((r) => r.id).join(",")}`);
  assert.equal(both[0].severity, "critical");
  assert.equal(both[both.length - 1].severity, "high");
});

test("a numeric threshold needs the number, not the presence of an answer", () => {
  const mild = evaluateRedFlags({ "hpi.severity": 4, "hpi.onset": "sudden" });
  assert.equal(mild.some((r) => r.id === "severe_acute_pain"), false);
  const severe = evaluateRedFlags({ "hpi.severity": 9, "hpi.onset": "sudden" });
  assert.equal(severe.some((r) => r.id === "severe_acute_pain"), true);
  // Severity 10 sudden must still fire; an off-by-one here silences the worst pain.
  const worst = evaluateRedFlags({ "hpi.severity": 10, "hpi.onset": "sudden" });
  assert.equal(worst.some((r) => r.id === "severe_acute_pain"), true);
});

// ------------------------------------------------------------------ dashavidha

test("all ten Dashavidha factors are specified, once each", () => {
  assert.equal(DASHAVIDHA.length, DASHAVIDHA_FACTORS.length);
  const seen = new Set(DASHAVIDHA.map((d) => d.factor));
  assert.equal(seen.size, DASHAVIDHA.length);
  for (const factor of DASHAVIDHA_FACTORS) {
    assert.ok(seen.has(factor), `${factor} is named in the PS and missing here`);
  }
});

test("every Dashavidha factor carries a gloss and a bilingual prompt", () => {
  for (const d of DASHAVIDHA) {
    assert.ok(d.gloss.trim(), `${d.factor} has no gloss for the practitioner`);
    assert.ok(d.prompt.en.trim() && d.prompt.hi.trim(), `${d.factor} prompt`);
    if (d.kind !== "number") {
      assert.ok(d.choices?.length, `${d.factor} is ${d.kind} with no choices`);
    }
  }
});

test("the Dashavidha prompts are plain questions, not Sanskrit terms", () => {
  // A patient cannot answer "what is your Prakriti?". If a prompt ever contains the
  // factor name, somebody has put the ontology's vocabulary on the patient's screen.
  for (const d of DASHAVIDHA) {
    assert.equal(
      d.prompt.en.toLowerCase().includes(d.factor.replace("_", " ")),
      false,
      `${d.factor} asks the patient the Sanskrit term`,
    );
  }
});

test("vaya bands follow the classical divisions", () => {
  assert.equal(vayaStage(8).key, "bala");
  assert.equal(vayaStage(15).key, "bala");
  assert.equal(vayaStage(16).key, "madhya");
  assert.equal(vayaStage(60).key, "madhya");
  assert.equal(vayaStage(61).key, "vriddha");
});

// -------------------------------------------------------------- agent handoff

test("the voice prompt outline covers every section it should", () => {
  const allopathic = promptOutline("allopathic");
  // Every section that has allopathic items must appear by heading. Written out rather
  // than `includes("")`, which is true for any string and was the first version of this
  // assertion — a test that passes on an empty outline is not a test.
  for (const section of SECTION_ORDER) {
    const hasItems = ONTOLOGY.some(
      (i) => i.section === section && (!i.modes || i.modes.includes("allopathic")),
    );
    assert.equal(
      allopathic.includes(SECTION_HEADINGS[section].en),
      hasItems,
      `${section} heading presence should be ${hasItems}`,
    );
  }
  assert.ok(allopathic.includes("cc.main"));
  assert.ok(allopathic.includes("hpi.severity"));
  // Choice vocabularies have to reach the agent, or it invents its own answer values.
  assert.ok(allopathic.includes("sudden|gradual|unsure"), "choice values must be listed");
  // The ayush outline is a superset: it adds items, never drops them.
  const ayush = promptOutline("ayush");
  assert.ok(ayush.length > allopathic.length, "ayush mode should add items");
  assert.ok(ayush.includes("per.meal_timing"));
  assert.equal(allopathic.includes("per.meal_timing"), false);
});

