# ADR 0001 — Backend platform and authentication

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Project owner

## Context
MealMesh is a static, client-side, single-user app (localStorage only). We need to host it on
Netlify with enough security for a **shared single-family** app, sync state across devices
(plan on one device, view on another after login), and track cooked recipes with feedback.
This requires authentication, a shared persistent datastore, and cross-device sync.

## Decision
1. **Backend: Supabase** (Postgres + Auth + Row-Level Security + Realtime). The frontend
   stays a static SPA on **Netlify** and talks to Supabase directly using the publishable
   anon key; RLS enforces access control server-side.
2. **Authentication: magic link, invite-only.** Family members sign in with a one-time
   emailed link (no passwords). Public sign-ups are disabled; access is limited to an
   allowlist of family emails (dashboard invites + an allowlist hook as defense-in-depth).

## Alternatives considered
- **Firebase (Firestore + Auth):** capable, but the NoSQL document model fits the relational
  plan/history data less naturally, and security rules are harder to reason about than SQL RLS.
- **Netlify-native (Identity + Functions + DB):** Netlify Identity is in maintenance mode with
  an uncertain future, and stitching in a separate DB adds moving parts to maintain.
- **Stay localStorage-only:** cannot meet the multi-device/shared requirement.

## Consequences
- **Positive:** No server to operate; relational data + RLS match the domain; built-in
  Realtime delivers the cross-device requirement; generous free tier suits one family; the
  existing `useStore`/`actions` seam lets us swap persistence with minimal component churn.
- **Tradeoffs:** Adds Supabase as a managed dependency and an auth flow; the anon key is
  public (acceptable — security rests on RLS, not key secrecy); requires disciplined secret
  handling (`service_role` key must never reach the client).

## See also
[`../architecture.md`](../architecture.md), [`../data-model.md`](../data-model.md),
[`../security.md`](../security.md), [`../roadmap.md`](../roadmap.md).
