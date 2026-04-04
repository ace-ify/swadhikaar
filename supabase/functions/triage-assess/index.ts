import { corsHeaders } from "../_shared/cors.ts";

type TriageRequest = {
  symptoms?: string[];
  vitals?: {
    systolic_bp?: number;
    diastolic_bp?: number;
    blood_glucose?: number;
    oxygen_saturation?: number;
    heart_rate?: number;
    temperature?: number;
  };
  medications_missed?: number;
  patient_risk_level?: string;
  patient_age?: number;
  call_transcript?: string;
};

const CRITICAL_KEYWORDS = new Set([
  "chest pain",
  "seene mein dard",
  "saans nahi aa rahi",
  "breathlessness",
  "stroke",
  "behosh",
  "seizure",
  "heart attack",
  "dil ka daura",
  "khoon beh raha hai",
]);

const HIGH_KEYWORDS = new Set([
  "bp bahut zyada",
  "high bp",
  "high sugar",
  "sugar bahut zyada",
  "dawai nahi li",
  "missed medication",
  "vomiting",
  "ulti",
  "palpitations",
  "chest_discomfort",
]);

const MODERATE_KEYWORDS = new Set([
  "sir dard",
  "headache",
  "thakan",
  "kamzori",
  "poor_sleep",
  "anxiety",
  "chakkar",
]);

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function matchKeywords(symptoms: string[], transcript: string, set: Set<string>) {
  const out = new Set<string>();
  const t = transcript.toLowerCase();

  for (const s of symptoms) {
    const lower = s.toLowerCase();
    if (set.has(lower) || set.has(lower.replaceAll("_", " "))) {
      out.add(s);
    }
  }

  for (const kw of set) {
    if (kw.includes(" ") && t.includes(kw)) {
      out.add(kw);
    }
  }

  return [...out];
}

function assess(body: TriageRequest) {
  const symptoms = body.symptoms ?? [];
  const transcript = (body.call_transcript ?? "").toLowerCase();
  const vitals = body.vitals ?? {};
  const medsMissed = body.medications_missed ?? 0;
  const age = body.patient_age;
  const baselineRisk = body.patient_risk_level ?? "Moderate";

  const critical = matchKeywords(symptoms, transcript, CRITICAL_KEYWORDS);
  if (critical.length > 0) {
    return {
      severity: "CRITICAL",
      severity_level: "LEVEL_1",
      reason: `Critical symptoms detected: ${critical.join(", ")}`,
      recommended_action: "Immediate doctor notification and emergency guidance.",
      needs_escalation: true,
      response_target: "< 5 minutes",
      matched_triggers: critical,
    };
  }

  const criticalVitals: string[] = [];
  if ((vitals.systolic_bp ?? 0) > 200) criticalVitals.push(`BP_critical_${vitals.systolic_bp}/${vitals.diastolic_bp ?? "?"}`);
  if ((vitals.diastolic_bp ?? 0) > 130) criticalVitals.push(`diastolic_critical_${vitals.diastolic_bp}`);
  if ((vitals.blood_glucose ?? 0) > 400) criticalVitals.push(`glucose_critical_${vitals.blood_glucose}`);
  if ((vitals.blood_glucose ?? 999) < 50) criticalVitals.push(`hypoglycemia_critical_${vitals.blood_glucose}`);
  if ((vitals.oxygen_saturation ?? 100) < 88) criticalVitals.push(`SpO2_critical_${vitals.oxygen_saturation}`);
  if ((vitals.heart_rate ?? 80) > 150 || (vitals.heart_rate ?? 80) < 40) criticalVitals.push(`heart_rate_critical_${vitals.heart_rate}`);
  if ((vitals.temperature ?? 98) > 104) criticalVitals.push(`fever_critical_${vitals.temperature}`);

  if (criticalVitals.length > 0) {
    return {
      severity: "CRITICAL",
      severity_level: "LEVEL_1",
      reason: `Critical vital signs: ${criticalVitals.join(", ")}`,
      recommended_action: "Immediate medical attention required.",
      needs_escalation: true,
      response_target: "< 5 minutes",
      matched_triggers: criticalVitals,
    };
  }

  const high = matchKeywords(symptoms, transcript, HIGH_KEYWORDS);
  if ((vitals.systolic_bp ?? 0) >= 180 && (vitals.systolic_bp ?? 0) <= 200) high.push(`BP_high_${vitals.systolic_bp}/${vitals.diastolic_bp ?? "?"}`);
  if ((vitals.diastolic_bp ?? 0) >= 110 && (vitals.diastolic_bp ?? 0) <= 130) high.push(`diastolic_high_${vitals.diastolic_bp}`);
  if ((vitals.blood_glucose ?? 0) >= 300 && (vitals.blood_glucose ?? 0) <= 400) high.push(`glucose_high_${vitals.blood_glucose}`);
  if ((vitals.blood_glucose ?? 999) >= 50 && (vitals.blood_glucose ?? 999) < 70) high.push(`glucose_low_${vitals.blood_glucose}`);
  if ((vitals.oxygen_saturation ?? 100) >= 88 && (vitals.oxygen_saturation ?? 100) < 92) high.push(`SpO2_low_${vitals.oxygen_saturation}`);
  if (((vitals.heart_rate ?? 0) >= 120 && (vitals.heart_rate ?? 0) <= 150) || ((vitals.heart_rate ?? 0) >= 40 && (vitals.heart_rate ?? 0) < 50)) high.push(`heart_rate_abnormal_${vitals.heart_rate}`);
  if (medsMissed >= 3) high.push(`medication_missed_${medsMissed}_days`);
  if ((age ?? 0) >= 65 && baselineRisk === "High") high.push("elderly_high_risk");

  if (high.length > 0) {
    return {
      severity: "HIGH",
      severity_level: "LEVEL_2",
      reason: `High severity indicators: ${high.join(", ")}`,
      recommended_action: "Alert assigned doctor within 1 hour.",
      needs_escalation: true,
      response_target: "< 1 hour",
      matched_triggers: high,
    };
  }

  const moderate = matchKeywords(symptoms, transcript, MODERATE_KEYWORDS);
  if ((vitals.systolic_bp ?? 0) >= 140 && (vitals.systolic_bp ?? 0) < 180) moderate.push(`BP_elevated_${vitals.systolic_bp}/${vitals.diastolic_bp ?? "?"}`);
  if ((vitals.blood_glucose ?? 0) >= 200 && (vitals.blood_glucose ?? 0) < 300) moderate.push(`glucose_elevated_${vitals.blood_glucose}`);
  if ((vitals.oxygen_saturation ?? 100) >= 92 && (vitals.oxygen_saturation ?? 100) < 95) moderate.push(`SpO2_borderline_${vitals.oxygen_saturation}`);
  if (medsMissed >= 1 && medsMissed < 3) moderate.push(`medication_missed_${medsMissed}_days`);

  if (moderate.length > 0) {
    return {
      severity: "MODERATE",
      severity_level: "LEVEL_3",
      reason: `Moderate concerns: ${moderate.join(", ")}`,
      recommended_action: "Schedule follow-up call within 24 hours.",
      needs_escalation: false,
      response_target: "< 24 hours",
      matched_triggers: moderate,
    };
  }

  return {
    severity: "LOW",
    severity_level: "LEVEL_3",
    reason: "No significant concerns detected.",
    recommended_action: "Continue scheduled follow-up.",
    needs_escalation: false,
    response_target: "Next scheduled call",
    matched_triggers: [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json()) as TriageRequest;
    return jsonResponse(assess(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
