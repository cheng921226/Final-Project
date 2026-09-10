alter table public.courses
add column if not exists credit_value numeric(6,2) not null default 0,
add column if not exists partial_credit_enabled boolean not null default false,
add column if not exists completion_threshold numeric(5,2) not null default 100,
add column if not exists passing_score numeric(5,2),
add column if not exists require_passing_score boolean not null default false,
add column if not exists certification_enabled boolean not null default true;

create table if not exists public.course_credit_rules (
  id bigserial primary key,
  course_id bigint not null references public.courses(id) on delete cascade,
  label text,
  required_completion_percentage numeric(5,2) not null default 100,
  required_score numeric(5,2),
  credits_awarded numeric(6,2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists course_credit_rules_course_idx
on public.course_credit_rules(course_id, sort_order);

create table if not exists public.course_certifications (
  id bigserial primary key,
  student_id bigint not null references public.users(id) on delete cascade,
  course_id bigint not null references public.courses(id) on delete cascade,
  credits_awarded numeric(6,2) not null default 0,
  status text not null default 'eligible',
  earned_at timestamptz not null default now(),
  certificate_code text,
  unique(student_id, course_id)
);

create index if not exists course_certifications_student_idx
on public.course_certifications(student_id);
