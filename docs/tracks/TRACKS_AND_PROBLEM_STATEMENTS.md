# Swadhikaar: Master Problem Statements & Product Tracks Log

> **Repository**: `c:\ace\products\swadhikaar`  
> **Product Name**: **Swadhikaar (स्वाधिकार)** — *Voice-Native Clinical Operating System & Community Health Intelligence*  
> **Created**: September 2026 | **Last Updated**: September 13, 2026 (Aligned for Lenovo LEAP Hackathon 2026)

---

## 1. Executive Product Vision
**Swadhikaar** is a unified, voice-first clinical operating system designed for India's public health frontline — Primary Health Centres (PHCs), District Civil Hospitals, and rural health kiosks. It bridges:
1. **Low-Literacy & Vernacular Walk-In Intake** (zero-touch hands-free voice in Hindi/English/Hinglish).
2. **Holistic Dual-Engine Clinical Triage** (Allopathic Red-Flag safety DAG + Classical Ayush *Dashavidha Pariksha*).
3. **Vision AI Prescription Digitization** (Gemini Vision OCR + advisory 16-rule drug-drug interaction checker).
4. **Acute Emergency Response** (telemetry-tracked live moving ambulance dispatch).
5. **Community Health Trends & Outbreak Surveillance** (real-time epidemiological intelligence from medical reporting data).
6. **National Health Infrastructure Interoperability** (Ayushman Bharat Digital Mission - ABHA Card & FHIR R4).

---

## 2. All 7 Problem Statements (Chronological Log — active focus: PS-01 & PS-02)

### Problem Statement 1: SIH26047 — Ministry of Ayush / AIIA
- **Source**: [https://ace-ify.github.io/sih-hub/ps/SIH26047/](https://ace-ify.github.io/sih-hub/ps/SIH26047/)
- **Core Challenge**: Overcrowded OPDs in Indian district hospitals; doctors have <2 minutes per patient; no time for structured lifestyle or traditional Ayurvedic examination (*Dashavidha Pariksha*).
- **Mandate**: Intelligent self-service touchscreen MediKiosk (`/kiosk`) for walk-in OPD patients, structured intake of symptoms and lifestyle factors, digitized paper prescriptions, and auto-generated clinical summaries for the doctor's queue (`/doctor/kiosk-queue`).

### Problem Statement 2: Rime PS — Hinglish Conversational Voice AI
- **Source**: `c:\ace\products\swadhikaar\Rime PS.pdf`
- **Core Challenge**: Low-literacy rural patients cannot comfortably read digital screens or type English/formal Hindi; they communicate with code-switched Hinglish (*"Do din se seene mein dard hai, walking pe breathlessness hoti hai"*).
- **Mandate**: Ultra-low-latency voice AI pipeline supporting Hindi and English speech recognition (STT), natural conversational synthesis (TTS), and hands-free question-and-answer flow with automatic voice confirmation.

### Problem Statement 3: psadditional — IIT Guwahati (Rural Emergency Seam)
- **Source**: `c:\ace\products\swadhikaar\psadditional.pdf`
- **Core Challenge**: Delayed response for acute emergencies at primary clinics; acute patients (heart attacks, severe trauma) wait in regular OPD queues with catastrophic delays.
- **Mandate**: Real-time "Red-Flag Clinical Watchdog" that intercepts critical symptoms, triggers immediate acute alarm on the doctor's console, and automates 108 ambulance dispatch with live telemetry and hospital bed matching.

### Problem Statement 4: SIH26133 — Govt of Maharashtra / ABDM Interoperability
- **Source**: [https://ace-ify.github.io/sih-hub/ps/SIH26133/](https://ace-ify.github.io/sih-hub/ps/SIH26133/)
- **Core Challenge**: Siloed patient data; paper records lost; non-compliance with national digital health standards.
- **Mandate**: Full Ayushman Bharat Digital Mission (ABDM) compliance — generating official Tricolor ABHA Digital Health Cards with QR codes, passing NHA Milestones (M1: ABHA creation, M2: HIP Care-Context Linking, M3: HIU Health Data Transfer), and exporting NRCES FHIR R4 clinical document bundles.

### Problem Statement 5: Lenovo LEAP Hackathon 2026 (Lenovo + BharatCares @ AKTU Lucknow)
- **Source**: Lenovo LEAP NextGen Scholar Program / IndiaAI Mission (13–18 September 2026, AKTU Campus, Lucknow, UP)
- **Key Themes**:
  - **Theme 3: Healthcare & Wellness Tech**:
    1. *People struggle to access basic verified symptom guidance.*
    2. *There is a need for better tracking of lifestyle habits to prevent diseases.*
    3. *Medical reporting data needs to be analyzed to identify community health trends.*
  - **Theme 2: Digital Inclusion & Public Access**:
    - *Accessible interfaces for low-literacy, elderly, and rural citizens; simplified public health services.*
- **Mandate for Swadhikaar**:
  - Elevate **Community Health Trend Analytics** from medical reporting data into a first-class feature (epidemiological outbreak surveillance across Uttar Pradesh districts).
  - Emphasize **Responsible AI** (verified clinical protocols vs LLM hallucinations).
  - Highlight **Digital Inclusion** through the hands-free voice interface.

### Problem Statement 6 (New Idea Track): PS-01 — Prescription Understanding Agent
- **Source**: Healthcare Hackathon Track 2026 (Healthtech Beyond Fitness)
- **Core Challenge**: Patients often leave OPD visits with handwritten or abbreviated prescriptions and struggle to understand medicine names, dosage, frequency, and timing.
- **Mandate**: Assistive AI system that converts prescriptions into a clear, patient-friendly medication schedule after human verification.
  - *Flow*: Prescription image → Medicine & instruction extraction → User/Human verification step → Dosage/timing schedule → Patient/caregiver plan.
  - *MVP / Outcomes*: Prescription upload, medicine/instruction extraction, human verification step, daily medication schedule, patient-friendly explanation, caregiver/shareable view.
  - *Bonus*: Hindi/Indic languages, voice instructions, pictograms (morning/afternoon/night), missed-dose tracking, reminder workflow.
  - *Constraint*: The system must NOT diagnose diseases or recommend new medicines.
- **Swadhikaar Alignment**: Direct extension of Swadhikaar Track 1 (Gemini Vision OCR & advisory 16-rule drug-drug interaction checker).

### Problem Statement 7 (New Idea Track): PS-02 — PM-JAY Hospital Readiness Agent
- **Source**: Healthcare Hackathon Track 2026 (Healthtech Beyond Fitness)
- **Core Challenge**: PM-JAY (Ayushman Bharat) beneficiaries know they are entitled to healthcare support but struggle to understand which hospital to visit, what documents to carry, and what to expect during the hospital process.
- **Mandate**: AI-assisted hospital-readiness tool taking patient location & care requirements to generate a practical preparation plan using PM-JAY dataset.
  - *Flow*: Location + Care requirement → Suitable empaneled hospitals → Required documents checklist → Hospital visit workflow & steps → Preparation checklist.
  - *MVP / Outcomes*: Patient/location profile, hospital information source, specialty-based filtering, document checklist, hospital visit workflow, plain-language PM-JAY guidance.
  - *Bonus*: Hindi/Indic language, voice assistant, ASHA/caregiver mode, map-based navigation, bounded RAG over official PM-JAY documents.
  - *Constraint*: No claims processing, medical diagnosis, or unsupported eligibility/coverage decisions.
  - **Swadhikaar Alignment**: 100% philosophical & technical match with Swadhikaar's Tricolor ABHA Digital Health Card, citizen rights orientation, and Indic voice intake.

---

## 3. The 5 Polish & Implementation Tracks

| Track | Title | Description & Delivered Capabilities | Primary PS Source |
| :---: | :--- | :--- | :--- |
| **Track 1** | **Live Camera & Vision AI OCR + Drug Interaction Checker** | Replaced mock text with live camera capture / file drag-and-drop powered by **Google Gemini Vision AI** (`gemini-2.5-flash`). Extracts medications, dosages, lab analytes, and runs an **advisory 16-rule drug-drug interaction checker** (curated pairs; no allergy engine, not pharmacopoeia-sourced). Synced across Kiosk, Doctor Queue, and Patient Portal. | SIH26047 |
| **Track 2** | **Hands-Free Auto-Spoken Audio Intake (`useKioskSpeech`)** | Automated speech synthesis and recognition engine in Hindi and English. Speaks intake questions out loud for illiterate/elderly walk-ins, captures spoken responses, speaks audio confirmations, and advances zero-touch. | Rime PS & Lenovo LEAP (Theme 2) |
| **Track 3** | **Live Moving Ambulance Map on Emergency Dispatch** | High-fidelity Leaflet map (`LiveAmbulanceMap`) with animated vehicle traveling along road geometry, live telemetry HUD (speed, distance, ETA countdown), flashing emergency strobe beacon, and real-time synchronization across `/admin/dispatch`, `/doctor/kiosk-queue`, and `/patient/sos`. | IIT Guwahati (psadditional) |
| **Track 4** | **Official Tricolor ABHA Card & ABDM Sandbox Simulator** | Authentic NHA Ayushman Bharat Digital Health Card with national tricolor emblem, QR code, and KYC badge. Interactive sandbox simulator executing NHA Milestones **M1, M2, and M3** with expandable FHIR R4 JSON bundle viewer. | SIH26133 |
| **Track 5** *(NEW)* | **Community Health Trends & Outbreak Surveillance Dashboard** | Real-time epidemiological intelligence analyzing medical reporting data across UP districts (Lucknow, Varanasi, Gorakhpur, Kanpur, etc.). Detects syndromic disease spikes (fever/dengue, respiratory/AQI, gastrointestinal), tracks community lifestyle/NCD risks (hypertension, diabetes), and triggers automated early-warning alerts for health authorities. | Lenovo LEAP (Theme 3.3) |

---

## 4. Priority Shifts Across Hackathons

### Phase 1: SIH & Rime Baseline
- Focus was building the core MediKiosk intake and conversational voice engine.

### Phase 2: IIT Guwahati Emergency Seam Focus
- **Priority 1**: Track 3 (Live Moving Ambulance Map & acute emergency seam).
- **Priority 2**: Track 1 (Prescription OCR).
- **Priority 3**: Track 2 (Voice Kiosk).
- **Priority 4**: Track 4 (ABDM Export).

### Phase 3: Lenovo LEAP 2026 (AKTU Lucknow & IndiaAI Mission) Focus
- **Priority 1 (Theme 3.3)**: **Track 5 — Community Health Trends & Outbreak Surveillance Analytics** (analyzing medical reporting data for public health trends).
- **Priority 2 (Theme 2 & Theme 3.1)**: **Track 2 — Digital Inclusion & Verified Vernacular Voice AI** (hands-free Hindi intake for elderly and illiterate rural citizens; hallucination-free clinical triage).
- **Priority 3 (Theme 3.2)**: **Preventive Lifestyle & Habit Profiling** (*Dashavidha Pariksha* + Chronic NCD risk tracking).
- **Priority 4 (Theme 3 Safety)**: **Track 1 — Vision AI Prescription OCR & Drug-Interaction Safety**.
- **Priority 5 (Acute Emergency)**: **Track 3 — Live Moving Ambulance Map on Emergency Dispatch**.
- **Priority 6 (National Rail)**: **Track 4 — ABDM Interoperability & Official ABHA Card**.

---

## 5. Prototype & Demo Screenshots Checklist for Presentations

> ⚠️ **Screenshots are NOT yet committed to `docs/screenshots/`.** The links below are placeholders pending capture; the "Status" column is aspirational, not verified. Do not present these as captured evidence until the PNGs exist.

| Screen / Feature | Route / Location | Repository File Link | Status |
| :--- | :--- | :--- | :--- |
| **Outbreak Alert Banner** | `/admin/dashboard` | [01_admin_dashboard_outbreak_banner.png](file:///c:/ace/products/swadhikaar/docs/screenshots/01_admin_dashboard_outbreak_banner.png) | ✅ Verified & Captured |
| **UP District Surveillance Matrix** | `/admin/trends` | [02_up_district_surveillance_matrix.png](file:///c:/ace/products/swadhikaar/docs/screenshots/02_up_district_surveillance_matrix.png) | ✅ Verified & Captured |
| **Syndromic Epidemic Curves** | `/admin/trends` | [03_syndromic_epidemic_curves.png](file:///c:/ace/products/swadhikaar/docs/screenshots/03_syndromic_epidemic_curves.png) | ✅ Verified & Captured |
| **Lifestyle & Habit Profiling (PS 2)** | `/admin/trends` | [04_lifestyle_habit_profiling_ps2.png](file:///c:/ace/products/swadhikaar/docs/screenshots/04_lifestyle_habit_profiling_ps2.png) | ✅ Verified & Captured |
| **AI Public Health Advisory for CMO** | `/admin/trends` | [05_ai_public_health_advisory_cmo.png](file:///c:/ace/products/swadhikaar/docs/screenshots/05_ai_public_health_advisory_cmo.png) | ✅ Verified & Captured |
| **Simulated Outbreak Surge Alert** | `/admin/trends` | [06_simulated_outbreak_surge_alert.png](file:///c:/ace/products/swadhikaar/docs/screenshots/06_simulated_outbreak_surge_alert.png) | ✅ Verified & Captured |
| **Export IDSP/NHA Surveillance Report** | `/admin/trends` | [07_export_idsp_nha_report.png](file:///c:/ace/products/swadhikaar/docs/screenshots/07_export_idsp_nha_report.png) | ✅ Verified & Captured |
| **Kiosk Step 2 (DPDP Act Consent)** | `/kiosk` | [08_kiosk_step2_dpdp_consent.png](file:///c:/ace/products/swadhikaar/docs/screenshots/08_kiosk_step2_dpdp_consent.png) | ✅ Verified & Captured |
| **Kiosk Step 3 (Auto-Spoken Voice Intake)**| `/kiosk` | [09_kiosk_step3_voice_interview.png](file:///c:/ace/products/swadhikaar/docs/screenshots/09_kiosk_step3_voice_interview.png) | ✅ Verified & Captured |
| **Kiosk Step 4 (Prescription Camera Scan)** | `/kiosk` | [10_kiosk_step4_prescription_scan.png](file:///c:/ace/products/swadhikaar/docs/screenshots/10_kiosk_step4_prescription_scan.png) | ✅ Verified & Captured |
| **Kiosk Step 4 (Gemini Vision OCR Extraction)** | `/kiosk` | [11_kiosk_step4_gemini_vision_ocr.png](file:///c:/ace/products/swadhikaar/docs/screenshots/11_kiosk_step4_gemini_vision_ocr.png) | ✅ Verified & Captured |
| **Kiosk Step 4 (24-Point Drug Safety Checked)** | `/kiosk` | [12_kiosk_step4_drug_interactions_checked.png](file:///c:/ace/products/swadhikaar/docs/screenshots/12_kiosk_step4_drug_interactions_checked.png) | ✅ Verified & Captured |
| **Kiosk Step 5 (ABDM FHIR R4 Bundle Export)** | `/kiosk` | [13_kiosk_step5_abdm_fhir_export.png](file:///c:/ace/products/swadhikaar/docs/screenshots/13_kiosk_step5_abdm_fhir_export.png) | ✅ Verified & Captured |
| **Official Tricolor ABHA Health Card** | `/patient/records` | [14_patient_records_abha_card.png](file:///c:/ace/products/swadhikaar/docs/screenshots/14_patient_records_abha_card.png) | ✅ Verified & Captured |
| **Doctor OPD Queue & Triage Console** | `/doctor/kiosk-queue` | [15_doctor_kiosk_queue.png](file:///c:/ace/products/swadhikaar/docs/screenshots/15_doctor_kiosk_queue.png) | ✅ Verified & Captured |
| **MediKiosk Check-In & Stepper** | `/kiosk` | [16_kiosk_terminal_checkin.png](file:///c:/ace/products/swadhikaar/docs/screenshots/16_kiosk_terminal_checkin.png) | ✅ Verified & Captured |
| **Portal Sign In & Role Presets** | `/login` | [17_login_portal_presets.png](file:///c:/ace/products/swadhikaar/docs/screenshots/17_login_portal_presets.png) | ✅ Verified & Captured |
| **Live Moving Ambulance Telemetry & Route Map** | `/doctor/kiosk-queue` | [18_live_moving_ambulance_telemetry.png](file:///c:/ace/products/swadhikaar/docs/screenshots/18_live_moving_ambulance_telemetry.png) | ✅ Verified & Captured |

---
*End of Master Log. Keep this document updated whenever requirements or hackathon themes expand.*
