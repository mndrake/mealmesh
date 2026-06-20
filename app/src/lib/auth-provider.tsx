// AuthProvider (M1, extended in M2): wires Supabase auth session into AuthContext, and
// bridges the session to the store — on sign-in it resolves the household and connects the
// cloud-backed store; on sign-out it disconnects (store falls back to the local cache).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { AuthContext, DEFAULT_AUTH, type AuthStatus, type AuthValue } from "./auth";
import { connect, disconnect } from "./store";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(DEFAULT_AUTH.status);
  const [session, setSession] = useState<Session | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);

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

  // Bridge auth -> store: connect on sign-in (after resolving the household), disconnect otherwise.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    (async () => {
      if (!userId) {
        await disconnect();
        if (active) setHouseholdId(null);
        return;
      }
      const { data, error } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (!active) return;
      const hh = (data?.household_id as string | undefined) ?? null;
      if (error) console.warn("[auth] household lookup failed:", error.message);
      setHouseholdId(hh);
      if (hh) await connect(supabase!, hh, userId);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

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
      householdId,
      signInWithEmail,
      signOut,
    }),
    [status, session, householdId, signInWithEmail, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
