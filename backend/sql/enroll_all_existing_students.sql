insert into public.student_courses (student_id, course_id)
select users.id, courses.id
from public.users
cross join public.courses
where users.role = 'student'
on conflict (student_id, course_id) do nothing;
