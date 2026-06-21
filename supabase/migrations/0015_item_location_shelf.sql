-- Capture finer in-store placement (bay / shelf / side within the aisle) from the Kroger
-- match, for the aisle→shelf→bin "Store mode" shopping view. All optional — Kroger's
-- aisleLocations coverage is partial, so these are frequently null.
alter table public.item_locations
  add column if not exists bay   text,   -- bay number within the aisle
  add column if not exists shelf text,   -- shelf number
  add column if not exists side  text;   -- aisle side, e.g. "L" / "R"
