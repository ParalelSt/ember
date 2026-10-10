'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { QrSvg } from '@/components/ui/QrSvg';
import { CheckIcon } from '@/components/icons';
import { useQrSignIn, type QrSession, type QrSignInState } from '@/hooks/useQrSignIn';
import { formatCode } from '@/lib/qrLogin/codes';
import { detectShell } from '@/lib/playback/detectShell';

const QR_PX = 224;

const STEPS: ReadonlyArray<{ title: string; sub?: string }> = [
  { title: 'Open Ember on your phone' },
  { title: 'Tap Scan QR code in the menu', sub: 'or in Settings > Devices' },
  { title: 'Tap Approve', sub: 'This screen signs in by itself.' },
];

/** The square the QR fills, so the card does not jump between states. */
function Square({ children }: { children: ReactNode }) {
  return (
    <div className="grid size-56 place-items-center content-center gap-block rounded-xl bg-muted/50 p-block text-center text-sm">
      {children}
    </div>
  );
}

function QrArea({ state, restart }: { state: QrSignInState; restart: () => void }) {
  switch (state.kind) {
    case 'starting':
      return <Square><span className="text-muted-foreground">Getting a code...</span></Square>;
    case 'waiting':
      return (
        // The white tile is the quiet zone, so it reads the same in a dark theme.
        <QrSvg value={state.approveUrl} size={QR_PX} logo label="QR code to sign in" className="rounded-xl" />
      );
    case 'approved':
      return (
        <Square>
          <span className="grid size-12 place-items-center rounded-full bg-ember text-ember-foreground" aria-hidden>
            <CheckIcon className="size-6" />
          </span>
          <span className="font-semibold" aria-live="polite">
            Signed in as {state.name}
          </span>
        </Square>
      );
    case 'expired':
      return (
        <Square>
          <span className="font-semibold">Code expired</span>
          <Button type="button" variant="outline" onClick={restart}>
            Get a new code
          </Button>
        </Square>
      );
    case 'denied':
      return (
        <Square>
          <span>Sign-in was declined on your other device.</span>
          <Button type="button" variant="outline" onClick={restart}>
            Try again
          </Button>
        </Square>
      );
    case 'error':
      return (
        <Square>
          <span className="text-muted-foreground">Can&apos;t get a code right now.</span>
          <Button type="button" variant="outline" onClick={restart}>
            Try again
          </Button>
        </Square>
      );
  }
}

/** The QR card on /auth (owner's pick: the QR is the hero, with the Ember
 *  flame in its middle and three numbered steps beside it). A phone that is
 *  already signed in scans it and approves, and this device signs itself
 *  in. The short code under it is for a phone without a camera. */
export function QrSignIn({ next }: { next: string }) {
  const { adoptSession } = useAuth();
  const router = useRouter();
  const [shell] = useState(detectShell);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onApproved = useCallback(
    (token: string, record: QrSession['record']) => {
      adoptSession(token, record);
      // "Signed in as" for a second, so the person sees whose account it is.
      timer.current = setTimeout(() => {
        router.replace(next);
        router.refresh();
      }, 1000);
    },
    [adoptSession, router, next],
  );
  const { state, restart } = useQrSignIn({ shell, onApproved });

  return (
    <div data-testid="qr-sign-in">
      <div className="grid items-center justify-items-center gap-stack sm:grid-cols-[auto_1fr] sm:justify-items-start">
        <div className="flex flex-col items-center gap-block">
          <QrArea state={state} restart={restart} />
          {state.kind === 'waiting' && (
            <div className="flex items-center gap-cluster text-sm text-muted-foreground" aria-live="polite">
              <span className="size-2 animate-pulse rounded-full bg-ember" aria-hidden />
              {state.offline ? "Can't reach Ember, retrying..." : 'Waiting for approval...'}
            </div>
          )}
        </div>

        <ol data-testid="qr-steps" className="grid gap-block text-left">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex items-start gap-row">
              <span
                className="grid size-7 shrink-0 place-items-center rounded-full bg-ember text-sm font-bold text-ember-foreground"
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="pt-inset">
                <div className="font-medium leading-snug">{step.title}</div>
                {step.sub && <div className="mt-inset text-sm text-muted-foreground">{step.sub}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {state.kind === 'waiting' && (
        <div className="mt-stack grid gap-inset text-center text-sm text-muted-foreground sm:text-left">
          <p>
            No camera? Type{' '}
            <span data-testid="qr-code" className="font-mono font-bold tracking-widest text-foreground">
              {formatCode(state.code)}
            </span>{' '}
            in Settings &gt; Devices
          </p>
          <p className="text-xs">This device: {state.device}</p>
        </div>
      )}
    </div>
  );
}
