'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { logger } from '@/lib/logger/client';

type Kind = 'feature' | 'fix';

const MAX_NAME = 80;
const MAX_MAIN = 2000;
const MAX_EXTRA = 2000;

interface Copy {
  nameLabel: string;
  namePlaceholder: string;
  mainLabel: string;
  mainPlaceholder: string;
  extraPlaceholder: string;
}

const COPY: Record<Kind, Copy> = {
  feature: {
    nameLabel: 'Name',
    namePlaceholder: 'Short name, e.g. Sleep timer',
    mainLabel: 'Description',
    mainPlaceholder:
      'What should it do, and when would you use it? e.g. Stop playback after 30 minutes so I can fall asleep to music.',
    extraPlaceholder: 'Examples from other apps, edge cases.',
  },
  fix: {
    nameLabel: 'Name',
    namePlaceholder: 'What needs fixing, e.g. Queue jumps to the top',
    mainLabel: 'Recommended approach',
    mainPlaceholder:
      "What happens now and what you'd expect instead. For UI: what you'd see, where, and how it should work.",
    extraPlaceholder: 'Steps, device, how often it happens.',
  },
};

interface RequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RequestDialog({ open, onOpenChange }: RequestDialogProps) {
  const [kind, setKind] = useState<Kind>('feature');
  const [name, setName] = useState('');
  const [main, setMain] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = COPY[kind];
  const canSend = name.trim().length > 0 && main.trim().length > 0 && !busy;

  const reset = () => {
    setKind('feature');
    setName('');
    setMain('');
    setExtra('');
    setError(null);
  };

  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const snapshot = logger.snapshot();
      const { appVersion, shell, route, platform } = snapshot.context;
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          kind,
          name: name.trim(),
          main: main.trim(),
          extra: extra.trim() || undefined,
          context: { appVersion, shell, route, platform },
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
        throw new Error(err.error || `Failed: ${res.status}`);
      }
      toast.success('Thanks, request sent');
      reset();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send a request</DialogTitle>
          <DialogDescription>
            New features and fixes go to the project&apos;s Discord, each to its own channel.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 flex flex-col gap-4">
          <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <TabsList className="w-full">
              <TabsTrigger value="feature">New feature</TabsTrigger>
              <TabsTrigger value="fix">Fix</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-name">{copy.nameLabel}</Label>
            <Input
              id="request-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
              placeholder={copy.namePlaceholder}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-main">{copy.mainLabel}</Label>
            <Textarea
              id="request-main"
              value={main}
              onChange={(e) => setMain(e.target.value.slice(0, MAX_MAIN))}
              placeholder={copy.mainPlaceholder}
              rows={4}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-extra">Anything else (optional)</Label>
            <Textarea
              id="request-extra"
              value={extra}
              onChange={(e) => setExtra(e.target.value.slice(0, MAX_EXTRA))}
              placeholder={copy.extraPlaceholder}
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSend}
              className="bg-ember hover:bg-ember-soft text-white"
            >
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
