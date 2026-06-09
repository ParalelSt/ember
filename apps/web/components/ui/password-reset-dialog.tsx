'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EyeIcon, EyeOffIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

const MIN_LEN = 8;
const MAX_LEN = 71;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetEmail: string;
  isSelfReset: boolean;
  /** Called when the user submits. The dialog awaits the promise and closes
   *  on resolve. Throw to keep it open (e.g. on a server error). */
  onSubmit: (password: string) => void | Promise<void>;
}

/** Admin-only modal for overwriting another user's (or own) password.
 *
 *  Parent should mount with `key={target.id}` so a new target gets fresh
 *  internal state — avoids useEffect resets that trip the
 *  react-hooks/set-state-in-effect lint rule. */
export function PasswordResetDialog({
  open,
  onOpenChange,
  targetEmail,
  isSelfReset,
  onSubmit,
}: Props) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const trimLen = password.trim().length;
  const valid = trimLen > 0 && password.length >= MIN_LEN && password.length <= MAX_LEN;

  const validationMessage =
    !touched || valid
      ? ''
      : password.length === 0
        ? 'Password is required'
        : password.length < MIN_LEN
          ? `Minimum ${MIN_LEN} characters`
          : trimLen === 0
            ? 'Password cannot be only whitespace'
            : `Maximum ${MAX_LEN} characters`;

  const handleSubmit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSubmit(password);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset password for {targetEmail}</DialogTitle>
          <DialogDescription>
            The user&apos;s existing sessions will be invalidated.
          </DialogDescription>
        </DialogHeader>

        {isSelfReset && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            You&apos;ll be signed out after saving. Log back in with your new password.
          </div>
        )}

        <div className="relative mt-2">
          <Input
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid && !busy) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            maxLength={MAX_LEN}
            disabled={busy}
            placeholder={`New password (min ${MIN_LEN} characters)`}
            autoFocus
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={show ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {show ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          </button>
        </div>

        {validationMessage && (
          <p className="text-xs text-destructive">{validationMessage}</p>
        )}

        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || busy}
            className={cn('bg-ember hover:bg-ember-soft text-white', busy && 'opacity-70')}
          >
            {busy ? '…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
