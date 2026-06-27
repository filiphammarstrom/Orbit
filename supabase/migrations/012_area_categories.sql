alter table public.areas
  add column if not exists category text not null default 'Privat';

create index if not exists areas_category_owner_idx
  on public.areas(owner_id, category);

comment on column public.areas.category is
  'User-facing grouping above areas, e.g. Privat, Bolag, Jobb.';
