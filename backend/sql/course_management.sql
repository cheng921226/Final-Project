alter table public.courses
add column if not exists description text;

alter table public.courses
add column if not exists status text;

update public.courses
set status = 'published'
where status is null;

alter table public.courses
alter column status set default 'draft';

alter table public.courses
alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'courses_status_check'
      and conrelid = 'public.courses'::regclass
  ) then
    alter table public.courses
    add constraint courses_status_check
    check (status in ('draft', 'published', 'archived'));
  end if;
end $$;

alter table public.courses
add column if not exists updated_at timestamptz not null default now();

alter table public.lectures
add column if not exists sort_order integer not null default 0;

alter table public.lectures
add column if not exists is_visible boolean not null default true;

alter table public.lectures
add column if not exists updated_at timestamptz not null default now();

alter table public.knowledge_points
add column if not exists is_active boolean not null default true;

with ranked as (
  select id, row_number() over (partition by course_id order by id) - 1 as position
  from public.lectures
)
update public.lectures
set sort_order = ranked.position
from ranked
where public.lectures.id = ranked.id;

create index if not exists courses_teacher_status_idx
on public.courses (teacher_id, status);

create index if not exists lectures_course_sort_idx
on public.lectures (course_id, sort_order, id);

create index if not exists knowledge_points_lecture_active_idx
on public.knowledge_points (lecture_id, is_active);
