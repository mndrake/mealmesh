-- M5 Phase 2 — Send-history for the Kroger cart. The public Cart API is write-only (it
-- can't read or clear the cart), so MealMesh records what IT added per household. The
-- review step uses this to flag duplicates ("already in cart") and removals (sent items
-- no longer on the list), and to let the user reset the record after they check out.
-- Backend-only like the rest of the table: RLS stays on with no policies; only the
-- Netlify functions (service_role) read/write it, returning sanitized status to the SPA.
alter table public.kroger_connection
  add column if not exists sent_items jsonb not null default '[]'::jsonb;
