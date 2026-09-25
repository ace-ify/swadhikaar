"use client";

/**
 * PS-01 medication schedule + human verification.
 *
 * DoseGrid renders the four time-of-day slots as pictograms (lucide sun/moon).
 * MedicationScheduleReview is the SAFETY GATE: it parses each extracted medicine's
 * frequency into a schedule, shows it, and lets the human correct name/dose/timing
 * before the plan is issued (PS-01 requires verification before the patient plan).
 * Consumes the pure parser in lib/clinical/frequency.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { type LucideIcon, Sunrise, Sun, Sunset, Moon, Pill, AlertTriangle, Clock, Volume2, Share2, CalendarClock, Check } from "lucide-react";
import { toast } from "sonner";
import {
  parseFrequency,
  scheduleToText,
  SLOT_META,
  DOSE_SLOTS,
  buildMedicationICS,
  type DoseSlot,
  type MedicationSchedule,
} from "@/lib/clinical/frequency";
import { speak } from "@/lib/speak";

const SLOT_ICON: Record<DoseSlot, LucideIcon> = {
  morning: Sunrise,
  afternoon: Sun,
  evening: Sunset,
  night: Moon,
};

export interface RawMedication {
  name: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  duration_days?: number;
  instructions?: string;
}

export interface ReviewedMedication extends RawMedication {
  schedule: MedicationSchedule;
  verified: boolean;
  originalName: string; // name as extracted, for matching the persisted row on update
}

export function DoseGrid({
  schedule,
  lang = "hi",
  editable = false,
  onToggle,
  tone = "dark",
}: {
  schedule: MedicationSchedule;
  lang?: "en" | "hi";
  editable?: boolean;
  onToggle?: (slot: DoseSlot) => void;
  tone?: "dark" | "light";
}) {
  const TONE =
    tone === "light"
      ? {
          on: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
          off: "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-500",
          hover: "hover:border-slate-300",
        }
      : {
          on: "border-emerald-500/70 bg-emerald-500/10 text-emerald-200",
          off: "border-slate-700 bg-slate-800/40 text-slate-500",
          hover: "hover:border-slate-400",
        };
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {DOSE_SLOTS.map((slot) => {
        const Icon = SLOT_ICON[slot];
        const count = schedule.slots[slot];
        const active = count > 0;
        const meta = SLOT_META[slot];
        const cls = `rounded-lg border p-2 text-center transition-colors ${active ? TONE.on : TONE.off}`;
        const body = (
          <>
            <Icon className={`size-4 mx-auto ${active ? "" : "opacity-40"}`} />
            <div className="text-[10px] mt-0.5 font-semibold">{lang === "hi" ? meta.hi : meta.en}</div>
            <div className="text-[9px] opacity-70">{meta.time}</div>
            {active && count > 1 && <div className="text-[9px] font-bold">×{count}</div>}
          </>
        );
        return editable ? (
          <button
            key={slot}
            type="button"
            aria-pressed={active}
            aria-label={`${lang === "hi" ? meta.hi : meta.en} dose ${active ? "on" : "off"}`}
            onClick={() => onToggle?.(slot)}
            className={`${cls} ${TONE.hover} focus:outline-none focus:ring-2 focus:ring-emerald-500/60`}
          >
            {body}
          </button>
        ) : (
          <div key={slot} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function MedicationScheduleReview({
  medications,
  lang = "hi",
  onChange,
}: {
  medications: RawMedication[];
  lang?: "en" | "hi";
  onChange?: (verified: ReviewedMedication[]) => void;
}) {
  const [meds, setMeds] = useState<ReviewedMedication[]>(() =>
    (medications ?? []).map((m) => ({
      ...m,
      originalName: m.name,
      schedule: parseFrequency(m.frequency || ""),
      verified: false,
    }))
  );
  // Surface the current verified list to the parent (onChange is a stable setter).
  // The parent remounts this per scan (via key), so no re-seed effect is needed.
  useEffect(() => onChange?.(meds), [meds, onChange]);

  const patch = (i: number, fn: (m: ReviewedMedication) => ReviewedMedication) =>
    setMeds((prev) => prev.map((m, j) => (j === i ? fn(m) : m)));

  const toggleSlot = (i: number, slot: DoseSlot) =>
    patch(i, (m) => {
      const slots = { ...m.schedule.slots, [slot]: m.schedule.slots[slot] > 0 ? 0 : 1 };
      const timesPerDay = DOSE_SLOTS.reduce((t, k) => t + slots[k], 0);
      // A human touched it: clear the parser's uncertainty flag.
      return { ...m, verified: true, schedule: { ...m.schedule, slots, timesPerDay, needsReview: false } };
    });

  if (!meds.length) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
        <Pill className="size-3.5 text-sky-400" />
        <span>
          {lang === "hi"
            ? `दवा अनुसूची जाँचें (${meds.length}) — समय ठीक करने हेतु टैप करें`
            : `Verify medication schedule (${meds.length}) — tap a time to correct it`}
        </span>
      </div>
      {meds.map((m, i) => (
        <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5">
          <div className="grid grid-cols-3 gap-2">
            <input
              value={m.name}
              onChange={(e) => patch(i, (x) => ({ ...x, name: e.target.value, verified: true }))}
              className="col-span-2 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-bold text-slate-100 focus:border-sky-500 focus:outline-none"
              aria-label="Medicine name"
            />
            <input
              value={m.dosage ?? ""}
              onChange={(e) => patch(i, (x) => ({ ...x, dosage: e.target.value, verified: true }))}
              placeholder={lang === "hi" ? "मात्रा" : "dose"}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-mono text-sky-300 focus:border-sky-500 focus:outline-none"
              aria-label="Dosage"
            />
          </div>

          {m.frequency && (
            <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
              <span>{lang === "hi" ? "पर्चे से:" : "From prescription:"} <span className="font-mono">{m.frequency}</span></span>
              {m.schedule.needsReview && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-950/60 px-1.5 py-0.5 font-semibold text-amber-300">
                  <AlertTriangle className="size-3" />
                  {lang === "hi" ? "समय की पुष्टि करें" : "confirm the timing"}
                </span>
              )}
            </div>
          )}

          <DoseGrid schedule={m.schedule} lang={lang} editable onToggle={(slot) => toggleSlot(i, slot)} />

          <div className="flex items-start gap-1.5 text-[11px] text-emerald-200">
            <Clock className="size-3.5 mt-0.5 shrink-0 text-emerald-400" />
            <span>{scheduleToText(m.schedule, lang)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Whether we're past hydration — lets us read localStorage in render without an SSR
// mismatch and without a setState-in-effect. Server + first client render → false.
function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

const doseKey = (med: string, slot: DoseSlot, date: string) => `swadhikaar:dose:${med}:${slot}:${date}`;
const todayKey = () => new Date().toISOString().slice(0, 10);

// Missed-dose tracking: tap a due slot to mark it taken today. Stored in localStorage
// (this device), so it lives on the patient's own phone, not the shared kiosk.
function DoseTracker({ medName, schedule, lang }: { medName: string; schedule: MedicationSchedule; lang: "en" | "hi" }) {
  const hydrated = useHydrated();
  const [, force] = useState(0);
  const date = todayKey();
  const due = DOSE_SLOTS.filter((s) => schedule.slots[s] > 0);
  if (!due.length || !hydrated) return null;

  const isTaken = (s: DoseSlot) => {
    try {
      return localStorage.getItem(doseKey(medName, s, date)) === "1";
    } catch {
      return false;
    }
  };
  const toggle = (s: DoseSlot) => {
    try {
      if (isTaken(s)) localStorage.removeItem(doseKey(medName, s, date));
      else localStorage.setItem(doseKey(medName, s, date), "1");
    } catch {
      /* storage may be blocked; the tap is best-effort */
    }
    force((x) => x + 1);
  };
  const done = due.filter(isTaken).length;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      {due.map((s) => {
        const Icon = SLOT_ICON[s];
        const on = isTaken(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              on
                ? "border-emerald-400 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                : "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {on ? <Check className="size-3" /> : <Icon className="size-3" />}
            {lang === "hi" ? SLOT_META[s].hi : SLOT_META[s].en}
          </button>
        );
      })}
      <span className="text-[10px] text-slate-400">
        {lang === "hi" ? `आज ${done}/${due.length} ली` : `${done}/${due.length} taken today`}
      </span>
    </div>
  );
}

/**
 * Read-only patient/caregiver plan: the confirmed schedule as pictograms + plain
 * language, with a Listen button (browser TTS, Hindi/English). Prefers an already-
 * verified `schedule` on the medicine; otherwise derives it from the stored
 * frequency — so patient/records renders the plan with no extra persistence.
 */
export function MedicationSchedulePlan({
  medications,
  lang = "hi",
  title,
  trackDoses = false,
}: {
  medications: (RawMedication & { schedule?: MedicationSchedule })[];
  lang?: "en" | "hi";
  title?: string;
  trackDoses?: boolean;
}) {
  const rows = (medications ?? []).map((m) => ({
    ...m,
    schedule: m.schedule ?? parseFrequency(m.frequency || ""),
  }));
  if (!rows.length) return null;

  const speakPlan = () => {
    const script = rows
      .map((r) => `${r.name}${r.dosage ? ", " + r.dosage : ""}. ${scheduleToText(r.schedule, lang)}.`)
      .join(" ");
    speak(script, lang);
  };

  const planText = () => {
    const heading = lang === "hi" ? "मेरी दवा अनुसूची (Swadhikaar)" : "My medication schedule (Swadhikaar)";
    const lines = rows.map(
      (r, i) => `${i + 1}. ${r.name}${r.dosage ? ` (${r.dosage})` : ""} — ${scheduleToText(r.schedule, lang)}`
    );
    const footer =
      lang === "hi"
        ? "यह केवल जानकारी है, चिकित्सा सलाह नहीं। दवा अपने डॉक्टर/फार्मासिस्ट से पुष्टि करें।"
        : "Information only, not medical advice. Please confirm with your doctor or pharmacist.";
    return [heading, "", ...lines, "", footer].join("\n");
  };

  const sharePlan = async () => {
    const text = planText();
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Medication schedule", text });
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        toast.success(lang === "hi" ? "अनुसूची कॉपी हो गई" : "Schedule copied to clipboard");
      }
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  };

  const downloadReminders = () => {
    const ics = buildMedicationICS(
      rows.map((r) => ({ name: r.name, dosage: r.dosage, duration_days: r.duration_days, schedule: r.schedule })),
      lang
    );
    try {
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "medication-reminders.ics";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(lang === "hi" ? "रिमाइंडर कैलेंडर डाउनलोड हुआ" : "Reminder calendar downloaded");
    } catch {
      /* download blocked; non-critical */
    }
  };

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wider font-mono text-slate-400">
          {title ?? (lang === "hi" ? "दवा अनुसूची" : "Medication Schedule")}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={speakPlan} className={btn}>
            <Volume2 className="size-3.5" />
            {lang === "hi" ? "सुनें" : "Listen"}
          </button>
          <button type="button" onClick={sharePlan} className={btn}>
            <Share2 className="size-3.5" />
            {lang === "hi" ? "साझा करें" : "Share"}
          </button>
          <button type="button" onClick={downloadReminders} className={btn}>
            <CalendarClock className="size-3.5" />
            {lang === "hi" ? "रिमाइंडर" : "Reminders"}
          </button>
        </div>
      </div>
      {rows.map((m, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200/80 bg-white p-2.5 space-y-1.5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-slate-900 dark:text-white">{m.name}</span>
            {m.dosage && <span className="text-sky-700 dark:text-sky-300 font-mono text-[11px]">{m.dosage}</span>}
          </div>
          <DoseGrid schedule={m.schedule} lang={lang} tone="light" />
          <div className="text-[11px] text-slate-600 dark:text-slate-400">{scheduleToText(m.schedule, lang)}</div>
          {trackDoses && <DoseTracker medName={m.name} schedule={m.schedule} lang={lang} />}
        </div>
      ))}
      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        {lang === "hi"
          ? "यह केवल जानकारी है, चिकित्सा सलाह नहीं। दवा अपने डॉक्टर/फार्मासिस्ट से पुष्टि करें।"
          : "Information only, not medical advice. Confirm with your doctor or pharmacist."}
      </p>
    </div>
  );
}




