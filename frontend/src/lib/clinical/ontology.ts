/**
 * The clinical history ontology. PS 3.3 Module A asks for "a dialogue manager bounded
 * by a clinical history ontology" — this is the bound. Without it an LLM asked to
 * "take a history" wanders, asks the same thing twice, and stops early; with it the
 * interview has a finite set of things it is trying to learn and can report how much
 * of the history it actually got.
 *
 * ONE COPY, HERE. The touch UI needs the full structure to render tap options, so it
 * lives in the frontend where that need is. The voice agent does not import it — it
 * gets a compact prose rendering in its system prompt, because an LLM does not need
 * sixty rows to be told "ask about onset, then character, then radiation". The summary
 * generator needs only SECTION_ORDER, eight strings, which is not duplication worth a
 * shared package.
 *
 * BILINGUAL, NOT MULTILINGUAL, and the difference is deliberate. Tap labels are Hindi
 * and English because those are the two a human wrote and checked. The VOICE path
 * covers all twelve languages the system speaks, because the LLM translates the prompt
 * at the point of asking. So a Bhojpuri speaker can complete the whole interview by
 * voice, and a Bhojpuri speaker who wants to tap reads Hindi. That is a real gap and it
 * is smaller than the alternative, which is machine-translated tap labels nobody has
 * read on a screen a patient uses to describe their symptoms.
 */

export const SECTION_ORDER = [
  "chief_complaint",
  "hpi",
  "past_medical",
  "drug_allergy",
  "family",
  "personal",
  "ros",
  "investigations",
] as const;

export type Section = (typeof SECTION_ORDER)[number];

/** Headings as they print on the clinician's summary, in PS 3.3 Module C's order. */
export const SECTION_HEADINGS: Record<Section, { en: string; hi: string }> = {
  chief_complaint: { en: "Chief complaint", hi: "मुख्य शिकायत" },
  hpi: { en: "History of presenting illness", hi: "वर्तमान बीमारी का विवरण" },
  past_medical: { en: "Past medical & surgical history", hi: "पिछली बीमारियाँ और ऑपरेशन" },
  drug_allergy: { en: "Drug history & allergies", hi: "दवाइयाँ और एलर्जी" },
  family: { en: "Family history", hi: "पारिवारिक इतिहास" },
  personal: { en: "Personal history", hi: "व्यक्तिगत इतिहास" },
  ros: { en: "Review of systems", hi: "शरीर के तंत्रों की जाँच" },
  investigations: { en: "Prior investigations", hi: "पिछली जाँचें" },
};

export type InputKind = "text" | "single" | "multi" | "number" | "duration" | "scale";

export type Choice = {
  value: string;
  label: { en: string; hi: string };
  /** Lucide icon name. PS 2.3 requires an icon-led UI for low-literacy users. */
  icon?: string;
};

export type OntologyItem = {
  code: string;
  section: Section;
  prompt: { en: string; hi: string };
  kind: InputKind;
  choices?: Choice[];
  unit?: string;
  /**
   * Adaptive branching. PS 3.3 asks the engine to "mirror physician reasoning" — a
   * doctor does not ask where the pain radiates to when the complaint is a rash. An
   * item with `when` is skipped unless the earlier answer matches.
   */
  when?: { code: string; equalsAny?: string[]; includesAny?: string[] };
  /** Ayush mode only, or allopathic only. Absent means asked in both. */
  modes?: ("allopathic" | "ayush")[];
  optional?: boolean;
};

const YES_NO_UNSURE: Choice[] = [
  { value: "yes", label: { en: "Yes", hi: "हाँ" }, icon: "Check" },
  { value: "no", label: { en: "No", hi: "नहीं" }, icon: "X" },
  { value: "unsure", label: { en: "Not sure", hi: "पता नहीं" }, icon: "HelpCircle" },
];

const GRADE_3: Choice[] = [
  { value: "pravara", label: { en: "Good / strong", hi: "उत्तम" } },
  { value: "madhyama", label: { en: "Moderate", hi: "मध्यम" } },
  { value: "avara", label: { en: "Poor / weak", hi: "अल्प" } },
];

export const ONTOLOGY: OntologyItem[] = [
  // ------------------------------------------------------------ chief complaint
  {
    code: "cc.main",
    section: "chief_complaint",
    kind: "text",
    prompt: {
      en: "What is troubling you today? Tell me in your own words.",
      hi: "आज आपको क्या तकलीफ़ है? अपने शब्दों में बताइए।",
    },
  },
  {
    code: "cc.duration",
    section: "chief_complaint",
    kind: "duration",
    prompt: { en: "Since when?", hi: "कब से?" },
    choices: [
      { value: "hours", label: { en: "A few hours", hi: "कुछ घंटे" }, icon: "Clock" },
      { value: "today", label: { en: "Since today", hi: "आज से" }, icon: "Sun" },
      { value: "days", label: { en: "A few days", hi: "कुछ दिन" }, icon: "Calendar" },
      { value: "weeks", label: { en: "A few weeks", hi: "कुछ हफ़्ते" }, icon: "CalendarDays" },
      { value: "months", label: { en: "Months", hi: "महीनों से" }, icon: "CalendarRange" },
      { value: "years", label: { en: "Years", hi: "सालों से" }, icon: "History" },
    ],
  },

  // ------------------------------------------------------------------ HPI, SOCRATES
  // PS 3.3 names SOCRATES explicitly for the chest-pain example. All eight letters are
  // here; `when` keeps the pain-only ones off a patient who came about a rash.
  {
    code: "hpi.site",
    section: "hpi",
    kind: "multi",
    prompt: { en: "Where in the body?", hi: "शरीर में कहाँ?" },
    choices: [
      { value: "head", label: { en: "Head", hi: "सिर" }, icon: "Brain" },
      { value: "chest", label: { en: "Chest", hi: "छाती" }, icon: "HeartPulse" },
      { value: "abdomen", label: { en: "Stomach", hi: "पेट" }, icon: "Circle" },
      { value: "back", label: { en: "Back", hi: "कमर / पीठ" }, icon: "MoveVertical" },
      { value: "limbs", label: { en: "Arms or legs", hi: "हाथ या पैर" }, icon: "PersonStanding" },
      { value: "throat", label: { en: "Throat", hi: "गला" }, icon: "Mic" },
      { value: "whole_body", label: { en: "All over", hi: "पूरे शरीर में" }, icon: "Maximize" },
      { value: "other", label: { en: "Somewhere else", hi: "कहीं और" }, icon: "MoreHorizontal" },
    ],
  },
  {
    code: "hpi.onset",
    section: "hpi",
    kind: "single",
    prompt: { en: "Did it start suddenly or slowly?", hi: "यह अचानक शुरू हुआ या धीरे-धीरे?" },
    choices: [
      { value: "sudden", label: { en: "All at once", hi: "एकदम अचानक" }, icon: "Zap" },
      { value: "gradual", label: { en: "Slowly, over time", hi: "धीरे-धीरे" }, icon: "TrendingUp" },
      { value: "unsure", label: { en: "Not sure", hi: "पता नहीं" }, icon: "HelpCircle" },
    ],
  },
  {
    code: "hpi.character",
    section: "hpi",
    kind: "single",
    prompt: { en: "What does it feel like?", hi: "कैसा महसूस होता है?" },
    choices: [
      { value: "pressure", label: { en: "Heavy, pressing", hi: "भारी, दबाव जैसा" }, icon: "Weight" },
      { value: "burning", label: { en: "Burning", hi: "जलन" }, icon: "Flame" },
      { value: "stabbing", label: { en: "Sharp, stabbing", hi: "तेज़, चुभने जैसा" }, icon: "Zap" },
      { value: "cramping", label: { en: "Cramping", hi: "मरोड़" }, icon: "Waves" },
      { value: "dull", label: { en: "Dull ache", hi: "हल्का दर्द" }, icon: "Minus" },
      { value: "itching", label: { en: "Itching", hi: "खुजली" }, icon: "Hand" },
      { value: "other", label: { en: "Something else", hi: "कुछ और" }, icon: "MoreHorizontal" },
    ],
  },
  {
    code: "hpi.radiation",
    section: "hpi",
    kind: "multi",
    prompt: { en: "Does it move anywhere else?", hi: "क्या यह कहीं और फैलता है?" },
    when: { code: "hpi.site", includesAny: ["chest", "abdomen", "back", "head"] },
    choices: [
      { value: "none", label: { en: "Stays in one place", hi: "एक ही जगह रहता है" }, icon: "Pin" },
      { value: "left_arm", label: { en: "Left arm", hi: "बाएँ हाथ में" }, icon: "ArrowLeft" },
      { value: "jaw", label: { en: "Jaw or neck", hi: "जबड़े या गर्दन में" }, icon: "ArrowUp" },
      { value: "back", label: { en: "To the back", hi: "पीठ की ओर" }, icon: "ArrowRight" },
      { value: "leg", label: { en: "Down the leg", hi: "पैर की ओर" }, icon: "ArrowDown" },
      { value: "groin", label: { en: "To the groin", hi: "जाँघ की ओर" }, icon: "ArrowDownLeft" },
    ],
  },
  {
    code: "hpi.associated",
    section: "hpi",
    kind: "multi",
    prompt: {
      en: "Is anything else happening along with it?",
      hi: "इसके साथ और कुछ हो रहा है?",
    },
    choices: [
      { value: "breathless", label: { en: "Hard to breathe", hi: "साँस लेने में तकलीफ़" }, icon: "Wind" },
      { value: "sweating", label: { en: "Cold sweating", hi: "ठंडा पसीना" }, icon: "Droplets" },
      { value: "vomiting", label: { en: "Vomiting", hi: "उल्टी" }, icon: "ArrowDownCircle" },
      { value: "fever", label: { en: "Fever", hi: "बुखार" }, icon: "Thermometer" },
      { value: "dizzy", label: { en: "Dizzy or faint", hi: "चक्कर या बेहोशी" }, icon: "RotateCw" },
      { value: "palpitations", label: { en: "Heart racing", hi: "दिल तेज़ धड़कना" }, icon: "Activity" },
      { value: "weakness_one_side", label: { en: "Weak on one side", hi: "एक तरफ़ कमज़ोरी" }, icon: "UserX" },
      { value: "speech_trouble", label: { en: "Trouble speaking", hi: "बोलने में दिक्कत" }, icon: "MessageSquareOff" },
      { value: "none", label: { en: "Nothing else", hi: "और कुछ नहीं" }, icon: "Check" },
    ],
  },
  {
    code: "hpi.timing",
    section: "hpi",
    kind: "single",
    prompt: { en: "Is it there all the time, or does it come and go?", hi: "यह हमेशा रहता है या आता-जाता है?" },
    choices: [
      { value: "constant", label: { en: "All the time", hi: "हमेशा" }, icon: "Infinity" },
      { value: "intermittent", label: { en: "Comes and goes", hi: "आता-जाता है" }, icon: "Repeat" },
      { value: "worsening", label: { en: "Getting worse", hi: "बढ़ रहा है" }, icon: "TrendingUp" },
      { value: "improving", label: { en: "Getting better", hi: "कम हो रहा है" }, icon: "TrendingDown" },
    ],
  },
  {
    code: "hpi.exacerbating",
    section: "hpi",
    kind: "multi",
    prompt: { en: "What makes it worse or better?", hi: "किससे बढ़ता है या कम होता है?" },
    choices: [
      { value: "exertion", label: { en: "Worse on walking or effort", hi: "चलने या मेहनत पर बढ़ता है" }, icon: "Footprints" },
      { value: "rest", label: { en: "Better with rest", hi: "आराम से कम होता है" }, icon: "Bed" },
      { value: "food", label: { en: "Related to food", hi: "खाने से संबंधित" }, icon: "Utensils" },
      { value: "position", label: { en: "Depends on position", hi: "लेटने-बैठने पर बदलता है" }, icon: "MoveVertical" },
      { value: "medicine", label: { en: "Better with medicine", hi: "दवा से कम होता है" }, icon: "Pill" },
      { value: "nothing", label: { en: "Nothing changes it", hi: "किसी चीज़ से फ़र्क नहीं" }, icon: "Ban" },
    ],
  },
  {
    code: "hpi.severity",
    section: "hpi",
    kind: "scale",
    prompt: {
      en: "How bad is it, from 1 to 10?",
      hi: "एक से दस में, कितनी तकलीफ़ है?",
    },
  },

  // ------------------------------------------------------- past medical & surgical
  {
    code: "pm.conditions",
    section: "past_medical",
    kind: "multi",
    prompt: {
      en: "Has a doctor ever told you that you have any of these?",
      hi: "क्या डॉक्टर ने कभी इनमें से कोई बीमारी बताई है?",
    },
    choices: [
      { value: "diabetes", label: { en: "Diabetes / sugar", hi: "मधुमेह / शुगर" }, icon: "Candy" },
      { value: "hypertension", label: { en: "High blood pressure", hi: "उच्च रक्तचाप / बीपी" }, icon: "Gauge" },
      { value: "heart_disease", label: { en: "Heart problem", hi: "दिल की बीमारी" }, icon: "Heart" },
      { value: "stroke", label: { en: "Paralysis / stroke", hi: "लकवा" }, icon: "Brain" },
      { value: "tb", label: { en: "Tuberculosis / TB", hi: "टीबी" }, icon: "Lungs" },
      { value: "asthma", label: { en: "Asthma", hi: "दमा" }, icon: "Wind" },
      { value: "thyroid", label: { en: "Thyroid", hi: "थायरॉइड" }, icon: "Activity" },
      { value: "kidney", label: { en: "Kidney disease", hi: "गुर्दे की बीमारी" }, icon: "Bean" },
      { value: "liver", label: { en: "Liver / jaundice", hi: "जिगर / पीलिया" }, icon: "Droplet" },
      { value: "epilepsy", label: { en: "Fits", hi: "मिर्गी / दौरे" }, icon: "Zap" },
      { value: "cancer", label: { en: "Cancer", hi: "कैंसर" }, icon: "Ribbon" },
      { value: "none", label: { en: "None of these", hi: "इनमें से कोई नहीं" }, icon: "Check" },
    ],
  },
  {
    code: "pm.duration_known",
    section: "past_medical",
    kind: "text",
    prompt: { en: "For how long, and on what treatment?", hi: "कितने समय से, और क्या इलाज चल रहा है?" },
    when: { code: "pm.conditions", includesAny: ["diabetes", "hypertension", "heart_disease", "tb", "asthma", "thyroid", "kidney", "liver", "epilepsy", "cancer"] },
  },
  {
    code: "pm.surgeries",
    section: "past_medical",
    kind: "text",
    prompt: { en: "Any operations in the past?", hi: "कभी कोई ऑपरेशन हुआ है?" },
  },
  {
    code: "pm.admissions",
    section: "past_medical",
    kind: "single",
    prompt: { en: "Have you been admitted to hospital before?", hi: "पहले कभी अस्पताल में भर्ती हुए हैं?" },
    choices: YES_NO_UNSURE,
  },

  // ------------------------------------------------------------ drugs and allergies
  {
    code: "da.current_meds",
    section: "drug_allergy",
    kind: "text",
    prompt: {
      en: "Which medicines are you taking now? You can also scan the strips later.",
      hi: "अभी कौन-कौन सी दवाइयाँ ले रहे हैं? आप बाद में पत्ते भी स्कैन कर सकते हैं।",
    },
  },
  {
    code: "da.adherence",
    section: "drug_allergy",
    kind: "single",
    prompt: { en: "Do you take them every day as told?", hi: "क्या रोज़ बताए अनुसार लेते हैं?" },
    when: { code: "da.current_meds" },
    choices: [
      { value: "regular", label: { en: "Every day", hi: "रोज़" }, icon: "CalendarCheck" },
      { value: "sometimes", label: { en: "Sometimes I miss", hi: "कभी-कभी छूट जाती है" }, icon: "CalendarX" },
      { value: "stopped", label: { en: "I stopped taking them", hi: "बंद कर दी हैं" }, icon: "Ban" },
    ],
  },
  {
    code: "da.allergies",
    section: "drug_allergy",
    kind: "multi",
    prompt: {
      en: "Has any medicine ever caused a rash, swelling or breathing trouble?",
      hi: "किसी दवा से कभी चकत्ते, सूजन या साँस की तकलीफ़ हुई है?",
    },
    choices: [
      { value: "penicillin", label: { en: "Penicillin / amoxicillin", hi: "पेनिसिलिन / एमोक्सिसिलिन" }, icon: "Pill" },
      { value: "sulfa", label: { en: "Sulpha drugs", hi: "सल्फा दवाएँ" }, icon: "Pill" },
      { value: "nsaid", label: { en: "Painkillers", hi: "दर्द की दवाएँ" }, icon: "Pill" },
      { value: "other_drug", label: { en: "Some other medicine", hi: "कोई और दवा" }, icon: "HelpCircle" },
      { value: "food", label: { en: "A food", hi: "कोई खाना" }, icon: "Utensils" },
      { value: "none", label: { en: "Never happened", hi: "कभी नहीं हुआ" }, icon: "Check" },
    ],
  },

  // ------------------------------------------------------------------------ family
  {
    code: "fam.conditions",
    section: "family",
    kind: "multi",
    prompt: {
      en: "Does anyone in your family have these?",
      hi: "आपके परिवार में किसी को ये बीमारियाँ हैं?",
    },
    choices: [
      { value: "diabetes", label: { en: "Diabetes", hi: "मधुमेह" }, icon: "Candy" },
      { value: "hypertension", label: { en: "High BP", hi: "उच्च रक्तचाप" }, icon: "Gauge" },
      { value: "heart_disease", label: { en: "Heart problem", hi: "दिल की बीमारी" }, icon: "Heart" },
      { value: "stroke", label: { en: "Paralysis", hi: "लकवा" }, icon: "Brain" },
      { value: "tb", label: { en: "TB", hi: "टीबी" }, icon: "Lungs" },
      { value: "cancer", label: { en: "Cancer", hi: "कैंसर" }, icon: "Ribbon" },
      { value: "none", label: { en: "None", hi: "कोई नहीं" }, icon: "Check" },
    ],
  },
  {
    code: "fam.who",
    section: "family",
    kind: "text",
    prompt: { en: "Who in the family?", hi: "परिवार में किसे?" },
    when: { code: "fam.conditions", includesAny: ["diabetes", "hypertension", "heart_disease", "stroke", "tb", "cancer"] },
  },

  // ---------------------------------------------------------------------- personal
  // Ahara-Vihara lives here. PS 3.3 asks for it in the same breath as the ten
  // Dashavidha factors, but it is not one of them, so it is a history section rather
  // than an eleventh row in dashavidha_assessments pretending to be a Pariksha factor.
  {
    code: "per.tobacco",
    section: "personal",
    kind: "single",
    prompt: { en: "Do you use tobacco, in any form?", hi: "तंबाकू किसी भी रूप में लेते हैं?" },
    choices: [
      { value: "never", label: { en: "Never", hi: "कभी नहीं" }, icon: "Check" },
      { value: "smoking", label: { en: "Smoking", hi: "बीड़ी / सिगरेट" }, icon: "Cigarette" },
      { value: "chewing", label: { en: "Chewing / khaini", hi: "खैनी / गुटखा" }, icon: "Leaf" },
      { value: "both", label: { en: "Both", hi: "दोनों" }, icon: "Layers" },
      { value: "quit", label: { en: "I stopped", hi: "छोड़ दिया" }, icon: "CircleSlash" },
    ],
  },
  {
    code: "per.alcohol",
    section: "personal",
    kind: "single",
    prompt: { en: "Do you drink alcohol?", hi: "शराब पीते हैं?" },
    choices: [
      { value: "never", label: { en: "Never", hi: "कभी नहीं" }, icon: "Check" },
      { value: "occasional", label: { en: "Occasionally", hi: "कभी-कभी" }, icon: "Wine" },
      { value: "regular", label: { en: "Regularly", hi: "नियमित" }, icon: "Wine" },
      { value: "quit", label: { en: "I stopped", hi: "छोड़ दी" }, icon: "CircleSlash" },
    ],
  },
  {
    code: "per.diet",
    section: "personal",
    kind: "single",
    prompt: { en: "What is your usual food?", hi: "आपका आहार कैसा है?" },
    choices: [
      { value: "vegetarian", label: { en: "Vegetarian", hi: "शाकाहारी" }, icon: "Salad" },
      { value: "mixed", label: { en: "Mixed", hi: "मिश्रित" }, icon: "Utensils" },
      { value: "mostly_nonveg", label: { en: "Mostly non-vegetarian", hi: "ज़्यादातर मांसाहारी" }, icon: "Drumstick" },
    ],
  },
  {
    code: "per.meal_timing",
    section: "personal",
    kind: "single",
    prompt: { en: "Are your meals at regular times?", hi: "खाना समय पर खाते हैं?" },
    modes: ["ayush"],
    choices: [
      { value: "regular", label: { en: "Regular times", hi: "नियमित समय पर" }, icon: "Clock" },
      { value: "irregular", label: { en: "Irregular", hi: "अनियमित" }, icon: "AlarmClockOff" },
      { value: "skips", label: { en: "I often skip meals", hi: "अक्सर छोड़ देता हूँ" }, icon: "Ban" },
    ],
  },
  {
    code: "per.bowel",
    section: "personal",
    kind: "single",
    prompt: { en: "How are your bowels?", hi: "शौच कैसा रहता है?" },
    choices: [
      { value: "regular", label: { en: "Regular", hi: "नियमित" }, icon: "Check" },
      { value: "constipated", label: { en: "Constipated / hard", hi: "कब्ज़ / कड़ा" }, icon: "Lock" },
      { value: "loose", label: { en: "Loose", hi: "पतला" }, icon: "Droplets" },
      { value: "alternating", label: { en: "Changes often", hi: "बदलता रहता है" }, icon: "Repeat" },
    ],
  },
  {
    code: "per.sleep",
    section: "personal",
    kind: "single",
    prompt: { en: "How do you sleep?", hi: "नींद कैसी आती है?" },
    choices: [
      { value: "sound", label: { en: "Sound sleep", hi: "गहरी नींद" }, icon: "Moon" },
      { value: "disturbed", label: { en: "Broken sleep", hi: "टूटती नींद" }, icon: "MoonStar" },
      { value: "difficulty", label: { en: "Hard to fall asleep", hi: "नींद आने में दिक्कत" }, icon: "EyeOff" },
      { value: "excessive", label: { en: "Sleeping too much", hi: "ज़्यादा नींद" }, icon: "BedDouble" },
    ],
  },
  {
    code: "per.activity",
    section: "personal",
    kind: "single",
    prompt: { en: "How much physical work or exercise?", hi: "शारीरिक काम या व्यायाम कितना?" },
    choices: [
      { value: "heavy", label: { en: "Heavy physical work", hi: "भारी शारीरिक काम" }, icon: "Hammer" },
      { value: "moderate", label: { en: "Some walking or work", hi: "थोड़ा चलना-फिरना" }, icon: "Footprints" },
      { value: "sedentary", label: { en: "Mostly sitting", hi: "ज़्यादातर बैठे रहना" }, icon: "Armchair" },
    ],
  },
  {
    code: "per.occupation",
    section: "personal",
    kind: "text",
    prompt: { en: "What work do you do?", hi: "आप क्या काम करते हैं?" },
  },
  {
    code: "per.menstrual",
    section: "personal",
    kind: "text",
    prompt: { en: "If it applies: are your monthly cycles regular?", hi: "यदि लागू हो: माहवारी नियमित है?" },
    optional: true,
  },

  // -------------------------------------------------------------- review of systems
  // Nine systems, one screen each, deliberately as multi-select symptom lists rather
  // than sixty yes/no questions. A full ROS asked one question at a time is forty taps
  // and nobody finishes it; a list of eight recognisable words per system is one tap
  // for "none of these" and gets the same information.
  {
    code: "ros.general",
    section: "ros",
    kind: "multi",
    prompt: { en: "In general, any of these?", hi: "सामान्य रूप से, इनमें से कुछ?" },
    choices: [
      { value: "fever", label: { en: "Fever", hi: "बुखार" }, icon: "Thermometer" },
      { value: "weight_loss", label: { en: "Losing weight", hi: "वज़न घटना" }, icon: "TrendingDown" },
      { value: "appetite_loss", label: { en: "No appetite", hi: "भूख न लगना" }, icon: "UtensilsCrossed" },
      { value: "night_sweats", label: { en: "Night sweats", hi: "रात में पसीना" }, icon: "Droplets" },
      { value: "tired", label: { en: "Very tired", hi: "बहुत थकान" }, icon: "BatteryLow" },
      { value: "none", label: { en: "None of these", hi: "इनमें से कुछ नहीं" }, icon: "Check" },
    ],
  },
  {
    code: "ros.cardiorespiratory",
    section: "ros",
    kind: "multi",
    prompt: { en: "Chest and breathing?", hi: "छाती और साँस?" },
    choices: [
      { value: "chest_pain", label: { en: "Chest pain", hi: "छाती में दर्द" }, icon: "HeartPulse" },
      { value: "breathless_exertion", label: { en: "Breathless on walking", hi: "चलने पर साँस फूलना" }, icon: "Wind" },
      { value: "breathless_rest", label: { en: "Breathless even at rest", hi: "आराम में भी साँस फूलना" }, icon: "AlertTriangle" },
      { value: "cough", label: { en: "Cough", hi: "खाँसी" }, icon: "Mic" },
      { value: "blood_in_sputum", label: { en: "Blood in sputum", hi: "थूक में खून" }, icon: "Droplet" },
      { value: "palpitations", label: { en: "Heart racing", hi: "दिल तेज़ धड़कना" }, icon: "Activity" },
      { value: "swelling_feet", label: { en: "Swollen feet", hi: "पैरों में सूजन" }, icon: "ArrowDownWideNarrow" },
      { value: "none", label: { en: "None of these", hi: "इनमें से कुछ नहीं" }, icon: "Check" },
    ],
  },
  {
    code: "ros.gastrointestinal",
    section: "ros",
    kind: "multi",
    prompt: { en: "Stomach and digestion?", hi: "पेट और पाचन?" },
    choices: [
      { value: "abdominal_pain", label: { en: "Stomach pain", hi: "पेट दर्द" }, icon: "Circle" },
      { value: "vomiting", label: { en: "Vomiting", hi: "उल्टी" }, icon: "ArrowDownCircle" },
      { value: "vomiting_blood", label: { en: "Vomiting blood", hi: "खून की उल्टी" }, icon: "AlertTriangle" },
      { value: "black_stool", label: { en: "Black or bloody stool", hi: "काला या खूनी मल" }, icon: "AlertTriangle" },
      { value: "acidity", label: { en: "Acidity, burning", hi: "एसिडिटी, जलन" }, icon: "Flame" },
      { value: "jaundice", label: { en: "Yellow eyes", hi: "आँखें पीली" }, icon: "Eye" },
      { value: "none", label: { en: "None of these", hi: "इनमें से कुछ नहीं" }, icon: "Check" },
    ],
  },
  {
    code: "ros.neurological",
    section: "ros",
    kind: "multi",
    prompt: { en: "Head, nerves and senses?", hi: "सिर, नसें और इंद्रियाँ?" },
    choices: [
      { value: "headache", label: { en: "Headache", hi: "सिरदर्द" }, icon: "Brain" },
      { value: "sudden_weakness", label: { en: "Sudden weakness on one side", hi: "अचानक एक तरफ़ कमज़ोरी" }, icon: "AlertTriangle" },
      { value: "face_droop", label: { en: "Face pulling to one side", hi: "चेहरा एक तरफ़ खिंचना" }, icon: "AlertTriangle" },
      { value: "speech_trouble", label: { en: "Trouble speaking", hi: "बोलने में दिक्कत" }, icon: "MessageSquareOff" },
      { value: "fits", label: { en: "Fits", hi: "दौरे" }, icon: "Zap" },
      { value: "numbness", label: { en: "Numbness, tingling", hi: "सुन्नपन, झुनझुनी" }, icon: "Hand" },
      { value: "vision_loss", label: { en: "Sudden vision change", hi: "अचानक दिखाई कम" }, icon: "EyeOff" },
      { value: "neck_stiff", label: { en: "Stiff neck", hi: "गर्दन अकड़ना" }, icon: "AlertTriangle" },
      { value: "none", label: { en: "None of these", hi: "इनमें से कुछ नहीं" }, icon: "Check" },
    ],
  },
  {
    code: "ros.genitourinary",
    section: "ros",
    kind: "multi",
    prompt: { en: "Passing urine?", hi: "पेशाब?" },
    choices: [
      { value: "burning", label: { en: "Burning", hi: "जलन" }, icon: "Flame" },
      { value: "frequency", label: { en: "Going very often", hi: "बार-बार जाना" }, icon: "Repeat" },
      { value: "blood", label: { en: "Blood in urine", hi: "पेशाब में खून" }, icon: "Droplet" },
      { value: "reduced", label: { en: "Passing very little", hi: "बहुत कम" }, icon: "ArrowDownNarrowWide" },
      { value: "none", label: { en: "None of these", hi: "इनमें से कुछ नहीं" }, icon: "Check" },
    ],
  },
  {
    code: "ros.musculoskeletal_skin",
    section: "ros",
    kind: "multi",
    prompt: { en: "Joints, back and skin?", hi: "जोड़, कमर और त्वचा?" },
    choices: [
      { value: "joint_pain", label: { en: "Joint pain", hi: "जोड़ों में दर्द" }, icon: "Bone" },
      { value: "back_pain", label: { en: "Back pain", hi: "कमर दर्द" }, icon: "MoveVertical" },
      { value: "rash", label: { en: "Rash", hi: "चकत्ते" }, icon: "Sparkles" },
      { value: "itching", label: { en: "Itching", hi: "खुजली" }, icon: "Hand" },
      { value: "ulcer", label: { en: "A wound that will not heal", hi: "न भरने वाला घाव" }, icon: "Bandage" },
      { value: "none", label: { en: "None of these", hi: "इनमें से कुछ नहीं" }, icon: "Check" },
    ],
  },
  {
    code: "ros.psychological",
    section: "ros",
    kind: "multi",
    prompt: { en: "Mood and mind?", hi: "मन और मनोदशा?" },
    choices: [
      { value: "low_mood", label: { en: "Feeling low", hi: "मन उदास" }, icon: "CloudRain" },
      { value: "anxiety", label: { en: "Worry, restlessness", hi: "चिंता, बेचैनी" }, icon: "Wind" },
      { value: "no_interest", label: { en: "No interest in anything", hi: "किसी चीज़ में मन नहीं" }, icon: "CircleSlash" },
      { value: "none", label: { en: "None of these", hi: "इनमें से कुछ नहीं" }, icon: "Check" },
    ],
  },

  // -------------------------------------------------------------- prior investigations
  {
    code: "inv.has_reports",
    section: "investigations",
    kind: "single",
    prompt: {
      en: "Do you have any old prescriptions, reports or discharge papers with you?",
      hi: "आपके पास पुरानी पर्ची, रिपोर्ट या छुट्टी के कागज़ हैं?",
    },
    choices: [
      { value: "yes", label: { en: "Yes, with me now", hi: "हाँ, अभी साथ हैं" }, icon: "FileText" },
      { value: "at_home", label: { en: "At home", hi: "घर पर हैं" }, icon: "Home" },
      { value: "no", label: { en: "No", hi: "नहीं" }, icon: "X" },
    ],
  },
  {
    code: "inv.recent_tests",
    section: "investigations",
    kind: "multi",
    prompt: { en: "Any tests done recently?", hi: "हाल में कोई जाँच हुई है?" },
    choices: [
      { value: "blood", label: { en: "Blood tests", hi: "खून की जाँच" }, icon: "TestTube" },
      { value: "sugar", label: { en: "Sugar test", hi: "शुगर जाँच" }, icon: "Candy" },
      { value: "xray", label: { en: "X-ray", hi: "एक्स-रे" }, icon: "Scan" },
      { value: "ecg", label: { en: "ECG", hi: "ईसीजी" }, icon: "Activity" },
      { value: "ultrasound", label: { en: "Ultrasound / sonography", hi: "अल्ट्रासाउंड" }, icon: "Radio" },
      { value: "none", label: { en: "None", hi: "कोई नहीं" }, icon: "Check" },
    ],
  },
];

/* ------------------------------------------------------------------- red flags ---
 * PS 3.3 Module A: "red-flag detection (such as acute chest pain with dyspnoea, or
 * stroke signs) that raises an immediate priority alert to triage instead of normal
 * queueing." Both named examples are the first two rules below.
 *
 * WHY RULES OVER CODES AND NOT KEYWORDS. The voice agent already carries a keyword net
 * (`_CRITICAL_KEYWORDS_HI`, 45 Hindi terms in backend/voice_agent/agent.py) for free
 * speech, and that is the right mechanism there. These rules act on STRUCTURED answers,
 * where the signal is a combination rather than a word: "chest" alone is not an
 * emergency and "breathless" alone is not either, and the pair is. Neither mechanism
 * replaces the other and both write to the same place.
 *
 * NOT CLINICALLY REVIEWED. Every threshold here is engineering judgement drawn from
 * published triage criteria — FAST for stroke, the classic ACS presentation, the
 * meningitis triad. Listed for sign-off in docs/CLINICAL_REVIEW.md. The failure mode
 * that matters is a MISSED flag, so where a rule was arguable it was made more
 * sensitive, and the cost of that choice is false alarms at the triage desk.
 */
export type RedFlagCondition = {
  code: string;
  includesAny?: string[];
  equalsAny?: string[];
  /** For scale/number items. */
  min?: number;
};

export type RedFlagRule = {
  id: string;
  severity: "critical" | "high";
  reason: { en: string; hi: string };
  /** Every condition must hold for the rule to fire. */
  all: RedFlagCondition[];
  source: string;
};

export const RED_FLAG_RULES: RedFlagRule[] = [
  {
    id: "chest_pain_with_dyspnoea",
    severity: "critical",
    reason: {
      en: "Chest pain with breathlessness — possible acute coronary syndrome",
      hi: "छाती में दर्द के साथ साँस फूलना — दिल का दौरा संभव",
    },
    all: [
      { code: "hpi.site", includesAny: ["chest"] },
      { code: "hpi.associated", includesAny: ["breathless"] },
    ],
    source: "PS 3.3 Module A names this pairing; standard ACS presentation",
  },
  {
    id: "acs_radiation_pattern",
    severity: "critical",
    reason: {
      en: "Chest pain radiating to arm or jaw with sweating — possible acute coronary syndrome",
      hi: "छाती का दर्द हाथ या जबड़े में फैलना, पसीना — दिल का दौरा संभव",
    },
    all: [
      { code: "hpi.site", includesAny: ["chest"] },
      { code: "hpi.radiation", includesAny: ["left_arm", "jaw"] },
    ],
    source: "Classic ACS radiation pattern",
  },
  {
    id: "stroke_fast",
    severity: "critical",
    reason: {
      en: "Sudden one-sided weakness, facial droop or speech difficulty — possible stroke",
      hi: "अचानक एक तरफ़ कमज़ोरी, चेहरा खिंचना या बोलने में दिक्कत — लकवा संभव",
    },
    all: [
      { code: "ros.neurological", includesAny: ["sudden_weakness", "face_droop", "speech_trouble"] },
    ],
    source: "FAST screen (face, arm, speech, time)",
  },
  {
    id: "stroke_signs_in_hpi",
    severity: "critical",
    reason: {
      en: "One-sided weakness or speech difficulty alongside the main complaint — possible stroke",
      hi: "मुख्य शिकायत के साथ एक तरफ़ कमज़ोरी या बोलने में दिक्कत — लकवा संभव",
    },
    all: [
      { code: "hpi.associated", includesAny: ["weakness_one_side", "speech_trouble"] },
    ],
    source: "FAST screen, reached from the HPI rather than the ROS",
  },
  {
    id: "breathless_at_rest",
    severity: "critical",
    reason: {
      en: "Breathless at rest — respiratory or cardiac decompensation",
      hi: "आराम में भी साँस फूलना — साँस या दिल की गंभीर स्थिति",
    },
    all: [{ code: "ros.cardiorespiratory", includesAny: ["breathless_rest"] }],
    source: "Dyspnoea at rest is a standard immediate-triage criterion",
  },
  {
    id: "gi_bleed",
    severity: "critical",
    reason: {
      en: "Vomiting blood or black stool — gastrointestinal bleeding",
      hi: "खून की उल्टी या काला मल — पेट में रक्तस्राव",
    },
    all: [{ code: "ros.gastrointestinal", includesAny: ["vomiting_blood", "black_stool"] }],
    source: "Overt GI bleeding",
  },
  {
    id: "meningitis_pattern",
    severity: "critical",
    reason: {
      en: "Fever with stiff neck and headache — possible meningitis",
      hi: "बुखार के साथ गर्दन अकड़ना और सिरदर्द — दिमागी बुखार संभव",
    },
    all: [
      { code: "ros.neurological", includesAny: ["neck_stiff"] },
      { code: "ros.general", includesAny: ["fever"] },
    ],
    source: "Fever + neck stiffness + headache triad",
  },
  {
    id: "acute_fits",
    severity: "critical",
    reason: {
      en: "Fits within the last day",
      hi: "बीते एक दिन में दौरे",
    },
    all: [
      { code: "ros.neurological", includesAny: ["fits"] },
      { code: "cc.duration", equalsAny: ["hours", "today"] },
    ],
    source: "New or recent seizure activity",
  },
  {
    id: "sudden_vision_loss",
    severity: "critical",
    reason: {
      en: "Sudden change in vision — possible retinal or cerebrovascular event",
      hi: "अचानक दिखाई कम होना — आँख या दिमाग की गंभीर स्थिति",
    },
    all: [{ code: "ros.neurological", includesAny: ["vision_loss"] }],
    source: "Sudden visual loss is time-critical",
  },
  {
    id: "haemoptysis",
    severity: "high",
    reason: {
      en: "Blood in sputum — needs same-day assessment",
      hi: "थूक में खून — आज ही जाँच ज़रूरी",
    },
    all: [{ code: "ros.cardiorespiratory", includesAny: ["blood_in_sputum"] }],
    source: "Haemoptysis; TB is prevalent in this population",
  },
  {
    id: "reduced_urine_output",
    severity: "high",
    reason: {
      en: "Passing very little urine — possible acute kidney injury",
      hi: "बहुत कम पेशाब — गुर्दे की गंभीर स्थिति संभव",
    },
    all: [{ code: "ros.genitourinary", includesAny: ["reduced"] }],
    source: "Oliguria",
  },
  {
    id: "severe_acute_pain",
    severity: "high",
    reason: {
      en: "Severe pain of sudden onset",
      hi: "अचानक शुरू हुआ तेज़ दर्द",
    },
    all: [
      { code: "hpi.severity", min: 9 },
      { code: "hpi.onset", equalsAny: ["sudden"] },
    ],
    source: "Severity 9-10 with sudden onset",
  },
];

/* ------------------------------------------------------- Dashavidha Pariksha ---
 * The ten-fold examination, PS 3.3 Module A: "Prakriti, Vikriti, Sara, Samhanana,
 * Pramana, Satmya, Sattva, Ahara Shakti, Vyayama Shakti, Vaya".
 *
 * NOTHING HERE IS CLINICALLY REVIEWED, and this is the largest single piece of
 * unreviewed clinical content in the repository. The permitted values are the classical
 * enumerations as restated in current BAMS teaching, transcribed by an engineer. Six of
 * the ten grade on the same pravara/madhyama/avara scale, which is not a simplification
 * we introduced — it is how the texts grade them.
 *
 * WHAT THIS IS AND IS NOT. It is a vocabulary and a set of questions that let a patient
 * describe themselves in the terms an Ayurvedic physician will want. It is NOT a
 * Prakriti determination: assigning a constitution is a clinical act involving
 * examination the kiosk cannot perform (nadi, jihva, akriti), and the honest output is
 * "this is what the patient reported" for a practitioner to read, not "this patient is
 * Vata-Pitta". Any screen showing these must say so.
 */
export const DASHAVIDHA_FACTORS = [
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
] as const;

export type DashavidhaFactor = (typeof DASHAVIDHA_FACTORS)[number];

export type DashavidhaSpec = {
  factor: DashavidhaFactor;
  label: { en: string; hi: string };
  /** What the patient is actually asked, in plain words rather than Sanskrit. */
  prompt: { en: string; hi: string };
  kind: "single" | "multi" | "number";
  choices?: Choice[];
  unit?: string;
  /** What the factor means, shown to the practitioner beside the answer. */
  gloss: string;
};

const DOSHA_CHOICES: Choice[] = [
  { value: "vata", label: { en: "Thin, dry, quick, feels the cold", hi: "दुबला, रूखा, चंचल, ठंड लगती है" } },
  { value: "pitta", label: { en: "Medium build, warm, sharp appetite, gets angry", hi: "मध्यम शरीर, गर्म, तेज़ भूख, गुस्सा" } },
  { value: "kapha", label: { en: "Heavy build, calm, slow digestion, oily skin", hi: "भारी शरीर, शांत, धीमा पाचन, तैलीय त्वचा" } },
  { value: "vata_pitta", label: { en: "Mix of the first two", hi: "पहले दोनों का मिश्रण" } },
  { value: "pitta_kapha", label: { en: "Mix of the last two", hi: "बाद के दोनों का मिश्रण" } },
  { value: "vata_kapha", label: { en: "Mix of first and third", hi: "पहले और तीसरे का मिश्रण" } },
  { value: "sama", label: { en: "Balanced, none stands out", hi: "संतुलित, कोई प्रमुख नहीं" } },
];

export const DASHAVIDHA: DashavidhaSpec[] = [
  {
    factor: "prakriti",
    label: { en: "Prakriti — constitution", hi: "प्रकृति" },
    prompt: {
      en: "Which of these describes your body and nature best, since childhood?",
      hi: "बचपन से आपका शरीर और स्वभाव इनमें से किससे मिलता है?",
    },
    kind: "single",
    choices: DOSHA_CHOICES,
    gloss: "Patient-reported constitution. Not a determination — nadi, jihva and akriti examination is not possible at a kiosk.",
  },
  {
    factor: "vikriti",
    label: { en: "Vikriti — current imbalance", hi: "विकृति" },
    prompt: {
      en: "Right now, which of these feels most out of balance?",
      hi: "अभी, इनमें से क्या सबसे ज़्यादा बिगड़ा लगता है?",
    },
    kind: "single",
    choices: [
      { value: "vata", label: { en: "Dryness, gas, pain, restlessness", hi: "रूखापन, गैस, दर्द, बेचैनी" } },
      { value: "pitta", label: { en: "Burning, acidity, heat, anger", hi: "जलन, अम्लता, गर्मी, गुस्सा" } },
      { value: "kapha", label: { en: "Heaviness, cough, sluggishness", hi: "भारीपन, कफ़, सुस्ती" } },
      { value: "mixed", label: { en: "More than one", hi: "एक से अधिक" } },
      { value: "none", label: { en: "Nothing in particular", hi: "कुछ विशेष नहीं" } },
    ],
    gloss: "Present derangement as the patient experiences it, distinct from lifelong Prakriti.",
  },
  {
    factor: "sara",
    label: { en: "Sara — tissue quality", hi: "सार" },
    prompt: {
      en: "How would you describe your overall physical strength and stamina?",
      hi: "आपकी कुल शारीरिक शक्ति और सहनशक्ति कैसी है?",
    },
    kind: "single",
    choices: GRADE_3,
    gloss: "Essence/quality of the dhatus. Graded pravara/madhyama/avara in the classical texts.",
  },
  {
    factor: "samhanana",
    label: { en: "Samhanana — compactness", hi: "संहनन" },
    prompt: {
      en: "Is your body well built and firm, average, or thin and loose?",
      hi: "आपका शरीर गठीला, सामान्य, या दुबला और ढीला है?",
    },
    kind: "single",
    choices: GRADE_3,
    gloss: "Compactness of build — symmetry and firmness of musculature and bone.",
  },
  {
    factor: "pramana",
    label: { en: "Pramana — body measurement", hi: "प्रमाण" },
    prompt: {
      en: "Your height and weight, if you know them.",
      hi: "आपकी लंबाई और वज़न, यदि पता हो।",
    },
    kind: "number",
    unit: "cm / kg",
    gloss: "Anthropometry. Recorded as measurement rather than graded, so BMI is derivable and the grading stays with the practitioner.",
  },
  {
    factor: "satmya",
    label: { en: "Satmya — what suits you", hi: "सात्म्य" },
    prompt: {
      en: "Can you eat and tolerate most kinds of food, or only a few?",
      hi: "आप ज़्यादातर तरह का खाना पचा लेते हैं, या कुछ ही चीज़ें?",
    },
    kind: "single",
    choices: [
      { value: "sarvarasa", label: { en: "Almost anything suits me", hi: "लगभग सब कुछ ठीक रहता है" } },
      { value: "vyamishra", label: { en: "Some things do not suit me", hi: "कुछ चीज़ें ठीक नहीं लगतीं" } },
      { value: "ekarasa", label: { en: "Only a few things suit me", hi: "कुछ ही चीज़ें ठीक रहती हैं" } },
    ],
    gloss: "Accustomedness — range of diet and regimen the patient tolerates.",
  },
  {
    factor: "sattva",
    label: { en: "Sattva — mental strength", hi: "सत्त्व" },
    prompt: {
      en: "When something difficult happens, how well do you cope?",
      hi: "कोई कठिन बात होने पर आप कैसे सँभालते हैं?",
    },
    kind: "single",
    choices: GRADE_3,
    gloss: "Mental endurance. Relevant to prognosis and to how much illness the patient can bear.",
  },
  {
    factor: "ahara_shakti",
    label: { en: "Ahara Shakti — food and digestive capacity", hi: "आहार शक्ति" },
    prompt: {
      en: "How is your appetite and digestion?",
      hi: "आपकी भूख और पाचन कैसा है?",
    },
    kind: "single",
    choices: [
      { value: "pravara", label: { en: "Good appetite, digests well", hi: "अच्छी भूख, ठीक पचता है" } },
      { value: "madhyama", label: { en: "Average", hi: "सामान्य" } },
      { value: "avara", label: { en: "Poor appetite or heaviness after food", hi: "कम भूख या खाने के बाद भारीपन" } },
    ],
    gloss: "Abhyavaharana shakti (quantity) and jarana shakti (digestion) taken together, as one patient-answerable question.",
  },
  {
    factor: "vyayama_shakti",
    label: { en: "Vyayama Shakti — capacity for exertion", hi: "व्यायाम शक्ति" },
    prompt: {
      en: "How much physical work can you do before you tire?",
      hi: "थकने से पहले कितना शारीरिक काम कर सकते हैं?",
    },
    kind: "single",
    choices: [
      { value: "pravara", label: { en: "A full day of hard work", hi: "पूरे दिन भारी काम" } },
      { value: "madhyama", label: { en: "Ordinary daily work", hi: "रोज़ का सामान्य काम" } },
      { value: "avara", label: { en: "I tire very quickly", hi: "बहुत जल्दी थक जाता हूँ" } },
    ],
    gloss: "Exercise tolerance. Overlaps deliberately with per.activity — one asks what the patient does, this asks what they can do.",
  },
  {
    factor: "vaya",
    label: { en: "Vaya — life stage", hi: "वय" },
    prompt: { en: "Your age in years.", hi: "आपकी उम्र, सालों में।" },
    kind: "number",
    unit: "years",
    gloss: "Age, banded by the classical divisions: bala to 16, madhya 16-60, vriddha above 60.",
  },
];

/** The classical age bands, so the practitioner sees a stage and not only a number. */
export function vayaStage(years: number): { key: string; en: string; hi: string } {
  if (years < 16) return { key: "bala", en: "Bala (childhood)", hi: "बाल्य" };
  if (years <= 60) return { key: "madhya", en: "Madhya (middle)", hi: "मध्य" };
  return { key: "vriddha", en: "Vriddha (old age)", hi: "वृद्ध" };
}

/* ----------------------------------------------------------------- the walk ---
 * Answers are keyed by item code, matching history_answers.item_code, and the value
 * shape matches its answer_value jsonb column: a string for single/text, an array for
 * multi, a number for scale/number.
 */
export type AnswerValue = string | string[] | number;
export type Answers = Record<string, AnswerValue>;
export type Mode = "allopathic" | "ayush";

function asArray(v: AnswerValue | undefined): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v;
  return [String(v)];
}

/** Answered means answered — an empty array or empty string is not an answer. */
export function isAnswered(answers: Answers, code: string): boolean {
  const v = answers[code];
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

/**
 * Adaptive branching. An item is asked when its mode matches and its `when` predicate
 * holds. A `when` with no equalsAny/includesAny means "ask this once the referenced
 * item has any answer at all" — that is how da.adherence waits for da.current_meds.
 */
export function isApplicable(item: OntologyItem, answers: Answers, mode: Mode): boolean {
  if (item.modes && !item.modes.includes(mode)) return false;
  if (!item.when) return true;
  const { code, equalsAny, includesAny } = item.when;
  if (!isAnswered(answers, code)) return false;
  if (!equalsAny && !includesAny) return true;
  const values = asArray(answers[code]);
  if (equalsAny && values.some((v) => equalsAny.includes(v))) return true;
  if (includesAny && values.some((v) => includesAny.includes(v))) return true;
  return false;
}

/** The next thing to ask, or null when the applicable set is exhausted. */
export function nextItem(answers: Answers, mode: Mode): OntologyItem | null {
  for (const item of ONTOLOGY) {
    if (item.optional) continue;
    if (!isApplicable(item, answers, mode)) continue;
    if (!isAnswered(answers, item.code)) return item;
  }
  return null;
}

/**
 * How much of the history we actually got, as a fraction of what was applicable.
 * Reported rather than hidden: an interview a patient abandoned halfway is still
 * useful to a clinician who can see that it is halfway.
 */
export function completeness(answers: Answers, mode: Mode): { asked: number; answered: number; fraction: number } {
  let asked = 0;
  let answered = 0;
  for (const item of ONTOLOGY) {
    if (item.optional) continue;
    if (!isApplicable(item, answers, mode)) continue;
    asked += 1;
    if (isAnswered(answers, item.code)) answered += 1;
  }
  return { asked, answered, fraction: asked === 0 ? 0 : answered / asked };
}

function conditionHolds(c: RedFlagCondition, answers: Answers): boolean {
  if (!isAnswered(answers, c.code)) return false;
  if (c.min !== undefined) {
    const n = Number(answers[c.code]);
    return Number.isFinite(n) && n >= c.min;
  }
  const values = asArray(answers[c.code]);
  if (c.includesAny) return values.some((v) => c.includesAny!.includes(v));
  if (c.equalsAny) return values.some((v) => c.equalsAny!.includes(v));
  return true;
}

/**
 * Every rule that fires, critical first. Returns all of them rather than the first,
 * because a patient with both chest pain and stroke signs needs both on the triage
 * card — collapsing to one would hide the second from whoever reads it.
 */
export function evaluateRedFlags(answers: Answers): RedFlagRule[] {
  const hits = RED_FLAG_RULES.filter((r) => r.all.every((c) => conditionHolds(c, answers)));
  return hits.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

/**
 * The compact rendering the voice agent's system prompt carries. Not the full
 * structure: an LLM told to take a history needs the shape and the vocabulary, not
 * sixty rows of tap labels. Regenerated into the prompt rather than pasted, so adding
 * an item here reaches the voice path too.
 */
export function promptOutline(mode: Mode): string {
  const lines: string[] = [];
  for (const section of SECTION_ORDER) {
    const items = ONTOLOGY.filter((i) => i.section === section && (!i.modes || i.modes.includes(mode)));
    if (items.length === 0) continue;
    lines.push(`${SECTION_HEADINGS[section].en}:`);
    for (const item of items) {
      const choices = item.choices ? ` [${item.choices.map((c) => c.value).join("|")}]` : "";
      lines.push(`  ${item.code} — ${item.prompt.en}${choices}`);
    }
  }
  return lines.join("\n");
}







