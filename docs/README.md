# MealMesh Documentation

Planning and architecture docs for evolving MealMesh from a single-user, local
(localStorage-only) app into a **Netlify-hosted, multi-device, shared single-family
app** with logins, synced state, and recipe-history tracking.

## Target capabilities
1. **Netlify hosting** with enough security for a shared single-family app.
2. **Synced state** — plan a week on one device, have another family member log in on
   another device and see it.
3. **Cooked tracking** — record which recipes were made, capture simple feedback, and
   see if/when recipes were reused.

## Confirmed decisions
- **Backend/auth:** Supabase (Postgres + Auth + Row-Level Security + Realtime).
- **Login:** Magic link, invite-only (allowlisted family emails).
- See [`adr/0001-backend-platform-and-auth.md`](./adr/0001-backend-platform-and-auth.md).

## Index
| Doc | What it covers |
| --- | --- |
| [`architecture.md`](./architecture.md) | Current vs. target architecture, components, data flow, deployment topology, how the existing client-side store is reused. |
| [`data-model.md`](./data-model.md) | Supabase schema (tables, RLS policies, helper functions), mapping from today's `AppState`, migration of existing localStorage data. |
| [`security.md`](./security.md) | Auth + invite-only model, RLS, Netlify security headers, secrets handling, threat notes. |
| [`roadmap.md`](./roadmap.md) | Milestones M0–M4 with scope, key tasks, files touched, and acceptance criteria. |
| [`adr/`](./adr/) | Architecture Decision Records. |

## How to use these docs
Work milestone by milestone in [`roadmap.md`](./roadmap.md). Each milestone is sized to
ship independently and leave `main` deployable. The data model and security docs are the
reference specs the milestones implement against.
