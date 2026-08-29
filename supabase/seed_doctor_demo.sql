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

begin;

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
cross join generate_series(0, 1) n
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
