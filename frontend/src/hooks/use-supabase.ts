"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase";

function getSupabase() {
  return createClient();
}

// ---------------------------------------------------------------------------
// Generic query hook
// ---------------------------------------------------------------------------
interface QueryResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function useSupabaseQuery<T>(
  table: string,
  options?: {
    select?: string;
    filters?: Record<string, unknown>;
    order?: { column: string; ascending?: boolean };
    limit?: number;
    eq?: [string, unknown][];
  }
): QueryResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const optionsKey = JSON.stringify(options);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    const currentOptions = optionsRef.current;
    const select = currentOptions?.select || "*";
    const eq = currentOptions?.eq;
    const order = currentOptions?.order;
    const limit = currentOptions?.limit;

    try {
      let query = getSupabase().from(table).select(select);

      if (eq) {
        for (const [col, val] of eq) {
          query = query.eq(col, val);
        }
      }

      if (order) {
        query = query.order(order.column, {
          ascending: order.ascending ?? false,
        });
      }

      if (limit) {
        query = query.limit(limit);
      }

      const { data: rows, error: err } = await query;
      if (err) throw err;
      setData((rows as T[]) || []);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      setError(msg);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [table]);

  useEffect(() => {
    fetch();
  }, [fetch, optionsKey]);

  return { data, loading, error, refetch: fetch };
}

// ---------------------------------------------------------------------------
// Types matching Supabase schema
// ---------------------------------------------------------------------------
export interface Patient {
  id: string;
  abha_id: string;
  name: string;
  phone: string;
  language: string;
  health_camp: string;
  camp_type: string;
  risk_level: string;
  overall_risk_score: number;
  consent_status: string;
  assigned_doctor_id: string | null;
  journey_status: string;
  district: string | null;
  village: string | null;
  // 'health_camp' = from the provided dataset. 'simulated_cohort' = generated for
  // demo coverage (the Assam flood cohort). Any surface showing these must badge
  // them; that is the whole reason the column is read into the client.
  intake_source: string | null;
  // Locality centroid plus a deterministic per-patient offset — NOT a household
  // location, which we never had and would not want to hold for 242 people with
  // clinical risk attached. Anything rendering these must say "approximate".
  lat: number | null;
  lon: number | null;
  coord_source: string | null;
  created_at: string;
}

export interface Facility {
  id: string;
  name: string;
  amenity: string | null;
  healthcare: string | null;
  district: string | null;
  lat: number;
  lon: number;
  emergency: boolean | null;
  beds_total: number | null;
  beds_available: number | null;
  doctors_on_duty: number | null;
  // Per-field provenance: the name and coordinates are real OpenStreetMap data,
  // the bed and staffing counts are generated. No public source publishes live
  // Indian bed counts, so a single row is part sourced and part simulated.
  coord_source: string;
  capacity_source: string;
  dispatch_eligible: boolean;
}

export interface HealthVitals {
  id: string;
  patient_id: string;
  systolic_bp: number;
  diastolic_bp: number;
  heart_rate: number;
  respiratory_rate: number;
  oxygen_saturation: number;
  temperature: number;
  blood_glucose: number;
  height: number;
  weight: number;
  bmi: number | null;
  bmi_category: string;
  waist_circumference: number;
  perfusion_index: number;
  recorded_at: string;
}

export interface VoiceCall {
  id: string;
  patient_id: string;
  call_type: string;
  use_case: string;
  status: string;
  language: string;
  transcript: string;
  extracted_data: Record<string, unknown>;
  severity: string;
  duration_seconds: number;
  started_at: string;
  ended_at: string;
  created_at: string;
}

export interface Escalation {
  id: string;
  patient_id: string;
  call_id: string | null;
  severity_level: string;
  severity: string;
  reason: string;
  status: string;
  assigned_to: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

export interface FHIRResource {
  id: string;
  patient_id: string;
  call_id: string | null;
  resource_type: string;
  profile: string;
  fhir_json: Record<string, unknown>;
  snomed_codes: string[];
  loinc_codes: string[];
  review_status: string;
  reviewed_by: string | null;
  created_at: string;
}

export interface Consent {
  id: string;
  patient_id: string;
  purpose: string;
  scope: string;
  consent_mode: string;
  granted_at: string;
  revoked_at: string | null;
  is_active: boolean;
}

export interface RiskAssessment {
  id: string;
  patient_id: string;
  heart_risk_score: number;
  heart_risk_level: string;
  diabetic_risk_score: number;
  diabetic_risk_level: string;
  hypertension_risk_score: number;
  hypertension_risk_level: string;
  overall_risk_category: string;
  overall_risk_score: number;
  assessed_at: string;
}

export interface Doctor {
  id: string;
  name: string;
  email: string;
  specialization: string;
  phone: string;
  created_at: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  actions: Record<string, unknown>[];
  conditions: Record<string, unknown>;
  camp_type: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Newborn {
  id: string;
  parent_patient_id: string;
  baby_name: string;
  date_of_birth: string;
  gender: string;
  birth_weight_kg: number;
  birth_hospital: string;
  phone: string;
  language: string;
  created_at: string;
}

export interface VaccinationSchedule {
  id: string;
  newborn_id: string;
  vaccine_name: string;
  dose_number: number;
  due_age: string;
  due_date: string;
  route_site: string;
  remarks: string;
  status: string;
  administered_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Domain hooks
// ---------------------------------------------------------------------------

export function usePatients(filters?: { risk_level?: string; camp_type?: string }) {
  const eq: [string, unknown][] = [];
  if (filters?.risk_level) eq.push(["risk_level", filters.risk_level]);
  if (filters?.camp_type) eq.push(["camp_type", filters.camp_type]);

  return useSupabaseQuery<Patient>("patients", {
    order: { column: "created_at", ascending: false },
    eq: eq.length > 0 ? eq : undefined,
  });
}

// Only the columns the map needs. 537 rows, so selecting * would ship bed counts,
// websites and postcodes into the browser for markers that show none of it.
export function useFacilities(dispatchEligibleOnly = false) {
  return useSupabaseQuery<Facility>("facilities", {
    select:
      "id,name,amenity,healthcare,district,lat,lon,emergency,beds_total," +
      "beds_available,doctors_on_duty,coord_source,capacity_source,dispatch_eligible",
    order: { column: "beds_total", ascending: false },
    eq: dispatchEligibleOnly ? [["dispatch_eligible", true]] : undefined,
  });
}

export function useVitals(patientId?: string) {
  const eq: [string, unknown][] | undefined = patientId
    ? [["patient_id", patientId]]
    : undefined;

  return useSupabaseQuery<HealthVitals>("health_vitals", {
    order: { column: "recorded_at", ascending: false },
    eq,
  });
}

export function useRiskAssessments(patientId?: string) {
  const eq: [string, unknown][] | undefined = patientId
    ? [["patient_id", patientId]]
    : undefined;

  return useSupabaseQuery<RiskAssessment>("risk_assessments", {
    order: { column: "assessed_at", ascending: false },
    eq,
  });
}

export function useCallLogs(patientId?: string) {
  const eq: [string, unknown][] | undefined = patientId
    ? [["patient_id", patientId]]
    : undefined;

  return useSupabaseQuery<VoiceCall>("voice_calls", {
    order: { column: "created_at", ascending: false },
    eq,
  });
}

export function useEscalations(filters?: { status?: string; severity?: string }) {
  const eq: [string, unknown][] = [];
  if (filters?.status) eq.push(["status", filters.status]);
  if (filters?.severity) eq.push(["severity", filters.severity]);

  return useSupabaseQuery<Escalation>("escalations", {
    order: { column: "created_at", ascending: false },
    eq: eq.length > 0 ? eq : undefined,
  });
}

export function useFHIRResources(patientId?: string, reviewStatus?: string) {
  const eq: [string, unknown][] = [];
  if (patientId) eq.push(["patient_id", patientId]);
  if (reviewStatus) eq.push(["review_status", reviewStatus]);

  return useSupabaseQuery<FHIRResource>("fhir_resources", {
    order: { column: "created_at", ascending: false },
    eq: eq.length > 0 ? eq : undefined,
  });
}

export function useConsents(patientId?: string) {
  const eq: [string, unknown][] | undefined = patientId
    ? [["patient_id", patientId]]
    : undefined;

  return useSupabaseQuery<Consent>("consents", {
    order: { column: "granted_at", ascending: false },
    eq,
  });
}

export function useWorkflows() {
  return useSupabaseQuery<Workflow>("workflows", {
    order: { column: "created_at", ascending: false },
  });
}

export function useDoctors() {
  return useSupabaseQuery<Doctor>("doctors", {
    order: { column: "name", ascending: true },
  });
}

export function useNewborns() {
  return useSupabaseQuery<Newborn>("newborns", {
    order: { column: "date_of_birth", ascending: false },
  });
}

export function useVaccinationSchedules(newbornId?: string) {
  const eq: [string, unknown][] | undefined = newbornId
    ? [["newborn_id", newbornId]]
    : undefined;

  return useSupabaseQuery<VaccinationSchedule>("vaccination_schedules", {
    order: { column: "due_date", ascending: true },
    eq,
  });
}

export function usePatientNames() {
  return useSupabaseQuery<Pick<Patient, "id" | "name">>("patients", {
    select: "id,name",
  });
}

// ---------------------------------------------------------------------------
// Conversion funnel — computed from real journey_status + call data
// ---------------------------------------------------------------------------
export function useConversionFunnel() {
  const { data: patients, loading: pLoading } = usePatients();
  const { data: calls, loading: cLoading } = useCallLogs();
  const { data: vacSchedules, loading: vLoading } = useVaccinationSchedules();

  const loading = pLoading || cLoading || vLoading;

  const funnel = (() => {
    if (loading) return [];
    const total = patients.length || 1;

    // Journey status counts
    const statusCounts: Record<string, number> = {};
    for (const p of patients) {
      const s = p.journey_status || "screened";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }

    // Call type counts
    const callCounts: Record<string, number> = {};
    for (const c of calls) {
      const t = c.call_type || c.use_case || "follow_up";
      callCounts[t] = (callCounts[t] || 0) + 1;
    }

    // Screening → OPD: patients who progressed beyond "screened"
    const screened = total;
    const opdReferred = total - (statusCounts["screened"] || 0);
    const opdRate = Math.round((opdReferred / screened) * 1000) / 10;

    // OPD → IPD: patients who reached ipd_admitted or recovery
    const ipdAdmitted = (statusCounts["ipd_admitted"] || 0) + (statusCounts["recovery"] || 0);
    const ipdRate = opdReferred > 0 ? Math.round((ipdAdmitted / opdReferred) * 1000) / 10 : 0;

    // Recovery compliance: recovery patients (from ipd)
    const recoveryCount = statusCounts["recovery"] || 0;
    const recoveryRate = ipdAdmitted > 0 ? Math.round((recoveryCount / ipdAdmitted) * 1000) / 10 : 0;

    // Follow-up response: follow_up calls completed / total follow_up_active patients
    const followUpPatients = statusCounts["follow_up_active"] || 0;
    const followUpCalls = calls.filter(c => (c.call_type === "follow_up" || c.use_case === "follow_up") && c.status === "completed").length;
    const followUpRate = followUpPatients > 0 ? Math.min(100, Math.round((followUpCalls / followUpPatients) * 1000) / 10) : 0;

    // Chronic adherence
    const chronicPatients = statusCounts["chronic_management"] || 0;
    const chronicCalls = calls.filter(c => c.call_type === "chronic_management" && c.status === "completed").length;
    const chronicRate = chronicPatients > 0 ? Math.min(100, Math.round((chronicCalls / chronicPatients) * 1000) / 10) : 0;

    // Vaccination coverage
    const totalVax = vacSchedules.length || 1;
    const completedVax = vacSchedules.filter(v => v.status === "completed").length;
    const vaxRate = Math.round((completedVax / totalVax) * 1000) / 10;

    return [
      { label: "Screening to OPD", from: screened, converted: opdReferred, rate: opdRate, color: "bg-slate-900" },
      { label: "OPD to IPD", from: opdReferred, converted: ipdAdmitted, rate: ipdRate, color: "bg-slate-800" },
      { label: "Recovery Compliance", from: ipdAdmitted, converted: recoveryCount, rate: recoveryRate || 0, color: "bg-slate-700" },
      { label: "Follow-up Response", from: followUpPatients, converted: followUpCalls, rate: followUpRate, color: "bg-slate-600" },
      { label: "Chronic Adherence", from: chronicPatients, converted: chronicCalls, rate: chronicRate, color: "bg-slate-500" },
      { label: "Vaccination Coverage", from: totalVax, converted: completedVax, rate: vaxRate, color: "bg-slate-400" },
    ];
  })();

  return { data: funnel, loading };
}

// ---------------------------------------------------------------------------
// Realtime subscription hook for escalations
// ---------------------------------------------------------------------------
export function useRealtimeEscalations(onNew?: (escalation: Escalation) => void) {
  const [liveEscalations, setLiveEscalations] = useState<Escalation[]>([]);

  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel("escalations-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "escalations",
        },
        (payload) => {
          const newEsc = payload.new as Escalation;
          setLiveEscalations((prev) => [newEsc, ...prev]);
          onNew?.(newEsc);
        }
      )
      .subscribe();

    return () => {
      getSupabase().removeChannel(channel);
    };
  }, [onNew]);

  return liveEscalations;
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------
export async function updateEscalationStatus(
  escalationId: string,
  status: string,
  notes?: string
) {
  const { error } = await getSupabase()
    .from("escalations")
    .update({
      status,
      resolution_notes: notes || null,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    })
    .eq("id", escalationId);
  return { error: error?.message || null };
}

export async function createEscalation(entry: {
  patient_id: string;
  call_id?: string | null;
  severity_level: string;
  severity: string;
  reason: string;
  status?: string;
  assigned_to?: string | null;
}) {
  const { data, error } = await getSupabase()
    .from("escalations")
    .insert({
      patient_id: entry.patient_id,
      call_id: entry.call_id ?? null,
      severity_level: entry.severity_level,
      severity: entry.severity,
      reason: entry.reason,
      status: entry.status ?? "open",
      assigned_to: entry.assigned_to ?? null,
    })
    .select("*")
    .single();

  return { data: data as Escalation | null, error: error?.message || null };
}

export async function updateFHIRReviewStatus(
  resourceId: string,
  status: string,
  reviewedBy: string
) {
  const { error } = await getSupabase()
    .from("fhir_resources")
    .update({
      review_status: status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", resourceId);
  return { error: error?.message || null };
}

export async function revokeConsent(consentId: string) {
  const { error } = await getSupabase()
    .from("consents")
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
    })
    .eq("id", consentId);
  return { error: error?.message || null };
}

export async function createWorkflow(entry: {
  name: string;
  description: string;
  trigger_type: string;
  trigger_config?: Record<string, unknown>;
  actions?: Record<string, unknown>[];
  conditions?: Record<string, unknown>;
  camp_type?: string | null;
  is_active?: boolean;
}) {
  const payload = {
    name: entry.name,
    description: entry.description,
    trigger_type: entry.trigger_type,
    trigger_config: entry.trigger_config ?? {},
    actions: entry.actions ?? [],
    conditions: entry.conditions ?? {},
    camp_type: entry.camp_type ?? null,
    is_active: entry.is_active ?? true,
  };

  const { data, error } = await getSupabase()
    .from("workflows")
    .insert(payload)
    .select("*")
    .single();

  return { data: data as Workflow | null, error: error?.message || null };
}

export async function updateWorkflowActive(workflowId: string, isActive: boolean) {
  const { error } = await getSupabase()
    .from("workflows")
    .update({ is_active: isActive })
    .eq("id", workflowId);
  return { error: error?.message || null };
}

export async function updateVaccinationStatus(
  scheduleId: string,
  status: string
) {
  const update: Record<string, unknown> = { status };
  if (status === "completed") {
    update.administered_at = new Date().toISOString();
  }
  const { error } = await getSupabase()
    .from("vaccination_schedules")
    .update(update)
    .eq("id", scheduleId);
  return { error: error?.message || null };
}

export async function createAuditLog(entry: {
  user_role: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
}) {
  const uuidV4Like =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const payload = {
    ...entry,
    resource_id:
      entry.resource_id && uuidV4Like.test(entry.resource_id)
        ? entry.resource_id
        : undefined,
  };

  const { error } = await getSupabase().from("audit_log").insert(payload);
  return { error: error?.message || null };
}
