/**
 * Pure clinical summary builder for MediKiosk case sessions.
 *
 * Implements PS 3.3 Module C:
 * Dual rendering of one consultation summary:
 * 1. Clinician structured summary (SOAP format: HPI, PMH, Allergies, Dashavidha, Triage flags).
 * 2. Patient spoken readback text in their language confirming recorded complaints.
 */

export interface SummaryInput {
  session: {
    id: string;
    patient_id: string;
    language: string;
    mode: "allopathic" | "ayush" | string;
    status: string;
    started_at: string;
    red_flag?: boolean;
    red_flag_reason?: string | null;
  };
  patient: {
    id: string;
    name: string;
    phone?: string | null;
    abha_id?: string | null;
    gender?: string | null;
    dob?: string | null;
    chronic_conditions?: unknown;
    current_medications?: unknown;
    allergies?: unknown;
  };
  answers: Array<{
    section: string;
    item_code: string;
    question?: string | null;
    answer_text?: string | null;
    answer_value?: unknown;
  }>;
  factors?: Array<{
    factor: string;
    value?: string | null;
    detail?: unknown;
  }>;
  entities?: Array<{
    entity_type: string;
    name: string;
    value?: string | null;
    unit?: string | null;
    out_of_range?: boolean | null;
  }>;
}

export interface SummarySection {
  section: string;
  heading: string;
  body: string;
  items: Array<{
    code: string;
    question: string;
    answer: string;
  }>;
}

export interface BuiltSummary {
  sections: SummarySection[];
  clinician_text: string;
  patient_text: string;
}

const SECTION_TITLES: Record<string, { en: string; hi: string }> = {
  chief_complaint: { en: "Chief Complaint", hi: "मुख्य शिकायत" },
  hpi: { en: "History of Presenting Illness", hi: "वर्तमान बीमारी का इतिहास" },
  past_medical: { en: "Past Medical & Surgical History", hi: "पिछली बीमारियाँ" },
  drug_allergy: { en: "Drug History & Allergies", hi: "दवाइयाँ व एलर्जी" },
  family: { en: "Family History", hi: "पारिवारिक इतिहास" },
  personal: { en: "Personal History", hi: "व्यक्तिगत इतिहास" },
  ros: { en: "Review of Systems", hi: "शारीरिक तंत्र जाँच" },
  investigations: { en: "Prior Investigations & Lab Reports", hi: "पिछली जाँचें" },
};

export function buildCaseSummary(input: SummaryInput): BuiltSummary {
  const { session, patient, answers, factors = [], entities = [] } = input;
  const isHi = session.language === "hindi" || session.language === "hi";

  // Group answers by section
  const answerBySection = new Map<string, typeof answers>();
  for (const a of answers) {
    const list = answerBySection.get(a.section) ?? [];
    list.push(a);
    answerBySection.set(a.section, list);
  }

  const sections: SummarySection[] = [];
  const clinicianParagraphs: string[] = [];
  const patientPhrases: string[] = [];

  // Patient Header
  const patLine = `Patient: ${patient.name}${patient.gender ? ` (${patient.gender})` : ""}${patient.abha_id ? ` | ABHA: ${patient.abha_id}` : ""}`;
  clinicianParagraphs.push(patLine);
  clinicianParagraphs.push(`Consultation Mode: ${session.mode.toUpperCase()} OPD | Date: ${new Date(session.started_at).toLocaleDateString()}`);

  if (session.red_flag) {
    clinicianParagraphs.push(`*** CRITICAL ALERT ***\nRed Flag: ${session.red_flag_reason || "Urgent Clinical Triaging Required"}`);
  }

  // 1. Chief Complaint
  const ccList = answerBySection.get("chief_complaint") ?? [];
  const ccMain = ccList.find((a) => a.item_code === "cc.main")?.answer_text || "No chief complaint recorded";
  const ccDur = ccList.find((a) => a.item_code === "cc.duration")?.answer_text || "";

  const ccHeading = isHi ? SECTION_TITLES.chief_complaint.hi : SECTION_TITLES.chief_complaint.en;
  const ccBody = ccDur ? `${ccMain} (Duration: ${ccDur})` : ccMain;
  sections.push({
    section: "chief_complaint",
    heading: ccHeading,
    body: ccBody,
    items: ccList.map((a) => ({
      code: a.item_code,
      question: a.question || a.item_code,
      answer: a.answer_text || String(a.answer_value ?? ""),
    })),
  });

  clinicianParagraphs.push(`CHIEF COMPLAINT:\n- ${ccBody}`);
  if (isHi) {
    patientPhrases.push(`आपकी मुख्य शिकायत: ${ccMain}${ccDur ? ` (${ccDur} से)` : ""}।`);
  } else {
    patientPhrases.push(`Main complaint: ${ccMain}${ccDur ? ` for ${ccDur}` : ""}.`);
  }

  // 2. HPI
  const hpiList = answerBySection.get("hpi") ?? [];
  if (hpiList.length > 0) {
    const hpiItems = hpiList.map((a) => `${a.question || a.item_code}: ${a.answer_text || String(a.answer_value ?? "")}`);
    sections.push({
      section: "hpi",
      heading: isHi ? SECTION_TITLES.hpi.hi : SECTION_TITLES.hpi.en,
      body: hpiItems.join("; "),
      items: hpiList.map((a) => ({
        code: a.item_code,
        question: a.question || a.item_code,
        answer: a.answer_text || String(a.answer_value ?? ""),
      })),
    });
    clinicianParagraphs.push(`HISTORY OF PRESENT ILLNESS:\n${hpiItems.map((i) => `- ${i}`).join("\n")}`);
  }

  // 3. Past Medical & Chronic Conditions
  const pmList = answerBySection.get("past_medical") ?? [];
  const knownChronic = patient.chronic_conditions ? String(patient.chronic_conditions) : "";
  const pmItems = pmList.map((a) => `${a.question || a.item_code}: ${a.answer_text || String(a.answer_value ?? "")}`);
  if (knownChronic) pmItems.unshift(`Pre-existing conditions: ${knownChronic}`);

  if (pmItems.length > 0) {
    sections.push({
      section: "past_medical",
      heading: isHi ? SECTION_TITLES.past_medical.hi : SECTION_TITLES.past_medical.en,
      body: pmItems.join("; "),
      items: pmList.map((a) => ({
        code: a.item_code,
        question: a.question || a.item_code,
        answer: a.answer_text || String(a.answer_value ?? ""),
      })),
    });
    clinicianParagraphs.push(`PAST MEDICAL HISTORY:\n${pmItems.map((i) => `- ${i}`).join("\n")}`);
  }

  // 4. Drug Allergies & Medications
  const daList = answerBySection.get("drug_allergy") ?? [];
  const knownAllergies = patient.allergies ? String(patient.allergies) : "";
  const knownMeds = patient.current_medications ? String(patient.current_medications) : "";
  const daItems = daList.map((a) => `${a.question || a.item_code}: ${a.answer_text || String(a.answer_value ?? "")}`);
  if (knownAllergies) daItems.push(`Recorded Allergies: ${knownAllergies}`);
  if (knownMeds) daItems.push(`Active Medications: ${knownMeds}`);

  if (daItems.length > 0) {
    sections.push({
      section: "drug_allergy",
      heading: isHi ? SECTION_TITLES.drug_allergy.hi : SECTION_TITLES.drug_allergy.en,
      body: daItems.join("; "),
      items: daList.map((a) => ({
        code: a.item_code,
        question: a.question || a.item_code,
        answer: a.answer_text || String(a.answer_value ?? ""),
      })),
    });
    clinicianParagraphs.push(`MEDICATIONS & ALLERGIES:\n${daItems.map((i) => `- ${i}`).join("\n")}`);
  }

  // 5. Ayush Dashavidha Pariksha (if Ayush mode)
  if (session.mode === "ayush" && factors.length > 0) {
    const factorSummaries = factors.map((f) => `${f.factor.replace("_", " ").toUpperCase()}: ${f.value || "unspecified"}`);
    sections.push({
      section: "ayush_dashavidha",
      heading: isHi ? "दशविध परीक्षा निष्कर्ष" : "Dashavidha Pariksha (Ayush Assessment)",
      body: factorSummaries.join("; "),
      items: factors.map((f) => ({
        code: `dashavidha.${f.factor}`,
        question: `Factor ${f.factor}`,
        answer: f.value || "unspecified",
      })),
    });
    clinicianParagraphs.push(`DASHAVIDHA PARIKSHA (AYUSH ASSESSMENT):\n${factorSummaries.map((f) => `- ${f}`).join("\n")}`);
  }

  // 6. Digitised Documents & Lab Entities
  if (entities.length > 0) {
    const entityLines = entities.map((e) => `${e.entity_type.toUpperCase()}: ${e.name}${e.value ? ` (${e.value}${e.unit ? ` ${e.unit}` : ""})` : ""}${e.out_of_range ? " [ABNORMAL]" : ""}`);
    sections.push({
      section: "investigations",
      heading: isHi ? SECTION_TITLES.investigations.hi : SECTION_TITLES.investigations.en,
      body: entityLines.join("; "),
      items: entities.map((e) => ({
        code: `ocr.${e.entity_type}.${e.name}`,
        question: e.name,
        answer: `${e.value || ""} ${e.unit || ""}`.trim(),
      })),
    });
    clinicianParagraphs.push(`DOCUMENT OCR EXTRACTED FINDINGS:\n${entityLines.map((e) => `- ${e}`).join("\n")}`);
  }

  // Final Patient Readback text
  let patientText = "";
  if (isHi) {
    patientText = `नमस्ते ${patient.name} जी। आपके कियोस्क सत्र का विवरण:\n${patientPhrases.join("\n")}\nयह विवरण आपके ओपीडी डॉक्टर के पास भेज दिया गया है। कृपया परामर्श कक्ष में प्रतीक्षा करें।`;
  } else {
    patientText = `Hello ${patient.name}. Summary of your kiosk intake:\n${patientPhrases.join("\n")}\nThis summary has been dispatched to your attending doctor. Please proceed to the consultation room.`;
  }

  return {
    sections,
    clinician_text: clinicianParagraphs.join("\n\n"),
    patient_text: patientText,
  };
}
