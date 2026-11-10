/**
 * Static, plain-language PM-JAY readiness content. Grounded in the NHA
 * "Process Flow at Empanelled Hospitals" + the official documents-to-carry guidance.
 * HARD CONSTRAINT: this is information only — it never decides eligibility or processes
 * a claim. Eligibility lives on the official portal we deep-link to.
 */

export const PMJAY_ELIGIBILITY_URL = "https://beneficiary.nha.gov.in";
export const PMJAY_CALL_CENTRE = "14555";

export interface Bilingual {
  en: string;
  hi: string;
}

export const PMJAY_ABOUT: Bilingual = {
  en: "Ayushman Bharat PM-JAY gives eligible families cashless hospital treatment up to ₹5 lakh per year at empanelled hospitals. You do not pay the hospital for covered treatment — the scheme does.",
  hi: "आयुष्मान भारत PM-JAY पात्र परिवारों को सूचीबद्ध (empanelled) अस्पतालों में प्रति वर्ष ₹5 लाख तक का कैशलेस इलाज देती है। कवर किए गए इलाज के लिए आप अस्पताल को भुगतान नहीं करते — योजना करती है।",
};

export const PMJAY_DOCUMENTS: Bilingual[] = [
  { en: "Ayushman card (PM-JAY / Ayushman Bharat card)", hi: "आयुष्मान कार्ड (PM-JAY / आयुष्मान भारत कार्ड)" },
  { en: "Aadhaar card (of the patient)", hi: "आधार कार्ड (रोगी का)" },
  { en: "Ration card (family ID)", hi: "राशन कार्ड (परिवार पहचान)" },
  { en: "Any doctor's referral letter, if you have one", hi: "डॉक्टर का रेफरल पत्र, यदि हो" },
  { en: "For ICU / bed-ridden patients who cannot give fingerprint/iris: a biometric-waiver form (the hospital provides it)", hi: "ICU / अशक्त रोगी जो फिंगरप्रिंट/आईरिस नहीं दे सकते: बायोमेट्रिक-छूट फॉर्म (अस्पताल देता है)" },
];

export const PMJAY_VISIT_STEPS: Bilingual[] = [
  { en: "Reach the empanelled hospital and go to the PM-JAY / Ayushman Mitra help desk.", hi: "सूचीबद्ध अस्पताल पहुँचें और PM-JAY / आयुष्मान मित्र हेल्प डेस्क पर जाएँ।" },
  { en: "The Ayushman Mitra verifies your identity and card (biometric / OTP).", hi: "आयुष्मान मित्र आपकी पहचान व कार्ड सत्यापित करते हैं (बायोमेट्रिक / OTP)।" },
  { en: "See the doctor; they decide the treatment and the matching package.", hi: "डॉक्टर से मिलें; वे इलाज और संबंधित पैकेज तय करते हैं।" },
  { en: "The hospital submits a pre-authorisation request — approval usually within hours.", hi: "अस्पताल प्री-ऑथराइज़ेशन भेजता है — स्वीकृति आमतौर पर कुछ घंटों में।" },
  { en: "Get treatment cashless — you do not pay for covered care.", hi: "कैशलेस इलाज पाएँ — कवर इलाज के लिए आप भुगतान नहीं करते।" },
  { en: "On discharge, collect your discharge summary. Follow-up care may be covered up to 15 days.", hi: "छुट्टी पर डिस्चार्ज सारांश लें। फॉलो-अप देखभाल 15 दिन तक कवर हो सकती है।" },
];
