// Browser-side client for the recipe-import function. Carries the user's Supabase session
// JWT so the function can authorize + resolve the household. The function does the page
// fetch + extraction server-side and returns a draft Recipe to review (it is not saved
// until the user confirms — store.addUserRecipe does that).
import type { Recipe } from "./types";
import { supabase } from "./supabase";

export interface ImportResult {
  recipe: Recipe;
  via: "jsonld" | "ai";
}

async function authHeaders(): Promise<Record<string, string>> {
  const res = await supabase?.auth.getSession();
  const token = res?.data.session?.access_token;
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** Import a recipe from a URL. Throws an Error (with a readable message) on failure. */
export async function importRecipe(url: string): Promise<ImportResult> {
  const res = await fetch("/api/recipes/import", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ url }),
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
  return body as unknown as ImportResult;
}
