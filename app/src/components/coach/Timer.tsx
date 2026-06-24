import { useCallback, useEffect, useState } from "react";

function fmt(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

interface Props {
  seconds: number;
  label?: string;
  /** Persist running state under this key so backgrounding the app doesn't lose the timer. */
  persistKey?: string;
}

interface Persisted {
  endsAt: number | null; // ms epoch when running; null when paused/idle
  remaining: number; // seconds left when paused
}

/** A glanceable inline countdown (PRD R4). Wall-clock based (endsAt) so it stays accurate
 *  across re-renders and app backgrounding. Date.now() is only read in handlers/effects (never
 *  during render) to keep the component pure. */
export function Timer({ seconds, label, persistKey }: Props) {
  const storeKey = persistKey ? `mealmesh.coach.timer.${persistKey}` : null;

  const load = (): Persisted => {
    if (storeKey) {
      try {
        const raw = localStorage.getItem(storeKey);
        if (raw) return JSON.parse(raw) as Persisted;
      } catch {
        /* ignore */
      }
    }
    return { endsAt: null, remaining: seconds };
  };

  const initial = load();
  const [endsAt, setEndsAt] = useState<number | null>(initial.endsAt);
  const [remaining, setRemaining] = useState<number>(initial.remaining);

  const save = useCallback(
    (next: Persisted) => {
      if (!storeKey) return;
      try {
        localStorage.setItem(storeKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [storeKey]
  );

  // While running, recompute remaining from the wall clock (Date.now in an effect is fine).
  useEffect(() => {
    if (endsAt == null) return;
    const update = () => setRemaining(Math.max(0, (endsAt - Date.now()) / 1000));
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [endsAt]);

  const running = endsAt != null && remaining > 0;
  const done = remaining <= 0 && endsAt != null;

  function start() {
    const next = { endsAt: Date.now() + remaining * 1000, remaining };
    setEndsAt(next.endsAt);
    save(next);
  }
  function pause() {
    setEndsAt(null);
    save({ endsAt: null, remaining });
  }
  function reset() {
    setEndsAt(null);
    setRemaining(seconds);
    save({ endsAt: null, remaining: seconds });
  }

  return (
    <div className={`coach-timer${done ? " done" : ""}`} role="timer" aria-live="polite">
      <span className="coach-timer-time">{done ? "Time's up" : fmt(remaining)}</span>
      {label && !done && <span className="coach-timer-label">{label}</span>}
      <span className="spacer" />
      {!running && !done && (
        <button className="btn small" onClick={start}>
          Start
        </button>
      )}
      {running && (
        <button className="btn ghost small" onClick={pause}>
          Pause
        </button>
      )}
      <button className="btn ghost small" onClick={reset}>
        Reset
      </button>
    </div>
  );
}
