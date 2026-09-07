/**
 * The decisions case-session makes, with the network and the database kept out of them.
 *
 * WHY THIS FILE EXISTS: index.ts mixes URL handling, Supabase calls and decisions. The
 * decisions — which sections exist, what a malformed answer looks like, the Ayush
 * factor list — are where the silent failures live, and they are un-testable while
 * they sit inside a handler that imports Deno globals and makes HTTP calls. Every
 * function here is pure, so logic.test.ts can run them under `node --test` without
 * Deno, Deno.serve, or a database. If a helper ever needs one of those, it stays in
 * index.ts.
 */

export const SECTIONS: ReadonlySet<string> = new Set([
  "chief_complaint",
  "hpi",
  "past_medical",
  "drug_allergy",
  "family",
  "personal",
  "ros",
  "investigations",
]);

export const CONSENT_PURPOSES: ReadonlySet<string> = new Set([
  "collect_history",      // take and store the interview
  "digitise_documents",   // OCR the paper the patient brought
  "share_with_clinician", // show the summary to the treating doctor
  "link_abha",            // link the record to the ABHA PHR
  "share_with_abdm",      // push to the Health Information Exchange
]);

export const DASHAVIDHA_FACTORS: ReadonlySet<string> = new Set([
  "prakriti",
  "vikriti",
  "sara",
  "samhanana",
  "pramana",
  "satmya",
  "sattva",
  "ahara_shakti",
  "vyayama_shakti",
  "vaya",
]);

// The voice pipeline's language list (LANGUAGES in backend/voice_agent/agent.py).
export const LANGUAGES: ReadonlySet<string> = new Set([
  "hindi", "english", "bengali", "tamil", "telugu", "marathi", "gujarati",
  "kannada", "malayalam", "punjabi", "assamese", "urdu", "bhojpuri", "maithili",
]);

/** Free text a patient typed, trimmed and bounded. Null rather than "" for a blank. */
export function str(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length === 0 ? null : s.slice(0, max);
}

export function isKnownSection(s: string): boolean {
  return SECTIONS.has(s);
}

export function isKnownLanguage(s: string): boolean {
  return LANGUAGES.has(s.toLowerCase());
}

/**
 * Recover a section from an item code when the caller's section is unusable.
 * The voice agent's section field is free text; its item code is constrained by the
 * prompt outline. "hpi.onset" therefore recovers to "hpi", and an unrecognised prefix
 * returns null rather than a guess — guessable data in a clinical record is worse than
 * a dropped row with a logged warning.
 */
const SECTION_BY_PREFIX: Record<string, string> = {
  cc: "chief_complaint",
  hpi: "hpi",
  pm: "past_medical",
  da: "drug_allergy",
  fam: "family",
  per: "personal",
  ros: "ros",
  inv: "investigations",
};

export function sectionForCode(itemCode: string): string | null {
  const prefix = itemCode.split(".")[0];
  return SECTION_BY_PREFIX[prefix] ?? null;
}

export type AnswerRow = {
  session_id: string;
  section: string;
  item_code: string;
  question: string | null;
  answer_text: string | null;
  answer_value: unknown;
  source: "touch";
};

/**
 * Validate one batch of touch-path answers into insertable rows. Malformed rows are
 * dropped, not raised on: one bad row must not take the other nine answers of a
 * finished interview down with it.
 */
export function validateAnswerRows(
  answers: unknown[],
  sessionId: string = "",
  log: (msg: string, meta?: Record<string, unknown>) => void = () => {},
): AnswerRow[] {
  const out: AnswerRow[] = [];
  if (!Array.isArray(answers)) return out;

  for (const raw of answers) {
    const a = raw as Record<string, unknown>;
    const itemCode = str(a.item_code, 60);
    const section = (str(a.section, 40) ?? "").toLowerCase();
    if (!itemCode || !SECTIONS.has(section)) {
      log("answer: skipping malformed row", { item_code: itemCode, section });
      continue;
    }
    out.push({
      session_id: sessionId,
      section,
      item_code: itemCode,
      question: str(a.question, 400),
      answer_text: str(a.answer_text, 2000),
      // The normalised value, which is the point of the touch path: the ontology's
      // closed vocabulary reaches the database from here, where the client holds it.
      answer_value: a.answer_value ?? null,
      source: "touch",
    });
  }
  return out;
}

export type FactorRow = {
  session_id: string;
  factor: string;
  value: string | null;
  detail: unknown;
  source: "touch";
};

/** Same treatment for the ten Dashavidha factors. */
export function validateFactorRows(
  factors: unknown[],
  sessionId: string = "",
  log: (msg: string, meta?: Record<string, unknown>) => void = () => {},
): FactorRow[] {
  const out: FactorRow[] = [];
  if (!Array.isArray(factors)) return out;

  for (const raw of factors) {
    const f = raw as Record<string, unknown>;
    const factor = (str(f.factor, 30) ?? "").toLowerCase();
    if (!DASHAVIDHA_FACTORS.has(factor)) {
      log("answer: skipping unknown dashavidha factor", { factor });
      continue;
    }
    out.push({
      session_id: sessionId,
      factor,
      value: str(f.value, 60),
      detail: f.detail ?? null,
      source: "touch",
    });
  }
  return out;
}
