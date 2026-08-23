"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { Bi, BigButton, RiskPill, normaliseRisk } from "@/components/asha/ui";
import { useAshaProfile, useVillagePatients } from "@/hooks/use-asha";
import {
  pendingCount,
  syncNow,
  onPendingChange,
  deadOps,
  discardDead,
  type OutboxOp,
} from "@/lib/offline/outbox";

export default function AshaDashboard() {
  const { name, village, district, loading: pLoading } = useAshaProfile();
  const { data: patients, loading, error, refetch } = useVillagePatients();
  const [queued, setQueued] = useState(0);
  const [stuck, setStuck] = useState<OutboxOp[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    pendingCount().then(setQueued);
    // Re-checked on every queue change: an op can only become dead during a sync,
    // and a sync always fires onPendingChange.
    const off = onPendingChange((n) => {
      setQueued(n);
      void deadOps().then(setStuck);
    });
    void deadOps().then(setStuck);
    return off;
  }, []);

  const highRisk = patients.filter((p) => normaliseRisk(p.risk_level) === "High");

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[15px] text-slate-500" lang="hi">
          नमस्ते
        </p>
        <h1 className="text-[26px] font-bold leading-tight">
          {pLoading ? "…" : name}
        </h1>
        <p className="mt-1 text-[15px] text-slate-600">
          <span lang="hi">गाँव</span>{" "}
          <span className="font-semibold">{village || "—"}</span>
          {district && <span className="text-slate-500"> · {district}</span>}
        </p>
      </div>

      {/* summary strip: count + shape-coded risk, never colour alone */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[28px] font-bold tabular-nums">{patients.length}</p>
          <Bi
            hi="कुल मरीज़"
            en="Total patients"
            hiClass="text-[15px] font-semibold leading-snug"
            enClass="text-[13px] text-slate-500 leading-snug"
          />
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-2 text-[28px] font-bold tabular-nums text-red-800">
            <TriangleAlert aria-hidden className="size-6" />
            {highRisk.length}
          </p>
          <Bi
            hi="उच्च जोखिम"
            en="High risk"
            hiClass="text-[15px] font-semibold leading-snug text-red-900"
            enClass="text-[13px] text-red-700/80 leading-snug"
          />
        </div>
      </div>

      {/* A screening the server will never accept must be visible, not counted as
          "waiting to sync" forever. This is the only place the loss surfaces. */}
      {stuck.length > 0 && (
        <div role="alert" className="rounded-2xl border-2 border-red-500 bg-red-50 p-4">
          <Bi
            hi={`${stuck.length} जांच भेजी नहीं जा सकी`}
            en={`${stuck.length} screening(s) could not be sent`}
            hiClass="text-[16px] font-bold leading-snug text-red-900"
            enClass="text-[13px] font-semibold text-red-800"
          />
          <p className="mt-2 text-[14px] text-red-900">
            <span lang="hi">
              इन्हें दोबारा भरना पड़ेगा। सुपरवाइज़र को बताएं।
            </span>
            <span className="mt-0.5 block text-[12px] text-red-700">
              These need re-entering — tell your supervisor. Reason:{" "}
              {stuck[0].lastError?.slice(0, 90)}
            </span>
          </p>
          <button
            type="button"
            onClick={async () => {
              await discardDead();
              setStuck(await deadOps());
            }}
            className="mt-3 min-h-[48px] w-full rounded-xl border-2 border-red-400 px-4 font-semibold text-red-900"
          >
            समझ गया, हटाएं / Understood, clear
          </button>
        </div>
      )}

      {queued > 0 && (
        <div className="rounded-2xl border border-slate-300 bg-white p-4">
          <Bi
            hi={`${queued} जांच भेजी जानी बाकी है`}
            en={`${queued} screenings waiting to sync`}
            hiClass="text-[16px] font-semibold leading-snug"
          />
          <button
            type="button"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              await syncNow();
              await refetch();
              setSyncing(false);
            }}
            className="mt-3 min-h-[48px] w-full rounded-xl border-2 border-slate-300 px-4 font-semibold disabled:opacity-50"
          >
            {syncing ? "भेज रहे हैं… / Sending…" : "अब भेजें / Send now"}
          </button>
        </div>
      )}

      <section>
        <h2 className="mb-3">
          <Bi
            hi="आज का काम"
            en="Today's work"
            hiClass="text-[20px] font-bold leading-snug"
          />
        </h2>

        {loading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-slate-200" />
            ))}
          </div>
        )}

        {!loading && error && (
          <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[15px] text-amber-900">
            सूची नहीं मिली / Could not load list: {error}
          </p>
        )}

        {!loading && !error && patients.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-[15px] text-slate-600">
            <span lang="hi">आपके गाँव में कोई मरीज़ दर्ज नहीं है।</span>
            <br />
            No patients registered in your area yet.
          </p>
        )}

        <ul className="space-y-2.5">
          {patients.map((p) => (
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
      </section>

      {/* primary action pinned to the thumb zone above the tab bar */}
      <div className="fixed inset-x-0 bottom-[60px] z-10 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA] to-transparent px-4 pt-4 pb-3">
        <div className="mx-auto max-w-[430px]">
          <BigButton hi="नई जांच शुरू करें" en="Start new screening" href="/asha/screening/new" />
        </div>
      </div>
    </div>
  );
}
