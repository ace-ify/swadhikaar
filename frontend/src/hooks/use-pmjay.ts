"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";

export interface PmjayHospital {
  id: string;
  hospital_id: string;
  name: string;
  hospital_type: string | null;
  specialities: string[];
  phone: string | null;
  email: string | null;
  district: string | null;
  state: string | null;
  as_on: string | null;
  lat: number | null;
  lon: number | null;
  geo_source: string | null;
}

export interface PmjayLocation {
  state: string;
  district: string;
}

/** Distinct state/district pairs present in pmjay_hospitals (303 rows — fetch + dedupe). */
export function usePmjayLocations() {
  const [locations, setLocations] = useState<PmjayLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await createClient().from("pmjay_hospitals").select("state,district");
      const seen = new Set<string>();
      const out: PmjayLocation[] = [];
      for (const r of (data as PmjayLocation[]) || []) {
        const key = `${r.state}|${r.district}`;
        if (r.district && !seen.has(key)) {
          seen.add(key);
          out.push(r);
        }
      }
      out.sort((a, b) => `${a.state}${a.district}`.localeCompare(`${b.state}${b.district}`));
      setLocations(out);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { locations, loading };
}

/** All empanelled hospitals in a district (specialty filtering is done client-side
 *  against the care-need map, because the raw specialities are noisy). */
export function usePmjayHospitals(district: string | null) {
  const [hospitals, setHospitals] = useState<PmjayHospital[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!district) {
      setHospitals([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await createClient()
        .from("pmjay_hospitals")
        .select("*")
        .eq("district", district)
        .order("hospital_type", { ascending: true })
        .order("name", { ascending: true });
      setHospitals((data as PmjayHospital[]) || []);
    } finally {
      setLoading(false);
    }
  }, [district]);

  useEffect(() => {
    load();
  }, [load]);

  return { hospitals, loading };
}
