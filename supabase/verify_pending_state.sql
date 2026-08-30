-- ONE PASTE, ONE VERDICT. Read-only: no writes, no DDL, safe to run on the live project.
--
-- Why this file exists: three pieces of work are sitting between "written" and "running"
-- and none of them fails loudly. An unapplied policy, a function argument nobody passes,
-- and a column nobody fills all look exactly like working code from the outside. That is
-- the written-but-never-read failure this project keeps meeting.
--
-- Run it in Supabase Studio -> SQL Editor. Every row comes back either OK or TODO, with
-- the fix in the last column.

with checks as (

  -- ============================================================ 015 (fleet operator)
  select 1 as ord, '015 · crew can load the scene photo' as item,
    case when exists (
      select 1 from pg_policies
       where schemaname='storage' and tablename='objects'
         and policyname='scene_photo_read' and qual like '%fleet_units%')
    then 'OK' else 'TODO' end as state,
    'Run supabase/migrations/015_crew_sees_the_scene.sql' as fix

  union all
  select 2, '015 · my_fleet_run returns scene_photo_path',
    case when (select pg_get_functiondef(oid) from pg_proc
                where proname='my_fleet_run' and pronamespace='public'::regnamespace)
              like '%scene_photo_path%'
    then 'OK' else 'TODO' end,
    'Same file — it replaces my_fleet_run()'

  -- ============================================================ 014 (blood)
  union all
  select 3, '014 · facilities has the blood columns',
    case when (select count(*) from information_schema.columns
                where table_schema='public' and table_name='facilities'
                  and column_name in
                    ('has_blood_bank','blood_units_available','capacity_declared_at')) = 3
    then 'OK' else 'TODO' end,
    'Run supabase/migrations/014_blood_and_capacity.sql'

  union all
  select 4, '014 · score_dispatch_candidates accepts p_needs_blood',
    case when exists (
      select 1 from pg_proc
       where proname='score_dispatch_candidates' and pronamespace='public'::regnamespace
         and pg_get_function_arguments(oid) like '%p_needs_blood%')
    then 'OK' else 'TODO' end,
    'Same file'

  -- THE ONE THAT MATTERS. p_needs_blood defaults to false, so if open_dispatch never
  -- passes it the blood factor is dead weight: f_blood stays 0 and its 7-8% is
  -- redistributed away on every single incident, which is the exact bug 014 says it
  -- fixes. A green row above with a red row here means the migration is inert.
  union all
  select 5, '014 · open_dispatch actually PASSES p_needs_blood',
    case when coalesce((select pg_get_functiondef(oid) from pg_proc
                         where proname='open_dispatch'
                           and pronamespace='public'::regnamespace limit 1), '')
              like '%needs_blood%'
    then 'OK' else 'TODO — factor is inert' end,
    'open_dispatch lives only in the DB. It must compute needs_blood from the ' ||
    'incident (trauma speciality, or required_services containing blood) and pass it.'

  -- And even wired, an all-null column scores every facility 0.45 — a constant, which
  -- ranks nothing. The factor needs data before it changes an outcome.
  union all
  select 6, '014 · any facility has blood data at all',
    case when exists (select 1 from public.facilities
                       where has_blood_bank is not null
                          or blood_units_available is not null)
    then 'OK' else 'TODO — every facility scores 0.45 (unknown), so the factor ranks nothing' end,
    'Survey or seed has_blood_bank on dispatch_eligible facilities'

  union all
  select 7, '014 · Severe bleeding maps to trauma',
    case when 'trauma' = any (public.specialities_for_incident('Severe bleeding', ''))
    then 'OK' else 'TODO' end,
    'Run 014 — this is the SOS button that used to match no speciality at all'

  -- ============================================================ crew account
  union all
  select 8, 'crew · fleet_operator is a legal role value',
    case when (select pg_get_constraintdef(oid) from pg_constraint
                where conname='user_roles_role_check') like '%fleet_operator%'
    then 'OK' else 'TODO' end,
    'Run supabase/migrations/011_fleet_operator_app.sql'

  union all
  select 9, 'crew · at least one signed-in operator owns a vehicle',
    case when exists (
      select 1 from public.fleet_units u
       join public.user_roles r on r.user_id = u.operator_uid
       where r.role = 'fleet_operator')
    then 'OK' else 'TODO — /fleet will say "No vehicle is linked to this account"' end,
    'See the two statements in the comment at the bottom of this file'

  union all
  select 10, 'crew · that vehicle is off the simulation',
    coalesce((select case when not u.is_simulated then 'OK'
                          else 'TODO — cron still moves it' end
                from public.fleet_units u
                join public.user_roles r on r.user_id = u.operator_uid
               where r.role='fleet_operator' limit 1), 'n/a — no operator yet'),
    'The crew presses "Go on shift" on /fleet; it flips is_simulated itself'
)
select ord, item, state, fix from checks order by ord;

-- ---------------------------------------------------------------------------------
-- CREATING A CREW ACCOUNT — the two statements, in this order.
--
-- Step 1 happens in the DASHBOARD, not here: Authentication -> Users -> Add user,
-- with "Auto Confirm User" ticked. There is no signup form in this app on purpose.
--
-- Step 2, here, replacing the email and the call sign:
--
--   select public.grant_app_role('crew1@swadhikaar.test', 'fleet_operator', null, null);
--
--   update public.fleet_units u
--      set operator_uid = (select id from auth.users where email = 'crew1@swadhikaar.test'),
--          driver_name  = 'Ramesh Kumar',
--          phone        = '+919999900001'
--    where lower(u.call_sign) = lower('BR-01-AMB-101')      -- pick a real one:
--      and u.assigned_incident_id is null;                  --   select call_sign from fleet_units order by call_sign limit 10;
--
-- Then sign in as that user. Login sends fleet_operator to /fleet.
-- ---------------------------------------------------------------------------------
