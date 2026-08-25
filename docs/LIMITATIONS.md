# Limitations

What in SwadhikaarOS is real, what is generated, and what has never been tested.
Written so a judge, a clinician or the next developer can tell the difference
without reading the source. Last verified 2026-08-25.

The short version: **the plumbing is real and the population is partly invented.**
Weather, telephony, facility locations, the database, the cron and the FHIR export
all work against live systems. Patient identities do not exist, and neither does
hospital bed availability.

---

## Real

Verified against live systems on the date shown, not inferred from documentation.

| Thing | Evidence |
|---|---|
| **Clinical measurements** | 120 rows of vitals and computed risk scores from the provided dataset (`dataset/PS-3-Use-case-database-1.csv`). Blood pressure, glucose, BMI, waist circumference — measured at real health camps. |
| **Weather readings** | OpenWeather forecast API. Guwahati on 2026-08-25 read 36.5mm/48h with rain in 16 of 16 three-hourly slots. Every advisory response carries `weather.source`, which reads `openweather` or `simulated`. |
| **Facility identity and location** | 537 health facilities from OpenStreetMap via Overpass, across Guwahati and Patna. Names and coordinates are real: GMCH, PMCH, Tolaram Bafna Kamrup District Civil Hospital. |
| **District coordinates** | Nominatim (OpenStreetMap). Gandhi Maidan, Digha, Patna, Rampur/Muzaffarpur. |
| **Voice synthesis** | Murf FALCON. Every language in the database was synthesised end to end through the LiveKit plugin: Hindi 5.69s, Bhojpuri 5.85s, Maithili 5.25s, Urdu 5.33s, Assamese 6.01s, Gujarati 3.57s. |
| **Telephony** | LiveKit SIP trunk. Outbound calls are placed by a live `pg_cron` job every five minutes. |
| **Database, RLS, audit log** | Supabase Postgres 17.6. Row-level security is on; every advisory writes an `audit_log` row. |
| **FHIR export** | Real resource generation, reviewable in the admin UI. |

---

## Simulated — and why

Each of these is labelled in the UI wherever it appears. The label is the point:
simulated data is normal in a prototype, unlabelled simulated data is a lie.

### Patient identities — all 302

Names, phone numbers and ABHA IDs are generated. **The source CSV has no name,
phone, address, district or coordinate column** — only a health-camp name plus
vitals. So the identities were never real, and the clinical numbers attached to
them were.

### The Assam cohort — 60 patients

Marked `intake_source = 'simulated_cohort'` in the database and drawn with a dashed
ring on the operations map, with a `SIMULATED record` line in the tooltip.

They exist because Guwahati's flood gate fires on real rainfall but there were no
patients in Assam, so the whole Layer 4 path ended in "nobody to call". The
generator is a migration in this repo, so the population is auditable rather than
asserted. Language mix (36 Assamese, 12 Bengali, 6 Hindi, 6 English) approximates
Guwahati and exercises four different voice routes.

The other 242 patients are `intake_source = 'health_camp'` and carry the real
clinical measurements.

### Bed and staffing counts — all 537 facilities

`capacity_source = 'simulated'` on every row, and hidden behind a toggle on the map
that is **off by default**.

Measured OpenStreetMap tag coverage for these facilities:

| Field | Coverage |
|---|---|
| Name, coordinates | 100% |
| `addr:district` | 65% |
| `healthcare` type | 48% |
| `healthcare:speciality` | 4.8% |
| **Beds, doctors, specialists, blood units** | **0%** |

No public source publishes live Indian bed availability — it lives in each
facility's own HMIS. This is also why facility ranking uses three sourced factors
rather than nine: six of the nine would have been invented weights on invented
numbers.

### Patient coordinates — approximate by design, not simulated

`coord_source = 'locality_centroid'`. Each pin is a real locality centroid plus a
deterministic per-patient offset, so a locality's patients spread visibly instead
of stacking on one point.

These are **not** household locations. We never had addresses, and holding real
household coordinates for 302 people with clinical risk attached would be sensitive
personal data under the DPDP Act. Locality level is also simply what an operations
map needs.

### Phone numbers — deliberately unroutable

Every number begins `+9155`. Indian mobile numbers start 6–9 and 55 is not an
assigned STD code, so these look like phone numbers and cannot reach a subscriber.

This is a safety property, not cosmetics. `place_due_recovery_calls()` runs every
five minutes and dials any due row, and the numbers previously generated sat inside
live +916/7/8/9 ranges — one non-dry-run advisory could have called actual
strangers. To place a genuine demo call, set one patient's number to one you own.

---

## Approximations we chose knowingly

**Assamese speech recognition falls back to Bengali.** Murf FALCON has a real
Assamese voice, so the advisory *speaks* Assamese. Deepgram nova-3 has no Assamese
model, so what the patient says back is transcribed as Bengali — the nearest
Eastern Indo-Aryan language it supports. For an outbound advisory the speaking half
carries the message; for a two-way consultation this would not be good enough.

**Urdu speaks with a Hindi voice.** Deepgram transcribes Urdu natively, so
comprehension is right. No provider we can reach has an Urdu TTS voice, and spoken
Hindustani is common to both languages, so the audio is right even though the
scripts differ.

**Bhojpuri and Maithili are handled as Hindi** at both ends. Neither provider
models them. 108 patients speak one of the two, so this is the largest single
language approximation in the system.

**The flood threshold gates on persistence, not just depth.** Nothing in Assam or
Bihar clears IMD's heavy-rain line (64.5mm/24h) this week, so a depth-only gate
would mean picking whatever number makes a demo fire. Saturated ground stops
absorbing, so 36h of moderate rain floods where one burst drains. Either 40mm of
depth **or** 12 of 16 wet slots trips it.

**Weather is OpenWeather, not IMD.** IMD has no clean public API. IMD is the
production path; this is labelled as what it is and never dressed up as IMD.

---

## Not tested

- **No clinician has reviewed the advisory scripts or any clinical threshold.** The
  escalation cutoffs, risk bands, vital-sign danger signs and weather gates are
  engineering judgement drawn from published numbers. Every one of them is listed
  for sign-off in [CLINICAL_REVIEW.md](CLINICAL_REVIEW.md). This is the largest gap
  in the system and no amount of infrastructure compensates for it.
- **No real patient has ever received a call from this system.**
- **Load**: the largest exercised cohort is 51. Nothing is known about 10,000.
- **Accessibility**: the UI has font scaling and a language toggle; it has not been
  tested with a screen reader.
- **The advisory has never fired unattended.** Every run so far was manually
  triggered.

---

## Known open issues

- Three copies of the severity ladder exist independently; `triage-assess` is real,
  tested, and has no callers.
- `user_roles_role_check` has no role for a receiving facility, so hospitals cannot
  log in to see what was dispatched to them.
- `patients.source_incident_id` is a text column with no foreign key.
- The local `risk-predict/index.ts` is v1 while the deployed function is v2 — git is
  behind production for that one function.
