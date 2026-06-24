import { useState } from "react";
import type { CookStep } from "../../lib/coach/types";
import { askCoach, type CoachAnswer } from "../../lib/coach/coachClient";

interface Props {
  recipeId: string;
  step: CookStep;
  onClose: () => void;
}

const SUGGESTIONS = ["Is this done?", "How do I do this step?", "What should it look like?"];

/** The "panic button" panel (PRD R5). Sends the current step context + question to coach-ask
 *  and shows the grounded answer with its citation. */
export function CoachAskPanel({ recipeId, step, onClose }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<CoachAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await askCoach({ recipeId, stepId: step.id, question: text }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal coach-ask-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2>🆘 Ask the coach</h2>
        <p className="muted">About this step — doneness, technique, or what to look for.</p>

        <div className="row coach-ask-suggestions" style={{ gap: 6, flexWrap: "wrap" }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => ask(s)} disabled={loading}>
              {s}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(q);
          }}
        >
          <textarea
            className="coach-ask-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. It's at 150°F, is the chicken done?"
            rows={2}
          />
          <button className="btn" type="submit" disabled={loading || !q.trim()}>
            {loading ? "Asking…" : "Ask"}
          </button>
        </form>

        {error && <p className="coach-safety">⚠️ {error}</p>}

        {answer && (
          <div className={`coach-answer${answer.kind === "doneness" ? " is-doneness" : ""}`}>
            <p>{answer.answer}</p>
            {answer.citation && (
              <a
                className="coach-cite"
                href={answer.citation.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Source: {answer.citation.name}
              </a>
            )}
            <p className="coach-ask-disclaimer muted">
              Cooking guidance only — not medical or dietary advice.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
