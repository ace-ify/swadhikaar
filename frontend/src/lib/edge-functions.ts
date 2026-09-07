import { createClient } from "@/lib/supabase";

export async function callStartVoiceCall(payload: Record<string, unknown>) {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("start-voice-call", {
    body: payload,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? {}) as {
    call_id: string;
    status: string;
    livekit_token: string | null;
    livekit_url: string | null;
    error?: string;
  };
}

export async function callExportAbdm(patientId?: string, sessionId?: string) {
  const supabase = createClient();
  const body: Record<string, string> = {};
  if (patientId) body.patient_id = patientId;
  if (sessionId) body.session_id = sessionId;

  const { data, error } = await supabase.functions.invoke("export-abdm", {
    body,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? {}) as {
    status: string;
    abdm_reference: string | null;
    bundle_id?: string;
    resource_count?: number;
    resources?: Array<{ type: string; profile: string; snomed: string[]; loinc: string[] }>;
    bundle?: Record<string, unknown>;
    error?: string;
  };
}

export async function callCaseSession(payload: Record<string, unknown>) {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("case-session", {
    body: payload,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Record<string, any>;
}

export async function callCaseSummary(sessionId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("case-summary", {
    body: { session_id: sessionId },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as {
    summary_id: string;
    session_id: string;
    status: string;
    sections: any[];
    clinician_text: string;
    patient_text: string;
    error?: string;
  };
}

export async function callReviewCaseSummary(payload: {
  sessionId: string;
  action: "accepted" | "amended" | "rejected";
  doctorName?: string;
  notes?: string;
  amendedSections?: any;
}) {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("case-summary", {
    body: {
      action: "review",
      session_id: payload.sessionId,
      review_action: payload.action,
      doctor_name: payload.doctorName,
      notes: payload.notes,
      amended_sections: payload.amendedSections,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as {
    success: boolean;
    session_id: string;
    status: string;
    summary: any;
    error?: string;
  };
}

export async function callAbdmGateway(payload: {
  milestone: "M1" | "M2" | "M3";
  action: string;
  [key: string]: unknown;
}) {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("abdm-gateway", {
    body: payload,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Record<string, any>;
}
