-- 005_canonical_risk_level.sql
--
-- `patients.risk_level` was free-form text with no constraint and four writers
-- using three conventions:
--
--   frontend/src/components/asha/risk.ts   'high' / 'moderate' / 'low'
--   backend/voice_agent/agent.py           'High' / 'Moderate' / 'Low'
--   supabase/functions/incident-complete/  'High' / 'Moderate'
--   backend/seed_data.py                   'Unknown'
--
-- The ASHA UI guards itself with normaliseRisk() (components/asha/ui.tsx), but
-- every desktop reader compares raw strings:
--
--   app/doctor/patients/page.tsx:572    p.risk_level === "High"   (High count)
--   app/doctor/patients/page.tsx:123    badge colour
--   app/admin/dashboard/page.tsx:64     camp statistics
--   app/admin/operations/page.tsx:258   high-risk workload
--   app/admin/coordination/page.tsx:71  escalation candidates
--
-- So a patient an ASHA screened as high risk was stored as 'high' and silently
-- disappeared from every high-risk count and filter on the desktop side. Two such
-- rows existed in production when this was found.
--
-- Fixed here rather than in ~12 readers (DB constraint over app code): the trigger
-- canonicalises on write so every existing writer keeps working unchanged, and the
-- CHECK makes the broken state unreachable for writers added later. Readers can
-- now compare exactly and be correct.

create or replace function public.canonical_risk_level(v text)
returns text
language sql
immutable
as $$
  select case
    when v is null or btrim(v) = '' then null
    when lower(btrim(v)) like 'high%'     then 'High'
    when lower(btrim(v)) like 'critical%' then 'High'
    when lower(btrim(v)) like 'mod%'      then 'Moderate'
    when lower(btrim(v)) like 'medium%'   then 'Moderate'
    when lower(btrim(v)) like 'low%'      then 'Low'
    else 'Unknown'
  end;
$$;

create or replace function public.patients_normalise_risk_level()
returns trigger
language plpgsql
as $$
begin
  new.risk_level := public.canonical_risk_level(new.risk_level);
  return new;
end;
$$;

drop trigger if exists trg_patients_normalise_risk_level on public.patients;
create trigger trg_patients_normalise_risk_level
  before insert or update of risk_level on public.patients
  for each row execute function public.patients_normalise_risk_level();

-- Backfill rows already written in the wrong case.
update public.patients
set risk_level = public.canonical_risk_level(risk_level)
where risk_level is distinct from public.canonical_risk_level(risk_level);

-- Backstop: the trigger normalises, this makes a miss impossible to persist.
-- NULL stays legal — it means "not screened yet", which is different from Low.
alter table public.patients drop constraint if exists patients_risk_level_canonical;
alter table public.patients add constraint patients_risk_level_canonical
  check (risk_level is null or risk_level in ('High', 'Moderate', 'Low', 'Unknown'));
