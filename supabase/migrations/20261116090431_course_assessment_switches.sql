alter table public.courses
  add column timed_questions_enabled boolean not null default true,
  add column final_assessment_enabled boolean not null default true;
