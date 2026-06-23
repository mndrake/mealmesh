# ADR 0002 — Coach assistant: single-round, server-grounded (not a streaming multi-turn loop)

**Status:** Accepted · **Date:** 2026-06-23 · **Context:** Coach Mode (PRD §9, R10–R13)

## Problem

The PRD's step-aware assistant (R13) calls for SSE streaming and a multi-turn tool-use loop.
The existing agent layer is the opposite shape: single-shot `messages.parse` calls
(`_shared/anthropic.ts`) deliberately kept small to fit **Netlify's ~10s synchronous function
timeout** — the recent recipe-gen 502 (`3bf4b0b`) was exactly this limit. A long, open-ended
tool-use loop risks the same timeout, and client-direct streaming to `api.anthropic.com` would
require loosening the app's strict CSP (`connect-src 'self' + *.supabase.co`).

## Decision

Build the assistant as a **single-round, server-grounded** call:

1. The `coach-ask` Netlify function receives the current context (`recipe_id`, `step_id`,
   food, the step's doneness target) plus the user's question.
2. Grounding tools (`check_doneness`, `explain_technique`) are executed **in our code as
   deterministic lookups** over the cited content asset — the model does **not** choose the
   rule or the temperature. For doneness, the authoritative verdict comes from the data; the
   model only *phrases* it and interprets the user's observation against it.
3. One `messages.parse` call produces the worded response, with a system instruction that the
   returned rule is authoritative and must never be contradicted (rule overrides observation,
   PRD §10). Intent is classified the same round; medical intent returns a fixed deflection
   without a model food-safety verdict.

This fits the 10s window (one call, like recipe-gen), keeps CSP unchanged (same-origin
`/api/coach/ask`), and makes the one-unshippable-error (a wrong "it's done") structurally
impossible to hallucinate — the temp is data, not generation.

## Consequences

- **SSE streaming (R13) is deferred**, not abandoned. It's a latency nicety; perceived latency
  is acceptable for a short grounded answer. Revisit with Netlify streaming functions if user
  testing shows the wait hurts. Tracked as fast-follow.
- Multi-turn conversational follow-ups ("and after that?") are out of MVP scope; each Ask is a
  fresh grounded turn carrying the step context. Acceptable for the panic-button use case.
- Grounding correctness is unit-testable as pure functions, independent of the model.

## Checkpoint surfaced to owner

This resolves the PRD's top technical risk on the buildable path **without** a live Netlify
streaming spike (which would need a deploy + key). If product later requires true streaming
multi-turn coaching, that's a separate, larger investment — flagged here so the decision is
explicit, not implicit.
