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

export type UserRole = "patient" | "doctor" | "admin";

interface AuthState {
  user: User | null;
  role: UserRole | null;
  userName: string;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
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

  // Check for existing session on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const role = (user.user_metadata?.role as UserRole) || "patient";
        const name = user.user_metadata?.name || user.email || "User";
        setState({
          user,
          role,
          userName: name,
          isLoading: false,
        });
      } else {
        setState((s) => ({ ...s, isLoading: false }));
      }
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const role = (session.user.user_metadata?.role as UserRole) || "patient";
        const name = session.user.user_metadata?.name || session.user.email || "User";
        setState({
          user: session.user,
          role,
          userName: name,
          isLoading: false,
        });
      } else {
        setState({ user: null, role: null, userName: "", isLoading: false });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      return { error: null };
    },
    [supabase]
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
