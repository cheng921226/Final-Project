-- lectures.status only describes whether the lecture media was uploaded.
-- AI generation progress remains in lecture_generation_status.

alter table public.lectures
drop constraint if exists lectures_status_check;

update public.lectures
set status = 'uploaded'
where status is distinct from 'uploaded';

alter table public.lectures
alter column status set default 'uploaded',
alter column status set not null;

alter table public.lectures
add constraint lectures_status_check
check (status in ('uploaded', 'failed'));

notify pgrst, 'reload schema';
