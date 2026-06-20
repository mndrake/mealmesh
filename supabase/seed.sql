-- One-time seed: create the family household and the invite allowlist.
-- Run this AFTER applying 0001_init.sql and 0002_state.sql, in the Supabase
-- SQL Editor (or `supabase db push` then run this).
--
-- IMPORTANT: replace the example emails below with your real family emails BEFORE
-- running. Auth is invite-only — only emails listed here can get a working session.
-- The handle_new_user() trigger (from 0001) auto-links each allowlisted user to the
-- household on first sign-in. Safe to re-run (idempotent).

insert into public.households (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Our Family')
on conflict (id) do nothing;

insert into public.allowed_emails (email, household_id) values
  ('you@example.com',     '00000000-0000-0000-0000-000000000001'),
  ('partner@example.com', '00000000-0000-0000-0000-000000000001')
on conflict (email) do nothing;
