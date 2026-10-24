-- 智學網資料存取安全基線
-- 1. 瀏覽器持有的 publishable/anon key 不得直接讀取 public 資料表。
-- 2. 已登入使用者只可透過自己的 JWT 存取自己的私人資料。
-- 3. 題目答案、判分、證書、教師分析與 AI 產物只由可信任後端處理。

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.current_app_user_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.users
  where auth_id = (select auth.uid())
  limit 1
$$;

revoke all on function private.current_app_user_id() from public, anon;
grant execute on function private.current_app_user_id() to authenticated;

-- 清除過去過度寬鬆或重複的政策，之後只建立白名單政策。
do $$
declare
  policy_row record;
  table_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;

  for table_row in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'alter table %I.%I enable row level security',
      table_row.schemaname,
      table_row.tablename
    );
  end loop;
end
$$;

-- 不讓 publishable/anon key 直接查 public schema；公開內容由 FastAPI 明確挑選後回傳。
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

-- 先移除 authenticated 的既有廣泛權限，再逐表加入最小權限。
revoke all privileges on all tables in schema public from authenticated;
revoke all privileges on all sequences in schema public from authenticated;

grant select on public.users to authenticated;
create policy users_select_own
on public.users for select
to authenticated
using (id = (select private.current_app_user_id()));

grant select, insert, update, delete on public.notes to authenticated;
create policy notes_select_own
on public.notes for select to authenticated
using (student_id = (select private.current_app_user_id()));
create policy notes_insert_own
on public.notes for insert to authenticated
with check (student_id = (select private.current_app_user_id()));
create policy notes_update_own
on public.notes for update to authenticated
using (student_id = (select private.current_app_user_id()))
with check (student_id = (select private.current_app_user_id()));
create policy notes_delete_own
on public.notes for delete to authenticated
using (student_id = (select private.current_app_user_id()));

grant select, insert on public.learning_events to authenticated;
create policy learning_events_select_own
on public.learning_events for select to authenticated
using (student_id = (select private.current_app_user_id()));
create policy learning_events_insert_own
on public.learning_events for insert to authenticated
with check (student_id = (select private.current_app_user_id()));

grant select, insert, update on public.video_progresses to authenticated;
create policy video_progresses_select_own
on public.video_progresses for select to authenticated
using (student_id = (select private.current_app_user_id()));
create policy video_progresses_insert_own
on public.video_progresses for insert to authenticated
with check (student_id = (select private.current_app_user_id()));
create policy video_progresses_update_own
on public.video_progresses for update to authenticated
using (student_id = (select private.current_app_user_id()))
with check (student_id = (select private.current_app_user_id()));

-- 這些資料只能由可信任後端新增或判分；學生僅能讀取自己的結果。
grant select on public.question_attempts to authenticated;
create policy question_attempts_select_own
on public.question_attempts for select to authenticated
using (student_id = (select private.current_app_user_id()));

grant select on public.chat_messages to authenticated;
create policy chat_messages_select_own
on public.chat_messages for select to authenticated
using (student_id = (select private.current_app_user_id()));

grant select on public.retest_sessions to authenticated;
create policy retest_sessions_select_own
on public.retest_sessions for select to authenticated
using (student_id = (select private.current_app_user_id()));

grant select on public.question_learning_states to authenticated;
create policy question_learning_states_select_own
on public.question_learning_states for select to authenticated
using (student_id = (select private.current_app_user_id()));

grant select on public.review_items to authenticated;
create policy review_items_select_own
on public.review_items for select to authenticated
using (student_id = (select private.current_app_user_id()));

grant select on public.student_courses to authenticated;
create policy student_courses_select_own
on public.student_courses for select to authenticated
using (student_id = (select private.current_app_user_id()));

grant select on public.final_assessment_attempts to authenticated;
create policy final_assessment_attempts_select_own
on public.final_assessment_attempts for select to authenticated
using (student_id = (select private.current_app_user_id()));

grant select on public.course_certifications to authenticated;
create policy course_certifications_select_own
on public.course_certifications for select to authenticated
using (student_id = (select private.current_app_user_id()));

-- INSERT 使用 identity/serial sequence 時所需；資料列本身仍受上方 RLS 限制。
grant usage, select on all sequences in schema public to authenticated;

-- Auth 建立帳號的 trigger 仍可執行 SECURITY DEFINER 函式，API 使用者不應直接呼叫。
revoke execute on function public.handle_new_user() from public, anon, authenticated;

commit;
