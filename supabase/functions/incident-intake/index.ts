// Incident intake. The only way an incident enters the system from outside the ops
// console, and deliberately the only way: RLS lets ops insert incidents and nobody
// else, so a patient's SOS has to come through a server entry point rather than a
// direct table write. EOS lets any signed-in client write to sos_incidents, which is
// why their rate limiter runs as a parallel trigger and can never gate anything.
//
// Order of operations matters and is the whole point:
//   1. log the raw request        <- before any parsing, so a parse bug loses nothing
//   2. authenticate
//   3. parse and range-check
//   4. rate-limit  (flag, never block)
//   5. insert, then open dispatch
//
// EOS answers 200 with empty TwiML on an unparseable SMS and console.logs the first
// 100 characters. A genuine emergency in a message their regex did not expect leaves
// no durable trace at all.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";

type Channel = "sos_button" | "sms_relay" | "ivr" | "api" | "manual";
const CHANNELS: Channel[] = ["sos_button", "sms_relay", "ivr", "api", "manual"];

interface Parsed {
  lat: number;
  lon: number;
  incident_type: string;
  description: string | null;
  triage_colour: string | null;
  victim_name: string | null;
  victim_age: number | null;
  reporter_name: string | null;
  reporter_phone: string | null;
  address: string | null;
  district: string | null;
  vitals: Record<string, unknown>;
  required_services: string[];
  // False when a bystander reports for someone else. The attach trigger uses it to
  // decide whether the reporter's medical record is the victim's medical record.
  reported_for_self: boolean;
}

// EOS's own format, with their trap preserved as a comment rather than as a bug:
// their query params are x = LATITUDE and y = LONGITUDE, inverted from the usual
// reading of x/y, and they never range-check either one, so x=999 is storable.
function parseGeoSms(body: string): { lat: number; lon: number } | null {
  const url = body.match(/https?:\/\/[^\s]+\/sos\?[^\s]+/i)?.[0];
  if (url) {
    const q = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    const lat = Number(q.get("x"));
    const lon = Number(q.get("y"));
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  // `geo:` URI, which is what most Android SMS share sheets actually produce.
  const geo = body.match(/geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (geo) {
    const lat = Number(geo[1]);
    const lon = Number(geo[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return null;
}

function parse(channel: Channel, body: Record<string, unknown>): Parsed {
  let lat = Number(body.lat);
  let lon = Number(body.lon);

  if (channel === "sms_relay" && (!Number.isFinite(lat) || !Number.isFinite(lon))) {
    const found = parseGeoSms(String(body.Body ?? body.body ?? ""));
    if (!found) throw new Error("no coordinates in message");
    lat = found.lat;
    lon = found.lon;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("lat and lon are required numbers");
  }
  // The database enforces this too. Checked here as well so the caller gets a
  // reason instead of a constraint-violation string.
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error(`coordinates out of range: ${lat}, ${lon}`);
  }

  const age = Number(body.victim_age);
  return {
    lat,
    lon,
    incident_type: String(body.incident_type ?? "Emergency").slice(0, 120),
    description: body.description ? String(body.description).slice(0, 2000) : null,
    triage_colour: ["red", "orange", "yellow", "green", "black"].includes(
        String(body.triage_colour))
      ? String(body.triage_colour)
      : null,
    victim_name: body.victim_name ? String(body.victim_name).slice(0, 120) : null,
    victim_age: Number.isFinite(age) && age >= 0 && age <= 130 ? Math.floor(age) : null,
    reporter_name: body.reporter_name ? String(body.reporter_name).slice(0, 120) : null,
    reporter_phone: body.reporter_phone
      ? String(body.reporter_phone).slice(0, 20)
      : body.From
        ? String(body.From).slice(0, 20)
        : null,
    address: body.address ? String(body.address).slice(0, 240) : null,
    district: body.district ? String(body.district).slice(0, 120) : null,
    vitals: typeof body.vitals === "object" && body.vitals !== null
      ? body.vitals as Record<string, unknown>
      : {},
    required_services: Array.isArray(body.required_services)
      ? body.required_services.map(String).slice(0, 8)
      : [],
    // Defaults to true so every existing caller keeps its current behaviour; only the
    // "someone else" path has to say so.
    reported_for_self: body.reported_for_self !== false,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  const admin = getAdminClient();

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // A body that is not JSON still gets logged, as form-encoded or raw text.
    body = { raw: "unparseable body" };
  }

  const channel: Channel = CHANNELS.includes(body.channel as Channel)
    ? (body.channel as Channel)
    : "api";

  // Step 1 — log before anything can go wrong.
  const { data: logRow } = await admin
    .from("intake_events")
    .insert({
      channel,
      payload: body,
      headers: {
        "user-agent": req.headers.get("user-agent"),
        "content-type": req.headers.get("content-type"),
        "x-forwarded-for": req.headers.get("x-forwarded-for"),
      },
      source_ip: req.headers.get("x-forwarded-for"),
    })
    .select("id")
    .single();

  const logId = logRow?.id as string | undefined;
  const finish = async (
    outcome: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (logId) await admin.from("intake_events").update({ outcome, ...extra }).eq("id", logId);
  };

  // Step 2 — authenticate. Either a signed-in user's token, or the shared secret
  // for machine callers (SMS gateway, partner API). The secret is server-side only
  // and must never reach a browser.
  const secret = (Deno.env.get("ACUTE_INTAKE_SECRET") ?? "").trim();
  const presented = req.headers.get("x-intake-secret") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  let callerUid: string | null = null;
  let authorised = false;

  if (secret && presented && presented === secret) {
    authorised = true;
  } else if (bearer) {
    const { data } = await admin.auth.getUser(bearer);
    if (data?.user) {
      callerUid = data.user.id;
      authorised = true;
    }
  }

  if (!authorised) {
    await finish("unauthorised");
    return jsonResponse({ error: "unauthorised" }, 401);
  }

  // Step 3 — parse.
  let parsed: Parsed;
  try {
    parsed = parse(channel, body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "parse failed";
    await finish("parse_failed", { caller_uid: callerUid, error: message });
    return jsonResponse({ error: "could not read this request", detail: message }, 400);
  }

  // Step 4 — rate limit. Flagged, never blocked: EOS blocked once, a blocked
  // incident dropped out of other devices' listeners, and the result was missed
  // alerts. A flagged incident here still dispatches and stays visible.
  const { data: limitReason } = await admin.rpc("intake_rate_limit_reason", {
    p_uid: callerUid,
    p_phone: parsed.reporter_phone,
  });

  // Step 5 — insert, then dispatch. Severity is NOT accepted from the caller: the
  // classifier trigger decides it from triage colour, keywords and vitals.
  const { data: incident, error: insertError } = await admin
    .from("incidents")
    .insert({
      ...parsed,
      intake_source: channel,
      created_by: callerUid,
      rate_limit_flagged: Boolean(limitReason),
      rate_limit_reason: limitReason ?? null,
    })
    .select("id, ref, severity, status")
    .single();

  if (insertError || !incident) {
    await finish("rejected", { caller_uid: callerUid, error: insertError?.message });
    return jsonResponse({ error: "could not record the incident", detail: insertError?.message }, 500);
  }

  // Capacity IS weighed. The parameter keeps its old "simulated" name because three
  // other call sites pass it, but since 014 a facility can declare its own beds, blood
  // and staffing from the inbox screen, so the numbers are operator-stated rather than
  // invented. The factors JSON on every candidate says which of the two it was —
  // `facility_declared` with a timestamp, or `SEEDED`.
  const { data: dispatch, error: dispatchError } = await admin.rpc("open_dispatch", {
    p_incident: incident.id,
    p_use_simulated_capacity: true,
  });

  await finish("accepted", { caller_uid: callerUid, incident_id: incident.id });

  return jsonResponse({
    ok: true,
    incident_id: incident.id,
    ref: incident.ref,
    severity: incident.severity,
    rate_limit_flagged: Boolean(limitReason),
    rate_limit_reason: limitReason ?? null,
    dispatch: dispatchError ? { ok: false, error: dispatchError.message } : dispatch,
  });
});
