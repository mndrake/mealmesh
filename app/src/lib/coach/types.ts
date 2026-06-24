// Coach Mode content schema (PRD §8). This is a first-class, versioned content asset —
// NOT prose baked into recipes. Recipes stay read-only (src/data/recipes.json); coach content
// is keyed to them by recipe id so the bundled set is never modified.
//
// SAFETY: doneness temperatures are sourced from USDA/FoodSafety.gov and carry a citation.
// They are never model-generated. See app/src/data/coach/doneness.json.

/** Marks whether a piece of sensory/technique content is authoritative (authored & reviewed)
 *  or a scaffold placeholder still needing real authoring. Surfaced in the UI so we never
 *  present a placeholder as verified guidance. */
export type ContentStatus = "authored" | "placeholder";

export interface DonenessSource {
  name: string; // e.g. "USDA FSIS Safe Minimum Internal Temperature Chart"
  url: string;
}

/** One food's safe-doneness rule. `pull_temp_f` is the USDA safe minimum internal temp; null
 *  when the authority specifies a visual test instead of a temperature (e.g. shrimp). */
export interface DonenessRule {
  food: string; // canonical key, e.g. "chicken"
  label: string; // human label, e.g. "Chicken (any cut)"
  aliases: string[]; // match terms, e.g. ["chicken breast","chicken thigh","poultry"]
  pull_temp_f: number | null;
  rest_minutes: number;
  visual_cue: string; // what done looks like
  no_thermometer_cue: string; // how to judge without a thermometer
  safety_note?: string;
  source: DonenessSource; // REQUIRED — every temp is cited
}

/** A staged, photo-style technique walkthrough (PRD §8). */
export interface TechniqueStage {
  look: string;
  sound: string;
  smell: string;
  action_cue: string;
}

export interface Technique {
  id: string; // e.g. "sear"
  name: string;
  definition: string;
  stages: TechniqueStage[];
  content_status: ContentStatus;
}

/** Which physical station a step occupies — drives the Sunday Orchestrator's parallel tracks. */
export type Station = "stove" | "oven" | "prep" | "rest";

/** One discrete cooking step (PRD R1–R4). References doneness/technique content by key so the
 *  assistant can ground answers, rather than embedding the data. */
export interface CookStep {
  id: string;
  text: string;
  technique_id?: string; // → Technique
  doneness_food?: string; // → DonenessRule.food
  timer_seconds?: number; // inline timer (R4)
  sensory_cue?: string; // "what it looks like now" (R3)
  cue_status?: ContentStatus;
  station?: Station;
}

export interface RecipeSteps {
  recipe_id: string;
  steps: CookStep[];
}

// ---- Sunday Batch Orchestrator (PRD R7–R9) ----

export interface BatchTask {
  id: string;
  station: Station;
  text: string;
  start_minute: number; // offset from session start
  duration_minutes: number;
  recipe_id?: string;
  while_waiting?: string; // "egg bites 6 min left → chop peppers" (R8)
}

export interface BatchBlueprint {
  id: string;
  title: string;
  total_minutes: number;
  recipe_ids: string[];
  tasks: BatchTask[];
}
