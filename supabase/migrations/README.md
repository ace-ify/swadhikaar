# Local vs deployed

**52 migrations are applied to the project; this directory holds a subset.** The gap
is historical: much of the early schema was applied through the Supabase MCP or the
dashboard before this directory existed, and there is no Supabase CLI on the dev
machine to `db pull` it back.

That drift is a real bug source here, not a tidiness complaint. It is what let
`risk-predict` run `edge-heuristic-v2` in production while git held v1 — a redeploy
from the repo would have silently reverted the model.

## What is captured

| file | covers |
|---|---|
| `000_baseline.sql` | original schema |
| `001_flood_advisory.sql` | realtime publication, geography recovery, `flood_risk_cohort`, Flood Advisory workflow |
| `001_grant_app_role.sql` | role helper |
| `002_acute_layer_schema.sql` | acute layer: types, tables, indexes, `facilities` additions |
| `003_acute_layer_rls.sql` | acute layer: RLS policies, role helpers, cron schedule (as comments) |
| `004_acute_layer_hardening.sql` | authorisation on accept/decline/open, `numeric_or_null`, vitals key fix, realtime publication |
| `005_fleet_and_intake.sql` | ambulance leg (units, assignments, dispatch columns), `intake_events`, coordinate constraints, RLS |
| `006_notification_outbox.sql` | outbox with retry and wave keying, enqueue triggers, drain cron |

## What is NOT captured

**The acute layer's functions.** `open_dispatch`, `accept_dispatch_offer`,
`decline_dispatch_offer`, `escalate_dispatch`, `emit_wave_offers`,
`score_dispatch_candidates`, `classify_incident_severity`,
`specialities_for_incident`, `dispatch_tier_policy`, `sweep_dispatch_timeouts`,
`expire_stale_incidents`, and the triggers — plus everything from the pre-existing
schema not listed above.

The database is the source of truth for those. Recover them with:

```bash
supabase db pull            # needs the CLI, not installed on this machine
# or, per function:
select pg_get_functiondef('public.open_dispatch(uuid,boolean)'::regprocedure);
```

## Before changing a function

Read the deployed definition first — do not assume the local file is current:

```sql
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = '<name>';
```

Same rule for edge functions: check the deployed bundle with the MCP
`get_edge_function` before editing `supabase/functions/*`.
