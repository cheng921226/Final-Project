alter table public.users
add column if not exists student_number text;

alter table public.users
drop constraint if exists users_student_number_not_blank;

alter table public.users
add constraint users_student_number_not_blank
check (student_number is null or btrim(student_number) <> '');

create unique index if not exists users_student_number_unique_idx
on public.users (upper(student_number))
where student_number is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (name, email, role, auth_id, student_number)
  values (
    coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), new.email),
    new.email,
    'student',
    new.id,
    nullif(upper(btrim(new.raw_user_meta_data->>'student_number')), '')
  );
  return new;
end;
$$;
