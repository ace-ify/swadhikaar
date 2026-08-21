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

export type RiskResult = {
  heart_risk_score: number;
  heart_risk_level: RiskLevel;
  diabetic_risk_score: number;
  diabetic_risk_level: RiskLevel;
  hypertension_risk_score: number;
  hypertension_risk_level: RiskLevel;
  overall_risk_score: number;
  overall_risk_category: RiskLevel;
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
const pts = (cond: boolean, p: number) => (cond ? p : 0);
const round2 = (v: number) => Number(v.toFixed(2));

export function level(score: number): RiskLevel {
  if (score >= 50) return "High";
  if (score >= 30) return "Moderate";
  return "Low";
}

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
 * ponytail: this mirrors the deployed `risk-predict` edge function's
 * heuristic 1:1 so an offline screening and an online one give the same
 * numbers. Upgrade path: when risk-predict swaps its heuristic for a trained
 * model, this becomes fallback-only and the UI should label it as such.
 * Note: age is collected in the form but not scored — the deployed model has
 * no age term, and inventing one here would desync local from server.
 */
export function computeRisk(
  symptoms: SymptomAnswers,
  vitals: VitalAnswers
): RiskResult {
  const sbp = vitals.systolic_bp ?? 120;
  const dbp = vitals.diastolic_bp ?? 80;
  const hr = vitals.heart_rate ?? 78;
  const rr = vitals.respiratory_rate ?? 16;
  const spo2 = vitals.oxygen_saturation ?? 97;
  const glucose = vitals.blood_glucose ?? 100;
  const bmi = bmiOf(vitals.height, vitals.weight) ?? 23;

  const symptomRisk =
    pts(symptoms.chest_discomfort !== "none", 12) +
    pts(symptoms.breathlessness !== "none", 10) +
    pts(symptoms.palpitations !== "none", 8) +
    pts(symptoms.dizziness_blackouts !== "never", 10) +
    pts(symptoms.stress_anxiety !== "calm", 4) +
    pts(symptoms.physical_inactivity !== "active", 6) +
    pts(symptoms.diet_quality !== "balanced", 6) +
    pts(symptoms.family_history !== "none", 8);

  const heart = clamp(
    10 +
      pts(sbp >= 140, 10) +
      pts(dbp >= 90, 8) +
      pts(hr >= 100 || hr <= 50, 8) +
      pts(spo2 < 94, 10) +
      pts(bmi >= 30, 8) +
      symptomRisk * 0.55
  );

  const diabetic = clamp(
    8 +
      pts(glucose >= 200, 30) +
      pts(glucose >= 140 && glucose < 200, 14) +
      pts(bmi >= 30, 10) +
      pts(symptoms.physical_inactivity !== "active", 8) +
      pts(symptoms.diet_quality !== "balanced", 8) +
      pts(symptoms.family_history !== "none", 12)
  );

  const hypertension = clamp(
    6 +
      pts(sbp >= 180 || dbp >= 110, 35) +
      pts((sbp >= 140 && sbp < 180) || (dbp >= 90 && dbp < 110), 18) +
      pts(rr > 22, 5) +
      pts(bmi >= 30, 8) +
      pts(symptoms.stress_anxiety !== "calm", 8) +
      pts(symptoms.family_history !== "none", 10)
  );

  const overall = clamp(heart * 0.35 + diabetic * 0.35 + hypertension * 0.3);

  return {
    heart_risk_score: round2(heart),
    heart_risk_level: level(heart),
    diabetic_risk_score: round2(diabetic),
    diabetic_risk_level: level(diabetic),
    hypertension_risk_score: round2(hypertension),
    hypertension_risk_level: level(hypertension),
    overall_risk_score: round2(overall),
    overall_risk_category: level(overall),
    model: "local-heuristic-v1",
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
        risk_level: risk.overall_risk_category.toLowerCase(),
        overall_risk_score: risk.overall_risk_score,
      },
    });
  } else {
    writes.push({
      table: "patients",
      op: "update",
      payload: {
        id: draft.patientId,
        risk_level: risk.overall_risk_category.toLowerCase(),
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

  return writes;
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
  } else {
    out.push({
      hi: "3 महीने में दोबारा जांच करें",
      en: "Re-screen in 3 months",
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
