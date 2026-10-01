-- Teacher-managed course final assessment question bank.
-- Run after final_assessment_and_certificates.sql.

alter table public.final_assessment_questions
add column if not exists source_type text not null default 'ai',
add column if not exists source_question_id bigint references public.questions(id) on delete set null,
add column if not exists knowledge_point_id bigint references public.knowledge_points(id) on delete set null,
add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'final_assessment_questions_source_type_check'
      and conrelid = 'public.final_assessment_questions'::regclass
  ) then
    alter table public.final_assessment_questions
    add constraint final_assessment_questions_source_type_check
    check (source_type in ('ai', 'manual', 'in_lecture'));
  end if;
end $$;

alter table public.final_assessment_attempts
add column if not exists bank_version integer;

update public.final_assessment_attempts as attempt
set bank_version = (
  select max(question.bank_version)
  from jsonb_array_elements_text(attempt.question_ids) as question_id(value)
  join public.final_assessment_questions as question
    on question.id = question_id.value::bigint
)
where attempt.bank_version is null;

create index if not exists final_assessment_questions_source_question_idx
on public.final_assessment_questions(source_question_id);

create index if not exists final_assessment_attempts_bank_version_idx
on public.final_assessment_attempts(course_id, bank_version);

notify pgrst, 'reload schema';
