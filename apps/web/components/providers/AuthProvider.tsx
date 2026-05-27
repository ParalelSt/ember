'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/pocketbase/client';

/** Minimal user shape exposed to the app — matches the old Supabase one
 *  closely enough that consumers don't care which backend produced it. */
export interface AuthUser {
  id: string;
  email: string;
}

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: { message: string } | null }>;
  signUp: (email: string, password: string) => Promise<{ error: { message: string } | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children, initialUser }: { children: ReactNode; initialUser: AuthUser | null }) {
  const [pb] = useState(() => createClient());
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [loading, setLoading] = useState(initialUser === null);

  useEffect(() => {
    // Sync local user state with the SDK on every auth change. The SDK
    // already syncs to document.cookie via the client wrapper.
    const unsub = pb.authStore.onChange(() => {
      const record = pb.authStore.record;
      setUser(record ? { id: record.id, email: String(record.email ?? '') } : null);
      setLoading(false);
    });

    // If we mounted without an initial user, attempt a token refresh so a
    // stale-but-valid cookie can rehydrate the session without a re-login.
    if (!initialUser && pb.authStore.isValid) {
      pb.collection('users').authRefresh().catch(() => pb.authStore.clear()).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }

    return () => { unsub(); };
  }, [pb, initialUser]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      signIn: async (email, password) => {
        try {
          await pb.collection('users').authWithPassword(email, password);
          return { error: null };
        } catch (e) {
          return { error: { message: extractPbError(e) } };
        }
      },
      signUp: async (email, password) => {
        try {
          await pb.collection('users').create({ email, password, passwordConfirm: password });
          // PocketBase doesn't gate on email verification out of the box —
          // sign the user straight in. If you enable "require verified" in
          // the admin UI, swap this for a verification flow.
          await pb.collection('users').authWithPassword(email, password);
          return { error: null, needsConfirmation: false };
        } catch (e) {
          return { error: { message: extractPbError(e) }, needsConfirmation: false };
        }
      },
      signOut: async () => {
        pb.authStore.clear();
      },
    }),
    [pb, user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Pulls the actual reason out of a PocketBase ClientResponseError. The
 *  top-level `.message` is a generic "Something went wrong" — the useful
 *  per-field info lives in `.data.<field>.message`. */
function extractPbError(e: unknown): string {
  if (!e || typeof e !== 'object') return 'Unexpected error';
  const err = e as { message?: string; data?: Record<string, { message?: string }> };
  const fieldMsgs = Object.entries(err.data ?? {})
    .map(([field, info]) => info?.message ? `${field}: ${info.message}` : null)
    .filter(Boolean)
    .join(' · ');
  return fieldMsgs || err.message || 'Unexpected error';
}
