'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BaseAuthStore, type RecordModel } from 'pocketbase';
import { createClient } from '@/lib/pocketbase/client';
import { onSessionExpired } from '@/lib/sessionExpired';
import { usePrivacyStore } from '@/stores/usePrivacyStore';
import { useChangelogStore } from '@/stores/useChangelogStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { registerThemeCookieWriter, useThemeStore } from '@/stores/useThemeStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { parseThemeDoc, sameDoc } from '@/lib/theme/model';
import { logger } from '@/lib/logger/client';
import { flushNativeCookies } from '@/lib/nativeCookies';
import { GATEWAY_STATUSES, NO_ANSWER_MESSAGE } from '@/lib/connectionBlip';

/** Minimal user shape exposed to the app, matches the old Supabase one
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
  /** Convenience, `user?.name || ''`. Empty string when unset. */
  name: string;
  /** Convenience, `user?.avatarUrl`. */
  avatarUrl: string | null;
  /** Convenience, `user?.isAdmin === true`. */
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: { message: string } | null }>;
  signUp: (email: string, password: string) => Promise<{ error: { message: string } | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  /** Signs in with a session another device approved (QR sign-in): the
   *  same store, so the client wrapper writes the same pb_auth cookie a
   *  password sign-in does. */
  adoptSession: (token: string, record: { id: string } & Record<string, unknown>) => void;
  /** Re-pulls the user record from PB so derived fields (name, avatarUrl)
   *  refresh after a profile save. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Written on sign-out, so the other open tabs hear it (a `storage` event
 *  fires in every tab but the one that wrote). */
const SIGNED_OUT_KEY = 'ember.signedOut';

/** Whose queue ember.player.v1 holds. A session can end without a sign-out
 *  (it expired, or Sign out everywhere ran on another device): the next
 *  account to sign in here must not open onto it. */
const PLAYBACK_OWNER_KEY = 'ember.player.owner';

function claimAccountPlayback(userId: string): void {
  try {
    const owner = localStorage.getItem(PLAYBACK_OWNER_KEY);
    // No owner yet: a queue saved before this was kept is the first
    // account's to sign in.
    if (owner && owner !== userId) clearAccountPlayback();
    if (owner !== userId) localStorage.setItem(PLAYBACK_OWNER_KEY, userId);
  } catch {
    // Storage refused (a private window): nothing was saved to carry over.
  }
}

/** The saved queue and what was playing (ember.player.v1 in localStorage)
 *  are the account's: the next account on this device used to open onto
 *  them. Volume, loop and mute are the device's and stay. */
function clearAccountPlayback(): void {
  usePlayerStore.setState({
    queue: [],
    index: -1,
    position: 0,
    context: null,
    baseCount: 0,
    shuffle: false,
    orderBackup: null,
    played: [],
  });
}

export function AuthProvider({ children, initialUser }: { children: ReactNode; initialUser: AuthUser | null }) {
  const [pb] = useState(() => createClient());
  const [sessionUser, setUser] = useState<AuthUser | null>(initialUser);
  const [loading, setLoading] = useState(initialUser === null);
  // Nobody is signed in on the sign-in page (proxy.ts sends a live session
  // away from it), so nothing signed-in loads there, whatever the cookie
  // still claims (bughunt V5).
  const user = usePathname() === '/auth' ? null : sessionUser;

  // An API call answered 401: the session is dead. Clearing the store
  // rewrites the cookie and turns user null, which stops every signed-in
  // fetch rather than letting each collect its own 401 (bughunt V5).
  useEffect(
    () => onSessionExpired(() => {
      if (pb.authStore.token || pb.authStore.record) pb.authStore.clear();
    }),
    [pb],
  );

  // Signed out in another tab: the session cookie is gone for this tab too,
  // and its player still held the queue, which its next save (about once a
  // second while playing) wrote back for the next account. Drop both here.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SIGNED_OUT_KEY || !e.newValue) return;
      // Heard late (a tab the browser had frozen gets it when it wakes),
      // after someone signed in again: the cookie and the saved queue are
      // that session's now. Clearing here signed them out and emptied it.
      const now = new BaseAuthStore();
      now.loadFromCookie(document.cookie);
      if (now.token && now.token !== pb.authStore.token) return;
      clearAccountPlayback();
      useSessionStore.getState().setHostingSessionId(null);
      if (pb.authStore.token || pb.authStore.record) pb.authStore.clear();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [pb]);

  useEffect(() => {
    // Sync local user state with the SDK on every auth change. The SDK
    // already syncs to document.cookie via the client wrapper.
    const unsub = pb.authStore.onChange(() => {
      const record = pb.authStore.record;
      setUser(record ? mapRecord(pb, record) : null);
      setLoading(false);
      // The client wrapper has just rewritten pb_auth; in the phone app it
      // goes to disk now, not ~30 s later (a kill in between lost it).
      void flushNativeCookies();
    });

    // If we mounted without an initial user, attempt a token refresh so a
    // stale-but-valid cookie can rehydrate the session without a re-login.
    // Offline tolerance: only the server refusing the session (401/403, or
    // 404 for an account that is gone) clears the store. No connection
    // (the SDK reports it as status 0, "Something went wrong.", which the
    // old message check missed) or a PocketBase restart (5xx) keeps it, so
    // the offline-pinned playlists stay reachable and nobody is signed out
    // by a blip.
    if (!initialUser && pb.authStore.isValid) {
      pb.collection('users').authRefresh()
        .catch((err: unknown) => {
          const status = (err as { status?: unknown } | null)?.status;
          if (status === 401 || status === 403 || status === 404) pb.authStore.clear();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }

    return () => { unsub(); };
  }, [pb, initialUser]);

  const userId = user?.id;

  useEffect(() => {
    if (userId) claimAccountPlayback(userId);
  }, [userId]);

  // Pull the privacy switches once per account. Presence publishing
  // assumes "don't share" until this lands, so the cost of it being late is
  // silence, never an unwanted broadcast. Keyed on the id, not the user
  // object: a theme change or profile refresh rewrites the record, and a
  // reload racing a switch just flipped could put the old value back.
  useEffect(() => {
    if (userId) void usePrivacyStore.getState().load();
  }, [userId]);

  // What's new read state, per user. Until it lands nothing shows as New.
  useEffect(() => {
    if (userId) void useChangelogStore.getState().load();
    else useChangelogStore.setState({ seenVersion: null, hideNew: false, loaded: false });
  }, [userId]);

  // Plugin switches follow the account. The local cache keeps showing the
  // last known values until this lands; signed out, it is all there is.
  useEffect(() => {
    if (userId) void useSettingsStore.getState().loadPlugins(userId);
    else useSettingsStore.getState().resetPluginSync();
  }, [userId]);

  // The active theme follows the account too. The cached theme (and the
  // cookie's, painted by the root layout) shows until this lands.
  useEffect(() => {
    if (userId) void useThemeStore.getState().loadTheme(userId);
    else useThemeStore.getState().resetThemeSync();
  }, [userId]);

  // After a theme change, put it into the auth record so the client
  // wrapper rewrites the pb_auth cookie at once: the root layout paints the
  // next hard reload from that cookie. One client, this one.
  useEffect(() => {
    registerThemeCookieWriter((theme) => {
      const record = pb.authStore.record;
      if (!pb.authStore.isValid || !record) return;
      if (sameDoc(parseThemeDoc(record.theme), theme)) return;
      pb.authStore.save(pb.authStore.token, { ...record, theme });
    });
    return () => registerThemeCookieWriter(null);
  }, [pb]);

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
      signUp: async (typed, password) => {
        // Invites are stored lower-case (pb_hooks/ensure_invite_emails) and
        // PocketBase 0.22's createRule compares the email as written.
        const email = typed.trim().toLowerCase();
        try {
          try {
            await pb.collection('users').create({ email, password, passwordConfirm: password });
          } catch (e) {
            // The email is taken: most likely an earlier Register made the
            // account and only its sign-in was lost (a dropped connection,
            // the sign-in limit). Pressing Register again signs in with it;
            // any other password still gets the email message.
            if (!(e as { data?: Record<string, unknown> } | null)?.data?.email) throw e;
            try {
              await pb.collection('users').authWithPassword(email, password);
            } catch {
              throw e;
            }
            logger.breadcrumb('auth', 'signup', { userId: pb.authStore.record?.id, existing: true });
            return { error: null, needsConfirmation: false };
          }
          // PocketBase doesn't gate on email verification out of the box,
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
      adoptSession: (token, record) => {
        pb.authStore.save(token, record as unknown as RecordModel);
        logger.breadcrumb('auth', 'qr signin', { userId: record.id });
      },
      signOut: async () => {
        logger.breadcrumb('auth', 'signout', { userId: user?.id });
        pb.authStore.clear();
        // A carlist this account hosts is not the next account's: the flag
        // is kept on the device and turns radio off (bughunt X6).
        useSessionStore.getState().setHostingSessionId(null);
        // The saved queue and what was playing are this account's too, in
        // this tab and in every other open one.
        clearAccountPlayback();
        try {
          localStorage.setItem(SIGNED_OUT_KEY, String(Date.now()));
        } catch {
          // Storage refused (a private window): the other tabs keep theirs.
        }
        // Hard-navigate so the liked / history caches from the signed-out
        // user can't leak into the next session. The persisted settings
        // (ember.settings.v1) survive because they live in localStorage,
        // not in React state.
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
 *  top-level `.message` is a generic "Something went wrong", the useful
 *  per-field info lives in `.data.<field>.message`. */
function extractPbError(e: unknown): string {
  if (!e || typeof e !== 'object') return 'Unexpected error';
  const err = e as {
    message?: string;
    status?: unknown;
    isAbort?: boolean;
    response?: { message?: unknown };
    data?: Record<string, { message?: string }>;
  };
  // No connection (status 0), or a gateway answering while the server
  // restarts, with nothing from PocketBase itself: the SDK calls both
  // "Something went wrong.", the email step says it plainly.
  const noAnswer = err.status === 0 || (typeof err.status === 'number' && GATEWAY_STATUSES.includes(err.status));
  if (noAnswer && !err.isAbort && !err.response?.message) return NO_ANSWER_MESSAGE;
  const fieldMsgs = Object.entries(err.data ?? {})
    .map(([field, info]) => info?.message ? `${field}: ${info.message}` : null)
    .filter(Boolean)
    .join(' · ');
  return fieldMsgs || err.message || 'Unexpected error';
}
