import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCaseSummary } from "./summary_builder.ts";

test("buildCaseSummary formats dual clinician and patient summaries correctly", () => {
  const input = {
    session: {
      id: "sess-001",
      patient_id: "pat-001",
      language: "hindi",
      mode: "ayush" as const,
      status: "ready",
      started_at: "2026-09-06T12:00:00Z",
      red_flag: true,
      red_flag_reason: "CRITICAL: Severe Chest Pain",
    },
    patient: {
      id: "pat-001",
      name: "Ram Kumar",
      phone: "9876543210",
      abha_id: "91-1234-5678-9012",
      chronic_conditions: "Hypertension",
      current_medications: "Amlodipine 5mg",
      allergies: "None",
    },
    answers: [
      {
        section: "chief_complaint",
        item_code: "cc.main",
        question: "What is your trouble?",
        answer_text: "Chest pain",
        answer_value: "chest_pain",
      },
      {
        section: "chief_complaint",
        item_code: "cc.duration",
        question: "Since when?",
        answer_text: "2 days",
        answer_value: "2_days",
      },
      {
        section: "hpi",
        item_code: "hpi.onset",
        question: "Sudden or gradual?",
        answer_text: "Sudden",
        answer_value: "sudden",
      },
    ],
    factors: [
      { factor: "prakriti", value: "pitta_kapha" },
      { factor: "ahara_shakti", value: "madhyama" },
    ],
    entities: [
      {
        entity_type: "medication",
        name: "Metformin",
        value: "500mg",
        unit: "tablet",
      },
    ],
  };

  const result = buildCaseSummary(input);

  assert.ok(result.sections.length >= 4);
  assert.ok(result.clinician_text.includes("CHIEF COMPLAINT:"));
  assert.ok(result.clinician_text.includes("Chest pain"));
  assert.ok(result.clinician_text.includes("CRITICAL ALERT"));
  assert.ok(result.clinician_text.includes("DASHAVIDHA PARIKSHA"));
  assert.ok(result.clinician_text.includes("Amlodipine 5mg"));
  assert.ok(result.patient_text.includes("राम कुमार") || result.patient_text.includes("Ram Kumar"));
  assert.ok(result.patient_text.includes("Chest pain"));

  const ccSec = result.sections.find((s) => s.section === "chief_complaint");
  assert.ok(ccSec);
  assert.equal(ccSec.items.length, 2);

  const ayushSec = result.sections.find((s) => s.section === "ayush_dashavidha");
  assert.ok(ayushSec);
  assert.equal(ayushSec.items.length, 2);
});
