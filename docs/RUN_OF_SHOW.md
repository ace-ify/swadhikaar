# Round 2 run of show — 28 Aug 2026

STPI x Techniche, IIT Guwahati. Numbers verified 2026-08-25.

**Before you start, read [LIMITATIONS.md](LIMITATIONS.md).** Every claim below is
either sourced or labelled, and a judge who catches an unlabelled simulation will
stop believing the rest. Say "simulated" out loud when it is simulated.

---

## Pre-flight, the morning of

Run these. Do not skip the last one.

```sql
-- 1. Nothing is queued to dial. MUST be 0, or the cron rings phones mid-demo.
select count(*) from voice_calls
 where status in ('scheduled','in_progress') and scheduled_for <= now();

-- 2. Every path still has a cohort.
select 'heat Muzaffarpur', count(*) from heat_risk_cohort('Muzaffarpur')
union all select 'flood Guwahati', count(*) from flood_risk_cohort('Guwahati')
union all select 'flood Patna',    count(*) from flood_risk_cohort('Patna');
-- Expect 16 / 51 / 34.

-- 3. No routable phone numbers exist. MUST be 0.
select count(*) from patients where phone !~ '^\+9155';
```

Then, **the one that decides your script**: dry-run the Guwahati flood advisory and
read the rainfall.

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/heat-advisory" \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY" -H "Content-Type: application/json" \
  -d '{"district":"Guwahati","hazard":"flood","dry_run":true}'
```

`triggered` is driven by live weather and **will not always be true**. On 2026-08-25
it read 36.5mm with 16 of 16 wet slots in the morning and 20.1mm with 9 wet slots by
afternoon — the same day. Branch accordingly:

- **`triggered: true`** — run Act 2 as written. This is the strong version.
- **`triggered: false`** — tick **Drill** in the UI and say so plainly: *"the gate
  is not met right now, so I'm overriding it to show you the path; the response
  comes back marked as a drill."* The UI renders a red **Drill** badge and the audit
  row records `forced: true`. That is more convincing than a system that always
  fires, because it shows the gate is real.

Never demo a non-dry-run advisory unless you intend the calls to be placed.

---

## Act 1 — Heat, Muzaffarpur (2 min)

**Why open here:** it is the one screen where the system disagrees with a
thermometer and is right.

`/admin/cross-domain` → district **Muzaffarpur** → hazard **Heat** → Dry run.

The reading: **40.73°C felt at 34.23°C air temperature, 90% humidity.** Cohort of
**16 outdoor workers**.

The line to say: *"IMD's heatwave line for the plains is 40°C dry bulb. A
thermometer here reads 34. Nobody would issue a warning. But at 90% monsoon humidity
sweat stops evaporating, so a field labourer is experiencing 41. If we gated on the
number a thermometer shows, these 16 people get told there is no heat risk on the
day they are most at risk."*

Point at the response showing **both** numbers side by side. That is the whole
argument: the number that made the decision and the number a thermometer shows are
both visible, so the judgement is auditable.

---

## Act 2 — Flood, Guwahati, in their own city (3 min)

Same screen → district **Guwahati** → hazard **Flood** → Dry run.

Expect `resolved_place: "Guwahati, Assam"` — proof it hit a real gazetteer rather
than a lookup table we wrote.

Two things to land:

**1. The gate is persistence, not depth.** *"Nothing in Assam clears IMD's
heavy-rain line of 64.5mm in 24 hours this week. If we gated on depth alone we would
be picking whatever number makes a demo fire. On the Brahmaputra floodplain the
mechanism is saturation — 36 hours of moderate rain floods where one burst drains.
So the gate is 40mm of depth **or** 12 of 16 three-hourly slots raining. This
morning it was 16 of 16."*

**2. Cohort of 51, and the reason travels with each person.** Each row carries
`reason`: `high clinical risk`, `active care episode`, or `newborn in household`.
Not "everyone in the district" — a defensible list with a stated basis per name.

Then the sentence that matters most here: *"36 of these 51 speak Assamese, and the
call is in Assamese — a real Murf voice, not Bengali standing in for it. We checked:
Sarvam has 11 languages and no Assamese, Google Cloud has none. Murf's streaming
catalogue does."*

**Say the caveat in the same breath:** *"Speech recognition falls back to Bengali,
because Deepgram has no Assamese model. So we speak Assamese and we listen in
Bengali. For an outbound advisory that is the right trade; for a two-way
consultation it would not be."*

Note the dashed rings when you move to the map: **these 60 Assam records are
simulated**, and the generator is a migration in the repo. Guwahati's rainfall is
real; its patients are not.

---

## Act 3 — Operations map (2 min)

`/admin/map`.

- **302 patients**, 240 plotted, colour-coded by risk
- **537 facilities** from OpenStreetMap — real names, real coordinates
- **250 dispatch-eligible**; the other 287 are labs, morgues, dental colleges, AYUSH
  and veterinary clinics that OSM also tags `amenity=hospital`
- **3 open escalations** ringed in purple, on the patient who raised them

The credibility beat: *"OpenStreetMap tags a morgue, a dental college and a
veterinary clinic all as amenity=hospital. Our first load ranked 'GMCH Postmortem
Ward' as the largest hospital in Guwahati at 1387 beds. So there is a
dispatch_eligible flag, and the rows stay — deleting them would turn a mirror of
OSM into a curated list pretending to be one."*

If asked why bed counts are hidden by default: *"Beds, doctors on duty, specialists
and blood units have 0% coverage in every public source — that data lives in each
hospital's HMIS. So we simulate it, label it, and rank on the three factors we can
actually source. Nine weighted factors where six are invented is worse than three
that are real."*

Hover a patient pin to show `approximate — locality centroid`. *"We do not know
where anyone lives. The source records carried a camp name and vitals, never an
address. Holding real household coordinates for 302 people with clinical risk
attached would be sensitive personal data under the DPDP Act, so nobody's house is
on this map by construction."*

**Then click a patient pin.** A panel ranks the five facilities that patient would
actually be sent to, each with three stated reasons.

*"Proximity, facility tier, recorded emergency capability. Three factors, and every
one of them comes from OpenStreetMap. Beds, doctors on duty, specialists, blood
units — 0% coverage in any public source, so they are not inputs. A nine-factor
score where six factors are invented looks more rigorous and is less true."*

From a Dispur patient the top result is **GMCH Emergency Centre**, then GMCH itself,
then Apollo. Worth saying why that ordering was hard: *"An emergency centre is the
receiving point, so it ranks first. But OpenStreetMap maps every building on a
teaching campus as its own hospital, and 'GMCH Pediatric Division' was outranking
Gauhati Medical College as the destination for an arbitrary acute case. Campus
sub-units are demoted now."*

---

## Act 4 — Acute seam (2 min)

`/admin/seam-trigger`. The Layer 1 ↔ Layer 2 join: an acute incident creates a
patient record and a follow-up protocol, so someone treated in an emergency does not
fall out of the system afterwards.

Have `/admin/operations` open in a second tab — escalations arrive over Supabase
realtime, which is live because `escalations` is in the `supabase_realtime`
publication with `replica identity full`.

---

## Act 5 — Close (1 min)

*"Four layers, one patient record. Weather is live, telephony is live, the facility
map is OpenStreetMap, the voice speaks ten Indic languages including Assamese, and
every advisory writes an audit row saying which number made the decision.*

*What is not done: no clinician has signed off the call scripts. That is the largest
gap and no amount of infrastructure closes it. The next step is a clinical review,
not another feature."*

Ending on the gap is deliberate. It is the answer to the question a good judge is
already forming, and saying it first is worth more than being asked.

---

## If asked

**"Is the data real?"** — Clinical measurements yes, 120 rows from the provided
dataset. Identities no, and the CSV has no name or address column, so they never
were. Assam's 60 patients are simulated and badged. Bed counts are simulated and
hidden by default. Weather, facility locations, telephony and the audit trail are
real.

**"Why not IMD?"** — No clean public API. IMD is the production path; we use
OpenWeather and label it, never dressed as IMD.

**"What breaks at scale?"** — Unknown above 51, which is the largest cohort
exercised. Honest answer, then the reason it is a fair question: the cron sweep is
serial.

**"Why one voice for most languages?"** — `en-IN-anisha` carries 11 locales, so a
household hears the same organisation in Hindi one week and Assamese the next.
Gujarati is the one gap and uses a native voice.

**If a live call is requested** — only with a phone you own, set that patient's
number first, and remember every other number is deliberately unroutable.

---

## Do not

- Trigger a non-dry-run advisory casually. It queues real calls into a cron that
  fires every five minutes.
- Claim Assamese speech *recognition*. Synthesis only.
- Show bed counts without saying "simulated".
- Cite `docs/SPRINT.md`. It is stale.
