begin;

set local lock_timeout = '5s';

alter table public.lectures
drop column if exists media_mime_type,
drop column if exists media_size_bytes,
drop column if exists source_file_name;

commit;
