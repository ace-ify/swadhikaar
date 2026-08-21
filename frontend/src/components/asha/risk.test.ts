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
