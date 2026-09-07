import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";
import { buildCaseSummary, SummaryInput } from "./summary_builder.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const sessionId = typeof payload?.session_id === "string" ? payload.session_id.trim() : null;

    if (!sessionId) {
      return jsonResponse({ error: "session_id is required" }, 400);
    }

    const sb = getAdminClient();

    // Review branch: allows doctor to Accept / Amend / Reject draft summary
    if (payload?.action === "review") {
      const reviewAction = payload.review_action;
      if (!["accepted", "amended", "rejected"].includes(reviewAction)) {
        return jsonResponse(
          { error: "review_action must be 'accepted', 'amended', or 'rejected'" },
          400
        );
      }

      if (reviewAction === "amended" && !payload.amended_sections) {
        return jsonResponse(
          { error: "amended_sections is required when status is 'amended'" },
          400
        );
      }

      // Ensure doctor ID is resolved to satisfy foreign key & clinical attribution constraint
      let doctorId = payload.doctor_id;
      if (!doctorId) {
        const { data: existingDoc } = await sb.from("doctors").select("id").limit(1).maybeSingle();
        if (existingDoc?.id) {
          doctorId = existingDoc.id;
        } else {
          const { data: newDoc } = await sb
            .from("doctors")
            .insert({
              name: payload.doctor_name || "OPD Duty Clinician",
              specialization: "General Medicine / Ayush",
            })
            .select("id")
            .single();
          doctorId = newDoc?.id;
        }
      }

      const updatePayload: Record<string, unknown> = {
        status: reviewAction,
        reviewed_by: doctorId,
        reviewed_at: new Date().toISOString(),
        review_notes: payload.notes || null,
      };

      if (reviewAction === "amended") {
        updatePayload.amended_sections = payload.amended_sections;
      }

      const { data: updatedSummary, error: updateErr } = await sb
        .from("case_summaries")
        .update(updatePayload)
        .eq("session_id", sessionId)
        .select("*")
        .maybeSingle();

      if (updateErr) {
        return jsonResponse({ error: updateErr.message }, 500);
      }

      // Mark session consulted
      await sb
        .from("case_sessions")
        .update({
          status: "consulted",
          ended_at: new Date().toISOString(),
        })
        .eq("id", sessionId);

      // Write clinical governance audit log
      try {
        await sb.from("audit_log").insert({
          user_role: "doctor",
          action: `case_summary_${reviewAction}`,
          resource_type: "case_summary",
          resource_id: updatedSummary?.id || sessionId,
          details: {
            session_id: sessionId,
            doctor_id: doctorId,
            review_action: reviewAction,
            has_amendment: reviewAction === "amended",
            notes: payload.notes || null,
          },
        });
      } catch (aErr) {
        console.warn("audit_log insert warning:", aErr);
      }

      return jsonResponse({
        success: true,
        session_id: sessionId,
        status: reviewAction,
        summary: updatedSummary,
      });
    }

    // 1. Fetch Session
    const { data: session, error: sErr } = await sb
      .from("case_sessions")
      .select("id,patient_id,language,mode,status,started_at,red_flag,red_flag_reason")
      .eq("id", sessionId)
      .maybeSingle();

    if (sErr || !session) {
      return jsonResponse({ error: sErr?.message || "Session not found" }, 404);
    }

    // 2. Fetch Patient
    const { data: patient, error: pErr } = await sb
      .from("patients")
      .select("id,name,phone,abha_id,chronic_conditions,current_medications,allergies")
      .eq("id", session.patient_id)
      .maybeSingle();

    if (pErr || !patient) {
      return jsonResponse({ error: pErr?.message || "Patient not found" }, 404);
    }

    // 3. Fetch Answers
    const { data: answers } = await sb
      .from("history_answers")
      .select("section,item_code,question,answer_text,answer_value")
      .eq("session_id", sessionId);

    // 4. Fetch Dashavidha
    const { data: factors } = await sb
      .from("dashavidha_assessments")
      .select("factor,value,detail")
      .eq("session_id", sessionId);

    // 5. Fetch Document Entities
    const { data: docs } = await sb
      .from("case_documents")
      .select("id")
      .eq("session_id", sessionId);

    let entities: any[] = [];
    const docIds = (docs ?? []).map((d) => d.id);
    if (docIds.length > 0) {
      const { data: eData } = await sb
        .from("document_entities")
        .select("entity_type,name,value,unit,out_of_range")
        .in("document_id", docIds);
      entities = eData ?? [];
    }

    // 6. Build Summary
    const summaryInput: SummaryInput = {
      session,
      patient,
      answers: answers ?? [],
      factors: factors ?? [],
      entities,
    };

    const built = buildCaseSummary(summaryInput);

    // 7. Upsert into case_summaries as 'draft'
    // Conforms to constraint: status = 'draft' or (reviewed_by is not null)
    const { data: savedSummary, error: sumErr } = await sb
      .from("case_summaries")
      .upsert(
        {
          session_id: sessionId,
          sections: built.sections,
          clinician_text: built.clinician_text,
          patient_text: built.patient_text,
          status: "draft",
          model: "swadhikaar-clinical-v1",
        },
        { onConflict: "session_id" }
      )
      .select("id,session_id,status,created_at")
      .single();

    if (sumErr) {
      throw sumErr;
    }

    // 8. Transition session to 'ready' for the doctor consultation queue
    await sb
      .from("case_sessions")
      .update({ status: "ready" })
      .eq("id", sessionId)
      .in("status", ["interviewing", "scanning", "summarising"]);

    // 9. Audit Log
    try {
      await sb.from("audit_log").insert({
        user_role: "kiosk",
        action: "case_summary_generated",
        resource_type: "case_summary",
        resource_id: savedSummary.id,
        details: {
          session_id: sessionId,
          patient_id: patient.id,
          red_flag: session.red_flag,
          section_count: built.sections.length,
        },
      });
    } catch (auditErr) {
      console.warn("audit_log failed:", auditErr);
    }

    return jsonResponse({
      summary_id: savedSummary.id,
      session_id: sessionId,
      status: "draft",
      sections: built.sections,
      clinician_text: built.clinician_text,
      patient_text: built.patient_text,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("case-summary failed:", message);
    return jsonResponse({ error: message }, 500);
  }
});
