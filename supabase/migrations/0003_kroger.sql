-- M5 Phase 1 — Kroger connection: one row per household holding the OAuth tokens and
-- the chosen Mariano's store. Backend-only by design: RLS is enabled with NO policies,
-- so anon/authenticated clients get zero access. Only the Netlify functions touch this
-- table, using the Supabase service_role key (which bypasses RLS); they return only
-- sanitized status ({connected, storeName, modality}) to the browser — never the tokens.
create table if not exists public.kroger_connection (
  household_id  uuid primary key references public.households(id) on delete cascade,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  location_id   text,
  store_name    text,
  modality      text not null default 'PICKUP',   -- 'PICKUP' | 'DELIVERY'
  connected_by  uuid references auth.users(id),
  updated_at    timestamptz not null default now()
);

alter table public.kroger_connection enable row level security;
-- Intentionally NO policies → default-deny for anon/authenticated. service_role bypasses RLS.

drop trigger if exists kroger_connection_touch on public.kroger_connection;
create trigger kroger_connection_touch
  before update on public.kroger_connection
  for each row execute function public.touch_updated_at();

-- Short-lived CSRF state for the OAuth handshake. /auth-url (authenticated) inserts a
-- random state mapped to the caller's household; /callback (hit by Kroger's redirect,
-- which carries no auth header) consumes + deletes it to learn the household securely.
-- Backend-only: RLS on, no policies (service_role only).
create table if not exists public.kroger_oauth_state (
  state        text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
alter table public.kroger_oauth_state enable row level security;
