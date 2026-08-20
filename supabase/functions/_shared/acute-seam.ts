// Pure logic for the acute → continuity seam.
// No Deno or Supabase APIs here on purpose: this file runs under both Deno
// (in the edge function) and plain Node (in acute-seam.test.ts).

export const RECOVERY_WORKFLOW = "Post-Discharge Recovery";
export const FALLBACK_SCHEDULE_DAYS = [1, 3, 7, 14, 30];

// ponytail: one call window for everyone (10:00 IST = 04:30 UTC).
// Move to a per-patient preferred_call_hour column when patients start declining calls.
export const CALL_HOUR_UTC = 4;
export const CALL_MINUTE_UTC = 30;

export type IncidentPayload = {
  incident_id?: string;
  abha_id?: string;
  name?: string;
  phone?: string;
  language?: string;
  incident_type?: string;
  severity?: string;
  hospital_name?: string;
  outcome_summary?: string;
  diagnosis?: { code?: string; system?: string; display?: string }[];
  admitted_at?: string;
  completed_at?: string;
};

export type CleanIncident = {
  incidentId: string;
  name: string;
  abhaId?: string;
  phone?: string;
  language: string;
  incidentType: string;
  severity: string;
  hospitalName?: string;
  outcomeSummary?: string;
  admittedAt?: string;
  completedAt: string;
  diagnosis: { code?: string; system?: string; display?: string }[];
};

/** Day offsets → concrete UTC timestamps at the standard call window. */
export function recoverySchedule(completedAt: string, days: number[]): string[] {
  const base = new Date(completedAt);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`completed_at is not a valid timestamp: ${completedAt}`);
  }
  return days.map((d) => {
    const t = new Date(base);
    t.setUTCDate(t.getUTCDate() + d);
    t.setUTCHours(CALL_HOUR_UTC, CALL_MINUTE_UTC, 0, 0);
    return t.toISOString();
  });
}

/** Trust boundary: this ingress is reachable by an external system. */
export function validateIncident(
  body: IncidentPayload,
): { errors: string[]; clean?: CleanIncident } {
  const errors: string[] = [];
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length > 0 && v.trim().length <= max
      ? v.trim()
      : undefined;

  const incidentId = str(body.incident_id, 128);
  const name = str(body.name, 200);
  const abhaId = str(body.abha_id, 64);
  const phone = str(body.phone, 20);

  if (!incidentId) errors.push("incident_id is required (1-128 chars)");
  if (!name) errors.push("name is required (1-200 chars)");
  if (!abhaId && !phone) {
    errors.push("one of abha_id or phone is required to resolve a patient");
  }

  const completedAt = str(body.completed_at, 40) ?? new Date().toISOString();
  if (Number.isNaN(new Date(completedAt).getTime())) {
    errors.push("completed_at must be an ISO-8601 timestamp");
  }

  const diagnosis = (Array.isArray(body.diagnosis) ? body.diagnosis : [])
    .slice(0, 20)
    .filter((d) => str(d?.code, 64) ?? str(d?.display, 200));

  if (errors.length > 0) return { errors };

  return {
    errors: [],
    clean: {
      incidentId: incidentId!,
      name: name!,
      abhaId,
      phone,
      language: str(body.language, 32) ?? "hindi",
      incidentType: str(body.incident_type, 120) ?? "emergency",
      severity: (str(body.severity, 20) ?? "HIGH").toUpperCase(),
      hospitalName: str(body.hospital_name, 200),
      outcomeSummary: str(body.outcome_summary, 4000),
      admittedAt: str(body.admitted_at, 40),
      completedAt,
      diagnosis,
    },
  };
}
