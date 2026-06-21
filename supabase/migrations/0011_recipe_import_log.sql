-- Per-household rate limiting for the recipe-import endpoint. One row per import attempt;
-- the function counts rows in a rolling window before allowing another (protects the
-- Anthropic spend and guards against fetch abuse). Only the service role writes here
-- (the function); members may read their own household's events. Old rows are pruned
-- opportunistically by the function, so this table stays tiny.
create table if not exists public.recipe_import_log (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index if not exists recipe_import_log_household_time_idx
  on public.recipe_import_log(household_id, created_at desc);

alter table public.recipe_import_log enable row level security;

-- Read-only for members; inserts/deletes go through the service role (bypasses RLS).
create policy recipe_import_log_member_ro on public.recipe_import_log
  for select using (public.is_member(household_id));
