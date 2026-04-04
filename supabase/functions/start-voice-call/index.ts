import { SignJWT } from "npm:jose@5";
import { corsHeaders } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";

type StartCallRequest = {
  patient_id: string;
  patient_name?: string;
  language?: string;
  call_type?: string;
  phone_number?: string;
  age?: number;
  gender?: string;
  health_camp?: string;
  risk_level?: string;
  risk_score?: number;
  systolic_bp?: number;
  diastolic_bp?: number;
  blood_glucose?: number;
  bmi?: number;
  medications?: string;
  doctor_name?: string;
  primary_condition?: string;
  baby_name?: string;
  baby_age?: string;
  baby_gender?: string;
  next_vaccine?: string;
  vaccine_dose?: string;
  vaccine_due_date?: string;
  birth_hospital?: string;
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

function env(name: string): string {
  return Deno.env.get(name) ?? "";
}

async function createLivekitJwt(opts: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name?: string;
  room?: string;
  roomJoin?: boolean;
  roomCreate?: boolean;
  roomAdmin?: boolean;
  sipAdmin?: boolean;
  sipCall?: boolean;
  ttlSeconds?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? 3600;

  const videoGrant: Record<string, unknown> = {};
  if (opts.roomJoin) videoGrant.roomJoin = true;
  if (opts.roomCreate) videoGrant.roomCreate = true;
  if (opts.roomAdmin) videoGrant.roomAdmin = true;
  if (opts.room) videoGrant.room = opts.room;

  const payload: Record<string, unknown> = {
    iss: opts.apiKey,
    sub: opts.identity,
    nbf: now,
    exp: now + ttl,
    video: videoGrant,
  };

  if (opts.sipAdmin || opts.sipCall) {
    payload.sip = {
      ...(opts.sipAdmin ? { admin: true } : {}),
      ...(opts.sipCall ? { call: true } : {}),
    };
  }

  if (opts.name) {
    payload.name = opts.name;
  }

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(new TextEncoder().encode(opts.apiSecret));
}

async function twirpRequest(
  livekitUrl: string,
  authToken: string,
  service: string,
  method: string,
  body: Record<string, unknown>
) {
  const base = livekitUrl.replace("wss://", "https://").replace("ws://", "http://").replace(/\/$/, "");
  const url = `${base}/twirp/${service}/${method}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${service}.${method} failed (${res.status}): ${txt}`);
  }

  return await res.json();
}

async function buildPatientContext(patientId: string) {
  const supabase = getAdminClient();

  const [vitalsRes, symptomsRes, riskRes, callsRes, newbornRes] = await Promise.all([
    supabase
      .from("health_vitals")
      .select("*")
      .eq("patient_id", patientId)
      .order("recorded_at", { ascending: false })
      .limit(1),
    supabase
      .from("symptoms")
      .select("*")
      .eq("patient_id", patientId)
      .order("recorded_at", { ascending: false })
      .limit(1),
    supabase
      .from("risk_assessments")
      .select("*")
      .eq("patient_id", patientId)
      .order("assessed_at", { ascending: false })
      .limit(1),
    supabase
      .from("voice_calls")
      .select("call_type,status,severity,transcript,created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("newborns")
      .select("*")
      .eq("parent_patient_id", patientId)
      .limit(1),
  ]);

  const ctx: Record<string, unknown> = {};

  const vitals = vitalsRes.data?.[0];
  if (vitals) {
    ctx.systolic_bp = vitals.systolic_bp;
    ctx.diastolic_bp = vitals.diastolic_bp;
    ctx.blood_glucose = vitals.blood_glucose;
    ctx.bmi = vitals.bmi;
    ctx.heart_rate = vitals.heart_rate;
    ctx.oxygen_saturation = vitals.oxygen_saturation;
  }

  const symptoms = symptomsRes.data?.[0];
  if (symptoms) {
    const keys = [
      "chest_discomfort",
      "breathlessness",
      "palpitations",
      "fatigue_weakness",
      "dizziness_blackouts",
      "stress_anxiety",
    ];
    const active = keys
      .map((k) => ({ key: k, value: symptoms[k] as string | null }))
      .filter((x) => x.value && !["none", "no", "never", ""].includes(String(x.value).toLowerCase()))
      .map((x) => `${x.key.replace(/_/g, " ")}: ${x.value}`);
    if (active.length > 0) ctx.active_symptoms = active.join(", ");
    ctx.family_history = symptoms.family_history;
    ctx.diet_quality = symptoms.diet_quality;
    ctx.sleep_duration = symptoms.sleep_duration;
  }

  const risk = riskRes.data?.[0];
  if (risk) {
    ctx.heart_risk = `${risk.heart_risk_level ?? "N/A"} (${risk.heart_risk_score ?? "N/A"})`;
    ctx.diabetic_risk = `${risk.diabetic_risk_level ?? "N/A"} (${risk.diabetic_risk_score ?? "N/A"})`;
    ctx.hypertension_risk = `${risk.hypertension_risk_level ?? "N/A"} (${risk.hypertension_risk_score ?? "N/A"})`;
  }

  const calls = callsRes.data ?? [];
  if (calls.length > 0) {
    ctx.call_history = calls
      .map((c) => {
        const date = c.created_at ? String(c.created_at).slice(0, 10) : "?";
        const preview = String(c.transcript ?? "").slice(0, 200).replaceAll("\n", " ");
        return `${date} | ${c.call_type ?? "?"} | severity=${c.severity ?? "?"} | ${preview}`;
      })
      .join("\n");
    ctx.total_previous_calls = String(calls.length);
  }

  const baby = newbornRes.data?.[0];
  if (baby) {
    ctx.baby_name = baby.baby_name;
    ctx.baby_gender = baby.gender;
    ctx.birth_hospital = baby.birth_hospital;
    ctx.baby_dob = baby.date_of_birth;

    if (baby.date_of_birth) {
      const dob = new Date(baby.date_of_birth);
      const ageDays = Math.max(0, Math.floor((Date.now() - dob.getTime()) / 86400000));
      if (ageDays < 30) ctx.baby_age = `${ageDays} days`;
      else if (ageDays < 365) ctx.baby_age = `${Math.floor(ageDays / 30)} months`;
      else ctx.baby_age = `${Math.floor(ageDays / 365)} years`;
    }

    const vaxRes = await supabase
      .from("vaccination_schedules")
      .select("*")
      .eq("newborn_id", baby.id)
      .in("status", ["pending", "overdue"])
      .order("due_date", { ascending: true })
      .limit(1);
    const vax = vaxRes.data?.[0];
    if (vax) {
      ctx.next_vaccine = vax.vaccine_name;
      ctx.vaccine_due_date = vax.due_date;
      ctx.vaccine_dose = String(vax.dose_number ?? 1);
    }
  }

  return Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== null && v !== undefined));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json()) as StartCallRequest;
    if (!body.patient_id) {
      return jsonResponse({ error: "patient_id is required" }, 400);
    }

    const livekitUrl = env("LIVEKIT_URL");
    const livekitApiKey = env("LIVEKIT_API_KEY");
    const livekitApiSecret = env("LIVEKIT_API_SECRET");
    const sipTrunkId = env("SIP_TRUNK_ID");

    if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
      return jsonResponse({
        call_id: `local-${Date.now()}`,
        status: "config_missing",
        livekit_token: null,
        livekit_url: null,
      });
    }

    const patientName = body.patient_name || "Patient";
    const callType = body.call_type || "follow_up";
    const language = body.language || "hindi";
    const roomName = `swadhikaar-${body.patient_id}-${Math.floor(Date.now() / 1000)}`;

    const context = await buildPatientContext(body.patient_id);
    const metadata = JSON.stringify({ ...body, ...context, language, call_type: callType });

    const adminToken = await createLivekitJwt({
      apiKey: livekitApiKey,
      apiSecret: livekitApiSecret,
      identity: "supabase-edge",
      name: "Supabase Edge",
      room: roomName,
      roomCreate: true,
      roomAdmin: true,
      sipAdmin: true,
      sipCall: true,
      ttlSeconds: 300,
    });

    await twirpRequest(
      livekitUrl,
      adminToken,
      "livekit.RoomService",
      "CreateRoom",
      {
        name: roomName,
        metadata,
        agents: [{ agent_name: "", metadata }],
      }
    );

    if (body.phone_number) {
      if (!sipTrunkId) {
        return jsonResponse({ error: "SIP_TRUNK_ID not configured for outbound calling" }, 400);
      }

      await twirpRequest(
        livekitUrl,
        adminToken,
        "livekit.SIP",
        "CreateSIPParticipant",
        {
          sip_trunk_id: sipTrunkId,
          sip_call_to: body.phone_number,
          room_name: roomName,
          participant_identity: `phone-${body.patient_id}`,
          participant_name: patientName,
          wait_until_answered: true,
        }
      );

      return jsonResponse({
        call_id: roomName,
        status: "dialing",
        livekit_token: null,
        livekit_url: livekitUrl,
      });
    }

    const participantToken = await createLivekitJwt({
      apiKey: livekitApiKey,
      apiSecret: livekitApiSecret,
      identity: `patient-${body.patient_id}`,
      name: patientName,
      room: roomName,
      roomJoin: true,
      ttlSeconds: 3600,
    });

    return jsonResponse({
      call_id: roomName,
      status: "connecting",
      livekit_token: participantToken,
      livekit_url: livekitUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
