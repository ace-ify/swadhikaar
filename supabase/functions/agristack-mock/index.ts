// AgriStack sandbox stand-in — the health <-> agriculture identity bridge.
//
// HONEST SCOPE: AgriStack exposes no open public sandbox, so this is a mock that
// implements the *contract* we would consume, not a live integration. Every
// response carries source:"mock" so no screen can accidentally present it as real.
// Swapping in the real registry means replacing lookupFarmer() only.
//
// The point it proves: one person = one ABHA id + one farmer id, which is what
// makes the same individual legible to both the health and agriculture systems.

import { corsHeaders } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase-admin.ts";

type Req = {
  action?: "lookup" | "link";
  abha_id?: string;
  phone?: string;
  farmer_id?: string;
  patient_id?: string;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Deterministic so repeated lookups for the same person return the same record.
// A random mock would look convincing once and then contradict itself on screen.
async function stableHash(seed: string): Promise<number> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return new DataView(buf).getUint32(0, false); // 0 .. 2^32-1
}

const CROPS = ["paddy", "wheat", "sugarcane", "maize", "pulses", "mustard"];
const SCHEMES = ["PM-KISAN", "PMFBY", "KCC", "Soil Health Card"];
const STATES: Record<string, string> = { BR: "Bihar", UP: "Uttar Pradesh", MP: "Madhya Pradesh" };

async function lookupFarmer(seed: string, district?: string) {
  const h = await stableHash(seed);

  // >>> not >>: JavaScript's signed shift coerces to int32, so any hash above
  // 2^31 went negative and produced negative land holdings and empty crop lists.
  const landHa = Number((((h >>> 5) % 380) / 100 + 0.2).toFixed(2)); // 0.20 .. 3.99
  const stateCode = ["BR", "UP", "MP"][h % 3];
  const cropCount = 1 + ((h >>> 11) % 2);
  const crops = Array.from(
    { length: cropCount },
    (_, i) => CROPS[(h >>> (13 + i * 3)) % CROPS.length],
  );
  const schemes = SCHEMES.filter((_, i) => ((h >>> (7 + i)) & 1) === 1);

  return {
    source: "mock" as const,
    registry: "AgriStack Farmer Registry (sandbox contract)",
    farmer_id: `FR-${stateCode}-${String(h % 100000000).padStart(8, "0")}`,
    state: STATES[stateCode],
    district: district ?? null,
    land_holding_hectares: landHa,
    holding_category: landHa < 1 ? "marginal" : landHa < 2 ? "small" : "semi-medium",
    primary_crops: [...new Set(crops)],
    irrigation: ((h >>> 17) & 1) === 1 ? "tubewell" : "rain-fed",
    enrolled_schemes: schemes,
    kyc_status: "verified",
    retrieved_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Req;
  try {
    body = (await req.json()) as Req;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const action = body.action ?? "lookup";
  const seed = (body.abha_id ?? body.phone ?? body.farmer_id ?? "").trim();

  // link resolves identity from the patient row, so it needs patient_id, not a seed.
  if (action === "lookup" && !seed) {
    return json({ error: "one of abha_id, phone or farmer_id is required for action=lookup" }, 400);
  }
  if (action === "link" && !body.patient_id) {
    return json({ error: "patient_id is required for action=link" }, 400);
  }

  try {
    if (action === "lookup") {
      const record = await lookupFarmer(seed);
      return json({
        ok: true,
        identity_bridge: {
          abha_id: body.abha_id ?? null,
          farmer_id: record.farmer_id,
          resolved_by: body.abha_id ? "abha_id" : body.phone ? "phone" : "farmer_id",
        },
        farmer: record,
      });
    }

    if (action === "link") {
      const db = getAdminClient();

      const { data: patient, error: readErr } = await db
        .from("patients")
        .select("id, name, abha_id, phone, district, farmer_registry_id")
        .eq("id", body.patient_id!)
        .maybeSingle();
      if (readErr) throw new Error(`patient read: ${readErr.message}`);
      if (!patient) return json({ error: "patient not found" }, 404);

      const record = await lookupFarmer(
        patient.abha_id ?? patient.phone ?? seed,
        patient.district ?? undefined,
      );

      const { data: updated, error: updErr } = await db
        .from("patients")
        .update({ farmer_registry_id: record.farmer_id, updated_at: new Date().toISOString() })
        .eq("id", patient.id)
        .select("id, name, abha_id, farmer_registry_id, district")
        .single();
      if (updErr) throw new Error(`patient update: ${updErr.message}`);

      const { error: auditErr } = await db.from("audit_log").insert({
        user_role: "cross_domain_layer",
        action: "agristack_identity_linked",
        resource_type: "patient",
        resource_id: patient.id,
        details: {
          farmer_id: record.farmer_id,
          source: "mock",
          previously_linked: patient.farmer_registry_id,
        },
      });
      if (auditErr) console.error(`audit_log insert failed: ${auditErr.message}`);

      return json({
        ok: true,
        identity_bridge: {
          abha_id: updated.abha_id,
          farmer_id: updated.farmer_registry_id,
          patient_id: updated.id,
          one_person_two_registries: true,
        },
        farmer: record,
      });
    }

    return json({ error: `unknown action "${action}"` }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`agristack-mock failed: ${message}`);
    return json({ error: message }, 500);
  }
});
