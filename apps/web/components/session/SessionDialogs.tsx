'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { useSessionStore } from '@/stores/useSessionStore';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Host: name the session, optionally seed it from a playlist, go live. */
export function StartSessionDialog({ open, onOpenChange }: DialogProps) {
  const router = useRouter();
  const { data: playlists = [] } = useQueryPlaylists();
  const setHostingSessionId = useSessionStore((s) => s.setHostingSessionId);
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
      setHostingSessionId(session.id);
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
          <Button onClick={() => void start()} disabled={busy} className="bg-ember hover:bg-ember-soft text-white">
            {busy ? 'Starting…' : 'Go live'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Guest: enter the 6-char code from the host. */
export function JoinSessionDialog({ open, onOpenChange }: DialogProps) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    try {
      const { session } = await api.joinSession(code);
      onOpenChange(false);
      router.push(`/session/${session.id}`);
    } catch (e) {
      // 404 message from the server is already user-friendly.
      toast.error((e as Error).message || "Couldn't join — check the code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Join a session</DialogTitle>
          <DialogDescription>Ask the host for the 6-character code.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && code.trim()) void join();
          }}
          placeholder="e.g. K7MPQ4"
          maxLength={8}
          className="mt-2 tracking-[0.3em] text-center uppercase"
        />
        <DialogFooter>
          <Button onClick={() => void join()} disabled={busy || !code.trim()} className="bg-ember hover:bg-ember-soft text-white">
            {busy ? 'Joining…' : 'Join'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
