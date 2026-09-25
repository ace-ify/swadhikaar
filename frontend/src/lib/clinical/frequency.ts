/**
 * parseFrequency — the PS-01 keystone. Turns a prescription's raw frequency/SIG
 * notation ("1-0-1", "BD", "TDS", "Once daily at bedtime (HS)", "SOS / As needed
 * for fever", "q8h") into a structured daily schedule the rest of PS-01 renders:
 * the timeline, pictograms, plain-language plan, voice readback and reminders all
 * consume this one shape.
 *
 * SAFETY (grounded in ISMP do-not-use list / USP <17>): the raw abbreviation is
 * INPUT only, never shown to the patient — scheduleToText emits explicit times
 * ("1 in the morning and 1 at night"), never "BD". India convention: OD = once
 * daily (omne in die), NOT "right eye". Anything we cannot confidently parse sets
 * needsReview so the human verification step catches it instead of guessing.
 *
 * Pure module: no React, no network. Self-check in frequency.test.ts (npm test).
 */

export type DoseSlot = "morning" | "afternoon" | "evening" | "night";

export const DOSE_SLOTS: DoseSlot[] = ["morning", "afternoon", "evening", "night"];

// ponytail: default clock times are a tuning knob, not a fact — clinics and
// patients differ. The schedule view lets the patient shift them; these are
// sane starting points, and `icon` names map to lucide-react for the pictograms.
export const SLOT_META: Record<
  DoseSlot,
  { en: string; hi: string; time: string; hour: number; icon: string }
> = {
  morning: { en: "Morning", hi: "सुबह", time: "8:00 AM", hour: 8, icon: "Sunrise" },
  afternoon: { en: "Afternoon", hi: "दोपहर", time: "2:00 PM", hour: 14, icon: "Sun" },
  evening: { en: "Evening", hi: "शाम", time: "6:00 PM", hour: 18, icon: "Sunset" },
  night: { en: "Night", hi: "रात", time: "9:00 PM", hour: 21, icon: "Moon" },
};

export interface MedicationSchedule {
  raw: string;
  slots: Record<DoseSlot, number>; // doses per slot (usually 0 or 1)
  timesPerDay: number; // total scheduled doses/day (0 when prn-only)
  prn: boolean; // "as needed" — no fixed time
  prnCondition?: string; // e.g. "fever"
  stat: boolean; // one dose immediately
  food?: "before" | "after"; // AC / PC
  intervalHours?: number; // qNh that doesn't map to named slots
  needsReview: boolean; // could not parse confidently -> human verify
}

const emptySlots = (): Record<DoseSlot, number> => ({
  morning: 0,
  afternoon: 0,
  evening: 0,
  night: 0,
});

function setSlots(sch: MedicationSchedule, slots: DoseSlot[]) {
  for (const k of slots) sch.slots[k] = 1;
  sch.timesPerDay = DOSE_SLOTS.reduce((t, k) => t + sch.slots[k], 0);
}

export function parseFrequency(raw: string): MedicationSchedule {
  const original = (raw ?? "").trim();
  const s = original.toLowerCase();
  const sch: MedicationSchedule = {
    raw: original,
    slots: emptySlots(),
    timesPerDay: 0,
    prn: false,
    stat: false,
    needsReview: false,
  };
  if (!s) {
    sch.needsReview = true;
    return sch;
  }

  // Food modifier (AC before / PC after). "on"/"om" deliberately excluded — they
  // collide with the English word "on" and are unsafe to infer.
  if (/\b(ac|before food|before meal|before meals|before breakfast|before lunch|before dinner|empty stomach|khali pet)\b/.test(s))
    sch.food = "before";
  else if (/\b(pc|after food|after meal|after meals|after breakfast|after lunch|after dinner|bhojan ke baad)\b/.test(s))
    sch.food = "after";

  // STAT — one dose now (placed in a concrete slot so it still shows on the timeline)
  if (/\b(stat|immediately|at once|abhi)\b/.test(s)) {
    sch.stat = true;
    setSlots(sch, ["morning"]);
    return sch;
  }

  // PRN / SOS / as-needed overrides any fixed timing
  if (/\b(prn|sos|as needed|as required|if required|when needed|when required|zaroorat)\b/.test(s) || s.includes("ज़रूरत")) {
    sch.prn = true;
    const m = s.match(/for ([a-z ]+?)(?:$|[.,;(]| max| upto| up to)/);
    if (m) sch.prnCondition = m[1].trim();
    return sch;
  }

  // Positional Indian notation: 1-0-1 (m-a-n) or 1-0-0-1 (m-a-e-n); "-" or "/"
  const pos = s.match(/(\d)\s*[-/]\s*(\d)\s*[-/]\s*(\d)(?:\s*[-/]\s*(\d))?/);
  if (pos) {
    const nums = [pos[1], pos[2], pos[3], pos[4]]
      .filter((x) => x !== undefined)
      .map(Number);
    if (nums.length === 4) {
      sch.slots.morning = nums[0];
      sch.slots.afternoon = nums[1];
      sch.slots.evening = nums[2];
      sch.slots.night = nums[3];
    } else {
      // 3-position = morning-afternoon-night, the common Indian form
      sch.slots.morning = nums[0];
      sch.slots.afternoon = nums[1];
      sch.slots.night = nums[2];
    }
    sch.timesPerDay = DOSE_SLOTS.reduce((t, k) => t + sch.slots[k], 0);
    if (sch.timesPerDay === 0) sch.needsReview = true;
    return sch;
  }

  // qNh — every N hours
  const q =
    s.match(/\bq\s*(\d{1,2})\s*h\b/) ||
    s.match(/\bevery\s+(\d{1,2})\s*(?:hours|hrs|hr|h)\b/) ||
    s.match(/\b(\d{1,2})\s*(?:hourly|hrly)\b/);
  if (q) {
    const n = Number(q[1]);
    if (n === 6) setSlots(sch, ["morning", "afternoon", "evening", "night"]);
    else if (n === 8) setSlots(sch, ["morning", "afternoon", "night"]);
    else if (n === 12) setSlots(sch, ["morning", "night"]);
    else if (n === 24) setSlots(sch, ["morning"]);
    else {
      sch.intervalHours = n;
      sch.timesPerDay = Math.max(1, Math.round(24 / n));
    }
    return sch;
  }

  // Time-of-day hints (place a once-daily dose). "on"/"om" excluded (see above).
  // morning is the default when no afternoon/evening/night hint is present.
  const night = /\b(night|bed\s?time|bedtime|hs|nocte|dinner|raat)\b/.test(s) || s.includes("रात");
  const evening = /\b(evening|sham)\b/.test(s) || s.includes("शाम");
  const afternoon = /\b(afternoon|noon|midday|lunch|dopahar)\b/.test(s) || s.includes("दोपहर");

  // Dose count from abbreviation / words (check 4 -> 1 so "twice daily" != once)
  let count = 0;
  if (/\b(qid|qds|four times|4 times)\b/.test(s)) count = 4;
  else if (/\b(tds|tid|thrice|three times|3 times)\b/.test(s)) count = 3;
  else if (/\b(bd|bid|twice|two times|2 times)\b/.test(s)) count = 2;
  else if (/\b(od|qd|once|one time|1 time|daily|hs|nocte|mane)\b/.test(s)) count = 1;

  if (count === 4) setSlots(sch, ["morning", "afternoon", "evening", "night"]);
  else if (count === 3) setSlots(sch, ["morning", "afternoon", "night"]);
  else if (count === 2) setSlots(sch, ["morning", "night"]);
  else if (count === 1) {
    const slot: DoseSlot = night ? "night" : evening ? "evening" : afternoon ? "afternoon" : "morning";
    setSlots(sch, [slot]);
  } else {
    sch.needsReview = true;
  }
  return sch;
}

const EN_PREP: Record<DoseSlot, string> = {
  morning: "in the morning",
  afternoon: "in the afternoon",
  evening: "in the evening",
  night: "at night",
};

function slotPhrase(slot: DoseSlot, n: number, hi: boolean): string {
  return hi ? `${SLOT_META[slot].hi} ${n}` : `${n} ${EN_PREP[slot]}`;
}

function joinList(parts: string[], hi: boolean): string {
  if (parts.length <= 1) return parts.join("");
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1).join(", ");
  return `${head} ${hi ? "और" : "and"} ${last}`;
}

/**
 * Plain-language rendering — the patient-facing string. Never contains a raw
 * abbreviation (ISMP safety): a schedule parsed from "BD" reads "1 in the morning
 * and 1 at night", not "BD".
 */
export function scheduleToText(sch: MedicationSchedule, lang: "en" | "hi" = "en"): string {
  const hi = lang === "hi";
  if (sch.needsReview)
    return hi
      ? "निर्देशानुसार — समय की पुष्टि डॉक्टर से करें"
      : "As directed — please confirm the timing with your doctor";

  const parts: string[] = [];
  if (sch.stat) parts.push(hi ? "अभी एक खुराक" : "One dose now");
  if (sch.prn) {
    let t = hi ? "ज़रूरत पड़ने पर" : "As needed";
    if (sch.prnCondition) t += hi ? ` (${sch.prnCondition}) के लिए` : ` for ${sch.prnCondition}`;
    parts.push(t);
  }
  if (sch.intervalHours) parts.push(hi ? `हर ${sch.intervalHours} घंटे में` : `Every ${sch.intervalHours} hours`);

  const slotParts: string[] = [];
  for (const slot of DOSE_SLOTS) {
    if (sch.slots[slot] > 0) slotParts.push(slotPhrase(slot, sch.slots[slot], hi));
  }
  if (slotParts.length) parts.push(joinList(slotParts, hi));

  if (!parts.length) return hi ? "निर्देशानुसार" : "As directed";
  let text = parts.join(hi ? "; " : "; ");
  if (sch.food) {
    const f =
      sch.food === "before"
        ? hi ? "भोजन से पहले" : "before food"
        : hi ? "भोजन के बाद" : "after food";
    text += ` (${f})`;
  }
  return text;
}

/**
 * Serialize a (possibly human-corrected) schedule back to a canonical frequency
 * string that ROUND-TRIPS through parseFrequency. This lets a verified schedule
 * persist in the existing text `frequency` column — no new schema. Only the fields
 * the verification UI can change (slots, food) must survive; prn/stat/interval are
 * preserved as their own tokens. Unparseable schedules keep their original raw text.
 */
export function scheduleToCanonicalFrequency(sch: MedicationSchedule): string {
  if (sch.stat) return "STAT";
  if (sch.prn) return sch.prnCondition ? `SOS for ${sch.prnCondition}` : "SOS";
  if (sch.intervalHours) return `q${sch.intervalHours}h`;
  const nums = DOSE_SLOTS.map((k) => sch.slots[k]);
  if (nums.every((n) => n === 0)) return sch.raw; // nothing to encode
  const positional = nums.join("-"); // morning-afternoon-evening-night (4-position)
  const food = sch.food === "before" ? " before food" : sch.food === "after" ? " after food" : "";
  return positional + food;
}

/**
 * Build an iCalendar (.ics) of daily medication reminders. The patient adds it to
 * their phone's calendar, which fires native daily alarms — a real reminder workflow
 * with no backend and no risk of auto-dialing anyone. One recurring VEVENT per
 * (medicine, active slot); as-needed/one-off doses are skipped.
 */
export interface IcsMed {
  name: string;
  dosage?: string;
  duration_days?: number;
  schedule: MedicationSchedule;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const icsDate = (d: Date) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
const escapeIcs = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

export function buildMedicationICS(meds: IcsMed[], lang: "en" | "hi" = "en"): string {
  const now = new Date();
  const stamp = `${icsDate(now)}T${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const today = icsDate(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Swadhikaar//Medication Schedule//EN",
    "CALSCALE:GREGORIAN",
  ];
  meds.forEach((m, mi) => {
    if (m.schedule.prn || m.schedule.stat) return; // not a daily recurring reminder
    const count = m.duration_days && m.duration_days > 0 ? m.duration_days : 30;
    for (const slot of DOSE_SLOTS) {
      if (m.schedule.slots[slot] <= 0) continue;
      const hour = SLOT_META[slot].hour;
      const summary =
        lang === "hi" ? `दवा: ${m.name}${m.dosage ? " " + m.dosage : ""}` : `Take ${m.name}${m.dosage ? " " + m.dosage : ""}`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:swadhikaar-${mi}-${slot}-${stamp}@swadhikaar.in`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${today}T${pad2(hour)}0000`,
        `RRULE:FREQ=DAILY;COUNT=${count}`,
        `SUMMARY:${escapeIcs(summary)}`,
        `DESCRIPTION:${escapeIcs(scheduleToText(m.schedule, lang))}`,
        "BEGIN:VALARM",
        "TRIGGER:PT0M",
        "ACTION:DISPLAY",
        "DESCRIPTION:Medicine reminder",
        "END:VALARM",
        "END:VEVENT"
      );
    }
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}





