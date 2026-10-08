alter table public.courses
add column if not exists created_by_user_id bigint;

-- Existing courses used teacher_id as their only ownership field. Preserve that
-- value as the best available uploader record before assignments change.
update public.courses
set created_by_user_id = teacher_id
where created_by_user_id is null;

-- A campus account is an uploader/manager, not the assigned instructor.
update public.courses as course
set teacher_id = null
from public.users as assigned
where course.teacher_id = assigned.id
  and assigned.role <> 'teacher';

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
