import type {
  Patient,
  VoiceCall,
  Escalation,
  RiskAssessment,
} from "@/hooks/use-supabase";

// ---------------------------------------------------------------------------
// Call type labels — reusable across all pages
// ---------------------------------------------------------------------------
export const CALL_TYPE_LABELS: Record<string, string> = {
  screening_to_opd: "Screening → OPD",
  opd_to_ipd: "OPD → IPD",
  recovery_protocol: "Recovery",
  chronic_management: "Chronic",
  follow_up: "Follow-up",
  newborn_vaccination: "Vaccination",
  elderly_checkin: "Elderly Check-in",
};

// ---------------------------------------------------------------------------
// Recommendation interface
// ---------------------------------------------------------------------------
export interface CallRecommendation {
  /** e.g. "screening_to_opd" */
  callType: string;
  /** e.g. "Screening → OPD" */
  label: string;
  /** Human-readable reason for this recommendation */
  reason: string;
  /** 1 = highest priority */
  priority: number;
}

// ---------------------------------------------------------------------------
// Resolver — pure function, no hooks
// ---------------------------------------------------------------------------
export function resolveCallType(
  patient: Patient,
  patientCalls: VoiceCall[],
  patientEscalations: Escalation[],
  riskAssessment: RiskAssessment | null,
  isNewbornParent: boolean,
  hasDueVaccines: boolean,
): CallRecommendation {
  const journey = patient.journey_status || "screened";

  // ── 0. Elderly welfare check (camp_type-based, independent of journey) ──
  if (patient.camp_type === "elderly") {
    return {
      callType: "elderly_checkin",
      label: "Elderly Check-in",
      reason: "Weekly welfare check for elderly camp patient",
      priority: 1,
    };
  }

  // ── 1. Newborn vaccination (independent of patient journey) ──
  if (isNewbornParent && hasDueVaccines) {
    return {
      callType: "newborn_vaccination",
      label: "Vaccination",
      reason: "Baby has due/overdue vaccines",
      priority: 1,
    };
  }

  // Sort calls by date (most recent first)
  const sorted = [...patientCalls].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const lastCallType = sorted[0]?.call_type || sorted[0]?.use_case;

  // ── 2. Journey-based progression ──

  // Still at screening stage (regardless of call history)
  if (journey === "screened") {
    return {
      callType: "screening_to_opd",
      label: "Screening → OPD",
      reason: "First outreach after health camp screening",
      priority: 2,
    };
  }

  // OPD referred — needs escalation to IPD if there's an open concern
  if (journey === "opd_referred") {
    const hasOpen = patientEscalations.some(
      (e) => e.status === "open" || e.status === "Open",
    );
    if (hasOpen) {
      return {
        callType: "opd_to_ipd",
        label: "OPD → IPD",
        reason: "Open escalation — OPD to IPD follow-up needed",
        priority: 2,
      };
    }
    // No open escalation — general follow-up
    return {
      callType: "follow_up",
      label: "Follow-up",
      reason: "OPD referred — routine follow-up",
      priority: 4,
    };
  }

  // IPD admitted — needs recovery protocol
  if (journey === "ipd_admitted") {
    return {
      callType: "recovery_protocol",
      label: "Recovery",
      reason: "Post-admission recovery check needed",
      priority: 2,
    };
  }

  // Recovery phase — check for chronic risk or default to follow-up
  if (journey === "recovery") {
    const chronic = _hasChronicRisk(riskAssessment);
    if (chronic) {
      return {
        callType: "chronic_management",
        label: "Chronic",
        reason: chronic.reason,
        priority: 3,
      };
    }
    return {
      callType: "follow_up",
      label: "Follow-up",
      reason: "Recovery progressing — routine follow-up",
      priority: 4,
    };
  }

  // ── 3. Chronic disease management ──
  if (journey === "chronic_management") {
    const lastChronic = sorted.find(
      (c) => c.call_type === "chronic_management",
    );
    const daysSince = lastChronic
      ? (Date.now() - new Date(lastChronic.created_at).getTime()) /
        (1000 * 60 * 60 * 24)
      : Infinity;

    if (daysSince > 30) {
      return {
        callType: "chronic_management",
        label: "Chronic",
        reason: "Monthly chronic disease check due",
        priority: 3,
      };
    }
    return {
      callType: "follow_up",
      label: "Follow-up",
      reason: `Last chronic check ${Math.round(daysSince)}d ago — follow-up`,
      priority: 5,
    };
  }

  // ── 4. Override: any patient with HIGH chronic risk and no recent call ──
  const chronic = _hasChronicRisk(riskAssessment);
  if (chronic) {
    const lastChronic = sorted.find(
      (c) => c.call_type === "chronic_management",
    );
    const daysSince = lastChronic
      ? (Date.now() - new Date(lastChronic.created_at).getTime()) /
        (1000 * 60 * 60 * 24)
      : Infinity;

    if (daysSince > 30) {
      return {
        callType: "chronic_management",
        label: "Chronic",
        reason: chronic.reason,
        priority: 3,
      };
    }
  }

  // ── 5. Default follow-up ──
  return {
    callType: "follow_up",
    label: "Follow-up",
    reason: "Routine follow-up check",
    priority: 5,
  };
}

// ---------------------------------------------------------------------------
// Helper: detect chronic disease risk from risk assessment
// ---------------------------------------------------------------------------
function _hasChronicRisk(
  risk: RiskAssessment | null,
): { reason: string } | null {
  if (!risk) return null;
  if (risk.diabetic_risk_level === "High")
    return { reason: "Diabetic risk HIGH — monthly check due" };
  if (risk.hypertension_risk_level === "High")
    return { reason: "Hypertension risk HIGH — monthly check due" };
  if (risk.heart_risk_level === "High")
    return { reason: "Cardiac risk HIGH — monthly check due" };
  return null;
}

// ---------------------------------------------------------------------------
// Batch resolver — builds lookup maps and resolves all patients at once
// ---------------------------------------------------------------------------
export function resolveAllPatients(
  patients: Patient[],
  allCalls: VoiceCall[],
  allEscalations: Escalation[],
  allRisks: RiskAssessment[],
  parentPatientIds: Set<string>,
  dueVaxParentIds: Set<string>,
): Map<string, CallRecommendation> {
  // Build lookup maps
  const callsByPatient = new Map<string, VoiceCall[]>();
  for (const c of allCalls) {
    const arr = callsByPatient.get(c.patient_id) || [];
    arr.push(c);
    callsByPatient.set(c.patient_id, arr);
  }

  const escByPatient = new Map<string, Escalation[]>();
  for (const e of allEscalations) {
    const arr = escByPatient.get(e.patient_id) || [];
    arr.push(e);
    escByPatient.set(e.patient_id, arr);
  }

  // Latest risk assessment per patient
  const riskByPatient = new Map<string, RiskAssessment>();
  for (const r of allRisks) {
    const existing = riskByPatient.get(r.patient_id);
    if (!existing || r.assessed_at > existing.assessed_at) {
      riskByPatient.set(r.patient_id, r);
    }
  }

  // Resolve each patient
  const result = new Map<string, CallRecommendation>();
  for (const patient of patients) {
    result.set(
      patient.id,
      resolveCallType(
        patient,
        callsByPatient.get(patient.id) || [],
        escByPatient.get(patient.id) || [],
        riskByPatient.get(patient.id) || null,
        parentPatientIds.has(patient.id),
        dueVaxParentIds.has(patient.id),
      ),
    );
  }

  return result;
}
