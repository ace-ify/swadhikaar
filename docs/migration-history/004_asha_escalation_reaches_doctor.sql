-- 004_asha_escalation_reaches_doctor.sql
--
-- Closes the referral loop. An ASHA screening that raises a red flag now writes an
-- `escalations` row (see frontend/src/components/asha/risk.ts:escalationFor), but two
-- RLS gaps meant no doctor could act on it:
--
--   1. visible_patient_ids() scopes a doctor to `assigned_doctor_id = me`. An
--      ASHA-registered patient has no assigned doctor, so their escalation was
--      invisible to every doctor — written, and read by nobody but admin.
--   2. Widening (1) alone let the doctor see the alert but not the patient, so the
--      queue rendered "Unknown" beside "Severe chest pain".
--
-- Both fixes are scoped to the triage pool: open escalations nobody has claimed.
-- visible_patient_ids() is deliberately NOT widened — every child table
-- (health_vitals, symptoms, risk_assessments) reads through it, and a doctor
-- triaging an alert has no need for the patient's full history until they claim it.

-- ---------------------------------------------------------------------------
-- 1. Doctors can read escalations for patients nobody owns yet
-- ---------------------------------------------------------------------------
create or replace function public.escalation_visible(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    p_patient_id in (select public.visible_patient_ids())
    or (
      public.current_app_role() = 'doctor'
      and exists (
        select 1 from patients p
        where p.id = p_patient_id and p.assigned_doctor_id is null
      )
    );
$$;

drop policy if exists escalations_select on public.escalations;
create policy escalations_select on public.escalations
  for select to authenticated
  using (public.escalation_visible(patient_id));

drop policy if exists escalations_update on public.escalations;
create policy escalations_update on public.escalations
  for update to authenticated
  using (public.escalation_visible(patient_id))
  with check (public.escalation_visible(patient_id));

-- ---------------------------------------------------------------------------
-- 2. ...and can name the patient the alert is about
-- ---------------------------------------------------------------------------
-- Reads `escalations` ONLY — never `patients` — so it cannot recurse through the
-- patients policy below that calls it.
create or replace function public.in_triage_pool(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from escalations e
    where e.patient_id = p_patient_id
      and e.status = 'open'
      and e.assigned_to is null
  );
$$;

-- Additive: policies for the same command OR together, so the existing
-- patients_select is untouched. Once the escalation is claimed or resolved the
-- patient drops out of the pool and normal assignment rules apply again.
drop policy if exists patients_select_triage_pool on public.patients;
create policy patients_select_triage_pool on public.patients
  for select to authenticated
  using (
    public.current_app_role() = 'doctor'
    and public.in_triage_pool(id)
  );
