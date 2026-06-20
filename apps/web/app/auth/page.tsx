'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FlameIcon } from '@/components/icons';

type Stage =
  | { kind: 'email' }
  | { kind: 'password'; email: string; mode: 'new' | 'existing' };

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  // Only same-origin paths: must start with a single '/' ('//' is a
  // protocol-relative external URL). Anything else → home. Keeps ?next=
  // from being usable as an open redirect.
  const rawNext = search.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const [stage, setStage] = useState<Stage>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const cleaned = email.trim().toLowerCase();
    if (!cleaned) return;
    setBusy(true);
    try {
      const r = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleaned }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${r.status}`);
      }
      const { status } = (await r.json()) as { status: 'new' | 'existing' | 'denied' };
      if (status === 'denied') {
        setErr("This email isn't on the invite list. Ask the project owner to add you.");
        return;
      }
      setStage({ kind: 'password', email: cleaned, mode: status });
      setPassword('');
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (stage.kind !== 'password') return;
    setErr('');
    setBusy(true);
    try {
      const fn = stage.mode === 'existing' ? signIn : signUp;
      const result = await fn(stage.email, password);
      if (result.error) {
        setErr(result.error.message);
      } else {
        router.push(next);
        router.refresh();
      }
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setStage({ kind: 'email' });
    setErr('');
    setPassword('');
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklab,var(--ember)_18%,transparent),transparent_60%)]">
      <form
        onSubmit={stage.kind === 'email' ? submitEmail : submitPassword}
        className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-soft"
      >
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-3">
          <FlameIcon className="h-3.5 w-3.5 text-ember" />
          Ember
        </div>

        {stage.kind === 'email' ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Welcome</h1>
            <p className="mt-1 text-sm text-muted-foreground">Enter your invite email to continue.</p>
            <div className="mt-6 grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy} className="mt-6 w-full bg-ember hover:bg-ember-soft text-white">
              {busy ? '…' : 'Continue'}
            </Button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight">
              {stage.mode === 'existing' ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {stage.mode === 'existing' ? 'Enter your password to log in.' : 'Set a password to register.'}
            </p>
            <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-sm flex items-center justify-between">
              <span className="truncate">{stage.email}</span>
              <button
                type="button"
                onClick={back}
                className="text-xs text-muted-foreground hover:text-foreground shrink-0 ml-2"
              >
                Not you?
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy} className="mt-6 w-full bg-ember hover:bg-ember-soft text-white">
              {busy ? '…' : stage.mode === 'existing' ? 'Log in' : 'Register'}
            </Button>
          </>
        )}

        {err && (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </div>
        )}
      </form>
    </div>
  );
}
