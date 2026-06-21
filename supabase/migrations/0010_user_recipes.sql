-- Imported recipes. Unlike the bundled read-only recipe set (recipe-repo → recipes.json),
-- these are mutable, per-household recipes the user imports (by URL) at runtime. The whole
-- Recipe object is stored as JSONB so the app can treat imported and bundled recipes
-- identically once merged (see app/src/lib/allRecipes.ts). Household-scoped via RLS like
-- the rest of the synced state; Realtime so an import on one device appears on the others.
create table if not exists public.user_recipes (
  id           text primary key,                      -- the Recipe.id (a "u-…" uuid)
  household_id uuid not null references public.households(id) on delete cascade,
  data         jsonb not null,                        -- the full Recipe object
  source_url   text,                                  -- where it was imported from (dedupe/reference)
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists user_recipes_household_idx
  on public.user_recipes(household_id, created_at desc);

alter table public.user_recipes enable row level security;

create policy user_recipes_member_rw on public.user_recipes
  for all using (public.is_member(household_id)) with check (public.is_member(household_id));

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_recipes'
  ) then
    alter publication supabase_realtime add table public.user_recipes;
  end if;
end $$;
