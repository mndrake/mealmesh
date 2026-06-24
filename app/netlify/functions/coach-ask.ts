// POST /api/coach/ask — authed. Body: { recipeId, stepId, question }. The step-aware coach
// "panic button" (PRD §7.3, ADR 0002). Single-round and server-grounded: medical intent is
// deflected without the model; doneness/technique answers are grounded in OUR cited content
// (checkDoneness is authoritative); one short Haiku call only PHRASES the grounded answer. If
// Claude is unavailable, the safety-critical doneness path still works from the deterministic
// grounding text.
import { getUser, householdIdFor, checkCoachRateLimit } from "./_shared/supa";
import { hasClaude, phraseCoachAnswer } from "./_shared/anthropic";
import {
  buildGrounding,
  coachSystemPrompt,
  coachUserPrompt,
  MEDICAL_DEFLECTION,
  type CoachContext,
} from "./_shared/coach";
import { json } from "./_shared/http";

const LIMIT = 60; // generous: this is the in-the-moment cooking helper
const WINDOW_MS = 60 * 60 * 1000; // rolling hour
const MAX_Q = 500;

export default async (req: Request): Promise<Response> => {
  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const householdId = await householdIdFor(user.id);
  if (!householdId) return json({ error: "no household" }, 403);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const recipeId = typeof body.recipeId === "string" ? body.recipeId : "";
  const stepId = typeof body.stepId === "string" ? body.stepId : "";
  const question = (typeof body.question === "string" ? body.question : "").trim().slice(0, MAX_Q);
  if (!question) return json({ error: "missing question" }, 400);

  const ctx: CoachContext = { recipeId, stepId, question };
  const g = buildGrounding(ctx);

  // Medical questions never reach the model and don't consume the AI budget.
  if (g.intent === "medical") {
    return json({ kind: "medical", answer: MEDICAL_DEFLECTION, deflected: true });
  }

  // Rate limit before any Claude spend.
  const rl = await checkCoachRateLimit(householdId, LIMIT, WINDOW_MS);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({
        error: "rate_limited",
        detail: `Lots of questions just now — try again in about ${Math.ceil(rl.retryAfterSec / 60)} min.`,
      }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": String(rl.retryAfterSec) } }
    );
  }

  let answer: string;
  if (hasClaude(process.env)) {
    try {
      answer = await phraseCoachAnswer(process.env, coachSystemPrompt(), coachUserPrompt(ctx, g));
    } catch {
      // Never fail the safety path on a model error — fall back to the deterministic grounding.
      answer =
        g.deterministicAnswer ??
        "I couldn't reach the assistant just now. Follow the recipe step, and when in doubt about " +
          "doneness, use a thermometer and cook a bit longer rather than risk undercooking.";
    }
  } else {
    answer =
      g.deterministicAnswer ??
      "The cooking assistant isn't configured on this server, so I can't answer free-form " +
        "questions — but the step's doneness target and timer above still apply.";
  }

  return json({ kind: g.intent, answer, citation: g.citation });
};
