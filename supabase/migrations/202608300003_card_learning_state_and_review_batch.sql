-- Add explicit card lifecycle states and make state changes go through an
-- ownership-checked RPC. The legacy suspended flag remains synchronized for
-- older clients, while lexical_data leaves room for structured dictionary
-- metadata without changing the existing card columns.

alter table public.study_cards
  add column if not exists learning_state text not null default 'active',
  add column if not exists excluded_reason text,
  add column if not exists excluded_at timestamptz,
  add column if not exists lexical_data jsonb;

update public.study_cards
set learning_state = case when suspended then 'suspended' else 'active' end
where learning_state = 'active' and suspended;

alter table public.study_cards
  drop constraint if exists study_cards_learning_state_check,
  add constraint study_cards_learning_state_check
    check (learning_state in ('active', 'suspended', 'excluded')),
  drop constraint if exists study_cards_learning_state_legacy_check,
  add constraint study_cards_learning_state_legacy_check
    check (suspended = (learning_state <> 'active')),
  drop constraint if exists study_cards_exclusion_metadata_check,
  add constraint study_cards_exclusion_metadata_check
    check (
      (
        learning_state = 'excluded'
        and excluded_at is not null
        and (
          excluded_reason is null
          or excluded_reason in ('too_basic', 'not_useful', 'duplicate', 'bad_card')
        )
      )
      or (
        learning_state <> 'excluded'
        and excluded_reason is null
        and excluded_at is null
      )
    ),
  drop constraint if exists study_cards_lexical_data_check,
  add constraint study_cards_lexical_data_check
    check (lexical_data is null or jsonb_typeof(lexical_data) = 'object');

-- Keep older security-definer import functions compatible. They still write
-- the legacy suspended column, while newer callers write learning_state.
create or replace function public.sync_study_card_learning_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.learning_state = 'excluded' then
      new.suspended := true;
    elsif new.suspended then
      new.learning_state := 'suspended';
    else
      new.learning_state := 'active';
      new.suspended := false;
    end if;
  elsif new.learning_state is distinct from old.learning_state then
    new.suspended := new.learning_state <> 'active';
  elsif new.suspended is distinct from old.suspended then
    new.learning_state := case when new.suspended then 'suspended' else 'active' end;
  end if;

  if new.learning_state = 'excluded' then
    new.excluded_at := coalesce(new.excluded_at, now());
  else
    new.excluded_reason := null;
    new.excluded_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists study_cards_sync_learning_state on public.study_cards;
create trigger study_cards_sync_learning_state
before insert or update of suspended, learning_state, excluded_reason, excluded_at
on public.study_cards
for each row execute function public.sync_study_card_learning_state();

drop index if exists public.study_cards_due_idx;
create index study_cards_due_idx
  on public.study_cards (user_id, due_at)
  where learning_state = 'active';

create or replace function public.set_study_card_learning_state(
  p_card_id uuid,
  p_learning_state text,
  p_reason text default null,
  p_expected_revision bigint default null
)
returns public.study_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_card public.study_cards%rowtype;
  v_learning_state text := lower(btrim(coalesce(p_learning_state, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_card_id is null then
    raise exception 'card_id is required.' using errcode = '22023';
  end if;

  if v_learning_state not in ('active', 'suspended', 'excluded') then
    raise exception 'learning_state must be active, suspended, or excluded.'
      using errcode = '22023';
  end if;

  if p_expected_revision is not null and p_expected_revision < 0 then
    raise exception 'expected_revision must be non-negative.' using errcode = '22023';
  end if;

  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception 'reason must not exceed 200 characters.' using errcode = '22023';
  end if;

  if v_learning_state = 'excluded'
     and v_reason is not null
     and v_reason not in ('too_basic', 'not_useful', 'duplicate', 'bad_card') then
    raise exception 'reason is not a supported exclusion reason.' using errcode = '22023';
  end if;

  select card.*
  into v_card
  from public.study_cards as card
  where card.id = p_card_id and card.user_id = v_user_id
  for update;

  if not found then
    -- Do not disclose whether a card owned by somebody else exists.
    raise exception 'Card was not found.' using errcode = '42501';
  end if;

  if p_expected_revision is not null and v_card.revision <> p_expected_revision then
    raise exception 'Card revision changed.'
      using errcode = '40001',
            detail = format(
              'Expected revision %s, current revision %s.',
              p_expected_revision,
              v_card.revision
            );
  end if;

  update public.study_cards
  set learning_state = v_learning_state,
      suspended = v_learning_state <> 'active',
      excluded_reason = case
        when v_learning_state = 'excluded' then v_reason
        else null
      end,
      excluded_at = case
        when v_learning_state = 'excluded'
          then case
            when learning_state = 'excluded' then coalesce(excluded_at, now())
            else now()
          end
        else null
      end
  where id = p_card_id and user_id = v_user_id
  returning * into v_card;

  -- FSRS revision intentionally remains unchanged. Review updates and learning
  -- state updates take the same row lock and touch disjoint columns, so a
  -- queued review is not invalidated merely because the card was excluded.
  return v_card;
end;
$$;

-- Persist a client outbox in one network request. Each item gets its own
-- subtransaction, so one conflict or malformed event does not roll back the
-- reviews that were already accepted. Array order is preserved, which matters
-- when several queued reviews advance the same card revision in sequence.
create or replace function public.record_reviews_batch(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_event jsonb;
  v_event_id text;
  v_result jsonb := '[]'::jsonb;
  v_index integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'events must be a JSON array.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_events) > 100 then
    raise exception 'A review batch may contain at most 100 events.' using errcode = '22023';
  end if;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    v_index := v_index + 1;
    v_event_id := case
      when jsonb_typeof(v_event) = 'object' then v_event ->> 'event_id'
      else null
    end;

    begin
      if jsonb_typeof(v_event) <> 'object' then
        raise exception 'event must be a JSON object.' using errcode = '22023';
      end if;

      perform public.record_review(
        (v_event ->> 'event_id')::uuid,
        (v_event ->> 'card_id')::uuid,
        (v_event ->> 'expected_revision')::bigint,
        (v_event ->> 'rating')::smallint,
        (v_event ->> 'reviewed_at')::timestamptz,
        case
          when v_event -> 'duration_ms' is null
            or v_event -> 'duration_ms' = 'null'::jsonb then null
          else (v_event ->> 'duration_ms')::integer
        end,
        v_event -> 'after_state',
        v_event ->> 'scheduler_version'
      );

      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'event_id', v_event_id,
        'ok', true
      ));
    exception when others then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'event_id', coalesce(v_event_id, format('index:%s', v_index)),
        'ok', false,
        'error', sqlerrm,
        'code', sqlstate
      ));
    end;
  end loop;

  return v_result;
end;
$$;

revoke update (suspended) on table public.study_cards from authenticated;
revoke update (learning_state, excluded_reason, excluded_at, lexical_data)
  on table public.study_cards from anon, authenticated;

revoke all on function public.sync_study_card_learning_state() from public;
revoke all on function public.set_study_card_learning_state(uuid, text, text, bigint)
  from public;
revoke all on function public.record_reviews_batch(jsonb) from public;

grant execute on function public.set_study_card_learning_state(uuid, text, text, bigint)
  to authenticated;
grant execute on function public.record_reviews_batch(jsonb) to authenticated;

comment on function public.set_study_card_learning_state(uuid, text, text, bigint)
is 'Changes an owned card lifecycle state under a row lock while preserving its independent FSRS review revision.';

comment on function public.record_reviews_batch(jsonb)
is 'Records up to 100 ordered FSRS review events with an independent success or error result for every item.';


-- A kanji is a dictionary note, but an SRS target is one reading in one
-- encounter. Keeping the reading in the canonical key lets 上|うわ and
-- 上|じょう coexist instead of freezing the first reading forever.
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

  v_canonical_key := btrim(v_proposal.front) || '|' || btrim(v_proposal.reading);
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
    reading = coalesce(nullif(excluded.reading, ''), existing_card.reading),
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

revoke all on function public.decide_grading_card_proposal(uuid, uuid, text) from public;
grant execute on function public.decide_grading_card_proposal(uuid, uuid, text)
  to authenticated;

comment on function public.decide_grading_card_proposal(uuid, uuid, text)
is 'Accepts a grading proposal and keys every review target by spelling plus reading, including kanji targets.';
