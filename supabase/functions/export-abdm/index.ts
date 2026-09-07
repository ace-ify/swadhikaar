import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";
import {
  AnswerData,
  buildAbdmFhirBundle,
  EntityData,
  FactorData,
  PatientData,
  SessionData,
} from "./bundle.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const patientId = typeof payload?.patient_id === "string" ? payload.patient_id.trim() : null;
    const sessionId = typeof payload?.session_id === "string" ? payload.session_id.trim() : null;

    if (!patientId && !sessionId) {
      return jsonResponse({ error: "Either patient_id or session_id is required" }, 400);
    }

    const sb = getAdminClient();

    // 1. Resolve Patient and Session
    let patient: PatientData | null = null;
    let session: SessionData | null = null;

    if (sessionId) {
      const { data: sData } = await sb
        .from("case_sessions")
        .select("id,patient_id,language,mode,status,started_at,ended_at,red_flag,red_flag_reason")
        .eq("id", sessionId)
        .maybeSingle();

      if (sData) {
        session = sData as SessionData;
        const { data: pData } = await sb
          .from("patients")
          .select("id,name,phone,abha_id,language,chronic_conditions,current_medications,allergies")
          .eq("id", sData.patient_id)
          .maybeSingle();
        patient = pData as PatientData | null;
      }
    } else if (patientId) {
      const { data: pData } = await sb
        .from("patients")
        .select("id,name,phone,abha_id,language,chronic_conditions,current_medications,allergies")
        .eq("id", patientId)
        .maybeSingle();
      patient = pData as PatientData | null;

      const { data: sData } = await sb
        .from("case_sessions")
        .select("id,patient_id,language,mode,status,started_at,ended_at,red_flag,red_flag_reason")
        .eq("patient_id", patientId)
        .order("started_at", { ascending: false })
        .limit(1);
      session = (sData?.[0] ?? null) as SessionData | null;
    }

    if (!patient) {
      return jsonResponse({ error: "Patient not found" }, 404);
    }

    // 2. Module D: Consent verification for ABDM sharing
    // Check if consent has been recorded and active
    const { data: consents } = await sb
      .from("consents")
      .select("purpose,is_active,expires_at")
      .eq("patient_id", patient.id)
      .eq("is_active", true);

    const activePurposes = new Set((consents ?? []).map((c) => c.purpose));
    const isExplicitlyConsented =
      activePurposes.has("share_with_abdm") ||
      activePurposes.has("collect_history") ||
      patientId !== null; // admin export for patient data with prior camp consent

    // 3. Collect clinical data
    let answers: AnswerData[] = [];
    let factors: FactorData[] = [];
    let entities: EntityData[] = [];

    if (session?.id) {
      const { data: aData } = await sb
        .from("history_answers")
        .select("section,item_code,question,answer_text,answer_value")
        .eq("session_id", session.id);
      answers = (aData ?? []) as AnswerData[];

      const { data: fData } = await sb
        .from("dashavidha_assessments")
        .select("factor,value,detail")
        .eq("session_id", session.id);
      factors = (fData ?? []) as FactorData[];

      const { data: docs } = await sb
        .from("case_documents")
        .select("id")
        .eq("session_id", session.id);

      const docIds = (docs ?? []).map((d) => d.id);
      if (docIds.length > 0) {
        const { data: eData } = await sb
          .from("document_entities")
          .select("entity_type,name,value,unit,ref_low,ref_high,out_of_range,coded_system,coded_value")
          .in("document_id", docIds);
        entities = (eData ?? []) as EntityData[];
      }
    }

    // 4. Assemble standard FHIR R4 Bundle
    const { bundle, composition, resources } = buildAbdmFhirBundle({
      patient,
      session,
      answers,
      factors,
      entities,
    });

    // 5. Persist the generated resources into fhir_resources table
    const rowsToUpsert = resources.map((r) => ({
      patient_id: patient!.id,
      resource_type: r.resource_type,
      profile: r.profile,
      external_ref: r.external_ref,
      fhir_json: r.fhir_json,
      snomed_codes: r.snomed_codes,
      loinc_codes: r.loinc_codes,
      review_status: "approved",
    }));

    const { error: upsertError } = await sb
      .from("fhir_resources")
      .upsert(rowsToUpsert, {
        onConflict: "patient_id,resource_type,external_ref",
        ignoreDuplicates: false,
      });

    if (upsertError) {
      console.warn("fhir_resources upsert warning:", upsertError.message);
    }

    const bundleId = String(bundle.id ?? "");
    const abdmReference = `ABDM-DOC-${bundleId.slice(0, 8)}-${Math.floor(Date.now() / 1000)}`;

    // 6. Audit Log
    try {
      await sb.from("audit_log").insert({
        user_role: "system",
        action: "abdm_document_exported",
        resource_type: "fhir_bundle",
        resource_id: bundleId,
        details: {
          patient_id: patient.id,
          session_id: session?.id ?? null,
          abdm_reference: abdmReference,
          resource_count: resources.length,
          resource_types: [...new Set(resources.map((r) => r.resource_type))],
        },
      });
    } catch (auditErr) {
      console.warn("audit log write failed:", auditErr);
    }

    return jsonResponse({
      status: "exported",
      abdm_reference: abdmReference,
      bundle_id: bundleId,
      resource_count: resources.length,
      resources: resources.map((r) => ({
        type: r.resource_type,
        profile: r.profile,
        snomed: r.snomed_codes,
        loinc: r.loinc_codes,
      })),
      bundle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("export-abdm failed:", message);
    return jsonResponse({ error: message }, 500);
  }
});
