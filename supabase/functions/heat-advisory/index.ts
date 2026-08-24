// Layer 4 — cross-domain heat advisory.
//
// Weather threshold -> outdoor-worker cohort in the affected district -> advisory
// voice calls in each patient's own language.
//
// Deliberately adds NO dispatch infrastructure: it writes voice_calls rows and the
// existing place_due_recovery_calls() pg_cron sweep places them. Idempotency also
// comes for free from uq_voice_calls_protocol_slot (patient_id, workflow_id,
// scheduled_for) — re-running for the same district on the same day is a no-op.

import { corsHeaders } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";

const WORKFLOW = "Heat Advisory";
const DEFAULT_THRESHOLD_C = 40;

type Req = {
  district?: string;
  lat?: number;
  lon?: number;
  dry_run?: boolean;
  force?: boolean; // bypass the weather gate (demo / drill)
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Reading = {
  source: "openweather" | "simulated";
  max_temp_c: number;
  note?: string;
};

// OpenWeather free tier. IMD has no clean public API, so IMD is the production
// path and this is what the prototype uses — labelled, never dressed up as IMD.
async function readWeather(lat?: number, lon?: number): Promise<Reading> {
  const key = Deno.env.get("OPENWEATHER_API_KEY");
  if (!key || lat === undefined || lon === undefined) {
    return {
      source: "simulated",
      max_temp_c: 43.2,
      note: "OPENWEATHER_API_KEY or coordinates absent - simulated reading, clearly labelled",
    };
  }
  const url =
    `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) {
    return {
      source: "simulated",
      max_temp_c: 43.2,
      note: `openweather ${res.status} - fell back to simulated reading`,
    };
  }
  const data = await res.json();
  const temps: number[] = (data.list ?? [])
    .slice(0, 16) // ~48h of 3-hourly slots
    .map((s: { main?: { temp_max?: number } }) => s.main?.temp_max)
    .filter((t: unknown): t is number => typeof t === "number");
  return {
    source: "openweather",
    max_temp_c: temps.length ? Math.max(...temps) : 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Req;
  try {
    body = (await req.json()) as Req;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const district = typeof body.district === "string" ? body.district.trim() : "";
  if (!district || district.length > 120) {
    return json({ error: "district is required (1-120 chars)" }, 400);
  }

  const db = getAdminClient();

  try {
    const { data: workflow, error: wfErr } = await db
      .from("workflows")
      .select("id, trigger_config, is_active")
      .eq("name", WORKFLOW)
      .maybeSingle();
    if (wfErr) throw new Error(`workflow lookup: ${wfErr.message}`);
    if (!workflow) return json({ error: `workflow "${WORKFLOW}" not found` }, 500);

    const cfg = workflow.trigger_config ?? {};
    const threshold = Number(cfg.threshold_celsius ?? DEFAULT_THRESHOLD_C);
    const hour = Number(cfg.call_hour_utc ?? 3);
    const minute = Number(cfg.call_minute_utc ?? 30);

    const reading = await readWeather(body.lat, body.lon);
    const triggered = body.force === true || reading.max_temp_c >= threshold;

    if (!triggered) {
      return json({
        ok: true,
        district,
        triggered: false,
        weather: reading,
        threshold_celsius: threshold,
        message: "below threshold - no advisory issued",
      });
    }

    const { data: cohort, error: cohortErr } = await db
      .rpc("heat_risk_cohort", { p_district: district });
    if (cohortErr) throw new Error(`cohort: ${cohortErr.message}`);

    const people = (cohort ?? []) as {
      patient_id: string;
      name: string;
      phone: string;
      language: string;
      occupation: string;
    }[];

    // One slot per day, so a re-run collides with itself and inserts nothing.
    const slot = new Date();
    slot.setUTCHours(hour, minute, 0, 0);
    const scheduledFor = slot.toISOString();

    if (body.dry_run === true) {
      return json({
        ok: true,
        district,
        triggered: true,
        dry_run: true,
        weather: reading,
        threshold_celsius: threshold,
        cohort_size: people.length,
        would_schedule_for: scheduledFor,
        sample: people.slice(0, 5).map((p) => ({
          name: p.name,
          occupation: p.occupation,
          language: p.language,
        })),
      });
    }

    let queued: unknown[] = [];
    if (people.length > 0) {
      const { data: calls, error: callErr } = await db
        .from("voice_calls")
        .upsert(
          people.map((p) => ({
            patient_id: p.patient_id,
            workflow_id: workflow.id,
            call_type: "advisory",
            use_case: "heat_advisory",
            status: "scheduled",
            language: p.language ?? "hindi",
            scheduled_for: scheduledFor,
            extracted_data: {
              district,
              occupation: p.occupation,
              max_temp_c: reading.max_temp_c,
              weather_source: reading.source,
              threshold_celsius: threshold,
            },
          })),
          {
            onConflict: "patient_id,workflow_id,scheduled_for",
            ignoreDuplicates: true,
          },
        )
        .select("id, patient_id");
      if (callErr) throw new Error(`advisory scheduling: ${callErr.message}`);
      queued = calls ?? [];
    }

    const { error: auditErr } = await db.from("audit_log").insert({
      user_role: "cross_domain_layer",
      action: "heat_advisory_issued",
      resource_type: "district",
      details: {
        district,
        cohort_size: people.length,
        calls_queued: (queued as unknown[]).length,
        max_temp_c: reading.max_temp_c,
        weather_source: reading.source,
        forced: body.force === true,
      },
    });
    if (auditErr) console.error(`audit_log insert failed: ${auditErr.message}`);

    return json({
      ok: true,
      district,
      triggered: true,
      weather: reading,
      threshold_celsius: threshold,
      cohort_size: people.length,
      calls_queued: (queued as unknown[]).length,
      scheduled_for: scheduledFor,
      note: "queued into voice_calls - the existing pg_cron sweep places them",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`heat-advisory failed: ${message}`);
    return json({ error: message }, 500);
  }
});
