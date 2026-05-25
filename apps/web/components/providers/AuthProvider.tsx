'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

interface AuthValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: { message: string } | null }>;
  signUp: (email: string, password: string) => Promise<{ error: { message: string } | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children, initialSession }: { children: ReactNode; initialSession: Session | null }) {
  const [supabase] = useState(() => createClient());
  const [session, setSession] = useState<Session | null>(initialSession);
  const [loading, setLoading] = useState(initialSession === null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error ? { message: error.message } : null };
      },
      signUp: async (email, password) => {
        const { data, error } = await supabase.auth.signUp({ email, password });
        return {
          error: error ? { message: error.message } : null,
          needsConfirmation: !error && !!data?.user && !data?.session,
        };
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, loading, supabase],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
