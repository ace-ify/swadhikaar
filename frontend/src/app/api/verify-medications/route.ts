import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * Persist the human-VERIFIED medication schedule back onto the document's entities.
 * The OCR route inserts entities with the raw extracted frequency at scan time;
 * after the patient corrects timing/dose in the verification step, we write the
 * corrected values here so patient/records derives the corrected plan later.
 *
 * The corrected schedule is stored as a canonical frequency string (round-trips
 * through parseFrequency), so no schema change is needed. Best-effort: a failure
 * never blocks the kiosk flow.
 */
export async function POST(req: Request) {
  try {
    const { document_id, medications } = await req.json().catch(() => ({}));
    if (!document_id || !Array.isArray(medications)) {
      return NextResponse.json(
        { success: false, error: "document_id and medications[] are required" },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabaseClient();
    let updated = 0;

    for (const m of medications) {
      const matchName = m.match_name || m.name;
      if (!matchName || !m.name) continue;
      const { count, error } = await supabase
        .from("document_entities")
        .update(
          { entity_name: m.name, dosage_or_value: m.dosage ?? null, frequency: m.frequency ?? null },
          { count: "exact" }
        )
        .eq("document_id", document_id)
        .eq("entity_type", "medication")
        .eq("entity_name", matchName);
      if (!error && count) updated += count;
    }

    return NextResponse.json({ success: true, updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "verify-medications failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
