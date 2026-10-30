'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { SCAN_QR_LABEL } from '@/components/auth/ScanQrButton';
import {
  CameraIcon,
  CarIcon,
  LaptopIcon,
  PhoneIcon,
  ScanQrIcon,
  ShieldWarningIcon,
  TabletIcon,
  WarningIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { SectionHeader } from '@/components/page/SectionHeader';
import { useCanScan } from '@/hooks/useQrScan';
import { formatSince } from '@/lib/format';
import { detectShell } from '@/lib/playback/detectShell';
import { normalizeCode } from '@/lib/qrLogin/codes';
import { qrPost } from '@/lib/qrLogin/client';
import { deviceLabel } from '@/lib/qrLogin/device';
import { describeDevice, deviceTitle, type DeviceKind } from '@/lib/qrLogin/deviceName';
import { rememberedQrSignIn } from '@/lib/qrLogin/thisDevice';
import { shellAppVersion } from '@/lib/shellVersion';
import { cn } from '@/lib/utils';
import { useUiStore, type JustApproved } from '@/stores/useUiStore';

interface SignIn {
  id: string;
  device: string;
  at: string;
  sameNetwork: boolean;
}

// What the browser says it is never changes while the page is open.
const noSubscribe = () => () => {};
const hereLabel = () => deviceLabel(navigator.userAgent, detectShell());

const KIND_ICON = { computer: LaptopIcon, phone: PhoneIcon, tablet: TabletIcon, car: CarIcon } as const;

function DeviceIcon({ kind, className }: { kind: DeviceKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon className={className} />;
}

const CODE_ERROR = 'Codes are 8 letters and digits, like ABCD-EFGH.';
const REVOKE_ERROR = "Couldn't sign out everywhere. Try again in a moment.";

/** Settings > Devices (owner's picks, devices1 picker): this device on top,
 *  then the big sign-in card (scan a QR, or type the code: the approve sheet
 *  opens over this page), then the other devices, then the danger zone.
 *
 *  Only what Ember really knows is shown. For this device: what the browser
 *  says it is, and the web build and app versions. For the others: the QR
 *  sign-ins of the last 30 days (label, when, same network or not). There is
 *  no location, last-active time or per-device version anywhere, and no
 *  per-device sign out: a PocketBase session is a token that cannot be ended
 *  on its own, only all of them together (Sign out everywhere).
 *
 *  A device approved a moment ago on this phone (useUiStore.justApproved)
 *  is at the top of Other devices, lit up briefly and marked New. */
export function DevicesPanel() {
  const { signOut } = useAuth();
  const canScan = useCanScan();
  const setQrScan = useUiStore((s) => s.setQrScan);
  const openApprove = useUiStore((s) => s.openApprove);
  const [typed, setTyped] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [recent, setRecent] = useState<SignIn[] | null>(null);
  // This device, from the browser itself (null in the server render, which
  // has no navigator), and which QR sign-in was its own, if any.
  const here = useSyncExternalStore(noSubscribe, hereLabel, () => null);
  const ownId = useSyncExternalStore(noSubscribe, rememberedQrSignIn, () => null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const isDesktop = useIsDesktop();
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

  // The desktop or phone app's own version; null in a browser.
  useEffect(() => {
    let live = true;
    void shellAppVersion().then((v) => {
      if (live) setAppVersion(v);
    });
    return () => {
      live = false;
    };
  }, []);

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
  // collected its session, until then one built from the approval. This
  // browser's own QR sign-in is the hero, not another device.
  const listed = (recent ?? []).filter((r) => r.id !== ownId);
  const rows: SignIn[] = fresh
    ? [
        listed.find((r) => r.id === fresh.id) ?? { id: fresh.id, device: fresh.device, at: new Date(fresh.at).toISOString(), sameNetwork: fresh.sameNetwork },
        ...listed.filter((r) => r.id !== fresh.id),
      ]
    : listed;

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeCode(typed);
    if (!code) {
      setCodeError(CODE_ERROR);
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
      setRevokeError(REVOKE_ERROR);
    } catch {
      setRevokeError(REVOKE_ERROR);
    } finally {
      setRevoking(false);
    }
  };

  const hereKind = here ? describeDevice(here).kind : 'computer';
  const webVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  // Scanning needs a camera (a phone or tablet); elsewhere typing the code
  // is the only way, so it is simply open.
  const showCode = codeOpen || !canScan;

  // The same words and buttons in the desktop dialog and the phone sheet.
  const confirmBody = (
    Title: typeof DialogTitle | typeof SheetTitle,
    Description: typeof DialogDescription | typeof SheetDescription,
  ) => (
    <>
      <Title className="flex items-center gap-cluster text-lg font-bold text-destructive">
        <WarningIcon className="size-6" />
        Sign out everywhere?
      </Title>
      <Description>
        This ends every session of your account, this device too. You will need to sign in again.
      </Description>
      <ul aria-label="Devices that will be signed out" className="flex flex-wrap gap-cluster">
        <Chip kind={hereKind}>This device</Chip>
        {rows.map((s) => (
          <Chip key={s.id} kind={describeDevice(s.device).kind}>
            {describeDevice(s.device).name}
          </Chip>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">And anywhere else your account is signed in.</p>
      {revokeError && (
        <div role="alert" className="text-sm text-destructive">
          {revokeError}
        </div>
      )}
      <div className="grid grid-cols-2 gap-cluster">
        <Button variant="outline" className="h-11" disabled={revoking} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button variant="destructive" className="h-11" disabled={revoking} onClick={() => void revokeAll()}>
          Sign out all
        </Button>
      </div>
    </>
  );

  return (
    <section className="max-w-2xl lg:max-w-5xl">
      <SectionHeader title="Devices" />

      {/* Desktop: two columns (owner pick devices2). Left: this device and
          other devices; right: sign in and the danger zone. Phone keeps the
          single stacked column in the same order. */}
      <div data-testid="devices-grid" className="lg:mt-stack lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-stack lg:gap-y-section">

      {/* This device */}
      <div
        data-testid="this-device"
        className="mt-stack rounded-2xl border border-ember/30 lg:col-start-1 lg:row-start-1 lg:mt-0 bg-linear-to-br from-ember/20 via-ember/5 to-card p-page shadow-soft"
      >
        <div className="flex items-center gap-row">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-ember/20 text-ember" aria-hidden>
            <DeviceIcon kind={hereKind} className="size-7" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-widest text-ember">This device</div>
            <div className="truncate text-lg font-bold">{here ? deviceTitle(here) : 'This browser'}</div>
          </div>
        </div>
        <div className="mt-block flex flex-wrap gap-cluster">
          <Pill tone="ember">Active now</Pill>
          {webVersion && webVersion !== 'unknown' && <Pill>Web {webVersion}</Pill>}
          {appVersion && <Pill>App {appVersion}</Pill>}
        </div>
      </div>

      {/* Sign in another device */}
      <div
        data-testid="signin-card"
        className="mt-stack rounded-2xl bg-background bg-linear-to-br lg:col-start-2 lg:row-start-1 lg:mt-0 from-ember to-ember/70 p-page text-ember-foreground shadow-soft"
      >
        <span className="grid size-14 place-items-center rounded-2xl bg-ember-foreground text-ember" aria-hidden>
          <ScanQrIcon className="size-8" />
        </span>
        <h3 className="mt-row text-lg font-bold">Sign in another device</h3>
        <p className="mt-inset text-sm opacity-90">
          {canScan
            ? 'Open Ember on the new device, then scan the QR code it shows.'
            : 'Open Ember on the new device, then type the code it shows here.'}
        </p>
        {canScan && (
          <>
            <Button
              type="button"
              data-testid="scan-qr"
              onClick={() => setQrScan('native')}
              className="mt-block h-11 w-full bg-ember-foreground text-ember hover:bg-ember-foreground/90"
            >
              <CameraIcon className="size-5" />
              {SCAN_QR_LABEL}
            </Button>
            <Button
              type="button"
              aria-expanded={codeOpen}
              onClick={() => {
                setCodeOpen((o) => !o);
                setCodeError('');
              }}
              className="mt-cluster h-11 w-full bg-ember-foreground/15 text-ember-foreground hover:bg-ember-foreground/25"
            >
              {codeOpen ? 'Hide code entry' : 'Type the code instead'}
            </Button>
          </>
        )}
        {showCode && (
          <form onSubmit={submitCode} className="mt-row flex gap-cluster">
            <Label htmlFor="qr-code-input" className="sr-only">
              Code
            </Label>
            <Input
              id="qr-code-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value.toUpperCase())}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              aria-invalid={codeError ? true : undefined}
              className="h-11 min-w-0 flex-1 border-transparent bg-background/30 font-mono tracking-widest text-ember-foreground placeholder:text-ember-foreground/60 focus-visible:ring-ember-foreground aria-invalid:ring-ember-foreground"
            />
            <Button type="submit" className="h-11 bg-ember-foreground text-ember hover:bg-ember-foreground/90">
              Continue
            </Button>
          </form>
        )}
        {codeError && (
          <div role="alert" className="mt-cluster text-sm font-semibold">
            {codeError}
          </div>
        )}
      </div>

      {/* Other devices */}
      <div data-testid="other-devices" className="mt-section lg:col-start-1 lg:row-start-2 lg:mt-0">
        <div className="flex items-baseline justify-between gap-cluster text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <h3>Other devices</h3>
          {recent !== null && <span data-testid="other-count">{rows.length}</span>}
        </div>
        <p className="mt-inset text-sm text-muted-foreground">Signed in with a code in the last 30 days.</p>
        {rows.length > 0 ? (
          <ul className="mt-block grid gap-cluster">
            {rows.map((s) => {
              const isNew = s.id === fresh?.id;
              return (
                <li
                  key={s.id}
                  ref={isNew ? freshRef : undefined}
                  data-testid={isNew ? 'device-new' : 'device-row'}
                  className={cn(
                    'flex items-center gap-row rounded-xl p-row text-sm',
                    isNew ? 'ember-just-approved bg-ember/10' : 'bg-muted/40',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-12 shrink-0 place-items-center rounded-xl',
                      isNew ? 'bg-ember/15 text-ember' : 'bg-muted text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    <DeviceIcon kind={describeDevice(s.device).kind} className="size-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-cluster">
                      <span className="truncate font-semibold">{deviceTitle(s.device)}</span>
                      {isNew && <Pill tone="solid">New</Pill>}
                    </span>
                    <span className="block text-muted-foreground">
                      Signed in {isNew ? 'just now' : formatSince(s.at) || 'recently'}
                    </span>
                    <span className={cn('block', s.sameNetwork ? 'text-muted-foreground' : 'text-destructive')}>
                      {s.sameNetwork ? 'Same network' : 'Different network'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : recent === null ? (
          <p className="mt-block text-sm text-muted-foreground">Loading...</p>
        ) : (
          <p className="mt-block text-sm text-muted-foreground">No other devices signed in with a code yet.</p>
        )}
      </div>

      {/* Danger zone */}
      <div data-testid="danger-zone" className="mt-section rounded-2xl lg:col-start-2 lg:row-start-2 lg:mt-0 border border-destructive/45 bg-destructive/10 p-page">
        <div className="flex items-center gap-cluster text-destructive">
          <ShieldWarningIcon className="size-6" />
          <h3 className="font-semibold">Danger zone</h3>
        </div>
        <p className="mt-cluster text-sm text-muted-foreground">
          Lost a phone, or signed in somewhere you no longer use? End every session of your account.
        </p>
        <Button
          variant="outline"
          className="mt-block h-11 w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            setRevokeError('');
            setConfirming(true);
          }}
        >
          Sign out everywhere
        </Button>
      </div>
      </div>

      {/* Desktop: a dialog in the middle like every other confirm (it used to
          be this bottom sheet there too, cut off by the screen edge); a
          phone keeps the sheet. */}
      {isDesktop ? (
        <Dialog open={confirming} onOpenChange={(open) => !revoking && setConfirming(open)}>
          <DialogContent
            showCloseButton={false}
            data-testid="sign-out-everywhere-sheet"
            className="gap-block p-page sm:max-w-lg"
          >
            {confirmBody(DialogTitle, DialogDescription)}
          </DialogContent>
        </Dialog>
      ) : (
        <Sheet open={confirming} onOpenChange={(open) => !revoking && setConfirming(open)}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            data-testid="sign-out-everywhere-sheet"
            className="mx-auto max-h-[85vh] w-full max-w-lg gap-block overflow-y-auto rounded-t-2xl p-page"
          >
            {confirmBody(SheetTitle, SheetDescription)}
          </SheetContent>
        </Sheet>
      )}
    </section>
  );
}

function Pill({ tone, children }: { tone?: 'ember' | 'solid'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-cluster py-inset text-xs font-bold uppercase tracking-wide',
        tone === 'solid' ? 'bg-ember text-ember-foreground' : tone === 'ember' ? 'bg-ember/15 text-ember' : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function Chip({ kind, children }: { kind: DeviceKind; children: ReactNode }) {
  return (
    <li className="flex items-center gap-inset rounded-full bg-muted px-row py-inset text-xs text-muted-foreground">
      <DeviceIcon kind={kind} className="size-4" />
      {children}
    </li>
  );
}
