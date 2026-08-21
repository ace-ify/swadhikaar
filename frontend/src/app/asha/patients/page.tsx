"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, ChevronRight } from "lucide-react";
import { Bi, BigButton, RiskPill, normaliseRisk } from "@/components/asha/ui";
import { useAshaProfile, useVillagePatients } from "@/hooks/use-asha";

const FILTERS = [
  { key: "all", hi: "सभी", en: "All" },
  { key: "High", hi: "उच्च", en: "High" },
  { key: "Moderate", hi: "मध्यम", en: "Moderate" },
  { key: "Low", hi: "कम", en: "Low" },
] as const;

export default function AshaPatientsPage() {
  const { village } = useAshaProfile();
  const { data, loading, error } = useVillagePatients();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.filter((p) => {
      if (filter !== "all" && normaliseRisk(p.risk_level) !== filter) return false;
      if (!needle) return true;
      return (
        p.name?.toLowerCase().includes(needle) || (p.phone || "").includes(needle)
      );
    });
  }, [data, q, filter]);

  return (
    <div className="space-y-4 pb-24">
      <div>
        <Bi hi="मेरे मरीज़" en="My patients" hiClass="text-[22px] font-bold leading-tight" />
        <p className="mt-1 text-[15px] text-slate-600">
          गाँव <span className="font-semibold">{village || "—"}</span> ·{" "}
          <span className="tabular-nums">{data.length}</span>
        </p>
      </div>

      <label className="block">
        <span className="sr-only">नाम या फ़ोन खोजें / Search by name or phone</span>
        <span className="flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-3">
          <Search aria-hidden className="size-5 shrink-0 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="नाम या फ़ोन खोजें / Search"
            className="min-h-[52px] w-full bg-transparent text-[17px] focus:outline-none"
          />
        </span>
      </label>

      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Risk filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={
              "min-h-[48px] shrink-0 rounded-xl border-2 px-4 text-[15px] font-semibold " +
              (filter === f.key
                ? "border-[#10B981] bg-emerald-50"
                : "border-slate-300 bg-white text-slate-600")
            }
          >
            <span lang="hi">{f.hi}</span>
            <span className="sr-only"> {f.en}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-slate-200" />
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[15px] text-amber-900">
          सूची नहीं मिली / Could not load list: {error}
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-[15px] text-slate-600">
          कोई मरीज़ नहीं मिला. / No patients match.
        </p>
      )}

      <ul className="space-y-2.5">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              href={`/asha/screening/new?patient=${p.id}`}
              className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-slate-100 text-[18px] font-bold">
                {p.name?.[0] ?? "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] font-semibold">{p.name}</span>
                <span className="block truncate text-[14px] text-slate-500">
                  {[p.occupation, p.crop_type, p.phone].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              <RiskPill level={p.risk_level} />
              <ChevronRight aria-hidden className="size-5 shrink-0 text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>

      <div className="fixed inset-x-0 bottom-[60px] z-10 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA] to-transparent px-4 pt-4 pb-3">
        <div className="mx-auto max-w-[430px]">
          <BigButton hi="नई जांच शुरू करें" en="Start new screening" href="/asha/screening/new" />
        </div>
      </div>
    </div>
  );
}
