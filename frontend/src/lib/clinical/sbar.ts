/**
 * SBAR (Situation, Background, Assessment, Recommendation) Clinical Handoff Note
 * Formatted for 108 CAD ambulance paramedics, receiving emergency departments, and ABDM FHIR encounters.
 */

export interface SbarNote {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  generatedAt: string;
}

export function generateSbarHandoff({
  type,
  triage,
  victimName,
  lat,
  lng,
  symptoms = [],
  callerName,
}: {
  type: string;
  triage: "red" | "orange" | "yellow";
  victimName?: string;
  lat: number;
  lng: number;
  symptoms?: string[];
  callerName?: string;
}): SbarNote {
  const patientDesc = victimName || "Unidentified Citizen (Trauma / Acute)";
  const coordsDesc = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  let situation = `CRITICAL SOS: ${type.toUpperCase()} reported via citizen app. Triage Level: ${triage.toUpperCase()}. Location: ${coordsDesc}.`;
  let background = `Patient: ${patientDesc}. Reported by: ${callerName || "Bystander"}. Mobile geofence locked.`;
  let assessment = `Suspected high-acuity event (${type}). Primary symptoms noted: ${
    symptoms.length ? symptoms.join(", ") : "Acute distress, verbal reporting pending"
  }. Hemodynamic instability risk.`;
  let recommendation = `1. Immediate 108 ALS/BLS dispatch to ${coordsDesc}. 2. Continuous CPR/first-aid coaching in progress. 3. Pre-alert nearest Ayushman PM-JAY trauma center.`;

  if (type.toLowerCase().includes("cardiac") || type.toLowerCase().includes("chest pain")) {
    situation = `ACUTE CARDIAC SOS: ${type}. Triage RED. Immediate resuscitation window active.`;
    assessment = `Suspected Acute Coronary Syndrome / Cardiac Arrest. High risk of arrhythmia.`;
    recommendation = `1. Dispatch ALS unit with Defibrillator (AED). 2. Coach bystander on CPR (100-110 BPM metronome active). 3. Pre-notify Cath Lab.`;
  } else if (type.toLowerCase().includes("bleed") || type.toLowerCase().includes("accident")) {
    situation = `TRAUMA / HEMORRHAGE SOS: ${type}. Triage RED. Active blood loss.`;
    assessment = `Potential hypovolemic shock. Blunt force / penetrating trauma markers.`;
    recommendation = `1. Dispatch Trauma Unit with tourniquets & IV fluids. 2. Direct pressure instruction given. 3. Clear green corridor to district hospital.`;
  }

  return {
    situation,
    background,
    assessment,
    recommendation,
    generatedAt: new Date().toISOString(),
  };
}

