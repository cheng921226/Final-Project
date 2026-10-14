-- 為 stu1@example.com 至 stu90@example.com 建立可重複的 Demo 學習紀錄。
-- 重跑時會重建這 90 個 Demo 帳號的學習資料，不影響其他學生。

begin;

do $$
declare
  demo_student_count integer;
begin
  select count(*) into demo_student_count
  from public.users
  where role = 'student'
    and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$';

  if demo_student_count <> 90 then
    raise exception '預期找到 90 位 Demo 學生，實際找到 % 位', demo_student_count;
  end if;
end $$;

-- 這些帳號本來就是展示帳號，因此重跑時先清除其學習紀錄，確保結果固定。
delete from public.course_certifications
where student_id in (
  select id from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
);

delete from public.final_assessment_attempts
where student_id in (
  select id from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
);

delete from public.retest_sessions
where student_id in (
  select id from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
);

delete from public.question_attempts
where student_id in (
  select id from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
);

delete from public.review_items
where student_id in (
  select id from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
);

delete from public.notes
where student_id in (
  select id from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
);

delete from public.chat_messages
where student_id in (
  select id from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
);

delete from public.learning_events
where student_id in (
  select id from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
);

delete from public.video_progresses
where student_id in (
  select id from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
);

-- 90 位 Demo 學生加入目前所有包含小節的課程。
insert into public.student_courses (student_id, course_id)
select student.id, course.id
from public.users student
cross join public.courses course
where student.role = 'student'
  and student.student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
  and exists (select 1 from public.lectures where course_id = course.id)
on conflict (student_id, course_id) do nothing;

-- 觀看進度：依學號尾數分成高參與、中等、需關注三群。
with demo_students as (
  select id, substring(student_number from 4)::integer as student_no
  from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
), ranked_lectures as (
  select l.*,
         row_number() over (partition by l.course_id order by l.sort_order, l.id) as lecture_rank,
         count(*) over (partition by l.course_id) as lecture_count
  from public.lectures l
), learning_plan as (
  select s.id as student_id, s.student_no, l.id as lecture_id, l.course_id,
         greatest(coalesce(l.duration_seconds, 600), 60) as duration_seconds,
         l.lecture_rank, l.lecture_count,
         case
           when s.student_no % 10 in (0, 1) then 1.00
           when s.student_no % 10 in (2, 3) then 0.86
           when s.student_no % 10 in (4, 5, 6, 7) then 0.62
           else 0.25
         end as completion_ratio,
         case
           when s.student_no % 10 in (0, 1, 2, 3) then 1.00
           when s.student_no % 10 in (4, 5, 6, 7) then 0.78
           else 0.38
         end as started_ratio
  from demo_students s cross join ranked_lectures l
)
insert into public.video_progresses
  (student_id, lecture_id, last_position, watched_seconds, completed, updated_at)
select student_id,
       lecture_id,
       case when lecture_rank::numeric / lecture_count <= completion_ratio
            then duration_seconds - (student_no % 17)
            else greatest(30, round(duration_seconds * (0.28 + (student_no % 4) * 0.11))::integer)
       end,
       case when lecture_rank::numeric / lecture_count <= completion_ratio
            then greatest(1, round(duration_seconds * (0.88 + (student_no % 5) * 0.02))::integer)
            else greatest(1, round(duration_seconds * (0.25 + (student_no % 4) * 0.12))::integer)
       end,
       lecture_rank::numeric / lecture_count <= completion_ratio,
       now() - make_interval(
         days => ((student_no + lecture_id) % 14)::integer,
         hours => (student_no % 12)::integer
       )
from learning_plan
where lecture_rank::numeric / lecture_count <= started_ratio;

-- 播放事件與可視化熱點。事件時間與數量採固定公式，重跑仍會得到相同分布。
with progress as (
  select vp.student_id, vp.lecture_id, vp.last_position, vp.watched_seconds,
         substring(u.student_number from 4)::integer as student_no,
         greatest(coalesce(l.duration_seconds, 600), 60) as duration_seconds,
         vp.updated_at
  from public.video_progresses vp
  join public.users u on u.id = vp.student_id
  join public.lectures l on l.id = vp.lecture_id
  where u.student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
)
insert into public.learning_events (student_id, lecture_id, event_type, event_data, created_at)
select student_id, lecture_id, 'play',
       jsonb_build_object('timestamp', 0, 'player_type', 'youtube', 'demo_seed', true),
       updated_at - interval '12 minutes'
from progress
union all
select student_id, lecture_id, 'watch_progress',
       jsonb_build_object('last_position', last_position, 'watched_seconds', watched_seconds,
                          'total_duration', duration_seconds, 'demo_seed', true),
       updated_at
from progress;

with progress as (
  select vp.student_id, vp.lecture_id,
         substring(u.student_number from 4)::integer as student_no,
         greatest(coalesce(l.duration_seconds, 600), 60) as duration_seconds,
         vp.updated_at
  from public.video_progresses vp
  join public.users u on u.id = vp.student_id
  join public.lectures l on l.id = vp.lecture_id
  where u.student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
)
insert into public.learning_events (student_id, lecture_id, event_type, event_data, created_at)
select p.student_id, p.lecture_id, 'pause',
       jsonb_build_object(
         'timestamp', least(p.duration_seconds - 1, 60 + ((p.lecture_id * 37 + n * 90) % greatest(p.duration_seconds - 60, 1))),
         'pause_count', n, 'player_type', 'youtube', 'demo_seed', true
       ),
       p.updated_at - make_interval(mins => (10 - n)::integer)
from progress p
cross join lateral generate_series(1, 1 + (p.student_no + p.lecture_id) % 4) n;

with progress as (
  select vp.student_id, vp.lecture_id,
         substring(u.student_number from 4)::integer as student_no,
         greatest(coalesce(l.duration_seconds, 600), 60) as duration_seconds,
         vp.updated_at
  from public.video_progresses vp
  join public.users u on u.id = vp.student_id
  join public.lectures l on l.id = vp.lecture_id
  where u.student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
)
insert into public.learning_events (student_id, lecture_id, event_type, event_data, created_at)
select p.student_id, p.lecture_id, 'seek',
       jsonb_build_object(
         'from', greatest(0, target_time - 35), 'to', target_time,
         'triggered_by', 'player_controls', 'player_type', 'youtube', 'demo_seed', true
       ),
       p.updated_at - make_interval(mins => (7 - n)::integer)
from progress p
cross join lateral generate_series(1, (p.student_no + p.lecture_id) % 3) n
cross join lateral (
  select least(p.duration_seconds - 1, 90 + ((p.lecture_id * 53 + n * 120) % greatest(p.duration_seconds - 90, 1))) as target_time
) timing;

-- 暫停協助與一般 AI 提問事件。
with chosen as (
  select vp.student_id, vp.lecture_id, vp.updated_at,
         substring(u.student_number from 4)::integer as student_no,
         greatest(coalesce(l.duration_seconds, 600), 60) as duration_seconds
  from public.video_progresses vp
  join public.users u on u.id = vp.student_id
  join public.lectures l on l.id = vp.lecture_id
  where u.student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
    and (substring(u.student_number from 4)::integer + vp.lecture_id) % 7 = 0
)
insert into public.learning_events (student_id, lecture_id, event_type, event_data, created_at)
select student_id, lecture_id, 'pause_help_prompt',
       jsonb_build_object('timestamp', least(duration_seconds - 1, 120), 'paused_seconds', 30, 'demo_seed', true),
       updated_at - interval '4 minutes'
from chosen
union all
select student_id, lecture_id, 'pause_help_response',
       jsonb_build_object('timestamp', least(duration_seconds - 1, 120),
                          'needs_help', student_no % 3 <> 0, 'demo_seed', true),
       updated_at - interval '3 minutes 55 seconds'
from chosen
union all
select student_id, lecture_id, 'question_asked',
       jsonb_build_object('timestamp', least(duration_seconds - 1, 120),
                          'question', '這個觀念可以再用簡單的例子說明嗎？', 'demo_seed', true),
       updated_at - interval '3 minutes 50 seconds'
from chosen
where student_no % 3 <> 0;

-- 課堂題目作答：每題使用固定但不同的答對機率，製造 0/20/40/60/80% 等錯誤率區間。
with eligible as (
  select vp.student_id, vp.lecture_id, vp.updated_at,
         substring(u.student_number from 4)::integer as student_no
  from public.video_progresses vp
  join public.users u on u.id = vp.student_id
  where u.student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
), question_pool as (
  select q.id, q.lecture_id, q.answer, coalesce(q.source_timestamp, 90) as video_time,
         case q.id % 5
           when 0 then 15
           when 1 then 35
           when 2 then 55
           when 3 then 75
           else 95
         end as correct_threshold
  from public.questions q
  where coalesce(q.is_active, true) and coalesce(q.question_type, 'original') = 'original'
)
insert into public.question_attempts
  (student_id, lecture_id, question_id, selected_answer, is_correct, video_time,
   attempt_type, attempt_number, answered_at)
select e.student_id, e.lecture_id, q.id,
       case when ((e.student_no * 17 + q.id * 11) % 100) < q.correct_threshold
            then q.answer
            else case when q.answer = 'A' then 'B' else 'A' end
       end,
       ((e.student_no * 17 + q.id * 11) % 100) < q.correct_threshold,
       q.video_time,
       'initial', 1,
       e.updated_at - make_interval(mins => (q.id % 8)::integer)
from eligible e
join question_pool q on q.lecture_id = e.lecture_id
where (e.student_no + q.id) % 4 <> 0;

-- 少量個人筆記與 AI 對話，供學生端展示。
with picked as (
  select distinct on (vp.student_id) vp.student_id, vp.lecture_id, vp.updated_at,
         substring(u.student_number from 4)::integer as student_no,
         least(greatest(coalesce(l.duration_seconds, 600), 60) - 1, 120) as video_timestamp
  from public.video_progresses vp
  join public.users u on u.id = vp.student_id
  join public.lectures l on l.id = vp.lecture_id
  where u.student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
  order by vp.student_id, vp.lecture_id
)
insert into public.notes
  (student_id, lecture_id, video_timestamp, title, content, created_at, updated_at)
select student_id, lecture_id, video_timestamp,
       'Demo 重點筆記',
       '這裡是本小節的重要觀念，之後複習時要搭配例子重新理解。',
       updated_at - interval '5 minutes', updated_at - interval '5 minutes'
from picked
where student_no % 3 = 0;

with picked as (
  select distinct on (vp.student_id) vp.student_id, vp.lecture_id, vp.updated_at,
         substring(u.student_number from 4)::integer as student_no,
         least(greatest(coalesce(l.duration_seconds, 600), 60) - 1, 120) as video_timestamp
  from public.video_progresses vp
  join public.users u on u.id = vp.student_id
  join public.lectures l on l.id = vp.lecture_id
  where u.student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
  order by vp.student_id, vp.lecture_id
)
insert into public.chat_messages
  (student_id, lecture_id, role, question, answer, video_timestamp, created_at)
select student_id, lecture_id, 'student',
       '這一段的核心概念是什麼？',
       '這一段先建立核心定義，再用實際例子說明運作方式。複習時可先抓住關鍵名詞，再確認每個步驟的輸入與輸出。',
       video_timestamp, updated_at - interval '4 minutes'
from picked
where student_no % 4 = 0;

-- 正式測驗：只有有題庫的課程產生紀錄，分數分布涵蓋通過與未通過。
with demo_students as (
  select id, substring(student_number from 4)::integer as student_no
  from public.users
  where role = 'student' and student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
), course_banks as (
  select c.id as course_id, c.passing_score,
         max(fq.bank_version) as bank_version,
         array_agg(fq.id order by fq.id) as question_ids
  from public.courses c
  join public.final_assessment_questions fq on fq.course_id = c.id and fq.is_active
  group by c.id, c.passing_score
), scored as (
  select s.id as student_id, s.student_no, b.*,
         case s.student_no % 10
           when 0 then 96 when 1 then 90 when 2 then 82 when 3 then 68
           when 4 then 86 when 5 then 76 when 6 then 64 else 55
         end as score
  from demo_students s cross join course_banks b
  where s.student_no % 10 not in (8, 9)
)
insert into public.final_assessment_attempts
  (student_id, course_id, attempt_number, passing_score, score, total_questions,
   correct_questions, passed, status, question_ids, answers_json, results_json,
   started_at, submitted_at, bank_version)
select student_id, course_id, 1, passing_score, score,
       cardinality(question_ids),
       round(cardinality(question_ids) * score / 100.0)::integer,
       score >= passing_score,
       case when score >= passing_score then 'passed' else 'failed' end,
       to_jsonb(question_ids), '{}'::jsonb, '[]'::jsonb,
       now() - make_interval(days => student_no % 12, mins => 25),
       now() - make_interval(days => student_no % 12),
       bank_version
from scored;

-- 學分證明只發給同時達到完成度與正式測驗門檻的人。
with completion as (
  select sc.student_id, sc.course_id,
         count(l.id) as lecture_count,
         count(vp.lecture_id) filter (where vp.completed) as completed_count
  from public.student_courses sc
  join public.users u on u.id = sc.student_id
  join public.lectures l on l.course_id = sc.course_id
  left join public.video_progresses vp
    on vp.student_id = sc.student_id and vp.lecture_id = l.id
  where u.student_number ~ '^STU([1-9]|[1-8][0-9]|90)$'
  group by sc.student_id, sc.course_id
), eligible as (
  select c.student_id, c.course_id, fa.id as final_attempt_id, fa.score,
         course.credit_value, course.title as course_name,
         u.name as student_name,
         coalesce(sum(vp.watched_seconds), 0) / 3600.0 as learning_hours
  from completion c
  join public.courses course on course.id = c.course_id
  join public.users u on u.id = c.student_id
  join public.final_assessment_attempts fa
    on fa.student_id = c.student_id and fa.course_id = c.course_id and fa.passed
  left join public.lectures l on l.course_id = c.course_id
  left join public.video_progresses vp
    on vp.student_id = c.student_id and vp.lecture_id = l.id
  where course.credit_value > 0
    and (100.0 * c.completed_count / nullif(c.lecture_count, 0)) >= course.completion_threshold
  group by c.student_id, c.course_id, fa.id, fa.score, course.credit_value,
           course.title, u.name
)
insert into public.course_certifications
  (student_id, course_id, credits_awarded, status, earned_at, final_attempt_id,
   learning_hours, final_score, student_name, course_name, show_final_score)
select student_id, course_id, credit_value, 'earned', now(), final_attempt_id,
       round(learning_hours::numeric, 2), score, student_name, course_name, true
from eligible;

commit;
