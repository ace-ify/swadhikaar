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

-- 4. The board starts empty, or Act 4 opens on last night's test cases.
select count(*) as leftover_incidents from incidents;
-- If not 0:  delete from incidents where is_simulated;
--            delete from facility_reliability;   -- test timeouts skew the scores

-- 5. Ambulances are free, or the first case finds none.
select count(*) filter (where available and assigned_incident_id is null) as free,
       count(*) as total from fleet_units;
-- Expect 48 / 48. If not:
--   update fleet_units set available = true, assigned_incident_id = null;

-- 6. The hospital login is wired to a hospital. MUST return a row.
select u.email, f.name, s.can_accept
  from facility_staff s
  join auth.users u on u.id = s.user_id
  join facilities f on f.id = s.facility_id;
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

## Act 4 — A live emergency, end to end (4 min)

The act that did not exist last week. Two browser windows, side by side:

- **left:** `/admin/dispatch`, signed in as admin
- **right:** `/facility/inbox`, signed in as the hospital account (see
  [USERS_AND_ROLES.md](USERS_AND_ROLES.md) — one Dashboard user plus one SQL call)

**On the left,** press **Road accident, Dispur**. Then stop talking and let them watch
the timer.

What to say, in this order, because each line is answering the question the last one
raised:

1. *"Nobody typed 'critical'. The database read a red triage tag, the words 'head
   injury', and SpO2 88 with a GCS of 7 — and decided. An intake clerk cannot
   downgrade that."*
2. *"Three hospitals were asked at the same time, not one after another. A critical
   case cannot spend two minutes waiting for one polite refusal."*
3. Point at the countdown. *"Forty-five seconds. That deadline is a timestamp in the
   row, not a stopwatch in the browser — so a page refresh cannot restart it and the
   sweep that fires when it expires agrees with what you are reading."*
4. Tap **How this was worked out** on the first hospital. *"Six of these numbers come
   from OpenStreetMap or from our own dispatch history. Beds, doctors on duty and
   blood stock say 'made up for the demo' — no public source publishes them, so their
   weight is shared out across the six that are real rather than quietly invented."*

**On the right,** the same case is already sitting in the hospital's inbox with its
own countdown. Press **Accept patient**.

**Back on the left**, without touching anything:

- the other two hospitals flip to **went elsewhere** — one transaction, so a losing
  hospital can never sit on "waiting" for a case somebody else took
- the ambulance section appears by itself: **8 crews asked, 3 minutes to answer**
- the activity list has written every step, in order

*"The ambulances are simulated and the screen says so. There is no ambulance GPS feed
in Assam we can legally read. Everything above that line — the hospitals, the
distances, the routing to a trauma centre — is real data."*

**If the ambulance says "no ambulance nearby":** that is the honest answer, not a
failure. Say *"the receiving hospital has no vehicle stationed with it, so the engine
borrows from the next hospital on its list; if none of them have one either it stops
and asks for a human rather than pretending."*

### Then the SOS button (1 min)

`/patient/sos` on a phone-shaped window. Hindi first, English underneath, **112**
always at the top.

*"This is the one screen a person holds in an emergency. The phone network is the
fallback that does not depend on us, so calling 112 is never more than one tap
away — and it works even when everything we built is down."*

Press one. It goes through a server function, never straight into the table: the
phone has no permission to write an incident. *"Which is why our rate limit can
actually stop something. The reference implementation writes from the client, so its
limiter runs as a parallel trigger and always arrives after the alerts have gone
out."*

---

## Act 5 — The seam (1 min)

`/admin/seam-trigger`. The join between the emergency and the year after it: closing
an incident creates the patient record, the FHIR resources and the Day 1/3/7/14/30
recovery calls in one step.

*"An emergency that ends at the hospital door is where most systems stop. This is the
part that does not."*

---

## Act 6 — Close (1 min)

*"Four layers, one patient record. Weather is live, telephony is live, the facility
map is OpenStreetMap, the voice speaks ten Indic languages including Assamese, an
emergency reaches three hospitals in under two seconds, and every advisory writes an
audit row saying which number made the decision.*

*What is not done: no clinician has signed off the call scripts or the triage
thresholds. That is the largest gap and no amount of infrastructure closes it. SMS and
push have nowhere to send — the queue is built, retries and all, and the credentials
are missing. The ambulances are simulated. The next step is a clinical review, not
another feature."*

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
- Say the ambulances are real. The engine is; the vehicles are seeded and the screen
  badges them.
- Say SMS "goes out". It is queued with retries and parked, because no gateway is
  configured. The console says "not sent" for exactly that reason — show it if asked.
- Cite `docs/SPRINT.md`. It is stale.

---

## If the dispatch demo goes wrong

**Board is empty after pressing a preset** — check the browser console for a 401. That
is the anon key, not the engine; see the key note in
[USERS_AND_ROLES.md](USERS_AND_ROLES.md).

**Timer shows "over — moving on" and nothing advances** — the cron sweep runs four
times a minute, so up to 15 s of overdue is normal. Longer than that means pg_cron is
not running: `select jobname, active from cron.job;`.

**Facility inbox says "not linked to a hospital"** — the account has the role but no
`facility_staff` row. One call fixes it:
`select grant_app_role('<email>', 'facility_staff', 'GMCH Emergency Centre');`

**Everything looks stuck** — open a case from the console instead of the phone. The
console path is two calls and no geolocation prompt.
