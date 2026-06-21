-- M5 follow-up — per-household cache of where a shopping-list item lives in the store,
-- learned from the Kroger Products match (aisle / department). Keyed by item name so it
-- persists week to week and lets the shopping list organize by store aisle and show
-- location info while shopping. Household-scoped via RLS like the rest of M2.
create table if not exists public.item_locations (
  household_id uuid not null references public.households(id) on delete cascade,
  item_name    text not null,
  aisle        text,            -- "Aisle 35"
  aisle_number smallint,        -- 35 (for ordering)
  department   text,            -- "Produce" (Kroger section)
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  primary key (household_id, item_name)
);

alter table public.item_locations enable row level security;

create policy item_locations_member_rw on public.item_locations
  for all using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Realtime so a match on one device organizes the list on the others.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'item_locations'
  ) then
    alter publication supabase_realtime add table public.item_locations;
  end if;
end $$;
