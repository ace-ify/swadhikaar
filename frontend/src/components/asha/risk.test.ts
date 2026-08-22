// Run: node --test src/components/asha/risk.test.ts   (from frontend/)
import test from "node:test";
import assert from "node:assert/strict";

// Specifier kept in a variable so tsc doesn't reject the .ts extension
// (moduleResolution: bundler) while node's native type stripping still needs it.
const spec = "./risk.ts";
const {
  computeRisk,
  draftToWrites,
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

test("severe chest pain raises refer even when the band stays Low", () => {
  const r = computeRisk({ ...SYMPTOM_DEFAULTS, chest_discomfort: "severe" }, {});
  assert.equal(r.refer, true);
  assert.deepEqual(
    r.refer_reasons.map((x: { en: string }) => x.en),
    ["Severe chest pain"]
  );
  // The flag must NOT rewrite the band — that is the whole design.
  assert.equal(r.overall_risk_category, "Low");
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
