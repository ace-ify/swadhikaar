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

- **Receiving facilities have a role and a screen, but no portal of their own.**
  `facility_staff` now exists as a role and as a table binding an account to one or
  more facilities, and `dispatch_offers` is the screen — a facility sees only its own
  offers, enforced by RLS. What is missing is the login route: `auth-context` still
  knows four roles, and there are no `/facility/*` pages, so accept and decline are
  driven from the ops console at `/admin/dispatch`. The authorisation is real either
  way: `accept_dispatch_offer` refuses a caller who is neither ops nor staff of that
  facility.
- **`triage-assess` is gone.** Deleted on 2026-08-26; the repo holds a 410 tombstone
  so nothing silently gets a second, weaker definition of "critical". The live
  severity ladder is `_CRITICAL_KEYWORDS_HI` in `backend/voice_agent/agent.py` (45
  keywords) plus `classify_incident_severity()` in the database. The deployed slug
  still needs removing in Dashboard → Edge Functions; the Management API is not
  reachable from this environment.
- **`patients.source_incident_id` has no foreign key, correctly.** Previously listed
  here as a defect; it is not. The values are external identifiers issued by the
  EOS-side acute system (`H-DEMO-MT75XGSS`), not references to our own `incidents`
  table, so a foreign key would reject exactly the rows it exists to describe. A
  check constraint enforces the rule that does apply: an `acute_incident` patient
  must carry the incident id that created them.
- **The incident layer is built; the transport around it is not.** `incidents`,
  `incident_dispatch`, `dispatch_offers`, `incident_responders`, `incident_events`
  and the wave engine all exist and are verified end to end — see
  [ACUTE_LAYER.md](ACUTE_LAYER.md). Still missing: any notification transport (offers
  land in the database and the console, nothing pushes), an ambulance leg, and an
  intake path other than the console's own presets.
- **Temperature is collected and never used**, and age and gender are collected and
  discarded. See [CLINICAL_REVIEW.md](CLINICAL_REVIEW.md) section 8.
- **The OpenStreetMap naming problem has now been handled in five places** — bed
  counts, map draw order, dispatch eligibility, dispatch ranking, and speciality
  routing — because OSM maps every building on a teaching-hospital campus as its own
  `amenity=hospital`, and because a facility's name is the only clue to what it
  treats. Five fixes by name-matching is the signal that the data wants a
  `parent_facility_id` resolved from OSM site relations at load time.

  Where the name-matching stops: a facility called **"Vision hospital"** is tagged
  `amenity=hospital` with 155 beds and no speciality tag. It looks like an eye
  hospital and may well be one — but "Vision" is also a common Indian hospital brand
  name, and OSM says *hospital*. It was offered a cardiac arrest at rank 8 of 15,
  only after three waves of better-matched hospitals failed to answer. That is the
  engine widening its search, not a misroute, and demoting it on the word alone
  would repeat the mistake corrected earlier: a speciality guess strong enough to
  promote is not automatically strong enough to exclude.
