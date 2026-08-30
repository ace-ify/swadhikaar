-- DOCTOR DEMO CASELOAD — idempotent, re-runnable.
--
-- Why this exists: every doctor screen reads through visible_patient_ids(), which for
-- role 'doctor' returns only patients whose assigned_doctor_id belongs to a doctors row
-- with THIS auth.uid(). Before this seed, 240 patients were assigned to three doctors
-- with auth_user_id = NULL, and 0 to the one account that can actually log in. The
-- screens were not under-seeded, they were unreachable.
--
-- The doctor is resolved from user_roles, never hardcoded, so this always seeds the
-- account the demo logs in as.
--
-- SAFETY — the live dialer. cron job 1 runs place_due_recovery_calls() every 5 minutes
-- and its predicate is exactly:
--     voice_calls.status = 'scheduled'
--     AND scheduled_for IS NOT NULL AND scheduled_for <= now()
--     AND patients.phone IS NOT NULL
-- Every voice_calls row below is inserted with status in ('completed','failed',
-- 'no_answer') and scheduled_for NULL. Not one row can match. No 'scheduled' rows are
-- written at all — the "Next Call" column is computed client-side by resolveCallType(),
-- not read from voice_calls, so scheduling nothing costs the demo nothing.
--
-- Idempotency: every id is md5('<tag>:'||<key>)::uuid, so re-running upserts in place
-- instead of duplicating, and nothing existing is deleted.
--
-- ponytail: deterministic hashing via ('x'||substr(md5(key),1,7))::bit(28)::int —
-- always non-negative, no abs(), no helper function left behind in the schema.

-- Sent as ONE multi-statement batch, which Postgres wraps in a single implicit
-- transaction — so no explicit BEGIN/COMMIT, and a failure anywhere rolls back all of it.

-- 1 -- Caseload: the 60-patient simulated flood cohort (already synthetic, and the only
-- rows with a journey_status spread) plus 40 camp patients stratified by risk so the
-- High/Moderate/Low filter chips all return something.
with doc as (
  select d.id from doctors d
  join user_roles ur on ur.user_id = d.auth_user_id and ur.role = 'doctor'
  limit 1
), camp as (
  select p.id, p.risk_level,
         row_number() over (partition by p.risk_level order by md5(p.id::text)) rn
  from patients p
  where p.intake_source = 'health_camp' and p.phone is not null
    and p.risk_level in ('High','Moderate','Low')
)
update patients p set assigned_doctor_id = (select id from doc)
where p.intake_source = 'simulated_cohort'
   or p.id in (
     select id from camp
     where (risk_level = 'High' and rn <= 14)
        or (risk_level = 'Moderate' and rn <= 14)
        or (risk_level = 'Low' and rn <= 12)
   );

-- 2 -- Journey spread. useConversionFunnel() divides by journey_status counts, and with
-- no ipd_admitted or chronic_management row anywhere the "OPD to IPD" and "Chronic
-- Adherence" bars render a hard 0%. Only simulated_cohort rows are touched: advancing a
-- camp patient's journey would be inventing clinical history on a sourced record.
update patients p
   set journey_status = case (('x'||substr(md5(p.id::text||'journey'),1,7))::bit(28)::int % 10
                             ) when 0 then 'ipd_admitted'
                                when 1 then 'ipd_admitted'
                                when 2 then 'chronic_management'
                                else p.journey_status end
 where p.intake_source = 'simulated_cohort'
   and p.assigned_doctor_id is not null
   and p.journey_status <> 'screened';

-- 3 -- Vitals: two readings per patient, ~50 days apart, banded by risk_level so the
-- detail sheet's warn thresholds (sys>140, spo2<95, glucose>200) actually trip on High.
insert into health_vitals (
  id, patient_id, systolic_bp, diastolic_bp, heart_rate, respiratory_rate,
  oxygen_saturation, temperature, blood_glucose, height, weight, bmi, bmi_category,
  waist_circumference, waist_to_height_ratio, perfusion_index, recorded_at)
select
  md5('dd:vitals:'||p.id::text||':'||n)::uuid,
  p.id,
  b.sys  + (h % 9)  - n * 3,
  b.dia  + (h % 7)  - n * 2,
  b.hr   + (h % 11) - n * 2,
  14 + (h % 6),
  b.spo2 + (h % 3)  + n,
  round((97.4 + (h % 18) / 10.0)::numeric, 1),
  b.glu  + (h % 25) - n * 8,
  round((150 + (h % 25))::numeric, 1),
  round((48 + (h % 32))::numeric, 1),
  round(b.bmi::numeric + (h % 40) / 10.0, 1),
  case when b.bmi + (h % 40) / 10.0 >= 30 then 'Obese'
       when b.bmi + (h % 40) / 10.0 >= 25 then 'Overweight (Asian cutoff)'
       when b.bmi + (h % 40) / 10.0 >= 18.5 then 'Normal'
       else 'Underweight' end,
  round((72 + (h % 28))::numeric, 1),
  round((0.45 + (h % 20) / 100.0)::numeric, 2),
  round((1.2 + (h % 30) / 10.0)::numeric, 1),
  now() - (n * 50 || ' days')::interval - ((h % 40) || ' hours')::interval
from patients p
cross join generate_series(0, 1) as g(n)
cross join lateral (select (('x'||substr(md5(p.id::text||'v'||n),1,7))::bit(28)::int) h) r
cross join lateral (select * from (values
    ('High',     150, 94, 90, 92, 205, 27.5),
    ('Moderate', 134, 86, 80, 96, 148, 24.5),
    ('Low',      116, 74, 70, 97, 92,  20.5),
    ('Unknown',  126, 80, 76, 97, 108, 22.5)
  ) v(lvl, sys, dia, hr, spo2, glu, bmi) where v.lvl = coalesce(p.risk_level,'Unknown')) b
where p.assigned_doctor_id = (select d.id from doctors d
        join user_roles ur on ur.user_id = d.auth_user_id and ur.role = 'doctor' limit 1)
on conflict (id) do nothing;

-- 4 -- Risk assessments. overall_risk_score mirrors patients.overall_risk_score so the
-- table's Score column and the sheet's assessment do not contradict each other.
insert into risk_assessments (
  id, patient_id, heart_risk_score, heart_risk_level, diabetic_risk_score,
  diabetic_risk_level, hypertension_risk_score, hypertension_risk_level,
  overall_risk_category, overall_risk_score, assessed_at)
select
  md5('dd:risk:'||p.id::text)::uuid, p.id,
  s.heart, (case when s.heart >= 50 then 'High' when s.heart >= 35 then 'Moderate' else 'Low' end),
  s.diab,  (case when s.diab  >= 50 then 'High' when s.diab  >= 35 then 'Moderate' else 'Low' end),
  s.htn,   (case when s.htn   >= 50 then 'High' when s.htn   >= 35 then 'Moderate' else 'Low' end),
  coalesce(p.risk_level, 'Unknown'), s.overall,
  now() - ((s.h % 30) || ' days')::interval
from patients p
cross join lateral (
  select q.h,
         round(greatest(q.base + (q.h % 17) - 8, 5), 1)  heart,
         round(greatest(q.base + (q.h % 23) - 11, 5), 1) diab,
         round(greatest(q.base + (q.h % 19) - 9, 5), 1)  htn,
         round(q.base, 1) overall
  from (select (('x'||substr(md5(p.id::text||'risk'),1,7))::bit(28)::int) h,
               coalesce(p.overall_risk_score,
                 case coalesce(p.risk_level,'Unknown') when 'High' then 58
                      when 'Moderate' then 42 when 'Low' then 24 else 33 end)::numeric base) q
) s
where p.assigned_doctor_id = (select d.id from doctors d
        join user_roles ur on ur.user_id = d.auth_user_id and ur.role = 'doctor' limit 1)
on conflict (id) do nothing;

-- 5 -- Consent. One active DPDP record per patient; every ~11th is revoked so the sheet
-- has both states to show.
insert into consents (id, patient_id, purpose, scope, consent_mode, granted_at, revoked_at, is_active)
select
  md5('dd:consent:'||p.id::text)::uuid, p.id,
  'Voice AI health follow-up and care coordination',
  'vitals, risk scores, call transcripts, referral status',
  case when h % 4 = 0 then 'written' else 'verbal' end,
  now() - ((60 + h % 120) || ' days')::interval,
  case when h % 11 = 0 then now() - ((h % 20) || ' days')::interval end,
  h % 11 <> 0
from patients p
cross join lateral (select (('x'||substr(md5(p.id::text||'consent'),1,7))::bit(28)::int) h) r
where p.assigned_doctor_id = (select d.id from doctors d
        join user_roles ur on ur.user_id = d.auth_user_id and ur.role = 'doctor' limit 1)
on conflict (id) do nothing;

-- 6 -- Voice calls. SAFETY: status is never 'scheduled' and scheduled_for is never set,
-- so place_due_recovery_calls() cannot see a single one of these rows. ~2 past calls for
-- roughly half the caseload, with a real answered/failed mix so the dashboard's
-- "% answered" is not a flat 100.
insert into voice_calls (
  id, patient_id, call_type, use_case, status, language, transcript, extracted_data,
  severity, duration_seconds, started_at, ended_at, created_at, scheduled_for, attempts)
select
  md5('dd:call:'||p.id::text||':'||n)::uuid, p.id,
  c.ctype, c.ctype,
  case when c.h % 10 < 7 then 'completed' when c.h % 10 = 7 then 'no_answer' else 'failed' end,
  coalesce(p.language, 'hindi'),
  case when c.h % 10 < 7 then
    'Agent: Namaste, '||p.name||'. Main Swadhikaar se bol rahi hoon — aapke '
    ||coalesce(p.health_camp,'health camp')||' screening ke baare mein. '
    ||'Patient: Ji boliye. Agent: Aapka risk score '
    ||coalesce(p.overall_risk_score,40)::text||' hai, isliye doctor se milna zaroori hai. '
    ||'Patient: '||c.reply||' Agent: Main aapke liye OPD appointment book kar deti hoon, '
    ||'aur do din baad phir call karungi.'
  end,
  case when c.h % 10 < 7 then jsonb_build_object(
    'call_summary', c.summary,
    'symptoms_reported', c.sx,
    'overall_severity', c.sev,
    'patient_mood', (array['cooperative','anxious','reluctant','calm'])[1 + c.h % 4],
    'patient_consent_for_ipd', c.h % 3 <> 0,
    'objections_raised', case when c.h % 3 = 0
        then jsonb_build_array('Cannot afford travel to hospital','No family member free this week')
        else jsonb_build_array() end,
    'seed', 'doctor_demo')
  else jsonb_build_object('seed','doctor_demo') end,
  c.sev,
  case when c.h % 10 < 7 then 120 + (c.h % 260) else 0 end,
  c.at_ts, c.at_ts + ((120 + c.h % 260) || ' seconds')::interval, c.at_ts,
  null, 1
from patients p
cross join generate_series(0, 1) as g(n)
cross join lateral (
  select q.h, q.at_ts,
    (array['screening_to_opd','follow_up','recovery_protocol','chronic_management',
           'elderly_checkin','opd_to_ipd'])[1 + q.h % 6] ctype,
    case coalesce(p.risk_level,'Unknown') when 'High' then 'high'
         when 'Moderate' then 'moderate' else 'low' end sev,
    (array['Haan, thoda seene mein bhaari lagta hai.','Dawai chal rahi hai, thik hoon.',
           'Chakkar aata hai subah.','Aspatal jaana mushkil hai, kaam chhodna padega.'])[1 + q.h % 4] reply,
    (array['Patient acknowledged high BP reading and agreed to OPD visit within 48 hours.',
           'Reports adherence to medication; no new symptoms. Routine follow-up sufficient.',
           'Reports morning dizziness and breathlessness on exertion — needs clinical review.',
           'Declined referral citing daily wage loss; counselled on subsidised OPD slot.'
          ])[1 + q.h % 4] summary,
    case when q.h % 4 in (0, 2) then jsonb_build_array(
           jsonb_build_object('symptom','chest discomfort','duration','3 days','severity','moderate'),
           jsonb_build_object('symptom','breathlessness','duration','1 week','severity',
             case when q.h % 4 = 2 then 'severe' else 'mild' end))
         else jsonb_build_array(
           jsonb_build_object('symptom','fatigue','duration','2 weeks','severity','mild')) end sx
  from (select (('x'||substr(md5(p.id::text||'call'||n),1,7))::bit(28)::int) h,
               now() - ((3 + n * 9 + (('x'||substr(md5(p.id::text||'when'||n),1,7))::bit(28)::int % 25))
                        || ' days')::interval at_ts) q
) c
where p.assigned_doctor_id = (select d.id from doctors d
        join user_roles ur on ur.user_id = d.auth_user_id and ur.role = 'doctor' limit 1)
  and (('x'||substr(md5(p.id::text||'hascall'),1,7))::bit(28)::int) % 100 < 55
on conflict (id) do nothing;

-- 7 -- Escalations, each hung off a real seeded call so the review sheet's "linked call"
-- lookup finds a transcript and an extracted_data summary instead of falling back to the
-- reason string. severity is uppercase: the escalations page compares against
-- 'CRITICAL'/'HIGH'/'MODERATE' literally.
insert into escalations (
  id, patient_id, call_id, severity_level, severity, reason, status, assigned_to,
  resolved_at, resolution_notes, created_at)
select
  md5('dd:esc:'||vc.id::text)::uuid, vc.patient_id, vc.id,
  e.sev, e.sev, e.reason,
  (array['open','open','open','in_progress','resolved'])[1 + e.h % 5],
  null,
  case when (array['open','open','open','in_progress','resolved'])[1 + e.h % 5] = 'resolved'
       then vc.created_at + interval '2 days' end,
  case when (array['open','open','open','in_progress','resolved'])[1 + e.h % 5] = 'resolved'
       then 'OPD consult completed; antihypertensive started, ASHA home visit scheduled.' end,
  vc.created_at + interval '6 minutes'
from voice_calls vc
join patients p on p.id = vc.patient_id
cross join lateral (
  select h,
    case when p.risk_level = 'High' and h % 3 = 0 then 'CRITICAL'
         when p.risk_level = 'High' then 'HIGH' else 'MODERATE' end sev,
    (array['BP 168/104 on repeat reading with chest discomfort — immediate OPD referral.',
           'Reported breathlessness on exertion worsening over one week.',
           'Fasting glucose 268 mg/dL, symptomatic; insulin review needed.',
           'Missed two consecutive follow-ups after high-risk screening.',
           'Refused referral citing wage loss — needs counselling and subsidised slot.'
          ])[1 + h % 5] reason
  from (select (('x'||substr(md5(vc.id::text||'esc'),1,7))::bit(28)::int) h) q
) e
where vc.status = 'completed'
  and vc.extracted_data->>'seed' = 'doctor_demo'
  and coalesce(p.risk_level,'') in ('High','Moderate')
  and (('x'||substr(md5(vc.id::text||'hasesc'),1,7))::bit(28)::int) % 100 < 30
on conflict (id) do nothing;

-- 8 -- FHIR review queue. review_status mix so the four counters on /doctor/review are
-- all non-zero, and both code arrays populated so the mapped-codes row is not empty.
insert into fhir_resources (
  id, patient_id, call_id, resource_type, profile, fhir_json, snomed_codes, loinc_codes,
  review_status, created_at)
select
  md5('dd:fhir:'||vc.id::text)::uuid, vc.patient_id, vc.id,
  f.rtype, 'https://nrces.in/ndhm/fhir/r4/StructureDefinition/'||f.rtype,
  jsonb_build_object(
    'resourceType', f.rtype,
    'subject', jsonb_build_object('reference', 'Patient/'||vc.patient_id::text),
    'code', jsonb_build_object('text', f.display),
    'effectiveDateTime', to_char(vc.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'valueString', vc.extracted_data->>'call_summary'),
  f.snomed_one || case when f.h % 3 = 0 then array['271649006'] else array[]::text[] end,
  f.loinc,
  (array['pending','pending','pending','approved','corrected','rejected'])[1 + f.h % 6],
  vc.created_at + interval '12 minutes'
from voice_calls vc
cross join lateral (
  select h,
    case when h % 2 = 0 then 'Condition' else 'Observation' end rtype,
    (array['Essential hypertension','Type 2 diabetes mellitus','Dyspnoea on exertion',
           'Chest discomfort'])[1 + h % 4] display,
    (array['38341003','44054006','267036007','29857009'])[1 + h % 4] snomed_one,
    case h % 4 when 0 then array['8480-6','8462-4'] when 1 then array['2339-0']
                when 2 then array['9279-1'] else array['8867-4'] end loinc
  from (select (('x'||substr(md5(vc.id::text||'fhir'),1,7))::bit(28)::int) h) q
) f
where vc.status = 'completed'
  and vc.extracted_data->>'seed' = 'doctor_demo'
  and (('x'||substr(md5(vc.id::text||'hasfhir'),1,7))::bit(28)::int) % 100 < 22
on conflict (id) do nothing;

-- 9 -- Newborns. Nine babies at staggered ages (1–11 months) so the UIP milestones below
-- land at different points for each one — that is what produces a mixed
-- completed/overdue/pending board rather than one uniform column.
insert into newborns (
  id, parent_patient_id, baby_name, date_of_birth, gender, birth_weight_kg,
  birth_hospital, phone, language, created_at)
with picked as (
  select p.id, p.name, p.phone, p.language,
         (('x'||substr(md5(p.id::text||'nb'),1,7))::bit(28)::int) h,
         row_number() over (order by md5(p.id::text||'nbpick')) rn
  from patients p
  where p.assigned_doctor_id = (select d.id from doctors d
          join user_roles ur on ur.user_id = d.auth_user_id and ur.role = 'doctor' limit 1)
    and p.phone is not null
)
select
  md5('dd:newborn:'||b.id::text)::uuid, b.id,
  'Baby of '||split_part(b.name, ' ', 1),
  (current_date - ((30 + b.rn * 33) || ' days')::interval)::date,
  case when b.rn % 2 = 0 then 'female' else 'male' end,
  round((2.4 + (b.h % 14) / 10.0)::numeric, 2),
  (array['Patna Medical College Hospital','Guru Gobind Singh Hospital',
         'Gauhati Medical College','Nalanda Medical College Hospital'])[1 + b.h % 4],
  b.phone, coalesce(b.language, 'hindi'),
  now() - interval '20 days'
from picked b
where b.rn <= 9
on conflict (id) do nothing;

-- 10 -- UIP schedule. status is derived from the due date, plus a deliberate ~1-in-5
-- default so 'overdue' also appears on milestones long past — real defaulters, not just
-- the milestone the baby happens to be sitting on this week.
insert into vaccination_schedules (
  id, newborn_id, vaccine_name, dose_number, due_age, due_date, route_site, remarks,
  status, administered_at, created_at)
select
  md5('dd:vax:'||n.id::text||':'||v.vaccine||':'||v.dose)::uuid,
  n.id, v.vaccine, v.dose, v.age_label,
  (n.date_of_birth + v.offset_days)::date, v.route,
  case when s.status = 'overdue' then 'Missed at scheduled visit — parent to be recalled.'
       else 'As per Universal Immunization Programme schedule.' end,
  s.status,
  case when s.status = 'completed'
       then (n.date_of_birth + v.offset_days + (s.h % 4))::timestamptz + interval '10 hours' end,
  now() - interval '20 days'
from newborns n
cross join (values
    ('BCG',                 1, 'At birth', 0,   'Intradermal, left upper arm'),
    ('OPV-0',               1, 'At birth', 0,   'Oral'),
    ('Hepatitis B - Birth', 1, 'At birth', 0,   'Intramuscular, antero-lateral thigh'),
    ('Pentavalent',         1, '6 weeks',  42,  'Intramuscular, antero-lateral thigh'),
    ('Rotavirus',           1, '6 weeks',  42,  'Oral'),
    ('Pentavalent',         2, '10 weeks', 70,  'Intramuscular, antero-lateral thigh'),
    ('Rotavirus',           2, '10 weeks', 70,  'Oral'),
    ('Pentavalent',         3, '14 weeks', 98,  'Intramuscular, antero-lateral thigh'),
    ('IPV',                 2, '14 weeks', 98,  'Intramuscular, right thigh'),
    ('Measles-Rubella',     1, '9 months', 270, 'Subcutaneous, right upper arm')
  ) v(vaccine, dose, age_label, offset_days, route)
cross join lateral (
  select q.h,
    case when (n.date_of_birth + v.offset_days) >= current_date then 'pending'
         when q.h % 5 = 0 then 'overdue'
         else 'completed' end status
  from (select (('x'||substr(md5(n.id::text||v.vaccine||v.dose::text),1,7))::bit(28)::int) h) q
) s
where n.id in (select md5('dd:newborn:'||p.id::text)::uuid from patients p
               where p.assigned_doctor_id = (select d.id from doctors d
                 join user_roles ur on ur.user_id = d.auth_user_id and ur.role = 'doctor' limit 1))
on conflict (id) do nothing;

-- 11 -- The check. Last statement in the batch, so a failure here rolls back the whole
-- seed rather than leaving a half-seeded database — and, crucially, rolls back any row
-- that would have made the 5-minute cron place a real outbound call.
do $$
declare n int;
begin
  select count(*) into n
    from voice_calls vc join patients p on p.id = vc.patient_id
   where vc.status = 'scheduled' and vc.scheduled_for is not null
     and vc.scheduled_for <= now() and p.phone is not null;
  if n > 0 then
    raise exception 'SEED ABORTED: % voice_calls row(s) are due for the live dialer', n;
  end if;

  select count(*) into n from patients
   where assigned_doctor_id = (select d.id from doctors d
           join user_roles ur on ur.user_id = d.auth_user_id and ur.role = 'doctor' limit 1);
  if n < 50 then
    raise exception 'SEED FAILED: doctor caseload is % patients, expected ~100', n;
  end if;
end $$;
