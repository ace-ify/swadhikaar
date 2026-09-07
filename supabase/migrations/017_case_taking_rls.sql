-- RLS AND THE ONE WRITE A BROWSER MAY MAKE. Split from 016 for the reason 002/003 were
-- split: a policy that references a column added in the same transaction is a migration
-- that half-applies, and the acute layer already paid for that lesson once.
--
-- Applied via the Supabase MCP as `case_taking_rls_and_grants` and
-- `review_case_summary_and_storage_policies` (there is no CLI on this machine, see
-- README.md). The DDL below is what was applied.
--
-- THE SHAPE, because it is not the same as the rest of the app: a patient standing at
-- an OPD kiosk has no account. There is nobody to log in as, so there is no `auth.uid()`
-- to write policies against on the write path. Every kiosk write therefore goes through
-- an edge function holding the service key -- exactly what `incident-intake` already
-- does -- and RLS here governs the READ path: which clinician, and which patient later
-- signing in, can see what was collected.
--
-- That is why there is no insert or update policy on any of these tables. It is not an
-- omission. An insert policy would have to be permissive enough for an unauthenticated
-- kiosk, which means permissive enough for anyone, on tables holding clinical history.
--
-- The single exception is a doctor reviewing a summary, and that is a function rather
-- than an update policy because three things must happen together or none of them: the
-- summary changes status, the session closes, and the audit log records who. An update
-- policy can express the first without the third.

-- ------------------------------------------------------------------- shared helper
-- One helper instead of the same three-table join in eight policies. security definer
-- because it must see case_sessions and patients regardless of the caller's own
-- policies; revoked from anon so it cannot be used to probe for session ids.
create or replace function public.patient_owns_session(p_session uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
      from public.case_sessions s
      join public.patients p on p.id = s.patient_id
     where s.id = p_session
       and p.auth_user_id = auth.uid()
  );
$$;

revoke all on function public.patient_owns_session(uuid) from public, anon;
grant execute on function public.patient_owns_session(uuid) to authenticated;

-- --------------------------------------------------------------------- enable RLS
alter table public.case_sessions          enable row level security;
alter table public.history_answers        enable row level security;
alter table public.dashavidha_assessments enable row level security;
alter table public.case_documents         enable row level security;
alter table public.document_entities      enable row level security;
alter table public.case_summaries         enable row level security;
alter table public.drug_interactions      enable row level security;

-- ----------------------------------------------------------------- read policies
-- admin and doctor see every case; a patient sees only their own. asha and
-- facility_staff are deliberately absent: an ASHA does not staff an OPD kiosk, and a
-- receiving hospital's interest in a patient starts at the dispatch offer, not at
-- somebody else's OPD history.
drop policy if exists case_sessions_read on public.case_sessions;
create policy case_sessions_read on public.case_sessions for select to authenticated
using (
  public.current_user_has_role(array['admin','doctor'])
  or exists (select 1 from public.patients p
              where p.id = case_sessions.patient_id and p.auth_user_id = auth.uid())
);

drop policy if exists history_answers_read on public.history_answers;
create policy history_answers_read on public.history_answers for select to authenticated
using (
  public.current_user_has_role(array['admin','doctor'])
  or public.patient_owns_session(session_id)
);

drop policy if exists dashavidha_read on public.dashavidha_assessments;
create policy dashavidha_read on public.dashavidha_assessments for select to authenticated
using (
  public.current_user_has_role(array['admin','doctor'])
  or public.patient_owns_session(session_id)
);

drop policy if exists case_documents_read on public.case_documents;
create policy case_documents_read on public.case_documents for select to authenticated
using (
  public.current_user_has_role(array['admin','doctor'])
  or public.patient_owns_session(session_id)
);

-- One extra hop: entities hang off a document, and the document knows the session.
drop policy if exists document_entities_read on public.document_entities;
create policy document_entities_read on public.document_entities for select to authenticated
using (
  public.current_user_has_role(array['admin','doctor'])
  or exists (select 1 from public.case_documents d
              where d.id = document_entities.document_id
                and public.patient_owns_session(d.session_id))
);

drop policy if exists case_summaries_read on public.case_summaries;
create policy case_summaries_read on public.case_summaries for select to authenticated
using (
  public.current_user_has_role(array['admin','doctor'])
  or public.patient_owns_session(session_id)
);

-- Reference data, not patient data. Any signed-in account may read it; only a
-- migration writes it.
drop policy if exists drug_interactions_read on public.drug_interactions;
create policy drug_interactions_read on public.drug_interactions for select to authenticated
using (true);

revoke all on public.case_sessions, public.history_answers, public.dashavidha_assessments,
              public.case_documents, public.document_entities, public.case_summaries,
              public.drug_interactions
  from anon;
grant select on public.case_sessions, public.history_answers, public.dashavidha_assessments,
                public.case_documents, public.document_entities, public.case_summaries,
                public.drug_interactions
  to authenticated;

-- ------------------------------------------------- the doctor's accept/amend/reject
create or replace function public.review_case_summary(
  p_session  uuid,
  p_action   text,
  p_amended  jsonb default null,
  p_notes    text  default null
)
returns public.case_summaries
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_doctor uuid;
  v_role   text := public.current_app_role();
  v_row    public.case_summaries;
begin
  if p_action not in ('accepted','amended','rejected') then
    raise exception 'action must be accepted, amended or rejected, got %', p_action
      using errcode = '22023';
  end if;
  if p_action = 'amended' and p_amended is null then
    raise exception 'an amendment needs amended sections' using errcode = '22023';
  end if;

  -- A doctors row is required even for an admin. reviewed_by is a clinical
  -- attribution, and "the admin account" is not a clinician anyone can later ask
  -- about the decision.
  select id into v_doctor from public.doctors where auth_user_id = auth.uid();
  if v_doctor is null then
    raise exception 'only a linked clinician account can review a case summary'
      using errcode = '42501';
  end if;
  if v_role is distinct from 'doctor' and v_role is distinct from 'admin' then
    raise exception 'role % cannot review case summaries', coalesce(v_role, 'none')
      using errcode = '42501';
  end if;

  -- `and status = 'draft'` is the concurrency guard: two clinicians opening the same
  -- case means the second update matches no row and raises below, rather than silently
  -- overwriting the first one's decision.
  update public.case_summaries
     set status           = p_action,
         amended_sections = case when p_action = 'amended' then p_amended else amended_sections end,
         review_notes     = coalesce(p_notes, review_notes),
         reviewed_by      = v_doctor,
         reviewed_at      = now()
   where session_id = p_session
     and status = 'draft'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no draft summary for session % (already reviewed, or none generated)', p_session
      using errcode = 'P0002';
  end if;

  update public.case_sessions
     set status = 'consulted', ended_at = coalesce(ended_at, now())
   where id = p_session;

  insert into public.audit_log (user_id, user_role, action, resource_type, resource_id, details)
  values (auth.uid(), v_role, 'case_summary_' || p_action, 'case_summary', v_row.id,
          jsonb_build_object('session_id', p_session, 'doctor_id', v_doctor,
                             'has_amendment', p_amended is not null));

  return v_row;
end;
$$;

revoke all on function public.review_case_summary(uuid, text, jsonb, text) from public, anon;
grant execute on function public.review_case_summary(uuid, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------- scanned paper, storage
-- Path is <session_id>/<filename>, so the policy keys on the first segment.
-- split_part rather than storage.foldername for the reason 013 gave: a crafted object
-- name must return null, not raise. A policy that can be made to error is a policy
-- that can be used to deny service.
create or replace function public.case_document_session(p_name text)
returns uuid
language sql immutable set search_path to 'public'
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

revoke all on function public.case_document_session(text) from public, anon;
grant execute on function public.case_document_session(text) to authenticated;

-- Read only, and no insert policy on purpose. Uploads go through the edge function
-- with the service key, because the patient holding the prescription is not signed in
-- and handing the browser an upload grant means handing every kiosk an
-- unauthenticated write into a bucket of medical records.
drop policy if exists case_document_read on storage.objects;
create policy case_document_read on storage.objects for select to authenticated
using (
  bucket_id = 'case-documents'
  and (
    public.current_user_has_role(array['admin','doctor'])
    or public.patient_owns_session(public.case_document_session(name))
  )
);

