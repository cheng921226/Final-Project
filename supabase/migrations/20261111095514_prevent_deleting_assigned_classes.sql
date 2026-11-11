alter table public.users
  drop constraint users_class_id_fkey,
  add constraint users_class_id_fkey
    foreign key (class_id) references public.classes(id) on delete restrict;
