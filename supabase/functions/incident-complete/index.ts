// Acute → Continuity seam.
//
// The acute response layer calls this when an emergency incident reaches
// "care complete". One request turns a finished emergency into a longitudinal
// patient who is already enrolled in the Post-Discharge Recovery protocol:
//
//   incident  →  patient (upsert by ABHA, phone fallback)
//             →  FHIR Encounter (+ Condition when coded)
//             →  scheduled recovery calls on Day 1, 3, 7, 14, 30
//
// Idempotent: re-delivering the same incident re-resolves the same patient and
// cannot duplicate the call set (uq_voice_calls_protocol_slot).
//
// Pure logic and its tests live in ../_shared/acute-seam.ts.

import { corsHeaders } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";
import {
  FALLBACK_SCHEDULE_DAYS,
  type IncidentPayload,
  RECOVERY_WORKFLOW,
  recoverySchedule,
  validateIncident,
} from "../_shared/acute-seam.ts";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Deployed --no-verify-jwt like the other functions, so this shared secret is
  // the only thing standing between the open internet and the patient table.
  const expected = Deno.env.get("ACUTE_INGRESS_SECRET");
  if (!expected) {
    return jsonResponse({ error: "ACUTE_INGRESS_SECRET is not configured" }, 500);
  }
  if (req.headers.get("x-acute-secret") !== expected) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: IncidentPayload;
  try {
    body = (await req.json()) as IncidentPayload;
  } catch {
    return jsonResponse({ error: "Body must be JSON" }, 400);
  }

  const { errors, clean } = validateIncident(body);
  if (!clean) {
    return jsonResponse({ error: "Validation failed", details: errors }, 400);
  }

  const db = getAdminClient();

  try {
    // ---- 1. Resolve the patient. ABHA is the real key; phone is the fallback,
    // because most emergency victims carry no ABHA ID to the scene.
    const conflictKey = clean.abhaId ? "abha_id" : "phone";
    const { data: patient, error: patientError } = await db
      .from("patients")
      .upsert(
        {
          abha_id: clean.abhaId ?? null,
          name: clean.name,
          phone: clean.phone ?? null,
          language: clean.language,
          intake_source: "acute_incident",
          source_incident_id: clean.incidentId,
          journey_status: "recovery",
          risk_level: clean.severity === "CRITICAL" ? "High" : "Moderate",
          updated_at: new Date().toISOString(),
        },
        { onConflict: conflictKey },
      )
      .select()
      .single();

    if (patientError) throw new Error(`patient upsert: ${patientError.message}`);

    // ---- 2. The Encounter. This is the artefact the acute layer used to
    // generate and then throw away.
    const diagnosisCodes = clean.diagnosis
      .map((d) => d.code)
      .filter((c): c is string => Boolean(c));

    const resourceRows: Record<string, unknown>[] = [{
      patient_id: patient.id,
      resource_type: "Encounter",
      external_ref: clean.incidentId,
      profile: "acute_emergency_encounter",
      fhir_json: {
        resourceType: "Encounter",
        status: "finished",
        class: {
          system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
          code: "EMER",
          display: "emergency",
        },
        identifier: [
          { system: "https://swadhikaar.in/incident", value: clean.incidentId },
        ],
        subject: { reference: `Patient/${patient.id}` },
        period: {
          start: clean.admittedAt ?? clean.completedAt,
          end: clean.completedAt,
        },
        reasonCode: [{ text: clean.incidentType }],
        ...(clean.hospitalName
          ? { serviceProvider: { display: clean.hospitalName } }
          : {}),
        ...(clean.outcomeSummary
          ? {
            extension: [{
              url: "https://swadhikaar.in/outcome",
              valueString: clean.outcomeSummary,
            }],
          }
          : {}),
      },
      snomed_codes: diagnosisCodes,
      review_status: "pending",
    }];

    if (clean.diagnosis.length > 0) {
      resourceRows.push({
        patient_id: patient.id,
        resource_type: "Condition",
        external_ref: clean.incidentId,
        profile: "acute_emergency_encounter",
        fhir_json: {
          resourceType: "Condition",
          clinicalStatus: { coding: [{ code: "active" }] },
          subject: { reference: `Patient/${patient.id}` },
          code: {
            coding: clean.diagnosis.map((d) => ({
              system: d.system ?? "http://snomed.info/sct",
              code: d.code,
              display: d.display,
            })),
          },
          recordedDate: clean.completedAt,
        },
        snomed_codes: diagnosisCodes,
        review_status: "pending",
      });
    }

    // Upsert, not insert: one emergency yields one Encounter no matter how many
    // times the acute layer re-delivers it. ignoreDuplicates so a replay cannot
    // reset a review_status a clinician has already moved off "pending".
    const { data: fhirRows, error: fhirError } = await db
      .from("fhir_resources")
      .upsert(resourceRows, {
        onConflict: "patient_id,resource_type,external_ref",
        ignoreDuplicates: true,
      })
      .select("id, resource_type");

    if (fhirError) throw new Error(`fhir insert: ${fhirError.message}`);

    // ---- 3. Enrol in the recovery protocol. The scheduled calls *are* the
    // enrolment record — no separate join table needed.
    const { data: workflow, error: workflowError } = await db
      .from("workflows")
      .select("id, trigger_config, is_active")
      .eq("name", RECOVERY_WORKFLOW)
      .maybeSingle();

    if (workflowError) throw new Error(`workflow lookup: ${workflowError.message}`);

    let scheduledCalls: unknown[] = [];
    let enrolment = `workflow "${RECOVERY_WORKFLOW}" not found — no calls scheduled`;

    if (workflow?.is_active) {
      const configured = workflow.trigger_config?.schedule_days;
      const days: number[] = Array.isArray(configured) && configured.length > 0
        ? configured
        : FALLBACK_SCHEDULE_DAYS;

      const slots = recoverySchedule(clean.completedAt, days);

      const { data: calls, error: callError } = await db
        .from("voice_calls")
        .upsert(
          slots.map((when, i) => ({
            patient_id: patient.id,
            workflow_id: workflow.id,
            call_type: "recovery",
            use_case: "recovery_protocol",
            status: "scheduled",
            language: clean.language,
            scheduled_for: when,
            extracted_data: {
              protocol_day: days[i],
              source_incident_id: clean.incidentId,
            },
          })),
          {
            onConflict: "patient_id,workflow_id,scheduled_for",
            ignoreDuplicates: true,
          },
        )
        .select("id, scheduled_for, extracted_data");

      if (callError) throw new Error(`call scheduling: ${callError.message}`);
      scheduledCalls = calls ?? [];
      enrolment = `enrolled in "${RECOVERY_WORKFLOW}" on days ${days.join(", ")}`;
    } else if (workflow) {
      enrolment = `workflow "${RECOVERY_WORKFLOW}" is inactive — no calls scheduled`;
    }

    // ---- 4. Audit. Non-fatal: a failed audit write must not lose the patient.
    const { error: auditError } = await db.from("audit_log").insert({
      user_role: "acute_layer",
      action: "acute_incident_completed",
      resource_type: "patient",
      resource_id: patient.id,
      details: {
        incident_id: clean.incidentId,
        incident_type: clean.incidentType,
        severity: clean.severity,
        hospital: clean.hospitalName,
        resolved_by: conflictKey,
        fhir_resources: fhirRows?.map((r) => r.resource_type),
        calls_scheduled: scheduledCalls.length,
      },
    });
    if (auditError) console.error(`audit_log insert failed: ${auditError.message}`);

    return jsonResponse({
      ok: true,
      incident_id: clean.incidentId,
      patient: {
        id: patient.id,
        name: patient.name,
        abha_id: patient.abha_id,
        journey_status: patient.journey_status,
        intake_source: patient.intake_source,
        resolved_by: conflictKey,
      },
      fhir_resources: fhirRows,
      enrolment,
      scheduled_calls: scheduledCalls,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`incident-complete failed: ${message}`);
    return jsonResponse({ error: message }, 500);
  }
});
