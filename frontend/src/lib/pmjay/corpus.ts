/**
 * Bounded corpus for the "ask about PM-JAY" assistant. Each chunk is a factual
 * passage condensed from an official NHA / PM-JAY source, carrying its citation.
 * The assistant answers ONLY from these chunks (see lib/pmjay/retrieve + the
 * /api/pmjay-ask route): no passage clears the retrieval threshold → it refuses.
 * This is the whole knowledge base — scheme facts, not a person's eligibility.
 */

export interface PmjayChunk {
  id: string;
  section: string;
  text: string;
  source: string;
  url: string;
}

const NHA = "National Health Authority — About PM-JAY";
const NHA_URL = "https://nha.gov.in/PM-JAY";
const FLOW = "PM-JAY Process Flow at Empanelled Hospitals (NHA)";
const FLOW_URL = "https://pmjay.gov.in";

export const PMJAY_CORPUS: PmjayChunk[] = [
  { id: "what", section: "What PM-JAY is", text: "Ayushman Bharat Pradhan Mantri Jan Arogya Yojana (AB PM-JAY) is a government health-assurance scheme that gives eligible families cashless secondary and tertiary hospital care at empanelled public and private hospitals.", source: NHA, url: NHA_URL },
  { id: "cover", section: "Cover amount", text: "PM-JAY provides health cover of up to 5 lakh rupees (₹5,00,000) per family per year for hospitalisation. The cover is on a family-floater basis with no cap on family size or age.", source: NHA, url: NHA_URL },
  { id: "cashless", section: "Cashless treatment", text: "Treatment is cashless and paperless at the point of care — an eligible beneficiary does not pay the empanelled hospital for covered treatment; the scheme settles it. There is no fee to the patient for covered packages.", source: NHA, url: NHA_URL },
  { id: "eligibility", section: "Who is eligible", text: "Eligibility is family-based and determined from the deprivation and occupational criteria of the SECC database (and later additions by the government); it is not an enrolment you buy. Whether a specific family is eligible is decided by the official system, not by this assistant — check status on the beneficiary portal or call 14555.", source: NHA, url: NHA_URL },
  { id: "card", section: "Ayushman card", text: "An eligible beneficiary can create and download an Ayushman card after identity verification (Aadhaar) on the beneficiary portal. The card is used to avail cashless treatment at empanelled hospitals.", source: NHA, url: "https://beneficiary.nha.gov.in" },
  { id: "documents", section: "Documents to carry", text: "To avail treatment at an empanelled hospital, carry your Ayushman card (or verify via Aadhaar), an identity proof such as Aadhaar, and your ration card / family identity. ICU or bed-ridden patients who cannot give fingerprint or iris can use a biometric-waiver form provided by the hospital.", source: FLOW, url: FLOW_URL },
  { id: "process", section: "Hospital process", text: "At the empanelled hospital, go to the PM-JAY help desk where a Pradhan Mantri Arogya Mitra (PMAM / Ayushman Mitra) verifies your identity and card through the Beneficiary Identification System. The treating doctor selects the matching treatment package and the hospital submits a pre-authorisation request for approval.", source: FLOW, url: FLOW_URL },
  { id: "preauth", section: "Pre-authorisation", text: "Covered treatment proceeds after the hospital's pre-authorisation is approved; many packages are approved within hours. You do not pay for approved, covered treatment.", source: FLOW, url: FLOW_URL },
  { id: "coverage_window", section: "What the cover includes", text: "The cover includes expenses from pre-hospitalisation through the hospital stay, and post-hospitalisation follow-up care and medicines for up to 15 days after discharge. Pre-existing conditions are covered from day one.", source: NHA, url: NHA_URL },
  { id: "opd", section: "OPD vs hospitalisation", text: "PM-JAY covers hospitalisation (secondary and tertiary care). Routine out-patient (OPD) consultations are generally not covered under PM-JAY hospitalisation benefits.", source: NHA, url: NHA_URL },
  { id: "portability", section: "Portability across India", text: "PM-JAY is portable nationwide: an eligible beneficiary can avail cashless treatment at any empanelled hospital across India, not only in their home state.", source: NHA, url: NHA_URL },
  { id: "find_hospital", section: "Finding an empanelled hospital", text: "You can find empanelled hospitals through the official hospital search, by state and specialty. Empanelment changes over time — hospitals can be added or suspended — so confirm a hospital is currently empanelled before travelling.", source: "HEM Empanelled Hospital Search", url: "https://hospitals.pmjay.gov.in/Search/" },
  { id: "help", section: "Help and grievances", text: "For eligibility checks, card issues, or complaints, use the beneficiary portal or call the PM-JAY helpline 14555 (or 1800-111-565).", source: NHA, url: NHA_URL },
  { id: "no_payment", section: "No payment / no discrimination", text: "An empanelled hospital must provide cashless treatment for covered packages and cannot ask an eligible beneficiary to pay for them. If a hospital demands payment for a covered service, report it via the helpline 14555.", source: NHA, url: NHA_URL },
];

