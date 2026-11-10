/**
 * Care-need taxonomy for the PM-JAY finder. The official district files list
 * raw "Empanelled Specialities" that are inconsistent (misspelt "Opthalmology", and
 * procedure/test text like "Ct"/"Mri"/"Treatment Procedure ..." leaking into the
 * cell). So the patient never picks from the raw union — they pick a clean care-need,
 * and we match it against the raw strings by substring. Pure + testable.
 */

export interface CareNeed {
  id: string;
  en: string;
  hi: string;
  match: string[]; // lower-case substrings to look for in a hospital's specialities
}

export const CARE_NEEDS: CareNeed[] = [
  { id: "general_medicine", en: "General Medicine / Fever", hi: "सामान्य चिकित्सा / बुखार", match: ["general medicine"] },
  { id: "general_surgery", en: "General Surgery", hi: "सामान्य सर्जरी", match: ["general surgery", "unspecified surgical"] },
  { id: "cardiology", en: "Heart (Cardiology)", hi: "हृदय (कार्डियोलॉजी)", match: ["cardiology"] },
  { id: "obgyn", en: "Maternity / Gynaecology", hi: "प्रसूति / स्त्री रोग", match: ["obstetrics", "gynaec"] },
  { id: "ophthalmology", en: "Eye (Ophthalmology)", hi: "आँख (नेत्र रोग)", match: ["ophthalmol", "opthalmol"] },
  { id: "orthopaedics", en: "Bones / Joints (Orthopaedics)", hi: "हड्डी / जोड़", match: ["orthopaed", "joint replacement"] },
  { id: "paediatrics", en: "Child care (Paediatrics)", hi: "बाल चिकित्सा", match: ["paediatric", "neo-natal", "neo- natal", "neonatolog"] },
  { id: "ent", en: "Ear / Nose / Throat (ENT)", hi: "कान / नाक / गला", match: ["otorhinolaryng"] },
  { id: "urology", en: "Urology / Kidney", hi: "मूत्र रोग / गुर्दा", match: ["urology", "nephrolog"] },
  { id: "neuro", en: "Brain / Nerves (Neuro)", hi: "मस्तिष्क / तंत्रिका", match: ["neuro surgery", "neurolog"] },
  { id: "oncology", en: "Cancer (Oncology)", hi: "कैंसर", match: ["oncology"] },
  { id: "trauma", en: "Accident / Trauma / Burns", hi: "दुर्घटना / आघात / जलना", match: ["polytrauma", "burns"] },
  { id: "emergency", en: "Emergency", hi: "आपातकाल", match: ["emergency"] },
];

/** True if a hospital's raw specialities list covers the given care-need. */
export function matchesCareNeed(specialities: string[], careNeedId: string): boolean {
  const cn = CARE_NEEDS.find((c) => c.id === careNeedId);
  if (!cn) return true; // "any care" — no filter
  const hay = (specialities || []).map((s) => s.toLowerCase());
  return hay.some((s) => cn.match.some((m) => s.includes(m)));
}
