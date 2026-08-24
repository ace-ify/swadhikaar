-- 001_grant_app_role.sql
--
-- Operator tooling for assigning app roles. Applied on top of 000_baseline.sql.
--
-- WHY A FUNCTION AND NOT AN INSERT
-- Roles cannot be self-assigned through the API: user_roles has a read-own-only
-- policy, and that is the whole point of the table. The design it replaced read
-- auth.users.raw_user_meta_data, which the user can write, so any account could
-- promote itself to admin. Role assignment is therefore an out-of-band operation.
--
-- Hand-writing the INSERT is easy to get half-right: an `asha` with no
-- field_worker_areas row sees ZERO patients, and a `doctor` with no doctors row sees
-- zero assigned patients. Both look like "the app is broken" rather than "the wiring
-- is incomplete". This function does the side tables too and tells you what it did.

create or replace function public.grant_app_role(
  p_email    text,
  p_role     text,
  p_village  text default null,
  p_district text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_note text := '';
begin
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then
    return format('NO SUCH USER: %s — create it first (Dashboard -> Authentication -> Add user), then re-run.', p_email);
  end if;

  -- The CHECK on user_roles.role rejects anything outside the five known roles.
  insert into user_roles (user_id, role)
  values (v_uid, p_role)
  on conflict (user_id) do update set role = excluded.role;

  if p_role = 'asha' then
    if p_village is null then
      v_note := ' WARNING: no village given, so this ASHA will see ZERO patients. '
             || 'Re-run with a village, e.g. grant_app_role(''' || p_email || ''', ''asha'', ''Rampur'', ''Muzaffarpur'')';
    else
      insert into field_worker_areas (user_id, village, district)
      values (v_uid, p_village, p_district)
      on conflict (user_id, village) do update set district = excluded.district;
      v_note := format(' scoped to %s, %s', p_village, coalesce(p_district, '-'));
    end if;

  elsif p_role = 'doctor' then
    update doctors set auth_user_id = v_uid where lower(email) = lower(btrim(p_email));
    if not found then
      insert into doctors (name, email, specialization, auth_user_id)
      values (split_part(p_email, '@', 1), p_email, 'General Medicine', v_uid);
      v_note := ' new doctors row created';
    else
      v_note := ' linked to existing doctors row';
    end if;

  elsif p_role = 'patient' then
    update patients set auth_user_id = v_uid where lower(phone) = lower(btrim(p_email));
    if not found then
      v_note := ' NOTE: no patients row matched — link it manually via patients.auth_user_id';
    end if;
  end if;

  return format('OK: %s -> %s.%s', p_email, p_role, v_note);
end;
$$;

-- Operator-only: never reachable from the app.
revoke all on function public.grant_app_role(text, text, text, text) from anon, authenticated, public;

-- Read-only overview so you can audit who has what without joining four tables.
create or replace view public.app_users_overview
  with (security_invoker = true) as
select u.email,
       ur.role,
       fwa.village,
       fwa.district,
       (d.id is not null) as has_doctor_row,
       u.last_sign_in_at,
       u.created_at
from auth.users u
left join user_roles ur on ur.user_id = u.id
left join field_worker_areas fwa on fwa.user_id = u.id
left join doctors d on d.auth_user_id = u.id;

revoke all on public.app_users_overview from anon, authenticated;
