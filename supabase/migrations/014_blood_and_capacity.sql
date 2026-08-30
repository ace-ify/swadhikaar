-- 014: blood, declared capacity, and the button that matched nothing.
--
-- Three things, one migration, because they are the same defect seen from three sides:
-- the dispatch engine reserved 7-8% of its score for blood availability and then fed it
-- a hardcoded zero, so the weight was redistributed away and no facility was ever
-- preferred for having blood. The demo flow claims hospitals are selected on "bed/blood
-- availability". Beds were real but off by default. Blood did not exist.
--
-- And the case that needs blood most did not even reach the specialty factor:
--
--   select specialities_for_incident('Severe bleeding', '...')  ->  {}
--
-- "बहुत खून बह रहा है" is one of six buttons on the SOS screen. It produced no tags, so
-- a haemorrhage was ranked on proximity and hospital tier alone -- a district hospital
-- with no blood bank could outrank a trauma centre with one. Fixed here rather than
-- alongside, because wiring the blood factor without fixing this leaves the factor
-- switched off for precisely the incidents it exists for.

-- ---------------------------------------------------------------- 1. the columns
alter table public.facilities
  add column if not exists has_blood_bank        boolean,
  add column if not exists blood_units_available integer,
  add column if not exists capacity_declared_at  timestamptz;

comment on column public.facilities.has_blood_bank is
  'Null means unknown, which scores between "yes" and "no" rather than as "no": an '
  'unsurveyed facility should not be punished as though it had been surveyed and failed.';
comment on column public.facilities.capacity_declared_at is
  'When a human at the facility last confirmed beds/blood/staffing. Null means the '
  'numbers are seed data nobody has stood behind. The factors JSON says which.';

alter table public.facilities
  drop constraint if exists facilities_blood_units_sane;
alter table public.facilities
  add constraint facilities_blood_units_sane
  check (blood_units_available is null or blood_units_available between 0 and 10000);

-- ------------------------------------------------- 2. the button that matched nothing
-- Bleeding, haemorrhage and amputation join 'trauma'. Hindi beside English for the same
-- reason classify_incident_severity carries it: the text arriving from an SMS or a voice
-- transcript is not in English.
create or replace function public.specialities_for_incident(p_type text, p_description text)
returns text[]
language sql immutable set search_path to 'public'
as $function$
  select coalesce(array_agg(distinct s), '{}') from (
    select unnest(array[
      case when lower(coalesce(p_type,'')||' '||coalesce(p_description,''))
             ~ 'cardiac|heart attack|dil ka daura|chest pain|seene mein dard|angina|palpitation'
           then 'cardiology' end,
      case when lower(coalesce(p_type,'')||' '||coalesce(p_description,''))
             ~ 'stroke|laqwa|lakwa|paralysis|head injury|sar mein chot|seizure|mirgi|convuls|unconscious|behosh|brain'
           then 'neurology' end,
      case when lower(coalesce(p_type,'')||' '||coalesce(p_description,''))
             ~ 'fracture|haddi|broken|dislocat|spine|joint|crush'
           then 'orthopaedics' end,
      case when lower(coalesce(p_type,'')||' '||coalesce(p_description,''))
             ~ 'labour|delivery|prasav|pregnan|eclamp|obstetric|miscarriage|postpartum'
           then 'obstetrics' end,
      case when lower(coalesce(p_type,'')||' '||coalesce(p_description,''))
             ~ 'child|infant|baby|newborn|shishu|p(a)?ediatric'
           then 'paediatrics' end,
      case when lower(coalesce(p_type,'')||' '||coalesce(p_description,''))
             ~ 'eye|ocular|vision|aankh'
           then 'ophthalmology' end,
      case when lower(coalesce(p_type,'')||' '||coalesce(p_description,''))
             ~ 'burn|jal gaya|scald|acid'
           then 'burns' end,
      -- Bleeding added: 'Severe bleeding' is a button on the SOS screen and it used to
      -- come back with no tags at all. The pattern is parenthesised because `~` binds
      -- tighter than `||`, so without them this reads as (text ~ 'a') || 'b'.
      case when lower(coalesce(p_type,'')||' '||coalesce(p_description,''))
             ~ ('accident|trauma|collision|fall|gir gaya|assault|stab|gunshot|'
             || 'bleed|khoon|haemorrhage|hemorrhage|amputat|laceration|gehra')
           then 'trauma' end,
      case when lower(coalesce(p_type,'')||' '||coalesce(p_description,''))
             ~ 'breathless|saans|asthma|dama|pneumon|lung|chest infection|tb '
           then 'pulmonology' end,
      case when lower(coalesce(p_type,'')||' '||coalesce(p_description,''))
             ~ 'kidney|renal|dialysis|urine'
           then 'nephrology' end
    ]) as s
  ) t where s is not null;
$function$;

-- ------------------------------------------------------- 3. the blood factor, wired
-- p_needs_blood is appended LAST and defaults false, so every existing positional
-- caller keeps working unchanged.
--
-- Blood is asked for per incident, not per facility: a stocked blood bank should not
-- outrank a closer hospital for a case that will never transfuse. When it is not
-- needed the weight is redistributed rather than scored zero for everybody, which
-- would flatten the factor into noise instead of removing it.
create or replace function public.score_dispatch_candidates(
  p_lat numeric,
  p_lon numeric,
  p_severity incident_severity,
  p_required_services text[] default '{}'::text[],
  p_incident_id uuid default null::uuid,
  p_radius_km numeric default 60,
  p_use_simulated_capacity boolean default false,
  p_needed_specialities text[] default '{}'::text[],
  p_needs_blood boolean default false)
returns table(facility_id uuid, name text, distance_km numeric, eta_seconds integer,
              tier text, score numeric, factors jsonb, disqualified text)
language sql stable security definer set search_path to 'public'
as $function$
with weights as (
  select w.* from (values
    ('critical'::incident_severity, 0.28, 0.22, 0.15, 0.10, 0.08, 0.07, 0.05, 0.03, 0.02),
    ('high'::incident_severity,     0.25, 0.20, 0.15, 0.10, 0.08, 0.08, 0.07, 0.04, 0.03),
    ('standard'::incident_severity, 0.22, 0.18, 0.18, 0.10, 0.07, 0.10, 0.08, 0.04, 0.03)
  ) as w(sev, w_prox, w_spec, w_cap, w_staff, w_blood, w_load, w_emg, w_fresh, w_rel)
  where w.sev = p_severity
),
box as (
  select p_radius_km / 111.0 as dlat,
         p_radius_km / (111.0 * greatest(0.1, cos(radians(p_lat)))) as dlon
),
live_load as (
  select o.facility_id, count(distinct o.incident_id) as n
    from dispatch_offers o
    join incident_dispatch d on d.incident_id = o.incident_id
   where o.state in ('pending','accepted')
     and d.state in ('offering','accepted')
     and (p_incident_id is null or o.incident_id <> p_incident_id)
   group by o.facility_id
),
cand as (
  select f.id, f.name, f.amenity, f.healthcare, f.emergency, f.speciality,
    f.beds_total, f.beds_available, f.doctors_on_duty, f.acute_capability,
    f.specialities, f.updated_at,
    f.has_blood_bank, f.blood_units_available, f.capacity_declared_at,
    round((6371 * acos(least(1.0,
        cos(radians(p_lat)) * cos(radians(f.lat)) *
        cos(radians(f.lon) - radians(p_lon)) +
        sin(radians(p_lat)) * sin(radians(f.lat))
    )))::numeric, 2) as km,
    coalesce(l.n, 0) as load_n
  from facilities f
  cross join box b
  left join live_load l on l.facility_id = f.id
  where f.dispatch_eligible
    and f.lat between p_lat - b.dlat and p_lat + b.dlat
    and f.lon between p_lon - b.dlon and p_lon + b.dlon
),
within as (select * from cand where km <= p_radius_km),
typed as (
  select w.*,
    (w.specialities && p_needed_specialities
     or (cardinality(p_required_services) > 0 and exists (
          select 1 from unnest(p_required_services) rs
           where coalesce(w.healthcare,'') || ' ' || coalesce(w.speciality,'') || ' ' ||
                 w.name || ' ' || array_to_string(w.specialities, ' ')
                 ilike '%' || rs || '%'))) as speciality_wanted,
    case
      when w.name ~* 'emergency|trauma|casualty' then 'emergency unit'
      when w.name ~* '(division|department|ward|block|annexe|annex|wing|opd|nursing home)'
        then 'campus sub-unit'
      when w.name ~* 'medical college|gmch|aiims|pmch' then 'tertiary / teaching'
      when w.name ~* 'civil hospital|district hospital' then 'district'
      when w.amenity = 'hospital' then 'hospital'
      else 'clinic'
    end as raw_tier
  from within w
),
labelled as (
  select t.*,
    case when t.acute_capability = 'speciality_only' and not t.speciality_wanted
         then 'speciality clinic'
         else t.raw_tier end as tier_label
  from typed t
),
scored as (
  select l.*,
    greatest(60, round((l.km / 30.0) * 3600))::integer as eta_s,
    greatest(0, least(1, 1 - (greatest(0, (l.km / 30.0) * 60 - 3) / 27.0))) as f_prox,
    case
      when l.speciality_wanted then 1.00
      when cardinality(p_required_services) = 0 and cardinality(p_needed_specialities) = 0 then
        case l.tier_label
          when 'emergency unit'      then 1.00
          when 'tertiary / teaching' then 0.95
          when 'district'            then 0.70
          when 'hospital'            then 0.50
          when 'speciality clinic'   then 0.15
          when 'campus sub-unit'     then 0.25
          else 0.20 end
      else
        case l.tier_label
          when 'emergency unit'      then 0.80
          when 'tertiary / teaching' then 0.85
          when 'district'            then 0.55
          when 'hospital'            then 0.40
          when 'speciality clinic'   then 0.10
          when 'campus sub-unit'     then 0.20
          else 0.15 end
    end as f_spec,
    case when l.emergency is true then 1.0
         when l.emergency is null then 0.4
         else 0.0 end as f_emg,
    case l.load_n when 0 then 1.0 when 1 then 0.85 when 2 then 0.65 when 3 then 0.35
         else 0.0 end as f_load,
    case
      when l.updated_at is null then 0.3
      when l.updated_at > now() - interval '7 days'   then 1.0
      when l.updated_at > now() - interval '30 days'  then 0.7
      when l.updated_at > now() - interval '180 days' then 0.4
      else 0.2 end as f_fresh,
    coalesce((select fr.accept_rate from facility_reliability fr
               where fr.facility_id = l.id), 0.7) as f_rel,
    case when p_use_simulated_capacity and l.beds_available is not null then
      case when l.beds_available <= 0 then 0.0
           when l.beds_available <= 2 then 0.4
           when l.beds_available <= 5 then 0.7
           when l.beds_available <= 10 then 0.9
           else 1.0 end
    else 0.0 end as f_cap,
    case when p_use_simulated_capacity and l.doctors_on_duty is not null then
      greatest(0, least(1, 0.2 + l.doctors_on_duty / 12.0))
    else 0.0 end as f_staff,
    -- Unknown is NOT the same as no. A facility nobody has surveyed sits between a
    -- confirmed blood bank and a confirmed absence, so an unsurveyed district hospital
    -- is not ranked below a surveyed clinic that said no.
    case
      when not (p_use_simulated_capacity and p_needs_blood) then 0.0
      when l.has_blood_bank is false                        then 0.00
      when l.has_blood_bank is null                         then 0.45
      when l.blood_units_available is null                  then 0.70
      when l.blood_units_available >= 10                    then 1.00
      when l.blood_units_available >= 4                     then 0.85
      when l.blood_units_available >= 1                     then 0.50
      else 0.15
    end as f_blood
  from labelled l
),
final as (
  select s.*, w.*,
    -- Weight we have no input for is redistributed across the factors we do have, so a
    -- score means the same thing whether or not capacity was in play. Blood is tracked
    -- separately from beds/staffing because it is skipped for being irrelevant to this
    -- incident, not for being unknown.
    (case when p_use_simulated_capacity then 0 else w.w_cap + w.w_staff end)
    + (case when p_use_simulated_capacity and p_needs_blood then 0 else w.w_blood end)
      as unused_w
  from scored s cross join weights w
)
select
  f.id, f.name, f.km, f.eta_s, f.tier_label,
  round((
    (f.w_prox * f.f_prox + f.w_spec * f.f_spec + f.w_emg * f.f_emg +
     f.w_load * f.f_load + f.w_fresh * f.f_fresh + f.w_rel * f.f_rel)
      / (1.0 - f.unused_w)
    + (case when p_use_simulated_capacity
            then f.w_cap * f.f_cap + f.w_staff * f.f_staff else 0 end)
    + (case when p_use_simulated_capacity and p_needs_blood
            then f.w_blood * f.f_blood else 0 end)
  )::numeric, 4) as score,
  jsonb_build_object(
    'proximity',   jsonb_build_object('value', round(f.f_prox,3),  'weight', f.w_prox,  'source', 'osm_coordinates'),
    'specialty',   jsonb_build_object('value', round(f.f_spec,3),  'weight', f.w_spec,  'source', 'name_derived',
                                      'matched', f.speciality_wanted,
                                      'facility_specialities', to_jsonb(f.specialities),
                                      'needed', to_jsonb(p_needed_specialities)),
    'emergency',   jsonb_build_object('value', round(f.f_emg,3),   'weight', f.w_emg,   'source', 'osm_tags'),
    'load',        jsonb_build_object('value', round(f.f_load,3),  'weight', f.w_load,  'source', 'our_dispatch_table', 'concurrent', f.load_n),
    'freshness',   jsonb_build_object('value', round(f.f_fresh,3), 'weight', f.w_fresh, 'source', 'our_facilities_table'),
    'reliability', jsonb_build_object('value', round(f.f_rel,3),   'weight', f.w_rel,   'source', 'our_offer_history'),
    -- 'source' now says who stood behind the number, because "simulated" stopped being
    -- true the moment a facility could declare it from the inbox screen.
    'capacity',    jsonb_build_object('value', round(f.f_cap,3),   'weight', f.w_cap,
                                      'source', case when f.capacity_declared_at is null
                                                     then 'SEEDED' else 'facility_declared' end,
                                      'declared_at', f.capacity_declared_at,
                                      'beds_available', f.beds_available,
                                      'included', p_use_simulated_capacity),
    'staffing',    jsonb_build_object('value', round(f.f_staff,3), 'weight', f.w_staff,
                                      'source', case when f.capacity_declared_at is null
                                                     then 'SEEDED' else 'facility_declared' end,
                                      'doctors_on_duty', f.doctors_on_duty,
                                      'included', p_use_simulated_capacity),
    'blood',       jsonb_build_object('value', round(f.f_blood,3), 'weight', f.w_blood,
                                      'source', case when f.capacity_declared_at is null
                                                     then 'SEEDED' else 'facility_declared' end,
                                      'has_blood_bank', f.has_blood_bank,
                                      'units_available', f.blood_units_available,
                                      'needed_for_this_incident', p_needs_blood,
                                      'included', p_use_simulated_capacity and p_needs_blood),
    'eta_basis',   'haversine at 30km/h — no routing API, not traffic aware',
    'redistributed_weight', round(f.unused_w, 3)
  ) as factors,
  case
    when f.tier_label = 'campus sub-unit'   then 'campus_subunit'
    when f.tier_label = 'speciality clinic' then 'wrong_speciality'
    when p_severity = 'standard' and p_use_simulated_capacity
         and f.beds_total > 0 and f.beds_available <= 0 then 'no_beds'
    else null
  end as disqualified
from final f
order by score desc, f.km asc;
$function$;

-- The 8-arg overload SURVIVES create-or-replace, because changing the signature creates
-- a new function rather than replacing the old one. open_dispatch passes 8 positional
-- arguments, so exact-match overload resolution would have kept sending every dispatch
-- to the OLD body and the blood factor would have been dead on arrival -- silently.
drop function if exists public.score_dispatch_candidates(
  numeric, numeric, incident_severity, text[], uuid, numeric, boolean, text[]);

-- ------------------------------------------- 4. open_dispatch decides who needs blood
-- Full body is in the deployed function; the change is these two blocks. Read the
-- deployed definition before editing, per this directory's README:
--   select pg_get_functiondef('public.open_dispatch(uuid,boolean)'::regprocedure);
--
--   needs_blood :=
--     (inc.severity in ('critical','high')
--      and needed && array['trauma','obstetrics','burns','orthopaedics'])
--     or exists (select 1 from unnest(inc.required_services) rs where rs ilike '%blood%');
--
-- Gated on severity on purpose: a standard-severity fall is tagged 'trauma' but is not a
-- reason to prefer a blood bank over a closer hospital. An explicit required_services
-- entry always counts -- a dispatcher naming blood knows something the tags do not.
-- The value is passed as the 9th argument to score_dispatch_candidates, and recorded in
-- the dispatch_opened event so the trail says why blood was or was not weighed.

-- ------------------------------------------------ 5. the write path that makes it real
-- Until now `facilities` had a SELECT policy and nothing else, so beds and staffing were
-- seed data no human could correct -- which is exactly why the factors JSON had to label
-- them SIMULATED. This is the write path. A function rather than an UPDATE policy so a
-- facility can declare its capacity without also being able to edit its own lat/lon,
-- dispatch_eligible flag or speciality tags to make itself rank higher.
create or replace function public.declare_facility_capacity(
  p_facility uuid,
  p_beds_available integer default null,
  p_doctors_on_duty integer default null,
  p_has_blood_bank boolean default null,
  p_blood_units integer default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_row record;
begin
  if not (p_facility = any (current_user_facility_ids())
          or current_user_has_role(array['admin','dispatcher'])) then
    return jsonb_build_object('ok', false, 'error', 'not_authorised_for_facility');
  end if;

  select beds_total into v_row from facilities where id = p_facility;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'facility_not_found');
  end if;

  if p_beds_available is not null and p_beds_available < 0 then
    return jsonb_build_object('ok', false, 'error', 'beds_available cannot be negative');
  end if;
  -- Declaring more free beds than the facility has is a typo, not a capability. Rejected
  -- rather than clamped: silently changing a number somebody typed is worse than saying no.
  if p_beds_available is not null and v_row.beds_total is not null
     and p_beds_available > v_row.beds_total then
    return jsonb_build_object('ok', false, 'error', 'more free beds than total beds',
                              'beds_total', v_row.beds_total);
  end if;
  if p_blood_units is not null and (p_blood_units < 0 or p_blood_units > 10000) then
    return jsonb_build_object('ok', false, 'error', 'blood units out of range');
  end if;

  -- coalesce so a partial declaration does not blank the fields it left alone. Setting
  -- has_blood_bank to false explicitly still works: only NULL means "not stated".
  update facilities set
    beds_available        = coalesce(p_beds_available, beds_available),
    doctors_on_duty       = coalesce(p_doctors_on_duty, doctors_on_duty),
    has_blood_bank        = coalesce(p_has_blood_bank, has_blood_bank),
    blood_units_available = coalesce(p_blood_units, blood_units_available),
    capacity_declared_at  = now(),
    -- Also bumps the freshness factor, which is the point: a facility that keeps its
    -- numbers current should rank above one whose row has not been touched in a month.
    updated_at            = now()
  where id = p_facility;

  return jsonb_build_object('ok', true, 'declared_at', now());
end
$function$;

revoke all on function public.declare_facility_capacity(uuid,integer,integer,boolean,integer)
  from public, anon;
grant execute on function public.declare_facility_capacity(uuid,integer,integer,boolean,integer)
  to authenticated;

-- --------------------------------------------------------------------- 6. seed values
-- So the factor has something to read before anybody declares. Deterministic from the id
-- so a demo reset gives the same numbers twice. NULL stays NULL for facilities that are
-- neither obviously a blood-bank holder nor obviously not one -- unknown scores 0.45,
-- between a confirmed yes and a confirmed no.
update public.facilities f set
  has_blood_bank = case
    when f.name ~* 'medical college|aiims|pmch|civil hospital|district hospital|trauma' then true
    when f.name ~* 'clinic|nursing home|opd|dispensary' then false
    else null end,
  blood_units_available = case
    when f.name ~* 'medical college|aiims|pmch'
      then 20 + (('x'||substr(md5(f.id::text),1,4))::bit(16)::int % 30)
    when f.name ~* 'civil hospital|district hospital|trauma'
      then 4 + (('x'||substr(md5(f.id::text),1,4))::bit(16)::int % 12)
    else null end
where f.dispatch_eligible;

-- --------------------------------------------------------------------------- caller
-- supabase/functions/incident-intake now passes p_use_simulated_capacity: true. With the
-- declare path in place the flag no longer means "invent numbers", it means "weigh the
-- capacity numbers the facilities have given us". The parameter keeps its old name only
-- because three other call sites use it; the factors JSON is where the honest label now
-- lives (SEEDED vs facility_declared, with declared_at).
