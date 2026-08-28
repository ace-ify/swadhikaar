import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// Server-side proxy to the incident-complete edge function.
//
// Why this exists: incident-complete is authenticated with a shared secret
// (x-acute-secret), and that secret must never reach the browser. The demo needs a
// button, so the button posts here and this route holds the secret.
//
// proxy.ts treats /api/* as public, so this handler does its own authorisation:
// a real session AND an admin row in user_roles. user_metadata is not consulted —
// it is writable by the user it belongs to.

type Body = {
  // Supplied when closing a case that actually exists in this system. Without it the
  // seam invents an id, which is how the acute layer and the continuity layer ended up
  // unable to refer to the same episode: you could dispatch a real case and then had to
  // retype the patient into a second form to close it.
  incident_ref?: string;
  name?: string;
  phone?: string;
  abha_id?: string;
  language?: string;
  incident_type?: string;
  severity?: string;
  hospital_name?: string;
  outcome_summary?: string;
  diagnosis_code?: string;
  diagnosis_display?: string;
};

export async function POST(request: Request) {
  const secret = process.env.ACUTE_INGRESS_SECRET;
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!secret || !projectUrl) {
    return NextResponse.json(
      { error: "ACUTE_INGRESS_SECRET or NEXT_PUBLIC_SUPABASE_URL is not configured" },
      { status: 500 },
    );
  }

  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Authorisation comes from the roles table, never from user_metadata.
  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleRow?.role !== "admin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.phone?.trim() && !body.abha_id?.trim()) {
    return NextResponse.json(
      { error: "one of phone or abha_id is required to resolve a patient" },
      { status: 400 },
    );
  }

  const completedAt = new Date().toISOString();

  // A real case closes under its OWN reference, so the patient record that comes out
  // carries the id of the incident that created it and the two halves of the system
  // describe one episode. The generated form is kept for the standalone demo, where
  // replaying a submission should be a new episode each time.
  //
  // Shape-checked rather than trusted: this value reaches an edge function and is
  // stored as an external identifier.
  const suppliedRef = body.incident_ref?.trim();
  const incidentId =
    suppliedRef && /^[A-Z0-9-]{4,32}$/.test(suppliedRef)
      ? suppliedRef
      : `H-DEMO-${Date.now().toString(36).toUpperCase()}`;

  const payload = {
    incident_id: incidentId,
    name: body.name.trim(),
    phone: body.phone?.trim() || undefined,
    abha_id: body.abha_id?.trim() || undefined,
    language: body.language?.trim() || "hindi",
    incident_type: body.incident_type?.trim() || "Road traffic accident",
    severity: body.severity?.trim() || "CRITICAL",
    hospital_name: body.hospital_name?.trim() || undefined,
    outcome_summary: body.outcome_summary?.trim() || undefined,
    completed_at: completedAt,
    diagnosis: body.diagnosis_code?.trim()
      ? [
          {
            code: body.diagnosis_code.trim(),
            display: body.diagnosis_display?.trim() || undefined,
            system: "http://snomed.info/sct",
          },
        ]
      : [],
  };

  const res = await fetch(`${projectUrl}/functions/v1/incident-complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acute-secret": secret,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  return NextResponse.json(parsed, { status: res.status });
}
