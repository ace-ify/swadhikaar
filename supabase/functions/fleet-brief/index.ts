// Scene brief for the crew, generated from the incident's OWN record.
//
// What it reads: the incident row, its vitals and emergency snapshot, and its
// incident_events timeline — which is where the en-route care entries and every
// dispatch decision already land. That is the whole input.
//
// A scene photograph is reported as PRESENT or ABSENT but is never described. No vision
// model is wired here, so the brief says "there is a photo, look at it" rather than
// pretending to have seen it — and it never claims a photo is absent when one exists,
// which was the first version's bug.
//
// What it does NOT read, because it does not exist in this system: volunteer field
// reports. There is no volunteers table, so a brief claiming to summarise them would be
// summarising nothing. If they arrive later they are more rows in the same timeline and
// this prompt picks them up for free.
//
// The model is advisory and the response says so. Severity is NOT touched here:
// backend/voice_agent/agent.py owns the severity ladder and a second one is exactly
// the defect the triage-assess tombstone exists to prevent.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";

const MODEL = Deno.env.get("GOOGLE_LLM_MODEL") ?? "gemini-3-flash-preview";

const SYSTEM = `You brief an ambulance crew driving to a scene in Bihar or Assam, India.

Write at most 90 words, in this order:
1. One line: who and what.
2. What the crew should have ready on arrival, based ONLY on what the record says.
3. Anything in the record that contradicts itself or is missing and matters.

Rules:
- Use ONLY the record below. Never invent a vital sign, a drug, or a finding.
- If the record is thin, say it is thin. Do not pad.
- scene_photo_attached tells you a photograph EXISTS. You cannot see it. If it is true,
  tell the crew to look at the photo on their screen. Never describe its contents.
- No diagnosis, no drug doses. You are not the clinician; the crew is.
- Plain English, short sentences. This is read at a traffic light.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  const apiKey = (Deno.env.get("GOOGLE_API_KEY") ?? "").trim();
  // Named distinctly on purpose. A generic 500 here is indistinguishable from a model
  // outage, and an unset secret that looks set is the most common failure in this
  // project's history.
  if (!apiKey) {
    return jsonResponse(
      {
        error: "not_configured",
        detail:
          "GOOGLE_API_KEY is not set on this project. Set it in Edge Functions " +
          "secrets; it is the same Gemini key backend/voice_agent uses.",
      },
      503,
    );
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return jsonResponse({ error: "unauthorised" }, 401);

  let body: { incident_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body must be JSON" }, 400);
  }
  const incidentId = body.incident_id;
  if (!incidentId) return jsonResponse({ error: "incident_id is required" }, 400);

  const admin = getAdminClient();
  const { data: auth } = await admin.auth.getUser(bearer);
  const uid = auth?.user?.id;
  if (!uid) return jsonResponse({ error: "unauthorised" }, 401);

  // Authorisation: the crew on this run, or ops. Deliberately narrower than the read
  // policies on incidents — a brief is a summary of somebody's worst day and does not
  // need to be reachable by everyone who can see the row.
  const [{ data: unit }, { data: roleRow }] = await Promise.all([
    admin
      .from("fleet_units")
      .select("id, call_sign")
      .eq("operator_uid", uid)
      .eq("assigned_incident_id", incidentId)
      .maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", uid).maybeSingle(),
  ]);
  const isOps = ["admin", "dispatcher"].includes(String(roleRow?.role));
  if (!unit && !isOps) return jsonResponse({ error: "not_authorised_for_incident" }, 403);

  const [{ data: incident }, { data: events }] = await Promise.all([
    admin
      .from("incidents")
      .select(
        "ref, incident_type, severity, triage_colour, description, victim_name, " +
          "victim_age, address, district, vitals, medical_snapshot, required_services, " +
          "reported_for_self, scene_photo_path, created_at",
      )
      .eq("id", incidentId)
      .single(),
    admin
      .from("incident_events")
      .select("at, action, actor_role, detail")
      .eq("incident_id", incidentId)
      .order("seq", { ascending: true })
      .limit(60),
  ]);

  if (!incident) return jsonResponse({ error: "no_such_incident" }, 404);

  // The path itself never goes to the model — a storage key is not information, and
  // a URL in a prompt is a URL the model may try to describe. Only the boolean does.
  const { scene_photo_path, ...rest } = incident as Record<string, unknown>;
  const hasPhoto = Boolean(scene_photo_path);
  const record = JSON.stringify(
    { incident: { ...rest, scene_photo_attached: hasPhoto }, timeline: events ?? [] },
    null,
    1,
  );

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `RECORD:\n${record}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    return jsonResponse({ error: "model_failed", status: res.status, detail }, 502);
  }

  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("")
    .trim();

  if (!text) {
    return jsonResponse(
      { error: "model_returned_nothing", finish: payload?.candidates?.[0]?.finishReason },
      502,
    );
  }

  return jsonResponse({
    ok: true,
    brief: text,
    model: MODEL,
    // The screen has to be able to say where this came from and what it is worth.
    advisory: true,
    sources: {
      incident_record: true,
      timeline_events: (events ?? []).length,
      // Present-or-absent only. The model has not seen the image.
      scene_photo_attached: hasPhoto,
      volunteer_reports: false,
    },
  });
});
