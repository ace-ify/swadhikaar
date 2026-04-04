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

export async function callExportAbdm(patientId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("export-abdm", {
    body: { patient_id: patientId },
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? {}) as {
    status: string;
    abdm_reference: string | null;
    resource_id?: string;
    error?: string;
  };
}
