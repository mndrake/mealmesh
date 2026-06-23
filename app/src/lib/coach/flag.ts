// Coach Mode feature flag. OFF by default so merging Coach work to main never changes the
// live family app — it only appears once VITE_COACH_MODE is set in the Netlify/site env.
export function coachEnabled(): boolean {
  const v = import.meta.env.VITE_COACH_MODE;
  return v === "1" || v === "true";
}
