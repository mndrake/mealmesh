-- Persist the matched Kroger price (and product name) alongside the cached aisle/department
-- for each shopping item, so the shopping list can show an estimated cost and organize by
-- aisle from one "update prices & aisles" fetch — without re-hitting the Kroger API on every
-- open. Price is per package; staleness is tracked by the existing fetched_at.
alter table public.item_locations
  add column if not exists price   numeric,   -- per-package price at the chosen store
  add column if not exists product text;      -- matched product description (what was priced)
