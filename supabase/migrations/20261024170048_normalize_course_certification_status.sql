-- A certificate row is created only after the student has earned it.
-- Keep the status column for API compatibility, but make that invariant explicit.
update public.course_certifications
set status = 'earned'
where status is distinct from 'earned';

alter table public.course_certifications
alter column status set default 'earned';

alter table public.course_certifications
drop constraint if exists course_certifications_status_check;

alter table public.course_certifications
add constraint course_certifications_status_check
check (status = 'earned');

comment on column public.course_certifications.status is
'Certificate lifecycle status. A row exists only after the certificate is earned.';
