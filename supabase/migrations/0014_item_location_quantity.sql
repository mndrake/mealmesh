-- Persist the per-item package quantity (how many to buy) alongside the cached price/aisle.
-- Set in the "Review & send" mapping step and read by the shopping-list cost estimate.
-- Separate from 0013 because that migration was already applied: `supabase db push` skips
-- versions it has recorded, so a new column must be its own migration to actually run.
alter table public.item_locations
  add column if not exists quantity integer default 1;  -- packages to buy (default 1)
