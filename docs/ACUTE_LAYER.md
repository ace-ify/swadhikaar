# Acute layer — port notes

The acute/SOS layer, ported from the EOS reference implementation
(`EOS-inspiration/`, Flutter + Firebase) onto Next.js + Postgres.

Read [LIMITATIONS.md](LIMITATIONS.md) for what is real vs simulated, and
[CLINICAL_REVIEW.md](CLINICAL_REVIEW.md) for the thresholds that need a clinician.

## What this is

A wave-based **offer/accept** dispatch engine. A facility is *offered* an incident
and may accept or decline; it is never silently assigned. That distinction is the
whole reason the model works — a hospital that cannot take a case says so in seconds,
instead of the case sitting assigned to a facility that will turn the ambulance away.

Offers go out in waves of N parallel candidates. If nobody answers before the wave
times out, the next N are offered. Wave size and fuse length are functions of
severity:

| severity | parallel per wave | fuse | max waves |
|---|---|---|---|
| critical | 3 | 45 s | 6 |
| high | 2 | 75 s | 5 |
| standard | 1 | 120 s | 4 |

A critical case is offered to three facilities at once because it cannot afford to
wait two minutes for one polite decline. A standard case goes one at a time, because
parallel offers cost a facility's attention and a stable patient can spend the time.
The numbers are EOS's.

## Where the port diverges, and why

Roughly half of EOS's known defects exist because Firestore cannot do transactions
across collections or enforce a state machine. Postgres can, so it does. Each
divergence below fixes something EOS's own code or docs admit to.

**`blocked` is not a status.** In EOS it is a dead state. Their rate limiter was
meant to write it, they backed out because a blocked incident drops out of other
devices' `whereIn` listeners and causes **missed alerts**, and now nothing writes it
and nothing can unblock it. Here suppression is a flag (`rate_limit_flagged`) and a
flagged incident still dispatches and stays visible.

**`expired` is a real enum member.** EOS coerces any unknown status string to
`pending` and carries a `rawFirestoreStatus` field to work around its own lossiness.

**Wave timeouts are absolute timestamps.** EOS recomputes `now() - notifiedAt >=
waveTimeoutMs`, so any write touching `notifiedAt` silently restarts the fuse. Their
docs measure the resulting escalation latency at 45–105 s for a 45 s timeout. Ours
stores `wave_timeout_at` and the sweep compares against it.

**The sweep runs 4×/minute.** EOS runs theirs every 60 s against a 45 s fuse, so a
critical case waits the fuse plus up to a full cron period. pg_cron's granularity is
one minute, so four staggered jobs give 15 s resolution.

**Expiry never deletes.** EOS archives-and-deletes unattended incidents at 60 minutes
and accepted-but-slow ones at 30, which destroys a genuine 90-minute extrication
mid-rescue. Here expiry only changes status, the window is 180 minutes, and an
incident with a live responder or an accepted dispatch is **immune at any age**.

**Accept and supersede are one transaction.** EOS accepts in a transaction and then
supersedes the rival inbox rows in a separate best-effort batch that only logs on
failure — so a losing hospital's console can sit on "pending" for a case already
accepted elsewhere. In Postgres that is one statement sequence and the bug cannot
exist.

**`fallback_notified` is cleared on every escalation.** EOS sets the equivalent flag
once and never resets it, so their documented "SMS fallback per wave" actually fires
once per incident.

**Reliability is actually written.** EOS's engine reads `rolling30dAcceptRate` and
defaults to 0.7 when absent — and **nothing in their entire repo ever writes that
collection**. So their reliability factor is the constant 0.7 for every hospital
forever: a weight that looks like learning and is arithmetic on a literal. A trigger
on `dispatch_offers` maintains ours. `superseded` is excluded from the denominator,
because a facility that lost a race was never given a chance to answer, and counting
it as a non-accept would punish exactly the facilities that get offered the most.

**Responders are a table, not an array plus one location slot.** EOS keeps
`acceptedVolunteerIds[]` (any number may accept) but only one
`volunteerLat`/`volunteerLng` pair, so a second responder silently overwrites the
first's position. Their own review flags it. Their withdraw also `arrayRemove`s the
volunteer and leaves the incident `dispatched` with zero responders — the worst lie
an ops board can tell. Here a trigger recomputes status from live participation.

**RLS enforces what their rules concede.** EOS's `firestore.rules` makes
`sos_incidents`, the assignments, `ops_hospitals`, reliability and the audit log
readable by **any authenticated user — full medical snapshot included** — deferred to
a "server-computed public views" roadmap that does not exist. And `ops_fleet_units`
is `allow write: if request.auth != null`, so any signed-in account can rewrite any
ambulance's status. Here a facility sees only incidents it was offered, a responder
only what they attend, and offers are engine-written with accept/decline behind
security-definer functions — which is what makes "only the current wave may accept"
enforceable rather than advisory.

## Scoring: nine factors, six of them real

EOS scores nine factors. Porting nine and inventing the inputs for six would be worse
than three honest ones. But sorting the factors by **where the data comes from**
changes the picture, and this was the useful discovery of the port:

**Sourced — because it is our own system's state, not a hospital's HMIS:**

| factor | source |
|---|---|
| proximity | real OSM coordinates + haversine |
| specialty | name-derived speciality tags (OSM's own tag: 4.8% coverage) |
| emergency | OSM `emergency` tag, tri-state |
| load | count of live offers in **our** dispatch table |
| reliability | accept rate from **our** offer history |
| freshness | `facilities.updated_at`, ours |

**Not obtainable from any public source** — 0% OSM coverage, lives in each facility's
own HMIS: **capacity** (beds), **staffing** (doctors on duty), **blood** (units).

Those three are **off by default** and their weight is redistributed across the
sourced six, so a score is never silently part-invented. Pass
`p_use_simulated_capacity => true` to demonstrate the complete nine-factor engine.
Every score returns a per-factor breakdown with a `source` field, and the simulated
ones are labelled `SIMULATED`.

### Speciality routing

`specialities_for_incident()` maps the incident's own words to speciality tags, so a
cardiac arrest reaches a heart hospital and a fracture does not. Verified: a Guwahati
cardiac arrest offers to **City Heart Hospital**, then GMCH and GMCH Emergency Centre
as general backup. A head injury with `required_services = {trauma, neurosurgery}`
put **Advance Neuro Science Hospital** at rank 1.

This also fixed the fifth appearance of the OpenStreetMap naming problem. Wave 1 of a
cardiac arrest had been offered to a fertility institute and a cancer institute — but
the same output surfaced three heart hospitals, which are exactly right for it. So
`speciality_only` as a blanket demotion was wrong: a speciality facility is the best
possible destination for its own speciality and a poor one otherwise. What was
missing was not a stricter exclusion but knowing **which** speciality.

Also found and fixed while reading real output: **"mini pet care", a veterinary
clinic, was dispatch-eligible for human emergencies.** The load script excluded
"veterinar" and "animal" but not "pet ".

## Objects

| object | purpose |
|---|---|
| `incidents` | the incident, with a medical snapshot copied at create time |
| `incident_dispatch` | one row per incident, PK = incident id, so re-running the engine is idempotent by construction |
| `dispatch_offers` | the per-facility inbox; a facility reads only its own rows |
| `incident_responders` | one row per responder, with their own position |
| `incident_events` | append-only audit; status transitions written by trigger so an actor cannot omit one |
| `facility_reliability` | accept/decline/timeout counts, maintained by trigger |
| `facility_staff` | binds a staff account to a facility |
| `open_dispatch()` | score, snapshot the tier policy, offer wave 0 |
| `accept_dispatch_offer()` | first writer wins; supersedes rivals in the same transaction |
| `decline_dispatch_offer()` | escalates only when **every** wave member has declined |
| `escalate_dispatch()` | next wave, or exhaust |
| `sweep_dispatch_timeouts()` | pg_cron, 4×/minute |
| `expire_stale_incidents()` | status change only, never a delete |

## Verified end to end

A red-triage road accident at Dispur with SpO2 88, SBP 85, HR 138, GCS 7:

1. classified **critical** — from triage colour, keywords and vitals, not the default
2. wave 0 offered to **3** facilities on a **45 s** fuse
3. `required_services = {trauma, neurosurgery}` put the neuro hospital at rank 1
4. one decline of three did **not** escalate; two remained pending
5. accept superseded the third in the same transaction
6. a second facility's accept was rejected with `already_accepted` and the winner's name
7. reliability updated: accepter 1.000, decliner 0.000, superseded rival still null
8. forced timeout → sweep escalated to wave 1, `fallback_notified` cleared
9. full audit trail: `incident_created → dispatch_opened → wave_offered → offer_declined → status_changed → offer_accepted`

Step 1 was originally written as "from triage colour and vitals". It was half true,
and the console is what exposed it — see the vitals key mismatch below.

## The console

`/admin/dispatch`. Live board of incidents with wave state and the fuse counting
down, the current wave's offers with accept and decline, the ranked candidate list
with a per-factor breakdown, and the activity trail. Realtime, not polled: the four
acute tables are in the `supabase_realtime` publication with `replica identity full`,
so an offer going `pending → superseded` carries its old row and the console can tell
what changed.

Accept and decline call the security-definer functions. There is no client write
policy on `incident_dispatch` or `dispatch_offers` at all, which is what makes "only
the current wave may accept" enforceable rather than advisory.

## Five defects the console found in the engine

The engine was verified with SQL before any UI existed, and all five of these
survived that. Each one needed a real caller — a browser, with a real logged-in
user — to surface.

**Anyone could accept for anyone.** `accept_dispatch_offer` and
`decline_dispatch_offer` were `SECURITY DEFINER` and checked the wave, the offer
state and the dispatch state — but never that the caller had anything to do with the
facility they were answering for. Any authenticated account could accept a case on
behalf of any hospital in the state. This is the same defect this document
criticises EOS for (`ops_fleet_units`: `allow write: if request.auth != null`),
reproduced by accident in our own engine, and SQL testing could not see it because
`psql` is always the superuser. Now: ops role, or a `facility_staff` row for that
facility with `can_accept`.

**`escalate_dispatch` and `open_dispatch` were public rpc.** Any authenticated
account could force any incident to its next wave, or spend fifteen facilities'
attention on any incident. `escalate_dispatch` is revoked rather than guarded —
`decline_dispatch_offer` calls it when the last member of a wave declines, and there
the caller is legitimately facility staff, not ops. Inside a `SECURITY DEFINER`
function privilege checks run as the definer, so the internal path needs no grant.

**A malformed vital destroyed the whole incident.** The classifier used
`nullif(x,'')::numeric`, which handles missing and empty and throws `22P02` on
anything else — and it runs inside the severity trigger. `"spo2":"low"` from an SMS
or a voice transcription did not degrade to "unmeasured"; it aborted the `INSERT`
and the emergency was never recorded. Now `numeric_or_null()`, which cannot throw.

**Vitals were written and never read.** The classifier read only `health_vitals`'
column spellings — `oxygen_saturation`, `systolic_bp`, `heart_rate` — while every
acute caller sends clinical shorthand: `spo2`, `sbp`, `hr`. A key that does not match
reads as absent, and absent vitals escalate nothing. So the flagship demo case, GCS 7
and SpO2 88, was reaching `critical` on its triage colour and the word "accident"
with the physiology contributing **nothing at all**. Fixed in the reader rather than
in each caller, so no future intake path has to know which spelling this function
prefers.

**The offer list never loaded, and the factor grid showed no numbers.**
`dispatch_offers` has two foreign keys to `facilities` (`facility_id` and
`superseded_by`), so a bare embed is ambiguous and PostgREST answered `300`. And the
grid read `factors->score`, which does not exist — the payload carries `value` and
`weight`. Both were silent: the page rendered, with the entire reason-for-choice
column empty.

## Known gaps

- **No notification transport.** Offers land in the database and the console; there
  is no FCM/SMS push. EOS has a four-channel fan-out. The offer rows are the
  integration point.
- **No facility-side portal.** `facility_staff` binds an account to a facility and
  RLS already limits a facility to its own offers, but there are no `/facility/*`
  routes and `auth-context` knows four roles, so accept and decline are driven from
  the ops console. The authorisation does not depend on the UI: the rpc refuses a
  caller who is neither ops nor staff of that facility.
- **No ambulance/fleet leg.** EOS has a second offer/accept machine for vehicles
  after a hospital accepts, with its own 3-minute deadline and 4-attempt cap.
  `incident_responders` models the crew but nothing dispatches one.
- **Intake is the console's three presets.** No SOS button, no IVR hook, no GeoSMS
  (EOS parses a Twilio webhook with signature verification). Presets deliberately do
  not let anyone set severity by hand — the classifier is the only thing that decides.
- **ETA is haversine at 30 km/h**, not traffic-aware. EOS calls Google Routes with a
  2500 ms timeout for the nearest 10 candidates. Labelled `eta_basis` in every score
  and shown in the UI.
- **Speciality tags are name-derived.** A facility whose name does not say what it is
  stays unclassified and falls back to tier alone. The upgrade path is OSM's
  `healthcare:speciality`, today at 4.8% coverage. See the "Vision hospital" note in
  [LIMITATIONS.md](LIMITATIONS.md) for where name-matching has to stop.
- **Vital thresholds in `classify_incident_severity` are not clinician-reviewed.**
  Section 1 of CLINICAL_REVIEW.md.
- **The console's own copy is too wordy.** Every card currently carries a sentence
  defending a design decision, and the factor sources render as internal jargon
  (`OSM_COORDINATES`, `OUR_DISPATCH_TABLE`). A plain-language pass across all screens
  is pending.
