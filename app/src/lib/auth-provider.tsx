// AuthProvider (M1): wires Supabase auth session state into the AuthContext.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { AuthContext, DEFAULT_AUTH, type AuthStatus, type AuthValue } from "./auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(DEFAULT_AUTH.status);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return; // unconfigured: stay in that state
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? "signed_in" : "signed_out");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setStatus(next ? "signed_in" : "signed_out");
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithEmail = useCallback(async (email: string) => {
    if (!supabase) return "Auth is not configured.";
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    return error ? error.message : null;
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user: session?.user ?? null,
      email: session?.user?.email ?? null,
      signInWithEmail,
      signOut,
    }),
    [status, session, signInWithEmail, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
