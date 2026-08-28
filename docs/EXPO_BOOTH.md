# Expo booth guide — 28 Aug 2026

A booth is not a judged presentation. People arrive mid-sentence, some give you 40
seconds and some give you fifteen minutes, and most of the other tables have something
that moves and blinks. This is written for that.

[RUN_OF_SHOW.md](RUN_OF_SHOW.md) is the linear script for a formal slot. Use this at
the table.

---

## The spine — say this before you show anything

Four layers built over three weeks stop feeling like four products the moment they are
described as one loop rather than a list:

```
   ASHA screens someone in a village          <- how a person with no record enters
             |
             v
   Voice calls them in their language         <- how they stay in view between visits
             |                                   7 call types across the journey
             |
    something goes wrong
             |
             v
   Dispatch finds a hospital in 45 seconds    <- the exit ramp
             |
             v
   Discharge creates the follow-up protocol   <- and puts them back in the loop
             |
             +--> back to voice
```

The sentence that ties it:

> *"Most health systems are episodic. A person appears when they are sick and disappears
> afterwards. We built the loop that keeps them in view between episodes — and can push
> them out of it, into a hospital bed, in forty-five seconds when something goes wrong."*

Why each piece is load-bearing rather than bolted on, in case anyone asks:

| Piece | The question it answers |
|---|---|
| ASHA screening, offline-first | How does someone with no medical record get one? Signal does not exist in the field, so the phone queues and syncs later. |
| Voice, 10 Indic languages | How do you stay in contact with someone who cannot read and has no smartphone? |
| Weather advisory | How do you reach people *before* anyone is sick? Heat index pulls a cohort into the call queue. |
| Dispatch engine | When it is an emergency, which hospital will actually take them? |
| Discharge seam | What stops someone vanishing after the hospital door? |

If a visitor only has time for one branch, show dispatch — it is the most visceral. But
say the loop first, in twenty seconds, or the dispatch console looks like a standalone
tool.

---

## Before the doors open

Four tabs, signed in, loaded, in this order. Nothing should be loading while you talk.

| Tab | Route | Signed in as |
|---|---|---|
| 1 | `/admin/cross-domain` | admin |
| 2 | `/admin/map` | admin |
| 3 | `/admin/dispatch` | admin |
| 4 | `/facility/inbox` | the hospital account — **separate browser profile or incognito** |

Open on demand, not before: `/patient/sos` (it asks for location permission — you want
that prompt to happen while you are explaining it) and `/admin/seam-trigger`.

Run the pre-flight in RUN_OF_SHOW.md. The one that matters most at a booth is
`select count(*) from incidents` — see **Reset between visitors** below.

**An empty facility inbox is correct** when no case is live. It fills the moment you
press a preset in tab 3. Do not open tab 4 first and wonder why it is blank.

---

## The 30-second version

For the person who is walking past and has not decided to stop yet. Do not open
anything. Say this:

> *"When someone has a road accident in rural Bihar, the ambulance problem is not the
> vehicle — it is that nobody knows which hospital will actually take the patient. So
> crews drive to the nearest one and get turned away. We built the layer that asks
> three hospitals at the same time and holds them to a 45-second deadline. And because
> most of these patients cannot read, the whole system also speaks — it makes phone
> calls in ten Indian languages."*

If they stop, go to the 3-minute version. If they ask "so it's an app?", answer:
*"It's the part underneath an app. Four different people see four different screens —
the patient, the health worker, the hospital, the control room."*

---

## The 3-minute version — the one you will give fifty times

Tab 3, `/admin/dispatch`. Press **Road accident, Dispur**. Then stop talking for three
seconds and let them watch the countdown.

Say these four things, in this order. Each one answers the question the last one raises.

1. **"Nobody typed 'critical'."** The database read a red triage tag, the words "head
   injury", and SpO2 88 with a GCS of 7, and decided. Intake cannot downgrade it.
2. **"Three hospitals at once, not one after another."** A critical case cannot spend
   two minutes waiting for one polite refusal.
3. **Point at the timer.** "Forty-five seconds, and that deadline is a timestamp stored
   in the row — not a stopwatch in this browser. Refresh the page and it does not
   restart. The job that fires when it expires is reading the same timestamp you are."
4. **Switch to tab 4** — the same case is sitting in the hospital's own inbox with its
   own countdown. Press **Accept patient**. Switch back. The other two hospitals now
   read **went elsewhere**, and an ambulance section has appeared by itself.

Close with the honest line, because it is the strongest one you have:

> *"The ambulances are simulated and the screen says so. There is no ambulance GPS feed
> in Assam we can legally read. Everything above that line — the hospitals, the
> distances, the routing to a trauma centre — is real data from OpenStreetMap."*

---

## The 8-minute version — add these, in this order

**5. Why it went to *that* hospital.** Tap **How this was worked out**. Six factors are
real — distance, speciality, how busy, emergency unit, record freshness, past answers.
Three say **made up for the demo**: free beds, doctors on duty, blood stock.

> *"No public source publishes live bed counts in India — it sits in each hospital's own
> system. So we switched those three off and redistributed their weight across the six
> we can actually source. The alternative was inventing a number and letting it decide
> where a patient goes."*

**6. The map.** Tab 2. 537 facilities, every name and coordinate from OpenStreetMap,
248 of them dispatch-eligible. Click a patient pin → it ranks where that person would
be sent.

> *"We excluded 289 — labs, morgues, dental clinics, and one veterinary clinic that was
> sitting in the dispatch list because the filter caught 'veterinary' and 'animal' but
> not 'pet '."*

That anecdote lands better than any architecture slide. It shows you read your own
output instead of trusting it.

**7. The physics one.** Tab 1, `/admin/cross-domain`, district **Muzaffarpur**, hazard
**Heat**, **Dry run**.

> *"This fires on heat index, not air temperature — apparent temperature from dry-bulb
> plus humidity. On the 25th the air was 34.2 °C, which no threshold would trigger, and
> the heat index was 40.7 °C, which is where outdoor workers start collapsing. Sixteen
> people got a call."*

**8. The voice.** `/patient/calls` or the operations page. Ten Indic languages including
Assamese. 303 patients across eight languages — Hindi 95, Bhojpuri 58, Maithili 50,
Urdu 45, Assamese 36.

> *"One voice carries eleven locales, so a household hears the same organisation in
> Hindi one week and Assamese the next. That is a deliberate choice — a different voice
> per language sounds like a different institution each time."*

**9. The seam.** `/admin/seam-trigger`.

> *"An emergency that ends at the hospital door is where most systems stop. Closing a
> case here creates the patient record, the standards-format documents, and the Day
> 1, 3, 7, 14 and 30 follow-up calls in one step."*

---

## Framing by who is standing in front of you

**A CS professor.** Lead with concurrency and the state machine.

- *"Two hospitals accepting in the same instant is one `UPDATE ... WHERE state =
  'pending'`. Zero rows returned means you lost the race. The guard is in the database,
  not in application code, so it cannot be bypassed by a second client."*
- *"Accepting and cancelling the rivals are the same transaction. Split them and a
  losing hospital's screen sits on 'waiting' for a case somebody else already took."*
- *"Row-level security means the hospital screen has no filter of its own. The query
  asks for all offers; the database returns only theirs. You cannot widen it from the
  browser."*
- If they push on AI: **"We deliberately did not use an LLM for triage."** The severity
  rule is deterministic — triage colour, keyword list, vital thresholds. Auditable,
  unit-testable, cannot hallucinate a stable patient. The language model does
  conversation; the rules do triage. *This is the single best answer you have for a CS
  audience, and it is the opposite of what everyone else will say.*

**A mechanical or electrical professor.** Frame it as a control system, because it is
one.

- *"It is a control loop with a deadline. Set point: a hospital that accepts. Actuator:
  offers. Feedback: accept, decline, or silence. Silence is the interesting one — a
  timeout escalates to the next set of candidates, up to six times, and then it stops
  and asks for a human instead of retrying forever."*
- *"Fail-safe, not fail-open. If nothing accepts, the case stays open and flags for
  manual dispatch. It never marks itself resolved."*
- *"Latency budget: the sweep runs four times a minute because the shortest deadline is
  45 seconds. A once-a-minute job against a 45-second fuse gives you up to 105 seconds
  of real latency, which is the measured behaviour of the system we ported from."*

**A physics professor.** Heat index (apparent temperature from dry-bulb and relative
humidity), the 60 km radius and haversine distance on a sphere, and the honesty of
labelled uncertainty.

- *"Our ETA is straight-line at 30 km/h. Real road routing puts the same trip at 4.41 km
  against our 1.9 — so our number is optimistic by about half, and it is labelled as an
  estimate everywhere it appears rather than presented as a prediction."*

**Someone from a hardware team.** They will be quietly wondering where the device is.
Answer it before they ask:

> *"Our hardware is the phone network. It is the one piece of infrastructure that is
> already in every village and needs no funding round. The system makes real calls
> through a real SIP trunk in the language the person actually speaks."*

---

## Reset between visitors

Every visitor who presses a preset creates a real incident. After a few, the board is
cluttered and the story is muddier.

**Keep `/admin/dispatch` and `/admin/demo-reset` open in two tabs.** The reset page shows
whether a reset is even needed — test cases on the board, ambulances free, calls due,
whether the hospital login is linked — and clears it in one press.

It is deliberately not in the sidebar: a visitor should not see the scaffolding, and a
destructive control one tap from "Accept patient" is a bad idea regardless of who is
watching. Type the URL.

The reset touches only what the demo created. Patients, screenings, voice calls,
escalations, consents and the audit log are never deletable from there, and it refuses
outright for any account that is not an admin.

Do this between groups, not mid-explanation.

---

## Hard questions, honest answers

**"Is this actually deployed or a mockup?"** Live, on a real Postgres, with cron jobs
running right now. The countdown you are watching is a database timestamp.

**"Is the patient data real?"** The clinical measurements are — 235 vital-sign records
from a provided dataset. The identities are not, and the source file has no name or
address column, so they never were. The 60 Assam patients are generated and badged on
every screen that shows them.

**"How is this different from 108?"** 108 dispatches an ambulance. It does not tell you
which hospital has a neurosurgeon free tonight, and the crew finds out on arrival. This
is the layer between.

**"What happens with no internet?"** The health-worker screening app is offline-first —
it queues to the device and syncs when signal returns. The emergency path needs
connectivity, which is why calling 112 is one tap away on the patient screen and always
enabled.

**"What breaks at scale?"** Honest answer: unknown above 51, the largest cohort we have
exercised, and the sweep is serial so it is the first thing that would need attention.
Then the reason it is a good question, which they will respect.

**"Did you build this or is it a wrapper?"** The dispatch engine is ours — ported from a
reference implementation, with about a dozen defects in it fixed rather than reproduced.
Name one: their per-wave SMS fallback flag is set once per incident and never reset, so
their documented per-wave fallback actually fires once. Ours is keyed on the wave.

**"Why should a professor of mechanical engineering care?"** It is a scheduling and
control problem with a hard deadline and unreliable actuators. The medical part is the
domain; the engineering part is what happens when nobody answers.

---

## Do not

- Do not say the ambulances are real. The engine is; the vehicles are seeded and the
  map says so.
- Do not say SMS "goes out". It is queued with retries and parked — no gateway is
  configured. The console says "not sent" for exactly that reason. Show it if asked;
  it is a better answer than a claim.
- Do not claim Assamese speech *recognition*. Synthesis only.
- Do not show bed counts without saying "simulated".
- Do not call the severity classifier AI. It is a rule, and that is the point.
- Do not trigger a non-dry-run advisory. It queues real calls into a job that fires
  every five minutes.
- Do not run an ASHA screening with a real phone number. The form does not enforce the
  unroutable convention, so anything you type could become a dialable number in the
  database.

---

## If something breaks on stage

**Board empty after a preset** — check the browser console for a 401. That is the API
key, not the engine.

**Timer says "over — moving on" and nothing advances** — the sweep runs four times a
minute, so up to 15 seconds overdue is normal. Longer means pg_cron stopped:
`select jobname, active from cron.job;`

**Facility inbox says not linked to a hospital** — the account has the role but no
hospital row: `select grant_app_role('<email>', 'facility_staff', 'GMCH Emergency');`

**Everything looks stuck** — open a case from the console rather than the phone screen.
That path is two calls and no location prompt.

**Worst case** — the map and the weather advisory are the two screens that need nothing
live. Fall back to those and talk through the dispatch flow from the audit trail of an
older case.
