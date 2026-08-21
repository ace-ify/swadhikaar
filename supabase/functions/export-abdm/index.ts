import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const patientId = typeof payload?.patient_id === "string" ? payload.patient_id : null;
    if (!patientId) {
      return jsonResponse({ error: "patient_id query param is required" }, 400);
    }

    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("fhir_resources")
      .select("id,patient_id,resource_type,profile")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      throw error;
    }

    const latest = data?.[0];
    if (!latest) {
      return jsonResponse({ status: "no_data", abdm_reference: null });
    }

    const ref = `ABDM-${String(latest.id).slice(0, 8)}-${Math.floor(Date.now() / 1000)}`;

    return jsonResponse({
      status: "exported",
      abdm_reference: ref,
      resource_id: latest.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
