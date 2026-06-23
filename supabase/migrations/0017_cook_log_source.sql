-- Coach Mode instrumentation (PRD §5 North Star, R6). Tag where a cook event came from so we
-- can distinguish a guided Cook-Mode completion ("started → finished & eaten") from a manual
-- "mark as made". Nullable + additive: existing rows and the manual flow are unaffected.
-- Values today: 'cook_mode' (finished via Cook Mode) or null (manual / legacy).
alter table public.cook_log add column if not exists source text;
