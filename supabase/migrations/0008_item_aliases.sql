-- Per-household search aliases for shopping items: when a recipe ingredient name doesn't
-- match a Kroger product (e.g. "broken tortilla chips"), the user can search an alternative
-- term ("tortilla chips") and we remember it here so future matches use the better term.
-- Keyed by item name like item_locations. Household-scoped via RLS.
create table if not exists public.item_aliases (
  household_id uuid not null references public.households(id) on delete cascade,
  item_name    text not null,
  search_term  text not null,
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  primary key (household_id, item_name)
);

alter table public.item_aliases enable row level security;

create policy item_aliases_member_rw on public.item_aliases
  for all using (public.is_member(household_id)) with check (public.is_member(household_id));
