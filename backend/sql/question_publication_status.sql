-- 題目使用單一生命週期狀態；deleted 不允許直接重新發布。

alter table public.questions
drop constraint if exists questions_status_check;

update public.questions
set status = case status
  when 'approved' then 'published'
  when 'rejected' then 'unpublished'
  else status
end;

alter table public.questions
alter column status set default 'published';

alter table public.questions
add constraint questions_status_check
check (status in ('pending', 'published', 'unpublished', 'deleted'));

drop index if exists public.questions_student_visible_idx;

create index questions_student_visible_idx
on public.questions (lecture_id, source_timestamp)
where status = 'published'
  and question_type = 'original';

notify pgrst, 'reload schema';
