import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAbdmFhirBundle } from "./bundle.ts";

test("buildAbdmFhirBundle produces a valid FHIR R4 document bundle", () => {
  const patient = {
    id: "pat-123",
    name: "Ram Kumar",
    phone: "9876543210",
    abha_id: "91-1234-5678-9012",
    gender: "male",
    dob: "1980-01-01",
    chronic_conditions: "Hypertension, Type 2 Diabetes",
    current_medications: "Metformin 500mg, Amlodipine 5mg",
    allergies: "Penicillin",
  };

  const session = {
    id: "sess-456",
    patient_id: "pat-123",
    language: "hindi",
    mode: "ayush",
    status: "interviewing",
    started_at: "2026-09-06T10:00:00Z",
    red_flag: true,
    red_flag_reason: "CRITICAL: Severe retrosternal chest pain",
  };

  const answers = [
    {
      section: "chief_complaint",
      item_code: "cc.main",
      question: "What is your main complaint?",
      answer_text: "Severe chest pain radiating to left arm",
      answer_value: "chest_pain",
    },
  ];

  const factors = [
    {
      factor: "prakriti",
      value: "pitta_kapha",
      detail: { prakriti: "pitta_kapha", dominant: "pitta" },
    },
    {
      factor: "ahara_shakti",
      value: "madhyama",
      detail: { digestion: "moderate" },
    },
  ];

  const entities = [
    {
      entity_type: "lab_result",
      name: "Fasting Blood Sugar",
      value: "168",
      unit: "mg/dL",
      ref_low: 70,
      ref_high: 100,
      out_of_range: true,
      coded_system: "loinc",
      coded_value: "1558-6",
    },
  ];

  const result = buildAbdmFhirBundle({
    patient,
    session,
    answers,
    factors,
    entities,
  });

  const { bundle, composition, resources } = result;

  // Assert Bundle shape
  assert.equal(bundle.resourceType, "Bundle");
  assert.equal(bundle.type, "document");
  assert.ok(Array.isArray(bundle.entry));
  assert.ok((bundle.entry as unknown[]).length >= 4);

  // Assert Entry 0 is Composition
  const entry0 = (bundle.entry as Array<{ resource: Record<string, unknown> }>)[0];
  assert.equal(entry0.resource.resourceType, "Composition");
  assert.equal(entry0.resource.id, composition.id);
  assert.equal(composition.status, "final");

  // Assert Patient
  const patientRes = resources.find((r) => r.resource_type === "Patient");
  assert.ok(patientRes);
  const fhirPat = patientRes.fhir_json;
  assert.equal(fhirPat.id, "pat-123");
  const idList = fhirPat.identifier as Array<{ system: string; value: string }>;
  assert.ok(idList.some((id) => id.system === "https://healthid.ndhm.gov.in" && id.value === "91-1234-5678-9012"));

  // Assert Encounter with red flag
  const encRes = resources.find((r) => r.resource_type === "Encounter");
  assert.ok(encRes);
  assert.equal(encRes.fhir_json.status, "finished");
  const priority = encRes.fhir_json.priority as Record<string, unknown>;
  assert.ok(priority);
  assert.equal(priority.text, "CRITICAL: Severe retrosternal chest pain");

  // Assert Conditions created for Hypertension & Diabetes
  const condRes = resources.filter((r) => r.resource_type === "Condition");
  assert.equal(condRes.length, 2);

  // Assert Allergies
  const algRes = resources.filter((r) => r.resource_type === "AllergyIntolerance");
  assert.equal(algRes.length, 1);

  // Assert Dashavidha Observations
  const ayushObs = resources.filter((r) => r.profile === "abdm_observation_ayush");
  assert.equal(ayushObs.length, 2);

  // Assert LOINC coded Lab Observation
  const labObs = resources.find((r) => r.profile === "abdm_observation_lab");
  assert.ok(labObs);
  assert.deepEqual(labObs.loinc_codes, ["1558-6"]);

  // Assert Bundle resource is included in output
  const bundleRes = resources.find((r) => r.resource_type === "Bundle");
  assert.ok(bundleRes);
});
