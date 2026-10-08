'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { ApproveSignIn } from '@/components/auth/ApproveSignIn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionHeader } from '@/components/page/SectionHeader';
import { normalizeCode } from '@/lib/qrLogin/codes';
import { qrPost } from '@/lib/qrLogin/client';
import { parsePbDate } from '@/lib/qrLogin/state';
import { cn } from '@/lib/utils';

interface SignIn {
  id: string;
  device: string;
  at: string;
  sameNetwork: boolean;
}

/** Settings > Devices (plan 1c): sign in another device by typing the code
 *  it shows, see the devices signed in that way, and sign out everywhere. */
export function DevicesPanel() {
  const { signOut } = useAuth();
  const [typed, setTyped] = useState('');
  const [codeError, setCodeError] = useState('');
  // A new card per Continue, so the same code can be looked up again.
  const [credential, setCredential] = useState<{ code: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [recent, setRecent] = useState<SignIn[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState('');

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

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeCode(typed);
    if (!code) {
      setCodeError('Codes are 8 letters and digits, like ABCD-EFGH.');
      setCredential(null);
      return;
    }
    setCodeError('');
    setCredential({ code });
    setAttempt((a) => a + 1);
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
          On the new device, open Ember and pick &quot;Sign in with your phone&quot;. Scan its QR code with your camera, or
          type the code it shows here.
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
        </form>
        {codeError && <div className="mt-cluster text-sm text-destructive">{codeError}</div>}
        {credential && (
          <div className="mt-block">
            <ApproveSignIn key={attempt} credential={credential} />
          </div>
        )}
      </div>

      <div className="mt-stack rounded-2xl bg-card p-page shadow-soft">
        <div className="font-semibold">Recent sign-ins</div>
        {recent === null ? (
          <p className="mt-inset text-sm text-muted-foreground">Loading...</p>
        ) : recent.length === 0 ? (
          <p className="mt-inset text-sm text-muted-foreground">No devices signed in with a code yet.</p>
        ) : (
          <ul className="mt-block grid gap-cluster">
            {recent.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-cluster text-sm">
                <span className="font-semibold">{s.device}</span>
                <span className="text-muted-foreground">
                  {new Date(parsePbDate(s.at)).toLocaleString()}
                  {' · '}
                  <span className={cn(!s.sameNetwork && 'text-destructive')}>
                    {s.sameNetwork ? 'Same network' : 'Different network'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
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
