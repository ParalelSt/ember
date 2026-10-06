'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { api } from '@/lib/api';
import { useQueryPlaylists } from '@/hooks/useLibrary';
import { startHosting } from '@/hooks/useSessionHost';
import { liveCarlistKey } from '@/hooks/useSession';
import { parseJoinInput } from '@/lib/carlist';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Host: name the session, optionally seed it from a playlist, go live. */
export function StartSessionDialog({ open, onOpenChange }: DialogProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: playlists = [] } = useQueryPlaylists();
  const [name, setName] = useState('');
  const [seedId, setSeedId] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const { session } = await api.createSession({
        name: name.trim() || undefined,
        seedPlaylistId: seedId || undefined,
      });
      startHosting(session.id);
      void qc.invalidateQueries({ queryKey: liveCarlistKey });
      toast.success(`Session live — code ${session.code}`);
      onOpenChange(false);
      router.push(`/session/${session.id}`);
    } catch {
      toast.error("Couldn't start the session — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a session</DialogTitle>
          <DialogDescription>
            Your phone plays the music; everyone with the code can add songs and skip.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Session name (e.g. Roadtrip)"
            maxLength={120}
          />
          <select
            value={seedId}
            onChange={(e) => setSeedId(e.target.value)}
            className="h-9 rounded-md bg-card px-3 text-sm text-foreground border-0 outline-none"
            aria-label="Seed from playlist"
          >
            <option value="">Start with an empty queue</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                Seed from: {p.name}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <Button onClick={() => void start()} disabled={busy} variant="ember">
            {busy ? 'Starting…' : 'Go live'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Guest: the host's link or QR code joins straight away
 *  (app/(app)/session/join/[code]); typing the 6-character code, or pasting
 *  the link, here is the fallback. */
export function JoinSessionDialog({ open, onOpenChange }: DialogProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const code = parseJoinInput(input);

  const join = async () => {
    if (!code) {
      toast.error("That isn't a join code. It has 6 letters and numbers.");
      return;
    }
    setBusy(true);
    try {
      const { session } = await api.joinSession(code);
      void qc.invalidateQueries({ queryKey: liveCarlistKey });
      onOpenChange(false);
      router.push(`/session/${session.id}`);
    } catch (e) {
      // 404 message from the server is already user-friendly.
      toast.error((e as Error).message || "Couldn't join. Check the code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Join a carlist</DialogTitle>
          <DialogDescription>
            Scan the host&apos;s QR code or open their link. Or type the 6-character code here.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          aria-label="Join code"
          value={input}
          onChange={(e) => {
            const v = e.target.value;
            // A pasted link stays as it is; a typed code shows in capitals.
            setInput(/[/:]/.test(v) ? v : v.toUpperCase());
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) void join();
          }}
          placeholder="e.g. K7MPQ4"
          maxLength={300}
          autoComplete="off"
          autoCapitalize="characters"
          className={cn('mt-2 text-center', !/[/:]/.test(input) && 'tracking-[0.3em]')}
        />
        <DialogFooter>
          <Button onClick={() => void join()} disabled={busy || !input.trim()} variant="ember">
            {busy ? 'Joining…' : 'Join'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
