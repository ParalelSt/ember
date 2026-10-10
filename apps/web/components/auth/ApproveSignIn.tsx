'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { qrPost, type Credential, type QrFacts } from '@/lib/qrLogin/client';
import { detectShell } from '@/lib/playback/detectShell';
import { describeDevice } from '@/lib/qrLogin/deviceName';
import { CarIcon, LaptopIcon, PhoneIcon, TabletIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/** "Sign in on another device?" (plan 1b): the body of the approve sheet
 *  (ApproveSheet), whether the request came from a scanned QR, an opened
 *  link or a typed code. Shows what is needed to spot a fake (what the
 *  device says it is, how long ago it asked, and whether it is on this
 *  network, the one fact the device cannot claim for itself) and whose
 *  account would be signed in. Approve is dead for 2 s so a reflex tap
 *  cannot approve; Not me is one tap. The code itself is never shown, so
 *  nobody can be talked into reading it out. */

export const APPROVE_ARM_MS = 2000;

const RESULT = {
  done: 'Done. The other device is signing in.',
  expired: 'This code has expired, ask the device for a new one.',
  gone: 'This code has expired or was already used. Ask the device for a new one.',
  used: 'This code was already used.',
  denied: 'Declined.',
  limited: 'Too many tries. Wait a few minutes, then try again.',
  error: "Can't reach Ember right now. Try again in a moment.",
} as const;
export type ApproveResult = keyof typeof RESULT;
type Result = ApproveResult;

type Phase = { kind: 'loading' } | { kind: 'card'; facts: QrFacts } | { kind: 'busy'; facts: QrFacts } | { kind: 'result'; result: Result };

function resultFor(status: number, body: { status?: unknown } | null): Result {
  if (status === 429) return 'limited';
  if (status === 404) return 'gone';
  if (status === 409) {
    const s = body?.status;
    if (s === 'used' || s === 'denied' || s === 'expired') return s;
    return 'expired';
  }
  return 'error';
}

function ago(seconds: number): string {
  if (seconds < 90) return `Asked ${Math.max(0, Math.round(seconds))} s ago`;
  return `Asked ${Math.round(seconds / 60)} min ago`;
}

const KIND_ICON = { computer: LaptopIcon, phone: PhoneIcon, tablet: TabletIcon, car: CarIcon } as const;

export function ApproveSignIn({
  credential,
  onDone,
  onClose,
}: {
  credential: Credential;
  /** After Approve or Not me was answered (not after a lookup that found
   *  nothing): the result, and the request's facts. */
  onDone?: (result: Result, facts: QrFacts) => void;
  /** Shows a Close button under a result. */
  onClose?: () => void;
}) {
  const { user, isAdmin } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [armed, setArmed] = useState(false);
  const [inBrowser] = useState(() => detectShell() === 'web');
  const looked = useRef<Credential | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const finish = (result: Result, facts: QrFacts) => {
    setPhase({ kind: 'result', result });
    onDoneRef.current?.(result, facts);
  };

  useEffect(() => {
    // Once per credential, even when React runs effects twice in development.
    if (looked.current === credential) return;
    looked.current = credential;
    let cancelled = false;
    qrPost<QrFacts & { error?: string }>('lookup', credential)
      .then(({ status, body }) => {
        if (cancelled) return;
        if (status !== 200 || !body) {
          setPhase({ kind: 'result', result: resultFor(status, body) });
          return;
        }
        if (body.status === 'pending') setPhase({ kind: 'card', facts: body });
        else if (body.status === 'denied') setPhase({ kind: 'result', result: 'denied' });
        else if (body.status === 'expired') setPhase({ kind: 'result', result: 'expired' });
        else setPhase({ kind: 'result', result: 'used' });
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: 'result', result: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [credential]);

  const showing = phase.kind === 'card';
  useEffect(() => {
    if (!showing) return;
    const t = setTimeout(() => setArmed(true), APPROVE_ARM_MS);
    return () => clearTimeout(t);
  }, [showing]);

  const act = async (route: 'approve' | 'deny') => {
    if (phase.kind !== 'card') return;
    if (route === 'approve' && !armed) return;
    const facts = phase.facts;
    setPhase({ kind: 'busy', facts });
    try {
      const { status, body } = await qrPost<{ ok?: boolean; status?: string }>(route, { id: facts.id, ...credential });
      if (status === 200 && body?.ok) finish(route === 'approve' ? 'done' : 'denied', facts);
      else finish(resultFor(status, body), facts);
    } catch {
      finish('error', facts);
    }
  };

  const eyebrow = (
    <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sign in on another device?</h2>
  );

  if (phase.kind === 'loading') {
    return (
      <div>
        {eyebrow}
        <p className="mt-block text-sm text-muted-foreground">Looking up the request...</p>
      </div>
    );
  }

  if (phase.kind === 'result') {
    return (
      <div data-testid="approve-result" aria-live="polite">
        {eyebrow}
        <div className="mt-block font-semibold">{RESULT[phase.result]}</div>
        {(phase.result === 'expired' || phase.result === 'gone') && 'token' in credential && (
          <Link href="/settings/devices" className="mt-cluster inline-block text-sm text-muted-foreground underline hover:text-foreground">
            Have a code? Type it in Settings &gt; Devices
          </Link>
        )}
        {onClose && (
          <Button variant="outline" className="mt-stack w-full" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    );
  }

  const { facts } = phase;
  const busy = phase.kind === 'busy';
  const { name, kind } = describeDevice(facts.device);
  const Icon = KIND_ICON[kind];
  return (
    <div data-testid="approve-card">
      {eyebrow}
      <div className="mt-block flex items-center gap-row">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-ember/15 text-ember" aria-hidden>
          <Icon className="size-6" />
        </span>
        <div className="min-w-0">
          <div data-testid="approve-device" className="truncate text-lg font-bold leading-tight">
            {name}
          </div>
          {/* The device names itself (from its User-Agent), so the sheet
              says so; the network line is the fact the server observed. */}
          <div className="text-sm text-muted-foreground">
            Says it is {facts.device}
            {' · '}
            <span>{ago(facts.askedSecondsAgo)}</span>
          </div>
        </div>
      </div>
      <div className={cn('mt-block text-sm', facts.sameNetwork ? 'text-muted-foreground' : 'font-semibold text-destructive')}>
        {facts.sameNetwork ? 'Same network as this phone' : 'Different network from this phone'}
      </div>
      <p className="mt-cluster text-sm">
        Only approve if that screen is in front of you right now. Approving signs it in as{' '}
        <span data-testid="approve-account" className="font-semibold">
          {user?.email ?? 'you'}
          {isAdmin ? ' (admin)' : ''}
        </span>
        .
      </p>
      {inBrowser && (
        <p className="mt-cluster text-xs text-muted-foreground">
          You are approving from your browser; this does not sign the browser out of anything.
        </p>
      )}
      <Button
        variant="ember"
        className="mt-stack h-12 w-full rounded-full text-base font-semibold"
        disabled={!armed || busy}
        onClick={() => void act('approve')}
      >
        Approve
      </Button>
      <div className="mt-cluster text-center">
        <button
          type="button"
          disabled={busy}
          onClick={() => void act('deny')}
          className="p-cluster text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
        >
          Not me
        </button>
      </div>
    </div>
  );
}
