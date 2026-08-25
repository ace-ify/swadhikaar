// Screening risk model — edge-heuristic-v2.
//
// v1 had two defects that made it least trustworthy exactly when it mattered:
//
// 1. Absent vitals were replaced with healthy numbers (`sbp ?? 120`,
//    `glucose ?? 100`, `bmi ?? 23`), so a patient whose blood pressure was never
//    taken scored the same as one measured at 120/80. Unmeasured now contributes
//    nothing and is reported back in `unmeasured[]`, and `vitals_complete` says
//    whether the score saw any vitals at all. A screening card that shows a
//    reassuring band must be able to say it measured nothing.
//
// 2. Symptoms were boolean: `chest_discomfort !== "none"` scored 12 whether the
//    worker tapped "mild" or "severe". The UI collects a graded scale and v1 threw
//    the grade away. Severity is now weighted, and the specific findings an ASHA is
//    trained to escalate on raise a `refer` flag that names its own cause instead
//    of silently rewriting the band.
//
// PROVENANCE: this file was recovered FROM the deployed function on 2026-08-25.
// Git held v1 while production ran v2, so a redeploy from the repo would have
// silently reverted the model. Only corsHeaders is imported because the deployed
// bundle carried an older _shared/cors.ts with no jsonResponse export; the local
// jsonResponse below is kept so the file stays identical to what is running.

import { corsHeaders } from "../_shared/cors.ts";

type RiskRequest = {
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  heart_rate?: number | null;
  respiratory_rate?: number | null;
  oxygen_saturation?: number | null;
  blood_glucose?: number | null;
  bmi?: number | null;
  waist_circumference?: number | null;
  perfusion_index?: number | null;
  waist_to_height_ratio?: number | null;
  chest_discomfort?: string;
  breathlessness?: string;
  palpitations?: string;
  fatigue_weakness?: string;
  dizziness_blackouts?: string;
  sleep_duration?: string;
  stress_anxiety?: string;
  physical_inactivity?: string;
  diet_quality?: string;
  family_history?: string;
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const r2 = (v: number) => Number(v.toFixed(2));
const lower = (v?: string) => (v ?? "").trim().toLowerCase();

/** A vital counts only if it is a finite number. null/undefined/NaN are "not measured". */
function measured(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function level(score: number) {
  if (score >= 50) return "High";
  if (score >= 30) return "Moderate";
  return "Low";
}

// Graded symptom weights. Keys are the exact chip values the ASHA form emits;
// anything unrecognised scores 0 rather than guessing.
const SYMPTOM_WEIGHTS: Record<string, Record<string, number>> = {
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

// Findings an ASHA is trained to refer on regardless of the computed band.
// Deliberately a flag, not a silent band rewrite: once one rule quietly overrides
// the score, the score stops meaning anything. This one names its own cause.
const RED_FLAGS: { field: keyof RiskRequest; value: string; hi: string; en: string }[] = [
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

// VITAL-SIGN DANGER SIGNS — added 2026-08-25 to close a live safety defect.
//
// Until now RED_FLAGS covered only three SYMPTOM fields, so no measurement could
// ever raise a referral. Measured against the deployed function:
//
//   BP 200/130 (hypertensive emergency)  -> "Moderate", refer=false
//   SpO2 88%   (hypoxia)                 -> "Low",      refer=false
//   glucose 420 mg/dL                    -> "Low",      refer=false
//
// Two causes. First, no vital was wired to a flag. Second, overall_risk_score is a
// weighted mean of three domains, so one catastrophic domain gets diluted by the
// other two sitting at their baselines — 200/130 with nothing else recorded scores
// 35.4 because the diabetic and cardiac domains contribute their floor.
//
// Thresholds are standard published ones, cited so a reviewer can argue with each:
//   BP >=180 systolic or >=120 diastolic  hypertensive crisis (ACC/AHA 2017)
//   SpO2 <90%                             hypoxia (WHO emergency triage)
//   glucose >=300 mg/dL                   hyperglycaemic emergency risk
//   glucose <=54 mg/dL                    ADA level-2 hypoglycaemia
//   HR >=130 or <=40                      tachy/bradyarrhythmia
//   RR >=30                               severe respiratory distress (WHO)
//
// NOT CLINICIAN-REVIEWED. These are defensible published numbers chosen by an
// engineer, which is better than no vital ever referring and still not good enough.
// They are the first item in docs/CLINICAL_REVIEW.md.
type Measured = {
  sbp: number | null;
  dbp: number | null;
  hr: number | null;
  rr: number | null;
  spo2: number | null;
  glucose: number | null;
};

const VITAL_DANGER_SIGNS: { test: (m: Measured) => boolean; hi: string; en: string }[] = [
  {
    // Null-safe throughout: an unmeasured vital must never raise a danger sign, the
    // same rule that stopped v1 scoring absent readings as healthy.
    test: (m) => (m.sbp !== null && m.sbp >= 180) || (m.dbp !== null && m.dbp >= 120),
    hi: "रक्तचाप बहुत अधिक (180/120 या ऊपर)",
    en: "Blood pressure at crisis level (180/120 or above)",
  },
  {
    test: (m) => m.spo2 !== null && m.spo2 < 90,
    hi: "ऑक्सीजन 90% से कम",
    en: "Oxygen saturation below 90%",
  },
  {
    test: (m) => m.glucose !== null && m.glucose >= 300,
    hi: "रक्त शर्करा 300 से अधिक",
    en: "Blood glucose 300 mg/dL or above",
  },
  {
    test: (m) => m.glucose !== null && m.glucose <= 54,
    hi: "रक्त शर्करा खतरनाक रूप से कम",
    en: "Blood glucose 54 mg/dL or below",
  },
  {
    test: (m) => m.hr !== null && (m.hr >= 130 || m.hr <= 40),
    hi: "नाड़ी की गति असामान्य",
    en: "Heart rate outside 40-130 beats per minute",
  },
  {
    test: (m) => m.rr !== null && m.rr >= 30,
    hi: "सांस बहुत तेज़",
    en: "Respiratory rate 30 or above",
  },
];

function symptomPoints(body: RiskRequest, fields: (keyof RiskRequest)[]): number {
  let total = 0;
  for (const f of fields) {
    const table = SYMPTOM_WEIGHTS[f as string];
    if (!table) continue;
    total += table[lower(body[f] as string | undefined)] ?? 0;
  }
  return total;
}

function predict(body: RiskRequest) {
  const sbp = measured(body.systolic_bp);
  const dbp = measured(body.diastolic_bp);
  const hr = measured(body.heart_rate);
  const rr = measured(body.respiratory_rate);
  const spo2 = measured(body.oxygen_saturation);
  const glucose = measured(body.blood_glucose);
  const bmi = measured(body.bmi);
  const whr = measured(body.waist_to_height_ratio);

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

  // `pts` only fires when the vital was actually taken, so a missing reading adds
  // nothing in either direction.
  const pts = (v: number | null, test: (n: number) => boolean, points: number) =>
    v !== null && test(v) ? points : 0;

  const cardiacSymptoms = symptomPoints(body, [
    "chest_discomfort",
    "breathlessness",
    "palpitations",
    "dizziness_blackouts",
    "fatigue_weakness",
  ]);
  const lifestyleSymptoms = symptomPoints(body, [
    "stress_anxiety",
    "physical_inactivity",
    "diet_quality",
    "sleep_duration",
  ]);
  const familyPoints = symptomPoints(body, ["family_history"]);

  const heartScore = clamp(
    10 +
      pts(sbp, (n) => n >= 140, 10) +
      pts(dbp, (n) => n >= 90, 8) +
      pts(hr, (n) => n >= 100 || n <= 50, 8) +
      pts(spo2, (n) => n < 94, 10) +
      pts(bmi, (n) => n >= 30, 8) +
      pts(whr, (n) => n >= 0.55, 6) +
      cardiacSymptoms * 0.9 +
      lifestyleSymptoms * 0.3 +
      familyPoints * 0.5,
  );

  const diabeticScore = clamp(
    8 +
      pts(glucose, (n) => n >= 200, 30) +
      pts(glucose, (n) => n >= 140 && n < 200, 14) +
      pts(bmi, (n) => n >= 30, 10) +
      pts(whr, (n) => n >= 0.55, 8) +
      lifestyleSymptoms * 0.8 +
      familyPoints * 0.9,
  );

  const hypertensionScore = clamp(
    6 +
      pts(sbp, (n) => n >= 180, 35) +
      pts(dbp, (n) => n >= 110, 35) +
      pts(sbp, (n) => n >= 140 && n < 180, 18) +
      pts(dbp, (n) => n >= 90 && n < 110, 18) +
      pts(rr, (n) => n > 22, 5) +
      pts(bmi, (n) => n >= 30, 8) +
      symptomPoints(body, ["stress_anxiety"]) +
      familyPoints * 0.8,
  );

  const overall = clamp(heartScore * 0.35 + diabeticScore * 0.35 + hypertensionScore * 0.3);

  const flags = RED_FLAGS.filter((f) => lower(body[f.field] as string | undefined) === f.value);
  const vitalFlags = VITAL_DANGER_SIGNS.filter((d) =>
    d.test({ sbp, dbp, hr, rr, spo2, glucose })
  );
  const allFlags = [...flags, ...vitalFlags];

  // The band a human reads must not contradict a danger sign. Telling an ASHA that
  // a patient at 88% oxygen saturation is "Low" risk is the kind of output that
  // gets someone sent home, so the CATEGORY is floored to High.
  //
  // The numeric score is left exactly as computed, and the flooring is reported in
  // category_floored_by_danger_sign — so the score still means what it measured and
  // the override is visible rather than silent, which was the original objection to
  // letting a rule rewrite the band.
  const computedCategory = level(overall);
  const floored = allFlags.length > 0 && computedCategory !== "High";

  return {
    heart_risk_total_score: r2(heartScore),
    diabetic_risk_total_score: r2(diabeticScore),
    hypertension_risk_total_score: r2(hypertensionScore),
    overall_risk_score: r2(overall),
    overall_risk_category: allFlags.length > 0 ? "High" : computedCategory,
    computed_risk_category: computedCategory,
    category_floored_by_danger_sign: floored,
    heart_risk_level: level(heartScore),
    diabetic_risk_level: level(diabeticScore),
    hypertension_risk_level: level(hypertensionScore),
    // Escalation is reported alongside the band, never hidden inside it.
    refer: allFlags.length > 0,
    refer_reasons: allFlags.map(({ hi, en }) => ({ hi, en })),
    // Lets the UI say "scored without vitals" instead of showing a confident band
    // built on values nobody took.
    vitals_complete: unmeasured.length === 0,
    unmeasured,
    model: "edge-heuristic-v3",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json()) as RiskRequest;
    return jsonResponse(predict(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
