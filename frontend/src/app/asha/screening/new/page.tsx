"use client";

import { useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Search, UserPlus } from "lucide-react";
import {
  Bi,
  BigButton,
  ChipGroup,
  NumField,
  RiskPill,
  Section,
  TextField,
  type ChipOption,
} from "@/components/asha/ui";
import {
  SYMPTOM_DEFAULTS,
  type ScreeningDraft,
  type SymptomAnswers,
} from "@/components/asha/risk";
import { saveDraft, useAshaProfile, useVillagePatients } from "@/hooks/use-asha";

// Chip values are the exact strings `risk-predict` compares against
// ("none" / "never" / "calm" / "active" / "balanced" mean no risk).
const SYMPTOM_QUESTIONS: {
  key: keyof SymptomAnswers;
  hi: string;
  en: string;
  options: readonly ChipOption[];
}[] = [
  {
    key: "chest_discomfort",
    hi: "सीने में दर्द या भारीपन?",
    en: "Chest pain or discomfort?",
    options: [
      { value: "none", hi: "नहीं", en: "None" },
      { value: "mild", hi: "थोड़ा", en: "Mild" },
      { value: "moderate", hi: "मध्यम", en: "Moderate" },
      { value: "severe", hi: "बहुत", en: "Severe" },
    ],
  },
  {
    key: "breathlessness",
    hi: "सांस फूलना?",
    en: "Breathlessness?",
    options: [
      { value: "none", hi: "नहीं", en: "None" },
      { value: "on_exertion", hi: "चलने पर", en: "On exertion" },
      { value: "at_rest", hi: "आराम में भी", en: "Even at rest" },
    ],
  },
  {
    key: "palpitations",
    hi: "दिल तेज़ धड़कना?",
    en: "Palpitations?",
    options: [
      { value: "none", hi: "नहीं", en: "None" },
      { value: "occasional", hi: "कभी-कभी", en: "Occasional" },
      { value: "frequent", hi: "बार-बार", en: "Frequent" },
    ],
  },
  {
    key: "fatigue_weakness",
    hi: "थकान या कमज़ोरी?",
    en: "Fatigue or weakness?",
    options: [
      { value: "none", hi: "नहीं", en: "None" },
      { value: "mild", hi: "थोड़ी", en: "Mild" },
      { value: "severe", hi: "बहुत", en: "Severe" },
    ],
  },
  {
    key: "dizziness_blackouts",
    hi: "चक्कर आना या बेहोशी?",
    en: "Dizziness or blackouts?",
    options: [
      { value: "never", hi: "कभी नहीं", en: "Never" },
      { value: "rarely", hi: "कभी-कभी", en: "Rarely" },
      { value: "often", hi: "अक्सर", en: "Often" },
    ],
  },
  {
    key: "sleep_duration",
    hi: "रोज़ कितनी नींद?",
    en: "Hours of sleep per night",
    options: [
      { value: "6-8", hi: "6–8 घंटे", en: "6-8 hours" },
      { value: "lt5", hi: "5 से कम", en: "Under 5" },
      { value: "gt8", hi: "8 से ज़्यादा", en: "Over 8" },
    ],
  },
  {
    key: "stress_anxiety",
    hi: "तनाव या घबराहट?",
    en: "Stress or anxiety?",
    options: [
      { value: "calm", hi: "शांत", en: "Calm" },
      { value: "stressed", hi: "तनाव में", en: "Stressed" },
      { value: "very_stressed", hi: "बहुत तनाव", en: "Very stressed" },
    ],
  },
  {
    key: "physical_inactivity",
    hi: "शारीरिक मेहनत?",
    en: "Physical activity",
    options: [
      { value: "active", hi: "रोज़ मेहनत", en: "Active daily" },
      { value: "somewhat_active", hi: "कुछ-कुछ", en: "Somewhat" },
      { value: "inactive", hi: "कम", en: "Inactive" },
    ],
  },
  {
    key: "diet_quality",
    hi: "खाना कैसा है?",
    en: "Diet quality",
    options: [
      { value: "balanced", hi: "संतुलित", en: "Balanced" },
      { value: "mixed", hi: "मिला-जुला", en: "Mixed" },
      { value: "poor", hi: "खराब", en: "Poor" },
    ],
  },
  {
    key: "family_history",
    hi: "परिवार में बीमारी?",
    en: "Family history",
    options: [
      { value: "none", hi: "नहीं", en: "None" },
      { value: "diabetes", hi: "शुगर", en: "Diabetes" },
      { value: "heart", hi: "दिल", en: "Heart disease" },
      { value: "hypertension", hi: "बीपी", en: "Hypertension" },
    ],
  },
];

const GENDERS: readonly ChipOption[] = [
  { value: "female", hi: "महिला", en: "Female" },
  { value: "male", hi: "पुरुष", en: "Male" },
  { value: "other", hi: "अन्य", en: "Other" },
];

const OCCUPATIONS: readonly ChipOption[] = [
  { value: "farmer", hi: "किसान", en: "Farmer" },
  { value: "farm_labour", hi: "खेत मज़दूर", en: "Farm labourer" },
  { value: "homemaker", hi: "गृहिणी", en: "Homemaker" },
  { value: "other", hi: "अन्य", en: "Other" },
];

const CROPS: readonly ChipOption[] = [
  { value: "", hi: "कोई नहीं", en: "None" },
  { value: "wheat", hi: "गेहूँ", en: "Wheat" },
  { value: "rice", hi: "धान", en: "Rice" },
  { value: "sugarcane", hi: "गन्ना", en: "Sugarcane" },
  { value: "maize", hi: "मक्का", en: "Maize" },
];

type Step = "who" | "symptoms" | "vitals";

function NewScreeningInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { village, district } = useAshaProfile();
  const { data: patients, loading } = useVillagePatients();

  const [step, setStep] = useState<Step>("who");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    params.get("patient")
  );
  const [registering, setRegistering] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("female");
  const [occupation, setOccupation] = useState("farmer");
  const [cropType, setCropType] = useState("");

  const [symptoms, setSymptoms] = useState<SymptomAnswers>({ ...SYMPTOM_DEFAULTS });
  const [sbp, setSbp] = useState("");
  const [dbp, setDbp] = useState("");
  const [hr, setHr] = useState("");
  const [glucose, setGlucose] = useState("");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [spo2, setSpo2] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) || (p.phone || "").includes(q)
    );
  }, [patients, search]);

  const selected = patients.find((p) => p.id === selectedId) ?? null;
  const whoReady = registering ? name.trim().length > 1 : Boolean(selected);

  function finish() {
    const num = (s: string) => {
      const n = Number(s);
      return s.trim() === "" || Number.isNaN(n) ? undefined : n;
    };
    const draftId = crypto.randomUUID();
    const draft: ScreeningDraft = {
      draftId,
      patientId: registering ? crypto.randomUUID() : selectedId!,
      isNewPatient: registering,
      name: registering ? name : selected?.name ?? "",
      phone: registering ? phone : selected?.phone ?? "",
      age,
      gender,
      occupation: registering ? occupation : selected?.occupation ?? "",
      crop_type: registering ? cropType : selected?.crop_type ?? "",
      village: registering ? village : selected?.village ?? village,
      district: registering ? district : selected?.district ?? district,
      symptoms,
      vitals: {
        systolic_bp: num(sbp),
        diastolic_bp: num(dbp),
        heart_rate: num(hr),
        blood_glucose: num(glucose),
        oxygen_saturation: num(spo2),
        weight: num(weight),
        height: num(height),
      },
      createdAt: new Date().toISOString(),
    };
    saveDraft(draft);
    router.push(`/asha/screening/${draftId}/result`);
  }

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="पीछे / Back"
          onClick={() =>
            step === "who"
              ? router.push("/asha/dashboard")
              : setStep(step === "vitals" ? "symptoms" : "who")
          }
          className="grid size-12 shrink-0 place-items-center rounded-xl border-2 border-slate-300 bg-white"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <div>
          <Bi
            hi="नई जांच"
            en="New screening"
            hiClass="text-[22px] font-bold leading-tight"
          />
        </div>
      </div>

      {/* step indicator: number + label, not colour alone */}
      <ol className="flex gap-2 text-[13px] font-semibold">
        {(["who", "symptoms", "vitals"] as Step[]).map((s, i) => (
          <li
            key={s}
            aria-current={step === s ? "step" : undefined}
            className={
              step === s
                ? "flex-1 rounded-lg border-2 border-[#10B981] bg-emerald-50 px-2 py-1.5 text-center"
                : "flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-slate-500"
            }
          >
            {i + 1}.{" "}
            {s === "who" ? "मरीज़" : s === "symptoms" ? "लक्षण" : "माप"}
          </li>
        ))}
      </ol>

      {step === "who" && (
        <Section hi="मरीज़ चुनें" en="Choose the patient">
          {!registering && (
            <>
              <label className="mb-4 block">
                <span className="sr-only">Search patients</span>
                <span className="flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-3">
                  <Search aria-hidden className="size-5 shrink-0 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="नाम या फ़ोन खोजें / Search"
                    className="min-h-[52px] w-full bg-transparent text-[17px] focus:outline-none"
                  />
                </span>
              </label>

              {loading && <p className="text-[15px] text-slate-500">लोड हो रहा है…</p>}

              <ul className="mb-4 space-y-2.5">
                {filtered.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      aria-pressed={selectedId === p.id}
                      className={
                        "flex min-h-[64px] w-full items-center gap-3 rounded-xl border-2 p-3 text-left " +
                        (selectedId === p.id
                          ? "border-[#10B981] bg-emerald-50"
                          : "border-slate-200 bg-white")
                      }
                    >
                      <span aria-hidden className="w-5 text-[18px] font-bold text-[#10B981]">
                        {selectedId === p.id ? "✓" : ""}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[17px] font-semibold">
                          {p.name}
                        </span>
                        <span className="block truncate text-[14px] text-slate-500">
                          {p.phone || "—"}
                        </span>
                      </span>
                      <RiskPill level={p.risk_level} />
                    </button>
                  </li>
                ))}
                {!loading && filtered.length === 0 && (
                  <li className="text-[15px] text-slate-600">
                    कोई मरीज़ नहीं मिला / No match. Register a new patient below.
                  </li>
                )}
              </ul>

              <button
                type="button"
                onClick={() => {
                  setRegistering(true);
                  setSelectedId(null);
                }}
                className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border-2 border-dashed border-slate-400 bg-white px-4"
              >
                <UserPlus aria-hidden className="size-5 shrink-0" />
                <Bi
                  hi="नया मरीज़ दर्ज करें"
                  en="Register a new patient"
                  hiClass="text-[17px] font-semibold leading-snug"
                />
              </button>
            </>
          )}

          {registering && (
            <div className="space-y-5">
              <TextField hi="पूरा नाम" en="Full name" value={name} onChange={setName} required />
              <TextField hi="फ़ोन नंबर" en="Phone number" value={phone} onChange={setPhone} inputMode="tel" />
              <NumField hi="उम्र" en="Age" value={age} onChange={setAge} unit="साल" />
              <ChipGroup
                legendHi="लिंग"
                legendEn="Gender"
                options={GENDERS}
                value={gender}
                onChange={setGender}
              />
              <ChipGroup
                legendHi="काम"
                legendEn="Occupation"
                options={OCCUPATIONS}
                value={occupation}
                onChange={setOccupation}
              />
              <ChipGroup
                legendHi="फ़सल"
                legendEn="Crop type"
                options={CROPS}
                value={cropType}
                onChange={setCropType}
              />
              <p className="text-[14px] text-slate-500">
                गाँव / Village: <span className="font-semibold">{village || "—"}</span>
              </p>
              <button
                type="button"
                onClick={() => setRegistering(false)}
                className="min-h-[48px] text-[15px] font-semibold underline"
              >
                वापस सूची पर जाएँ / Back to the list
              </button>
            </div>
          )}
        </Section>
      )}

      {step === "symptoms" && (
        <Section hi="लक्षण" en="Symptoms">
          {SYMPTOM_QUESTIONS.map((q) => (
            <ChipGroup
              key={q.key}
              legendHi={q.hi}
              legendEn={q.en}
              options={q.options}
              value={symptoms[q.key]}
              onChange={(v) => setSymptoms((s) => ({ ...s, [q.key]: v }))}
            />
          ))}
        </Section>
      )}

      {step === "vitals" && (
        <Section hi="माप" en="Vitals">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <NumField hi="ऊपर का बीपी" en="Systolic BP" value={sbp} onChange={setSbp} unit="mmHg" placeholder="120" />
              <NumField hi="नीचे का बीपी" en="Diastolic BP" value={dbp} onChange={setDbp} unit="mmHg" placeholder="80" />
            </div>
            <NumField hi="शुगर" en="Blood glucose" value={glucose} onChange={setGlucose} unit="mg/dL" placeholder="100" />
            <div className="grid grid-cols-2 gap-3">
              <NumField hi="वज़न" en="Weight" value={weight} onChange={setWeight} unit="kg" placeholder="60" />
              <NumField hi="लंबाई" en="Height" value={height} onChange={setHeight} unit="cm" placeholder="160" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumField hi="नाड़ी" en="Pulse" value={hr} onChange={setHr} unit="/min" placeholder="76" />
              <NumField hi="ऑक्सीजन" en="SpO2" value={spo2} onChange={setSpo2} unit="%" placeholder="97" />
            </div>
            <p className="text-[14px] text-slate-500">
              जो माप न लिया हो उसे खाली छोड़ दें।
              <br />
              Leave anything you did not measure blank.
            </p>
          </div>
        </Section>
      )}

      {/* primary action in the thumb zone */}
      <div className="fixed inset-x-0 bottom-[60px] z-10 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA] to-transparent px-4 pt-4 pb-3">
        <div className="mx-auto max-w-[430px]">
          {step === "who" && (
            <BigButton
              hi="आगे बढ़ें"
              en="Continue to symptoms"
              disabled={!whoReady}
              onClick={() => setStep("symptoms")}
            />
          )}
          {step === "symptoms" && (
            <BigButton hi="माप दर्ज करें" en="Continue to vitals" onClick={() => setStep("vitals")} />
          )}
          {step === "vitals" && (
            <BigButton hi="जोखिम देखें" en="See the risk result" onClick={finish} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function NewScreeningPage() {
  return (
    <Suspense fallback={<p className="p-4 text-[16px]">लोड हो रहा है…</p>}>
      <NewScreeningInner />
    </Suspense>
  );
}
