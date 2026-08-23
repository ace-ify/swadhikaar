// Pure screening logic: symptom/vital answers -> risk scores -> DB payloads.
// No React, no Supabase imports here so it stays unit-testable (see risk.test.ts).

export type SymptomAnswers = {
  chest_discomfort: string;
  breathlessness: string;
  palpitations: string;
  fatigue_weakness: string;
  dizziness_blackouts: string;
  sleep_duration: string;
  stress_anxiety: string;
  physical_inactivity: string;
  diet_quality: string;
  family_history: string;
};

export type VitalAnswers = {
  systolic_bp?: number;
  diastolic_bp?: number;
  heart_rate?: number;
  respiratory_rate?: number;
  oxygen_saturation?: number;
  temperature?: number;
  blood_glucose?: number;
  height?: number; // cm
  weight?: number; // kg
};

export type ReferReason = { hi: string; en: string };

export type RiskResult = {
  heart_risk_score: number;
  heart_risk_level: RiskLevel;
  diabetic_risk_score: number;
  diabetic_risk_level: RiskLevel;
  hypertension_risk_score: number;
  hypertension_risk_level: RiskLevel;
  overall_risk_score: number;
  overall_risk_category: RiskLevel;
  /** Findings an ASHA refers on regardless of the band. Never folded into the score. */
  refer: boolean;
  refer_reasons: ReferReason[];
  /** False when any vital was left unmeasured, so the UI can say so. */
  vitals_complete: boolean;
  unmeasured: string[];
  model: string;
};

export type RiskLevel = "High" | "Moderate" | "Low";

export const SYMPTOM_DEFAULTS: SymptomAnswers = {
  chest_discomfort: "none",
  breathlessness: "none",
  palpitations: "none",
  fatigue_weakness: "none",
  dizziness_blackouts: "never",
  sleep_duration: "6-8",
  stress_anxiety: "calm",
  physical_inactivity: "active",
  diet_quality: "balanced",
  family_history: "none",
};

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const round2 = (v: number) => Number(v.toFixed(2));

/** A vital counts only if it is a finite number. Absent means unmeasured, not normal. */
const measured = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Scores only when the vital was actually taken, so a missing reading adds nothing. */
const when = (v: number | null, test: (n: number) => boolean, points: number) =>
  v !== null && test(v) ? points : 0;

export function level(score: number): RiskLevel {
  if (score >= 50) return "High";
  if (score >= 30) return "Moderate";
  return "Low";
}

// Graded weights, keyed by the exact chip values the screening form emits.
// An unrecognised value scores 0 rather than being guessed at.
const SYMPTOM_WEIGHTS: Record<keyof SymptomAnswers, Record<string, number>> = {
  chest_discomfort: { none: 0, mild: 6, moderate: 12, severe: 20 },
  breathlessness: { none: 0, on_exertion: 8, at_rest: 18 },
  palpitations: { none: 0, occasional: 4, frequent: 9 },
  fatigue_weakness: { none: 0, mild: 3, severe: 8 },
  dizziness_blackouts: { never: 0, rarely: 5, often: 14 },
  sleep_duration: { "6-8": 0, gt8: 2, lt5: 5 },
  stress_anxiety: { calm: 0, stressed: 4, very_stressed: 8 },
  physical_inactivity: { active: 0, somewhat_active: 3, inactive: 6 },
  diet_quality: { balanced: 0, mixed: 3, poor: 6 },
  family_history: { none: 0, diabetes: 8, heart: 10, hypertension: 8 },
};

// Findings an ASHA is trained to refer on. A flag, not a forced band: once a rule
// silently rewrites the score the score stops meaning anything, so this names its
// own cause instead.
const RED_FLAGS: {
  field: keyof SymptomAnswers;
  value: string;
  hi: string;
  en: string;
}[] = [
  {
    field: "chest_discomfort",
    value: "severe",
    hi: "सीने में तेज़ दर्द",
    en: "Severe chest pain",
  },
  {
    field: "breathlessness",
    value: "at_rest",
    hi: "आराम में भी सांस फूलना",
    en: "Breathlessness at rest",
  },
  {
    field: "dizziness_blackouts",
    value: "often",
    hi: "बार-बार चक्कर या बेहोशी",
    en: "Frequent dizziness or blackouts",
  },
];

const symptomPoints = (
  s: SymptomAnswers,
  fields: (keyof SymptomAnswers)[]
): number =>
  fields.reduce(
    (total, f) =>
      total + (SYMPTOM_WEIGHTS[f][(s[f] ?? "").trim().toLowerCase()] ?? 0),
    0
  );

export function bmiOf(heightCm?: number, weightKg?: number): number | null {
  if (!heightCm || !weightKg || heightCm <= 0) return null;
  const m = heightCm / 100;
  return round2(weightKg / (m * m));
}

export function bmiCategory(bmi: number | null): string {
  if (bmi === null) return "unknown";
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

/**
 * Offline mirror of the deployed `risk-predict` edge function (edge-heuristic-v2).
 * The two MUST stay in step — an offline screening and an online one have to give
 * the same numbers, or the same patient gets two different verdicts depending on
 * signal strength. risk.test.ts pins the shared cases.
 *
 * ponytail: age is collected in the form but not scored, because the deployed
 * model has no age term. Adding one here alone would desync local from server.
 */
export function computeRisk(
  symptoms: SymptomAnswers,
  vitals: VitalAnswers
): RiskResult {
  const sbp = measured(vitals.systolic_bp);
  const dbp = measured(vitals.diastolic_bp);
  const hr = measured(vitals.heart_rate);
  const rr = measured(vitals.respiratory_rate);
  const spo2 = measured(vitals.oxygen_saturation);
  const glucose = measured(vitals.blood_glucose);
  const bmi = measured(bmiOf(vitals.height, vitals.weight));

  const unmeasured = Object.entries({
    systolic_bp: sbp,
    diastolic_bp: dbp,
    heart_rate: hr,
    oxygen_saturation: spo2,
    blood_glucose: glucose,
    bmi,
  })
    .filter(([, v]) => v === null)
    .map(([k]) => k);

  const cardiac = symptomPoints(symptoms, [
    "chest_discomfort",
    "breathlessness",
    "palpitations",
    "dizziness_blackouts",
    "fatigue_weakness",
  ]);
  const lifestyle = symptomPoints(symptoms, [
    "stress_anxiety",
    "physical_inactivity",
    "diet_quality",
    "sleep_duration",
  ]);
  const family = symptomPoints(symptoms, ["family_history"]);

  const heart = clamp(
    10 +
      when(sbp, (n) => n >= 140, 10) +
      when(dbp, (n) => n >= 90, 8) +
      when(hr, (n) => n >= 100 || n <= 50, 8) +
      when(spo2, (n) => n < 94, 10) +
      when(bmi, (n) => n >= 30, 8) +
      cardiac * 0.9 +
      lifestyle * 0.3 +
      family * 0.5
  );

  const diabetic = clamp(
    8 +
      when(glucose, (n) => n >= 200, 30) +
      when(glucose, (n) => n >= 140 && n < 200, 14) +
      when(bmi, (n) => n >= 30, 10) +
      lifestyle * 0.8 +
      family * 0.9
  );

  const hypertension = clamp(
    6 +
      when(sbp, (n) => n >= 180, 35) +
      when(dbp, (n) => n >= 110, 35) +
      when(sbp, (n) => n >= 140 && n < 180, 18) +
      when(dbp, (n) => n >= 90 && n < 110, 18) +
      when(rr, (n) => n > 22, 5) +
      when(bmi, (n) => n >= 30, 8) +
      symptomPoints(symptoms, ["stress_anxiety"]) +
      family * 0.8
  );

  const overall = clamp(heart * 0.35 + diabetic * 0.35 + hypertension * 0.3);

  const flags = RED_FLAGS.filter(
    (f) => (symptoms[f.field] ?? "").trim().toLowerCase() === f.value
  );

  return {
    heart_risk_score: round2(heart),
    heart_risk_level: level(heart),
    diabetic_risk_score: round2(diabetic),
    diabetic_risk_level: level(diabetic),
    hypertension_risk_score: round2(hypertension),
    hypertension_risk_level: level(hypertension),
    overall_risk_score: round2(overall),
    overall_risk_category: level(overall),
    refer: flags.length > 0,
    refer_reasons: flags.map(({ hi, en }) => ({ hi, en })),
    vitals_complete: unmeasured.length === 0,
    unmeasured,
    model: "local-heuristic-v2",
  };
}

// ---------------------------------------------------------------------------
// Draft -> outbox payloads
// ---------------------------------------------------------------------------

export type ScreeningDraft = {
  draftId: string;
  patientId: string;
  isNewPatient: boolean;
  name: string;
  phone: string;
  age: string;
  gender: string;
  occupation: string;
  crop_type: string;
  village: string;
  district: string;
  symptoms: SymptomAnswers;
  vitals: VitalAnswers;
  createdAt: string;
};

export type OutboxWrite = {
  table: string;
  op: "insert" | "update";
  payload: Record<string, unknown>;
};

/**
 * The patient uuid is minted on the device so the child rows can reference it
 * before the insert ever reaches Postgres. Order matters: patients first.
 * ponytail: age + gender are NOT persisted — the live `patients` table has no
 * such columns. Upgrade path: add them in a migration, then map them here.
 */
export function draftToWrites(
  draft: ScreeningDraft,
  risk: RiskResult
): OutboxWrite[] {
  const now = new Date().toISOString();
  const writes: OutboxWrite[] = [];

  if (draft.isNewPatient) {
    writes.push({
      table: "patients",
      op: "insert",
      payload: {
        id: draft.patientId,
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        language: "hi",
        village: draft.village,
        district: draft.district,
        occupation: draft.occupation || null,
        crop_type: draft.crop_type || null,
        intake_source: "asha_screening",
        consent_status: "verbal_obtained",
        journey_status: "screened",
        // Canonical case. A DB trigger normalises this anyway, but writing
        // 'high' here once made every desktop high-risk count (doctor/patients,
        // admin/dashboard, admin/operations) silently skip the patient.
        risk_level: risk.overall_risk_category,
        overall_risk_score: risk.overall_risk_score,
      },
    });
  } else {
    writes.push({
      table: "patients",
      op: "update",
      payload: {
        id: draft.patientId,
        risk_level: risk.overall_risk_category,
        overall_risk_score: risk.overall_risk_score,
        journey_status: "screened",
        updated_at: now,
      },
    });
  }

  writes.push({
    table: "symptoms",
    op: "insert",
    payload: {
      patient_id: draft.patientId,
      ...draft.symptoms,
      recorded_at: now,
    },
  });

  const bmi = bmiOf(draft.vitals.height, draft.vitals.weight);
  const vitalsPayload: Record<string, unknown> = {
    patient_id: draft.patientId,
    recorded_at: now,
    bmi,
    bmi_category: bmiCategory(bmi),
  };
  for (const [k, v] of Object.entries(draft.vitals)) {
    if (v !== undefined && v !== null && !Number.isNaN(v)) vitalsPayload[k] = v;
  }
  writes.push({ table: "health_vitals", op: "insert", payload: vitalsPayload });

  writes.push({
    table: "risk_assessments",
    op: "insert",
    payload: {
      patient_id: draft.patientId,
      heart_risk_score: risk.heart_risk_score,
      heart_risk_level: risk.heart_risk_level,
      diabetic_risk_score: risk.diabetic_risk_score,
      diabetic_risk_level: risk.diabetic_risk_level,
      hypertension_risk_score: risk.hypertension_risk_score,
      hypertension_risk_level: risk.hypertension_risk_level,
      overall_risk_category: risk.overall_risk_category,
      overall_risk_score: risk.overall_risk_score,
      assessed_at: now,
    },
  });

  // Whenever the app tells the ASHA to refer, the doctor's queue has to hear
  // about it. Without this the referral dies on the phone: the field worker is
  // told "send them to a doctor" and nothing reaches the other end.
  // Severity levels match what the voice agent writes, so one queue, one scale.
  const esc = escalationFor(risk);
  if (esc) {
    writes.push({
      table: "escalations",
      op: "insert",
      payload: { patient_id: draft.patientId, ...esc, status: "open" },
    });
  }

  return writes;
}

/**
 * The escalation an ASHA screening raises, or null when it raises none.
 * Mirrors what the result screen promises the worker — if the UI says "refer",
 * a doctor gets a row. Nothing is escalated that the ASHA wasn't also told about.
 */
export function escalationFor(
  risk: RiskResult
): { severity: string; severity_level: string; reason: string } | null {
  if (risk.refer) {
    return {
      severity: "CRITICAL",
      severity_level: "3",
      reason: `ASHA screening red flag: ${risk.refer_reasons
        .map((r) => r.en)
        .join("; ")}`,
    };
  }
  if (risk.overall_risk_category === "High") {
    return {
      severity: "HIGH",
      severity_level: "2",
      reason: `ASHA screening scored High risk (${risk.overall_risk_score}) — heart ${risk.heart_risk_level}, diabetes ${risk.diabetic_risk_level}, BP ${risk.hypertension_risk_level}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recommended actions shown on the result screen
// ---------------------------------------------------------------------------
export type Action = { hi: string; en: string };

export function recommendedActions(
  risk: RiskResult,
  vitals: VitalAnswers
): Action[] {
  const out: Action[] = [];

  // Red flags come first and are not conditional on the band — that is the whole
  // point of the flag.
  if (risk.refer) {
    out.push({
      hi: "तुरंत डॉक्टर के पास भेजें",
      en: "Refer to a doctor now",
    });
  }

  if (risk.overall_risk_category === "High") {
    out.push({
      hi: "आज ही डॉक्टर के पास भेजें",
      en: "Refer to doctor today",
    });
    out.push({
      hi: "परिवार को सूचित करें",
      en: "Inform the family",
    });
  } else if (risk.overall_risk_category === "Moderate") {
    out.push({
      hi: "7 दिन में दोबारा जांच करें",
      en: "Re-screen within 7 days",
    });
  } else if (!risk.refer) {
    out.push({
      hi: "3 महीने में दोबारा जांच करें",
      en: "Re-screen in 3 months",
    });
  }

  // An incomplete screening must ask for the missing measurement rather than let
  // a reassuring band stand on values nobody took.
  if (!risk.vitals_complete) {
    out.push({
      hi: "बाकी माप लें — जांच अधूरी है",
      en: "Take the remaining measurements — screening incomplete",
    });
  }

  if ((vitals.systolic_bp ?? 0) >= 140 || (vitals.diastolic_bp ?? 0) >= 90) {
    out.push({
      hi: "नमक कम करने की सलाह दें",
      en: "Advise reducing salt intake",
    });
  }
  if ((vitals.blood_glucose ?? 0) >= 140) {
    out.push({
      hi: "खाली पेट शुगर की दोबारा जांच",
      en: "Repeat fasting blood sugar test",
    });
  }
  out.push({
    hi: "अगली मुलाकात का समय तय करें",
    en: "Schedule the next visit",
  });
  return out;
}
