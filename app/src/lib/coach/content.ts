// Pure Coach Mode content access + the safety-critical doneness grounding. No DOM, no React —
// imported by BOTH the SPA (Cook Mode UI) and the coach-ask Netlify function, so there is ONE
// source of truth for doneness data and ONE checkDoneness implementation (ADR 0002, PRD §10).
import type {
  BatchBlueprint,
  DonenessRule,
  RecipeSteps,
  Technique,
} from "./types";
import donenessData from "../../data/coach/doneness.json";
import techniqueData from "../../data/coach/techniques.json";
import recipeStepData from "../../data/coach/recipe-steps.json";
import blueprintData from "../../data/coach/blueprints.json";

const RULES = donenessData.rules as DonenessRule[];
const TECHNIQUES = techniqueData.techniques as Technique[];
const RECIPE_STEPS = recipeStepData.recipes as RecipeSteps[];
const BLUEPRINTS = blueprintData.blueprints as BatchBlueprint[];

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Coach content exists for this recipe (drives whether "Cook with Coach" is offered). */
export function hasCoachContent(recipeId: string): boolean {
  return RECIPE_STEPS.some((r) => r.recipe_id === recipeId);
}

export function getRecipeSteps(recipeId: string): RecipeSteps | null {
  return RECIPE_STEPS.find((r) => r.recipe_id === recipeId) ?? null;
}

export function getTechnique(id: string | undefined): Technique | null {
  if (!id) return null;
  return TECHNIQUES.find((t) => t.id === id) ?? null;
}

export function getBlueprint(id: string): BatchBlueprint | null {
  return BLUEPRINTS.find((b) => b.id === id) ?? null;
}

export function listBlueprints(): BatchBlueprint[] {
  return BLUEPRINTS;
}

/** Resolve a doneness rule by food key or any alias. Matching is normalized and substring-aware
 *  on aliases so "two chicken breasts" still resolves to the chicken rule. */
export function getDonenessRule(food: string | undefined): DonenessRule | null {
  if (!food) return null;
  const q = norm(food);
  // exact key first
  const byKey = RULES.find((r) => r.food === q);
  if (byKey) return byKey;
  // then alias contains / contained-in match
  return (
    RULES.find((r) =>
      r.aliases.some((a) => {
        const an = norm(a);
        return q === an || q.includes(an) || an.includes(q);
      })
    ) ?? null
  );
}

export interface DonenessVerdict {
  /** A verified rule was found for this food. */
  found: boolean;
  rule: DonenessRule | null;
  /** When a thermometer reading was given AND the rule has a numeric target: did it meet it?
   *  null when there's no reading or the rule is visual-only. */
  meetsTemp: boolean | null;
  /** Deterministic, safe summary built from the rule — NEVER model-generated. The assistant
   *  may rephrase this but must not contradict it. */
  guidance: string;
}

/**
 * The authoritative doneness check (PRD R11, §10). Deterministic: the verdict comes from the
 * cited rule, not from a model and not from the user's observation. The rule always wins — a
 * "looks done" observation can never flip a below-temperature reading to safe.
 */
export function checkDoneness(
  food: string | undefined,
  opts: { measuredTempF?: number | null } = {}
): DonenessVerdict {
  const rule = getDonenessRule(food);
  if (!rule) {
    return {
      found: false,
      rule: null,
      meetsTemp: null,
      guidance:
        "I don't have a verified doneness rule for that. Use a food thermometer and follow USDA " +
        "safe minimum temperatures — and when in doubt, cook it longer rather than risk undercooking.",
    };
  }

  const reading =
    typeof opts.measuredTempF === "number" && Number.isFinite(opts.measuredTempF)
      ? opts.measuredTempF
      : null;

  // Visual-only rule (no safe single temperature, e.g. shrimp).
  if (rule.pull_temp_f == null) {
    return {
      found: true,
      rule,
      meetsTemp: null,
      guidance: `${rule.no_thermometer_cue} ${rule.visual_cue}`.trim(),
    };
  }

  const restSuffix = rule.rest_minutes
    ? ` Then rest ${rule.rest_minutes} minute${rule.rest_minutes === 1 ? "" : "s"}.`
    : "";

  if (reading != null) {
    const meets = reading >= rule.pull_temp_f;
    return {
      found: true,
      rule,
      meetsTemp: meets,
      guidance: meets
        ? `${reading}°F is at or above the ${rule.pull_temp_f}°F safe minimum — it's done.${restSuffix}`
        : `${reading}°F is below the ${rule.pull_temp_f}°F safe minimum — keep cooking and check again. Do not eat it yet.`,
    };
  }

  // No reading: give the target + how to judge.
  return {
    found: true,
    rule,
    meetsTemp: null,
    guidance: `Cook to ${rule.pull_temp_f}°F internal.${restSuffix} Without a thermometer: ${rule.no_thermometer_cue}`,
  };
}
