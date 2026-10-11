-- YouTube backup, duplicate prevention, and durable AI pipeline status.
-- Run once in the Supabase SQL editor.

alter table public.lectures
add column if not exists youtube_video_id text,
add column if not exists source_file_hash text,
add column if not exists backup_status text not null default 'not_requested',
add column if not exists backup_storage_path text,
add column if not exists backup_error text,
add column if not exists backup_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lectures_backup_status_check'
      and conrelid = 'public.lectures'::regclass
  ) then
    alter table public.lectures add constraint lectures_backup_status_check
    check (backup_status in ('not_requested', 'pending', 'processing', 'completed', 'failed'));
  end if;
end $$;

create unique index if not exists lectures_course_youtube_video_uidx
on public.lectures (course_id, youtube_video_id)
where youtube_video_id is not null;

create unique index if not exists lectures_course_source_hash_uidx
on public.lectures (course_id, source_file_hash)
where source_file_hash is not null;

create table if not exists public.lecture_generation_status (
  lecture_id bigint not null references public.lectures(id) on delete cascade,
  component text not null,
  status text not null default 'pending',
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (lecture_id, component),
  constraint lecture_generation_component_check
    check (component in ('transcript', 'summary', 'knowledge_points', 'mindmap', 'questions')),
  constraint lecture_generation_status_check
    check (status in ('pending', 'processing', 'completed', 'failed'))
);

create index if not exists lecture_generation_status_lookup_idx
on public.lecture_generation_status (lecture_id, status);

create or replace function public.claim_lecture_generation(
  p_lecture_id bigint,
  p_component text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.lecture_generation_status (
    lecture_id, component, status, error_message, started_at, completed_at, updated_at
  ) values (
    p_lecture_id, p_component, 'processing', null, now(), null, now()
  )
  on conflict (lecture_id, component) do update
  set status = 'processing',
      error_message = null,
      started_at = now(),
      completed_at = null,
      updated_at = now()
  where lecture_generation_status.status <> 'processing'
     or lecture_generation_status.updated_at < now() - interval '10 minutes';

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.claim_lecture_generation(bigint, text) from public, anon, authenticated;
grant execute on function public.claim_lecture_generation(bigint, text) to service_role;

create or replace function public.claim_lecture_backup(
  p_lecture_id bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.lectures
  set backup_status = 'pending',
      backup_error = null,
      backup_updated_at = now(),
      updated_at = now()
  where id = p_lecture_id
    and (
      backup_status not in ('pending', 'processing')
      or backup_updated_at is null
      or backup_updated_at < now() - interval '30 minutes'
    );
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.claim_lecture_backup(bigint) from public, anon, authenticated;
grant execute on function public.claim_lecture_backup(bigint) to service_role;

-- Private bucket: playback is provided by short-lived signed URLs from FastAPI.
insert into storage.buckets (id, name, public)
values ('lecture-video-backups', 'lecture-video-backups', false)
on conflict (id) do update set public = false;
