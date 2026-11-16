-- Use one lifecycle column for classroom questions.
-- Existing inactive questions become soft-deleted; every other row keeps
-- its current review state.

alter table public.questions
add column status text;

update public.questions
set status = case
  when is_active = false then 'deleted'
  when review_status in ('pending', 'published', 'unpublished') then review_status
  when review_status = 'approved' then 'published'
  else 'unpublished'
end;

alter table public.questions
alter column status set default 'published',
alter column status set not null;

alter table public.questions
add constraint questions_status_check
check (status in ('pending', 'published', 'unpublished', 'deleted'));

drop index if exists public.questions_student_visible_idx;
drop index if exists public.questions_review_queue_idx;
drop index if exists public.questions_lecture_active_idx;

alter table public.questions
drop constraint if exists questions_review_status_check,
drop column review_status,
drop column is_active;

create index questions_student_visible_idx
on public.questions (lecture_id, source_timestamp)
where status = 'published'
  and question_type = 'original';

create index questions_review_queue_idx
on public.questions (lecture_id, status, generation_batch_id)
where status <> 'deleted';

create index questions_lecture_status_idx
on public.questions (lecture_id, status);

create function public.publish_pending_questions(target_lecture_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  batch_id uuid;
  published_count bigint;
begin
  -- Serialize batch publication for this lecture.
  perform 1 from public.lectures
  where id = target_lecture_id
  for no key update;

  select q.generation_batch_id into batch_id
  from public.questions q
  where q.lecture_id = target_lecture_id
    and q.question_type = 'original'
    and q.status = 'pending'
  order by q.created_at desc nulls last, q.id desc
  limit 1;

  if not found then
    return jsonb_build_object('message', 'no_pending');
  end if;
  if batch_id is null then
    return jsonb_build_object('message', 'missing_batch');
  end if;

  with published as (
    update public.questions q
    set status = 'published'
    where q.lecture_id = target_lecture_id
      and q.generation_batch_id = batch_id
      and q.status = 'pending'
    returning q.question_type
  )
  select count(*) filter (where question_type = 'original')
  into published_count
  from published;

  if published_count = 0 then
    -- Roll back the transaction if concurrent changes removed all original questions.
    raise sqlstate 'PT409' using message = '找不到可發布的待審核題目';
  end if;

  update public.questions q
  set status = 'unpublished'
  where q.lecture_id = target_lecture_id
    and q.generation_batch_id is distinct from batch_id
    and (
      q.status = 'pending'
      or (q.status = 'published' and q.source_type in ('ai', 'legacy'))
    );

  return jsonb_build_object(
    'message', 'published',
    'lecture_id', target_lecture_id,
    'generation_batch_id', batch_id,
    'published_count', published_count
  );
end;
$$;

revoke all on function public.publish_pending_questions(bigint) from public, anon, authenticated;
grant execute on function public.publish_pending_questions(bigint) to service_role;

notify pgrst, 'reload schema';
