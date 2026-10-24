set local lock_timeout = '5s';

alter table public.knowledge_points
  alter column start_time type integer using (
    case
      when start_time is null or btrim(start_time) = '' then null
      when btrim(start_time) ~ '^\d+(\.\d+)?$'
        then round(btrim(start_time)::numeric)::integer
      when btrim(start_time) ~ '^\d+:\d+(\.\d+)?$'
        then round(
          split_part(btrim(start_time), ':', 1)::numeric * 60
          + split_part(btrim(start_time), ':', 2)::numeric
        )::integer
      when btrim(start_time) ~ '^\d+:\d+:\d+(\.\d+)?$'
        then round(
          split_part(btrim(start_time), ':', 1)::numeric * 3600
          + split_part(btrim(start_time), ':', 2)::numeric * 60
          + split_part(btrim(start_time), ':', 3)::numeric
        )::integer
      else null
    end
  ),
  alter column end_time type integer using (
    case
      when end_time is null or btrim(end_time) = '' then null
      when btrim(end_time) ~ '^\d+(\.\d+)?$'
        then round(btrim(end_time)::numeric)::integer
      when btrim(end_time) ~ '^\d+:\d+(\.\d+)?$'
        then round(
          split_part(btrim(end_time), ':', 1)::numeric * 60
          + split_part(btrim(end_time), ':', 2)::numeric
        )::integer
      when btrim(end_time) ~ '^\d+:\d+:\d+(\.\d+)?$'
        then round(
          split_part(btrim(end_time), ':', 1)::numeric * 3600
          + split_part(btrim(end_time), ':', 2)::numeric * 60
          + split_part(btrim(end_time), ':', 3)::numeric
        )::integer
      else null
    end
  );

alter table public.knowledge_points
  add constraint knowledge_points_start_time_nonnegative
    check (start_time is null or start_time >= 0) not valid,
  add constraint knowledge_points_end_time_nonnegative
    check (end_time is null or end_time >= 0) not valid,
  add constraint knowledge_points_time_range_valid
    check (start_time is null or end_time is null or end_time >= start_time) not valid;

alter table public.knowledge_points
  validate constraint knowledge_points_start_time_nonnegative,
  validate constraint knowledge_points_end_time_nonnegative,
  validate constraint knowledge_points_time_range_valid;
