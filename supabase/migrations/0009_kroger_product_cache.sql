-- Cache Kroger Products matches per household + item so opening the shopping/Send flow
-- doesn't re-hit the Kroger API every time — we only re-search items whose cache is
-- missing or stale (or when the user forces a refresh). Cache is per store location.
create table if not exists public.kroger_product_cache (
  household_id uuid not null references public.households(id) on delete cascade,
  item_name    text not null,
  location_id  text not null,
  data         jsonb not null,   -- { matched: ProductMatch|null, alternates: ProductMatch[] }
  fetched_at   timestamptz not null default now(),
  primary key (household_id, item_name)
);

alter table public.kroger_product_cache enable row level security;

create policy kroger_product_cache_member_rw on public.kroger_product_cache
  for all using (public.is_member(household_id)) with check (public.is_member(household_id));
