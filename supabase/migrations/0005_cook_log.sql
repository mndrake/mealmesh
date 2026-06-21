-- M3 — Cooked tracking & feedback. Append-only history of which recipes were made,
-- with optional quick feedback (thumbs / 1–5 rating / note). Powers "made N× · last on …"
-- on recipe cards and a History view. Household-scoped via RLS like the rest of M2.
-- See docs/data-model.md → "Cooked-tracking queries".
create table if not exists public.cook_log (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id    text not null,
  cooked_on    date not null default current_date,
  cooked_by    uuid references auth.users(id),
  rating       smallint check (rating between 1 and 5),  -- nullable
  make_again   boolean,                                  -- nullable thumbs up/down
  notes        text,
  plan_id      uuid references public.plans(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists cook_log_household_recipe_idx
  on public.cook_log(household_id, recipe_id, cooked_on desc);

alter table public.cook_log enable row level security;

create policy cook_log_member_rw on public.cook_log
  for all using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Realtime so a "mark made" on one device updates history on the others. RLS still
-- governs which change events each client receives.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cook_log'
  ) then
    alter publication supabase_realtime add table public.cook_log;
  end if;
end $$;
