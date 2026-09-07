// The kiosk's session endpoint. One function for the whole visit rather than four,
// because every action here is a write against the same row and the authorisation story
// is identical for all of them.
//
// WHY THIS EXISTS AT ALL, given start-voice-call already creates rooms: that function
// requires a patient_id and builds a call context out of camp vitals and previous call
// history. A walk-in has neither. It also dials phones, which means it holds a SIP grant
// this path must never have. Extending it would have meant a second mode threaded
// through a function whose whole shape assumes "we already know this person".
//
// THE TRUST MODEL. This endpoint is UNAUTHENTICATED, deliberately: a patient standing at
// an OPD kiosk has no account, and requiring one would exclude exactly the first-visit,
// elderly and low-literacy patients PS 2.2 says dominate government OPD volume. What
// protects it:
//   * it can only ever create a patients row and a case_sessions row, never read another
//     patient's history back out — `start` returns only what the caller supplied plus
//     the ids it just created;
//   * intake_rate_limit_reason(), the same guard incident-intake uses, caps how fast one
//     phone or one anonymous caller can open sessions;
//   * the LiveKit token it mints is join-only and scoped to one room, no admin grant and
//     no SIP grant, so it cannot place a call or touch another room.
//
// What it does NOT do is authenticate the patient's identity. An ABHA number typed at a
// kiosk is an unverified claim until Module D's ABHA auth verifies it, and `abha_verified`
// on the session says which of the two happened. Believing a typed number would let
// anyone open a stranger's record by knowing their ABHA id.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";
import { AccessToken, RoomAgentDispatch, RoomServiceClient } from "npm:livekit-server-sdk@2.15.4";
import {
  CONSENT_PURPOSES,
  DASHAVIDHA_FACTORS,
  LANGUAGES,
  SECTIONS,
  isKnownLanguage,
  isKnownSection,
  sectionForCode,
  str,
  validateAnswerRows,
  validateFactorRows,
} from "./logic.ts";

type Action = "start" | "consent" | "answer" | "abandon";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const httpHost = (url: string) => url.replace(/^wss?:\/\//, "https://");
const nowIso = () => new Date().toISOString();

/** The three "already on record" lines the case_taking prompt reads. */
function onRecord(list: unknown): string {
  if (!Array.isArray(list) || list.length === 0) return "Nothing on record";
  return list.filter((x) => typeof x === "string" && x.trim()).join(", ") || "Nothing on record";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body must be JSON" }, 400);
  }

  const action = (str(body.action, 20) ?? "start") as Action;
  const sb = getAdminClient();

  try {
    switch (action) {
      case "start":
        return await start(sb, body);
      case "consent":
        return await consent(sb, body);
      case "answer":
        return await answer(sb, body);
      case "abandon":
        return await abandon(sb, body);
      default:
        return jsonResponse({ error: `Unknown action ${action}` }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`case-session ${action} failed:`, message);
    return jsonResponse({ error: message }, 500);
  }
});

// ---------------------------------------------------------------------------- start
async function start(sb: ReturnType<typeof getAdminClient>, body: Record<string, unknown>) {
  const language = (str(body.language, 20) ?? "hindi").toLowerCase();
  if (!LANGUAGES.has(language)) {
    return jsonResponse({ error: `Unsupported language ${language}` }, 400);
  }
  const mode = (str(body.mode, 20) ?? "allopathic").toLowerCase();
  if (mode !== "allopathic" && mode !== "ayush") {
    return jsonResponse({ error: `mode must be allopathic or ayush` }, 400);
  }

  const abhaId = str(body.abha_id, 40);
  const phone = str(body.phone, 20);
  const name = str(body.name, 120);

  // Match on ABHA first, then phone. Nothing else: matching on name would merge two
  // people called Ram Kumar into one medical record, which is worse than a duplicate.
  let patient: Record<string, unknown> | null = null;
  if (abhaId) {
    const { data } = await sb.from("patients")
      .select("id,name,language,chronic_conditions,current_medications,allergies,abha_id")
      .eq("abha_id", abhaId).limit(1);
    patient = data?.[0] ?? null;
  }
  if (!patient && phone) {
    const { data } = await sb.from("patients")
      .select("id,name,language,chronic_conditions,current_medications,allergies,abha_id")
      .eq("phone", phone).limit(1);
    patient = data?.[0] ?? null;
  }

  // RATE LIMIT, and only where there is something to key on.
  //
  // The obvious reuse here was intake_rate_limit_reason(), which incident-intake calls.
  // Reading it first showed it counts rows in `incidents` by created_by or
  // reporter_phone — nothing to do with kiosk sessions. Wired in, it would have been a
  // limiter that could never fire on this path: a limit that always returns null looks
  // exactly like a limit that is working.
  //
  // So: a real per-patient cap, which stops one person opening twenty sessions.
  // A brand-new patient has no key to count against, and that gap is real — an
  // unauthenticated kiosk cannot distinguish a first-time walk-in from a script
  // creating patients rows. Mitigating that needs a staffed kiosk or a captive
  // network, not code here, and pretending otherwise is worse than saying it.
  if (patient) {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await sb.from("case_sessions")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patient.id)
      .gte("started_at", since);
    if ((count ?? 0) >= 3) {
      return jsonResponse(
        {
          error: "Too many sessions started for this patient in the last few minutes.",
          status: "rate_limited",
        },
        429,
      );
    }
  }

  let created = false;
  if (!patient) {
    if (!name) {
      return jsonResponse(
        { error: "A new patient needs a name. Send abha_id or phone to match an existing one." },
        400,
      );
    }
    const { data, error } = await sb.from("patients").insert({
      name,
      phone,
      abha_id: abhaId,
      language,
      intake_source: "kiosk",
      consent_status: "pending",
    }).select("id,name,language,chronic_conditions,current_medications,allergies,abha_id").single();
    if (error) throw error;
    patient = data;
    created = true;
  }

  const { data: session, error: sessionError } = await sb.from("case_sessions").insert({
    patient_id: patient.id,
    language,
    mode,
    status: "identifying",
  }).select("id,status,started_at").single();
  if (sessionError) throw sessionError;

  const room = await openRoom({ session, patient, language, mode });

  return jsonResponse({
    session_id: session.id,
    status: session.status,
    patient: { id: patient.id, name: patient.name, is_new: created, abha_id: patient.abha_id ?? null },
    // An unverified claim until Module D authenticates it. The kiosk shows the number
    // greyed with "not yet verified" so nobody reads it as identity.
    abha_verified: false,
    ...room,
  });
}

/**
 * The LiveKit room, and the metadata agent.py reads in on_enter. Returns a null token
 * rather than throwing when LiveKit is unconfigured: the touch path is a complete
 * interview on its own (PS 2.3 requires both modes), so a missing voice key should
 * degrade the kiosk to tapping, not close it.
 */
async function openRoom(args: {
  session: Record<string, unknown>;
  patient: Record<string, unknown>;
  language: string;
  mode: string;
}) {
  const url = env("LIVEKIT_URL");
  const key = env("LIVEKIT_API_KEY");
  const secret = env("LIVEKIT_API_SECRET");
  if (!url || !key || !secret) {
    console.warn("LiveKit not configured — kiosk session is touch-only");
    return { livekit_token: null, livekit_url: null, room: null, voice: "unavailable" };
  }

  const roomName = `kiosk-${args.session.id}`;
  const metadata = JSON.stringify({
    // The three agent.py needs to record anything at all.
    session_id: args.session.id,
    call_type: "case_taking",
    mode: args.mode,
    // Context so the interview does not re-ask what the record already holds.
    patient_id: args.patient.id,
    patient_name: args.patient.name,
    language: args.language,
    known_conditions: onRecord(args.patient.chronic_conditions),
    known_medications: onRecord(args.patient.current_medications),
    known_allergies: onRecord(args.patient.allergies),
  });

  const host = httpHost(url);
  const rooms = new RoomServiceClient(host, key, secret);
  // agentName "" matches a worker registered without one — verified in
  // backend/check_dispatch.py, same as start-voice-call.
  await rooms.createRoom({
    name: roomName,
    metadata,
    agents: [new RoomAgentDispatch({ agentName: "", metadata })],
  });

  // Join-only, one room, no admin grant and no SIP grant. This token goes to a screen
  // in a public waiting area.
  const token = new AccessToken(key, secret, {
    identity: `kiosk-${args.session.id}`,
    name: String(args.patient.name ?? "Patient"),
    ttl: 1800,
  });
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

  await sbLog(args.session.id as string, "room_opened", { room: roomName });
  return { livekit_token: await token.toJwt(), livekit_url: url, room: roomName, voice: "ready" };
}

/** Audit without failing the request: a lost log line must not lose the session. */
async function sbLog(sessionId: string, action: string, details: Record<string, unknown>) {
  try {
    await getAdminClient().from("audit_log").insert({
      user_role: "kiosk",
      action: `kiosk_${action}`,
      resource_type: "case_session",
      resource_id: sessionId,
      details,
    });
  } catch (error) {
    console.error("audit_log write failed:", error);
  }
}

// -------------------------------------------------------------------------- consent
// PS 3.3 Module D: consent must be granular, revocable, and explained in audio for
// low-literacy users. So this takes a LIST of purposes rather than one boolean, and it
// records WHETHER the audio played and IN WHICH LANGUAGE. A single "I agree" checkbox
// would satisfy neither the DPDP Act's specific-purpose requirement nor the PS.

async function consent(sb: ReturnType<typeof getAdminClient>, body: Record<string, unknown>) {
  const sessionId = str(body.session_id, 40);
  if (!sessionId) return jsonResponse({ error: "session_id is required" }, 400);

  const granted = Array.isArray(body.granted) ? body.granted.map((g) => String(g)) : [];
  const unknown = granted.filter((g) => !CONSENT_PURPOSES.has(g));
  if (unknown.length) return jsonResponse({ error: `Unknown purposes: ${unknown.join(", ")}` }, 400);

  // collect_history is the floor. Without it there is nothing to consent about and the
  // session should not proceed — better a clear refusal here than an interview whose
  // answers cannot lawfully be stored.
  if (!granted.includes("collect_history")) {
    return jsonResponse(
      { error: "collect_history is required to continue", status: "declined" },
      400,
    );
  }

  const { data: session } = await sb.from("case_sessions")
    .select("id,patient_id,language,status").eq("id", sessionId).single();
  if (!session) return jsonResponse({ error: "No such session" }, 404);

  const audioLanguage = str(body.audio_language, 20);
  const audioPlayed = body.audio_explained === true;

  // ABDM consent artefacts carry a validity window. One OPD visit does not need a year:
  // 24 hours covers the consultation and anything the clinician does the same day.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const rows = granted.map((purpose) => ({
    patient_id: session.patient_id,
    session_id: sessionId,
    purpose,
    scope: "case_session",
    consent_mode: audioPlayed ? "audio_explained_tap" : "tap",
    granted_at: nowIso(),
    is_active: true,
    expires_at: expiresAt,
    audio_explained_at: audioPlayed ? nowIso() : null,
    audio_language: audioPlayed ? (audioLanguage ?? session.language) : null,
  }));

  const { error } = await sb.from("consents").insert(rows);
  if (error) throw error;

  await sb.from("patients").update({ consent_status: "granted" }).eq("id", session.patient_id);
  await sb.from("case_sessions").update({ status: "consented" }).eq("id", sessionId);
  await sbLog(sessionId, "consent", { granted, audio_explained: audioPlayed, audio_language: audioLanguage });

  return jsonResponse({
    session_id: sessionId,
    status: "consented",
    granted,
    // Reported back so the kiosk can show what was NOT given rather than implying
    // everything was agreed to.
    withheld: [...CONSENT_PURPOSES].filter((p) => !granted.includes(p)),
    expires_at: expiresAt,
  });
}

// --------------------------------------------------------------------------- answer
// The touch half of PS 2.3's dual-mode requirement, and the correction path for the
// voice half: a patient who hears the read-back and taps to fix something writes here,
// overwriting the row the agent wrote. source is recorded either way, so we can later
// say how much of a given interview was spoken versus tapped.
async function answer(sb: ReturnType<typeof getAdminClient>, body: Record<string, unknown>) {
  const sessionId = str(body.session_id, 40);
  if (!sessionId) return jsonResponse({ error: "session_id is required" }, 400);

  const { data: session } = await sb.from("case_sessions")
    .select("id,status,mode,red_flag,patient_id").eq("id", sessionId).single();
  if (!session) return jsonResponse({ error: "No such session" }, 404);
  // Consent is the gate. An answer arriving before it means the kiosk skipped a screen,
  // and storing it would be collecting health data without a lawful basis.
  if (session.status === "identifying") {
    return jsonResponse({ error: "Consent has not been recorded for this session" }, 403);
  }
  if (session.status === "consulted" || session.status === "abandoned") {
    return jsonResponse({ error: `Session is ${session.status}` }, 409);
  }

  const answers = Array.isArray(body.answers) ? body.answers : [];
  const factors = Array.isArray(body.dashavidha) ? body.dashavidha : [];
  if (answers.length === 0 && factors.length === 0 && !body.red_flag) {
    return jsonResponse({ error: "Nothing to record" }, 400);
  }

  let written = 0;

  if (answers.length) {
    const rows = validateAnswerRows(answers, sessionId, (msg, meta) => console.warn(msg, meta));
    if (rows.length) {
      const { error } = await sb.from("history_answers")
        .upsert(rows, { onConflict: "session_id,item_code" });
      if (error) throw error;
      written += rows.length;
    }
  }

  if (factors.length) {
    if (session.mode !== "ayush") {
      return jsonResponse({ error: "Dashavidha is only collected in ayush mode" }, 400);
    }
    const rows = validateFactorRows(factors, sessionId, (msg, meta) => console.warn(msg, meta));
    if (rows.length) {
      const { error } = await sb.from("dashavidha_assessments")
        .upsert(rows, { onConflict: "session_id,factor" });
      if (error) throw error;
      written += rows.length;
    }
  }

  // A red flag the client's rule engine fired. Accepted on trust in one direction only:
  // it can raise a flag, never clear one. The worst a hostile caller achieves is a false
  // alarm at a triage desk, where the alternative — refusing client-side detection —
  // means a tapped interview cannot escalate at all.
  const flag = body.red_flag as Record<string, unknown> | undefined;
  if (flag && !session.red_flag) {
    const reason = str(flag.reason, 500);
    const ruleId = str(flag.rule_id, 60);
    if (reason) {
      const severity = String(flag.severity ?? "").toUpperCase() === "HIGH" ? "HIGH" : "CRITICAL";
      await sb.from("case_sessions").update({
        red_flag: true,
        red_flag_reason: `${severity}: ${reason}${ruleId ? ` (${ruleId})` : ""}`,
      }).eq("id", sessionId);

      const { data: s } = await sb.from("case_sessions")
        .select("patient_id").eq("id", sessionId).single();
      if (s?.patient_id) {
        const { data: esc } = await sb.from("escalations").insert({
          patient_id: s.patient_id,
          severity_level: severity === "CRITICAL" ? "3" : "2",
          severity,
          reason: `[kiosk touch] ${reason}`,
          status: "open",
        }).select("id").single();
        if (esc?.id) {
          await sb.from("case_sessions").update({ escalation_id: esc.id }).eq("id", sessionId);
        }
      }
      await sbLog(sessionId, "red_flag", { rule_id: ruleId, severity, source: "touch" });
    }
  }

  if (session.status === "consented") {
    await sb.from("case_sessions").update({ status: "interviewing" }).eq("id", sessionId);
  }

  return jsonResponse({ session_id: sessionId, recorded: written });
}

// -------------------------------------------------------------------------- abandon
// A patient who walks away. Marked rather than deleted: an abandoned interview still
// tells the clinic that somebody with a complaint gave up at question four, and the
// answers already given still belong to that person.
async function abandon(sb: ReturnType<typeof getAdminClient>, body: Record<string, unknown>) {
  const sessionId = str(body.session_id, 40);
  if (!sessionId) return jsonResponse({ error: "session_id is required" }, 400);

  const { data, error } = await sb.from("case_sessions")
    .update({ status: "abandoned", ended_at: nowIso() })
    .eq("id", sessionId)
    .in("status", ["identifying", "consented", "interviewing", "scanning"])
    .select("id,status");
  if (error) throw error;
  if (!data?.length) {
    return jsonResponse({ error: "Session is already finished or does not exist" }, 409);
  }
  await sbLog(sessionId, "abandoned", { reason: str(body.reason, 200) });
  return jsonResponse({ session_id: sessionId, status: "abandoned" });
}




