alter table public.courses
add column if not exists credit_value numeric(6,2) not null default 0,
add column if not exists completion_threshold numeric(5,2) not null default 100,
add column if not exists passing_score numeric(5,2),
add column if not exists require_passing_score boolean not null default false,
add column if not exists certification_enabled boolean not null default true;

create table if not exists public.course_certifications (
  id bigserial primary key,
  student_id bigint not null references public.users(id) on delete cascade,
  course_id bigint not null references public.courses(id) on delete cascade,
  credits_awarded numeric(6,2) not null default 0,
  status text not null default 'earned',
  earned_at timestamptz not null default now(),
  certificate_code text,
  unique(student_id, course_id)
);

update public.course_certifications
set status = 'earned'
where status is distinct from 'earned';

alter table public.course_certifications
alter column status set default 'earned';

alter table public.course_certifications
drop constraint if exists course_certifications_status_check;

alter table public.course_certifications
add constraint course_certifications_status_check
check (status = 'earned');

create index if not exists course_certifications_student_idx
on public.course_certifications(student_id);
