delete from public.mindmaps
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by lecture_id
        order by created_at desc nulls last, id desc
      ) as duplicate_number
    from public.mindmaps
    where lecture_id is not null
  ) ranked
  where duplicate_number > 1
);

delete from public.summaries
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by lecture_id
        order by created_at desc nulls last, id desc
      ) as duplicate_number
    from public.summaries
    where lecture_id is not null
  ) ranked
  where duplicate_number > 1
);

delete from public.transcripts
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by lecture_id
        order by created_at desc nulls last, id desc
      ) as duplicate_number
    from public.transcripts
    where lecture_id is not null
  ) ranked
  where duplicate_number > 1
);

alter table public.mindmaps
add constraint mindmaps_lecture_id_key unique (lecture_id);

alter table public.summaries
add constraint summaries_lecture_id_key unique (lecture_id);

alter table public.transcripts
add constraint transcripts_lecture_id_key unique (lecture_id);
