import { useEffect, useState } from "react";
import type { Recipe } from "../../lib/types";
import { getDonenessRule, getRecipeSteps, getTechnique } from "../../lib/coach/content";
import { Timer } from "./Timer";
import { CoachAskPanel } from "./CoachAskPanel";

interface Props {
  recipe: Recipe;
  onClose: () => void;
  /** Called when the user answers the end-of-recipe "did you finish?" prompt (PRD R6). */
  onFinish?: (finished: boolean) => void;
}

/** Full-screen, one-step-at-a-time guided cooking (PRD §7.1, R1–R6) with the step-aware Ask
 *  panel (R5). */
export function CookMode({ recipe, onClose, onFinish }: Props) {
  const steps = getRecipeSteps(recipe.id)?.steps ?? [];
  const [i, setI] = useState(0);
  const [showFinish, setShowFinish] = useState(false);
  const [showTechnique, setShowTechnique] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Collapse the technique disclosure whenever we move to another step.
  const goto = (n: number) => {
    setI(Math.max(0, Math.min(steps.length - 1, n)));
    setShowTechnique(false);
  };

  if (steps.length === 0) {
    return (
      <div className="coach-fs">
        <div className="coach-fs-bar">
          <button className="btn ghost small" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div className="coach-step-body">
          <p className="muted">No guided steps are available for this recipe yet.</p>
        </div>
      </div>
    );
  }

  const step = steps[i];
  const last = i === steps.length - 1;
  const rule = getDonenessRule(step.doneness_food);
  const technique = getTechnique(step.technique_id);

  return (
    <div className="coach-fs">
      <div className="coach-fs-bar">
        <button className="btn ghost small" onClick={onClose} aria-label="Close Cook Mode">
          ✕ Close
        </button>
        <span className="coach-fs-title">{recipe.title}</span>
        <span className="spacer" />
        <span className="muted">
          Step {i + 1} of {steps.length}
        </span>
      </div>

      <div className="coach-progress" aria-hidden>
        <div
          className="coach-progress-fill"
          style={{ width: `${((i + 1) / steps.length) * 100}%` }}
        />
      </div>

      <div className="coach-step-body">
        <p className="coach-step-text">{step.text}</p>

        {rule && (
          <div className="coach-doneness">
            <div className="coach-doneness-temp">
              {rule.pull_temp_f != null ? `${rule.pull_temp_f}°F` : "Visual check"}
            </div>
            <div className="coach-doneness-detail">
              <strong>{rule.label} — when is it done?</strong>
              <p>{rule.visual_cue}</p>
              <p className="muted">No thermometer? {rule.no_thermometer_cue}</p>
              {rule.safety_note && <p className="coach-safety">⚠️ {rule.safety_note}</p>}
              <a
                className="coach-cite"
                href={rule.source.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Source: {rule.source.name}
              </a>
            </div>
          </div>
        )}

        {step.sensory_cue && (
          <div className="coach-cue">
            <span className="coach-cue-eye">👁</span>
            <span>
              {step.sensory_cue}
              {step.cue_status === "placeholder" && (
                <span className="coach-placeholder"> (draft cue)</span>
              )}
            </span>
          </div>
        )}

        {step.timer_seconds && (
          <Timer
            seconds={step.timer_seconds}
            label="for this step"
            persistKey={`${recipe.id}.${step.id}`}
          />
        )}

        {technique && (
          <div className="coach-technique">
            <button
              className="btn ghost small"
              onClick={() => setShowTechnique((s) => !s)}
              aria-expanded={showTechnique}
            >
              {showTechnique ? "▾" : "▸"} How to: {technique.name}
              {technique.content_status === "placeholder" && (
                <span className="coach-placeholder"> (draft)</span>
              )}
            </button>
            {showTechnique && (
              <div className="coach-technique-body">
                <p className="muted">{technique.definition}</p>
                <ol>
                  {technique.stages.map((st, k) => (
                    <li key={k}>
                      <strong>{st.action_cue}</strong>
                      <span className="muted">
                        {[st.look, st.sound, st.smell]
                          .filter((x) => x && x !== "—")
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="coach-fs-nav">
        <button className="btn ghost" onClick={() => goto(i - 1)} disabled={i === 0}>
          ← Back
        </button>
        <button className="btn secondary coach-ask" onClick={() => setAsking(true)}>
          🆘 Ask
        </button>
        <span className="spacer" />
        {!last ? (
          <button className="btn" onClick={() => goto(i + 1)}>
            Next →
          </button>
        ) : (
          <button className="btn" onClick={() => setShowFinish(true)}>
            Done cooking
          </button>
        )}
      </div>

      {asking && (
        <CoachAskPanel recipeId={recipe.id} step={step} onClose={() => setAsking(false)} />
      )}

      {showFinish && (
        <div className="overlay" onClick={() => setShowFinish(false)}>
          <div className="modal coach-finish" onClick={(e) => e.stopPropagation()}>
            <h2>Did you finish this dish?</h2>
            <p className="muted">
              This helps track which recipes actually get made — no judgment either way.
            </p>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button
                className="btn"
                onClick={() => {
                  onFinish?.(true);
                  onClose();
                }}
              >
                ✅ Yes, finished &amp; eaten
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  onFinish?.(false);
                  onClose();
                }}
              >
                Not this time
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
