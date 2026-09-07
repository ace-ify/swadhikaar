-- THE FRONT DOOR WAS MISSING. Every patient in this database arrived through one of
-- three doors -- an ASHA's tablet, an SOS, or a cron-dialled recovery call -- and all
-- three assume somebody already knows who the patient is. The one door a government
-- OPD actually uses, a stranger walking in with a bag of paper and two minutes of a
-- doctor's attention, had no representation at all.
--
-- What that costs: `symptoms` is the closest thing here to a history and it is twelve
-- fixed boolean-ish columns aimed at cardiac screening. It cannot hold a chief
-- complaint, cannot hold an HPI, cannot hold a review of systems, and cannot hold the
-- ten factors of Dashavidha Pariksha. Five rows in it after months, which is what a
-- table nobody can fit an answer into looks like.
--
-- So: six tables for one kiosk visit, and the shape follows the consultation rather
-- than the database. A visit is a `case_session`. What the patient says becomes
-- `history_answers`, one row per ontology item so a half-finished interview is still
-- readable. Ayurvedic assessment is `dashavidha_assessments` and NOT extra columns on
-- the session, because ten factors that each carry a value and a justification are ten
-- rows, and because a practitioner reviewing them wants them listed, not spread across
-- a wide row. Paper becomes `case_documents` plus `document_entities`, split because
-- one prescription yields many drugs and one lab report many analytes. The doctor reads
-- `case_summaries`.
--
-- TWO THINGS DELIBERATELY NOT DONE HERE:
--   * No new patient table. A kiosk walk-in is a `patients` row with
--     intake_source='kiosk'; abha_id, language, allergies, chronic_conditions and
--     current_medications already exist there and already feed the emergency profile.
--     A second identity table is how the same person ends up with two records.
--   * No RLS in this file. 017 does policies and grants, the same split 002/003 used,
--     because a policy referencing a column added later is a migration that half-applies.
--
-- WHO WRITES THESE: edge functions holding the service key, not the browser. A patient
-- at a kiosk is not authenticated -- there is nobody to log in as -- so the same shape
-- `incident-intake` already uses applies: the surface posts to a function, the function
-- validates and writes, and RLS exists for the doctor and admin read paths rather than
-- as the primary defence. 017 grants accordingly.
--
-- APPLIED as four MCP migrations, because there is no CLI on this machine to run a file
-- (see README.md): `case_taking_sessions_and_answers`,
-- `case_taking_dashavidha_and_documents`,
-- `case_taking_summaries_consent_and_reference`, `seed_drug_interactions`. The DDL below
-- is what was applied; the prose is only here.

-- ---------------------------------------------------------------- one kiosk visit
create table if not exists public.case_sessions (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid references public.patients(id) on delete cascade,
  language      text not null default 'hindi',
  -- 'allopathic' | 'ayush'. Drives which ontology the interview walks and whether
  -- Dashavidha is collected at all; an Ayush OPD and a district hospital OPD are not
  -- asking the same questions.
  mode          text not null default 'allopathic',
  -- identifying -> consented -> interviewing -> scanning -> summarising -> ready
  --            -> consulted, or abandoned from anywhere.
  status        text not null default 'identifying',
  voice_call_id uuid references public.voice_calls(id) on delete set null,
  livekit_room  text,
  -- Module A's red flag. Kept on the session and not only in `escalations` because the
  -- kiosk screen has to change colour before any escalation row is read back.
  red_flag        boolean not null default false,
  red_flag_reason text,
  escalation_id uuid references public.escalations(id) on delete set null,
  incident_id   uuid references public.incidents(id) on delete set null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  -- Module D: "temporary session data is wiped right after submission". This is the
  -- timestamp that proves it happened, so the claim is auditable rather than asserted.
  purged_at     timestamptz,
  created_by    uuid,
  constraint case_sessions_mode_check   check (mode in ('allopathic','ayush')),
  constraint case_sessions_status_check check (status in (
    'identifying','consented','interviewing','scanning','summarising','ready',
    'consulted','abandoned')),
  -- A red flag without a reason is an alarm nobody can triage.
  constraint case_sessions_red_flag_has_reason
    check (not red_flag or red_flag_reason is not null)
);

create index if not exists case_sessions_patient_idx on public.case_sessions(patient_id);
create index if not exists case_sessions_status_idx  on public.case_sessions(status);
-- The consultation screen's query: unreviewed sessions, worst first, newest first.
create index if not exists case_sessions_queue_idx
  on public.case_sessions(red_flag desc, started_at desc)
  where status in ('ready','summarising');

-- -------------------------------------------------------- what the patient told us
create table if not exists public.history_answers (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.case_sessions(id) on delete cascade,
  -- The eight sections of PS 3.3, in the order the summary prints them.
  section     text not null,
  -- Ontology item code, e.g. 'hpi.onset' or 'ros.cardiovascular'. The ontology lives
  -- in frontend/src/lib/clinical/ontology.ts; this column is deliberately free text
  -- rather than an enum so adding a question is a code change, not a migration.
  item_code   text not null,
  question    text,
  answer_text text,
  answer_value jsonb,
  -- 'voice' | 'touch'. PS 2.3 requires both input modes; recording which one answered
  -- is how we can later say whether the voice path is actually carrying the interview
  -- or whether everyone is tapping.
  source      text not null,
  asked_at    timestamptz not null default now(),
  constraint history_answers_source_check  check (source in ('voice','touch','imported')),
  constraint history_answers_section_check check (section in (
    'chief_complaint','hpi','past_medical','drug_allergy','family','personal',
    'ros','investigations')),
  -- One answer per item per visit. Re-answering overwrites via upsert; the previous
  -- value is not clinically interesting and keeping every revision would make the
  -- summary query pick a winner at read time instead of write time.
  constraint history_answers_one_per_item unique (session_id, item_code)
);

create index if not exists history_answers_session_section_idx
  on public.history_answers(session_id, section);

-- ------------------------------------------------------- Dashavidha Pariksha (AYUSH)
-- Ten factors, one row each, exactly as PS 3.3 Module A names them. Ten columns on the
-- session would have been shorter and wrong: each factor carries a value AND the
-- reasoning that produced it, a practitioner reviews them as a list, and
-- CLINICAL_REVIEW.md needs to sign them off one at a time.
--
-- NOTHING HERE IS CLINICALLY REVIEWED. The permitted values below are drawn from the
-- classical enumerations in the Ashtanga Hridaya and Charaka Samhita as restated in
-- current BAMS teaching, transcribed by an engineer. They are a vocabulary, not a
-- diagnosis, and the interpretation stays with the practitioner. Listed for sign-off
-- in docs/CLINICAL_REVIEW.md alongside the risk thresholds that are also unreviewed.
create table if not exists public.dashavidha_assessments (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.case_sessions(id) on delete cascade,
  factor     text not null,
  value      text,
  -- Why this value: the patient's own words, the tap they made, or the practitioner's
  -- note. A Prakriti of 'vata_pitta' with no justification is unreviewable.
  detail     jsonb,
  source     text not null default 'touch',
  recorded_at timestamptz not null default now(),
  constraint dashavidha_factor_check check (factor in (
    'prakriti','vikriti','sara','samhanana','pramana','satmya','sattva',
    'ahara_shakti','vyayama_shakti','vaya')),
  constraint dashavidha_source_check check (source in ('voice','touch','practitioner')),
  constraint dashavidha_one_per_factor unique (session_id, factor)
);

-- Ahara-Vihara (diet and daily regimen) is required by the PS in the same breath as
-- the ten factors but is not one of them, so it lands in history_answers under
-- 'personal' rather than being an eleventh row pretending to be a Pariksha factor.

-- --------------------------------------------------------------- the bag of paper
create table if not exists public.case_documents (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.case_sessions(id) on delete cascade,
  patient_id   uuid references public.patients(id) on delete cascade,
  storage_path text not null,
  doc_type     text,
  -- The date the DOCUMENT carries, not the date it was scanned -- this is what orders
  -- the timeline. Null when nothing legible was found, which is common on a faded
  -- handwritten prescription, and `date_source` says which case we are in so the
  -- timeline can show "order uncertain" instead of inventing a sequence.
  doc_date     date,
  date_source  text,
  ocr_text     text,
  ocr_model    text,
  page_count   int,
  status       text not null default 'uploaded',
  error        text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  constraint case_documents_type_check check (doc_type is null or doc_type in (
    'prescription','lab_report','discharge_summary','imaging','other')),
  constraint case_documents_status_check check (status in (
    'uploaded','processing','processed','failed')),
  constraint case_documents_date_source_check check (date_source is null or date_source in (
    'extracted','upload_order','patient_stated')),
  -- A processed document with no text is a silent OCR failure dressed as success.
  constraint case_documents_processed_has_text
    check (status <> 'processed' or ocr_text is not null)
);

create index if not exists case_documents_session_idx on public.case_documents(session_id);
-- The timeline query. Nulls last so undated pages sink rather than heading the list.
create index if not exists case_documents_timeline_idx
  on public.case_documents(session_id, doc_date desc nulls last);

-- --------------------------------------------------- what was inside the paper
-- Split from case_documents because the cardinality demands it: one prescription is
-- five drugs, one lab report is twenty analytes. PS 3.3 Module B asks for diagnoses,
-- medicines with dosages, test results with values AND reference ranges, and procedure
-- history -- four entity kinds with different useful columns, kept in one table because
-- four tables of three columns each is worse.
create table if not exists public.document_entities (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.case_documents(id) on delete cascade,
  entity_type  text not null,
  name         text not null,
  -- Free text on purpose. "500 mg twice daily" and "11.2" both belong here, and
  -- forcing a numeric column means dropping every dose that carries a unit.
  value        text,
  unit         text,
  -- Reference range as printed ON THE REPORT, not from a global table. Indian labs
  -- publish different ranges and the report's own range is the one the clinician
  -- reasoned against.
  ref_low      numeric,
  ref_high     numeric,
  -- Derived, and nullable for a reason: no range on the page means we cannot say
  -- whether a value is abnormal, and false would be a lie. PS asks us to highlight
  -- out-of-range labs; it does not ask us to guess at ranges.
  out_of_range boolean,
  coded_system text,
  coded_value  text,
  confidence   numeric,
  created_at   timestamptz not null default now(),
  constraint document_entities_type_check check (entity_type in (
    'diagnosis','medication','lab_result','procedure','allergy','vital')),
  constraint document_entities_coded_system_check check (coded_system is null or coded_system in (
    'snomed','loinc','rxnorm','icd10','ndhm')),
  constraint document_entities_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- out_of_range can only be asserted where a range was actually read off the page.
  constraint document_entities_range_before_verdict
    check (out_of_range is null or ref_low is not null or ref_high is not null)
);

create index if not exists document_entities_document_idx
  on public.document_entities(document_id);
create index if not exists document_entities_type_idx
  on public.document_entities(entity_type, name);
-- The "what needs the doctor's eye" query.
create index if not exists document_entities_flagged_idx
  on public.document_entities(document_id) where out_of_range;

-- ------------------------------------------------------- what the doctor reads
create table if not exists public.case_summaries (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.case_sessions(id) on delete cascade,
  -- Ordered array of {section, heading, body, items}. jsonb rather than eight columns
  -- because the Ayush ordering differs from the allopathic one and a null column per
  -- unused section reads as missing data rather than not applicable.
  sections   jsonb not null,
  -- PS 3.3 Module C requires two renderings of one summary: the clinician's in
  -- English/Hindi, and a spoken confirmation to the patient in their own language.
  -- Two columns, because they are not translations of each other -- the patient hears
  -- "we have written down that your chest pain started three days ago", the clinician
  -- reads a structured HPI.
  clinician_text text,
  patient_text   text,
  model      text,
  -- draft -> accepted | amended | rejected. The PS is explicit: "a draft to accept,
  -- amend, or reject, never an autonomous diagnosis", so 'draft' is the only status
  -- this table can be created with and a doctor's uid is required to leave it.
  status     text not null default 'draft',
  amended_sections jsonb,
  reviewed_by uuid references public.doctors(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  fhir_resource_id uuid references public.fhir_resources(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint case_summaries_one_per_session unique (session_id),
  constraint case_summaries_status_check check (status in (
    'draft','accepted','amended','rejected')),
  -- Nothing leaves draft without a named reviewer and a timestamp. This is the clause
  -- that stops "the AI signed off on it".
  constraint case_summaries_review_is_attributed check (
    status = 'draft' or (reviewed_by is not null and reviewed_at is not null)),
  -- An amendment with no amended text is a status change pretending to be an edit.
  constraint case_summaries_amended_has_content check (
    status <> 'amended' or amended_sections is not null)
);

-- ------------------------------------------------------------- consent, extended
-- `consents` already had the right bones -- purpose, scope, consent_mode, granted_at,
-- revoked_at, is_active -- so this widens it rather than adding a parallel table. What
-- was missing is everything that makes the consent an ABDM artefact instead of a
-- boolean, plus the two columns that make the PS's "audio explanation for low-literacy
-- users" a fact on the record rather than a screen that may or may not have played.
alter table public.consents
  add column if not exists session_id         uuid references public.case_sessions(id) on delete cascade,
  -- The signed artefact as ABDM returns it, stored whole. Parsing it into columns and
  -- discarding the original is how you end up unable to prove what was consented to.
  add column if not exists artefact           jsonb,
  add column if not exists artefact_id        text,
  -- ABDM consent has a validity window. A consent with no end is not an ABDM consent.
  add column if not exists expires_at         timestamptz,
  -- Proof of the audio explanation, and in WHICH language -- an explanation played in
  -- Hindi to an Assamese speaker is a compliance checkbox, not informed consent.
  add column if not exists audio_explained_at timestamptz,
  add column if not exists audio_language     text,
  add column if not exists revocation_reason  text;

create index if not exists consents_session_idx on public.consents(session_id);
create index if not exists consents_artefact_idx on public.consents(artefact_id)
  where artefact_id is not null;

-- ----------------------------------------------------- drug interactions, honestly
-- PS 3.3 Module B asks the document pipeline to highlight "possible drug interactions".
-- There is no free, licensable, complete Indian interaction database, and inventing
-- one would be the bed-count mistake again: a confident table of numbers nobody
-- sourced. So this is a SHORT, SOURCED, DELIBERATELY INCOMPLETE list of interactions
-- that matter in Indian primary care, every row carrying where it came from.
--
-- The UI must therefore say "checked against 24 known pairs", never "no interactions
-- found" -- absence of a row here is absence of knowledge, not absence of risk.
create table if not exists public.drug_interactions (
  id          uuid primary key default gen_random_uuid(),
  -- Lowercased generic names, alphabetically ordered by the constraint below so a pair
  -- can only be stored one way and a lookup never has to try both directions.
  drug_a      text not null,
  drug_b      text not null,
  severity    text not null,
  effect      text not null,
  advice      text,
  source      text not null,
  created_at  timestamptz not null default now(),
  constraint drug_interactions_severity_check check (severity in ('major','moderate','minor')),
  constraint drug_interactions_ordered check (drug_a < drug_b),
  constraint drug_interactions_unique_pair unique (drug_a, drug_b)
);

-- ------------------------------------------------------------------ scanned paper
-- Private, always. These are prescriptions and discharge summaries carrying a named
-- person's diagnoses; a public bucket id is a permanent unauthenticated link to
-- someone's medical history. 12 MB because a multi-page discharge summary photographed
-- on a phone is bigger than a scene photo, and PDF is here because that is what a
-- patient with a previous digital report actually arrives holding.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('case-documents', 'case-documents', false, 12582912,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

comment on table public.case_sessions is
  'One kiosk visit: identify, consent, interview, scan, summarise, consult. The OPD '
  'front door the other three intake paths did not cover. See docs/CASE_TAKING.md.';
comment on table public.dashavidha_assessments is
  'Dashavidha Pariksha, ten factors, one row each. The permitted values are a '
  'vocabulary transcribed by an engineer from classical enumerations and are NOT '
  'clinically reviewed -- see docs/CLINICAL_REVIEW.md.';
comment on table public.drug_interactions is
  'Short, sourced, incomplete. Absence of a row is absence of knowledge, not absence '
  'of risk, and the UI must say so.';



