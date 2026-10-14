-- 題目保留三種可管理狀態；只有刪除（is_active = false）才從教師列表隱藏。

alter table public.questions
drop constraint if exists questions_review_status_check;

update public.questions
set review_status = case review_status
  when 'approved' then 'published'
  when 'rejected' then 'unpublished'
  else review_status
end;

alter table public.questions
alter column review_status set default 'published';

alter table public.questions
add constraint questions_review_status_check
check (review_status in ('pending', 'unpublished', 'published'));

drop index if exists public.questions_student_visible_idx;

create index questions_student_visible_idx
on public.questions (lecture_id, source_timestamp)
where is_active = true
  and question_type = 'original'
  and review_status = 'published';

notify pgrst, 'reload schema';
