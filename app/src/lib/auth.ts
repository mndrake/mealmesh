// Auth context, types, and the useAuth hook (M1). The provider component lives in
// auth-provider.tsx (kept separate so this module exports no components — react-refresh).
//
// useAuth() returns a safe default when used outside a provider, so components that read
// it (e.g. App's sign-out button) still render in the SSR smoke test.
import { createContext, useContext } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./supabase";

export type AuthStatus = "loading" | "unconfigured" | "signed_out" | "signed_in";

export interface AuthValue {
  status: AuthStatus;
  user: User | null;
  email: string | null;
  /** Sends a magic link to the given email. Resolves to an error message or null on success. */
  signInWithEmail: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

export const DEFAULT_AUTH: AuthValue = {
  status: isSupabaseConfigured ? "loading" : "unconfigured",
  user: null,
  email: null,
  async signInWithEmail() {
    return "Auth is not configured.";
  },
  async signOut() {},
};

export const AuthContext = createContext<AuthValue>(DEFAULT_AUTH);

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
