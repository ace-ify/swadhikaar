-- 011: a victim cannot always press the button.
--
-- The whole patient side assumed the person in the emergency is the person holding the
-- phone. For a road accident that is almost never true: somebody stops, or a daughter
-- presses it for her father. EOS ships this as a "Victim & Volunteer" app for exactly
-- that reason.
--
-- The dangerous half was silent. attach_patient_to_incident resolved the patient from
-- created_by, so a bystander reporting for a stranger attached the BYSTANDER's blood
-- group, allergies and next of kin to the person on the ground -- and the hospital would
-- have prepared for the wrong body. The trigger already refused to do this down the
-- phone path and said so in a comment; it did it anyway down the account path, because
-- until now the two cases were indistinguishable in the row.
--
-- What is NOT here: a volunteer grid, volunteer dispatch, or a leaderboard. A bystander
-- here is someone who is already standing there and can see what happened. Alerting
-- strangers to an address and scoring them for turning up is a different product and one
-- we cannot support with no volunteers and no vetting.

alter table public.incidents
  add column if not exists reported_for_self boolean not null default true;

comment on column public.incidents.reported_for_self is
  'False when a bystander reported for someone else. Suppresses medical-history attach: '
  'the reporter''s record is not the victim''s record.';

create or replace function public.attach_patient_to_incident()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  pid uuid;
begin
  -- An explicit link from the caller always wins -- a dispatcher naming the patient
  -- knows something the trigger does not.
  pid := new.patient_id;

  -- Identity is only inferred when the report is about the reporter. A bystander's
  -- account and phone say who is holding the phone, not who is on the ground.
  if pid is null and new.reported_for_self then
    if new.created_by is not null then
      select id into pid from patients where auth_user_id = new.created_by limit 1;
    end if;

    if pid is null and new.reporter_phone is not null then
      select id into pid from patients
       where phone = new.reporter_phone
         and auth_user_id is not null      -- a claimed account, not any record
       limit 1;
    end if;
  end if;

  if pid is not null then
    new.patient_id := pid;

    if new.medical_snapshot = '{}'::jsonb then
      new.medical_snapshot := coalesce(emergency_snapshot(pid), '{}'::jsonb);
    end if;

    -- The name travels with the snapshot, or the receiving hospital reads
    -- "Unidentified" for someone we hold a full record for.
    if new.victim_name is null then
      select name into new.victim_name from patients where id = pid;
    end if;
  end if;

  -- The SOS button sends coordinates and no district, and the ref is built from the
  -- district. Nearest facility that knows its own district: same haversine ordering the
  -- dispatcher uses, no new data source.
  if new.district is null and new.lat is not null and new.lon is not null then
    select f.district into new.district
      from facilities f
     where f.district is not null
     order by (f.lat - new.lat) * (f.lat - new.lat)
            + (f.lon - new.lon) * (f.lon - new.lon)
     limit 1;
  end if;

  return new;
end;
$$;
