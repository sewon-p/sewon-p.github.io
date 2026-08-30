-- Japanese article study and spaced-repetition backend.
-- All user-owned rows are protected by RLS. Reviews must be recorded through
-- record_review() so the immutable event and the current card state change in
-- one transaction.

create type public.annotation_kind as enum (
  'reading_unknown',
  'context_guess',
  'unknown',
  'misread'
);

create type public.card_kind as enum (
  'word',
  'kanji'
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  import_key text check (import_key is null or btrim(import_key) <> ''),
  title text not null check (btrim(title) <> ''),
  publisher text,
  source_url text,
  published_at date,
  body_text text not null default '',
  body_revision integer not null default 1 check (body_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_user_id_id_key unique (user_id, id),
  constraint articles_user_import_key_key unique (user_id, import_key)
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  article_id uuid not null,
  import_key text check (import_key is null or btrim(import_key) <> ''),
  day_no integer not null check (day_no >= 0),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'archived')),
  grading_status text not null default 'draft'
    check (grading_status in ('draft', 'submitted', 'graded', 'cards_confirmed', 'failed')),
  grading_packet_version integer not null default 1 check (grading_packet_version > 0),
  grading_grader_version text not null default '',
  grading_failure_message text,
  grading_submission_id uuid,
  grading_snapshot jsonb
    check (grading_snapshot is null or jsonb_typeof(grading_snapshot) = 'object'),
  grading_result jsonb
    check (grading_result is null or jsonb_typeof(grading_result) = 'object'),
  grading_submitted_at timestamptz,
  grading_completed_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  elapsed_seconds integer check (elapsed_seconds is null or elapsed_seconds >= 0),
  summary_ko text,
  comprehension_pct smallint
    check (comprehension_pct is null or comprehension_pct between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_sessions_completed_after_started_check
    check (completed_at is null or completed_at >= started_at),
  constraint study_sessions_grading_time_order_check
    check (
      grading_completed_at is null
      or grading_submitted_at is null
      or grading_completed_at >= grading_submitted_at
    ),
  constraint study_sessions_article_fk
    foreign key (user_id, article_id)
    references public.articles (user_id, id)
    on delete cascade,
  constraint study_sessions_user_id_id_key unique (user_id, id),
  constraint study_sessions_user_article_key unique (user_id, article_id),
  constraint study_sessions_user_day_key unique (user_id, day_no),
  constraint study_sessions_user_import_key_key unique (user_id, import_key),
  constraint study_sessions_user_id_id_article_id_key
    unique (user_id, id, article_id)
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  import_key text check (import_key is null or btrim(import_key) <> ''),
  ordinal smallint not null check (ordinal > 0),
  perspective text not null default '',
  prompt text not null check (btrim(prompt) <> ''),
  answer text not null default '',
  reference_answer text,
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint responses_session_fk
    foreign key (user_id, session_id)
    references public.study_sessions (user_id, id)
    on delete cascade,
  constraint responses_session_ordinal_key unique (session_id, ordinal),
  constraint responses_user_import_key_key unique (user_id, import_key)
);

create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  article_id uuid not null,
  session_id uuid not null,
  import_key text check (import_key is null or btrim(import_key) <> ''),
  kind public.annotation_kind not null,
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null,
  quote text not null check (char_length(quote) > 0),
  body_revision integer not null check (body_revision > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotations_offset_order_check check (end_offset > start_offset),
  constraint annotations_session_article_fk
    foreign key (user_id, session_id, article_id)
    references public.study_sessions (user_id, id, article_id)
    on delete cascade,
  constraint annotations_user_id_id_article_id_key
    unique (user_id, id, article_id),
  constraint annotations_user_import_key_key unique (user_id, import_key)
);

create table public.study_grading_reports (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  submission_id uuid not null,
  comprehension_pct smallint not null check (comprehension_pct between 0 and 100),
  strengths text not null default '',
  weaknesses text not null default '',
  misread_patterns text not null default '',
  next_direction text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_grading_reports_session_fk
    foreign key (user_id, session_id)
    references public.study_sessions (user_id, id)
    on delete cascade
);

create table public.response_grading_feedback (
  response_id uuid primary key references public.responses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  submission_id uuid not null,
  judgement text not null default 'ungraded'
    check (judgement in ('correct', 'partial', 'incorrect', 'ungraded')),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  correct_points text not null default '',
  missing_evidence text not null default '',
  error_type text not null default '',
  corrected_answer text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint response_grading_feedback_session_fk
    foreign key (user_id, session_id)
    references public.study_sessions (user_id, id)
    on delete cascade
);

create table public.annotation_grading_feedback (
  annotation_id uuid primary key references public.annotations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  submission_id uuid,
  user_reading text not null default '',
  user_meaning text not null default '',
  correct_reading text not null default '',
  correct_meaning text not null default '',
  judgement text not null default 'ungraded'
    check (judgement in ('correct', 'partial', 'incorrect', 'ungraded')),
  simple_mistake boolean not null default false,
  review_unit text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotation_grading_feedback_session_fk
    foreign key (user_id, session_id)
    references public.study_sessions (user_id, id)
    on delete cascade
);

create table public.grading_card_proposals (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  submission_id uuid not null,
  source_type text not null check (source_type in ('annotation', 'response', 'article')),
  source_id uuid,
  source_article_id uuid not null,
  review_unit text not null default '',
  kind public.card_kind not null,
  front text not null check (btrim(front) <> ''),
  reading text not null default '',
  meaning_ko text not null default '',
  example_ja text not null default '',
  decision text not null default 'proposed'
    check (decision in ('proposed', 'accepted', 'rejected')),
  created_card_id uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint grading_card_proposals_session_fk
    foreign key (user_id, session_id)
    references public.study_sessions (user_id, id)
    on delete cascade,
  constraint grading_card_proposals_article_fk
    foreign key (user_id, source_article_id)
    references public.articles (user_id, id)
    on delete cascade,
  constraint grading_card_proposals_single_kanji_check
    check (kind <> 'kanji' or char_length(front) = 1),
  constraint grading_card_proposals_decision_card_check
    check (decision <> 'accepted' or created_card_id is not null)
);

create table public.study_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.card_kind not null,
  canonical_key text not null check (btrim(canonical_key) <> ''),
  front text not null check (btrim(front) <> ''),
  reading text,
  meaning_ko text,
  example_ja text,
  note text,
  initial_kind public.annotation_kind,
  suspended boolean not null default false,

  due_at timestamptz not null default now(),
  fsrs_state smallint not null default 0 check (fsrs_state between 0 and 3),
  stability double precision not null default 0
    check (stability >= 0 and stability < 'Infinity'::double precision),
  difficulty double precision not null default 0
    check (difficulty between 0 and 10),
  elapsed_days integer not null default 0 check (elapsed_days >= 0),
  scheduled_days integer not null default 0 check (scheduled_days >= 0),
  learning_steps integer not null default 0 check (learning_steps >= 0),
  reps integer not null default 0 check (reps >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  last_review_at timestamptz,
  revision bigint not null default 0 check (revision >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint study_cards_user_id_id_key unique (user_id, id),
  constraint study_cards_user_kind_canonical_key_key
    unique (user_id, kind, canonical_key),
  constraint study_cards_single_kanji_check
    check (kind <> 'kanji' or char_length(front) = 1)
);

alter table public.grading_card_proposals
  add constraint grading_card_proposals_created_card_fk
  foreign key (user_id, created_card_id)
  references public.study_cards (user_id, id);

create table public.study_card_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null,
  article_id uuid not null,
  annotation_id uuid,
  context_text text,
  created_at timestamptz not null default now(),
  constraint study_card_sources_card_fk
    foreign key (user_id, card_id)
    references public.study_cards (user_id, id)
    on delete cascade,
  constraint study_card_sources_article_fk
    foreign key (user_id, article_id)
    references public.articles (user_id, id)
    on delete cascade,
  constraint study_card_sources_annotation_article_fk
    foreign key (user_id, annotation_id, article_id)
    references public.annotations (user_id, id, article_id)
    on delete cascade,
  constraint study_card_sources_user_card_article_key
    unique (user_id, card_id, article_id)
);

create table public.study_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  desired_retention numeric(4, 3) not null default 0.900
    check (desired_retention between 0.700 and 0.990),
  fsrs_weights jsonb
    check (fsrs_weights is null or jsonb_typeof(fsrs_weights) = 'array'),
  scheduler_version text not null default 'ts-fsrs/5.4.1'
    check (btrim(scheduler_version) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.study_review_events (
  event_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null,
  base_revision bigint not null check (base_revision >= 0),
  resulting_revision bigint not null check (resulting_revision = base_revision + 1),
  rating smallint not null check (rating between 1 and 4),
  reviewed_at timestamptz not null,
  synced_at timestamptz not null default now(),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  scheduler_version text not null check (btrim(scheduler_version) <> ''),
  constraint study_review_events_card_fk
    foreign key (user_id, card_id)
    references public.study_cards (user_id, id)
    on delete cascade,
  constraint study_review_events_card_revision_key
    unique (card_id, resulting_revision)
);

create index articles_user_created_idx
  on public.articles (user_id, created_at desc);

create index study_sessions_user_day_idx
  on public.study_sessions (user_id, day_no desc);

create index study_sessions_user_article_idx
  on public.study_sessions (user_id, article_id, started_at desc);

create index responses_user_session_idx
  on public.responses (user_id, session_id, ordinal);

create index annotations_user_article_offset_idx
  on public.annotations (user_id, article_id, start_offset);

create index response_grading_feedback_user_session_idx
  on public.response_grading_feedback (user_id, session_id);

create index annotation_grading_feedback_user_session_idx
  on public.annotation_grading_feedback (user_id, session_id);

create index grading_card_proposals_user_session_idx
  on public.grading_card_proposals (user_id, session_id, decision);

create index study_cards_due_idx
  on public.study_cards (user_id, due_at)
  where suspended = false;

create index study_cards_user_kind_idx
  on public.study_cards (user_id, kind, created_at desc);

create index study_card_sources_user_card_idx
  on public.study_card_sources (user_id, card_id);

create index study_card_sources_user_article_idx
  on public.study_card_sources (user_id, article_id);

create unique index study_card_sources_annotation_key
  on public.study_card_sources (user_id, card_id, annotation_id)
  where annotation_id is not null;

create index study_review_events_user_card_reviewed_idx
  on public.study_review_events (user_id, card_id, reviewed_at desc);

create or replace function public.set_japanese_study_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger articles_set_updated_at
before update on public.articles
for each row execute function public.set_japanese_study_updated_at();

create trigger study_sessions_set_updated_at
before update on public.study_sessions
for each row execute function public.set_japanese_study_updated_at();

create trigger responses_set_updated_at
before update on public.responses
for each row execute function public.set_japanese_study_updated_at();

create trigger annotations_set_updated_at
before update on public.annotations
for each row execute function public.set_japanese_study_updated_at();

create trigger study_grading_reports_set_updated_at
before update on public.study_grading_reports
for each row execute function public.set_japanese_study_updated_at();

create trigger response_grading_feedback_set_updated_at
before update on public.response_grading_feedback
for each row execute function public.set_japanese_study_updated_at();

create trigger annotation_grading_feedback_set_updated_at
before update on public.annotation_grading_feedback
for each row execute function public.set_japanese_study_updated_at();

create trigger grading_card_proposals_set_updated_at
before update on public.grading_card_proposals
for each row execute function public.set_japanese_study_updated_at();

create trigger study_cards_set_updated_at
before update on public.study_cards
for each row execute function public.set_japanese_study_updated_at();

create trigger study_settings_set_updated_at
before update on public.study_settings
for each row execute function public.set_japanese_study_updated_at();

alter table public.articles enable row level security;
alter table public.study_sessions enable row level security;
alter table public.responses enable row level security;
alter table public.annotations enable row level security;
alter table public.study_grading_reports enable row level security;
alter table public.response_grading_feedback enable row level security;
alter table public.annotation_grading_feedback enable row level security;
alter table public.grading_card_proposals enable row level security;
alter table public.study_cards enable row level security;
alter table public.study_card_sources enable row level security;
alter table public.study_settings enable row level security;
alter table public.study_review_events enable row level security;

create policy articles_own_rows
on public.articles for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy study_sessions_own_rows
on public.study_sessions for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy responses_own_rows
on public.responses for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy annotations_own_rows
on public.annotations for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy study_grading_reports_read_own_rows
on public.study_grading_reports for select to authenticated
using ((select auth.uid()) = user_id);

create policy response_grading_feedback_read_own_rows
on public.response_grading_feedback for select to authenticated
using ((select auth.uid()) = user_id);

create policy annotation_grading_feedback_read_own_rows
on public.annotation_grading_feedback for select to authenticated
using ((select auth.uid()) = user_id);

create policy grading_card_proposals_read_own_rows
on public.grading_card_proposals for select to authenticated
using ((select auth.uid()) = user_id);

create policy study_cards_own_rows
on public.study_cards for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy study_card_sources_own_rows
on public.study_card_sources for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy study_settings_own_row
on public.study_settings for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy study_review_events_read_own_rows
on public.study_review_events for select to authenticated
using ((select auth.uid()) = user_id);

-- The client calculates the selected FSRS result with ts-fsrs. This function
-- validates and applies that result while holding a row lock. p_event_id makes
-- retries safe; p_expected_revision detects simultaneous reviews elsewhere.
create or replace function public.record_review(
  p_event_id uuid,
  p_card_id uuid,
  p_expected_revision bigint,
  p_rating smallint,
  p_reviewed_at timestamptz,
  p_duration_ms integer,
  p_after_state jsonb,
  p_scheduler_version text
)
returns public.study_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_card public.study_cards%rowtype;
  v_existing public.study_review_events%rowtype;
  v_due_at timestamptz;
  v_fsrs_state smallint;
  v_stability double precision;
  v_difficulty double precision;
  v_elapsed_days integer;
  v_scheduled_days integer;
  v_learning_steps integer;
  v_reps integer;
  v_lapses integer;
  v_before_state jsonb;
  v_normalized_after_state jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_event_id is null or p_card_id is null then
    raise exception 'event_id and card_id are required.' using errcode = '22023';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'expected_revision must be non-negative.' using errcode = '22023';
  end if;

  if p_rating is null or p_rating not between 1 and 4 then
    raise exception 'rating must be between 1 and 4.' using errcode = '22023';
  end if;

  if p_reviewed_at is null then
    raise exception 'reviewed_at is required.' using errcode = '22023';
  end if;

  if p_duration_ms is not null and p_duration_ms < 0 then
    raise exception 'duration_ms must be non-negative.' using errcode = '22023';
  end if;

  if p_scheduler_version is null or btrim(p_scheduler_version) = '' then
    raise exception 'scheduler_version is required.' using errcode = '22023';
  end if;

  if p_after_state is null
     or jsonb_typeof(p_after_state) <> 'object'
     or not (
       p_after_state ?& array[
         'due_at',
         'fsrs_state',
         'stability',
         'difficulty',
         'elapsed_days',
         'scheduled_days',
         'learning_steps',
         'reps',
         'lapses'
       ]
     ) then
    raise exception 'after_state is missing required FSRS fields.' using errcode = '22023';
  end if;

  begin
    v_due_at := (p_after_state ->> 'due_at')::timestamptz;
    v_fsrs_state := (p_after_state ->> 'fsrs_state')::smallint;
    v_stability := (p_after_state ->> 'stability')::double precision;
    v_difficulty := (p_after_state ->> 'difficulty')::double precision;
    v_elapsed_days := (p_after_state ->> 'elapsed_days')::integer;
    v_scheduled_days := (p_after_state ->> 'scheduled_days')::integer;
    v_learning_steps := (p_after_state ->> 'learning_steps')::integer;
    v_reps := (p_after_state ->> 'reps')::integer;
    v_lapses := (p_after_state ->> 'lapses')::integer;
  exception
    when invalid_text_representation
      or numeric_value_out_of_range
      or datetime_field_overflow then
      raise exception 'after_state contains an invalid FSRS value.' using errcode = '22023';
  end;

  if v_due_at is null or v_due_at < p_reviewed_at then
    raise exception 'after_state.due_at must not precede reviewed_at.' using errcode = '22023';
  end if;

  if v_fsrs_state is null or v_fsrs_state not between 0 and 3
     or v_stability is null or v_stability < 0
       or v_stability >= 'Infinity'::double precision
     or v_difficulty is null or v_difficulty < 0 or v_difficulty > 10
     or v_elapsed_days is null or v_elapsed_days < 0
     or v_scheduled_days is null or v_scheduled_days < 0
     or v_learning_steps is null or v_learning_steps < 0
     or v_reps is null or v_reps < 0
     or v_lapses is null or v_lapses < 0 then
    raise exception 'after_state contains an out-of-range FSRS value.' using errcode = '22023';
  end if;

  v_normalized_after_state := jsonb_build_object(
    'due_at', v_due_at,
    'fsrs_state', v_fsrs_state,
    'stability', v_stability,
    'difficulty', v_difficulty,
    'elapsed_days', v_elapsed_days,
    'scheduled_days', v_scheduled_days,
    'learning_steps', v_learning_steps,
    'reps', v_reps,
    'lapses', v_lapses,
    'last_review_at', p_reviewed_at,
    'revision', p_expected_revision + 1
  );

  -- Fast idempotency path for a completed retry.
  select event.*
  into v_existing
  from public.study_review_events as event
  where event.event_id = p_event_id;

  if found then
    if v_existing.user_id <> v_user_id
       or v_existing.card_id <> p_card_id
       or v_existing.base_revision <> p_expected_revision
       or v_existing.rating <> p_rating
       or v_existing.reviewed_at <> p_reviewed_at
       or v_existing.duration_ms is distinct from p_duration_ms
       or v_existing.scheduler_version <> p_scheduler_version
       or v_existing.after_state <> v_normalized_after_state then
      raise exception 'event_id is already in use.' using errcode = '23505';
    end if;

    select card.*
    into strict v_card
    from public.study_cards as card
    where card.id = p_card_id and card.user_id = v_user_id;

    return v_card;
  end if;

  select card.*
  into v_card
  from public.study_cards as card
  where card.id = p_card_id and card.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Card was not found.' using errcode = '42501';
  end if;

  -- Check again after taking the card lock so concurrent retries are idempotent.
  select event.*
  into v_existing
  from public.study_review_events as event
  where event.event_id = p_event_id;

  if found then
    if v_existing.user_id <> v_user_id
       or v_existing.card_id <> p_card_id
       or v_existing.base_revision <> p_expected_revision
       or v_existing.rating <> p_rating
       or v_existing.reviewed_at <> p_reviewed_at
       or v_existing.duration_ms is distinct from p_duration_ms
       or v_existing.scheduler_version <> p_scheduler_version
       or v_existing.after_state <> v_normalized_after_state then
      raise exception 'event_id is already in use.' using errcode = '23505';
    end if;
    return v_card;
  end if;

  if v_card.revision <> p_expected_revision then
    raise exception 'Review conflict: card revision changed.'
      using errcode = '40001',
            detail = format(
              'Expected revision %s, current revision %s.',
              p_expected_revision,
              v_card.revision
            );
  end if;

  if v_reps <> v_card.reps + 1 then
    raise exception 'after_state.reps must increment by one.' using errcode = '22023';
  end if;

  if v_lapses < v_card.lapses or v_lapses > v_card.lapses + 1 then
    raise exception 'after_state.lapses may increase by at most one.' using errcode = '22023';
  end if;

  v_before_state := jsonb_build_object(
    'due_at', v_card.due_at,
    'fsrs_state', v_card.fsrs_state,
    'stability', v_card.stability,
    'difficulty', v_card.difficulty,
    'elapsed_days', v_card.elapsed_days,
    'scheduled_days', v_card.scheduled_days,
    'learning_steps', v_card.learning_steps,
    'reps', v_card.reps,
    'lapses', v_card.lapses,
    'last_review_at', v_card.last_review_at,
    'revision', v_card.revision
  );

  v_normalized_after_state := jsonb_build_object(
    'due_at', v_due_at,
    'fsrs_state', v_fsrs_state,
    'stability', v_stability,
    'difficulty', v_difficulty,
    'elapsed_days', v_elapsed_days,
    'scheduled_days', v_scheduled_days,
    'learning_steps', v_learning_steps,
    'reps', v_reps,
    'lapses', v_lapses,
    'last_review_at', p_reviewed_at,
    'revision', v_card.revision + 1
  );

  insert into public.study_review_events (
    event_id,
    user_id,
    card_id,
    base_revision,
    resulting_revision,
    rating,
    reviewed_at,
    duration_ms,
    before_state,
    after_state,
    scheduler_version
  ) values (
    p_event_id,
    v_user_id,
    p_card_id,
    v_card.revision,
    v_card.revision + 1,
    p_rating,
    p_reviewed_at,
    p_duration_ms,
    v_before_state,
    v_normalized_after_state,
    p_scheduler_version
  );

  update public.study_cards
  set due_at = v_due_at,
      fsrs_state = v_fsrs_state,
      stability = v_stability,
      difficulty = v_difficulty,
      elapsed_days = v_elapsed_days,
      scheduled_days = v_scheduled_days,
      learning_steps = v_learning_steps,
      reps = v_reps,
      lapses = v_lapses,
      last_review_at = p_reviewed_at,
      revision = revision + 1
  where id = p_card_id and user_id = v_user_id
  returning * into v_card;

  return v_card;
end;
$$;

-- Replace an article body and its annotation set as one transaction. Existing
-- annotation IDs are updated in place so card-source links survive ordinary
-- edits; annotations omitted by the client are removed.
create or replace function public.save_study_article(
  p_user_id uuid,
  p_article_id uuid,
  p_body_text text,
  p_body_revision integer,
  p_annotations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_article public.articles%rowtype;
  v_session_id uuid;
  v_grading_status text;
  v_annotation jsonb;
  v_annotation_id uuid;
  v_annotation_kind public.annotation_kind;
  v_start_offset integer;
  v_end_offset integer;
  v_quote text;
  v_note text;
  v_annotation_ids uuid[] := array[]::uuid[];
begin
  if v_user_id is null or p_user_id is distinct from v_user_id then
    raise exception 'Authentication does not match the requested owner.'
      using errcode = '42501';
  end if;

  if p_article_id is null or p_body_text is null then
    raise exception 'article_id and body_text are required.' using errcode = '22023';
  end if;

  if p_body_revision is null or p_body_revision <= 0 then
    raise exception 'body_revision must be positive.' using errcode = '22023';
  end if;

  if p_annotations is null or jsonb_typeof(p_annotations) <> 'array' then
    raise exception 'annotations must be a JSON array.' using errcode = '22023';
  end if;

  select session.id, session.grading_status
  into v_session_id, v_grading_status
  from public.study_sessions as session
  where session.user_id = v_user_id and session.article_id = p_article_id
  order by session.started_at desc, session.id desc
  limit 1
  for update;

  if v_session_id is null then
    raise exception 'Article study session was not found.' using errcode = '23503';
  end if;
  if v_grading_status not in ('draft', 'failed') then
    raise exception 'Submitted study content is locked.' using errcode = '55000';
  end if;

  select article.*
  into v_article
  from public.articles as article
  where article.id = p_article_id and article.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Article was not found.' using errcode = '42501';
  end if;

  if p_body_revision < v_article.body_revision then
    raise exception 'Article conflict: body revision is stale.'
      using errcode = '40001';
  end if;

  if p_body_revision > v_article.body_revision + 1 then
    raise exception 'body_revision may advance by at most one.' using errcode = '22023';
  end if;

  if p_body_text is distinct from v_article.body_text
     and p_body_revision <> v_article.body_revision + 1 then
    raise exception 'Changing body_text requires the next body_revision.'
      using errcode = '40001';
  end if;

  for v_annotation in
    select item.value
    from jsonb_array_elements(p_annotations) as item(value)
  loop
    if jsonb_typeof(v_annotation) <> 'object' then
      raise exception 'Each annotation must be a JSON object.' using errcode = '22023';
    end if;

    begin
      v_annotation_id := (v_annotation ->> 'id')::uuid;
      v_annotation_kind := (v_annotation ->> 'kind')::public.annotation_kind;
      v_start_offset := (v_annotation ->> 'start_offset')::integer;
      v_end_offset := (v_annotation ->> 'end_offset')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Annotation contains an invalid ID, kind, or offset.'
          using errcode = '22023';
    end;

    v_quote := v_annotation ->> 'quote';
    v_note := nullif(v_annotation ->> 'note', '');

    if v_annotation_id is null
       or v_start_offset is null
       or v_end_offset is null
       or v_start_offset < 0
       or v_end_offset <= v_start_offset
       or v_end_offset > char_length(p_body_text)
       or v_quote is null
       or char_length(v_quote) = 0 then
      raise exception 'Annotation range or quote is invalid.' using errcode = '22023';
    end if;

    if substring(
         p_body_text
         from v_start_offset + 1
         for v_end_offset - v_start_offset
       ) <> v_quote then
      raise exception 'Annotation quote does not match the article body.'
        using errcode = '22023';
    end if;

    if v_annotation_id = any(v_annotation_ids) then
      raise exception 'Annotation IDs must be unique.' using errcode = '23505';
    end if;

    if exists (
      select 1
      from public.annotations as existing_annotation
      where existing_annotation.id = v_annotation_id
        and (
          existing_annotation.user_id <> v_user_id
          or existing_annotation.article_id <> p_article_id
        )
    ) then
      raise exception 'Annotation ID is already in use.' using errcode = '23505';
    end if;

    v_annotation_ids := array_append(v_annotation_ids, v_annotation_id);

    insert into public.annotations (
      id,
      user_id,
      article_id,
      session_id,
      kind,
      start_offset,
      end_offset,
      quote,
      body_revision,
      note
    ) values (
      v_annotation_id,
      v_user_id,
      p_article_id,
      v_session_id,
      v_annotation_kind,
      v_start_offset,
      v_end_offset,
      v_quote,
      p_body_revision,
      v_note
    )
    on conflict (id) do update
    set session_id = excluded.session_id,
        kind = excluded.kind,
        start_offset = excluded.start_offset,
        end_offset = excluded.end_offset,
        quote = excluded.quote,
        body_revision = excluded.body_revision,
        note = excluded.note;
  end loop;

  update public.articles
  set body_text = p_body_text,
      body_revision = p_body_revision
  where id = p_article_id and user_id = v_user_id;

  delete from public.annotations
  where user_id = v_user_id
    and article_id = p_article_id
    and not (id = any(v_annotation_ids));

  return jsonb_build_object(
    'article_id', p_article_id,
    'body_revision', p_body_revision,
    'annotation_count', cardinality(v_annotation_ids)
  );
end;
$$;

create or replace function public.save_study_response(
  p_response_id uuid,
  p_answer text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select session.id
  into v_session_id
  from public.responses as response
  join public.study_sessions as session
    on session.id = response.session_id and session.user_id = response.user_id
  where response.id = p_response_id
    and response.user_id = v_user_id
    and session.grading_status in ('draft', 'failed')
  for update of session;

  if v_session_id is null then
    raise exception 'Editable study response was not found.' using errcode = '55000';
  end if;

  update public.responses
  set answer = coalesce(p_answer, '')
  where id = p_response_id
    and user_id = v_user_id
    and session_id = v_session_id;
end;
$$;

create or replace function public.save_annotation_study_input(
  p_user_id uuid,
  p_annotation_id uuid,
  p_user_reading text,
  p_user_meaning text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user_id is null or p_user_id is distinct from v_user_id then
    raise exception 'Authentication does not match the requested owner.' using errcode = '42501';
  end if;

  select session.id
  into v_session_id
  from public.annotations as annotation
  join public.study_sessions as session
    on session.id = annotation.session_id and session.user_id = annotation.user_id
  where annotation.id = p_annotation_id
    and annotation.user_id = v_user_id
    and session.grading_status in ('draft', 'failed')
  for update of session;

  if v_session_id is null then
    raise exception 'Editable annotation was not found.' using errcode = '42501';
  end if;

  insert into public.annotation_grading_feedback (
    annotation_id, user_id, session_id, user_reading, user_meaning
  ) values (
    p_annotation_id,
    v_user_id,
    v_session_id,
    coalesce(p_user_reading, ''),
    coalesce(p_user_meaning, '')
  )
  on conflict (annotation_id) do update
  set user_reading = excluded.user_reading,
      user_meaning = excluded.user_meaning;

  return jsonb_build_object('annotation_id', p_annotation_id);
end;
$$;

create or replace function public.request_study_grading(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.study_sessions%rowtype;
  v_submission_id uuid;
  v_snapshot jsonb;
begin
  if v_user_id is null or p_user_id is distinct from v_user_id then
    raise exception 'Authentication does not match the requested owner.' using errcode = '42501';
  end if;

  select session.*
  into v_session
  from public.study_sessions as session
  where session.id = p_session_id and session.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Study session was not found.' using errcode = '42501';
  end if;

  if v_session.grading_status = 'submitted' and v_session.grading_snapshot is not null then
    return v_session.grading_snapshot;
  end if;
  if v_session.grading_status not in ('draft', 'failed') then
    raise exception 'Only a draft or failed session can be submitted for grading.' using errcode = '55000';
  end if;

  if v_session.grading_status = 'failed' then
    delete from public.grading_card_proposals where user_id = v_user_id and session_id = v_session.id;
    delete from public.study_grading_reports where user_id = v_user_id and session_id = v_session.id;
    delete from public.response_grading_feedback where user_id = v_user_id and session_id = v_session.id;
    update public.annotation_grading_feedback set submission_id = null,
      correct_reading = '', correct_meaning = '', judgement = 'ungraded',
      simple_mistake = false, review_unit = ''
    where user_id = v_user_id and session_id = v_session.id;
  end if;

  v_submission_id := gen_random_uuid();
  select jsonb_build_object(
    'packet_version', 1,
    'submission_id', v_submission_id,
    'session_id', v_session.id,
    'day_no', v_session.day_no,
    'article', jsonb_build_object(
      'id', article.id,
      'title', article.title,
      'publisher', article.publisher,
      'source_url', article.source_url,
      'published_at', article.published_at,
      'body_text', article.body_text,
      'body_revision', article.body_revision
    ),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', response.id,
        'ordinal', response.ordinal,
        'perspective', response.perspective,
        'prompt', response.prompt,
        'answer', response.answer
      ) order by response.ordinal)
      from public.responses as response
      where response.user_id = v_user_id and response.session_id = v_session.id
    ), '[]'::jsonb),
    'annotations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', annotation.id,
        'kind', annotation.kind,
        'start_offset', annotation.start_offset,
        'end_offset', annotation.end_offset,
        'quote', annotation.quote,
        'note', annotation.note,
        'user_reading', coalesce(feedback.user_reading, ''),
        'user_meaning', coalesce(feedback.user_meaning, '')
      ) order by annotation.start_offset, annotation.id)
      from public.annotations as annotation
      left join public.annotation_grading_feedback as feedback
        on feedback.annotation_id = annotation.id and feedback.user_id = annotation.user_id
      where annotation.user_id = v_user_id and annotation.session_id = v_session.id
    ), '[]'::jsonb)
  )
  into v_snapshot
  from public.articles as article
  where article.id = v_session.article_id and article.user_id = v_user_id;

  update public.study_sessions
  set grading_status = 'submitted',
      grading_submission_id = v_submission_id,
      grading_snapshot = v_snapshot,
      grading_packet_version = 1,
      grading_grader_version = '',
      grading_failure_message = null,
      grading_result = null,
      grading_submitted_at = now(),
      grading_completed_at = null
  where id = v_session.id and user_id = v_user_id;

  return v_snapshot;
end;
$$;

create or replace function public.get_study_grading_packet(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_user_id;
  v_snapshot jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' or v_user_id is null then
    raise exception 'Only the local grading service may read grading packets.'
      using errcode = '42501';
  end if;
  select session.grading_snapshot
  into v_snapshot
  from public.study_sessions as session
  where session.id = p_session_id
    and session.user_id = v_user_id
    and session.grading_status in ('submitted', 'graded', 'cards_confirmed');
  if v_snapshot is null then
    raise exception 'A grading packet is not available.' using errcode = '42501';
  end if;
  return v_snapshot;
end;
$$;

create or replace function public.mark_study_grading_failed(
  p_user_id uuid,
  p_session_id uuid,
  p_submission_id uuid,
  p_message text,
  p_grader_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := p_user_id;
begin
  if coalesce(auth.role(), '') <> 'service_role' or v_user_id is null then
    raise exception 'Only the local grading service may mark grading failures.'
      using errcode = '42501';
  end if;
  update public.study_sessions
  set grading_status = 'failed',
      grading_failure_message = coalesce(nullif(p_message, ''), 'Unknown grading failure'),
      grading_grader_version = coalesce(p_grader_version, ''),
      grading_completed_at = now()
  where id = p_session_id and user_id = v_user_id
    and grading_status = 'submitted'
    and grading_submission_id = p_submission_id;
  if not found then
    raise exception 'Active grading submission was not found.' using errcode = '40001';
  end if;
end;
$$;

create or replace function public.apply_study_grading_result(
  p_user_id uuid,
  p_session_id uuid,
  p_submission_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_user_id;
  v_session public.study_sessions%rowtype;
  v_diagnosis jsonb;
  v_responses jsonb;
  v_annotations jsonb;
  v_card_proposals jsonb;
  v_item jsonb;
  v_item_id uuid;
  v_ids uuid[] := array[]::uuid[];
  v_expected_count integer;
  v_judgement text;
  v_source_type text;
  v_source_id uuid;
  v_proposal_kind public.card_kind;
begin
  if coalesce(auth.role(), '') <> 'service_role' or v_user_id is null then
    raise exception 'Only the local grading service may apply grading results.'
      using errcode = '42501';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'Grading result must be an object.' using errcode = '22023';
  end if;

  select session.*
  into v_session
  from public.study_sessions as session
  where session.id = p_session_id and session.user_id = v_user_id
  for update;
  if not found then
    raise exception 'Study session was not found.' using errcode = '42501';
  end if;
  if v_session.grading_status in ('graded', 'cards_confirmed')
     and v_session.grading_submission_id = p_submission_id then
    if v_session.grading_result = p_result then
      return jsonb_build_object(
        'session_id', p_session_id,
        'status', v_session.grading_status
      );
    end if;
    raise exception 'This submission already has a different immutable grading result.'
      using errcode = '23505';
  end if;
  if v_session.grading_status <> 'submitted'
     or v_session.grading_submission_id is distinct from p_submission_id then
    raise exception 'Grading submission is stale or unavailable.' using errcode = '40001';
  end if;

  v_diagnosis := p_result -> 'diagnosis';
  v_responses := p_result -> 'responses';
  v_annotations := p_result -> 'annotations';
  v_card_proposals := coalesce(p_result -> 'card_proposals', '[]'::jsonb);
  if jsonb_typeof(v_diagnosis) <> 'object'
     or jsonb_typeof(v_responses) <> 'array'
     or jsonb_typeof(v_annotations) <> 'array'
     or jsonb_typeof(v_card_proposals) <> 'array' then
    raise exception 'Grading result sections are invalid.' using errcode = '22023';
  end if;

  select count(*) into v_expected_count
  from public.responses where user_id = v_user_id and session_id = p_session_id;
  if jsonb_array_length(v_responses) <> v_expected_count then
    raise exception 'Every response requires grading feedback.' using errcode = '22023';
  end if;
  v_ids := array[]::uuid[];
  for v_item in select value from jsonb_array_elements(v_responses) loop
    v_item_id := (v_item ->> 'response_id')::uuid;
    if v_item_id = any(v_ids) or not exists (
      select 1 from public.responses
      where id = v_item_id and user_id = v_user_id and session_id = p_session_id
    ) then
      raise exception 'Response grading ID is invalid or duplicated.' using errcode = '23503';
    end if;
    v_ids := array_append(v_ids, v_item_id);
    insert into public.response_grading_feedback (
      response_id, user_id, session_id, submission_id,
      judgement, issues, correct_points, missing_evidence, error_type, corrected_answer
    ) values (
      v_item_id, v_user_id, p_session_id, p_submission_id,
      coalesce(v_item ->> 'judgement', 'ungraded'),
      coalesce(v_item -> 'issues', '[]'::jsonb),
      coalesce(v_item ->> 'correct_points', ''),
      coalesce(v_item ->> 'missing_evidence', ''),
      coalesce(v_item ->> 'error_type', ''),
      coalesce(v_item ->> 'corrected_answer', '')
    )
    on conflict (response_id) do update set
      submission_id = excluded.submission_id,
      judgement = excluded.judgement,
      issues = excluded.issues,
      correct_points = excluded.correct_points,
      missing_evidence = excluded.missing_evidence,
      error_type = excluded.error_type,
      corrected_answer = excluded.corrected_answer;
    update public.responses
    set reference_answer = coalesce(v_item ->> 'corrected_answer', ''),
        feedback = concat_ws(E'\n', nullif(v_item ->> 'correct_points', ''),
          nullif(v_item ->> 'missing_evidence', ''), nullif(v_item ->> 'error_type', ''))
    where id = v_item_id and user_id = v_user_id;
  end loop;

  select count(*) into v_expected_count
  from public.annotations where user_id = v_user_id and session_id = p_session_id;
  if jsonb_array_length(v_annotations) <> v_expected_count then
    raise exception 'Every annotation requires grading feedback.' using errcode = '22023';
  end if;
  v_ids := array[]::uuid[];
  for v_item in select value from jsonb_array_elements(v_annotations) loop
    v_item_id := (v_item ->> 'annotation_id')::uuid;
    v_judgement := v_item ->> 'judgement';
    if v_item_id = any(v_ids) or not exists (
      select 1 from public.annotations
      where id = v_item_id and user_id = v_user_id and session_id = p_session_id
    ) or v_judgement not in ('correct', 'partial', 'incorrect', 'ungraded')
      then
      raise exception 'Annotation grading item is invalid or duplicated.' using errcode = '23503';
    end if;
    v_ids := array_append(v_ids, v_item_id);
    insert into public.annotation_grading_feedback (
      annotation_id, user_id, session_id, submission_id,
      correct_reading, correct_meaning, judgement, simple_mistake, review_unit
    ) values (
      v_item_id, v_user_id, p_session_id, p_submission_id,
      coalesce(v_item ->> 'correct_reading', ''),
      coalesce(v_item ->> 'correct_meaning', ''),
      v_judgement,
      coalesce((v_item ->> 'simple_mistake')::boolean, false),
      coalesce(v_item ->> 'review_unit', '')
    )
    on conflict (annotation_id) do update set
      submission_id = excluded.submission_id,
      correct_reading = excluded.correct_reading,
      correct_meaning = excluded.correct_meaning,
      judgement = excluded.judgement,
      simple_mistake = excluded.simple_mistake,
      review_unit = excluded.review_unit;
  end loop;

  v_ids := array[]::uuid[];
  for v_item in select value from jsonb_array_elements(v_card_proposals) loop
    v_item_id := (v_item ->> 'proposal_id')::uuid;
    v_source_type := v_item ->> 'source_type';
    v_source_id := case
      when nullif(v_item ->> 'source_id', '') is null then null
      else (v_item ->> 'source_id')::uuid
    end;
    v_proposal_kind := (v_item ->> 'kind')::public.card_kind;
    if v_item_id = any(v_ids)
       or v_source_type not in ('annotation', 'response', 'article')
       or nullif(btrim(v_item ->> 'front'), '') is null
       or (v_proposal_kind = 'kanji' and char_length(v_item ->> 'front') <> 1)
       or (v_source_type = 'annotation' and not exists (
         select 1 from public.annotations
         where id = v_source_id and user_id = v_user_id and session_id = p_session_id
       ))
       or (v_source_type = 'response' and not exists (
         select 1 from public.responses
         where id = v_source_id and user_id = v_user_id and session_id = p_session_id
       ))
       or (v_source_type = 'article' and v_source_id is not null
           and v_source_id <> v_session.article_id) then
      raise exception 'Card proposal is invalid or duplicated.' using errcode = '23503';
    end if;
    v_ids := array_append(v_ids, v_item_id);
    insert into public.grading_card_proposals (
      id, user_id, session_id, submission_id, source_type, source_id,
      source_article_id, review_unit, kind, front, reading, meaning_ko,
      example_ja, decision
    ) values (
      v_item_id, v_user_id, p_session_id, p_submission_id, v_source_type,
      v_source_id, v_session.article_id,
      coalesce(v_item ->> 'review_unit', ''), v_proposal_kind,
      v_item ->> 'front', coalesce(v_item ->> 'reading', ''),
      coalesce(v_item ->> 'meaning_ko', ''),
      coalesce(v_item ->> 'example_ja', ''), 'proposed'
    );
  end loop;

  insert into public.study_grading_reports (
    session_id, user_id, submission_id, comprehension_pct,
    strengths, weaknesses, misread_patterns, next_direction
  ) values (
    p_session_id, v_user_id, p_submission_id,
    (v_diagnosis ->> 'comprehension_pct')::smallint,
    coalesce(v_diagnosis ->> 'strengths', ''),
    coalesce(v_diagnosis ->> 'weaknesses', ''),
    coalesce(v_diagnosis ->> 'misread_patterns', ''),
    coalesce(v_diagnosis ->> 'next_direction', '')
  )
  on conflict (session_id) do update set
    submission_id = excluded.submission_id,
    comprehension_pct = excluded.comprehension_pct,
    strengths = excluded.strengths,
    weaknesses = excluded.weaknesses,
    misread_patterns = excluded.misread_patterns,
    next_direction = excluded.next_direction;

  update public.study_sessions
  set grading_status = 'graded',
      grading_result = p_result,
      grading_grader_version = coalesce(p_result ->> 'grader_version', ''),
      grading_failure_message = null,
      grading_completed_at = now()
  where id = p_session_id and user_id = v_user_id;

  return jsonb_build_object('session_id', p_session_id, 'status', 'graded');
end;
$$;

create or replace function public.decide_grading_card_proposal(
  p_user_id uuid,
  p_proposal_id uuid,
  p_decision text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_proposal public.grading_card_proposals%rowtype;
  v_card_id uuid;
  v_canonical_key text;
  v_annotation_id uuid;
  v_initial_kind public.annotation_kind;
begin
  if v_user_id is null or p_user_id is distinct from v_user_id then
    raise exception 'Authentication does not match the requested owner.' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'Proposal decision must be accepted or rejected.' using errcode = '22023';
  end if;
  select proposal.* into v_proposal
  from public.grading_card_proposals as proposal
  join public.study_sessions as session
    on session.id = proposal.session_id and session.user_id = proposal.user_id
  where proposal.id = p_proposal_id and proposal.user_id = v_user_id
    and session.grading_status = 'graded'
  for update of proposal;
  if not found then
    raise exception 'Open grading card proposal was not found.' using errcode = '42501';
  end if;
  if v_proposal.decision = p_decision then return v_proposal.created_card_id; end if;
  if v_proposal.decision <> 'proposed' then
    raise exception 'Proposal decision is immutable.' using errcode = '23505';
  end if;
  if p_decision = 'rejected' then
    update public.grading_card_proposals set decision = 'rejected', decided_at = now()
    where id = p_proposal_id and user_id = v_user_id;
    return null;
  end if;

  v_canonical_key := case when v_proposal.kind = 'kanji'
    then btrim(v_proposal.front)
    else btrim(v_proposal.front) || '|' || btrim(v_proposal.reading) end;
  if v_proposal.source_type = 'annotation' then
    v_annotation_id := v_proposal.source_id;
    select annotation.kind into v_initial_kind from public.annotations as annotation
    where annotation.id = v_annotation_id and annotation.user_id = v_user_id;
  end if;
  insert into public.study_cards as existing_card (
    user_id, kind, canonical_key, front, reading, meaning_ko, example_ja, initial_kind
  ) values (
    v_user_id, v_proposal.kind, v_canonical_key, btrim(v_proposal.front),
    nullif(btrim(v_proposal.reading), ''), nullif(v_proposal.meaning_ko, ''),
    nullif(v_proposal.example_ja, ''), v_initial_kind
  ) on conflict (user_id, kind, canonical_key) do update set
    meaning_ko = coalesce(nullif(excluded.meaning_ko, ''), existing_card.meaning_ko),
    example_ja = coalesce(nullif(excluded.example_ja, ''), existing_card.example_ja),
    initial_kind = coalesce(existing_card.initial_kind, excluded.initial_kind)
  returning id into v_card_id;
  insert into public.study_card_sources as existing_source (
    user_id, card_id, article_id, annotation_id, context_text
  ) values (
    v_user_id, v_card_id, v_proposal.source_article_id, v_annotation_id,
    nullif(coalesce(nullif(v_proposal.example_ja, ''), v_proposal.review_unit), '')
  ) on conflict (user_id, card_id, article_id) do update set
    annotation_id = coalesce(existing_source.annotation_id, excluded.annotation_id),
    context_text = coalesce(excluded.context_text, existing_source.context_text);
  update public.grading_card_proposals
  set decision = 'accepted', created_card_id = v_card_id, decided_at = now()
  where id = p_proposal_id and user_id = v_user_id;
  return v_card_id;
end;
$$;

create or replace function public.confirm_study_grading_cards(
  p_user_id uuid,
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_user_id is distinct from v_user_id then
    raise exception 'Authentication does not match the requested owner.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.grading_card_proposals
    where user_id = v_user_id and session_id = p_session_id and decision = 'proposed'
  ) then
    raise exception 'Every proposed card decision must be resolved.' using errcode = '55000';
  end if;
  update public.study_sessions
  set grading_status = 'cards_confirmed'
  where id = p_session_id and user_id = v_user_id and grading_status = 'graded';
  if not found then raise exception 'Graded session was not found.' using errcode = '42501'; end if;
end;
$$;

create or replace function public.normalize_study_fsrs_state(
  p_state jsonb,
  p_revision bigint
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_due_at timestamptz;
  v_fsrs_state smallint;
  v_stability double precision;
  v_difficulty double precision;
  v_elapsed_days integer;
  v_scheduled_days integer;
  v_learning_steps integer;
  v_reps integer;
  v_lapses integer;
  v_last_review_at timestamptz;
begin
  if p_revision < 0 or jsonb_typeof(p_state) <> 'object' then
    raise exception 'FSRS state or revision is invalid.' using errcode = '22023';
  end if;

  begin
    v_due_at := (p_state ->> 'due_at')::timestamptz;
    v_fsrs_state := (p_state ->> 'fsrs_state')::smallint;
    v_stability := (p_state ->> 'stability')::double precision;
    v_difficulty := (p_state ->> 'difficulty')::double precision;
    v_elapsed_days := (p_state ->> 'elapsed_days')::integer;
    v_scheduled_days := (p_state ->> 'scheduled_days')::integer;
    v_learning_steps := (p_state ->> 'learning_steps')::integer;
    v_reps := (p_state ->> 'reps')::integer;
    v_lapses := (p_state ->> 'lapses')::integer;
    v_last_review_at := case
      when p_state ->> 'last_review_at' is null then null
      else (p_state ->> 'last_review_at')::timestamptz
    end;
  exception
    when invalid_text_representation
      or numeric_value_out_of_range
      or datetime_field_overflow then
      raise exception 'FSRS state contains an invalid value.' using errcode = '22023';
  end;

  if v_due_at is null
     or v_fsrs_state is null or v_fsrs_state not between 0 and 3
     or v_stability is null or v_stability < 0
       or v_stability >= 'Infinity'::double precision
     or v_difficulty is null or v_difficulty < 0 or v_difficulty > 10
     or v_elapsed_days is null or v_elapsed_days < 0
     or v_scheduled_days is null or v_scheduled_days < 0
     or v_learning_steps is null or v_learning_steps < 0
     or v_reps is null or v_reps < 0
     or v_lapses is null or v_lapses < 0 then
    raise exception 'FSRS state contains an out-of-range value.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'due_at', v_due_at,
    'fsrs_state', v_fsrs_state,
    'stability', v_stability,
    'difficulty', v_difficulty,
    'elapsed_days', v_elapsed_days,
    'scheduled_days', v_scheduled_days,
    'learning_steps', v_learning_steps,
    'reps', v_reps,
    'lapses', v_lapses,
    'last_review_at', v_last_review_at,
    'revision', p_revision
  );
end;
$$;

-- Incrementally import a workspace in one transaction. Stable import keys make
-- exact retries no-ops, while cards are shared by (kind, canonical_key) and can
-- gain one source row for every later article in which they occur.
create or replace function public.import_study_workspace(
  p_user_id uuid,
  p_workspace jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_articles jsonb;
  v_responses jsonb;
  v_cards jsonb;
  v_review_events jsonb;
  v_grading_sessions jsonb;
  v_response_grading_items jsonb;
  v_annotation_grading_items jsonb;
  v_article_json jsonb;
  v_response_json jsonb;
  v_annotation_json jsonb;
  v_card_json jsonb;
  v_review_json jsonb;
  v_grading_json jsonb;
  v_source_json jsonb;
  v_annotations jsonb;
  v_sources jsonb;
  v_article_map jsonb := '{}'::jsonb;
  v_card_map jsonb := '{}'::jsonb;
  v_reviewed_card_map jsonb := '{}'::jsonb;
  v_source_article_key text;
  v_source_item_key text;
  v_import_key text;
  v_title text;
  v_source_url text;
  v_body_text text;
  v_quote text;
  v_context_text text;
  v_article_id uuid;
  v_possible_id uuid;
  v_session_id uuid;
  v_card_id uuid;
  v_event_id uuid;
  v_source_article_id uuid;
  v_existing_annotation_id uuid;
  v_response_id uuid;
  v_existing_event public.study_review_events%rowtype;
  v_existing_card public.study_cards%rowtype;
  v_session_state public.study_sessions%rowtype;
  v_day_no integer;
  v_body_revision integer;
  v_start_offset integer;
  v_end_offset integer;
  v_kind public.card_kind;
  v_annotation_kind public.annotation_kind;
  v_initial_kind public.annotation_kind;
  v_rating smallint;
  v_base_revision bigint;
  v_resulting_revision bigint;
  v_reviewed_at timestamptz;
  v_duration_ms integer;
  v_scheduler_version text;
  v_grading_status text;
  v_submission_id uuid;
  v_proposal_id uuid;
  v_proposal_source_type text;
  v_proposal_source_id uuid;
  v_proposal_decision text;
  v_proposal_kind public.card_kind;
  v_imported_card_state jsonb;
  v_before_state jsonb;
  v_after_state jsonb;
  v_previous_card_key text;
  v_previous_after_state jsonb;
  v_previous_resulting_revision bigint;
  v_previous_card_was_new boolean;
  v_previous_imported_card_state jsonb;
  v_card_was_new boolean;
  v_rows integer;
  v_articles_added integer := 0;
  v_responses_added integer := 0;
  v_annotations_added integer := 0;
  v_cards_added integer := 0;
  v_sources_merged integer := 0;
  v_reviews_added integer := 0;
  v_reviews_seen integer := 0;
begin
  if v_user_id is null or p_user_id is distinct from v_user_id then
    raise exception 'Authentication does not match the requested owner.'
      using errcode = '42501';
  end if;

  if p_workspace is null or jsonb_typeof(p_workspace) <> 'object' then
    raise exception 'workspace must be a JSON object.' using errcode = '22023';
  end if;

  v_articles := case
    when p_workspace ? 'articles' then p_workspace -> 'articles'
    else '[]'::jsonb
  end;
  v_responses := case
    when p_workspace ? 'responses' then p_workspace -> 'responses'
    else '[]'::jsonb
  end;
  v_cards := case
    when p_workspace ? 'cards' then p_workspace -> 'cards'
    else '[]'::jsonb
  end;
  v_review_events := case
    when p_workspace ? 'review_events' then p_workspace -> 'review_events'
    else '[]'::jsonb
  end;
  v_grading_sessions := coalesce(p_workspace -> 'grading_sessions', '[]'::jsonb);
  v_response_grading_items := coalesce(
    p_workspace -> 'response_grading_feedback', '[]'::jsonb
  );
  v_annotation_grading_items := coalesce(
    p_workspace -> 'annotation_grading_feedback', '[]'::jsonb
  );

  if jsonb_typeof(v_articles) <> 'array'
     or jsonb_typeof(v_responses) <> 'array'
     or jsonb_typeof(v_cards) <> 'array'
     or jsonb_typeof(v_review_events) <> 'array'
     or jsonb_typeof(v_grading_sessions) <> 'array'
     or jsonb_typeof(v_response_grading_items) <> 'array'
     or jsonb_typeof(v_annotation_grading_items) <> 'array' then
    raise exception 'Workspace collections must be arrays.'
      using errcode = '22023';
  end if;

  -- Serialize imports for one account. Unique keys remain the final guard, but
  -- this avoids two concurrent retries racing while their ID maps are built.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  for v_article_json in
    select item.value
    from jsonb_array_elements(v_articles) as item(value)
  loop
    if jsonb_typeof(v_article_json) <> 'object' then
      raise exception 'Each article must be a JSON object.' using errcode = '22023';
    end if;

    v_source_article_key := nullif(btrim(v_article_json ->> 'import_key'), '');
    v_title := nullif(btrim(v_article_json ->> 'title'), '');
    v_source_url := nullif(btrim(v_article_json ->> 'source_url'), '');
    v_body_text := v_article_json ->> 'body_text';
    v_day_no := (v_article_json ->> 'day_no')::integer;
    v_body_revision := (v_article_json ->> 'body_revision')::integer;

    if v_source_article_key is null
       or v_title is null
       or v_body_text is null
       or v_day_no is null or v_day_no < 0
       or v_body_revision is null or v_body_revision <= 0 then
      raise exception 'Article import fields are invalid.' using errcode = '22023';
    end if;

    if v_article_map ? v_source_article_key then
      raise exception 'Article import keys must be unique within a workspace.'
        using errcode = '23505';
    end if;

    v_article_id := null;
    select article.id
    into v_article_id
    from public.articles as article
    where article.user_id = v_user_id
      and article.import_key = v_source_article_key
    for update;

    if v_article_id is null then
      v_possible_id := null;
      begin
        v_possible_id := v_source_article_key::uuid;
      exception when invalid_text_representation then
        v_possible_id := null;
      end;

      if v_possible_id is not null then
        select article.id
        into v_article_id
        from public.articles as article
        where article.user_id = v_user_id and article.id = v_possible_id
        for update;
      end if;
    end if;

    if v_article_id is null and v_source_url is not null then
      select article.id
      into v_article_id
      from public.articles as article
      where article.user_id = v_user_id and article.source_url = v_source_url
      order by article.created_at
      limit 1
      for update;
    end if;

    if v_article_id is null then
      insert into public.articles (
        user_id,
        import_key,
        title,
        publisher,
        source_url,
        published_at,
        body_text,
        body_revision
      ) values (
        v_user_id,
        v_source_article_key,
        v_title,
        nullif(v_article_json ->> 'publisher', ''),
        v_source_url,
        case
          when nullif(v_article_json ->> 'published_at', '') is null then null
          else (v_article_json ->> 'published_at')::date
        end,
        v_body_text,
        v_body_revision
      )
      returning id into v_article_id;
      v_articles_added := v_articles_added + 1;
    else
      update public.articles
      set import_key = coalesce(import_key, v_source_article_key)
      where id = v_article_id and user_id = v_user_id;

      select article.body_text, article.body_revision
      into v_body_text, v_body_revision
      from public.articles as article
      where article.id = v_article_id and article.user_id = v_user_id;
    end if;

    v_session_id := null;
    select session.id
    into v_session_id
    from public.study_sessions as session
    where session.user_id = v_user_id and session.article_id = v_article_id
    order by session.started_at, session.id
    limit 1
    for update;

    if v_session_id is null then
      insert into public.study_sessions (
        user_id,
        article_id,
        import_key,
        day_no,
        status,
        completed_at
      ) values (
        v_user_id,
        v_article_id,
        v_source_article_key,
        v_day_no,
        'completed',
        now()
      )
      returning id into v_session_id;
    end if;

    v_article_map := v_article_map
      || jsonb_build_object(v_source_article_key, v_article_id::text);

    v_annotations := case
      when v_article_json ? 'annotations' then v_article_json -> 'annotations'
      else '[]'::jsonb
    end;

    if jsonb_typeof(v_annotations) <> 'array' then
      raise exception 'Article annotations must be an array.' using errcode = '22023';
    end if;

    for v_annotation_json in
      select item.value
      from jsonb_array_elements(v_annotations) as item(value)
    loop
      v_source_item_key := nullif(btrim(v_annotation_json ->> 'import_key'), '');
      if v_source_item_key is null then
        raise exception 'Annotation import_key is required.' using errcode = '22023';
      end if;
      v_import_key := v_source_article_key || ':' || v_source_item_key;

      select annotation.id
      into v_existing_annotation_id
      from public.annotations as annotation
      where annotation.user_id = v_user_id and annotation.import_key = v_import_key;

      if v_existing_annotation_id is not null then
        continue;
      end if;

      begin
        v_annotation_kind := (v_annotation_json ->> 'kind')::public.annotation_kind;
        v_start_offset := (v_annotation_json ->> 'start_offset')::integer;
        v_end_offset := (v_annotation_json ->> 'end_offset')::integer;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'Imported annotation contains an invalid value.'
            using errcode = '22023';
      end;
      v_quote := v_annotation_json ->> 'quote';

      if v_start_offset is null
         or v_end_offset is null
         or v_start_offset < 0
         or v_end_offset <= v_start_offset
         or v_end_offset > char_length(v_body_text)
         or v_quote is null
         or substring(
              v_body_text
              from v_start_offset + 1
              for v_end_offset - v_start_offset
            ) <> v_quote then
        raise exception 'Imported annotation does not match its article body.'
          using errcode = '22023';
      end if;

      -- A workspace exported back from the remote DB has different import
      -- keys, so also recognize the same semantic annotation as an exact retry.
      select annotation.id
      into v_existing_annotation_id
      from public.annotations as annotation
      where annotation.user_id = v_user_id
        and annotation.article_id = v_article_id
        and annotation.kind = v_annotation_kind
        and annotation.start_offset = v_start_offset
        and annotation.end_offset = v_end_offset
        and annotation.quote = v_quote
      limit 1;

      if v_existing_annotation_id is not null then
        continue;
      end if;

      insert into public.annotations (
        user_id,
        article_id,
        session_id,
        import_key,
        kind,
        start_offset,
        end_offset,
        quote,
        body_revision,
        note
      ) values (
        v_user_id,
        v_article_id,
        v_session_id,
        v_import_key,
        v_annotation_kind,
        v_start_offset,
        v_end_offset,
        v_quote,
        v_body_revision,
        nullif(v_annotation_json ->> 'note', '')
      )
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_annotations_added := v_annotations_added + v_rows;
    end loop;
  end loop;

  for v_response_json in
    select item.value
    from jsonb_array_elements(v_responses) as item(value)
  loop
    v_source_article_key := nullif(btrim(v_response_json ->> 'article_import_key'), '');
    v_source_item_key := nullif(btrim(v_response_json ->> 'import_key'), '');
    if v_source_article_key is null
       or v_source_item_key is null
       or not (v_article_map ? v_source_article_key) then
      raise exception 'Response refers to an article outside this workspace.'
        using errcode = '23503';
    end if;

    v_article_id := (v_article_map ->> v_source_article_key)::uuid;
    select session.id
    into v_session_id
    from public.study_sessions as session
    where session.user_id = v_user_id and session.article_id = v_article_id
    order by session.started_at, session.id
    limit 1;

    v_import_key := v_source_article_key || ':' || v_source_item_key;
    insert into public.responses (
      user_id,
      session_id,
      import_key,
      ordinal,
      perspective,
      prompt,
      answer,
      reference_answer,
      feedback
    ) values (
      v_user_id,
      v_session_id,
      v_import_key,
      (v_response_json ->> 'ordinal')::smallint,
      coalesce(v_response_json ->> 'perspective', ''),
      v_response_json ->> 'prompt',
      coalesce(v_response_json ->> 'answer', ''),
      nullif(v_response_json ->> 'reference_answer', ''),
      nullif(v_response_json ->> 'feedback', '')
    )
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    v_responses_added := v_responses_added + v_rows;
  end loop;

  for v_card_json in
    select item.value
    from jsonb_array_elements(v_cards) as item(value)
  loop
    v_source_item_key := nullif(btrim(v_card_json ->> 'import_key'), '');
    if v_source_item_key is null or v_card_map ? v_source_item_key then
      raise exception 'Card import keys must be present and unique.' using errcode = '23505';
    end if;

    begin
      v_kind := (v_card_json ->> 'kind')::public.card_kind;
      v_initial_kind := case
        when nullif(v_card_json ->> 'initial_kind', '') is null then null
        else (v_card_json ->> 'initial_kind')::public.annotation_kind
      end;
    exception when invalid_text_representation then
      raise exception 'Imported card kind is invalid.' using errcode = '22023';
    end;

    v_import_key := nullif(btrim(v_card_json ->> 'canonical_key'), '');
    if v_import_key is null
       or nullif(btrim(v_card_json ->> 'front'), '') is null
       or (v_kind = 'kanji' and char_length(v_card_json ->> 'front') <> 1) then
      raise exception 'Imported card key or front is invalid.' using errcode = '22023';
    end if;

    v_imported_card_state := public.normalize_study_fsrs_state(
      v_card_json -> 'current_state',
      (v_card_json -> 'current_state' ->> 'revision')::bigint
    );
    if v_imported_card_state is null then
      raise exception 'Imported card current_state is required.' using errcode = '22023';
    end if;

    v_card_id := null;
    select card.*
    into v_existing_card
    from public.study_cards as card
    where card.user_id = v_user_id
      and card.kind = v_kind
      and card.canonical_key = v_import_key
    for update;
    v_card_id := v_existing_card.id;
    v_card_was_new := v_card_id is null;

    if v_card_was_new then
      insert into public.study_cards (
        user_id,
        kind,
        canonical_key,
        front,
        reading,
        meaning_ko,
        example_ja,
        initial_kind,
        suspended,
        due_at,
        fsrs_state,
        stability,
        difficulty,
        elapsed_days,
        scheduled_days,
        learning_steps,
        reps,
        lapses,
        last_review_at,
        revision
      ) values (
        v_user_id,
        v_kind,
        v_import_key,
        v_card_json ->> 'front',
        nullif(v_card_json ->> 'reading', ''),
        nullif(v_card_json ->> 'meaning_ko', ''),
        nullif(v_card_json ->> 'example_ja', ''),
        v_initial_kind,
        coalesce((v_card_json ->> 'suspended')::boolean, false),
        (v_imported_card_state ->> 'due_at')::timestamptz,
        (v_imported_card_state ->> 'fsrs_state')::smallint,
        (v_imported_card_state ->> 'stability')::double precision,
        (v_imported_card_state ->> 'difficulty')::double precision,
        (v_imported_card_state ->> 'elapsed_days')::integer,
        (v_imported_card_state ->> 'scheduled_days')::integer,
        (v_imported_card_state ->> 'learning_steps')::integer,
        (v_imported_card_state ->> 'reps')::integer,
        (v_imported_card_state ->> 'lapses')::integer,
        (v_imported_card_state ->> 'last_review_at')::timestamptz,
        (v_imported_card_state ->> 'revision')::bigint
      )
      returning id into v_card_id;
      v_cards_added := v_cards_added + 1;
    end if;

    v_card_map := v_card_map || jsonb_build_object(
      v_source_item_key,
      jsonb_build_object(
        'card_id', v_card_id,
        'was_new', v_card_was_new,
        'imported_state', v_imported_card_state
      )
    );

    v_sources := case
      when v_card_json ? 'source_article_keys'
        then v_card_json -> 'source_article_keys'
      when nullif(v_card_json ->> 'source_article_key', '') is not null
        then jsonb_build_array(v_card_json ->> 'source_article_key')
      else '[]'::jsonb
    end;
    if jsonb_typeof(v_sources) <> 'array' then
      raise exception 'Card source_article_keys must be an array.' using errcode = '22023';
    end if;

    for v_source_json in
      select item.value
      from jsonb_array_elements(v_sources) as item(value)
    loop
      v_source_article_key := nullif(btrim(v_source_json #>> '{}'), '');
      if v_source_article_key is null then
        raise exception 'Card source article key is invalid.' using errcode = '22023';
      end if;

      v_source_article_id := null;
      if v_article_map ? v_source_article_key then
        v_source_article_id := (v_article_map ->> v_source_article_key)::uuid;
      else
        select article.id
        into v_source_article_id
        from public.articles as article
        where article.user_id = v_user_id
          and article.import_key = v_source_article_key;
      end if;

      if v_source_article_id is null then
        begin
          v_possible_id := v_source_article_key::uuid;
        exception when invalid_text_representation then
          v_possible_id := null;
        end;
        if v_possible_id is not null then
          select article.id
          into v_source_article_id
          from public.articles as article
          where article.user_id = v_user_id and article.id = v_possible_id;
        end if;
      end if;

      if v_source_article_id is null then
        raise exception 'Card source article was not found.' using errcode = '23503';
      end if;

      v_context_text := nullif(v_card_json ->> 'example_ja', '');
      insert into public.study_card_sources as existing_source (
        user_id,
        card_id,
        article_id,
        context_text
      ) values (
        v_user_id,
        v_card_id,
        v_source_article_id,
        v_context_text
      )
      on conflict (user_id, card_id, article_id) do update
      set context_text = coalesce(excluded.context_text, existing_source.context_text);
      v_sources_merged := v_sources_merged + 1;
    end loop;
  end loop;

  -- Validate each card's complete revision chain before accepting its immutable
  -- events. New cards must provide the full chain from revision zero to the
  -- imported current state. Existing cards only accept already-known events.
  for v_card_json in
    select item.value
    from jsonb_array_elements(v_cards) as item(value)
  loop
    v_source_item_key := v_card_json ->> 'import_key';
    v_card_id := (v_card_map -> v_source_item_key ->> 'card_id')::uuid;
    v_card_was_new := (v_card_map -> v_source_item_key ->> 'was_new')::boolean;
    v_imported_card_state := v_card_map -> v_source_item_key -> 'imported_state';
    v_previous_after_state := null;
    v_previous_resulting_revision := null;

    for v_review_json in
      select item.value
      from jsonb_array_elements(v_review_events) as item(value)
      where item.value ->> 'card_import_key' = v_source_item_key
      order by (item.value ->> 'base_revision')::bigint,
               item.value ->> 'event_id'
    loop
      v_reviews_seen := v_reviews_seen + 1;
      begin
        v_event_id := (v_review_json ->> 'event_id')::uuid;
        v_rating := (v_review_json ->> 'rating')::smallint;
        v_base_revision := (v_review_json ->> 'base_revision')::bigint;
        v_resulting_revision := (v_review_json ->> 'resulting_revision')::bigint;
        v_reviewed_at := (v_review_json ->> 'reviewed_at')::timestamptz;
        v_duration_ms := (v_review_json ->> 'duration_ms')::integer;
      exception
        when invalid_text_representation
          or numeric_value_out_of_range
          or datetime_field_overflow then
          raise exception 'Imported review event contains an invalid value.'
            using errcode = '22023';
      end;
      v_scheduler_version := nullif(v_review_json ->> 'scheduler_version', '');

      if v_event_id is null
         or v_rating is null or v_rating not between 1 and 4
         or v_base_revision is null or v_base_revision < 0
         or v_resulting_revision is null
         or v_resulting_revision <> v_base_revision + 1
         or v_reviewed_at is null
         or v_duration_ms is null or v_duration_ms < 0
         or v_scheduler_version is null then
        raise exception 'Imported review event is invalid.' using errcode = '22023';
      end if;

      v_before_state := public.normalize_study_fsrs_state(
        v_review_json -> 'before_state',
        v_base_revision
      );
      v_after_state := public.normalize_study_fsrs_state(
        v_review_json -> 'after_state',
        v_resulting_revision
      );
      if v_before_state is null or v_after_state is null then
        raise exception 'Imported review states are required.' using errcode = '22023';
      end if;

      if (v_after_state ->> 'last_review_at')::timestamptz
           is distinct from v_reviewed_at
         or (v_after_state ->> 'due_at')::timestamptz < v_reviewed_at
         or (v_after_state ->> 'reps')::integer
              <> (v_before_state ->> 'reps')::integer + 1
         or (v_after_state ->> 'lapses')::integer
              < (v_before_state ->> 'lapses')::integer
         or (v_after_state ->> 'lapses')::integer
              > (v_before_state ->> 'lapses')::integer + 1 then
        raise exception 'Imported review transition is inconsistent.' using errcode = '22023';
      end if;

      if v_previous_after_state is null then
        if v_base_revision <> 0 then
          raise exception 'Imported review history must begin at revision zero.'
            using errcode = '22023';
        end if;
      elsif v_base_revision <> v_previous_resulting_revision
            or v_before_state <> v_previous_after_state then
        raise exception 'Imported review history is not a continuous chain.'
          using errcode = '22023';
      end if;

      select event.*
      into v_existing_event
      from public.study_review_events as event
      where event.event_id = v_event_id;

      if found then
        if v_existing_event.user_id <> v_user_id
           or v_existing_event.card_id <> v_card_id
           or v_existing_event.base_revision <> v_base_revision
           or v_existing_event.resulting_revision <> v_resulting_revision
           or v_existing_event.rating <> v_rating
           or v_existing_event.reviewed_at <> v_reviewed_at
           or v_existing_event.duration_ms is distinct from v_duration_ms
           or v_existing_event.before_state <> v_before_state
           or v_existing_event.after_state <> v_after_state
           or v_existing_event.scheduler_version <> v_scheduler_version then
          raise exception 'Imported review event ID is already in use.'
            using errcode = '23505';
        end if;
      else
        if not v_card_was_new then
          raise exception 'Cannot merge a different history into an existing card.'
            using errcode = '40001';
        end if;

        insert into public.study_review_events (
          event_id,
          user_id,
          card_id,
          base_revision,
          resulting_revision,
          rating,
          reviewed_at,
          duration_ms,
          before_state,
          after_state,
          scheduler_version
        ) values (
          v_event_id,
          v_user_id,
          v_card_id,
          v_base_revision,
          v_resulting_revision,
          v_rating,
          v_reviewed_at,
          v_duration_ms,
          v_before_state,
          v_after_state,
          v_scheduler_version
        );
        v_reviews_added := v_reviews_added + 1;
      end if;

      v_previous_after_state := v_after_state;
      v_previous_resulting_revision := v_resulting_revision;
    end loop;

    if v_previous_after_state is null then
      if v_card_was_new
         and (v_imported_card_state ->> 'revision')::bigint <> 0 then
        raise exception 'A reviewed card requires its complete review history.'
          using errcode = '22023';
      end if;
    else
      if v_previous_resulting_revision
           <> (v_imported_card_state ->> 'revision')::bigint
         or v_previous_after_state <> v_imported_card_state then
        raise exception 'Card current state does not match its final review event.'
          using errcode = '22023';
      end if;

      if not v_card_was_new then
        select card.*
        into v_existing_card
        from public.study_cards as card
        where card.id = v_card_id and card.user_id = v_user_id;

        if v_existing_card.revision
             < (v_imported_card_state ->> 'revision')::bigint then
          raise exception 'Existing card is behind the imported immutable history.'
            using errcode = '40001';
        end if;
      end if;
    end if;

    v_reviewed_card_map := v_reviewed_card_map
      || jsonb_build_object(v_source_item_key, true);
  end loop;

  if v_reviews_seen <> jsonb_array_length(v_review_events) then
    raise exception 'A review event refers to a card outside this workspace.'
      using errcode = '23503';
  end if;

  for v_grading_json in
    select item.value from jsonb_array_elements(v_grading_sessions) as item(value)
  loop
    v_source_article_key := v_grading_json ->> 'article_import_key';
    if v_source_article_key is null or not (v_article_map ? v_source_article_key) then
      raise exception 'Grading session article was not found.' using errcode = '23503';
    end if;
    v_article_id := (v_article_map ->> v_source_article_key)::uuid;
    select session.* into v_session_state
    from public.study_sessions as session
    where session.user_id = v_user_id and session.article_id = v_article_id
    for update;

    v_grading_status := v_grading_json ->> 'status';
    if v_grading_status not in ('draft', 'submitted', 'graded', 'cards_confirmed', 'failed') then
      raise exception 'Imported grading status is invalid.' using errcode = '22023';
    end if;
    v_submission_id := case
      when nullif(v_grading_json ->> 'submissionId', '') is null then null
      else (v_grading_json ->> 'submissionId')::uuid
    end;
    if v_grading_status <> 'draft' and (
      v_submission_id is null
      or jsonb_typeof(v_grading_json -> 'submissionSnapshot') <> 'object'
    ) then
      raise exception 'Submitted grading requires its ID and snapshot.' using errcode = '22023';
    end if;

    if v_grading_status = 'draft' and v_session_state.grading_status <> 'draft' then
      continue;
    end if;
    if v_session_state.grading_status <> 'draft'
       and v_session_state.grading_submission_id is distinct from v_submission_id then
      raise exception 'Imported grading conflicts with an existing submission.'
        using errcode = '40001';
    end if;

    if v_session_state.grading_status = 'draft'
       or v_session_state.grading_submission_id = v_submission_id then
      update public.study_sessions
      set grading_status = case
            when array_position(
              array['draft', 'submitted', 'graded', 'cards_confirmed'],
              v_grading_status
            ) >= array_position(
              array['draft', 'submitted', 'graded', 'cards_confirmed'],
              v_session_state.grading_status
            ) then v_grading_status
            else v_session_state.grading_status
          end,
          grading_submission_id = v_submission_id,
          grading_snapshot = v_grading_json -> 'submissionSnapshot',
          grading_packet_version = coalesce((v_grading_json ->> 'packetVersion')::integer, 1),
          grading_grader_version = coalesce(v_grading_json ->> 'graderVersion', ''),
          grading_failure_message = v_grading_json ->> 'failureMessage',
          grading_submitted_at = case
            when nullif(v_grading_json ->> 'submittedAt', '') is null then null
            else (v_grading_json ->> 'submittedAt')::timestamptz
          end,
          grading_completed_at = case
            when nullif(v_grading_json ->> 'completedAt', '') is null then null
            else (v_grading_json ->> 'completedAt')::timestamptz
          end
      where id = v_session_state.id and user_id = v_user_id;
    end if;

    if jsonb_typeof(v_grading_json -> 'diagnosis') = 'object' then
      insert into public.study_grading_reports (
        session_id, user_id, submission_id, comprehension_pct,
        strengths, weaknesses, misread_patterns, next_direction
      ) values (
        v_session_state.id,
        v_user_id,
        v_submission_id,
        (v_grading_json -> 'diagnosis' ->> 'comprehensionPct')::smallint,
        coalesce(v_grading_json -> 'diagnosis' ->> 'strengths', ''),
        coalesce(v_grading_json -> 'diagnosis' ->> 'weaknesses', ''),
        coalesce(v_grading_json -> 'diagnosis' ->> 'misreadPatterns', ''),
        coalesce(v_grading_json -> 'diagnosis' ->> 'nextDirection', '')
      )
      on conflict (session_id) do update set
        submission_id = excluded.submission_id,
        comprehension_pct = excluded.comprehension_pct,
        strengths = excluded.strengths,
        weaknesses = excluded.weaknesses,
        misread_patterns = excluded.misread_patterns,
        next_direction = excluded.next_direction;
    end if;

    for v_source_json in select item.value from jsonb_array_elements(
      coalesce(v_grading_json -> 'cardProposals', '[]'::jsonb)
    ) as item(value) loop
      v_proposal_id := (v_source_json ->> 'id')::uuid;
      v_proposal_source_type := v_source_json ->> 'sourceType';
      v_proposal_decision := coalesce(v_source_json ->> 'decision', 'proposed');
      v_proposal_kind := (v_source_json ->> 'kind')::public.card_kind;
      v_proposal_source_id := null;
      if v_proposal_source_type = 'annotation' then
        select annotation.id into v_proposal_source_id from public.annotations as annotation
        where annotation.user_id = v_user_id
          and annotation.import_key = v_source_article_key || ':' || (v_source_json ->> 'sourceId');
      elsif v_proposal_source_type = 'response' then
        select response.id into v_proposal_source_id from public.responses as response
        where response.user_id = v_user_id
          and response.import_key = v_source_article_key || ':' || (v_source_json ->> 'sourceId');
      elsif v_proposal_source_type <> 'article' then
        raise exception 'Imported card proposal source is invalid.' using errcode = '22023';
      end if;
      v_card_id := null;
      if v_proposal_decision = 'accepted' then
        v_import_key := case when v_proposal_kind = 'kanji'
          then btrim(v_source_json ->> 'front')
          else btrim(v_source_json ->> 'front') || '|' || btrim(v_source_json ->> 'reading') end;
        select card.id into v_card_id from public.study_cards as card
        where card.user_id = v_user_id and card.kind = v_proposal_kind
          and card.canonical_key = v_import_key;
        if v_card_id is null then
          raise exception 'Accepted proposal canonical card was not imported.' using errcode = '23503';
        end if;
      end if;
      insert into public.grading_card_proposals (
        id, user_id, session_id, submission_id, source_type, source_id,
        source_article_id, review_unit, kind, front, reading, meaning_ko,
        example_ja, decision, created_card_id, decided_at
      ) values (
        v_proposal_id, v_user_id, v_session_state.id, v_submission_id,
        v_proposal_source_type, v_proposal_source_id, v_article_id,
        coalesce(v_source_json ->> 'reviewUnit', ''), v_proposal_kind,
        v_source_json ->> 'front', coalesce(v_source_json ->> 'reading', ''),
        coalesce(v_source_json ->> 'meaningKo', ''), coalesce(v_source_json ->> 'exampleJa', ''),
        v_proposal_decision, v_card_id,
        case when v_proposal_decision = 'proposed' then null else now() end
      ) on conflict (id) do nothing;
    end loop;
  end loop;

  for v_grading_json in
    select item.value from jsonb_array_elements(v_response_grading_items) as item(value)
  loop
    v_source_article_key := v_grading_json ->> 'article_import_key';
    v_source_item_key := v_grading_json ->> 'response_import_key';
    if not (v_article_map ? v_source_article_key) then
      raise exception 'Response grading article was not found.' using errcode = '23503';
    end if;
    v_article_id := (v_article_map ->> v_source_article_key)::uuid;
    select session.* into v_session_state from public.study_sessions as session
    where session.user_id = v_user_id and session.article_id = v_article_id;
    v_import_key := v_source_article_key || ':' || v_source_item_key;
    select response.id into v_response_id from public.responses as response
    where response.user_id = v_user_id and response.import_key = v_import_key;
    if v_response_id is null then
      begin v_possible_id := v_source_item_key::uuid;
      exception when invalid_text_representation then v_possible_id := null; end;
      select response.id into v_response_id from public.responses as response
      where response.id = v_possible_id and response.user_id = v_user_id
        and response.session_id = v_session_state.id;
    end if;
    if v_response_id is null or v_session_state.grading_submission_id is null then
      raise exception 'Response grading target was not found.' using errcode = '23503';
    end if;
    insert into public.response_grading_feedback (
      response_id, user_id, session_id, submission_id,
      judgement, issues, correct_points, missing_evidence, error_type, corrected_answer
    ) values (
      v_response_id, v_user_id, v_session_state.id,
      v_session_state.grading_submission_id,
      coalesce(v_grading_json ->> 'judgement', 'ungraded'),
      coalesce(v_grading_json -> 'issues', '[]'::jsonb),
      coalesce(v_grading_json ->> 'correctPoints', ''),
      coalesce(v_grading_json ->> 'missingEvidence', ''),
      coalesce(v_grading_json ->> 'errorType', ''),
      coalesce(v_grading_json ->> 'correctedAnswer', '')
    ) on conflict (response_id) do update set
      submission_id = excluded.submission_id,
      judgement = excluded.judgement,
      issues = excluded.issues,
      correct_points = excluded.correct_points,
      missing_evidence = excluded.missing_evidence,
      error_type = excluded.error_type,
      corrected_answer = excluded.corrected_answer;
  end loop;

  for v_grading_json in
    select item.value from jsonb_array_elements(v_annotation_grading_items) as item(value)
  loop
    v_source_article_key := v_grading_json ->> 'article_import_key';
    v_source_item_key := v_grading_json ->> 'annotation_import_key';
    if not (v_article_map ? v_source_article_key) then
      raise exception 'Annotation grading article was not found.' using errcode = '23503';
    end if;
    v_article_id := (v_article_map ->> v_source_article_key)::uuid;
    select session.* into v_session_state from public.study_sessions as session
    where session.user_id = v_user_id and session.article_id = v_article_id;
    v_import_key := v_source_article_key || ':' || v_source_item_key;
    select annotation.id into v_existing_annotation_id
    from public.annotations as annotation
    where annotation.user_id = v_user_id and annotation.import_key = v_import_key;
    if v_existing_annotation_id is null then
      begin v_possible_id := v_source_item_key::uuid;
      exception when invalid_text_representation then v_possible_id := null; end;
      select annotation.id into v_existing_annotation_id
      from public.annotations as annotation
      where annotation.id = v_possible_id and annotation.user_id = v_user_id
        and annotation.session_id = v_session_state.id;
    end if;
    if v_existing_annotation_id is null then
      raise exception 'Annotation grading target was not found.' using errcode = '23503';
    end if;
    insert into public.annotation_grading_feedback (
      annotation_id, user_id, session_id, submission_id,
      user_reading, user_meaning, correct_reading, correct_meaning,
      judgement, simple_mistake, review_unit
    ) values (
      v_existing_annotation_id, v_user_id, v_session_state.id,
      v_session_state.grading_submission_id,
      coalesce(v_grading_json ->> 'userReading', ''),
      coalesce(v_grading_json ->> 'userMeaning', ''),
      coalesce(v_grading_json ->> 'correctReading', ''),
      coalesce(v_grading_json ->> 'correctMeaning', ''),
      coalesce(v_grading_json ->> 'judgement', 'ungraded'),
      coalesce((v_grading_json ->> 'simpleMistake')::boolean, false),
      coalesce(v_grading_json ->> 'reviewUnit', '')
    ) on conflict (annotation_id) do update set
      submission_id = excluded.submission_id,
      user_reading = excluded.user_reading,
      user_meaning = excluded.user_meaning,
      correct_reading = excluded.correct_reading,
      correct_meaning = excluded.correct_meaning,
      judgement = excluded.judgement,
      simple_mistake = excluded.simple_mistake,
      review_unit = excluded.review_unit;
  end loop;

  insert into public.study_settings (
    user_id,
    desired_retention,
    scheduler_version
  ) values (
    v_user_id,
    0.900,
    coalesce(nullif(p_workspace ->> 'scheduler_version', ''), 'fsrs-6/ts-fsrs-5.4.1')
  )
  on conflict (user_id) do nothing;

  return jsonb_build_object(
    'articles_added', v_articles_added,
    'responses_added', v_responses_added,
    'annotations_added', v_annotations_added,
    'cards_added', v_cards_added,
    'sources_merged', v_sources_merged,
    'reviews_added', v_reviews_added
  );
end;
$$;

create or replace function public.link_study_card_source(
  p_user_id uuid,
  p_card_id uuid,
  p_article_id uuid,
  p_context_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_source_id uuid;
begin
  if v_user_id is null or p_user_id is distinct from v_user_id then
    raise exception 'Authentication does not match the requested owner.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.study_cards as card
    where card.id = p_card_id and card.user_id = v_user_id
  ) or not exists (
    select 1
    from public.articles as article
    where article.id = p_article_id and article.user_id = v_user_id
  ) then
    raise exception 'Card or article was not found.' using errcode = '42501';
  end if;

  insert into public.study_card_sources as existing_source (
    user_id,
    card_id,
    article_id,
    context_text
  ) values (
    v_user_id,
    p_card_id,
    p_article_id,
    nullif(p_context_text, '')
  )
  on conflict (user_id, card_id, article_id) do update
  set context_text = coalesce(excluded.context_text, existing_source.context_text)
  returning id into v_source_id;

  return v_source_id;
end;
$$;

revoke all on function public.set_japanese_study_updated_at() from public;
revoke all on function public.normalize_study_fsrs_state(jsonb, bigint)
  from public;
revoke all on function public.save_annotation_study_input(uuid, uuid, text, text) from public;
revoke all on function public.save_study_response(uuid, text) from public;
revoke all on function public.mark_study_grading_failed(uuid, uuid, uuid, text, text) from public;
revoke all on function public.request_study_grading(uuid, uuid) from public;
revoke all on function public.get_study_grading_packet(uuid, uuid) from public;
revoke all on function public.apply_study_grading_result(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.confirm_study_grading_cards(uuid, uuid) from public;
revoke all on function public.decide_grading_card_proposal(uuid, uuid, text) from public;
revoke all on function public.record_review(
  uuid,
  uuid,
  bigint,
  smallint,
  timestamptz,
  integer,
  jsonb,
  text
) from public;
revoke all on function public.save_study_article(
  uuid,
  uuid,
  text,
  integer,
  jsonb
) from public;
revoke all on function public.import_study_workspace(uuid, jsonb) from public;
revoke all on function public.link_study_card_source(uuid, uuid, uuid, text)
  from public;

revoke all on table public.articles from anon, authenticated;
revoke all on table public.study_sessions from anon, authenticated;
revoke all on table public.responses from anon, authenticated;
revoke all on table public.annotations from anon, authenticated;
revoke all on table public.study_grading_reports from anon, authenticated;
revoke all on table public.response_grading_feedback from anon, authenticated;
revoke all on table public.annotation_grading_feedback from anon, authenticated;
revoke all on table public.grading_card_proposals from anon, authenticated;
revoke all on table public.study_cards from anon, authenticated;
revoke all on table public.study_card_sources from anon, authenticated;
revoke all on table public.study_settings from anon, authenticated;
revoke all on table public.study_review_events from anon, authenticated;

grant usage on type public.annotation_kind to authenticated;
grant usage on type public.card_kind to authenticated;

grant select on table public.articles to authenticated;
grant select on table public.study_sessions to authenticated;
grant select on table public.responses to authenticated;
grant select on table public.annotations to authenticated;
grant select on table public.study_grading_reports to authenticated;
grant select on table public.response_grading_feedback to authenticated;
grant select on table public.annotation_grading_feedback to authenticated;
grant select on table public.grading_card_proposals to authenticated;
grant select, insert on table public.study_cards to authenticated;
grant update (
  canonical_key,
  front,
  reading,
  meaning_ko,
  example_ja,
  note,
  initial_kind,
  suspended
) on table public.study_cards to authenticated;
grant select, insert, update, delete on table public.study_card_sources to authenticated;
grant select, insert, update, delete on table public.study_settings to authenticated;
grant select on table public.study_review_events to authenticated;
grant execute on function public.record_review(
  uuid,
  uuid,
  bigint,
  smallint,
  timestamptz,
  integer,
  jsonb,
  text
) to authenticated;
grant execute on function public.save_study_article(
  uuid,
  uuid,
  text,
  integer,
  jsonb
) to authenticated;
grant execute on function public.import_study_workspace(uuid, jsonb)
  to authenticated;
grant execute on function public.save_annotation_study_input(uuid, uuid, text, text)
  to authenticated;
grant execute on function public.save_study_response(uuid, text) to authenticated;
grant execute on function public.request_study_grading(uuid, uuid) to authenticated;
grant execute on function public.mark_study_grading_failed(uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.get_study_grading_packet(uuid, uuid) to service_role;
grant execute on function public.apply_study_grading_result(uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.confirm_study_grading_cards(uuid, uuid)
  to authenticated;
grant execute on function public.decide_grading_card_proposal(uuid, uuid, text)
  to authenticated;
grant execute on function public.link_study_card_source(uuid, uuid, uuid, text)
  to authenticated;

comment on function public.record_review(
  uuid,
  uuid,
  bigint,
  smallint,
  timestamptz,
  integer,
  jsonb,
  text
) is 'Atomically appends an idempotent FSRS review event and advances its card using optimistic revision control.';

comment on function public.save_study_article(
  uuid,
  uuid,
  text,
  integer,
  jsonb
) is 'Atomically saves an owned article body and validates and merges its complete annotation set.';

comment on function public.import_study_workspace(uuid, jsonb)
is 'Atomically and incrementally imports an idempotent study workspace, sharing canonical cards across article sources.';

comment on function public.normalize_study_fsrs_state(jsonb, bigint)
is 'Validates and canonicalizes an imported FSRS state for immutable history comparison.';

comment on function public.link_study_card_source(uuid, uuid, uuid, text)
is 'Idempotently links an owned canonical study card to another owned source article.';
