# Clinical review packet

Every clinical decision rule in SwadhikaarOS, in one place, for a clinician to
accept, change or reject. **Nothing here has been reviewed by a clinician.** All of
it was chosen by an engineer from published thresholds, which is defensible and is
not the same as approved.

Ordered by how much harm an error causes, not by how the code is organised.

How to use this: for each item, write **ACCEPT**, or a corrected value, plus initials
and date in the sign-off column. Anything left blank stays flagged as unreviewed in
[LIMITATIONS.md](LIMITATIONS.md). A rejected item should be rejected in writing —
"this threshold is wrong" is more useful to us than silence.

Reviewer: ________________________  Qualification: ________________  Date: __________

---

## 1. Vital-sign danger signs — highest harm potential

Any one of these fires a referral, raises the risk band to High, and creates a
`CRITICAL` escalation visible to the on-call doctor. Added 2026-08-25 because
**before that date no measurement could trigger a referral at all** — 200/130 read
"Moderate" and 88% oxygen saturation read "Low".

Null-safe: an unmeasured vital never fires. Source: `supabase/functions/risk-predict/index.ts`,
mirrored in `frontend/src/components/asha/risk.ts`.

| # | Rule | Threshold used | Cited from | Sign-off |
|---|---|---|---|---|
| 1.1 | Hypertensive crisis | systolic ≥180 **or** diastolic ≥120 | ACC/AHA 2017 hypertension guideline | |
| 1.2 | Hypoxia | SpO₂ <90% | WHO emergency triage | |
| 1.3 | Hyperglycaemia | glucose ≥300 mg/dL | engineer's reading of hyperglycaemic emergency risk | |
| 1.4 | Hypoglycaemia | glucose ≤54 mg/dL | ADA level-2 hypoglycaemia | |
| 1.5 | Tachy/bradycardia | HR ≥130 or ≤40 bpm | general adult limits | |
| 1.6 | Respiratory distress | RR ≥30 /min | WHO | |

**Specific questions:**

- Is ≥180/≥120 right for a *community screening* context, where the next step is
  travel to a facility? Some guidance uses 180/110 for severe hypertension.
- 1.3 and 1.5 are the two we are least confident in. 300 mg/dL is a judgement call,
  not a guideline number.
- **Should a fever threshold exist?** Temperature is collected by the form and is
  currently not scored or flagged at all. This is the most likely omission.
- Should any of these be *immediate 108 ambulance* advice rather than "refer to a
  doctor now"? Right now the system never tells anyone to call 108 except on the
  patient SOS screen.

---

## 2. Symptom red flags

Same consequence as section 1. Source: `RED_FLAGS`.

| # | Finding | Trigger value | Sign-off |
|---|---|---|---|
| 2.1 | Severe chest pain | `chest_discomfort = severe` | |
| 2.2 | Breathlessness at rest | `breathlessness = at_rest` | |
| 2.3 | Frequent dizziness or blackouts | `dizziness_blackouts = often` | |

**Question:** the graded scale collects `moderate` chest discomfort, which scores
points but raises no flag. Is moderate chest pain in a rural adult a refer?

---

## 3. Risk band cutoffs

`overall_risk_score` 0–100, then: **≥50 High, ≥30 Moderate, otherwise Low.**

The score is a weighted mean of three domains: heart 0.35, diabetes 0.35,
hypertension 0.30.

**The known weakness, stated plainly:** because it is a mean, one catastrophic
domain is diluted by the other two sitting at their baselines. That is exactly how
200/130 scored 35.4. Section 1 works around this by flooring the band rather than
by fixing the arithmetic.

| # | Item | Current | Sign-off |
|---|---|---|---|
| 3.1 | High cutoff | ≥50 | |
| 3.2 | Moderate cutoff | ≥30 | |
| 3.3 | Domain weights | 0.35 / 0.35 / 0.30 | |
| 3.4 | Is a weighted mean the right shape at all, or should the band be the **worst** domain? | mean | |

---

## 4. Escalation ladder

Source: `escalationFor` in `frontend/src/components/asha/risk.ts`.

| Condition | Severity | Level | Sign-off |
|---|---|---|---|
| Any red flag or danger sign | CRITICAL | 3 | |
| Band High, no flag | HIGH | 2 | |
| Anything else | no escalation | — | |

**Question:** is "no escalation" right for Moderate? A Moderate band currently
produces advice on screen and no doctor-visible row.

---

## 5. Weather advisory gates

Source: `supabase/functions/heat-advisory/index.ts`.

### 5.1 Heat

Gate is **heat index ≥40°C**, not dry-bulb. Dry bulb is reported alongside.

Rationale: IMD's plains heatwave line is 40°C dry bulb, which is the wrong gate for
occupational heat stress — at 90% monsoon humidity sweat stops evaporating. A
measured Muzaffarpur case read 34.23°C air, 90% RH, 40.73°C apparent, and a dry-bulb
gate would have told 16 outdoor workers there was no risk.

| # | Item | Current | Sign-off |
|---|---|---|---|
| 5.1a | Gate on heat index rather than dry bulb | heat index | |
| 5.1b | Threshold | 40°C apparent | |
| 5.1c | Cohort: outdoor occupations only | farmer, daily wage labour | |

### 5.2 Flood

Gate is **≥40mm forecast over 48h OR ≥12 of 16 three-hourly slots raining.**

Rationale: nothing in Assam or Bihar clears IMD's heavy-rain line (64.5mm/24h) in
the demo window, so a depth-only gate means choosing a number that makes it fire.
Persistence is the floodplain mechanism — saturated ground stops absorbing.

| # | Item | Current | Sign-off |
|---|---|---|---|
| 5.2a | Persistence as an alternative trigger to depth | OR | |
| 5.2b | Depth threshold | 40mm/48h | |
| 5.2c | Persistence threshold | 12 of 16 slots | |

### 5.3 Who gets called in a flood

`flood_risk_cohort()` selects a patient in the district with a phone **and** any of:
high clinical risk, an active care episode (`follow_up_active`, `recovery`,
`opd_referred`), or a newborn in the household.

| # | Question | Sign-off |
|---|---|---|
| 5.3a | Are these the right three groups? | |
| 5.3b | Should pregnancy be a fourth? It is not currently recorded. | |
| 5.3c | Is a newborn household the right proxy for a postpartum mother? | |

---

## 6. Language approximations

These change what a patient hears. Verified against the providers on 2026-08-25.

| # | Language | What we do | Sign-off |
|---|---|---|---|
| 6.1 | Assamese | **Speaks** real Assamese (Murf `as-IN`). **Listens** in Bengali — Deepgram has no Assamese model. | |
| 6.2 | Urdu | Listens in Urdu. Speaks with a Hindi voice — no provider has an Urdu voice. | |
| 6.3 | Bhojpuri, Maithili | Treated as Hindi at both ends. **108 of 302 patients.** | |

**Question for 6.3:** is a Hindi advisory understood well enough by a Bhojpuri or
Maithili speaker for a health warning to land? This is the largest language
approximation in the system and the one we are least able to assess.

---

## 7. Call scripts

The advisory and follow-up call content lives in
`backend/voice_agent/prompts/system_prompts.py`. It is an LLM system prompt, not a
fixed script, so the exact words vary per call.

| # | Question | Sign-off |
|---|---|---|
| 7.1 | Is prompt-driven wording acceptable for clinical advice, or must advisory calls use fixed approved text? | |
| 7.2 | Does the prompt correctly refuse to diagnose or change medication? | |
| 7.3 | Should every advisory call end with "if X, call 108"? | |

---

## 8. Things deliberately absent

Listed so their absence is a decision on the record rather than an oversight.

- **No fever threshold.** Temperature is collected by the ASHA form and is used
  nowhere — it is not scored, not flagged, and not even sent to the scoring
  function, which has no `temperature` field to receive it.
- **No pregnancy status.** Not collected, so it cannot be a cohort factor.
- **No medication or allergy list.** The advisory never references medication.
- **Age and gender are collected and then discarded.** They are not scored and not
  persisted — the `patients` table has no column for either. A reviewer should
  assume the system does not know how old anyone is.
- **No ambulance dispatch anywhere.** The patient SOS writes a CRITICAL escalation
  and tells the patient to call 108 themselves. Nothing in the system claims
  otherwise — earlier copy did, and it was removed as a safety fix.
