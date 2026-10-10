'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { ScanQrButton } from '@/components/auth/ScanQrButton';
import { CarIcon, LaptopIcon, PhoneIcon, TabletIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionHeader } from '@/components/page/SectionHeader';
import { normalizeCode } from '@/lib/qrLogin/codes';
import { qrPost } from '@/lib/qrLogin/client';
import { describeDevice } from '@/lib/qrLogin/deviceName';
import { parsePbDate } from '@/lib/qrLogin/state';
import { cn } from '@/lib/utils';
import { useUiStore, type JustApproved } from '@/stores/useUiStore';

interface SignIn {
  id: string;
  device: string;
  at: string;
  sameNetwork: boolean;
}

const KIND_ICON = { computer: LaptopIcon, phone: PhoneIcon, tablet: TabletIcon, car: CarIcon } as const;

/** Settings > Devices (plan 1c): sign in another device by typing the code
 *  it shows (the approve sheet opens over this page), see the devices
 *  signed in that way, and sign out everywhere. A device approved a moment
 *  ago on this phone (useUiStore.justApproved) is at the top of the list,
 *  lit up briefly and marked New. */
export function DevicesPanel() {
  const { signOut } = useAuth();
  const [typed, setTyped] = useState('');
  const [codeError, setCodeError] = useState('');
  const openApprove = useUiStore((s) => s.openApprove);
  const [recent, setRecent] = useState<SignIn[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState('');
  // The device just approved: kept here for as long as the page is open
  // (adjusted during render, React's pattern for state that follows an
  // outside value), then cleared from the store so it never comes back.
  const justApproved = useUiStore((s) => s.justApproved);
  const setJustApproved = useUiStore((s) => s.setJustApproved);
  const [fresh, setFresh] = useState<JustApproved | null>(null);
  if (justApproved && justApproved !== fresh) setFresh(justApproved);
  useEffect(() => {
    if (justApproved) setJustApproved(null);
  }, [justApproved, setJustApproved]);
  const freshRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (fresh) freshRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [fresh]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/qr/recent', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { signIns?: SignIn[] } | null) => {
        if (!cancelled) setRecent(Array.isArray(j?.signIns) ? j.signIns : []);
      })
      .catch(() => {
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The fresh one on top: the server's own row once the device has
  // collected its session, until then one built from the approval.
  const rows: SignIn[] = fresh
    ? [
        recent?.find((r) => r.id === fresh.id) ?? { id: fresh.id, device: fresh.device, at: new Date(fresh.at).toISOString(), sameNetwork: fresh.sameNetwork },
        ...(recent ?? []).filter((r) => r.id !== fresh.id),
      ]
    : (recent ?? []);

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeCode(typed);
    if (!code) {
      setCodeError('Codes are 8 letters and digits, like ABCD-EFGH.');
      return;
    }
    setCodeError('');
    openApprove({ code });
  };

  const revokeAll = async () => {
    setRevoking(true);
    setRevokeError('');
    try {
      const { status } = await qrPost('revoke-all', {});
      if (status === 200) {
        await signOut();
        return;
      }
      setRevokeError("Couldn't sign out everywhere. Try again in a moment.");
    } catch {
      setRevokeError("Couldn't sign out everywhere. Try again in a moment.");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <section className="max-w-2xl">
      <SectionHeader title="Devices" />

      <div className="mt-stack rounded-2xl bg-card p-page shadow-soft">
        <div className="font-semibold">Sign in another device</div>
        <p className="mt-inset text-sm text-muted-foreground">
          On the new device, open Ember to its sign-in page. Scan the QR code it shows, or type its code here.
        </p>
        <form onSubmit={submitCode} className="mt-block flex flex-wrap items-end gap-cluster">
          <div className="grid gap-inset">
            <Label htmlFor="qr-code-input">Code</Label>
            <Input
              id="qr-code-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase())}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              className="w-40 font-mono tracking-widest"
            />
          </div>
          <Button type="submit" variant="ember">
            Continue
          </Button>
          <ScanQrButton />
        </form>
        {codeError && <div className="mt-cluster text-sm text-destructive">{codeError}</div>}
      </div>

      <div className="mt-stack rounded-2xl bg-card p-page shadow-soft">
        <div className="font-semibold">Recent sign-ins</div>
        {rows.length > 0 ? (
          <ul className="mt-block grid gap-cluster">
            {rows.map((s) => {
              const isNew = s.id === fresh?.id;
              const Icon = KIND_ICON[describeDevice(s.device).kind];
              return (
                <li
                  key={s.id}
                  ref={isNew ? freshRef : undefined}
                  data-testid={isNew ? 'device-new' : undefined}
                  className={cn(
                    'flex items-center gap-row rounded-xl p-row text-sm',
                    isNew ? 'ember-just-approved bg-ember/10' : 'bg-muted/40',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-10 shrink-0 place-items-center rounded-xl',
                      isNew ? 'bg-ember/15 text-ember' : 'bg-muted text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{s.device}</span>
                    <span className="block text-muted-foreground">
                      {isNew ? 'Just now' : new Date(parsePbDate(s.at)).toLocaleString()}
                      {' · '}
                      <span className={cn(!s.sameNetwork && 'text-destructive')}>
                        {s.sameNetwork ? 'Same network' : 'Different network'}
                      </span>
                    </span>
                  </span>
                  {isNew && (
                    <span className="shrink-0 rounded-full bg-ember px-cluster py-inset text-xs font-bold uppercase tracking-wide text-ember-foreground">
                      New
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : recent === null ? (
          <p className="mt-inset text-sm text-muted-foreground">Loading...</p>
        ) : (
          <p className="mt-inset text-sm text-muted-foreground">No devices signed in with a code yet.</p>
        )}
      </div>

      <div className="mt-stack rounded-2xl bg-card p-page shadow-soft">
        <div className="font-semibold">Sign out everywhere</div>
        <p className="mt-inset text-sm text-muted-foreground">
          Lost a phone, or signed in somewhere you no longer use? This ends every session of your account.
        </p>
        {confirming ? (
          <div className="mt-block">
            <p className="text-sm">This signs out every device signed in to your account, this one too.</p>
            <div className="mt-cluster flex gap-cluster">
              <Button variant="destructive" disabled={revoking} onClick={() => void revokeAll()}>
                Yes, sign out everywhere
              </Button>
              <Button variant="outline" disabled={revoking} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="mt-block" onClick={() => setConfirming(true)}>
            Sign out everywhere
          </Button>
        )}
        {revokeError && <div className="mt-cluster text-sm text-destructive">{revokeError}</div>}
      </div>
    </section>
  );
}
