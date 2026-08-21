"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export type UserRole = "patient" | "doctor" | "admin" | "asha";

const ROLES: readonly UserRole[] = ["patient", "doctor", "admin", "asha"];

interface AuthState {
  user: User | null;
  role: UserRole | null;
  userName: string;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; role: UserRole | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: null,
    userName: "",
    isLoading: true,
  });

  const supabase = createClient();

  // The role is read from the user_roles table, never from user_metadata.
  //
  // user_metadata is writable by the user it belongs to
  // (supabase.auth.updateUser), so trusting it would let any account promote
  // itself. user_roles is readable-own / writable only by service_role, and it is
  // what the RLS policies consult — so this keeps the UI and the database in
  // agreement instead of guessing.
  const resolveRole = useCallback(
    async (user: User): Promise<UserRole> => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      const fromTable = data?.role as UserRole | undefined;
      if (fromTable && ROLES.includes(fromTable)) return fromTable;

      // No row yet: fall back to the metadata hint, then to the least-privileged
      // role. Being wrong here only mis-renders navigation; RLS still decides
      // what data is reachable.
      const hint = user.user_metadata?.role as UserRole | undefined;
      return hint && ROLES.includes(hint) ? hint : "patient";
    },
    [supabase],
  );

  useEffect(() => {
    let cancelled = false;

    const apply = async (user: User | null) => {
      if (!user) {
        if (!cancelled) {
          setState({ user: null, role: null, userName: "", isLoading: false });
        }
        return;
      }
      const role = await resolveRole(user);
      if (cancelled) return;
      setState({
        user,
        role,
        userName: user.user_metadata?.name || user.email || "User",
        isLoading: false,
      });
    };

    void supabase.auth.getUser().then(({ data: { user } }) => apply(user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void apply(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [resolveRole, supabase]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return { error: error.message, role: null };
      const role = data.user ? await resolveRole(data.user) : null;
      return { error: null, role };
    },
    [supabase, resolveRole],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setState({ user: null, role: null, userName: "", isLoading: false });
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
