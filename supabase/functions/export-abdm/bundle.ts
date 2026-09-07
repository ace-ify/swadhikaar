/**
 * ABDM NRCES-compliant FHIR R4 Document Bundle builder.
 *
 * Assembles a clinical case-taking session, patient record, answers,
 * and entities into a FHIR R4 Bundle (type: document) rooted in a Composition resource.
 * Conforms to ABDM OPConsultRecord specification.
 */

export interface PatientData {
  id: string;
  name: string;
  phone?: string | null;
  abha_id?: string | null;
  gender?: string | null;
  dob?: string | null;
  chronic_conditions?: unknown;
  current_medications?: unknown;
  allergies?: unknown;
}

export interface SessionData {
  id: string;
  patient_id: string;
  language: string;
  mode: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  red_flag?: boolean;
  red_flag_reason?: string | null;
}

export interface AnswerData {
  section: string;
  item_code: string;
  question?: string | null;
  answer_text?: string | null;
  answer_value?: unknown;
}

export interface FactorData {
  factor: string;
  value?: string | null;
  detail?: unknown;
}

export interface EntityData {
  entity_type: string;
  name: string;
  value?: string | null;
  unit?: string | null;
  ref_low?: number | null;
  ref_high?: number | null;
  out_of_range?: boolean | null;
  coded_system?: string | null;
  coded_value?: string | null;
}

export interface AssembledBundleResult {
  bundle: Record<string, unknown>;
  composition: Record<string, unknown>;
  resources: Array<{
    resource_type: string;
    profile: string;
    external_ref: string;
    fhir_json: Record<string, unknown>;
    snomed_codes: string[];
    loinc_codes: string[];
  }>;
}

function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter((s) => s.trim());
  if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function buildAbdmFhirBundle(args: {
  patient: PatientData;
  session?: SessionData | null;
  answers?: AnswerData[];
  factors?: FactorData[];
  entities?: EntityData[];
  exportedAt?: string;
}): AssembledBundleResult {
  const exportedAt = args.exportedAt ?? new Date().toISOString();
  const patient = args.patient;
  const session = args.session;
  const answers = args.answers ?? [];
  const factors = args.factors ?? [];
  const entities = args.entities ?? [];

  const sessionId = session?.id ?? `encounter-${Date.now()}`;
  const compositionId = `comp-${sessionId.slice(0, 8)}`;
  const bundleId = `bundle-${sessionId.slice(0, 8)}-${Date.now()}`;

  const generatedResources: AssembledBundleResult["resources"] = [];
  const bundleEntries: Array<{ fullUrl: string; resource: Record<string, unknown> }> = [];

  // 1. Patient Resource
  const fhirPatient: Record<string, unknown> = {
    resourceType: "Patient",
    id: patient.id,
    identifier: [
      ...(patient.abha_id
        ? [{
            system: "https://healthid.ndhm.gov.in",
            value: patient.abha_id,
            type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] },
          }]
        : []),
      ...(patient.phone
        ? [{
            system: "https://swadhikaar.in/phone",
            value: patient.phone,
          }]
        : []),
    ],
    name: [{ text: patient.name }],
    ...(patient.gender ? { gender: patient.gender.toLowerCase() } : {}),
    ...(patient.dob ? { birthDate: patient.dob } : {}),
  };

  generatedResources.push({
    resource_type: "Patient",
    profile: "abdm_patient",
    external_ref: patient.id,
    fhir_json: fhirPatient,
    snomed_codes: [],
    loinc_codes: [],
  });

  // 2. Encounter Resource
  const encounterId = `enc-${sessionId}`;
  const fhirEncounter: Record<string, unknown> = {
    resourceType: "Encounter",
    id: encounterId,
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    subject: { reference: `Patient/${patient.id}`, display: patient.name },
    period: {
      start: session?.started_at ?? exportedAt,
      end: session?.ended_at ?? exportedAt,
    },
    serviceType: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: session?.mode === "ayush" ? "401271004" : "11429006",
          display: session?.mode === "ayush" ? "Ayurvedic medicine" : "Consultation",
        },
      ],
    },
    ...(session?.red_flag
      ? {
          priority: {
            coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ActPriority", code: "EM", display: "Emergency" }],
            text: session.red_flag_reason ?? "Clinical Red Flag Escalation",
          },
        }
      : {}),
  };

  generatedResources.push({
    resource_type: "Encounter",
    profile: "abdm_encounter",
    external_ref: sessionId,
    fhir_json: fhirEncounter,
    snomed_codes: [session?.mode === "ayush" ? "401271004" : "11429006"],
    loinc_codes: [],
  });

  // 3. Conditions (from chronic_conditions and chief_complaint)
  const conditions = parseList(patient.chronic_conditions);
  const conditionRefs: Array<{ reference: string; display: string }> = [];

  for (let i = 0; i < conditions.length; i++) {
    const cName = conditions[i];
    const condId = `cond-${sessionId.slice(0, 8)}-${i}`;
    const fhirCondition: Record<string, unknown> = {
      resourceType: "Condition",
      id: condId,
      clinicalStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
      },
      verificationStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }],
      },
      category: [
        {
          coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "problem-list-item" }],
        },
      ],
      code: { text: cName },
      subject: { reference: `Patient/${patient.id}`, display: patient.name },
      recordedDate: exportedAt,
    };

    generatedResources.push({
      resource_type: "Condition",
      profile: "abdm_condition",
      external_ref: `${sessionId}-${i}`,
      fhir_json: fhirCondition,
      snomed_codes: [],
      loinc_codes: [],
    });
    conditionRefs.push({ reference: `Condition/${condId}`, display: cName });
  }

  // 4. Allergies
  const allergies = parseList(patient.allergies);
  const allergyRefs: Array<{ reference: string; display: string }> = [];

  for (let i = 0; i < allergies.length; i++) {
    const aName = allergies[i];
    const allergyId = `alg-${sessionId.slice(0, 8)}-${i}`;
    const fhirAllergy: Record<string, unknown> = {
      resourceType: "AllergyIntolerance",
      id: allergyId,
      clinicalStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }],
      },
      code: { text: aName },
      patient: { reference: `Patient/${patient.id}`, display: patient.name },
      recordedDate: exportedAt,
    };

    generatedResources.push({
      resource_type: "AllergyIntolerance",
      profile: "abdm_allergy_intolerance",
      external_ref: `${sessionId}-${i}`,
      fhir_json: fhirAllergy,
      snomed_codes: [],
      loinc_codes: [],
    });
    allergyRefs.push({ reference: `AllergyIntolerance/${allergyId}`, display: aName });
  }

  // 5. Medications (from current_medications and OCR entities)
  const medications = parseList(patient.current_medications);
  const medEntities = entities.filter((e) => e.entity_type === "medication");
  const allMeds = [...medications.map((m) => ({ name: m, value: null })), ...medEntities];
  const medRefs: Array<{ reference: string; display: string }> = [];

  for (let i = 0; i < allMeds.length; i++) {
    const med = allMeds[i];
    const medId = `med-${sessionId.slice(0, 8)}-${i}`;
    const fhirMed: Record<string, unknown> = {
      resourceType: "MedicationStatement",
      id: medId,
      status: "active",
      medicationCodeableConcept: { text: med.name },
      subject: { reference: `Patient/${patient.id}`, display: patient.name },
      dateAsserted: exportedAt,
      ...(med.value ? { dosage: [{ text: med.value }] } : {}),
    };

    generatedResources.push({
      resource_type: "MedicationStatement",
      profile: "abdm_medication_statement",
      external_ref: `${sessionId}-${i}`,
      fhir_json: fhirMed,
      snomed_codes: [],
      loinc_codes: [],
    });
    medRefs.push({ reference: `MedicationStatement/${medId}`, display: med.name });
  }

  // 6. Observations (from answers, factors, and lab entities)
  const observationRefs: Array<{ reference: string; display: string }> = [];

  // Answers observations
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    const obsId = `obs-ans-${sessionId.slice(0, 8)}-${i}`;
    const fhirObs: Record<string, unknown> = {
      resourceType: "Observation",
      id: obsId,
      status: "final",
      category: [
        {
          coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "exam" }],
        },
      ],
      code: {
        text: a.question || a.item_code,
        coding: [{ system: "https://swadhikaar.in/clinical/ontology", code: a.item_code }],
      },
      subject: { reference: `Patient/${patient.id}`, display: patient.name },
      valueString: a.answer_text ?? (typeof a.answer_value === "string" ? a.answer_value : JSON.stringify(a.answer_value)),
      effectiveDateTime: exportedAt,
    };

    generatedResources.push({
      resource_type: "Observation",
      profile: "abdm_observation_history",
      external_ref: `${sessionId}-ans-${a.item_code}`,
      fhir_json: fhirObs,
      snomed_codes: [],
      loinc_codes: [],
    });
    observationRefs.push({ reference: `Observation/${obsId}`, display: a.item_code });
  }

  // Ayush Dashavidha factors observations
  for (let i = 0; i < factors.length; i++) {
    const f = factors[i];
    const obsId = `obs-ayush-${sessionId.slice(0, 8)}-${i}`;
    const fhirObs: Record<string, unknown> = {
      resourceType: "Observation",
      id: obsId,
      status: "final",
      category: [
        {
          coding: [{ system: "https://swadhikaar.in/fhir/category", code: "ayush-dashavidha", display: "Dashavidha Pariksha" }],
        },
      ],
      code: {
        text: `Dashavidha Pariksha: ${f.factor}`,
        coding: [{ system: "https://swadhikaar.in/ayush/dashavidha", code: f.factor }],
      },
      subject: { reference: `Patient/${patient.id}`, display: patient.name },
      valueString: f.value ?? "",
      effectiveDateTime: exportedAt,
      ...(f.detail ? { note: [{ text: JSON.stringify(f.detail) }] } : {}),
    };

    generatedResources.push({
      resource_type: "Observation",
      profile: "abdm_observation_ayush",
      external_ref: `${sessionId}-factor-${f.factor}`,
      fhir_json: fhirObs,
      snomed_codes: [],
      loinc_codes: [],
    });
    observationRefs.push({ reference: `Observation/${obsId}`, display: f.factor });
  }

  // Lab entities observations
  const labEntities = entities.filter((e) => e.entity_type === "lab_result");
  for (let i = 0; i < labEntities.length; i++) {
    const l = labEntities[i];
    const obsId = `obs-lab-${sessionId.slice(0, 8)}-${i}`;
    const fhirObs: Record<string, unknown> = {
      resourceType: "Observation",
      id: obsId,
      status: "final",
      category: [
        {
          coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }],
        },
      ],
      code: {
        text: l.name,
        ...(l.coded_system === "loinc" && l.coded_value
          ? { coding: [{ system: "http://loinc.org", code: l.coded_value, display: l.name }] }
          : {}),
      },
      subject: { reference: `Patient/${patient.id}`, display: patient.name },
      valueString: l.unit ? `${l.value} ${l.unit}` : l.value,
      effectiveDateTime: exportedAt,
      ...(l.ref_low !== null || l.ref_high !== null
        ? {
            referenceRange: [
              {
                ...(l.ref_low !== null ? { low: { value: l.ref_low, unit: l.unit } } : {}),
                ...(l.ref_high !== null ? { high: { value: l.ref_high, unit: l.unit } } : {}),
              },
            ],
          }
        : {}),
      ...(l.out_of_range
        ? {
            interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "A", display: "Abnormal" }] }],
          }
        : {}),
    };

    generatedResources.push({
      resource_type: "Observation",
      profile: "abdm_observation_lab",
      external_ref: `${sessionId}-lab-${i}`,
      fhir_json: fhirObs,
      snomed_codes: [],
      loinc_codes: l.coded_system === "loinc" && l.coded_value ? [l.coded_value] : [],
    });
    observationRefs.push({ reference: `Observation/${obsId}`, display: l.name });
  }

  // 7. Composition Resource (Root Document Header)
  const sections: Array<{ title: string; code?: Record<string, unknown>; entry?: Array<{ reference: string }>; text?: { status: string; div: string } }> = [];

  if (conditionRefs.length > 0) {
    sections.push({
      title: "Medical Problems & Chief Complaints",
      code: { coding: [{ system: "http://snomed.info/sct", code: "439401001", display: "Diagnosis" }] },
      entry: conditionRefs.map((r) => ({ reference: r.reference })),
    });
  }

  if (medRefs.length > 0) {
    sections.push({
      title: "Current Medications",
      code: { coding: [{ system: "http://snomed.info/sct", code: "721912009", display: "Medication summary" }] },
      entry: medRefs.map((r) => ({ reference: r.reference })),
    });
  }

  if (allergyRefs.length > 0) {
    sections.push({
      title: "Allergies and Adverse Reactions",
      code: { coding: [{ system: "http://snomed.info/sct", code: "722446000", display: "Allergy record" }] },
      entry: allergyRefs.map((r) => ({ reference: r.reference })),
    });
  }

  if (observationRefs.length > 0) {
    sections.push({
      title: session?.mode === "ayush" ? "Clinical History & Dashavidha Pariksha" : "Clinical History & Physical Findings",
      code: { coding: [{ system: "http://snomed.info/sct", code: "422843007", display: "Diagnostic report" }] },
      entry: observationRefs.map((r) => ({ reference: r.reference })),
    });
  }

  const fhirComposition: Record<string, unknown> = {
    resourceType: "Composition",
    id: compositionId,
    status: "final",
    type: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "371530004",
          display: "Clinical consultation report",
        },
      ],
      text: "OPD Consultation & Case-Taking Record",
    },
    subject: { reference: `Patient/${patient.id}`, display: patient.name },
    encounter: { reference: `Encounter/${encounterId}` },
    date: exportedAt,
    author: [
      {
        display: "Swadhikaar MediKiosk & Clinical History Engine",
      },
    ],
    title: session?.mode === "ayush" ? "Ayush Case Taking & Dashavidha Consultation Record" : "Clinical Case Taking Consultation Record",
    section: sections,
  };

  generatedResources.push({
    resource_type: "Composition",
    profile: "abdm_op_consult_record",
    external_ref: sessionId,
    fhir_json: fhirComposition,
    snomed_codes: ["371530004"],
    loinc_codes: [],
  });

  // 8. Bundle (Document)
  // Entry 0 must be the Composition resource as per FHIR Document Bundle specifications
  bundleEntries.push({
    fullUrl: `urn:uuid:${compositionId}`,
    resource: fhirComposition,
  });
  bundleEntries.push({
    fullUrl: `urn:uuid:${patient.id}`,
    resource: fhirPatient,
  });
  bundleEntries.push({
    fullUrl: `urn:uuid:${encounterId}`,
    resource: fhirEncounter,
  });

  for (const r of generatedResources) {
    if (r.resource_type !== "Composition" && r.resource_type !== "Patient" && r.resource_type !== "Encounter") {
      bundleEntries.push({
        fullUrl: `urn:uuid:${r.fhir_json.id}`,
        resource: r.fhir_json,
      });
    }
  }

  const fhirBundle: Record<string, unknown> = {
    resourceType: "Bundle",
    id: bundleId,
    identifier: {
      system: "https://ndhm.gov.in/fhir/bundle",
      value: bundleId,
    },
    type: "document",
    timestamp: exportedAt,
    entry: bundleEntries,
  };

  generatedResources.push({
    resource_type: "Bundle",
    profile: "abdm_document_bundle",
    external_ref: sessionId,
    fhir_json: fhirBundle,
    snomed_codes: ["371530004"],
    loinc_codes: [],
  });

  return {
    bundle: fhirBundle,
    composition: fhirComposition,
    resources: generatedResources,
  };
}
