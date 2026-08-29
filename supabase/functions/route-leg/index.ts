// Road geometry for the leg an ambulance is actually driving.
//
// Called by cron every 20 seconds. Finds every live vehicle leg with no route for its
// current phase, fetches one from OpenRouteService, and writes it to incident_dispatch
// where tick_fleet_positions picks it up on the next tick.
//
// Idempotent by design: it selects only rows where route_target does not already match
// the phase, so running it twice in the same window is a no-op rather than a double spend
// of a 2000/day quota.
//
// A failure is never fatal. tick_fleet_positions falls back to a straight line whenever
// route_geometry is null, so no key, no quota, no network, or a scene ORS cannot reach
// (a field, a highway median) all degrade to the old behaviour instead of freezing the
// vehicle mid-screen.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";

const ORS = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";

// Rounded to 4 decimal places (~11 m) so the cache actually hits: the same ambulance
// leaving the same station for the same junction is one row, not a hundred. Finer than
// the vehicle's own step, so nothing visible is lost.
const key4 = (n: number) => Number(n.toFixed(4));

type Leg = {
  incident_id: string;
  target: "scene" | "hospital";
  from_lat: number;
  from_lon: number;
  to_lat: number;
  to_lon: number;
};

interface RouteResult {
  geometry: [number, number][];
  distance_m: number;
  duration_s: number;
}

async function fetchRoute(leg: Leg, apiKey: string): Promise<RouteResult | null> {
  // ORS takes [lon, lat] and returns [lon, lat]. Everything on our side is [lat, lon] --
  // Leaflet's order -- so the transposition happens exactly once, here.
  const res = await fetch(ORS, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      coordinates: [
        [leg.from_lon, leg.from_lat],
        [leg.to_lon, leg.to_lat],
      ],
    }),
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) return null;
  const body = await res.json();
  const feature = body?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  return {
    geometry: coords.map((c: [number, number]) => [c[1], c[0]] as [number, number]),
    distance_m: Number(feature.properties?.summary?.distance ?? 0),
    duration_s: Number(feature.properties?.summary?.duration ?? 0),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = (Deno.env.get("OPENROUTESERVICE_API_KEY") ?? "").trim();
  if (!apiKey || apiKey.startsWith("your-")) {
    // 200, not 500: this is a cron caller, and a missing key is a configuration state to
    // report rather than an error to retry. The straight-line fallback is already handling it.
    return jsonResponse({
      ok: false,
      reason: "OPENROUTESERVICE_API_KEY is not set on this project",
      hint: "Dashboard -> Edge Functions -> Secrets",
      filled: 0,
    });
  }

  const admin = getAdminClient();

  // The leg each live vehicle is driving right now. `en_route` is heading to the scene;
  // `transporting` is heading to the hospital that accepted.
  const { data: rows, error } = await admin
    .from("incident_dispatch")
    .select(
      "incident_id, ambulance_state, route_target, assigned_unit_id," +
        "unit:fleet_units!incident_dispatch_assigned_unit_id_fkey(lat,lon)," +
        "incident:incidents!inner(lat,lon,status)," +
        "hospital:facilities!incident_dispatch_accepted_facility_id_fkey(lat,lon)",
    )
    .in("ambulance_state", ["en_route", "transporting"])
    .not("assigned_unit_id", "is", null);

  if (error) return jsonResponse({ ok: false, error: error.message, filled: 0 }, 500);

  const legs: Leg[] = [];
  for (const r of rows ?? []) {
    const row = r as Record<string, any>;
    const target: "scene" | "hospital" =
      row.ambulance_state === "transporting" ? "hospital" : "scene";
    if (row.route_target === target) continue; // already routed for this phase
    if (row.incident?.status === "arrived") continue;

    const from = row.unit;
    const to = target === "hospital" ? row.hospital : row.incident;
    if (!from?.lat || !from?.lon || !to?.lat || !to?.lon) continue;

    legs.push({
      incident_id: row.incident_id,
      target,
      from_lat: key4(Number(from.lat)),
      from_lon: key4(Number(from.lon)),
      to_lat: key4(Number(to.lat)),
      to_lon: key4(Number(to.lon)),
    });
  }

  let filled = 0;
  let cached = 0;
  const failures: string[] = [];

  for (const leg of legs) {
    // Cache first. ORS free tier is 40 requests a minute and a demo repeats the same
    // legs constantly.
    const { data: hit } = await admin
      .from("route_legs")
      .select("geometry, distance_m, duration_s")
      .eq("from_lat", leg.from_lat)
      .eq("from_lon", leg.from_lon)
      .eq("to_lat", leg.to_lat)
      .eq("to_lon", leg.to_lon)
      .maybeSingle();

    let route: RouteResult | null = hit
      ? {
          geometry: hit.geometry as [number, number][],
          distance_m: Number(hit.distance_m),
          duration_s: Number(hit.duration_s),
        }
      : null;

    if (route) {
      cached += 1;
    } else {
      try {
        route = await fetchRoute(leg, apiKey);
      } catch (e) {
        route = null;
        failures.push(`${leg.incident_id}: ${e instanceof Error ? e.message : "fetch failed"}`);
      }
      if (route) {
        await admin.from("route_legs").insert({
          from_lat: leg.from_lat,
          from_lon: leg.from_lon,
          to_lat: leg.to_lat,
          to_lon: leg.to_lon,
          geometry: route.geometry,
          distance_m: route.distance_m,
          duration_s: route.duration_s,
        });
      }
    }

    if (!route) {
      failures.push(`${leg.incident_id}: no route for ${leg.target}`);
      continue;
    }

    // route_index resets to 0: this is a fresh polyline and the vehicle is at its start.
    const { error: writeError } = await admin
      .from("incident_dispatch")
      .update({
        route_geometry: route.geometry,
        route_target: leg.target,
        route_index: 0,
        route_distance_m: route.distance_m,
        route_duration_s: route.duration_s,
        // The published ETA becomes the road duration rather than haversine at a flat
        // 30 km/h. This is the number the patient reads.
        ambulance_eta_seconds: Math.round(route.duration_s),
      })
      .eq("incident_id", leg.incident_id);

    if (writeError) failures.push(`${leg.incident_id}: ${writeError.message}`);
    else filled += 1;
  }

  return jsonResponse({ ok: true, considered: legs.length, filled, cached, failures });
});
