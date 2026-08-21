"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { TriangleAlert, CircleMinus, CircleCheck, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { onPendingChange } from "@/lib/offline/outbox";

// Design tokens for the field-worker surface. Kept local: globals.css is the
// shared neutral shadcn theme and is owned elsewhere.
export const ASHA = {
  bg: "#FAFAFA",
  text: "#0F172A",
  primary: "#10B981",
} as const;

// ---------------------------------------------------------------------------
// Bilingual label — Devanagari primary, English beneath at a smaller size.
// ---------------------------------------------------------------------------
export function Bi({
  hi,
  en,
  className,
  hiClass = "text-[17px] font-semibold leading-snug",
  enClass = "text-[14px] text-slate-500 leading-snug",
}: {
  hi: string;
  en: string;
  className?: string;
  hiClass?: string;
  enClass?: string;
}) {
  return (
    <span className={cn("block", className)}>
      <span className={cn("block", hiClass)} lang="hi">
        {hi}
      </span>
      <span className={cn("block", enClass)} lang="en">
        {en}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Risk pill — colour is never the only signal: each level has its own icon
// SHAPE (triangle / minus-circle / check-circle) plus a written label.
// ---------------------------------------------------------------------------
const RISK_STYLES = {
  High: {
    Icon: TriangleAlert,
    box: "bg-red-50 text-red-800 border-red-300",
    hi: "उच्च जोखिम",
    en: "High risk",
  },
  Moderate: {
    Icon: CircleMinus,
    box: "bg-amber-50 text-amber-900 border-amber-300",
    hi: "मध्यम जोखिम",
    en: "Moderate risk",
  },
  Low: {
    Icon: CircleCheck,
    box: "bg-emerald-50 text-emerald-800 border-emerald-300",
    hi: "कम जोखिम",
    en: "Low risk",
  },
} as const;

export type RiskKey = keyof typeof RISK_STYLES;

export function normaliseRisk(v?: string | null): RiskKey {
  const s = (v || "").toLowerCase();
  if (s.startsWith("high") || s.startsWith("critical") || s.startsWith("उच्च")) return "High";
  if (s.startsWith("mod") || s.startsWith("medium")) return "Moderate";
  return "Low";
}

export function RiskPill({
  level,
  size = "sm",
}: {
  level?: string | null;
  size?: "sm" | "lg";
}) {
  const key = normaliseRisk(level);
  const { Icon, box, hi, en } = RISK_STYLES[key];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border font-semibold",
        box,
        size === "lg" ? "px-4 py-2 text-[17px]" : "px-3 py-1.5 text-[14px]"
      )}
    >
      <Icon aria-hidden className={size === "lg" ? "size-6 shrink-0" : "size-4 shrink-0"} />
      <span lang="hi">{hi}</span>
      <span className="sr-only">{en}</span>
    </span>
  );
}

export function RiskBanner({ level, score }: { level: string; score: number }) {
  const key = normaliseRisk(level);
  const { Icon, box, hi, en } = RISK_STYLES[key];
  return (
    <div className={cn("rounded-2xl border-2 p-5", box)} role="status">
      <div className="flex items-start gap-4">
        <Icon aria-hidden className="size-12 shrink-0" strokeWidth={2.25} />
        <div>
          <p className="text-2xl font-bold leading-tight" lang="hi">
            {hi}
          </p>
          <p className="text-[15px] opacity-80" lang="en">
            {en}
          </p>
          <p className="mt-2 text-[16px] font-semibold tabular-nums">
            स्कोर / Score: {Math.round(score)} / 100
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connectivity indicator — PLACEHOLDER. Another agent ships the real chip;
// swap the body of this component and every screen picks it up.
// ---------------------------------------------------------------------------
export function ConnectivitySlot() {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    const off = onPendingChange(setQueued);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      off();
    };
  }, []);

  const Icon = online ? Wifi : WifiOff;
  return (
    <span
      data-slot="connectivity"
      className={cn(
        "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-[14px] font-medium",
        online
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-slate-300 bg-slate-100 text-slate-700"
      )}
    >
      <Icon aria-hidden className="size-4" />
      <span lang="hi">{online ? "ऑनलाइन" : "ऑफ़लाइन"}</span>
      {queued > 0 && (
        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[12px] text-white tabular-nums">
          {queued}
        </span>
      )}
      <span className="sr-only">
        {online ? "Online" : "Offline"}
        {queued > 0 ? `, ${queued} screenings waiting to sync` : ""}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------
export function Section({
  hi,
  en,
  children,
}: {
  hi: string;
  en: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="mb-4">
        <Bi hi={hi} en={en} hiClass="text-[19px] font-bold leading-snug" />
      </h2>
      {children}
    </section>
  );
}

/** Full-width primary action, sized for the bottom third / thumb reach. */
export function BigButton({
  hi,
  en,
  onClick,
  disabled,
  tone = "primary",
  type = "button",
  href,
}: {
  hi: string;
  en: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "primary" | "ghost";
  type?: "button" | "submit";
  href?: string;
}) {
  const cls = cn(
    "block w-full min-h-[64px] rounded-2xl px-5 py-3 text-left transition active:scale-[0.99]",
    "disabled:opacity-50 disabled:active:scale-100",
    tone === "primary"
      ? "bg-[#10B981] text-white shadow-sm hover:bg-[#0ea472]"
      : "border-2 border-slate-300 bg-white text-[#0F172A] hover:bg-slate-50"
  );
  const label = (
    <Bi
      hi={hi}
      en={en}
      hiClass="text-[20px] font-bold leading-snug"
      enClass={cn(
        "text-[14px] leading-snug",
        tone === "primary" ? "text-white/85" : "text-slate-500"
      )}
    />
  );

  if (href) {
    return (
      <Link href={href} className={cls}>
        {label}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Big tappable answer chips — no tiny <select> anywhere in the screening flow.
// ---------------------------------------------------------------------------
export type ChipOption = { value: string; hi: string; en: string };

export function ChipGroup({
  legendHi,
  legendEn,
  options,
  value,
  onChange,
}: {
  legendHi: string;
  legendEn: string;
  options: readonly ChipOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="mb-6 last:mb-0">
      <legend className="mb-2.5">
        <Bi hi={legendHi} en={legendEn} hiClass="text-[17px] font-semibold leading-snug" />
      </legend>
      <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label={legendEn}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={cn(
                "min-h-[52px] min-w-[96px] rounded-xl border-2 px-4 py-2 text-left",
                active
                  ? "border-[#10B981] bg-emerald-50 text-[#0F172A] ring-2 ring-[#10B981]/30"
                  : "border-slate-300 bg-white text-[#0F172A]"
              )}
            >
              <span className="flex items-center gap-2">
                {/* shape, not colour alone: selected answers carry a tick */}
                <span aria-hidden className="text-[16px] font-bold text-[#10B981]">
                  {active ? "✓" : " "}
                </span>
                <Bi
                  hi={o.hi}
                  en={o.en}
                  hiClass="text-[16px] font-semibold leading-snug"
                  enClass="text-[13px] text-slate-500 leading-snug"
                />
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Numeric field that brings up the phone keypad on Android. */
export function NumField({
  hi,
  en,
  value,
  onChange,
  unit,
  placeholder,
}: {
  hi: string;
  en: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <Bi hi={hi} en={en} hiClass="text-[16px] font-semibold leading-snug" className="mb-1.5" />
      <span className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          className="min-h-[56px] w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-[20px] font-semibold tabular-nums text-[#0F172A] focus:border-[#10B981] focus:outline-none"
        />
        {unit && <span className="w-14 shrink-0 text-[15px] text-slate-500">{unit}</span>}
      </span>
    </label>
  );
}

export function TextField({
  hi,
  en,
  value,
  onChange,
  inputMode = "text",
  required,
}: {
  hi: string;
  en: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "text" | "tel";
  required?: boolean;
}) {
  return (
    <label className="block">
      <Bi hi={hi} en={en} hiClass="text-[16px] font-semibold leading-snug" className="mb-1.5" />
      <input
        type={inputMode === "tel" ? "tel" : "text"}
        inputMode={inputMode}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[56px] w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-[18px] text-[#0F172A] focus:border-[#10B981] focus:outline-none"
      />
    </label>
  );
}
