-- Self-check for rank_receiving_facilities. Each assertion names the defect it
-- guards, so a failure says which behaviour regressed.
--
-- Run against the project:
--   supabase db execute --file supabase/tests/rank_receiving_facilities.sql
-- or paste into the SQL editor. Read-only.
--
-- The campus sub-unit check is the important one. That defect has now appeared
-- three times in three layers -- bed counts, map draw order, and ranking -- because
-- OpenStreetMap maps every building on a teaching-hospital campus as its own
-- amenity=hospital. "GMCH PEDIATRIC DIVISION" once outranked Gauhati Medical College
-- as the destination for an arbitrary acute case.

with checks as (
  select 'morgue or dental college never rankable' as check_name,
         not exists (select 1 from rank_receiving_facilities(26.1413,91.7900,25)
                     where name ~* 'postmortem|mortuary|dental|blood bank') as passed
  union all
  select 'campus sub-unit does not outrank its own campus',
         (select r1.score from rank_receiving_facilities(26.1413,91.7900,25) r1
           where r1.name ilike '%Gauhati Medical College%' limit 1)
         >
         coalesce((select max(r2.score) from rank_receiving_facilities(26.1413,91.7900,25) r2
           where r2.tier = 'campus sub-unit'), 0)
  union all
  select 'nearest results are actually near (top 5 within 10km of Dispur)',
         (select max(distance_km) from rank_receiving_facilities(26.1413,91.7900,5)) < 10
  union all
  select 'Patna query returns Patna hospitals, not Guwahati ones',
         (select count(*) from rank_receiving_facilities(25.6173,85.1451,5)
           where distance_km < 15) = 5
  union all
  -- Each factor must explain itself; a bare score is not a dispatch decision.
  select 'every result carries three reasons',
         (select bool_and(array_length(reasons,1) = 3)
            from rank_receiving_facilities(26.1413,91.7900,10))
  union all
  -- Simulated bed counts must never influence ranking.
  select 'beds_available is not an input',
         (select count(*) from pg_get_functiondef(
            'public.rank_receiving_facilities(numeric,numeric,integer)'::regprocedure
          ) as d(def) where d.def ~* 'beds_available') = 0
)
select check_name, case when passed then 'PASS' else '*** FAIL ***' end as result
from checks order by passed, check_name;
