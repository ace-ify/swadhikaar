"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import type { Patient } from "@/hooks/use-supabase";
import {
  bmiOf,
  computeRisk,
  type RiskResult,
  type ScreeningDraft,
  type SymptomAnswers,
  type VitalAnswers,
} from "@/components/asha/risk";

/** The village patient rows the screening UI actually needs. */
export type VillagePatient = Pick<
  Patient,
  "id" | "name" | "phone" | "risk_level" | "overall_risk_score" | "journey_status" | "created_at"
> & {
  village: string | null;
  district: string | null;
  occupation: string | null;
  crop_type: string | null;
};

const PATIENT_COLS =
  "id,name,phone,risk_level,overall_risk_score,journey_status,created_at,village,district,occupation,crop_type";

/**
 * Worker identity + assigned area. RLS already restricts `field_worker_areas`
 * to the caller's own rows, so no user_id filter is needed here.
 */
export function useAshaProfile() {
  const [name, setName] = useState("");
  const [village, setVillage] = useState("");
  const [district, setDistrict] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: areas } = await supabase
        .from("field_worker_areas")
        .select("village,district")
        .limit(1);
      if (!alive) return;
      setName(
        (user?.user_metadata?.name as string) ||
          user?.email?.split("@")[0] ||
          "साथी"
      );
      setVillage(areas?.[0]?.village || "");
      setDistrict(areas?.[0]?.district || "");
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { name, village, district, loading };
}

/**
 * Patients this worker may see. RLS scopes the result to their assigned
 * villages, so an empty list means "no patients in your area", not a bug.
 */
export function useVillagePatients() {
  const [data, setData] = useState<VillagePatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: rows, error: err } = await createClient()
      .from("patients")
      .select(PATIENT_COLS)
      .order("created_at", { ascending: false });
    return {
      rows: (rows as VillagePatient[] | null) ?? [],
      err: err?.message ?? null,
    };
  }, []);

  const apply = useCallback((r: { rows: VillagePatient[]; err: string | null }) => {
    setData(r.rows);
    setError(r.err);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await load();
      if (alive) apply(r);
    })();
    return () => {
      alive = false;
    };
  }, [load, apply]);

  const refetch = useCallback(async () => {
    apply(await load());
  }, [load, apply]);

  return { data, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// Screening draft handoff between /screening/new and /screening/[id]/result
// ---------------------------------------------------------------------------
// ponytail: sessionStorage, not IndexedDB. A draft only has to survive one
// route transition on one device; the durable copy is the outbox. Upgrade path:
// move to the offline agent's store if drafts must survive an app kill.
const draftKey = (id: string) => `swadhikaar.asha.draft.${id}`;

export function saveDraft(draft: ScreeningDraft) {
  sessionStorage.setItem(draftKey(draft.draftId), JSON.stringify(draft));
}

export function loadDraft(draftId: string): ScreeningDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(draftId));
    return raw ? (JSON.parse(raw) as ScreeningDraft) : null;
  } catch {
    return null;
  }
}

export function clearDraft(draftId: string) {
  sessionStorage.removeItem(draftKey(draftId));
}

/**
 * Scores a screening. Tries the deployed `risk-predict` edge function first
 * (it is the system of record for scoring) and falls back to the identical
 * local heuristic when the worker is offline or the call fails.
 */
export async function scoreScreening(
  symptoms: SymptomAnswers,
  vitals: VitalAnswers
): Promise<{ risk: RiskResult; source: "edge" | "local" }> {
  const local = computeRisk(symptoms, vitals);
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { risk: local, source: "local" };
  }
  try {
    const { data, error } = await createClient().functions.invoke("risk-predict", {
      // the edge function takes bmi directly; it never sees height/weight
      body: { ...symptoms, ...vitals, bmi: bmiOf(vitals.height, vitals.weight) },
    });
    if (error || !data || typeof data.overall_risk_score !== "number") {
      return { risk: local, source: "local" };
    }
    return {
      risk: {
        heart_risk_score: data.heart_risk_total_score,
        heart_risk_level: data.heart_risk_level,
        diabetic_risk_score: data.diabetic_risk_total_score,
        diabetic_risk_level: data.diabetic_risk_level,
        hypertension_risk_score: data.hypertension_risk_total_score,
        hypertension_risk_level: data.hypertension_risk_level,
        overall_risk_score: data.overall_risk_score,
        overall_risk_category: data.overall_risk_category,
        model: data.model ?? "edge",
      },
      source: "edge",
    };
  } catch {
    return { risk: local, source: "local" };
  }
}
