-- 010: three defects found by driving the patient side as the patient, not as postgres.
--
-- 1. A patient could not save their own emergency card. `patients_update` has
--    WITH CHECK (is_admin() or current_app_role() in ('asha','doctor')) -- the patient
--    role is absent, so the Save button returned 42501 every time. It looked fine in
--    SQL because the MCP connects as postgres, which RLS does not apply to.
--
-- 2. A hospital was shown "Unidentified" for a patient the system knows by name. The
--    attach trigger linked patient_id and copied the medical snapshot but never the
--    name, and nothing downstream filled it in -- so the receiving team had a blood
--    group and no person, and closing the case created a follow-up record literally
--    called "Unknown male" that the voice layer then rang for thirty days.
--
-- 3. Every SOS from a phone produced ref H-XX-nnnnn and "Location unknown", because
--    the button sends coordinates and no district. The ref is the one string a patient
--    reads out on the phone.
--
-- 2 and 3 are one fix in one trigger, because that trigger already runs before
-- set_incident_ref and already exists to fill in what we know about an incident.

-- ---------------------------------------------------------------------------
-- The patient's own emergency card
-- ---------------------------------------------------------------------------
-- An rpc rather than a write policy, for the reason the client module states: every
-- mutation here is an rpc so the writable surface is a list of columns rather than a
-- table. A row policy is row-level -- widening it to the patient role would also let
-- them set assigned_doctor_id, village and risk_level on their own record.
create or replace function public.save_my_emergency_profile(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  pid uuid;
begin
  select id into pid from patients where auth_user_id = auth.uid() limit 1;
  if pid is null then
    return jsonb_build_object('ok', false, 'error', 'no_record_linked');
  end if;

  update patients set
    blood_group = case when p_patch ? 'blood_group'
                       then nullif(trim(p_patch->>'blood_group'), '') else blood_group end,
    allergies = case when p_patch ? 'allergies'
                     then coalesce(array(select jsonb_array_elements_text(p_patch->'allergies')), '{}')
                     else allergies end,
    chronic_conditions = case when p_patch ? 'chronic_conditions'
                              then coalesce(array(select jsonb_array_elements_text(p_patch->'chronic_conditions')), '{}')
                              else chronic_conditions end,
    current_medications = case when p_patch ? 'current_medications'
                               then coalesce(array(select jsonb_array_elements_text(p_patch->'current_medications')), '{}')
                               else current_medications end,
    emergency_contact_name = case when p_patch ? 'emergency_contact_name'
                                  then nullif(trim(p_patch->>'emergency_contact_name'), '')
                                  else emergency_contact_name end,
    emergency_contact_phone = case when p_patch ? 'emergency_contact_phone'
                                   then nullif(trim(p_patch->>'emergency_contact_phone'), '')
                                   else emergency_contact_phone end,
    emergency_profile_updated_at = now()
  where id = pid;

  return jsonb_build_object('ok', true, 'patient_id', pid, 'at', now());
end;
$$;

revoke all on function public.save_my_emergency_profile(jsonb) from public;
grant execute on function public.save_my_emergency_profile(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Who the incident is about, and where it is
-- ---------------------------------------------------------------------------
create or replace function public.attach_patient_to_incident()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  pid uuid;
begin
  -- Resolve in order of how strongly each identifies a person: an explicit link from
  -- the caller, then the signed-in account, then the reporting number. Phone is last
  -- on purpose -- a bystander calling from their own phone must not attach the
  -- bystander's medical history to the victim.
  pid := new.patient_id;

  if pid is null and new.created_by is not null then
    select id into pid from patients where auth_user_id = new.created_by limit 1;
  end if;

  if pid is null and new.reporter_phone is not null then
    select id into pid from patients
     where phone = new.reporter_phone
       and auth_user_id is not null      -- a claimed account, not any record
     limit 1;
  end if;

  if pid is not null then
    new.patient_id := pid;

    if new.medical_snapshot = '{}'::jsonb then
      new.medical_snapshot := coalesce(emergency_snapshot(pid), '{}'::jsonb);
    end if;

    -- The name travels with the snapshot. Without this the receiving hospital reads
    -- "Unidentified" for someone we have a full record for, and the patient row
    -- created when the case closes is named "Unknown male". Only filled when the
    -- caller left it blank: a bystander reporting for a stranger may know the name
    -- when we do not, and their version wins.
    -- Age is not copied because patients has no age column -- victim_age stays whatever
    -- the reporter gave, which is honest.
    if new.victim_name is null then
      select name into new.victim_name from patients where id = pid;
    end if;
  end if;

  -- The SOS button sends coordinates and no district, so the ref came out H-XX-nnnnn
  -- and the hospital card said "Location unknown". Nearest facility that knows its own
  -- district: the same haversine ordering the dispatcher uses, and no new data source.
  -- ponytail: nearest-facility district, not a real boundary lookup. Swap in a
  -- district polygon table if a ref ever has to be legally correct rather than spoken.
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

-- ---------------------------------------------------------------------------
-- Taking it back
-- ---------------------------------------------------------------------------
-- A patient who pressed the button by mistake had no way out: no rpc, no button, and
-- incident_status has carried 'cancelled' the whole time with nothing able to reach it.
-- Fifteen hospitals get asked and the only exit was to find a dispatcher.
--
-- fleet_offer_state has no 'stood_down'; 'no_response' already means "this offer ended
-- without the crew answering", which is what a cancellation leaves behind. A new enum
-- value would be a state nothing else reads.
create or replace function public.cancel_my_incident(p_incident uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  inc record;
begin
  select i.id, i.status, i.created_by, d.ambulance_state
    into inc
    from incidents i
    left join incident_dispatch d on d.incident_id = i.id
   where i.id = p_incident;

  if inc.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_such_incident');
  end if;

  if inc.created_by is distinct from auth.uid()
     and not current_user_has_role(array['admin','dispatcher']) then
    return jsonb_build_object('ok', false, 'error', 'not_your_incident');
  end if;

  if inc.status in ('resolved','cancelled','expired','arrived') then
    return jsonb_build_object('ok', false, 'error', 'already_closed', 'status', inc.status);
  end if;

  -- After loading, the call belongs to the crew, not to a phone tap.
  if inc.ambulance_state = 'transporting' then
    return jsonb_build_object('ok', false, 'error', 'patient_already_on_board');
  end if;

  update incidents
     set status = 'cancelled',
         resolved_at = now(),
         resolution = coalesce(nullif(trim(p_reason), ''), 'Cancelled by the person who reported it')
   where id = p_incident;

  -- Same transaction as the status change, so no hospital can accept a case that no
  -- longer exists.
  update dispatch_offers set state = 'superseded'
   where incident_id = p_incident and state = 'pending';

  update fleet_assignments set state = 'no_response', responded_at = now()
   where incident_id = p_incident and state = 'awaiting_response';

  -- The vehicle goes back on the board before the dispatch row forgets which one it was.
  update fleet_units set available = true, assigned_incident_id = null, updated_at = now()
   where assigned_incident_id = p_incident
      or id = (select assigned_unit_id from incident_dispatch where incident_id = p_incident);

  update incident_dispatch
     set state = 'stood_down', ambulance_state = null, assigned_unit_id = null
   where incident_id = p_incident;

  insert into incident_events (incident_id, actor_uid, action, to_status, detail)
  values (p_incident, auth.uid(), 'cancelled_by_reporter', 'cancelled',
          jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true, 'at', now());
end;
$$;

revoke all on function public.cancel_my_incident(uuid, text) from public;
grant execute on function public.cancel_my_incident(uuid, text) to authenticated;
