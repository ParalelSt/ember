'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { qrPost, type Credential, type QrFacts } from '@/lib/qrLogin/client';
import { detectShell } from '@/lib/playback/detectShell';
import { cn } from '@/lib/utils';

/** "Sign in on another device?" (plan 1b): the approving device's card, for
 *  the /link page and for Settings > Devices. Shows what is needed to spot
 *  a fake (what the device says it is, how long ago it asked, and whether
 *  it is on this network, the one fact the device cannot claim for itself) and whose account would be signed in. Approve is dead for 2 s
 *  so a reflex tap cannot approve; Not me is one tap. The code itself is
 *  never shown, so nobody can be talked into reading it out. */

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
type Result = keyof typeof RESULT;

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

export function ApproveSignIn({ credential, onDone }: { credential: Credential; onDone?: (result: Result) => void }) {
  const { user, isAdmin } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [armed, setArmed] = useState(false);
  const [inBrowser] = useState(() => detectShell() === 'web');
  const looked = useRef<Credential | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const finish = (result: Result) => {
    setPhase({ kind: 'result', result });
    onDoneRef.current?.(result);
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
      if (status === 200 && body?.ok) finish(route === 'approve' ? 'done' : 'denied');
      else finish(resultFor(status, body));
    } catch {
      finish('error');
    }
  };

  if (phase.kind === 'loading') {
    return <div className="rounded-2xl bg-card p-page text-sm text-muted-foreground shadow-soft">Looking up the request...</div>;
  }

  if (phase.kind === 'result') {
    return (
      <div data-testid="approve-result" className="rounded-2xl bg-card p-page shadow-soft" aria-live="polite">
        <div className="font-semibold">{RESULT[phase.result]}</div>
        {(phase.result === 'expired' || phase.result === 'gone') && 'token' in credential && (
          <Link href="/settings/devices" className="mt-cluster inline-block text-sm text-muted-foreground underline hover:text-foreground">
            Have a code? Type it in Settings &gt; Devices
          </Link>
        )}
      </div>
    );
  }

  const { facts } = phase;
  const busy = phase.kind === 'busy';
  return (
    <div data-testid="approve-card" className="rounded-2xl bg-card p-page shadow-soft">
      <h2 className="text-section-title">Sign in on another device?</h2>
      <dl className="mt-block grid gap-cluster text-sm">
        {/* The device names itself (from its User-Agent), so the card says
            so; the network line is the fact the server observed. */}
        <div className="font-semibold">Says it is: {facts.device}</div>
        <div className="text-muted-foreground">{ago(facts.askedSecondsAgo)}</div>
        <div className={cn(facts.sameNetwork ? 'text-muted-foreground' : 'font-semibold text-destructive')}>
          {facts.sameNetwork ? 'Same network as this phone' : 'Different network from this phone'}
        </div>
      </dl>
      <p className="mt-block text-sm">
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
      <div className="mt-stack flex gap-cluster">
        <Button variant="ember" disabled={!armed || busy} onClick={() => void act('approve')}>
          Approve
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void act('deny')}>
          Not me
        </Button>
      </div>
    </div>
  );
}
