set local lock_timeout = '5s';

alter table public.question_attempts
  alter column video_time type integer using (
    case
      when video_time is null then null
      else floor(video_time)::integer
    end
  );

alter table public.question_attempts
  add constraint question_attempts_video_time_nonnegative
    check (video_time is null or video_time >= 0) not valid;

alter table public.question_attempts
  validate constraint question_attempts_video_time_nonnegative;
