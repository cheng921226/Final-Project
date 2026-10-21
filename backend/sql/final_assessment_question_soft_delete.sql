alter table public.final_assessment_questions
add column if not exists is_deleted boolean not null default false,
add column if not exists deleted_at timestamptz;

create index if not exists final_assessment_questions_visible_idx
on public.final_assessment_questions(course_id, bank_version, is_deleted, is_active);

notify pgrst, 'reload schema';
