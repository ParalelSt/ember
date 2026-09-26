'use client';

import { useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  /** Awaited; the dialog closes once it resolves and stays open if it throws. */
  onRename: (name: string) => Promise<unknown>;
}

/** The owner's Rename, from the playlist menu. */
export function RenamePlaylistDialog({ open, onOpenChange, name, onRename }: Props) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  // A fresh open starts from the current name (adjusted during render, as
  // CreatePlaylistDialog does, so the last attempt never paints).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(name);
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (!next || busy) return;
    if (next === name) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    try {
      await onRename(next);
      onOpenChange(false);
    } catch {
      // The caller said why; keep the dialog open to try again.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="rename-dialog">
        <form onSubmit={submit} className="flex flex-col gap-block">
          <DialogHeader>
            <DialogTitle>Rename playlist</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="Playlist name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={200}
            required
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="ember" disabled={busy || !value.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
