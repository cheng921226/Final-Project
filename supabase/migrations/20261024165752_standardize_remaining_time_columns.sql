set local lock_timeout = '5s';

alter table public.questions
  drop column if exists start_time,
  drop column if exists end_time;

alter table public.questions
  add constraint questions_source_timestamp_nonnegative
    check (source_timestamp is null or source_timestamp >= 0) not valid;

alter table public.chat_messages
  add constraint chat_messages_video_timestamp_nonnegative
    check (video_timestamp >= 0) not valid;

alter table public.notes
  add constraint notes_video_timestamp_nonnegative
    check (video_timestamp >= 0) not valid;

alter table public.questions
  validate constraint questions_source_timestamp_nonnegative;

alter table public.chat_messages
  validate constraint chat_messages_video_timestamp_nonnegative;

alter table public.notes
  validate constraint notes_video_timestamp_nonnegative;
