"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

// Client surface for the acute layer. Every mutation is an rpc, never a table
// write: there is deliberately no client write policy on incident_dispatch or
// dispatch_offers, so a facility cannot mark itself accepted with an UPDATE. That
// is what makes "only the current wave may accept" enforceable rather than
// advisory.

function db() {
  return createClient();
}

export type IncidentStatus =
  | "pending"
  | "dispatched"
  | "en_route"
  | "arrived"
  | "resolved"
  | "expired"
  | "cancelled";

export type DispatchStateName =
  | "offering"
  | "accepted"
  | "exhausted"
  | "no_candidates"
  | "stood_down";

export type OfferStateName =
  | "pending"
  | "accepted"
  | "declined"
  | "superseded"
  | "timed_out";

export interface Incident {
  id: string;
  ref: string;
  victim_name: string | null;
  victim_age: number | null;
  reporter_phone: string | null;
  lat: number;
  lon: number;
  address: string | null;
  district: string | null;
  incident_type: string;
  description: string | null;
  severity: "critical" | "high" | "standard";
  triage_colour: string | null;
  required_services: string[];
  status: IncidentStatus;
  vitals: Record<string, number | string | null>;
  // Copied from the patient's profile at create time. Empty for a bystander call about
  // someone the system does not know.
  medical_snapshot: Record<string, unknown>;
  golden_hour_start: string;
  intake_source: string;
  is_simulated: boolean;
  rate_limit_flagged: boolean;
  created_at: string;
  // Embedded so the board can show wave state without a query per row. PostgREST
  // returns a one-to-one embed as an object and a one-to-many as an array; this FK
  // is the dispatch table's primary key, so it is the former — but normalise
  // anyway rather than depend on that detection.
  dispatch?: BoardDispatch | BoardDispatch[] | null;
}

export interface BoardDispatch {
  state: DispatchStateName;
  wave_index: number;
  max_waves: number;
  wave_timeout_at: string | null;
  accepted_facility_id: string | null;
}

export function boardDispatch(i: Incident): BoardDispatch | null {
  const d = i.dispatch;
  if (!d) return null;
  return Array.isArray(d) ? (d[0] ?? null) : d;
}

// Every factor carries its own provenance. Six are sourced from OpenStreetMap or
// from our own dispatch tables; capacity, staffing and blood arrive with
// `included: false` because no public source publishes them, and their weight is
// redistributed across the six rather than silently part-inventing a score.
//
// `factors` also holds two NON-factor keys — `eta_basis` (a string) and
// `sourced_weight_redistributed` (a boolean) — so anything iterating it has to
// check the shape rather than assume every value is a factor.
export interface ScoreFactor {
  weight?: number;
  value?: number;
  source?: string;
  included?: boolean;
  concurrent?: number;
  matched?: boolean;
  needed?: string[];
  facility_specialities?: string[];
}

export type FactorMap = Record<string, ScoreFactor | string | boolean | number>;

export function isFactor(v: unknown): v is ScoreFactor {
  return typeof v === "object" && v !== null && "weight" in v;
}

export interface RankedCandidate {
  facility_id: string;
  name: string;
  rank: number;
  score: number;
  distance_km: number;
  eta_seconds: number | null;
  tier: string | null;
  factors: FactorMap;
  disqualified: boolean | null;
}

export interface IncidentDispatch {
  incident_id: string;
  state: DispatchStateName;
  severity: string;
  parallel_per_wave: number;
  wave_timeout_ms: number;
  max_waves: number;
  wave_index: number;
  ordered_facility_ids: string[];
  current_wave_facility_ids: string[];
  offered_facility_ids: string[];
  ranked_candidates: RankedCandidate[];
  wave_started_at: string | null;
  // ABSOLUTE deadline, not now() - notified_at. EOS recomputes theirs, so any write
  // restarts the fuse; the countdown below can be trusted because this cannot move.
  wave_timeout_at: string | null;
  accepted_facility_id: string | null;
  accepted_at: string | null;
  eta_seconds: number | null;
  exhausted_at: string | null;
  last_escalation_reason: string | null;
  fallback_notified: boolean;
  // Vehicle leg. Opens automatically when a hospital accepts — a crew with nowhere
  // to deliver is not a plan, so the hospital acceptance gates it.
  ambulance_state: AmbulanceState | null;
  ambulance_attempts: number;
  ambulance_dispatched_at: string | null;
  ambulance_notified_units: string[];
  assigned_unit_id: string | null;
  ambulance_accepted_at: string | null;
  ambulance_eta_seconds: number | null;
  // Set when the accepting hospital had no free vehicle and one was borrowed from
  // the next facility on the ranked list.
  ambulance_relay_facility_id: string | null;
  ambulance_exhausted_at: string | null;
}

export type AmbulanceState =
  | "pending_operator"
  | "en_route"
  | "on_scene"
  | "transporting"
  | "delivered"
  | "no_operator";

export type FleetOfferState =
  | "awaiting_response"
  | "accepted"
  | "rejected"
  | "no_response";

export interface FleetAssignment {
  id: string;
  incident_id: string;
  unit_id: string;
  attempt: number;
  state: FleetOfferState;
  source: string;
  distance_km: number | null;
  dispatched_at: string;
  response_deadline_at: string;
  responded_at: string | null;
  reason: string | null;
  unit: {
    call_sign: string;
    driver_name: string | null;
    vehicle_type: string;
    is_simulated: boolean;
  } | null;
  station: { name: string } | null;
}

export interface DispatchOffer {
  id: string;
  incident_id: string;
  facility_id: string;
  wave_index: number;
  state: OfferStateName;
  rank: number;
  score: number;
  distance_km: number;
  eta_seconds: number | null;
  factors: FactorMap;
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
  decline_reason: string | null;
  superseded_by: string | null;
  facility: { name: string; district: string | null; emergency: boolean | null } | null;
  // The facility that won the race, when this offer lost it.
  winner: { name: string } | null;
}

export interface OutboxRow {
  id: string;
  channel: "in_app" | "sms" | "push" | "voice";
  kind: string;
  wave_index: number | null;
  status:
    | "queued"
    | "sending"
    | "sent"
    | "failed"
    | "skipped_unconfigured"
    | "abandoned";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  sent_at: string | null;
  facility: { name: string } | null;
  unit: { call_sign: string } | null;
}

export interface IncidentEvent {
  id: string;
  seq: number;
  incident_id: string;
  at: string;
  action: string;
  actor_role: string | null;
  from_status: string | null;
  to_status: string | null;
  detail: Record<string, unknown>;
}

// One channel for the whole layer; any change bumps a counter the screens depend
// on. Reconciling four tables' payloads by hand — including the PostgREST facility
// embed on offers — would be more code and more ways to be wrong than refetching a
// board that is 50 rows at its worst.
export function useAcutePulse() {
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const client = db();
    const channel = client.channel("acute-layer");
    // Emitting one wave is ~5 row events (three offers, the dispatch row, an audit
    // row). Coalesce them, or one state change costs five full refetch rounds.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setPulse((n) => n + 1);
      }, 300);
    };

    for (const table of [
      "incidents",
      "incident_dispatch",
      "dispatch_offers",
      "incident_events",
      // Without this the patient's map never moves on its own: the vehicle's position
      // changes in fleet_units and nothing else does, so no other table's event would
      // wake the refetch.
      "fleet_units",
    ]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, bump);
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, []);

  return pulse;
}

export function useIncidents(pulse = 0) {
  const [data, setData] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void db()
      .from("incidents")
      .select(
        "*, dispatch:incident_dispatch(state,wave_index,max_waves," +
          "wave_timeout_at,accepted_facility_id)",
      )
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data: rows, error: err }) => {
        if (cancelled) return;
        // Cast through unknown: with no generated database types, supabase-js
        // cannot resolve the embedded relation and infers an error shape.
        setData((rows as unknown as Incident[]) ?? []);
        setError(err?.message ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pulse]);

  return { data, loading, error };
}

// Dispatch row, offers and audit trail in one round trip each, refetched together.
// Three separate hooks would give three separate loading states for one screen.
export function useIncidentDetail(incidentId: string | null, pulse = 0) {
  const [dispatch, setDispatch] = useState<IncidentDispatch | null>(null);
  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [fleet, setFleet] = useState<FleetAssignment[]>([]);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  // Which incident the rows in state actually belong to. Without this, clicking a
  // second incident renders the FIRST one's offers under the second one's header
  // until the fetch lands — an ops screen attributing one case's offers to another.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!incidentId) return;
    let cancelled = false;
    const client = db();

    void Promise.all([
      client
        .from("incident_dispatch")
        .select("*")
        .eq("incident_id", incidentId)
        .maybeSingle(),
      client
        .from("dispatch_offers")
        // Both FK hints are required, not optional style: dispatch_offers has TWO
        // foreign keys to facilities (facility_id and superseded_by), so a bare
        // `facilities(...)` embed is ambiguous and PostgREST answers 300 PGRST201.
        .select(
          "*, facility:facilities!dispatch_offers_facility_id_fkey(name,district,emergency)," +
            "winner:facilities!dispatch_offers_superseded_by_fkey(name)",
        )
        .eq("incident_id", incidentId)
        .order("wave_index", { ascending: false })
        .order("rank", { ascending: true }),
      client
        .from("incident_events")
        .select("*")
        .eq("incident_id", incidentId)
        // seq, not `at`: `at` defaults to now(), which is transaction time, so
        // events written in one transaction share a timestamp and sort arbitrarily.
        .order("seq", { ascending: true }),
      client
        .from("fleet_assignments")
        .select(
          "*, unit:fleet_units(call_sign,driver_name,vehicle_type,is_simulated)," +
            "station:facilities(name)",
        )
        .eq("incident_id", incidentId)
        .order("attempt", { ascending: false })
        .order("distance_km", { ascending: true }),
      client
        .from("notification_outbox")
        .select("*, facility:facilities(name), unit:fleet_units(call_sign)")
        .eq("incident_id", incidentId)
        .order("created_at", { ascending: false }),
    ]).then(([d, o, e, f, n]) => {
      if (cancelled) return;
      setDispatch((d.data as IncidentDispatch | null) ?? null);
      setOffers((o.data as unknown as DispatchOffer[]) ?? []);
      setEvents((e.data as IncidentEvent[]) ?? []);
      setFleet((f.data as unknown as FleetAssignment[]) ?? []);
      setOutbox((n.data as unknown as OutboxRow[]) ?? []);
      setLoadedFor(incidentId);
    });

    return () => {
      cancelled = true;
    };
  }, [incidentId, pulse]);

  const fresh = incidentId !== null && loadedFor === incidentId;
  return {
    dispatch: fresh ? dispatch : null,
    offers: fresh ? offers : [],
    events: fresh ? events : [],
    fleet: fresh ? fleet : [],
    outbox: fresh ? outbox : [],
    loading: incidentId !== null && !fresh,
  };
}

// ---------------------------------------------------------------------------
// Patient side — their own live emergency
// ---------------------------------------------------------------------------

export interface MyIncident {
  id: string;
  ref: string;
  incident_type: string;
  description: string | null;
  severity: "critical" | "high" | "standard";
  status: IncidentStatus;
  address: string | null;
  district: string | null;
  lat: number;
  lon: number;
  golden_hour_start: string;
  created_at: string;
  medical_snapshot: Record<string, unknown>;
  dispatch: MyDispatch | MyDispatch[] | null;
}

export interface MyDispatch {
  state: DispatchStateName;
  wave_index: number;
  max_waves: number;
  wave_timeout_at: string | null;
  eta_seconds: number | null;
  ambulance_state: AmbulanceState | null;
  ambulance_eta_seconds: number | null;
  hospital: { name: string; lat: number; lon: number } | null;
  unit: {
    call_sign: string;
    driver_name: string | null;
    lat: number | null;
    lon: number | null;
    heading_deg: number | null;
  } | null;
}

export function myDispatch(i: MyIncident | null): MyDispatch | null {
  if (!i?.dispatch) return null;
  return Array.isArray(i.dispatch) ? (i.dispatch[0] ?? null) : i.dispatch;
}

// The patient's own most recent emergency, with everything the screen needs in one
// round trip. The FK hint is mandatory: incident_dispatch has two foreign keys to
// facilities (accepted and relay), so a bare embed is ambiguous and PostgREST answers
// 300 -- the same trap dispatch_offers set earlier.
export function useMyLiveIncident(pulse = 0) {
  const [data, setData] = useState<MyIncident | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void db()
      .from("incidents")
      .select(
        "id,ref,incident_type,description,severity,status,address,district,lat,lon," +
          "golden_hour_start,created_at,medical_snapshot," +
          "dispatch:incident_dispatch(state,wave_index,max_waves,wave_timeout_at," +
          "eta_seconds,ambulance_state,ambulance_eta_seconds," +
          "hospital:facilities!incident_dispatch_accepted_facility_id_fkey(name,lat,lon)," +
          "unit:fleet_units(call_sign,driver_name,lat,lon,heading_deg))",
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data: rows, error: err }) => {
        if (cancelled) return;
        // A failed request must NOT read as "you have no emergency". The first version
        // set data to null on any outcome, so one dropped connection put the SOS buttons
        // back in front of someone whose ambulance was already on its way -- observed in
        // the browser, not theorised. Keep the last known state and report the failure.
        if (err) {
          setError(err.message);
        } else {
          setError(null);
          setData((rows as unknown as MyIncident[])?.[0] ?? null);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pulse]);

  return { data, loading, error };
}

export interface EmergencyProfile {
  id: string;
  name: string;
  phone: string | null;
  language: string | null;
  abha_id: string | null;
  blood_group: string | null;
  allergies: string[] | null;
  chronic_conditions: string[] | null;
  current_medications: string[] | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_profile_updated_at: string | null;
}

export function useMyProfile(pulse = 0) {
  const [data, setData] = useState<EmergencyProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void db()
      .from("patients")
      .select(
        "id,name,phone,language,abha_id,blood_group,allergies,chronic_conditions," +
          "current_medications,emergency_contact_name,emergency_contact_phone," +
          "emergency_profile_updated_at",
      )
      .limit(1)
      .then(({ data: rows }) => {
        if (cancelled) return;
        setData((rows as unknown as EmergencyProfile[])?.[0] ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pulse]);

  return { data, loading };
}

// Writes go through the table, not an rpc: patients_update already restricts to
// visible_patient_ids(), which for a patient is their own row and nobody else's.
export async function saveMyProfile(
  id: string,
  patch: Record<string, string[] | string | null>,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db()
    .from("patients")
    .update({ ...patch, emergency_profile_updated_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ---------------------------------------------------------------------------
// Facility side
// ---------------------------------------------------------------------------

// The facility's own inbox. No `.eq("facility_id", ...)` filter and none is
// needed: RLS returns only rows for facilities this account is staff of, so the
// query cannot be widened by editing the client. The incident is embedded because
// a facility deciding whether to accept needs the case, not an id.
export function useFacilityOffers(pulse = 0) {
  const [data, setData] = useState<FacilityOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void db()
      .from("dispatch_offers")
      .select(
        "*, facility:facilities!dispatch_offers_facility_id_fkey(name,district,emergency)," +
          "winner:facilities!dispatch_offers_superseded_by_fkey(name)," +
          "incident:incidents(id,ref,incident_type,description,severity,triage_colour," +
          "victim_name,victim_age,address,district,lat,lon,vitals,required_services," +
          "status,golden_hour_start,is_simulated,medical_snapshot)",
      )
      .order("offered_at", { ascending: false })
      .limit(40)
      .then(({ data: rows, error: err }) => {
        if (cancelled) return;
        setData((rows as unknown as FacilityOffer[]) ?? []);
        setError(err?.message ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pulse]);

  return { data, loading, error };
}

export type FacilityOffer = DispatchOffer & {
  incident: Pick<
    Incident,
    | "id"
    | "ref"
    | "incident_type"
    | "description"
    | "severity"
    | "triage_colour"
    | "victim_name"
    | "victim_age"
    | "address"
    | "district"
    | "lat"
    | "lon"
    | "vitals"
    | "required_services"
    | "status"
    | "golden_hour_start"
    | "is_simulated"
  > & { medical_snapshot?: Record<string, unknown> | null } | null;
};

export interface MyFacility {
  facility_id: string;
  can_accept: boolean;
  facility: { name: string } | null;
}

// Which facilities this account may answer for. Read from facility_staff, so the
// UI and accept_dispatch_offer's own guard agree instead of guessing.
export function useMyFacilities(pulse = 0) {
  const [data, setData] = useState<MyFacility[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void db()
      .from("facility_staff")
      .select("facility_id, can_accept, facility:facilities(name)")
      .then(({ data: rows }) => {
        if (cancelled) return;
        setData((rows as unknown as MyFacility[]) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pulse]);

  return { data, loading };
}

export interface FleetUnitLive {
  id: string;
  call_sign: string;
  lat: number | null;
  lon: number | null;
  heading_deg: number | null;
  available: boolean;
  driver_name: string | null;
  assigned_incident_id: string | null;
  is_simulated: boolean;
  updated_at: string;
}

// Live vehicle positions. Every one of these is a SIMULATED position — there is no
// ambulance GPS feed — but it is written to the same lat/lon columns a real operator's
// device would post to, so the map, the ETA and realtime are exercised for real.
// Anything rendering these has to say so; the map legend does.
export function useFleetUnits(pulse = 0) {
  const [data, setData] = useState<FleetUnitLive[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void db()
      .from("fleet_units")
      .select(
        "id,call_sign,lat,lon,heading_deg,available,driver_name," +
          "assigned_incident_id,is_simulated,updated_at",
      )
      .order("call_sign")
      .then(({ data: rows }) => {
        if (cancelled) return;
        setData((rows as unknown as FleetUnitLive[]) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pulse]);

  return { data, loading };
}

// than throwing, because "already_accepted" is a normal race outcome the console
// has to render, not an exception.
// ---------------------------------------------------------------------------
export type RpcResult = { ok?: boolean; error?: string } & Record<string, unknown>;

async function rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await db().rpc(name, args);
  if (error) return { ok: false, error: error.message };
  return (data as RpcResult) ?? { ok: true };
}

export const openDispatch = (incidentId: string, useSimulatedCapacity = false) =>
  rpc("open_dispatch", {
    p_incident: incidentId,
    p_use_simulated_capacity: useSimulatedCapacity,
  });

export const acceptOffer = (
  incidentId: string,
  facilityId: string,
  etaSeconds?: number | null,
) =>
  rpc("accept_dispatch_offer", {
    p_incident: incidentId,
    p_facility: facilityId,
    p_eta_seconds: etaSeconds ?? null,
  });

export const declineOffer = (incidentId: string, facilityId: string, reason: string) =>
  rpc("decline_dispatch_offer", {
    p_incident: incidentId,
    p_facility: facilityId,
    p_reason: reason,
  });

// Vehicle leg. Both refuse a caller who is neither the unit's operator, nor ops,
// nor staff of the dispatching facility — the same identity rule as the hospital
// side, because a signed-in account answering for someone else's ambulance is the
// defect EOS ships (`allow write: if request.auth != null` on their fleet units).
export const acceptFleetOffer = (assignmentId: string, etaSeconds?: number | null) =>
  rpc("accept_fleet_offer", {
    p_assignment: assignmentId,
    p_eta_seconds: etaSeconds ?? null,
  });

export const rejectFleetOffer = (assignmentId: string, reason: string) =>
  rpc("reject_fleet_offer", { p_assignment: assignmentId, p_reason: reason });

// No escalate here on purpose: escalate_dispatch is revoked from `authenticated`.
// Waves advance from the cron sweep against an absolute deadline, or when every
// member of the current wave has declined. A dispatcher button that skips a
// facility's remaining fuse would be a way to lose a bed that was about to say yes.

// Booth housekeeping. Narrow on purpose: the rpc deletes only incidents it created
// itself and never touches a row representing a person.
export interface DemoState {
  simulated_incidents: number;
  real_incidents: number;
  open_offers: number;
  units_total: number;
  units_free: number;
  reliability_rows: number;
  calls_due_now: number;
  routable_phones: number;
  hospital_logins: number;
}

export async function demoState(): Promise<DemoState | null> {
  const { data } = await db().rpc("demo_state");
  return (data as DemoState) ?? null;
}

export const resetDemoState = () => rpc("reset_demo_state", {});

export interface NewIncident {
  victim_name: string;
  victim_age: number | null;
  lat: number;
  lon: number;
  address: string;
  district: string;
  incident_type: string;
  description: string;
  triage_colour: string | null;
  required_services: string[];
  vitals: Record<string, number>;
}

// `ref`, `severity` and the first audit event are all set by triggers, so they are
// absent here by design: severity read from a form would let an intake clerk
// downgrade a red-triage case, and the classifier is the only thing that decides.
export async function createIncident(
  entry: NewIncident,
): Promise<{ incident: Incident | null; dispatch: RpcResult | null; error: string | null }> {
  const { data, error } = await db()
    .from("incidents")
    .insert({
      ...entry,
      triage_colour: entry.triage_colour || null,
      intake_source: "simulated",
      is_simulated: true,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { incident: null, dispatch: null, error: error?.message ?? "insert failed" };
  }

  const incident = data as Incident;
  const dispatch = await openDispatch(incident.id);
  return { incident, dispatch, error: null };
}
