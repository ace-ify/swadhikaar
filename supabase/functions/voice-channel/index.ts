// Join-only LiveKit token for an incident's voice channel.
//
// Two rooms per incident, and the split is the point:
//   operator  — crew <-> dispatcher and the receiving hospital. Ops talk.
//   emergency — the reporter at the scene. A different room because the person
//               standing over a bleeding stranger should not hear a bed argument.
//
// Same SDK, same env vars and the same join-only grant as start-voice-call's browser
// path: no admin grant, no SIP grant, scoped to one room. Nothing here dials a phone
// number — this is a room, not a call, so it cannot place outbound minutes.

import { AccessToken } from "npm:livekit-server-sdk@2.15.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";

type Channel = "operator" | "emergency";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  const url = (Deno.env.get("LIVEKIT_URL") ?? "").trim();
  const apiKey = (Deno.env.get("LIVEKIT_API_KEY") ?? "").trim();
  const apiSecret = (Deno.env.get("LIVEKIT_API_SECRET") ?? "").trim();
  if (!url || !apiKey || !apiSecret) {
    return jsonResponse(
      {
        error: "not_configured",
        detail: "LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must all be set.",
      },
      503,
    );
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return jsonResponse({ error: "unauthorised" }, 401);

  let body: { incident_id?: string; channel?: Channel } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "body must be JSON" }, 400);
  }
  const incidentId = body.incident_id;
  const channel: Channel = body.channel === "emergency" ? "emergency" : "operator";
  if (!incidentId) return jsonResponse({ error: "incident_id is required" }, 400);

  const admin = getAdminClient();
  const { data: auth } = await admin.auth.getUser(bearer);
  const uid = auth?.user?.id;
  if (!uid) return jsonResponse({ error: "unauthorised" }, 401);

  const { data: incident } = await admin
    .from("incidents")
    .select("id, ref, created_by")
    .eq("id", incidentId)
    .maybeSingle();
  if (!incident) return jsonResponse({ error: "no_such_incident" }, 404);

  // Who may speak on this incident at all.
  const [{ data: roleRow }, { data: unit }, { data: staff }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", uid).maybeSingle(),
    admin
      .from("fleet_units")
      .select("call_sign")
      .eq("operator_uid", uid)
      .eq("assigned_incident_id", incidentId)
      .maybeSingle(),
    admin
      .from("incident_dispatch")
      .select("accepted_facility_id")
      .eq("incident_id", incidentId)
      .maybeSingle(),
  ]);

  const role = String(roleRow?.role ?? "");
  const isOps = ["admin", "dispatcher"].includes(role);
  const isCrew = Boolean(unit);
  const isReporter = incident.created_by === uid;

  let isReceivingStaff = false;
  if (staff?.accepted_facility_id) {
    const { data: fs } = await admin
      .from("facility_staff")
      .select("user_id")
      .eq("user_id", uid)
      .eq("facility_id", staff.accepted_facility_id)
      .maybeSingle();
    isReceivingStaff = Boolean(fs);
  }

  // The reporter belongs on the scene channel only; ops talk is not theirs to hear.
  const mayJoin =
    channel === "emergency"
      ? isOps || isCrew || isReporter
      : isOps || isCrew || isReceivingStaff;

  if (!mayJoin) return jsonResponse({ error: "not_authorised_for_channel" }, 403);

  const identity = isCrew
    ? `crew-${unit!.call_sign}`
    : isOps
      ? `ops-${uid.slice(0, 8)}`
      : isReceivingStaff
        ? `hospital-${uid.slice(0, 8)}`
        : `reporter-${uid.slice(0, 8)}`;

  // Keyed on ref, not the uuid: it is what people say out loud, and the room name
  // shows up in LiveKit's own dashboard where a uuid would be unreadable.
  const room = `incident-${incident.ref}-${channel}`;

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: identity,
    // Long enough for a whole run. Shorter and a crew gets kicked mid-transport.
    ttl: 7200,
  });
  token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

  return jsonResponse({
    ok: true,
    room,
    channel,
    identity,
    livekit_token: await token.toJwt(),
    livekit_url: url,
  });
});
