// Browser-side client for the coach-ask function (PRD §7.3). Carries the Supabase session JWT
// so the function can authorize + rate-limit per household. The function grounds + phrases the
// answer server-side; this just sends the step context and the question.
import { supabase } from "../supabase";

export interface CoachAnswer {
  kind: "doneness" | "technique" | "general" | "medical";
  answer: string;
  citation?: { name: string; url: string } | null;
  deflected?: boolean;
}

async function authHeaders(): Promise<Record<string, string>> {
  const res = await supabase?.auth.getSession();
  const token = res?.data.session?.access_token;
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** Ask the step-aware coach. Throws an Error with a readable message on failure. */
export async function askCoach(input: {
  recipeId: string;
  stepId: string;
  question: string;
}): Promise<CoachAnswer> {
  const res = await fetch("/api/coach/ask", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server error (${res.status})`);
  }
  if (!res.ok) {
    const detail = body.detail ? `: ${String(body.detail)}` : "";
    throw new Error(`${String(body.error ?? `HTTP ${res.status}`)}${detail}`);
  }
  return body as unknown as CoachAnswer;
}
