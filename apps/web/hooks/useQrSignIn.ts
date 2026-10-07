'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Shell } from '@/lib/playback/detectShell';

/** The new device's side of QR sign-in (plan 1a). Starts a request (the
 *  server sets the httpOnly poll cookie), polls /api/auth/qr/status every
 *  2 s with up to 300 ms of jitter while the tab is visible, and hands the
 *  minted session to onApproved exactly once. Each request has its own
 *  cookie and is polled by id, so two tabs never get in each other's way. A code that runs out is
 *  renewed silently up to 5 times (15 minutes on screen), then the person
 *  is asked. Errors keep the QR up and back off to 5 s. */

export const POLL_MS = 2000;
export const JITTER_MS = 300;
export const BACKOFF_MS = 5000;
export const MAX_RENEWALS = 5;

export type QrSignInState =
  | { kind: 'starting' }
  | {
      kind: 'waiting';
      id: string;
      code: string;
      approveUrl: string;
      device: string;
      expiresAtMs: number;
      /** The status route could not be reached; retrying. */
      offline: boolean;
    }
  | { kind: 'approved'; name: string }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'error' };

export interface QrSession {
  token: string;
  record: Record<string, unknown> & { id: string };
}

interface Options {
  shell: Shell;
  onApproved: (token: string, record: QrSession['record']) => void;
}

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export function useQrSignIn({ shell, onApproved }: Options) {
  const [state, setState] = useState<QrSignInState>({ kind: 'starting' });
  const [visible, setVisible] = useState(isVisible);
  // Bumped to start a new request (renewal, Get a new code, Try again).
  const [generation, setGeneration] = useState(0);
  const renewals = useRef(0);
  const onApprovedRef = useRef(onApproved);
  useEffect(() => {
    onApprovedRef.current = onApproved;
  }, [onApproved]);

  useEffect(() => {
    const onChange = () => {
      const v = isVisible();
      // Someone came back to the screen: they get the full set of renewals.
      if (v) renewals.current = 0;
      setVisible(v);
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  // One request per generation.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/auth/qr/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shell }),
          credentials: 'same-origin',
        });
        const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (cancelled) return;
        const expiresAtMs = Date.parse(String(j?.expiresAt ?? ''));
        if (
          !res.ok || !j ||
          typeof j.id !== 'string' || typeof j.code !== 'string' ||
          typeof j.approveUrl !== 'string' || typeof j.device !== 'string' ||
          !Number.isFinite(expiresAtMs)
        ) {
          setState({ kind: 'error' });
          return;
        }
        setState({ kind: 'waiting', id: j.id, code: j.code, approveUrl: j.approveUrl, device: j.device, expiresAtMs, offline: false });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generation, shell]);

  const renewOrGiveUp = useCallback(() => {
    if (renewals.current < MAX_RENEWALS) {
      renewals.current++;
      setGeneration((g) => g + 1);
    } else {
      setState({ kind: 'expired' });
    }
  }, []);

  const waitingId = state.kind === 'waiting' ? state.id : null;
  const expiresAtMs = state.kind === 'waiting' ? state.expiresAtMs : 0;

  // The poll loop, while a request is waiting and the tab is visible.
  useEffect(() => {
    if (!waitingId || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      timer = setTimeout(() => void tick(), ms + Math.floor(Math.random() * JITTER_MS));
    };
    const setOffline = (offline: boolean) =>
      setState((s) => (s.kind === 'waiting' && s.id === waitingId && s.offline !== offline ? { ...s, offline } : s));

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() >= expiresAtMs) {
        renewOrGiveUp();
        return;
      }
      let res: Response;
      try {
        res = await fetch(`/api/auth/qr/status?id=${encodeURIComponent(waitingId)}`, { credentials: 'same-origin', cache: 'no-store' });
      } catch {
        if (cancelled) return;
        setOffline(true);
        schedule(BACKOFF_MS);
        return;
      }
      if (cancelled) return;
      if (res.status === 404) {
        renewOrGiveUp();
        return;
      }
      if (!res.ok) {
        setOffline(true);
        schedule(BACKOFF_MS);
        return;
      }
      const j = (await res.json().catch(() => null)) as { status?: string; token?: unknown; record?: unknown } | null;
      if (cancelled) return;
      const status = j?.status;
      if (status === 'approved' && typeof j?.token === 'string' && j.record && typeof j.record === 'object') {
        const record = j.record as QrSession['record'];
        const name = typeof record.name === 'string' && record.name ? record.name : String(record.email ?? '');
        setState({ kind: 'approved', name });
        onApprovedRef.current(j.token, record);
        return;
      }
      if (status === 'denied') {
        setState({ kind: 'denied' });
        return;
      }
      if (status === 'expired' || status === 'used') {
        renewOrGiveUp();
        return;
      }
      setOffline(false);
      schedule(POLL_MS);
    };

    schedule(POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [waitingId, expiresAtMs, visible, renewOrGiveUp]);

  const restart = useCallback(() => {
    renewals.current = 0;
    setGeneration((g) => g + 1);
  }, []);

  return { state, restart };
}
