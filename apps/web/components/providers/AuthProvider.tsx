'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/pocketbase/client';
import { usePrivacyStore } from '@/stores/usePrivacyStore';
import { logger } from '@/lib/logger/client';

/** Minimal user shape exposed to the app — matches the old Supabase one
 *  closely enough that consumers don't care which backend produced it. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

interface AuthValue {
  user: AuthUser | null;
  /** Convenience — `user?.name || ''`. Empty string when unset. */
  name: string;
  /** Convenience — `user?.avatarUrl`. */
  avatarUrl: string | null;
  /** Convenience — `user?.isAdmin === true`. */
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: { message: string } | null }>;
  signUp: (email: string, password: string) => Promise<{ error: { message: string } | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  /** Re-pulls the user record from PB so derived fields (name, avatarUrl)
   *  refresh after a profile save. */
  refresh: () => Promise<void>;
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
      setUser(record ? mapRecord(pb, record) : null);
      setLoading(false);
    });

    // If we mounted without an initial user, attempt a token refresh so a
    // stale-but-valid cookie can rehydrate the session without a re-login.
    // Offline tolerance: network failures during refresh are SWALLOWED so the
    // offline-pinned playlists stay reachable. Any non-network error (401/403)
    // still clears the store.
    if (!initialUser && pb.authStore.isValid) {
      pb.collection('users').authRefresh()
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message.toLowerCase() : '';
          const isNetwork = err instanceof TypeError || msg.includes('failed to fetch') || msg.includes('network');
          if (!isNetwork) pb.authStore.clear();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }

    return () => { unsub(); };
  }, [pb, initialUser]);

  // Pull the privacy switches once there's a session. Presence publishing
  // assumes "don't share" until this lands, so the cost of it being late is
  // silence, never an unwanted broadcast.
  useEffect(() => {
    if (user) void usePrivacyStore.getState().load();
  }, [user]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      name: user?.name ?? '',
      avatarUrl: user?.avatarUrl ?? null,
      isAdmin: user?.isAdmin === true,
      loading,
      refresh: async () => {
        try {
          await pb.collection('users').authRefresh();
        } catch (e) {
          logger.error('auth', 'refresh failed', { reason: extractPbError(e) }, e instanceof Error ? e : undefined);
        }
      },
      signIn: async (email, password) => {
        try {
          await pb.collection('users').authWithPassword(email, password);
          logger.breadcrumb('auth', 'signin', { userId: pb.authStore.record?.id });
          return { error: null };
        } catch (e) {
          logger.error('auth', 'signin failed', { reason: extractPbError(e) }, e instanceof Error ? e : undefined);
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
          logger.breadcrumb('auth', 'signup', { userId: pb.authStore.record?.id });
          return { error: null, needsConfirmation: false };
        } catch (e) {
          logger.error('auth', 'signup failed', { reason: extractPbError(e) }, e instanceof Error ? e : undefined);
          return { error: { message: extractPbError(e) }, needsConfirmation: false };
        }
      },
      signOut: async () => {
        logger.breadcrumb('auth', 'signout', { userId: user?.id });
        pb.authStore.clear();
        // Hard-navigate so the queue / liked / history caches from the
        // signed-out user can't leak into the next session. The persisted
        // settings (ember.settings.v1) + zustand player slice survive
        // because they live in localStorage, not in React state.
        if (typeof window !== 'undefined') {
          window.location.href = '/auth';
        }
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

function mapRecord(
  pb: ReturnType<typeof createClient>,
  record: { id: string; email?: string; name?: string; avatar?: string; is_admin?: boolean; collectionId?: string; collectionName?: string },
): AuthUser {
  return {
    id: record.id,
    email: String(record.email ?? ''),
    name: String(record.name ?? ''),
    avatarUrl: record.avatar
      ? pb.files.getURL(record as Parameters<typeof pb.files.getURL>[0], record.avatar)
      : null,
    isAdmin: record.is_admin === true,
  };
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
