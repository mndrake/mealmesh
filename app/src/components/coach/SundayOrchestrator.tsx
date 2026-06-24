import { useCallback, useEffect, useState } from "react";
import type { BatchBlueprint, Station } from "../../lib/coach/types";
import { Timer } from "./Timer";

const STATION_ORDER: Station[] = ["prep", "stove", "oven", "rest"];
const STATION_LABEL: Record<Station, string> = {
  prep: "🔪 Prep",
  stove: "🍳 Stove",
  oven: "🔥 Oven",
  rest: "⏸ Rest / hold",
};

interface Props {
  blueprint: BatchBlueprint;
  onClose: () => void;
}

/** Sunday Batch Orchestrator (PRD §7.2, R7–R9): parallel-track timeline with live timers and
 *  a checklist that survives backgrounding (persisted to localStorage). Static — no AI. */
export function SundayOrchestrator({ blueprint, onClose }: Props) {
  const storeKey = `mealmesh.coach.orch.${blueprint.id}`;

  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      /* ignore */
    }
    return {};
  });

  const toggle = useCallback(
    (id: string) => {
      setDone((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        try {
          localStorage.setItem(storeKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [storeKey]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doneCount = blueprint.tasks.filter((t) => done[t.id]).length;
  const stationsUsed = STATION_ORDER.filter((s) =>
    blueprint.tasks.some((t) => t.station === s)
  );

  return (
    <div className="coach-fs">
      <div className="coach-fs-bar">
        <button className="btn ghost small" onClick={onClose}>
          ✕ Close
        </button>
        <span className="coach-fs-title">{blueprint.title}</span>
        <span className="spacer" />
        <span className="muted">
          {doneCount}/{blueprint.tasks.length} done · ~{blueprint.total_minutes} min
        </span>
      </div>

      <div className="coach-orch">
        {stationsUsed.map((station) => {
          const tasks = blueprint.tasks
            .filter((t) => t.station === station)
            .sort((a, b) => a.start_minute - b.start_minute);
          return (
            <div className="coach-track" key={station}>
              <div className="coach-track-head">{STATION_LABEL[station]}</div>
              <div className="coach-track-tasks">
                {tasks.map((t) => (
                  <div
                    className={`coach-task${done[t.id] ? " is-done" : ""}`}
                    key={t.id}
                  >
                    <label className="coach-task-main">
                      <input
                        type="checkbox"
                        checked={!!done[t.id]}
                        onChange={() => toggle(t.id)}
                      />
                      <span>
                        <span className="coach-task-when">
                          {t.start_minute}–{t.start_minute + t.duration_minutes} min
                        </span>
                        <span className="coach-task-text">{t.text}</span>
                      </span>
                    </label>
                    {t.while_waiting && (
                      <p className="coach-task-wait">⏳ {t.while_waiting}</p>
                    )}
                    {!done[t.id] && (
                      <Timer
                        seconds={t.duration_minutes * 60}
                        persistKey={`${blueprint.id}.${t.id}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
