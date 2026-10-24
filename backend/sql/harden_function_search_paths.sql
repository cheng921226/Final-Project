-- Prevent object-shadowing attacks in database functions used by triggers
-- and certificate generation. All referenced application objects are already
-- schema-qualified.

alter function public.next_course_certificate_code() set search_path = '';
alter function public.set_updated_at() set search_path = '';
