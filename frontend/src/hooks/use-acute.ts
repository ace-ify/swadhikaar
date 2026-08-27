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

export interface IncidentEvent {
  id: string;
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
        .order("at", { ascending: true }),
    ]).then(([d, o, e]) => {
      if (cancelled) return;
      setDispatch((d.data as IncidentDispatch | null) ?? null);
      setOffers((o.data as unknown as DispatchOffer[]) ?? []);
      setEvents((e.data as IncidentEvent[]) ?? []);
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
    loading: incidentId !== null && !fresh,
  };
}

// ---------------------------------------------------------------------------
// Mutations — all security-definer rpc, all returning {ok:false, error} rather
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

// No escalate here on purpose: escalate_dispatch is revoked from `authenticated`.
// Waves advance from the cron sweep against an absolute deadline, or when every
// member of the current wave has declined. A dispatcher button that skips a
// facility's remaining fuse would be a way to lose a bed that was about to say yes.

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
