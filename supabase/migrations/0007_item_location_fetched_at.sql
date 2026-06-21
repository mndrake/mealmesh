-- Track when an item's store location was last fetched from Kroger, so the shopping list
-- can show "aisle info as of <date>" and the data's staleness is visible. Set explicitly
-- by the client on each upsert (so it updates on conflict, unlike the insert-only default).
alter table public.item_locations
  add column if not exists fetched_at timestamptz;
