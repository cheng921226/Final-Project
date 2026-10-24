begin;

set local lock_timeout = '5s';

alter table public.courses
drop column if exists partial_credit_enabled;

commit;
