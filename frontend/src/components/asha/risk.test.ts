// Run: node --test src/components/asha/risk.test.ts   (from frontend/)
import test from "node:test";
import assert from "node:assert/strict";

// Specifier kept in a variable so tsc doesn't reject the .ts extension
// (moduleResolution: bundler) while node's native type stripping still needs it.
const spec = "./risk.ts";
const {
  computeRisk,
  draftToWrites,
  escalationFor,
  bmiOf,
  bmiCategory,
  SYMPTOM_DEFAULTS,
} = await import(spec);

test("healthy screening scores Low", () => {
  const r = computeRisk(SYMPTOM_DEFAULTS, {
    systolic_bp: 118,
    diastolic_bp: 76,
    heart_rate: 72,
    blood_glucose: 95,
    height: 165,
    weight: 60,
  });
  assert.equal(r.overall_risk_category, "Low");
  assert.ok(r.overall_risk_score < 30, `got ${r.overall_risk_score}`);
});

test("hypertensive crisis + high sugar + symptoms scores High", () => {
  const r = computeRisk(
    {
      ...SYMPTOM_DEFAULTS,
      chest_discomfort: "severe",
      breathlessness: "at_rest",
      dizziness_blackouts: "often",
      family_history: "heart",
      stress_anxiety: "very_stressed",
      physical_inactivity: "inactive",
      diet_quality: "poor",
    },
    {
      systolic_bp: 186,
      diastolic_bp: 114,
      heart_rate: 104,
      respiratory_rate: 24,
      oxygen_saturation: 92,
      blood_glucose: 240,
      height: 160,
      weight: 82,
    }
  );
  assert.equal(r.overall_risk_category, "High");
  assert.equal(r.hypertension_risk_level, "High");
  assert.equal(r.diabetic_risk_level, "High");
});

test("bmi maths and category", () => {
  assert.equal(bmiOf(160, 82), 32.03);
  assert.equal(bmiCategory(32.03), "obese");
  assert.equal(bmiOf(0, 50), null);
  assert.equal(bmiCategory(null), "unknown");
});

test("new-patient draft maps to 4 writes with a shared client-minted id", () => {
  const draft = {
    draftId: "d1",
    patientId: "11111111-1111-4111-8111-111111111111",
    isNewPatient: true,
    name: " Sita Devi ",
    phone: "9876543210",
    age: "44",
    gender: "female",
    occupation: "farmer",
    crop_type: "wheat",
    village: "Rampur",
    district: "Muzaffarpur",
    symptoms: SYMPTOM_DEFAULTS,
    vitals: { systolic_bp: 130, diastolic_bp: 85, height: 155, weight: 58 },
    createdAt: new Date().toISOString(),
  };
  const risk = computeRisk(draft.symptoms, draft.vitals);
  const writes = draftToWrites(draft, risk);

  assert.deepEqual(
    writes.map((w: { table: string }) => w.table),
    ["patients", "symptoms", "health_vitals", "risk_assessments"]
  );
  assert.equal(writes[0].op, "insert");
  assert.equal(writes[0].payload.id, draft.patientId);
  assert.equal(writes[0].payload.name, "Sita Devi");
  // every child row points at the same locally minted uuid
  for (const w of writes.slice(1)) {
    assert.equal(w.payload.patient_id, draft.patientId);
  }
  // age/gender are deliberately not persisted (no columns exist)
  assert.equal(writes[0].payload.age, undefined);
  assert.equal(writes[0].payload.gender, undefined);
  // bmi is derived, not asked for
  assert.equal(writes[2].payload.bmi, 24.14);
});

test("existing patient produces an update, not a duplicate insert", () => {
  const draft = {
    draftId: "d2",
    patientId: "22222222-2222-4222-8222-222222222222",
    isNewPatient: false,
    name: "Ram Prasad",
    phone: "",
    age: "",
    gender: "",
    occupation: "",
    crop_type: "",
    village: "Rampur",
    district: "Muzaffarpur",
    symptoms: SYMPTOM_DEFAULTS,
    vitals: {},
    createdAt: new Date().toISOString(),
  };
  const writes = draftToWrites(draft, computeRisk(draft.symptoms, draft.vitals));
  assert.equal(writes[0].op, "update");
  assert.equal(writes[0].payload.id, draft.patientId);
});

// --- the two defects that shipped in v1 ------------------------------------

test("symptom severity changes the score (v1 scored mild and severe alike)", () => {
  const at = (chest: string) =>
    computeRisk({ ...SYMPTOM_DEFAULTS, chest_discomfort: chest }, {})
      .overall_risk_score;

  const none = at("none");
  const mild = at("mild");
  const moderate = at("moderate");
  const severe = at("severe");

  assert.ok(mild > none, `mild ${mild} must exceed none ${none}`);
  assert.ok(moderate > mild, `moderate ${moderate} must exceed mild ${mild}`);
  assert.ok(severe > moderate, `severe ${severe} must exceed moderate ${moderate}`);
});

test("severe chest pain refers, and the band is floored so it cannot read Low", () => {
  const r = computeRisk({ ...SYMPTOM_DEFAULTS, chest_discomfort: "severe" }, {});
  assert.equal(r.refer, true);
  assert.deepEqual(
    r.refer_reasons.map((x: { en: string }) => x.en),
    ["Severe chest pain"]
  );
  // CONTRACT CHANGED in v3. This used to assert the band stayed "Low", on the
  // reasoning that a rule rewriting the score makes the score meaningless. That
  // reasoning still holds for the SCORE, which is untouched — but a card reading
  // "Low risk" next to "refer immediately" is how a referable patient gets sent
  // home. So the human-facing band is floored and the arithmetic is preserved
  // separately in computed_risk_category.
  assert.equal(r.overall_risk_category, "High");
  assert.equal(r.computed_risk_category, "Low");
  assert.equal(r.category_floored_by_danger_sign, true);
});

test("breathlessness at rest and frequent blackouts also refer", () => {
  assert.equal(
    computeRisk({ ...SYMPTOM_DEFAULTS, breathlessness: "at_rest" }, {}).refer,
    true
  );
  assert.equal(
    computeRisk({ ...SYMPTOM_DEFAULTS, dizziness_blackouts: "often" }, {}).refer,
    true
  );
  assert.equal(computeRisk(SYMPTOM_DEFAULTS, {}).refer, false);
});

test("unmeasured vitals are not scored as healthy (v1 defaulted them to normal)", () => {
  const blank = computeRisk(SYMPTOM_DEFAULTS, {});
  assert.equal(blank.vitals_complete, false);
  assert.ok(blank.unmeasured.includes("systolic_bp"));
  assert.ok(blank.unmeasured.includes("blood_glucose"));
  assert.ok(blank.unmeasured.includes("bmi"));

  const full = computeRisk(SYMPTOM_DEFAULTS, {
    systolic_bp: 118,
    diastolic_bp: 76,
    heart_rate: 72,
    oxygen_saturation: 98,
    blood_glucose: 95,
    height: 165,
    weight: 60,
  });
  assert.equal(full.vitals_complete, true);
  assert.deepEqual(full.unmeasured, []);
});

test("dangerous measured vitals outrank a mild symptom", () => {
  const r = computeRisk({ ...SYMPTOM_DEFAULTS, chest_discomfort: "mild" }, {
    systolic_bp: 186,
    diastolic_bp: 114,
    heart_rate: 92,
    oxygen_saturation: 97,
    blood_glucose: 150,
    height: 160,
    weight: 80,
  });
  assert.equal(r.hypertension_risk_level, "High");
  assert.equal(r.overall_risk_category, "High");
  assert.equal(r.vitals_complete, true);
});

// --- the referral must reach a doctor, not die on the phone ----------------

const draftWith = (symptoms: object, vitals: object = {}) => ({
  draftId: "d3",
  patientId: "33333333-3333-4333-8333-333333333333",
  isNewPatient: false,
  name: "Divya Yadav",
  phone: "",
  age: "",
  gender: "",
  occupation: "",
  crop_type: "",
  village: "Rampur",
  district: "Muzaffarpur",
  symptoms: { ...SYMPTOM_DEFAULTS, ...symptoms },
  vitals,
  createdAt: new Date().toISOString(),
});

test("a red flag enqueues an escalation for the doctor queue", () => {
  const draft = draftWith({ chest_discomfort: "severe" });
  const risk = computeRisk(draft.symptoms, draft.vitals);
  const writes = draftToWrites(draft, risk);

  const esc = writes.find((w: { table: string }) => w.table === "escalations");
  assert.ok(esc, "severe chest pain must reach the doctor queue");
  assert.equal(esc.op, "insert");
  assert.equal(esc.payload.patient_id, draft.patientId);
  assert.equal(esc.payload.severity, "CRITICAL");
  assert.equal(esc.payload.severity_level, "3");
  assert.equal(esc.payload.status, "open");
  // The reason must name the finding — a doctor triaging a queue needs the why.
  assert.match(String(esc.payload.reason), /Severe chest pain/);
});

test("a High band with no red flag still escalates, at HIGH", () => {
  // Vitals chosen to sit just INSIDE every danger-sign threshold: 179/119 rather
  // than the 186/114 this test used before v3. 186 systolic is a hypertensive
  // crisis by ACC/AHA, so it now refers — the old fixture was asserting that a
  // patient at 186/114 needed no referral, which was the defect, not the contract.
  const draft = draftWith({ chest_discomfort: "mild" }, {
    systolic_bp: 179,
    diastolic_bp: 119,
    heart_rate: 92,
    oxygen_saturation: 97,
    blood_glucose: 290,
    height: 160,
    weight: 80,
  });
  const risk = computeRisk(draft.symptoms, draft.vitals);
  assert.equal(risk.refer, false);
  assert.equal(risk.overall_risk_category, "High");
  // High on the arithmetic alone, so nothing was floored.
  assert.equal(risk.category_floored_by_danger_sign, false);

  const esc = draftToWrites(draft, risk).find(
    (w: { table: string }) => w.table === "escalations"
  );
  assert.ok(esc, "a High-risk screening must reach the doctor queue");
  assert.equal(esc.payload.severity, "HIGH");
  assert.equal(esc.payload.severity_level, "2");
});

test("a healthy screening escalates nothing", () => {
  const draft = draftWith({});
  const writes = draftToWrites(draft, computeRisk(draft.symptoms, draft.vitals));
  assert.equal(
    writes.filter((w: { table: string }) => w.table === "escalations").length,
    0
  );
  // ...and the other four writes are untouched by this change.
  assert.deepEqual(
    writes.map((w: { table: string }) => w.table),
    ["patients", "symptoms", "health_vitals", "risk_assessments"]
  );
});

test("risk_level is written in the case every desktop reader compares against", () => {
  // Writing 'high' here made the patient vanish from every high-risk count in
  // doctor/patients, admin/dashboard, admin/operations and admin/coordination,
  // all of which test `risk_level === "High"`.
  const draft = draftWith({ chest_discomfort: "mild" }, {
    systolic_bp: 186,
    diastolic_bp: 114,
    heart_rate: 92,
    oxygen_saturation: 97,
    blood_glucose: 150,
    height: 160,
    weight: 80,
  });
  const risk = computeRisk(draft.symptoms, draft.vitals);
  assert.equal(risk.overall_risk_category, "High");

  const update = draftToWrites(draft, risk)[0];
  assert.equal(update.payload.risk_level, "High");

  const insert = draftToWrites({ ...draft, isNewPatient: true }, risk)[0];
  assert.equal(insert.op, "insert");
  assert.equal(insert.payload.risk_level, "High");
});

test("escalationFor never fires without the ASHA also being told", () => {
  // Every escalating case must have refer=true or band=High — the two things the
  // result screen actually renders. Otherwise the doctor knows and the field
  // worker does not.
  for (const symptoms of [
    {},
    { chest_discomfort: "mild" },
    { chest_discomfort: "moderate" },
    { chest_discomfort: "severe" },
    { breathlessness: "at_rest" },
    { dizziness_blackouts: "often" },
    { fatigue_weakness: "severe", diet_quality: "poor" },
  ]) {
    const r = computeRisk({ ...SYMPTOM_DEFAULTS, ...symptoms }, {});
    if (escalationFor(r)) {
      assert.ok(
        r.refer || r.overall_risk_category === "High",
        `escalated silently for ${JSON.stringify(symptoms)}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Vital-sign danger signs (v3)
//
// Before v3, RED_FLAGS covered only three SYMPTOM fields, so no measurement could
// raise a referral. Measured against the deployed function on 2026-08-25:
//   BP 200/130 -> "Moderate", refer=false
//   SpO2 88%   -> "Low",      refer=false
//   glucose 420 -> "Low",     refer=false
// A screening card reading "Low risk" for a hypoxic patient is how someone gets
// sent home, so these are the assertions that must never regress.
// ---------------------------------------------------------------------------

const DANGER_CASES: [string, Record<string, number>, string][] = [
  ["hypertensive crisis", { systolic_bp: 200, diastolic_bp: 130 }, "Blood pressure at crisis level (180/120 or above)"],
  ["diastolic alone", { diastolic_bp: 125 }, "Blood pressure at crisis level (180/120 or above)"],
  ["hypoxia", { oxygen_saturation: 88 }, "Oxygen saturation below 90%"],
  ["hyperglycaemia", { blood_glucose: 420 }, "Blood glucose 300 mg/dL or above"],
  ["hypoglycaemia", { blood_glucose: 48 }, "Blood glucose 54 mg/dL or below"],
  ["tachycardia", { heart_rate: 145 }, "Heart rate outside 40-130 beats per minute"],
  ["bradycardia", { heart_rate: 38 }, "Heart rate outside 40-130 beats per minute"],
  ["respiratory distress", { respiratory_rate: 34 }, "Respiratory rate 30 or above"],
];

for (const [label, vitals, expectedReason] of DANGER_CASES) {
  test(`danger sign refers and floors the band: ${label}`, () => {
    const r = computeRisk(SYMPTOM_DEFAULTS, vitals);
    assert.equal(r.refer, true, `${label} must refer`);
    assert.equal(r.overall_risk_category, "High", `${label} must not read Low or Moderate`);
    assert.ok(
      r.refer_reasons.some((x: { en: string }) => x.en === expectedReason),
      `${label} must name its cause: ${expectedReason}`
    );
  });
}

test("flooring is reported, not silent — the score itself is untouched", () => {
  const r = computeRisk(SYMPTOM_DEFAULTS, { oxygen_saturation: 88 });
  assert.equal(r.category_floored_by_danger_sign, true);
  // The arithmetic still says what it computed; only the human-facing band moved.
  assert.equal(r.computed_risk_category, "Low");
  assert.ok(r.overall_risk_score < 50, "score must not be inflated to match the band");
});

test("normal vitals do not refer and are not floored", () => {
  const r = computeRisk(SYMPTOM_DEFAULTS, {
    systolic_bp: 118, diastolic_bp: 76, heart_rate: 72,
    respiratory_rate: 16, oxygen_saturation: 98, blood_glucose: 95,
  });
  assert.equal(r.refer, false);
  assert.equal(r.category_floored_by_danger_sign, false);
  assert.equal(r.overall_risk_category, r.computed_risk_category);
});

test("an unmeasured vital never raises a danger sign", () => {
  // The v1 defect inverted: absent must not read as dangerous any more than it
  // read as healthy.
  const r = computeRisk(SYMPTOM_DEFAULTS, {});
  assert.equal(r.refer, false);
  assert.equal(r.overall_risk_category, "Low");
  assert.equal(r.vitals_complete, false);
});

test("borderline values sit on the safe side of each threshold", () => {
  // Exactly at the published cutoff must fire; one step inside must not.
  assert.equal(computeRisk(SYMPTOM_DEFAULTS, { systolic_bp: 180 }).refer, true);
  assert.equal(computeRisk(SYMPTOM_DEFAULTS, { systolic_bp: 179 }).refer, false);
  assert.equal(computeRisk(SYMPTOM_DEFAULTS, { oxygen_saturation: 89 }).refer, true);
  assert.equal(computeRisk(SYMPTOM_DEFAULTS, { oxygen_saturation: 90 }).refer, false);
  assert.equal(computeRisk(SYMPTOM_DEFAULTS, { blood_glucose: 300 }).refer, true);
  assert.equal(computeRisk(SYMPTOM_DEFAULTS, { blood_glucose: 299 }).refer, false);
  assert.equal(computeRisk(SYMPTOM_DEFAULTS, { heart_rate: 130 }).refer, true);
  assert.equal(computeRisk(SYMPTOM_DEFAULTS, { heart_rate: 129 }).refer, false);
});

test("symptom and vital flags accumulate rather than replacing each other", () => {
  const r = computeRisk(
    { ...SYMPTOM_DEFAULTS, chest_discomfort: "severe" },
    { oxygen_saturation: 85 }
  );
  const reasons = r.refer_reasons.map((x: { en: string }) => x.en);
  assert.ok(reasons.includes("Severe chest pain"));
  assert.ok(reasons.includes("Oxygen saturation below 90%"));
});

test("local model version matches the deployed one", () => {
  // scoreScreening falls back to this offline. If the versions drift, the same
  // patient gets two verdicts depending on signal strength.
  assert.equal(computeRisk(SYMPTOM_DEFAULTS, {}).model, "local-heuristic-v3");
});
