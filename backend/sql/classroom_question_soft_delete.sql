alter table public.questions
add column if not exists status text not null default 'published';

create index if not exists questions_lecture_status_idx
on public.questions (lecture_id, status);
