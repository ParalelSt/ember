'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FlameIcon } from '@/components/icons';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') ?? '/';

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password);
        if (error) {
          setErr(error.message);
        } else {
          router.push(next);
          router.refresh();
        }
      } else {
        const { error, needsConfirmation } = await signUp(email, password);
        if (error) setErr(error.message);
        else if (needsConfirmation) {
          setErr('Account created — check your inbox to confirm your email.');
        } else {
          router.push(next);
          router.refresh();
        }
      }
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklab,var(--ember)_18%,transparent),transparent_60%)]">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-soft">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-3">
          <FlameIcon className="h-3.5 w-3.5 text-ember" />
          Ember
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {mode === 'signin' ? 'Welcome back' : 'Create account'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === 'signin' ? 'Sign in to continue' : 'Sign up to save playlists and likes'}
        </p>

        <div className="mt-6 grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="mt-3 grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" disabled={busy} className="mt-6 w-full bg-ember hover:bg-ember-soft text-white">
          {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </Button>

        {err && (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
