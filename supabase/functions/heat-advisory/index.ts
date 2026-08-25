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

// WHICH TEMPERATURE MATTERS
// Dry-bulb 40C is IMD's *meteorological* heatwave line for the plains. It is the
// wrong gate for *occupational* heat stress: at 89% monsoon humidity sweat stops
// evaporating, so a Muzaffarpur field labourer at 36.4C air temperature is enduring
// an apparent 42C. Thresholding on dry bulb told 16 outdoor workers there was no
// heat risk on a day the heat index was two degrees over the line. We gate on heat
// index and report dry bulb beside it, so the number that made the decision and the
// number a thermometer shows are both visible.
type Reading = {
  source: "openweather" | "simulated";
  heat_index_c: number;
  dry_bulb_c: number;
  humidity_pct: number;
  resolved_place?: string;
  note?: string;
};

function simulated(note: string): Reading {
  return { source: "simulated", heat_index_c: 43.2, dry_bulb_c: 41, humidity_pct: 60, note };
}

// The district arrives as free text from an operator's keyboard, so a hardcoded
// district->coordinates table would break on the first district nobody thought of.
// Geocode with the same key instead: one extra call, every district in India, and
// nothing to maintain. Returning the resolved place name also lets the UI prove it
// hit a real gazetteer rather than a lookup we wrote ourselves.
async function geocode(district: string, key: string) {
  const url = `https://api.openweathermap.org/geo/1.0/direct` +
    `?q=${encodeURIComponent(district)},IN&limit=1&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const hits = await res.json();
  const hit = Array.isArray(hits) ? hits[0] : null;
  if (!hit || typeof hit.lat !== "number" || typeof hit.lon !== "number") return null;
  return {
    lat: hit.lat as number,
    lon: hit.lon as number,
    place: [hit.name, hit.state].filter(Boolean).join(", "),
  };
}

// OpenWeather free tier. IMD has no clean public API, so IMD is the production
// path and this is what the prototype uses — labelled, never dressed up as IMD.
async function readWeather(district: string, lat?: number, lon?: number): Promise<Reading> {
  const key = Deno.env.get("OPENWEATHER_API_KEY");
  if (!key) {
    return simulated("OPENWEATHER_API_KEY not set - simulated reading, clearly labelled");
  }

  let place: string | undefined;
  if (lat === undefined || lon === undefined) {
    const geo = await geocode(district, key);
    // A key that is valid but not yet activated 401s here too. Say which district
    // failed — "simulated" with no reason is the kind of note nobody investigates.
    if (!geo) return simulated(`could not geocode "${district}" - simulated reading`);
    lat = geo.lat;
    lon = geo.lon;
    place = geo.place;
  }

  const url = `https://api.openweathermap.org/data/2.5/forecast` +
    `?lat=${lat}&lon=${lon}&units=metric&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) return simulated(`openweather ${res.status} - fell back to simulated reading`);

  const data = await res.json();
  const slots = (data.list ?? []).slice(0, 16); // ~48h of 3-hourly slots
  // Independent maxima, not the readings from a single slot: the threshold should
  // answer "what is the worst moment in this window", and peak humidity does not
  // have to land on the same three-hour slot as peak air temperature.
  const pick = (read: (m: Record<string, number>) => number | undefined) =>
    slots
      .map((s: { main?: Record<string, number> }) => (s.main ? read(s.main) : undefined))
      .filter((n: unknown): n is number => typeof n === "number");

  const dry = pick((m) => m.temp_max);
  const feels = pick((m) => m.feels_like);
  const hum = pick((m) => m.humidity);
  if (!dry.length) return simulated("openweather returned no temperatures");

  return {
    source: "openweather",
    // feels_like is absent on some plans; dry bulb is then the honest best estimate.
    heat_index_c: Math.round((feels.length ? Math.max(...feels) : Math.max(...dry)) * 100) / 100,
    dry_bulb_c: Math.round(Math.max(...dry) * 100) / 100,
    humidity_pct: hum.length ? Math.max(...hum) : 0,
    resolved_place: place ?? `${lat}, ${lon}`,
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

    const reading = await readWeather(district, body.lat, body.lon);
    const forced = body.force === true;
    const triggered = forced || reading.heat_index_c >= threshold;

    if (!triggered) {
      return json({
        ok: true,
        district,
        triggered: false,
        weather: reading,
        threshold_celsius: threshold,
        message: `heat index ${reading.heat_index_c}°C (air ${reading.dry_bulb_c}°C at ` +
          `${reading.humidity_pct}% humidity) is below the ${threshold}°C threshold ` +
          `- no advisory issued`,
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
        forced,
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
              heat_index_c: reading.heat_index_c,
              dry_bulb_c: reading.dry_bulb_c,
              humidity_pct: reading.humidity_pct,
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
        heat_index_c: reading.heat_index_c,
        dry_bulb_c: reading.dry_bulb_c,
        weather_source: reading.source,
        forced,
      },
    });
    if (auditErr) console.error(`audit_log insert failed: ${auditErr.message}`);

    return json({
      ok: true,
      district,
      triggered: true,
      forced,
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
