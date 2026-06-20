# Data model

Supabase Postgres schema for shared, per-household state. Recipes are **not** stored here —
they remain bundled in `app/src/data/recipes.json`. Tables reference recipes by their
string `id` (e.g. `"dinner-chicken-piccata"`); no foreign key to a recipes table.

## Mapping from today's `AppState`

| Today (`store.ts`) | Target |
| --- | --- |
| `activePlan: Plan` | `plans` row with `is_active = true`, `data` (JSONB = `PlanDay[]`). |
| `savedPlans: SavedPlan[]` | `plans` rows with `is_active = false`. |
| `favorites: string[]` | `favorites` rows (one per recipe id). |
| `checked: string[]` | `shopping_checkoffs` rows (one per item name, per active plan). |
| `locked: string[]` | stored inside the active plan's `data` JSONB (per-slot flag). |
| *(new)* | `cook_log` rows — which recipes were made + feedback. |

`Plan`/`PlanDay`/`MealRef` shapes are defined in
[`app/src/lib/types.ts`](../app/src/lib/types.ts) and are stored verbatim as JSONB, so the
planner/shopping logic needs no changes.

## Tables

```sql
-- Households: one per family. (Single household is fine; modeled for clarity + future-proofing.)
create table households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Membership links Supabase auth users to a household.
create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'member',  -- 'owner' | 'member'
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Invite allowlist (defense-in-depth alongside disabling public sign-ups).
create table allowed_emails (
  email        text primary key,
  household_id uuid not null references households(id) on delete cascade,
  invited_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

-- Weekly plans. Active plan has is_active = true (one per household).
create table plans (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null default 'This week',
  data         jsonb not null default '[]',     -- PlanDay[] incl. per-slot locked flag
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id)
);
create unique index one_active_plan_per_household
  on plans(household_id) where is_active;

-- Shared family favorites.
create table favorites (
  household_id uuid not null references households(id) on delete cascade,
  recipe_id    text not null,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  primary key (household_id, recipe_id)
);

-- Shopping list check-offs for the active plan (per item name), synced across devices.
create table shopping_checkoffs (
  plan_id     uuid not null references plans(id) on delete cascade,
  item_name   text not null,
  checked_by  uuid references auth.users(id),
  checked_at  timestamptz not null default now(),
  primary key (plan_id, item_name)
);

-- Cooked tracking + simple feedback. Append-only history → powers "last made / times made".
create table cook_log (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  recipe_id    text not null,
  cooked_on    date not null default current_date,
  cooked_by    uuid references auth.users(id),
  rating       smallint check (rating between 1 and 5),  -- nullable
  make_again   boolean,                                  -- nullable thumbs up/down
  notes        text,
  plan_id      uuid references plans(id) on delete set null,  -- where it was planned, if any
  created_at   timestamptz not null default now()
);
create index cook_log_household_recipe_idx on cook_log(household_id, recipe_id, cooked_on desc);
```

### Cooked-tracking queries (requirement 3)
- **Last made / times made** (for recipe cards & browser):
  ```sql
  select recipe_id, max(cooked_on) as last_made, count(*) as times_made
  from cook_log where household_id = $1 group by recipe_id;
  ```
- **Reuse over time** is the `cook_log` rows themselves (one per cooking event); the UI can
  show "made 3× — last on Jun 2" and flag recipes not cooked recently for rotation.

## Row-Level Security

Enable RLS on **every** table and scope access to the caller's household. Helper avoids
recursive policy lookups:

```sql
create or replace function public.is_member(h uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from household_members
    where household_id = h and user_id = auth.uid()
  );
$$;

alter table plans enable row level security;
create policy plans_rw on plans
  for all using (is_member(household_id)) with check (is_member(household_id));
-- Same pattern for households, household_members, favorites, allowed_emails, cook_log.

-- Tables keyed by plan_id resolve household via the parent plan:
alter table shopping_checkoffs enable row level security;
create policy checkoffs_rw on shopping_checkoffs
  for all using  (is_member((select household_id from plans where id = plan_id)))
          with check (is_member((select household_id from plans where id = plan_id)));
```

## Invite-only enforcement
Primary: **disable public sign-ups** in Supabase Auth; invite family from the dashboard
(sends a magic link). Defense-in-depth: an auth "before user created" hook (or trigger on
`auth.users`) that rejects emails not present in `allowed_emails`, then auto-creates the
`household_members` row. Details in [`security.md`](./security.md).

## Realtime
Enable Realtime on `plans`, `favorites`, and `shopping_checkoffs` so a change on one device
propagates to other logged-in devices. `cook_log` does not need Realtime (history is queried
on demand). RLS also governs which Realtime change events a client may receive.

## Migrations
Manage schema as ordered SQL files under `supabase/migrations/` (created in M1) using the
Supabase CLI (`supabase db push` / `supabase migration new`). Seed one `households` row and
the family `allowed_emails` as part of setup.
