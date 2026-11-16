-- AI 題目先進入待審核，只有教師發布後學生才看得到。

alter table public.questions
add column if not exists status text not null default 'published',
add column if not exists source_type text not null default 'legacy',
add column if not exists generation_batch_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'questions_status_check'
      and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
    add constraint questions_status_check
    check (status in ('pending', 'published', 'unpublished', 'deleted'));
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
where status = 'published'
  and question_type = 'original';

create index if not exists questions_review_queue_idx
on public.questions (lecture_id, status, generation_batch_id)
where status <> 'deleted';

notify pgrst, 'reload schema';
