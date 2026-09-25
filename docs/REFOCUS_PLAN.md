# Swadhikaar Refocus Plan — align on PS-01 & PS-02

> Working plan. Annotate freely — mark your POV in the **"Your decision"** columns.
> Created 2026-09-23. No code has been changed yet except where noted.

## Decisions locked
- **(1) PS-01 first, PS-02 second.** PS-01 has a real head-start (OCR extraction works); PS-02 is greenfield but reuses facilities/maps/voice.
- **(3) Remove the fake "108 ambulance" map from the OPD kiosk + `doctor/kiosk-queue` flow.** Keep the real ambulance map in the acute-dispatch surfaces only.
- **(4) This document is the annotatable plan of record.**
- **Nothing is parked or deleted — every working feature stays LIVE.** This is one product with many doors; we still need every PS's features. We only (a) relabel mock/over-claimed surfaces honestly and (b) fix incoherent placements. *(Updated 2026-09-23: parking dropped at user's direction — don't hide things that work.)*

## Framing
This is a well-built product that sprawled across 7 problem statements — not a junk pile. EOS is the most fully-real subsystem (real RLS hardening, honest `SIMULATED:` provenance labels, one canonical FHIR builder reused by the mock gateway). The real debt is small: **3 duplications, 3 incoherences, one honesty/labeling gap.** The job is focus + consolidation, not a rewrite.

---

## 1. Product map (every track, as an asset)

| Track | Key pieces | Status | Disposition |
|---|---|---|---|
| **T1 — Case-taking + Kiosk OCR** (PS-01 seed) | `kiosk`, `api/ocr`, `document-capture-modal`, `case-session`, `case-summary`, `doctor/kiosk-queue`, `doctor/review`, migr. 016/017 | LIVE | **SPINE** → PS-01 base |
| **T4 — ABDM / FHIR** | `export-abdm/bundle.ts` (REAL FHIR R4), `abdm-gateway` (mock), `abha-card` (mock), `admin/reports` | LIVE + mock | Keep builder, relabel mocks |
| **T2 — Voice** | LiveKit agent (Deepgram + Gemini + Murf, 11 verified Indic langs), `start-voice-call`, `voice-agent-widget`, `workflows`, `use-kiosk-speech` | LIVE | Keep → reusable for both PS voice bonuses |
| **T3 / EOS — Emergency / acute** | `patient/sos`, `admin/dispatch`, `fleet`, `facility/inbox`, `seam-trigger`, `incident-*`, `route-leg`, acute migr. 002–015, scene-photo, ambulance map | LIVE (most-real) | **Keep live** |
| **T5 — Outbreak trends** | `admin/trends` (hardcoded `UP_DISTRICTS_DATA`) | demo-mock | Keep live + relabel "illustrative" |
| **L4 — Env / agri** | `air-quality` (real), `heat-advisory` (real), `agristack-mock`, `admin/cross-domain`, `admin/map` | mixed | Keep live |
| **ASHA screening** | `asha/*`, `risk-predict`, offline outbox, PS-3 CSV | LIVE (offline-capable) | Keep live → feeds PS-02 caregiver-mode bonus |
| **Vaccinations** | `doctor/vaccinations` | paused-incomplete | Keep live |
| **Finance narrative** | `admin/finance` (hardcoded projections) | demo-mock | Keep live; later → PM-JAY cost story |
| **Shared infra** | auth, `dashboard-layout`, `use-supabase`, consent, `patients`, migr. 000/001/006/010, notif outbox, audit | LIVE | Keep |
| **PS-01 target** | medication schedule / verification / plan / reminders | MISSING | **Build (first)** |
| **PS-02 target** | PM-JAY hospital readiness | MISSING | **Build (second)** |

---

## 2. Track disposition — RESOLVED: keep everything that works LIVE

Decision (2026-09-23): **no parking.** If a feature works, it stays in the product and in the nav — we still need every PS's features; this is one product with many doors, not a single-PS app. Focus on PS-01/PS-02 means we *build there first*, not that we hide the rest.

So the only actions against the other tracks are:
- **Relabel** mock / over-claimed surfaces honestly (trends "illustrative", ABDM "not certified", etc.) — see §3. They stay live, just truthful.
- **Fix** the one incoherent placement (the fake ambulance map in the OPD kiosk flow — decision 3). The real map stays live in acute dispatch.
- **ASHA/caregiver mode** is a PS-02 bonus, so ASHA feeds directly into the PS-02 build rather than sitting idle.

Everything else — EOS emergency, vaccinations, Layer-4 env/agri, trends, finance — **stays live and untouched.**

---

## 3. Real debt — duplication / incoherence (fix during consolidation)

**True duplication (one canonical home):**
1. **Risk engine written twice** — `risk-predict` edge fn + `components/asha/risk.ts` ("offline mirror"); drift already noted in `use-asha.ts:168`. → shared constants module + cross-check test.
2. **3 Leaflet maps sharing zero code** (`operations-map`, `live-ambulance-map`, `patient-map`); the *honest* route renderer (`patient-map`) is dead while the *fabricated-route* one is everywhere. → one `<BaseIncidentMap>`, fold the honest route mode in.
3. **5 admin dashboards re-derive the same KPIs inline**; `operations` and `coordination` use an identical hook set. → one `use-program-metrics` selector; merge `coordination` into `operations`.

**Incoherence ("sense nahi banata"):**
4. **Fake "108 ambulance en route" map inside the OPD kiosk flow** — hardcoded Lucknow (`kiosk:874`) and Guwahati (`kiosk-queue:893`), no real incident. → **remove (decision 3).**
5. **Dead consent guard** — `patient/consent.isMandatory()` checks `scope in ('mandatory','core')` but the writer sets `scope='case_session'`, so no consent is ever mandatory. → key mandatory-ness off `CONSENT_PURPOSES`.
6. **Two deferred-delivery queues** (`voice_calls` vs `notification_outbox`) — justified for now; flag for eventual merge.

**Over-claims to relabel to the `SIMULATED:` standard:** "24-point drug engine" (really 16 substring rules, no allergy check); hardcoded "0 contraindications" ribbon; unscannable `abha-card` QR under "SCAN TO VERIFY"; fabricated `abdm_reference`; the dead 18-row "✅ Verified & Captured" screenshot table.

---

## 4. Industry grounding (web-sourced) — adopt / stop-claiming

**PS-01 (prescription):**
- Parse SIG (`OD/BD/TDS/QID/HS/SOS/PRN/q6h`) → normalized `{morning,noon,evening,night, with_food, prn, duration}`; render **only** as explicit times (USP `<17>`: "1 in the morning, 1 at night" — never "BD"). India: `OD` = *once daily*, not "right eye."
- Hard-code the **ISMP / Joint Commission do-not-use list**; never show raw `OD/U/IU/µg/HS/QD`/naked decimals to a patient; ambiguous → human verifier.
- **Interactions = advisory only**, surfaced to a pharmacist ("flagged for review"), never directive → stays inside PS-01's no-diagnosis constraint AND out of CDSCO SaMD regulation.
- **NLM drug-interaction API shut down Jan 2 2024** — don't use it. **RxNorm/RxNav** (free) for name normalization but US-centric → need an **Indian brand→molecule table** + **CDSCO banned-FDC** check. **openFDA** + **ONC High-Priority DDI list** for advisory flags. **DrugBank** = paid.
- **Pictograms:** USP (81, free) / FIP — reinforce text+audio, **never sole channel**; comprehension-test per language.
- **MVP = Medisafe pattern:** 4-quadrant daily pillbox, persistent timezone-aware reminders, taken/skipped log, refill alerts, "Medfriend" caregiver auto-notified on missed dose.

**PS-02 (PM-JAY):** *(no official structured API — plan for public search + district-PDF ingestion)*
- Data: `pmjay.gov.in` **Find Hospital**, **Hospital Empanelment Module** `hospitals.pmjay.gov.in`, per-district empanelled PDFs (Hospital ID, name, type, specialties, phone), **HBP 2.2 package master** as the specialty taxonomy. Carry an "as-on date" freshness field.
- Documents (official): **Ayushman card + Aadhaar + ration card**; biometric-waiver form for ICU/immobile.
- Journey (NHA Process Flow): eligibility → PM-JAY kiosk / Ayushman Mitra (PMAM) verifies via BIS → consult → pre-auth (≤6h) → cashless → discharge → 15-day post-discharge cover.
- **Eligibility/coverage = deep-link only** to `beneficiary.nha.gov.in` / `mera.pmjay.gov.in` / 14555 — never compute (hard constraint).
- **ABDM ≠ PM-JAY.** ABHA = health ID; PM-JAY = insurance/empanelment. Stop conflating.

**Standards / honesty:** a real ABDM bundle needs NRCES FHIR IG `ndhm.in#6.5.0` + Sandbox milestones — honest label for what we have = "FHIR R4-shaped draft, not ABDM-certified." Bounded RAG must enforce grounding **in code** (deterministic citation check + refuse-out-of-corpus), not in the prompt. DPDP 2023 does **not** specially protect health data — don't claim it does; use context-adaptive "not medical advice" disclaimers with active emergency escalation.

---

## 5. Workstreams (sequenced)

- **WS0 — Honesty pass** (fast, low-risk): relabel the six over-claims; fix the dead consent guard + the `warning`/`effect` field bug; fix docs (delete duplicated PS block, "5 vs 7", dead screenshot table; collapse `PRODUCT_TRACKS_LOG.md` to a pointer).
- **WS1 — Coherence fix (no parking):** all working features stay live. Remove only the fake "108 ambulance" map from the OPD kiosk + `kiosk-queue` (decision 3); the real map stays in acute dispatch.
- **WS2 — Consolidate** the 3 duplications (§3 #1–3) to one canonical home each.
- **WS3 — PS-01 ✅ COMPLETE (MVP + bonus, 2026-09-23):** SIG→time-grid parser (`lib/clinical/frequency.ts`) → editable verification gate → pictogram schedule → plain-language plan → voice readback (`lib/speak.ts`) → caregiver Share (Web Share) → reminders as a downloadable **.ics** (native phone alarms; deliberately NOT `voice_calls`, which auto-dials) → missed-dose tracking (localStorage per-dose on records) → verified edits persisted as canonical frequency via `POST /api/verify-medications` (no migration). Diagnostic notes stripped; interactions advisory. 83/83 tests, `next build` ✓.
- **WS4 — PS-02 (next):** real empanelled-hospital data → location+specialty finder → document checklist → visit steps → plain-language guidance → bonus bounded RAG; reuse facilities/maps/voice/ASHA. **Needs a data-source steer first** (no free AB-PMJAY API).

## 6. Open items
- **§2 resolved:** no parking — all working features stay live; ASHA feeds the PS-02 caregiver bonus.
- WS0 (honesty pass) + decision-3 map removal — **in progress** (approved, independent of the build).



