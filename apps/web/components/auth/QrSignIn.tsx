'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { QrSvg } from '@/components/ui/QrSvg';
import { useQrSignIn, type QrSession } from '@/hooks/useQrSignIn';
import { formatCode } from '@/lib/qrLogin/codes';
import { detectShell } from '@/lib/playback/detectShell';

/** Below the email form on /auth (plan 1a): a QR of the approve link and
 *  the short code. A phone that is already signed in approves, and this
 *  device signs itself in. The email form stays usable whatever happens
 *  here. */
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
    <div data-testid="qr-sign-in" className="mt-stack">
      <div className="flex items-center gap-row text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="mt-stack flex flex-col items-center gap-block text-center">
        <div>
          <div className="font-semibold">Sign in with your phone</div>
          {state.kind === 'waiting' && (
            <p className="mt-inset text-sm text-muted-foreground">
              Scan this with a phone that is already signed in to Ember, or open Settings &gt; Devices &gt; Type the
              code and enter <span className="font-semibold text-foreground">{formatCode(state.code)}</span>.
            </p>
          )}
        </div>

        {state.kind === 'starting' && (
          <div className="grid size-60 place-items-center rounded-lg bg-muted/50 text-sm text-muted-foreground">
            Getting a code...
          </div>
        )}

        {state.kind === 'waiting' && (
          <>
            <QrSvg value={state.approveUrl} size={240} label="QR code to sign in" />
            <div data-testid="qr-code" className="font-mono text-3xl font-bold tracking-widest">
              {formatCode(state.code)}
            </div>
            <div className="text-xs text-muted-foreground">This device: {state.device}</div>
            <div className="flex items-center gap-cluster text-sm text-muted-foreground" aria-live="polite">
              <span className="size-2 animate-pulse rounded-full bg-ember" aria-hidden />
              {state.offline ? "Can't reach Ember, retrying..." : 'Waiting for approval...'}
            </div>
          </>
        )}

        {state.kind === 'approved' && (
          <div className="text-sm font-semibold" aria-live="polite">
            Signed in as {state.name}
          </div>
        )}

        {state.kind === 'expired' && (
          <>
            <div className="text-sm font-semibold">Code expired</div>
            <Button type="button" variant="outline" onClick={restart}>
              Get a new code
            </Button>
          </>
        )}

        {state.kind === 'denied' && (
          <>
            <div className="text-sm">Sign-in was declined on your other device.</div>
            <Button type="button" variant="outline" onClick={restart}>
              Try again
            </Button>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <div className="text-sm text-muted-foreground">Can&apos;t get a code right now.</div>
            <Button type="button" variant="outline" onClick={restart}>
              Try again
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
