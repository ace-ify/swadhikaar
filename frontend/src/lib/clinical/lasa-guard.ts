/**
 * T8: LASA (Look-Alike Sound-Alike) Drug Safety Guard
 * 
 * Phonetic & string distance engine to catch high-risk medication mix-ups in real-time
 * during voice prescription dictation and pharmacy verification.
 */

export interface LasaMatch {
  candidate: string;
  collisionWith: string;
  similarity: number; // 0 to 1
  category: "HIGH_RISK" | "MODERATE_RISK";
  warning: string;
}

// Canonical high-risk LASA pairs observed frequently in Indian clinical settings
export const HIGH_RISK_LASA_PAIRS: Array<{ drug1: string; drug2: string; note: string }> = [
  { drug1: "Metformin", drug2: "Metronidazole", note: "Antidiabetic vs Antibiotic (Severe hypoglycemia vs infection risk)" },
  { drug1: "Cetirizine", drug2: "Cinnarizine", note: "Antihistamine vs Vestibular sedative" },
  { drug1: "Dopamine", drug2: "Dobutamine", note: "Inotropic vasopressor vs Inodilator (Cardiac crisis risk)" },
  { drug1: "Amlodipine", drug2: "Amitriptyline", note: "Antihypertensive vs Tricyclic Antidepressant" },
  { drug1: "Hydralazine", drug2: "Hydroxyzine", note: "Antihypertensive vs Antihistamine/Sedative" },
  { drug1: "Clonazepam", drug2: "Clobazam", note: "Benzodiazepine dosing difference" },
  { drug1: "Prednisone", drug2: "Prednisolone", note: "Active vs Prodrug steroid dosing" },
  { drug1: "Glipizide", drug2: "Glyburide", note: "Sulfonylurea duration risk" },
  { drug1: "Epinephrine", drug2: "Ephedrine", note: "10x potency divergence in anaphylaxis / shock" },
  { drug1: "Tramadol", drug2: "Trazodone", note: "Opioid analgesic vs Serotonergic antidepressant" },
];

/**
 * Levenshtein distance for string edit calculation
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = [];

  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[m][n];
}

/**
 * Evaluates whether a dictated or typed drug name collides with a known LASA pair
 */
export function checkLasaCollision(inputDrug: string): LasaMatch | null {
  if (!inputDrug || inputDrug.trim().length < 3) return null;
  const cleanInput = inputDrug.trim().toLowerCase();

  for (const pair of HIGH_RISK_LASA_PAIRS) {
    const d1 = pair.drug1.toLowerCase();
    const d2 = pair.drug2.toLowerCase();

    // Check similarity to either drug in pair
    const dist1 = levenshtein(cleanInput, d1);
    const dist2 = levenshtein(cleanInput, d2);

    const maxLen1 = Math.max(cleanInput.length, d1.length);
    const maxLen2 = Math.max(cleanInput.length, d2.length);

    const sim1 = 1 - dist1 / maxLen1;
    const sim2 = 1 - dist2 / maxLen2;

    if (sim1 >= 0.75 && sim1 < 1.0) {
      return {
        candidate: inputDrug,
        collisionWith: pair.drug1,
        similarity: Math.round(sim1 * 100),
        category: "HIGH_RISK",
        warning: `⚠️ LASA Collision Alert: Spoken name "${inputDrug}" closely sounds like "${pair.drug1}". Did you mean "${pair.drug2}"? (${pair.note})`,
      };
    }

    if (sim2 >= 0.75 && sim2 < 1.0) {
      return {
        candidate: inputDrug,
        collisionWith: pair.drug2,
        similarity: Math.round(sim2 * 100),
        category: "HIGH_RISK",
        warning: `⚠️ LASA Collision Alert: Spoken name "${inputDrug}" closely sounds like "${pair.drug2}". Did you mean "${pair.drug1}"? (${pair.note})`,
      };
    }
  }

  return null;
}

