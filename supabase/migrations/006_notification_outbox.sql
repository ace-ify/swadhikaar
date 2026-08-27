-- NOTIFICATION OUTBOX — as applied 2026-08-27.
--
-- EOS has six independent send sites (three FCM layers, hospital-staff push, four
-- Twilio senders, plus Firestore collections used as inboxes) and NOT ONE retries.
-- Every send is an await inside a trigger or request handler, so a function crash or
-- a Twilio 5xx loses the notification permanently. There is no per-notification
-- failure record anywhere in their system — only two aggregate counters and
-- console.error, and one of their senders discards its own return value so partial
-- failure is invisible even in the logs.
--
-- Two more of their defects are removed by the shape of this table rather than by
-- any code:
--
--   * Their "per-wave SMS fallback" is per-INCIDENT. `smsFallbackSent` is set once
--     and escalateAssignment never resets it, so waves 2-6 of a critical case get
--     push only. Their own docs claim "only fires once per wave". The unique index
--     here is keyed on the WAVE, so a new wave is a new notification by construction.
--   * Their standard tier can never send a fallback SMS at all: threshold 180s
--     against a 120s wave timeout, so the wave always escalates first.

do $$ begin
  create type notification_channel as enum ('in_app', 'sms', 'push', 'voice');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_status as enum (
    'queued', 'sending', 'sent', 'failed', 'skipped_unconfigured', 'abandoned');
exception when duplicate_object then null; end $$;

create table if not exists public.notification_outbox (
  id uuid primary key default uuid_generate_v4(),
  incident_id uuid references public.incidents(id) on delete cascade,
  kind text not null,
  channel notification_channel not null,

  -- Exactly one recipient shape per row, so a failure names who missed it.
  facility_id uuid references public.facilities(id) on delete cascade,
  unit_id uuid references public.fleet_units(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  to_phone text,

  wave_index integer,               -- the column EOS does not have

  payload jsonb not null default '{}'::jsonb,
  status notification_status not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),

  constraint notification_has_a_recipient check (
    facility_id is not null or unit_id is not null
    or user_id is not null or to_phone is not null)
);

create index if not exists idx_outbox_due
  on public.notification_outbox (next_attempt_at)
  where status in ('queued', 'sending');
create index if not exists idx_outbox_incident
  on public.notification_outbox (incident_id, created_at desc);

create unique index if not exists idx_outbox_dedupe
  on public.notification_outbox (
    coalesce(incident_id, '00000000-0000-0000-0000-000000000000'::uuid),
    channel, kind,
    coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(wave_index, -1));

alter table public.notification_outbox enable row level security;

drop policy if exists outbox_read_ops on public.notification_outbox;
create policy outbox_read_ops on public.notification_outbox for select to authenticated
  using (
    current_user_has_role(array['admin','dispatcher'])
    or facility_id = any (current_user_facility_ids()));
-- No client writes: rows are enqueued by trigger and drained by the worker.

-- ------------------------------------------------- functions (in the database)
-- trg_enqueue_hospital_offer  — on dispatch_offers insert: in_app now, SMS after
--                               30s critical / 60s high / 90s standard, because
--                               there is no point paying for a message the console
--                               has already answered.
-- trg_enqueue_fleet_offer     — on fleet_assignments insert, same shape.
-- deliver_due_notifications() — the drain, cron every minute:
--
--     select cron.schedule('notification-drain', '* * * * *',
--       $$select public.deliver_due_notifications(200)$$);
--
-- HONEST STATE OF THE CHANNELS.
--
--   in_app  REAL. The offer row is in the realtime publication and rendered by both
--           the dispatch console and the facility inbox, so marking it sent records
--           a delivery that actually happened.
--   sms     NO GATEWAY CONFIGURED. Rows are parked as skipped_unconfigured with
--           last_error naming the exact missing variables (TWILIO_ACCOUNT_SID,
--           TWILIO_AUTH_TOKEN, TWILIO_FROM). Not marked sent, not silently dropped.
--   push    NO CREDENTIALS. Same treatment. (EOS's web push is permanently disabled
--           too — their VAPID key is a hardcoded empty string with a TODO.)
--   voice   Not implemented. EOS has no outbound voice channel either; their
--           "call 112" is a tel: link on the victim's own device.
--
-- When credentials exist, a worker claims these same rows — the enqueue side, the
-- retry columns, the wave keying and the dedupe index do not change.