'use client';

import { useMemo, useState, type FormEvent } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { useUiStore } from '@/stores/useUiStore';
import { logger } from '@/lib/logger/client';

const MAX_NOTE = 1000;

export function BugReportDialog() {
  const open = useUiStore((s) => s.bugReportOpen);
  const setOpen = useUiStore((s) => s.setBugReportOpen);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Snapshot is recomputed every render the dialog is open so the counts shown
  // reflect activity right up to the moment the user opens it.
  const counts = useMemo(() => {
    if (!open) return { current: 0, previous: 0 };
    const s = logger.snapshot();
    return { current: s.current.length, previous: s.previous.length };
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const snapshot = logger.snapshot();
      const res = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ note: note.trim() || undefined, client: snapshot }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
        throw new Error(err.error || `Failed: ${res.status}`);
      }
      toast.success('Report sent');
      setNote('');
      setOpen(false);
    } catch (e) {
      toast.error(`Couldn't send report: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>
            Sends diagnostic logs to the host&apos;s Discord channel along with your note.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 flex flex-col gap-4">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
            placeholder="What happened? (optional)"
            rows={4}
          />
          <div className="text-xs text-muted-foreground">
            Diagnostic data: <span className="text-foreground">{counts.current}</span> events from this session,
            {' '}<span className="text-foreground">{counts.previous}</span> from your last session.
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="bg-ember hover:bg-ember-soft text-white"
            >
              {busy ? 'Sending…' : 'Send report'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
