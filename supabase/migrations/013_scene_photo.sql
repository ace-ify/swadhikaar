-- 013: the hospital should see what it is being asked to accept.
--
-- demoflow's first branch is a bystander photographing the scene. Until now the entire
-- intake path was text: incident_type from a button, description from a template. A
-- facility deciding whether to take a polytrauma had the word "accident" and nothing
-- else, and the person who could see the scene had no way to show it.
--
-- Deliberately NOT here: vision triage. A photo that changes severity needs a model in
-- the dispatch path and a clinician signing off on what it is allowed to conclude. This
-- carries the photo to the humans who are already making the decision. It does not
-- make the decision, and nothing in the scoring engine reads it.

-- One photo, not a gallery. A second angle is a different feature; this is what the
-- flow asks for and what somebody standing on a roadside has time to take.
alter table public.incidents
  add column if not exists scene_photo_path text;

comment on column public.incidents.scene_photo_path is
  'Object path in the incident-scene bucket. Null until the reporter uploads, and the '
  'upload happens AFTER dispatch is already open so a slow camera never delays an '
  'ambulance. Set once, via attach_scene_photo().';

-- Private. Never public: this is a photograph of an injured person at a known location,
-- and a public bucket URL is a permanent unauthenticated link to it. 8 MB covers a phone
-- photo; HEIC is here because that is what an iPhone actually produces.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-scene', 'incident-scene', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Every policy below keys on the first path segment being the incident id. split_part
-- rather than storage.foldername so this has no dependency on the storage schema, and
-- a malformed or crafted object name returns null instead of raising -- a policy that
-- can be made to error is a policy that can be used to deny service.
create or replace function public.scene_photo_incident(p_name text)
returns uuid
language sql immutable set search_path to 'public'
as $function$
  select case
    when split_part(p_name, '/', 1) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$function$;

revoke all on function public.scene_photo_incident(text) from public, anon;
grant execute on function public.scene_photo_incident(text) to authenticated;

-- ------------------------------------------------------------- storage policies
-- Only the person who filed the report can upload to it, and only while it is still
-- open. A closed case cannot grow new evidence.
drop policy if exists scene_photo_insert on storage.objects;
create policy scene_photo_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'incident-scene'
  and exists (
    select 1 from public.incidents i
     where i.id = public.scene_photo_incident(name)
       and i.created_by = auth.uid()
       and i.status not in ('resolved', 'expired', 'cancelled')));

-- Read mirrors the incidents read policy exactly, on purpose: anybody who can already
-- see the case can see the photo, and nobody else gains sight of it. Widening one
-- without the other is how a medical snapshot leaks.
--
-- The ambulance crew is NOT covered here and that was an omission, not a decision: a
-- crew's identity is fleet_units.operator_uid, a different join from
-- incident_responders. 015_crew_sees_the_scene.sql owns that clause -- deliberately not
-- duplicated here, because two migrations defining one policy means the higher number
-- silently wins and the lower one reads as current when it is not.
drop policy if exists scene_photo_read on storage.objects;
create policy scene_photo_read on storage.objects for select to authenticated
using (
  bucket_id = 'incident-scene'
  and exists (
    select 1 from public.incidents i
     where i.id = public.scene_photo_incident(name)
       and (
         i.created_by = auth.uid()
         or public.current_user_has_role(array['admin', 'dispatcher', 'doctor'])
         or exists (select 1 from public.dispatch_offers o
                     where o.incident_id = i.id
                       and o.facility_id = any (public.current_user_facility_ids()))
         or exists (select 1 from public.incident_responders r
                     where r.incident_id = i.id and r.responder_uid = auth.uid()))));

-- No update and no delete policy, deliberately, matching incident_events: evidence a
-- reporter can swap out after a facility has looked at it is not evidence. The client
-- writes a fixed object name per incident (`{incident_id}/scene`), so "one photo, set
-- once" is structural rather than a convention -- a second upload has no UPDATE policy
-- to land on and is refused by storage itself.

-- --------------------------------------------------------------------- attach
-- The reporter cannot UPDATE incidents: incidents_write_ops restricts writes to admin
-- and dispatcher. So the column is set through here, which re-checks ownership rather
-- than trusting the caller, and leaves an audit row either way.
create or replace function public.attach_scene_photo(p_incident uuid, p_path text)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_owner  uuid;
  v_status incident_status;
begin
  select created_by, status into v_owner, v_status
    from incidents where id = p_incident;

  if not found then
    raise exception 'incident not found';
  end if;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'not your report';
  end if;
  -- A path pointing at a different incident would attach this reporter's photo to
  -- somebody else's case.
  if scene_photo_incident(p_path) is distinct from p_incident then
    raise exception 'path does not belong to this incident';
  end if;

  update incidents set scene_photo_path = p_path
   where id = p_incident and scene_photo_path is null;

  insert into incident_events (incident_id, action, actor_uid, actor_role, detail)
  values (p_incident, 'scene_photo_attached', auth.uid(), 'reporter',
          jsonb_build_object('path', p_path, 'status_at_upload', v_status));
end
$function$;

revoke all on function public.attach_scene_photo(uuid, text) from public, anon;
grant execute on function public.attach_scene_photo(uuid, text) to authenticated;
