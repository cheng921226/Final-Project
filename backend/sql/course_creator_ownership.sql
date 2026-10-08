alter table public.courses
add column if not exists created_by_user_id bigint;

-- Existing courses used teacher_id as their only ownership field. Preserve that
-- value as the best available uploader record before assignments change.
update public.courses
set created_by_user_id = teacher_id
where created_by_user_id is null;

-- Platform uploads default to the same campus account as instructor. The
-- platform can later reassign the course to a teacher account.
update public.courses as course
set teacher_id = course.created_by_user_id
from public.users as creator
where course.created_by_user_id = creator.id
  and creator.role = 'campus'
  and course.teacher_id is null;

alter table public.courses
alter column created_by_user_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'courses_created_by_user_id_fkey'
      and conrelid = 'public.courses'::regclass
  ) then
    alter table public.courses
    add constraint courses_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.users(id) on delete restrict;
  end if;
end $$;

create index if not exists courses_creator_status_idx
on public.courses (created_by_user_id, status);
