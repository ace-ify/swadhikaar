-- FLEET OPERATOR APP — applied 2026-08-29 in two parts via the Supabase MCP.
-- Part A had to be separate: ALTER TYPE ADD VALUE cannot be used in the same
-- transaction that adds it.
--
-- WHAT WAS ALREADY THERE. Almost all of it. 005_fleet_and_intake.sql built the whole
-- vehicle leg — units, offers, accept/reject, the 180s deadline, the sweeper — and
-- 008_fleet_telemetry.sql drove it with a cron. The only thing missing was a screen
-- for the human in the vehicle, and the phase transitions that a cron was doing on
-- their behalf. So this migration is small on purpose.
--
-- AUTHORISATION IS NOT THE NEW ROLE. A crew's identity is fleet_units.operator_uid,
-- which 005 already used in fleet_units_read, fleet_units_self_update,
-- fleet_assignments_read and can_answer_for_unit. 'fleet_operator' exists only so
-- login knows which app to open. Deleting the role would cost navigation, not
-- security.
--
-- GPS IS NOT AN RPC. fleet_units_self_update already lets an operator UPDATE their
-- own row, and tick_fleet_positions filters `where u.is_simulated`, so a real crew's
-- phone and the demo cron write disjoint sets of rows and never fight. A real unit is
-- is_simulated = false and moves only when a phone says so.

-- ============================================================ part A (own txn)
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('admin','doctor','asha','patient','farmer',
                  'facility_staff','dispatcher','fleet_operator'));

alter type ambulance_dispatch_state add value if not exists 'returning';

-- ============================================================ part B
-- Three functions. No new RLS policies: a fleet operator has no read on incidents or
-- incident_dispatch (checked against pg_policies — incidents_read_* covers ops,
-- offered facilities, the reporter and incident_responders, and a vehicle operator is
-- none of those). One security-definer read returning exactly the crew's fields is a
-- smaller surface than widening four policies.
--
-- The three bodies below are the deployed definitions, dumped with
-- pg_get_functiondef immediately after applying, so this file cannot drift from the
-- project the way risk-predict did. See README.md in this directory.
