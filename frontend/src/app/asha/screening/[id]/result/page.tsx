"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, HeartPulse, Droplet, Weight, Activity } from "lucide-react";
import { Bi, BigButton, RiskBanner, Section } from "@/components/asha/ui";
import {
  bmiCategory,
  bmiOf,
  draftToWrites,
  recommendedActions,
  type RiskResult,
  type ScreeningDraft,
} from "@/components/asha/risk";
import { clearDraft, loadDraft, scoreScreening } from "@/hooks/use-asha";
import { enqueue } from "@/lib/offline/outbox";

const FOLLOW_UP_DAYS: Record<string, number> = { High: 1, Moderate: 7, Low: 90 };

export default function ScreeningResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [scored, setScored] = useState<{
    draft: ScreeningDraft;
    risk: RiskResult;
    source: "edge" | "local";
  } | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = loadDraft(id);
      if (!d) {
        router.replace("/asha/screening/new");
        return;
      }
      const r = await scoreScreening(d.symptoms, d.vitals);
      if (alive) setScored({ draft: d, risk: r.risk, source: r.source });
    })();
    return () => {
      alive = false;
    };
  }, [id, router]);

  const actions = useMemo(
    () => (scored ? recommendedActions(scored.risk, scored.draft.vitals) : []),
    [scored]
  );

  if (!scored) {
    return <p className="p-4 text-[16px]">जोखिम निकाल रहे हैं… / Scoring…</p>;
  }

  const { draft, risk, source } = scored;

  const v = draft.vitals;
  const bmi = bmiOf(v.height, v.weight);
  // dated from the screening itself, not from render time (stays pure)
  const followUp = new Date(
    new Date(draft.createdAt).getTime() +
      (FOLLOW_UP_DAYS[risk.overall_risk_category] ?? 30) * 86400000
  );

  const tiles = [
    {
      Icon: HeartPulse,
      hi: "रक्तचाप",
      en: "Blood pressure",
      val: v.systolic_bp && v.diastolic_bp ? `${v.systolic_bp}/${v.diastolic_bp}` : "—",
      unit: "mmHg",
    },
    { Icon: Droplet, hi: "शुगर", en: "Glucose", val: v.blood_glucose ?? "—", unit: "mg/dL" },
    { Icon: Weight, hi: "बीएमआई", en: "BMI", val: bmi ?? "—", unit: bmiCategory(bmi) },
    { Icon: Activity, hi: "नाड़ी", en: "Pulse", val: v.heart_rate ?? "—", unit: "/min" },
  ];

  async function saveAndSchedule() {
    setSaving(true);
    // Every write goes through the outbox — never a direct Supabase call from
    // the screening flow. The worker is offline most of the time.
    for (const w of draftToWrites(draft, risk)) {
      await enqueue({ table: w.table, op: w.op, payload: w.payload });
    }
    clearDraft(draft.draftId);
    setSaved(true);
    setSaving(false);
  }

  return (
    <div className="space-y-5 pb-28">
      <div>
        <Bi hi="जांच का परिणाम" en="Screening result" hiClass="text-[22px] font-bold leading-tight" />
        <p className="mt-1 text-[16px] font-semibold">{draft.name || "—"}</p>
        <p className="text-[14px] text-slate-500">
          {[draft.age && `${draft.age} साल`, draft.gender, draft.village]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <RiskBanner level={risk.overall_risk_category} score={risk.overall_risk_score} />

      <Section hi="माप का सारांश" en="Vitals summary">
        <ul className="grid grid-cols-2 gap-3">
          {tiles.map(({ Icon, hi, en, val, unit }) => (
            <li key={en} className="rounded-xl border border-slate-200 p-3">
              <Icon aria-hidden className="mb-1 size-5 text-slate-500" />
              <p className="text-[22px] font-bold tabular-nums">{String(val)}</p>
              <p className="text-[13px] text-slate-500">{unit}</p>
              <Bi
                hi={hi}
                en={en}
                hiClass="text-[15px] font-semibold leading-snug"
                enClass="text-[12px] text-slate-500 leading-snug"
              />
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1.5 text-[15px]">
          {[
            ["दिल / Heart", risk.heart_risk_level, risk.heart_risk_score],
            ["शुगर / Diabetes", risk.diabetic_risk_level, risk.diabetic_risk_score],
            ["बीपी / Hypertension", risk.hypertension_risk_level, risk.hypertension_risk_score],
          ].map(([label, lvl, score]) => (
            <div key={String(label)} className="flex justify-between gap-3">
              <dt>{String(label)}</dt>
              <dd className="font-semibold tabular-nums">
                {String(lvl)} · {Math.round(Number(score))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[13px] text-slate-400">
          {source === "edge"
            ? "स्कोर सर्वर से / Scored on the server"
            : "स्कोर इस फ़ोन पर / Scored on this phone (offline)"}
          {" · "}
          {risk.model}
        </p>
      </Section>

      <Section hi="सलाह" en="Recommended actions">
        <ul className="space-y-2.5">
          {actions.map((a) => {
            const checked = done.includes(a.en);
            return (
              <li key={a.en}>
                <button
                  type="button"
                  aria-pressed={checked}
                  onClick={() =>
                    setDone((d) => (checked ? d.filter((x) => x !== a.en) : [...d, a.en]))
                  }
                  className={
                    "flex min-h-[56px] w-full items-center gap-3 rounded-xl border-2 p-3 text-left " +
                    (checked ? "border-[#10B981] bg-emerald-50" : "border-slate-200 bg-white")
                  }
                >
                  <span
                    aria-hidden
                    className={
                      "grid size-7 shrink-0 place-items-center rounded-md border-2 text-[16px] font-bold " +
                      (checked
                        ? "border-[#10B981] bg-[#10B981] text-white"
                        : "border-slate-400 text-transparent")
                    }
                  >
                    ✓
                  </span>
                  <Bi
                    hi={a.hi}
                    en={a.en}
                    hiClass="text-[16px] font-semibold leading-snug"
                    enClass="text-[13px] text-slate-500 leading-snug"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <CalendarCheck aria-hidden className="size-6 shrink-0 text-slate-500" />
        <Bi
          hi={`अगली जांच: ${followUp.toLocaleDateString("hi-IN", { day: "numeric", month: "long" })}`}
          en={`Follow-up on ${followUp.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
          hiClass="text-[16px] font-semibold leading-snug"
        />
      </div>

      {saved && (
        <p
          role="status"
          className="rounded-2xl border-2 border-[#10B981] bg-emerald-50 p-4 text-[16px] font-semibold text-emerald-900"
        >
          ✓ सुरक्षित / Saved. नेटवर्क मिलने पर अपने आप भेज दी जाएगी — it will sync
          automatically when you are back online.
        </p>
      )}

      <div className="fixed inset-x-0 bottom-[60px] z-10 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA] to-transparent px-4 pt-4 pb-3">
        <div className="mx-auto max-w-[430px]">
          {saved ? (
            <BigButton hi="घर जाएँ" en="Back to home" href="/asha/dashboard" />
          ) : (
            <BigButton
              hi="सुरक्षित करें और अगली जांच तय करें"
              en="Save and schedule follow-up"
              disabled={saving}
              onClick={saveAndSchedule}
            />
          )}
        </div>
      </div>
    </div>
  );
}
