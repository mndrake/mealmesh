-- M1 — Auth & access control: households, membership, invite allowlist, RLS.
-- See docs/data-model.md and docs/security.md. Apply with `supabase db push`.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'member',  -- 'owner' | 'member'
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Invite allowlist (defense-in-depth alongside disabling public sign-ups).
create table if not exists public.allowed_emails (
  email        text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  invited_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Membership helper (avoids recursive policy lookups). SECURITY DEFINER with a
-- fixed search_path so policies can call it safely.
-- ---------------------------------------------------------------------------
create or replace function public.is_member(h uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = h and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security (default-deny; members of the household get access)
-- ---------------------------------------------------------------------------
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.allowed_emails    enable row level security;

create policy households_member_rw on public.households
  for all using (public.is_member(id)) with check (public.is_member(id));

-- A member can see their own membership rows for households they belong to.
create policy members_member_rw on public.household_members
  for all using (public.is_member(household_id)) with check (public.is_member(household_id));

create policy allowed_emails_member_rw on public.allowed_emails
  for all using (public.is_member(household_id)) with check (public.is_member(household_id));

-- ---------------------------------------------------------------------------
-- Invite-only enforcement: when a new auth user is created, reject emails that
-- are not on the allowlist; otherwise auto-link them to the household.
-- (Primary control is still "disable public sign-ups" in Auth settings; this is
--  defense-in-depth and also wires up membership for dashboard-invited users.)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hh uuid;
begin
  select household_id into hh from public.allowed_emails where email = new.email;
  if hh is null then
    raise exception 'Email % is not on the family allowlist', new.email;
  end if;

  insert into public.household_members (household_id, user_id)
  values (hh, new.id)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Seed (edit, uncomment, and run once for your family):
--   insert into public.households (id, name)
--     values ('00000000-0000-0000-0000-000000000001', 'Our Family');
--   insert into public.allowed_emails (email, household_id) values
--     ('parent1@example.com', '00000000-0000-0000-0000-000000000001'),
--     ('parent2@example.com', '00000000-0000-0000-0000-000000000001');
-- ---------------------------------------------------------------------------
