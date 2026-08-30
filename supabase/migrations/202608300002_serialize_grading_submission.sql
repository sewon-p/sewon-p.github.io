-- Keep every mutable study input on the same session-row lock used by
-- request_study_grading. This prevents a submission snapshot from racing a
-- response, article, or annotation save that has not committed yet.

create or replace function public.lock_editable_study_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_user_id uuid;
  v_grading_status text;
begin
  if tg_op = 'DELETE' then
    v_session_id := old.session_id;
    v_user_id := old.user_id;
  else
    v_session_id := new.session_id;
    v_user_id := new.user_id;
  end if;

  select session.grading_status
  into v_grading_status
  from public.study_sessions as session
  where session.id = v_session_id and session.user_id = v_user_id
  for update;

  if v_grading_status is null then
    raise exception 'Study session was not found.' using errcode = '23503';
  end if;
  if v_grading_status not in ('draft', 'failed') then
    raise exception 'Submitted study content is locked.' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.lock_editable_article_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_grading_status text;
begin
  select session.grading_status
  into v_grading_status
  from public.study_sessions as session
  where session.article_id = new.id and session.user_id = new.user_id
  for update;

  if v_grading_status is null then
    raise exception 'Article study session was not found.' using errcode = '23503';
  end if;
  if v_grading_status not in ('draft', 'failed') then
    raise exception 'Submitted study content is locked.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists responses_lock_editable_session on public.responses;
create trigger responses_lock_editable_session
before update of answer on public.responses
for each row execute function public.lock_editable_study_session();

drop trigger if exists annotations_lock_editable_session on public.annotations;
create trigger annotations_lock_editable_session
before insert or update or delete on public.annotations
for each row execute function public.lock_editable_study_session();

drop trigger if exists articles_lock_editable_session on public.articles;
create trigger articles_lock_editable_session
before update of body_text, body_revision on public.articles
for each row execute function public.lock_editable_article_session();

-- Draft annotation answers are stored outside the annotations table, so this
-- RPC takes the session lock explicitly before writing them.
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

revoke all on function public.lock_editable_study_session() from public;
revoke all on function public.lock_editable_article_session() from public;
revoke all on function public.save_annotation_study_input(uuid, uuid, text, text) from public;
grant execute on function public.save_annotation_study_input(uuid, uuid, text, text)
  to authenticated;
