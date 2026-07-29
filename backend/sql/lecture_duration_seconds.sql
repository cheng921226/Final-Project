alter table public.lectures
add column if not exists duration_seconds integer;

alter table public.lectures
drop constraint if exists lectures_duration_seconds_nonnegative;

alter table public.lectures
add constraint lectures_duration_seconds_nonnegative
check (duration_seconds is null or duration_seconds >= 0);
