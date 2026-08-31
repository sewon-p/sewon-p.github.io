-- Upgrade the workspace importer after the lifecycle and lexical columns from
-- 202608300003 are already present in production. This retains all validation,
-- idempotency, source merging, grading, and immutable review-history behavior
-- of the original importer while preserving richer card records.

-- Preserve card IDs and review history while upgrading unambiguous legacy
-- kanji identities. If a reading-specific card already exists, keep both rows
-- untouched rather than attempting a destructive history merge.
update public.study_cards as card
set canonical_key = btrim(card.front) || '|' || coalesce(btrim(card.reading), '')
where card.kind = 'kanji'
  and card.canonical_key = btrim(card.front)
  and not exists (
    select 1
    from public.study_cards as reading_card
    where reading_card.user_id = card.user_id
      and reading_card.kind = card.kind
      and reading_card.id <> card.id
      and reading_card.canonical_key = btrim(card.front)
        || '|' || coalesce(btrim(card.reading), '')
  );

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
  v_input_canonical_key text;
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
  v_learning_state text;
  v_excluded_reason text;
  v_excluded_at timestamptz;
  v_lexical_data jsonb;
  v_card_front text;
  v_card_reading text;
  v_has_learning_state boolean;
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

    v_card_front := nullif(btrim(v_card_json ->> 'front'), '');
    v_card_reading := nullif(btrim(v_card_json ->> 'reading'), '');
    v_input_canonical_key := nullif(btrim(v_card_json ->> 'canonical_key'), '');
    v_import_key := v_input_canonical_key;

    if v_card_front is null
       or (v_kind = 'kanji' and char_length(v_card_front) <> 1) then
      raise exception 'Imported card front is invalid.' using errcode = '22023';
    end if;

    -- A single character may have several article-specific readings. New
    -- kanji cards therefore use the same front|reading identity as word cards.
    if v_kind = 'kanji' then
      v_import_key := v_card_front || '|' || coalesce(v_card_reading, '');
    elsif v_import_key is null then
      raise exception 'Imported card canonical key is required.' using errcode = '22023';
    end if;

    begin
      v_has_learning_state := (v_card_json ? 'learning_state')
        and nullif(btrim(v_card_json ->> 'learning_state'), '') is not null;
      v_learning_state := lower(nullif(btrim(v_card_json ->> 'learning_state'), ''));
      if v_learning_state is null then
        v_learning_state := case
          when coalesce((v_card_json ->> 'suspended')::boolean, false)
            then 'suspended'
          else 'active'
        end;
      end if;
      v_excluded_at := case
        when nullif(v_card_json ->> 'excluded_at', '') is null then null
        else (v_card_json ->> 'excluded_at')::timestamptz
      end;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception 'Imported card lifecycle metadata is invalid.'
          using errcode = '22023';
    end;

    v_excluded_reason := nullif(btrim(v_card_json ->> 'excluded_reason'), '');
    if v_learning_state not in ('active', 'suspended', 'excluded')
       or (
         v_excluded_reason is not null
         and v_excluded_reason not in ('too_basic', 'not_useful', 'duplicate', 'bad_card')
       ) then
      raise exception 'Imported card learning state is invalid.' using errcode = '22023';
    end if;
    if v_learning_state <> 'excluded' then
      v_excluded_reason := null;
      v_excluded_at := null;
    end if;

    v_lexical_data := case
      when not (v_card_json ? 'lexical_data')
        or jsonb_typeof(v_card_json -> 'lexical_data') = 'null' then null
      else v_card_json -> 'lexical_data'
    end;
    if v_lexical_data is not null and jsonb_typeof(v_lexical_data) <> 'object' then
      raise exception 'Imported card lexical_data must be an object.'
        using errcode = '22023';
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
      and (
        card.canonical_key = v_import_key
        or (
          v_kind = 'kanji'
          and card.canonical_key = v_card_front
          and card.front = v_card_front
          and nullif(btrim(card.reading), '') is not distinct from v_card_reading
        )
      )
    order by
      (card.canonical_key = v_input_canonical_key) desc nulls last,
      (card.canonical_key = v_import_key) desc,
      card.created_at,
      card.id
    limit 1
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
        learning_state,
        excluded_reason,
        excluded_at,
        lexical_data,
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
        v_card_front,
        v_card_reading,
        nullif(v_card_json ->> 'meaning_ko', ''),
        nullif(v_card_json ->> 'example_ja', ''),
        v_initial_kind,
        v_learning_state <> 'active',
        v_learning_state,
        case when v_learning_state = 'excluded' then v_excluded_reason else null end,
        case
          when v_learning_state = 'excluded' then coalesce(v_excluded_at, now())
          else null
        end,
        v_lexical_data,
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
    else
      -- Importing a remote export is idempotent, but richer dictionary data
      -- and lifecycle choices should not be discarded on the exact retry.
      update public.study_cards as card
      set canonical_key = case
            when exists (
              select 1
              from public.study_cards as conflicting_card
              where conflicting_card.user_id = card.user_id
                and conflicting_card.kind = card.kind
                and conflicting_card.id <> card.id
                and conflicting_card.canonical_key = v_import_key
            ) then card.canonical_key
            else v_import_key
          end,
          front = card.front,
          reading = coalesce(card.reading, v_card_reading),
          meaning_ko = coalesce(card.meaning_ko, nullif(v_card_json ->> 'meaning_ko', '')),
          example_ja = coalesce(card.example_ja, nullif(v_card_json ->> 'example_ja', '')),
          initial_kind = coalesce(card.initial_kind, v_initial_kind),
          suspended = case
            when v_has_learning_state then v_learning_state <> 'active'
            else card.suspended
          end,
          learning_state = case
            when v_has_learning_state then v_learning_state
            else card.learning_state
          end,
          excluded_reason = case
            when not v_has_learning_state then card.excluded_reason
            when v_learning_state = 'excluded'
              then coalesce(v_excluded_reason, card.excluded_reason)
            else null
          end,
          excluded_at = case
            when not v_has_learning_state then card.excluded_at
            when v_learning_state = 'excluded'
              then coalesce(v_excluded_at, card.excluded_at, now())
            else null
          end,
          lexical_data = coalesce(card.lexical_data, v_lexical_data)
      where card.id = v_card_id and card.user_id = v_user_id
      returning * into v_existing_card;
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
        -- Remote exports carry the created card ID as the card import key.
        -- Resolve that identity first so a legacy kanji row and a newer
        -- reading-specific row can coexist without moving the proposal.
        v_source_item_key := coalesce(
          nullif(v_source_json ->> 'createdCardId', ''),
          nullif(v_source_json ->> 'created_card_id', '')
        );
        if v_source_item_key is not null and v_card_map ? v_source_item_key then
          select card.id into v_card_id
          from public.study_cards as card
          where card.id = (v_card_map -> v_source_item_key ->> 'card_id')::uuid
            and card.user_id = v_user_id
            and card.kind = v_proposal_kind;
        end if;

        v_import_key := btrim(v_source_json ->> 'front')
          || '|' || coalesce(btrim(v_source_json ->> 'reading'), '');
        if v_card_id is null then
          select card.id into v_card_id from public.study_cards as card
          where card.user_id = v_user_id and card.kind = v_proposal_kind
            and (
              card.canonical_key = v_import_key
              or (
                v_proposal_kind = 'kanji'
                and card.canonical_key = btrim(v_source_json ->> 'front')
                and nullif(btrim(card.reading), '') is not distinct from
                  nullif(btrim(v_source_json ->> 'reading'), '')
              )
            )
          order by (card.canonical_key = v_import_key) desc, card.created_at, card.id
          limit 1;
        end if;
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

revoke all on function public.import_study_workspace(uuid, jsonb) from public;
grant execute on function public.import_study_workspace(uuid, jsonb)
  to authenticated;

comment on function public.import_study_workspace(uuid, jsonb)
is 'Atomically imports a study workspace, preserving lexical metadata, explicit learning states, and front|reading kanji identities.';
