-- M2 — Cloud state & multi-device sync: plans, favorites, shopping check-offs.
-- Builds on M1 (households, household_members, allowed_emails, public.is_member()).
-- RLS scopes every row to the caller's household. Realtime is enabled so a change on
-- one device propagates to other logged-in family devices. See docs/data-model.md.
-- Apply with `supabase db push`. (cook_log is intentionally deferred to M3.)

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Weekly plans. The active plan has is_active = true (one per household); saved
-- plans are is_active = false. `data` is the plan JSONB: { days: PlanDay[], locked: string[] }.
create table if not exists public.plans (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null default 'This week',
  data         jsonb not null default '{"days": [], "locked": []}',
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id)
);

-- At most one active plan per household.
create unique index if not exists one_active_plan_per_household
  on public.plans(household_id) where is_active;

-- Shared family favorites (one row per recipe id).
create table if not exists public.favorites (
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id    text not null,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  primary key (household_id, recipe_id)
);

-- Shopping-list check-offs for a plan (per item name), synced across devices.
create table if not exists public.shopping_checkoffs (
  plan_id     uuid not null references public.plans(id) on delete cascade,
  item_name   text not null,
  checked_by  uuid references auth.users(id),
  checked_at  timestamptz not null default now(),
  primary key (plan_id, item_name)
);

-- ---------------------------------------------------------------------------
-- Row-Level Security (default-deny; members of the household get access)
-- ---------------------------------------------------------------------------
alter table public.plans              enable row level security;
alter table public.favorites          enable row level security;
alter table public.shopping_checkoffs enable row level security;

create policy plans_member_rw on public.plans
  for all using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy favorites_member_rw on public.favorites
  for all using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Check-offs resolve their household through the parent plan.
create policy checkoffs_member_rw on public.shopping_checkoffs
  for all
  using      (public.is_member((select household_id from public.plans where id = plan_id)))
  with check (public.is_member((select household_id from public.plans where id = plan_id)));

-- ---------------------------------------------------------------------------
-- updated_at maintenance for plans
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists plans_touch_updated_at on public.plans;
create trigger plans_touch_updated_at
  before update on public.plans
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Realtime: publish row changes so other logged-in devices receive them.
-- (RLS still governs which change events each client may see.)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.plans;
alter publication supabase_realtime add table public.favorites;
alter publication supabase_realtime add table public.shopping_checkoffs;
