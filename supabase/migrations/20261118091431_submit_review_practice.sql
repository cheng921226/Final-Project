create function public.submit_review_practice(
  target_session_id bigint,
  target_student_id bigint,
  submitted_answers jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  practice public.retest_sessions%rowtype;
  results jsonb;
  correct_count integer;
  total_count integer;
  accuracy numeric;
begin
  select * into practice
  from public.retest_sessions
  where id = target_session_id and student_id = target_student_id
  for update;

  if not found then
    raise sqlstate 'PT404' using message = '找不到補充練習';
  end if;
  if practice.status <> 'in_progress' then
    raise sqlstate 'PT409' using message = '這次補充練習已送出，請重新整理複習進度。';
  end if;

  with eligible as materialized (
    select q.id, q.lecture_id, q.explanation,
      upper(left(btrim(q.answer), 1)) as correct_answer,
      submitted_answers ->> q.id::text as selected_answer
    from public.questions q
    join public.lectures l on l.id = q.lecture_id
    where l.course_id = practice.course_id
      and l.is_visible
      and q.status = 'published'
      and q.id in (
        select value::bigint from jsonb_array_elements_text(practice.question_ids)
      )
  ),
  saved as (
    insert into public.question_attempts (
      student_id, lecture_id, question_id, selected_answer, is_correct,
      attempt_type, attempt_number, retest_session_id
    )
    select target_student_id, lecture_id, id, selected_answer,
      selected_answer = correct_answer, 'retest', practice.attempt_number, practice.id
    from eligible
    where (
      select count(*) = count(selected_answer)
        and count(*) = (select count(*) from jsonb_object_keys(submitted_answers))
      from eligible
    )
    returning question_id, selected_answer, is_correct
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'question_id', saved.question_id,
      'selected_answer', saved.selected_answer,
      'correct_answer', eligible.correct_answer,
      'is_correct', saved.is_correct,
      'explanation', eligible.explanation
    )), '[]'::jsonb),
    count(*) filter (where saved.is_correct),
    count(*)
  into results, correct_count, total_count
  from saved join eligible on eligible.id = saved.question_id;

  if total_count = 0 then
    raise sqlstate 'PT409' using message = '練習題目已變更，請重新開始補充練習。';
  end if;

  accuracy := round(correct_count::numeric / total_count, 4);
  update public.retest_sessions
  set total_questions = total_count,
      correct_questions = correct_count,
      retest_accuracy = accuracy,
      status = case when correct_count::numeric / total_count >= practice.pass_threshold
        then 'passed' else 'failed' end,
      completed_at = now()
  where id = practice.id
  returning * into practice;

  return jsonb_build_object(
    'status', practice.status,
    'session', to_jsonb(practice),
    'results', results,
    'retest_accuracy', accuracy,
    'pass_threshold', practice.pass_threshold,
    'passed', practice.status = 'passed'
  );
end;
$$;

revoke all on function public.submit_review_practice(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.submit_review_practice(bigint, bigint, jsonb) to service_role;

notify pgrst, 'reload schema';
