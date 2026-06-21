# Send shopping list to Mariano's (Kroger) — design

**Goal:** a one-tap **"Send to Mariano's"** on the weekly shopping list that pre-adds the
week's items to the family's Kroger/Mariano's cart. The user then opens Mariano's and reviews
+ checks out.

**Honest ceiling:** no public Kroger API silently places or pays for an order. The achievable
outcome is **cart-building**. The one-time Kroger account authorization (OAuth) and the final
checkout stay manual; everything in between is automated.

## Why now / how the existing stack changes the design
The original draft assumed building a backend, a token store, and an access gate from scratch.
That's mostly gone:
- **Backend:** Netlify **Functions** (`/api/kroger/*`) host the OAuth broker + Kroger API proxy.
- **Access control:** the app is already gated by **Supabase magic-link auth** — no separate
  passcode. Functions verify the caller's Supabase **session JWT** before doing anything.
- **Token storage:** a household-scoped **Supabase table** (`kroger_connection`) holds the
  Kroger access + refresh tokens, chosen store, and modality. Functions read/write it with the
  Supabase **service_role** key (server-side only) — replaces the old "Netlify Blobs/KV" idea.
- **Account model:** **one shared family Kroger account** = one Mariano's cart for the household
  (matches the existing household model).

## Architecture

```
SPA (shopping list)
  │  fetch('/api/kroger/*', Authorization: Bearer <supabase session JWT>)
  ▼
Netlify Functions  ── KROGER_CLIENT_ID/SECRET (env) ──►  api.kroger.com
  │  (verify Supabase JWT; use service_role to read/write tokens)
  ▼
Supabase: kroger_connection (1 row per household, RLS; service_role on the function side)
```

Two Kroger token lifecycles (kept separate):
- **client-credentials** (Locations, Products): no refresh token — re-request on expiry; cache ~30 min.
- **authorization-code** (Cart, `cart.basic:write`): access + refresh token; refresh on 401, retry once.

## Data model

```sql
-- supabase/migrations/0003_kroger.sql  (Phase 1)
create table public.kroger_connection (
  household_id  uuid primary key references public.households(id) on delete cascade,
  -- encrypted at rest (pgcrypto) or column-level; service_role only on the function side
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  location_id   text,          -- chosen Mariano's store
  store_name    text,
  modality      text not null default 'PICKUP',  -- 'PICKUP' | 'DELIVERY'
  connected_by  uuid references auth.users(id),
  updated_at    timestamptz not null default now()
);
alter table public.kroger_connection enable row level security;
-- Members may READ connection status (store/modality/connected?) but NOT the tokens.
-- Tokens are written/read only by functions using the service_role key (bypasses RLS).
create policy kroger_status_read on public.kroger_connection
  for select using (public.is_member(household_id));
```

> Token secrecy: the access/refresh tokens never go to the browser. The SELECT policy is for
> non-secret status fields; the client query should select only `location_id, store_name,
> modality` (never the token columns). Functions use service_role for token columns.

## Netlify Functions (`/api/kroger/*`)
Each verifies the Supabase JWT (`Authorization: Bearer`) → resolves the caller's household.

| Endpoint | Purpose |
| --- | --- |
| `GET /status` | `{ connected, storeName, modality }` (no tokens). |
| `GET /auth-url` | Build the Kroger authorize URL (`scope=cart.basic:write`, `state`). |
| `GET /callback` | Kroger redirects here → exchange `code`→tokens (Basic auth) → store → redirect to SPA. |
| `GET /locations?zip=` | Proxy Locations (client-cred) filtered to `chain=Marianos`. |
| `POST /location` | Save chosen `locationId`/`storeName`. |
| `POST /match` | Per item: Products search (client-cred, saved location) → top match + alternates. |
| `POST /cart` | `PUT /v1/cart/add` (user token, refresh-on-401), batched; returns 204. |
| `POST /sent` | Record/merge what was added (`{items}`) or reset it (`{clear:true}`); returns `sentItems`. |

## Send-history (reconcile against an un-readable cart)
The public Cart API is **add-only** — no GET (read), no DELETE (clear/remove), and the
`PUT /v1/cart/add` quantity is an *increment* (re-sending duplicates; negatives are rejected).
Reading/removing cart lines needs the **Partner Carts API** (separate approval). So MealMesh
can't see or clean the real cart. Instead it records **its own sends** per household in
`kroger_connection.sent_items` (jsonb), and uses that history to:
- **Flag duplicates** — review rows whose UPC was already sent show an "in cart" badge and
  default to *unchecked*, so re-sending a list doesn't pile up duplicates.
- **Flag removals** — previously-sent items no longer on the current list are surfaced as
  "remove in Mariano's" (we can't remove them via the API).
- **Reset** — a "Reset after checkout / Reset sent list" control clears the history (`{clear}`)
  once the user has checked out and emptied their cart.

It also surfaces the **availability** already returned by Products search: matches with no
fulfillment option show an "unavailable" badge and default to unchecked. All of this is
best-effort and keyed by UPC, since we never see the authoritative cart.

## Shopping-list → cart
- Build the match request from the **rendered list** (`buildList(normalizeForShopping(...))`,
  `[name, displayQty]`), so review rows map 1:1 to visible items. Exclude `staples` by default.
- Cart quantity is an **integer, default 1 package** per matched product (`displayQty` like
  "0.5 cup" is context only — never parsed). User can bump qty in review.
- Carry **UPC** end-to-end (cart needs UPC); drop rows without one.
- **Review-before-send** always (fuzzy matching); surface skipped/no-match items.
- **Store location metadata:** Products search (with `filter.locationId`, which we already send)
  returns `categories` (department, e.g. "Produce") and `aisleLocations[]`
  (`description`/`number`/`side`/`shelf`…). We surface a "📍 Aisle N" hint per matched row,
  falling back to the department. Coverage is partial — `aisleLocations` is often empty — so
  it's shown only when present and never gates sending.
- **Section cross-check:** `krogerSections.ts` maps Kroger's department to our shopping
  `Section` (only the confident ones — Produce/Meat/Dairy/Frozen/Bakery; ambiguous departments
  map to `null`). When the mapped section confidently differs from the section the list grouped
  an item under, the review shows a "⚠ Kroger: <section>" flag (with the list's section in the
  tooltip). Display-only — it never re-sections the list or blocks sending.
- **Persisted locations + aisle order:** matches are cached per household in
  `item_locations` (migration 0006; keyed by item name, synced through the store like
  favorites/cook-log). The shopping list shows a "📍 Aisle N / department" per item where
  known, and a **"🧭 Aisle order"** toggle (`aisleOrder.ts`) regroups the list by Kroger
  department ordered by aisle number, with un-located items falling back to their normal
  section. The toggle is disabled until a match has populated locations. Checkoff ids stay
  `"<section>:<name>"` so checked state is stable across both views.
- **Freshness + refresh:** each location stores `fetched_at` (migration 0007); the list shows
  "as of <date>" and a per-item tooltip. Locations older than `STALE_DAYS` (30) are flagged
  with a "⚠" + warn color (`isStale` in `aisleOrder.ts`). A **"↻ Refresh aisles (N stale)"**
  button re-runs the match for the current list and re-saves locations with a fresh timestamp;
  if not yet connected / no store chosen, it falls back to the guided Send flow.
- **Estimated cost:** the same match also returns the matched product's package `price`, now
  persisted with the location (migrations 0013/0014 add `price`, `product`, `quantity` to
  `item_locations`). The shopping list is the clean **in-store checklist** — two-line rows
  (name on top; muted `aisle · qty · price` below), a "~$X est." pill, and a cost bar
  (**to go / in cart / total**, split by checkoff). It's a simple per-package estimate
  (`cost.ts`, pure + tested); unmatched items are excluded from the total and counted
  ("N not priced"). The list defaults to aisle order once locations exist.
- **Mapping is separate from the checklist:** swapping the matched **product** and setting the
  **package quantity** happen in the **"Review & send"** modal (the Send-to-Mariano's review —
  product picker with images, qty, re-search). Those edits persist back to `item_locations`
  (incl. `quantity`) on close, so the checklist reflects them read-only — keeping the in-store
  view uncluttered. The quick **"Get / Update prices & aisles"** button refreshes price/aisle
  without touching a user-set quantity (field-merged; PostgREST updates only provided columns).
  Export includes per-item subtotals + an estimated total.
- **Pantry staples + "need to buy":** the source `staple` flag is inconsistent (same item
  staple in one recipe, not in another), so `staples.ts` re-derives it consistently on the
  shopping path (`normalizeForShopping`): a staple is anything in **Condiments & Spices** plus
  a curated set of baking/pantry basics. `buildList` stays faithful for the parity tests (run
  on raw recipes); the canonical flag only affects the app path. Staples are listed separately
  as **"Pantry staples — tap what you're low on"**; tapping **"Need to buy"** sets a per-plan
  `stapleNeeds` flag (rides in the plan JSONB next to `locked`, so no new table) and
  ShoppingView **promotes** that staple into its real section — so it's matched, priced,
  aisle-sorted, sendable to the cart, and checkable like any other item. A **"?" Help** modal
  (`HelpModal`) explains the whole workflow.

## UI
"🛒 Send to Mariano's" button in `ShoppingView` (next to Export/Print) → modal:
`needs-connect → (OAuth once) → pick/confirm store → review matches (swap/remove/qty) →
choose pickup/delivery → send → "Open Mariano's cart ↗" + skipped report`.

## Prerequisites (the long pole — user action)
A **Kroger Production developer app** with the right scopes:
1. Create a developer account + register an app at **developer.kroger.com/manage/apps/register**.
2. Choose the **Production** environment (vs Certification/sandbox) at registration.
3. Request scopes: `product.compact` (Products), `cart.basic:write` (Cart), and `profile.compact`
   only if we display the profile. (Locations needs no scope.)
4. Set **Redirect URI**: `https://keen-lollipop-eb4c89.netlify.app/api/kroger/callback`
   (+ a localhost one for dev).
5. Copy `CLIENT_ID` + `CLIENT_SECRET`. The **secret is genuinely sensitive** → Netlify env only
   (real secret), never the repo or the browser.

> This is the **public** Cart API (self-serve), distinct from Kroger's **Partner** Carts API
> (separate partner program/approval). Verify on the portal whether Production for the public
> Cart API is instant or needs a short review.

## Verification
- Unit tests (pure, no network): match-request shaping, product-response → review rows (UPC
  populated), cart-payload (drops no-UPC/excluded, qty default 1), token-expiry/refresh logic.
- Manual E2E (Production creds): connect once → pick store → real weekly list matches with
  prices → send → `204` → confirm items in the Mariano's cart; failure paths (401 refresh,
  no match, rate limits).

## Decisions (defaults; adjustable)
Shared family Kroger account · PICKUP default · review-before-send · qty 1/package · staples excluded.
