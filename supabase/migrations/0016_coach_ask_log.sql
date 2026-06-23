-- Per-household rate limiting for the Coach assistant ("panic button", PRD §7.3). Mirrors
-- recipe_import_log but on its own budget so in-the-moment cooking questions don't starve the
-- recipe import/generate budget (and vice versa). One row per ask; the coach-ask function
-- counts rows in a rolling window before allowing another (protects Anthropic spend). Only the
-- service role writes here; members may read their own household's events. Old rows are pruned
-- opportunistically by the function, so this table stays tiny.
create table if not exists public.coach_ask_log (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index if not exists coach_ask_log_household_time_idx
  on public.coach_ask_log(household_id, created_at desc);

alter table public.coach_ask_log enable row level security;

-- Read-only for members; inserts/deletes go through the service role (bypasses RLS).
create policy coach_ask_log_member_ro on public.coach_ask_log
  for select using (public.is_member(household_id));
