alter table public.questions
add column if not exists is_active boolean not null default true;

create index if not exists questions_lecture_active_idx
on public.questions (lecture_id, is_active);
