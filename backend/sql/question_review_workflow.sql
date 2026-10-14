-- AI 題目先進入待審核，只有教師發布後學生才看得到。

alter table public.questions
add column if not exists review_status text not null default 'published',
add column if not exists source_type text not null default 'legacy',
add column if not exists generation_batch_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'questions_review_status_check'
      and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
    add constraint questions_review_status_check
    check (review_status in ('pending', 'unpublished', 'published'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'questions_source_type_check'
      and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
    add constraint questions_source_type_check
    check (source_type in ('legacy', 'ai', 'manual'));
  end if;
end $$;

create index if not exists questions_student_visible_idx
on public.questions (lecture_id, source_timestamp)
where is_active = true
  and question_type = 'original'
  and review_status = 'published';

create index if not exists questions_review_queue_idx
on public.questions (lecture_id, review_status, generation_batch_id)
where is_active = true;

notify pgrst, 'reload schema';
