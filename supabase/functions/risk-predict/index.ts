import { corsHeaders } from "../_shared/cors.ts";

type RiskRequest = {
  systolic_bp?: number;
  diastolic_bp?: number;
  heart_rate?: number;
  respiratory_rate?: number;
  oxygen_saturation?: number;
  blood_glucose?: number;
  bmi?: number;
  waist_circumference?: number;
  perfusion_index?: number;
  waist_to_height_ratio?: number;
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
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function clamp(v: number) {
  return Math.max(0, Math.min(100, v));
}

function level(score: number) {
  if (score >= 50) return "High";
  if (score >= 30) return "Moderate";
  return "Low";
}

function boolRisk(cond: boolean, points: number) {
  return cond ? points : 0;
}

function toLower(v?: string) {
  return (v ?? "").toLowerCase();
}

function predict(body: RiskRequest) {
  const sbp = body.systolic_bp ?? 120;
  const dbp = body.diastolic_bp ?? 80;
  const hr = body.heart_rate ?? 78;
  const rr = body.respiratory_rate ?? 16;
  const spo2 = body.oxygen_saturation ?? 97;
  const glucose = body.blood_glucose ?? 100;
  const bmi = body.bmi ?? 23;
  const whr = body.waist_to_height_ratio ?? 0.5;

  const symptomRisk =
    boolRisk(toLower(body.chest_discomfort) !== "none", 12) +
    boolRisk(toLower(body.breathlessness) !== "none", 10) +
    boolRisk(toLower(body.palpitations) !== "none", 8) +
    boolRisk(toLower(body.dizziness_blackouts) !== "never", 10) +
    boolRisk(toLower(body.stress_anxiety) !== "calm", 4) +
    boolRisk(toLower(body.physical_inactivity) !== "active", 6) +
    boolRisk(toLower(body.diet_quality) !== "balanced", 6) +
    boolRisk(toLower(body.family_history) !== "none", 8);

  const heartScore = clamp(
    10 +
      boolRisk(sbp >= 140, 10) +
      boolRisk(dbp >= 90, 8) +
      boolRisk(hr >= 100 || hr <= 50, 8) +
      boolRisk(spo2 < 94, 10) +
      boolRisk(bmi >= 30, 8) +
      boolRisk(whr >= 0.55, 6) +
      symptomRisk * 0.55
  );

  const diabeticScore = clamp(
    8 +
      boolRisk(glucose >= 200, 30) +
      boolRisk(glucose >= 140 && glucose < 200, 14) +
      boolRisk(bmi >= 30, 10) +
      boolRisk(whr >= 0.55, 8) +
      boolRisk(toLower(body.physical_inactivity) !== "active", 8) +
      boolRisk(toLower(body.diet_quality) !== "balanced", 8) +
      boolRisk(toLower(body.family_history) !== "none", 12)
  );

  const hypertensionScore = clamp(
    6 +
      boolRisk(sbp >= 180 || dbp >= 110, 35) +
      boolRisk((sbp >= 140 && sbp < 180) || (dbp >= 90 && dbp < 110), 18) +
      boolRisk(rr > 22, 5) +
      boolRisk(bmi >= 30, 8) +
      boolRisk(toLower(body.stress_anxiety) !== "calm", 8) +
      boolRisk(toLower(body.family_history) !== "none", 10)
  );

  const overall = clamp((heartScore * 0.35) + (diabeticScore * 0.35) + (hypertensionScore * 0.3));

  return {
    heart_risk_total_score: Number(heartScore.toFixed(2)),
    diabetic_risk_total_score: Number(diabeticScore.toFixed(2)),
    hypertension_risk_total_score: Number(hypertensionScore.toFixed(2)),
    overall_risk_score: Number(overall.toFixed(2)),
    overall_risk_category: level(overall),
    heart_risk_level: level(heartScore),
    diabetic_risk_level: level(diabeticScore),
    hypertension_risk_level: level(hypertensionScore),
    model: "edge-heuristic-v1",
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
    const body = (await req.json()) as RiskRequest;
    return jsonResponse(predict(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
