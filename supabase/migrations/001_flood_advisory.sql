-- Layer 4 — flood advisory, plus the two things it exposed as missing.
--
-- Ordering matters: the realtime fix and the geography recovery are prerequisites.
-- A flood advisory over a district whose patients have no district resolves to an
-- empty cohort, and an empty cohort looks identical to a working one.

-- ---------------------------------------------------------------------------
-- 1. Realtime was never actually on.
-- ---------------------------------------------------------------------------
-- postgres_changes only fires for tables in the supabase_realtime publication,
-- and that publication had table_count = 0. useRealtimeEscalations() has been
-- subscribing to nothing since it was written: the doctor's screen only ever
-- updated because something else triggered a refetch. Same shape as every
-- written-but-never-read bug — the visible half worked.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'escalations'
  ) then
    alter publication supabase_realtime add table public.escalations;
  end if;
end $$;

-- Default replica identity ships only the PK on UPDATE/DELETE, so a subscriber
-- filtering on old values silently sees nulls. FULL costs extra WAL per row.
-- ponytail: FULL because these tables hold hundreds of rows, not millions;
-- revisit if escalations ever grows past ~1e6.
alter table public.escalations replica identity full;

-- ---------------------------------------------------------------------------
-- 2. Geography, recovered from camp provenance — not invented.
-- ---------------------------------------------------------------------------
-- 222 patients had district IS NULL. They are imported Patna health-camp records
-- (PS-3 dataset), and the source CSV has no district/village/lat/lon column at
-- all — health_camp is the only geographic signal in it. Every camp is a Patna
-- institution, so the district is *recoverable* rather than missing.
--
-- The 2 rows with no camp name keep district NULL. There is nothing to recover
-- them from, and guessing would be the one thing this migration is avoiding.

-- Same camp, two spellings, and the typo'd copy was also mis-typed as 'general'
-- so one camp reported as two with different types.
update public.patients
   set health_camp = 'Disha Deaddiction Center',
       camp_type   = 'deaddiction'
 where health_camp = 'Disha Deaddction Center';

-- Village only where the camp name actually names a locality. Gandhi Maidan and
-- Digha are Patna localities; an old-age home and a de-addiction centre are not,
-- so those keep village NULL rather than getting a plausible-looking value.
update public.patients
   set district = 'Patna',
       village  = case
         when health_camp in ('Gandhi Maidan Morning Jilo Health',
                              'Jilo Health Gandhi Maidan') then 'Gandhi Maidan'
         when health_camp = 'Digha Slum Healthcamp'         then 'Digha'
         else village
       end
 where district is null
   and health_camp is not null;

-- ---------------------------------------------------------------------------
-- 3. Flood cohort — ongoing clinical need, not occupation.
-- ---------------------------------------------------------------------------
-- heat_risk_cohort() filters to outdoor workers because heat injures whoever is
-- standing in it. Flood is a different mechanism: it cuts off the road to the
-- clinic, the medicine shop, and clean water. That endangers whoever is mid
-- treatment, regardless of what they do for a living — so the filter is clinical
-- state, not occupation.
--
-- Returns heat_risk_cohort's five columns plus reason, so the advisory function
-- reads one shape for both hazards and gets the rationale for free.
create or replace function public.flood_risk_cohort(p_district text)
 returns table(patient_id uuid, name text, phone text, language text,
               occupation text, reason text)
 language sql stable security definer set search_path to 'public'
as $function$
  select p.id, p.name, p.phone, p.language, p.occupation,
         case
           when p.risk_level = 'High' then 'high clinical risk'
           when p.journey_status in ('follow_up_active','recovery','opd_referred')
             then 'active care episode'
           else 'newborn in household'
         end
    from patients p
   where p.district = p_district
     and p.phone is not null
     and ( p.risk_level = 'High'
           or p.journey_status in ('follow_up_active','recovery','opd_referred')
           -- exists, not a join: a parent of twins must not be called twice.
           or exists (select 1 from newborns n where n.parent_patient_id = p.id) );
$function$;

-- Returns names and phone numbers as SECURITY DEFINER, so it bypasses RLS by
-- construction. Only the edge function needs it.
revoke all on function public.flood_risk_cohort(text) from public, anon, authenticated;
grant execute on function public.flood_risk_cohort(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Flood Advisory workflow.
-- ---------------------------------------------------------------------------
-- Thresholds picked from measured forecasts, then left alone. Nothing in Assam
-- or Bihar clears IMD's heavy-rain line (64.5mm/24h) this week, so a raw-mm gate
-- would be a number chosen to make a demo fire. Persistence is the real flood
-- mechanism on these floodplains: saturated ground stops absorbing, so 36h of
-- moderate rain floods where one intense burst drains. Measured 2026-08-25 over
-- 16 three-hourly slots (~48h): Guwahati 43.8mm/15 wet, Dhubri 25.2/12,
-- Patna 18.6/6, Muzaffarpur 15.7/8, Darbhanga 6.0/5.
--
-- Either condition trips. Guwahati clears both, Dhubri clears persistence only,
-- Patna clears neither — which is the correct answer for Patna today, not a bug.
insert into public.workflows
  (name, description, trigger_type, trigger_config, conditions, actions, is_active)
select
  'Flood Advisory',
  'District flood advisory calls to patients with ongoing clinical need, '
    || 'triggered by forecast rainfall depth or persistence',
  'event_based',
  jsonb_build_object(
    'rainfall_mm_48h', 40,
    'wet_slots_min',   12,
    'call_hour_utc',    3,
    'call_minute_utc', 30
  ),
  jsonb_build_object(
    'risk_level',     jsonb_build_array('High'),
    'journey_status', jsonb_build_array('follow_up_active','recovery','opd_referred'),
    'newborn_in_household', true
  ),
  jsonb_build_array(jsonb_build_object('type','voice_call','template','flood_advisory')),
  true
where not exists (select 1 from public.workflows where name = 'Flood Advisory');
