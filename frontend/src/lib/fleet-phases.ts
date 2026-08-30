// The EMS phase ladder, in one place.
//
// It exists twice by nature: set_ambulance_phase in the database is the authority, and
// the crew's screen has to know which button to show. Two copies of a transition table
// is exactly the drift this project keeps getting bitten by, so ALLOWED mirrors the
// migration verbatim and fleet-phases.test.mjs asserts the buttons never propose a step
// the database would refuse.
//
// Source of truth: supabase/migrations/011_fleet_operator_app.sql, set_ambulance_phase.

export type FleetPhase =
  | "on_scene"
  | "transporting"
  | "delivered"
  | "returning"
  | "complete";

// phase the crew is asking for -> the states the RPC will accept it from.
export const ALLOWED: Record<FleetPhase, string[]> = {
  on_scene: ["en_route"],
  transporting: ["on_scene"],
  delivered: ["transporting"],
  returning: ["delivered"],
  complete: ["returning"],
};

export interface LadderStep {
  from: string;
  next: FleetPhase;
  label: string;
  // Shown as a confirm() before firing. Only on steps that are hard to walk back.
  confirm?: string;
}

export const LADDER: LadderStep[] = [
  { from: "en_route", next: "on_scene", label: "Arrived on scene" },
  { from: "on_scene", next: "transporting", label: "Patient loaded — moving" },
  {
    from: "transporting",
    next: "delivered",
    label: "Handed over at hospital",
    confirm: "Confirm the patient is with hospital staff?",
  },
  { from: "delivered", next: "returning", label: "Returning to station" },
  { from: "returning", next: "complete", label: "Back at station — end run" },
];

export const PHASE_LABEL: Record<string, string> = {
  pending_operator: "Waiting for a crew",
  en_route: "Inbound to scene",
  on_scene: "On scene",
  transporting: "Transporting to hospital",
  delivered: "Handed over",
  returning: "Returning to station",
  no_operator: "No crew answered",
};

// Metres between two coordinates. Same formula as haversine_km in the database, in
// metres because the on-scene geofence is 200 m and kilometres would round it away.
export function metresBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const p = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * p) / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(((lon2 - lon1) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const ON_SCENE_RADIUS_M = 200;
