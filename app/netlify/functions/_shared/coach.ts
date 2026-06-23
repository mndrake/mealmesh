// Pure grounding logic for the step-aware coach assistant (PRD §7.3, §10; ADR 0002).
// No network, no SDK — unit-tested. The Netlify handler (coach-ask.ts) wires this to auth,
// rate limiting, and a single Claude phrasing call. Imports the SHARED content module so the
// doneness data + checkDoneness have exactly one source of truth across SPA and functions.
import {
  checkDoneness,
  getRecipeSteps,
  getTechnique,
  type DonenessVerdict,
} from "../../../src/lib/coach/content";
import type { CookStep, Technique } from "../../../src/lib/coach/types";

export type CoachIntent = "doneness" | "technique" | "medical" | "general";

export interface CoachContext {
  recipeId: string;
  stepId: string;
  question: string;
}

/** Fixed, safe response for medical questions — never model-generated (PRD R14, §10). */
export const MEDICAL_DEFLECTION =
  "I can help with cooking, but I can't give medical guidance — including anything about " +
  "medication, insulin, dosing, or how a meal will affect your blood sugar. Please talk to " +
  "your doctor or care team about those. Want a hand with the cooking step instead?";

const MEDICAL_RE =
  /\b(insulin|metformin|medication|medicine|dose|dosage|dosing|a1c|hba1c|blood ?sugar|blood ?glucose|glucose|hypo(glycemi)|hyper(glycemi)|prescrib|my (doctor|sugar|levels)|should i eat this (if|with my)|carbs? for my)\b/i;

const DONENESS_RE =
  /\b(done|ready|safe to eat|cooked through|under ?cooked|over ?cooked|raw|pink|still pink|temperature|temp|degrees?|°|how long|burnt|burned)\b/i;

const TECHNIQUE_RE = /\b(how (do|to|should)|what does|what should|technique|why (is|do)|tips?)\b/i;

/** Detect medical intent deterministically. Runs before anything else so these never reach
 *  the model. */
export function detectMedicalIntent(question: string): boolean {
  return MEDICAL_RE.test(question);
}

/** Pull a Fahrenheit reading out of free text ("it's at 155", "150 degrees", "160F"). Returns
 *  the number so checkDoneness can give a deterministic verdict. Ignores plausible non-temps. */
export function parseTempF(question: string): number | null {
  // A number with an explicit unit (°, °F, degrees, F, fahrenheit) is unambiguously a temp.
  const withUnit = question.match(/(\d{2,3})\s*(?:°\s*f?|degrees?|f\b|fahrenheit)/i);
  // Otherwise only treat a bare number as a temp if the text is clearly about temperature.
  const hasCtx = /(temp|reads?|thermometer|internal|°)/i.test(question);
  const m = withUnit ?? (hasCtx ? question.match(/(\d{2,3})/) : null);
  if (!m) return null;
  const n = Number(m[1]);
  // Cooking temps live in a sane band; reject e.g. "30 minutes".
  if (!Number.isFinite(n) || n < 80 || n > 600) return null;
  return n;
}

export function classifyIntent(question: string, step: CookStep | null): CoachIntent {
  if (detectMedicalIntent(question)) return "medical";
  if (DONENESS_RE.test(question)) return "doneness";
  // If the step is a doneness step and the user asks something vague, lean doneness.
  if (step?.doneness_food && !TECHNIQUE_RE.test(question)) return "doneness";
  if (TECHNIQUE_RE.test(question) || step?.technique_id) return "technique";
  return "general";
}

export interface Grounding {
  intent: CoachIntent;
  /** Deterministic, authoritative text the model must not contradict (doneness/technique). */
  groundingText: string;
  verdict: DonenessVerdict | null;
  technique: Technique | null;
  citation: { name: string; url: string } | null;
  /** A complete, safe answer that needs NO model (medical deflection, or doneness when the
   *  model is unavailable). */
  deterministicAnswer: string | null;
}

/** Resolve the step server-side and assemble grounding. The step's food/technique come from
 *  OUR content, never from the client — so the authoritative doneness rule can't be spoofed. */
export function buildGrounding(ctx: CoachContext): Grounding {
  const steps = getRecipeSteps(ctx.recipeId)?.steps ?? [];
  const step = steps.find((s) => s.id === ctx.stepId) ?? null;
  const intent = classifyIntent(ctx.question, step);

  if (intent === "medical") {
    return {
      intent,
      groundingText: "",
      verdict: null,
      technique: null,
      citation: null,
      deterministicAnswer: MEDICAL_DEFLECTION,
    };
  }

  if (intent === "doneness") {
    const food = step?.doneness_food ?? extractFood(ctx.question);
    const verdict = checkDoneness(food, { measuredTempF: parseTempF(ctx.question) });
    return {
      intent,
      groundingText: verdict.guidance,
      verdict,
      technique: null,
      citation: verdict.rule ? verdict.rule.source : null,
      // Doneness is safe to answer with the deterministic guidance alone if the model is down.
      deterministicAnswer: verdict.guidance,
    };
  }

  if (intent === "technique") {
    const technique = getTechnique(step?.technique_id) ?? findTechniqueByName(ctx.question);
    const groundingText = technique
      ? `${technique.name}: ${technique.definition} Stages: ${technique.stages
          .map((s) => s.action_cue)
          .join(" → ")}`
      : "";
    return {
      intent,
      groundingText,
      verdict: null,
      technique,
      citation: null,
      deterministicAnswer: null,
    };
  }

  return {
    intent: "general",
    groundingText: step ? `Current step: ${step.text}` : "",
    verdict: null,
    technique: null,
    citation: null,
    deterministicAnswer: null,
  };
}

// Best-effort food extraction from the question when the step has no doneness_food.
function extractFood(question: string): string {
  return question;
}

function findTechniqueByName(question: string): Technique | null {
  const q = question.toLowerCase();
  for (const id of ["sear", "brown_meat", "marinate", "thicken_sauce", "simmer"]) {
    const t = getTechnique(id);
    if (t && (q.includes(t.name.toLowerCase()) || q.includes(id.replace("_", " ")))) return t;
  }
  return null;
}

/** System prompt for the single phrasing call. The grounding is authoritative. */
export function coachSystemPrompt(): string {
  return [
    "You are a calm, encouraging kitchen coach for a beginner cook. Answer ONLY the current",
    "cooking step's question, in 1–3 short sentences, warm and plain-language.",
    "CRITICAL FOOD-SAFETY RULE: when GROUNDING is provided, it is authoritative. Never give a",
    "doneness/food-safety verdict that contradicts it, and never invent a temperature. If the",
    "grounding says it's not done, say so plainly and tell them to keep cooking.",
    "Do not give medical, nutrition-prescription, or dosing advice. Stick to cooking.",
  ].join(" ");
}

export function coachUserPrompt(ctx: CoachContext, g: Grounding): string {
  const parts = [`Question: ${ctx.question}`];
  if (g.groundingText) parts.push(`GROUNDING (authoritative): ${g.groundingText}`);
  return parts.join("\n\n");
}
