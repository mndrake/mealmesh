// Coach Mode instrumentation helpers (PRD §5 North Star). Pure derivations over the existing
// cook_log — no parallel tracking system. These give the completion-event numerator; the
// session-start denominator (true completion *rate*) is a documented follow-up.
import type { CookEvent } from "../types";

/** Cook events that came from finishing a guided Cook Mode session. */
export function cookModeCompletions(cookLog: CookEvent[]): CookEvent[] {
  return cookLog.filter((e) => e.source === "cook_mode");
}

/** How many guided cooks have been completed (the North Star numerator). */
export function cookModeCompletionCount(cookLog: CookEvent[]): number {
  return cookModeCompletions(cookLog).length;
}
