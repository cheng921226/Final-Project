alter table public.courses
  alter column certificate_show_score set default false;

alter table public.course_certifications
  alter column show_final_score set default false;
