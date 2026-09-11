'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Artwork } from '@/components/primitives/Artwork';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/format';
import type { Track } from '@/types/track';

// A single stable reference for "no candidates yet": `data: candidates =
// []` would create a NEW array literal every render while the query is
// loading, which broke the render-time reset below (the `!==` check saw a
// fresh array every time and looped forever).
const EMPTY: Track[] = [];

interface Props {
  track: Track | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (replacement: Track) => Promise<void>;
}

/** Picks a fresh YouTube upload to stand in for a track the server has
 *  confirmed is dead. This always asks for a click rather than auto-swapping
 *  the top match: a wrong guess would silently change what's in someone's
 *  playlist, and the candidates are frequently different covers/live
 *  versions/remasters that look alike but aren't interchangeable. */
export function ReplaceTrackDialog({ track, open, onOpenChange, onConfirm }: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['replacements', track?.id],
    queryFn: () => api.getReplacements(track!.id).then((r) => r.candidates),
    enabled: open && !!track,
    staleTime: 60_000,
  });
  const candidates = data ?? EMPTY;

  // Default to the top (best) candidate whenever a fresh list arrives. Adjusted
  // during render (rather than an effect) per the "adjusting state when a prop
  // changes" pattern: an effect here would flash the empty state for a frame.
  const [seenCandidates, setSeenCandidates] = useState(candidates);
  if (candidates !== seenCandidates) {
    setSeenCandidates(candidates);
    setPickedId(candidates[0]?.id ?? null);
  }

  // Roving tabindex: only the checked radio is in the tab order (per the
  // WAI-ARIA radiogroup pattern), and ArrowUp/ArrowDown both move the
  // selection and move focus with it, wrapping at the ends.
  const radioRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const moveSelection = (delta: number) => {
    const idx = candidates.findIndex((c) => c.id === pickedId);
    const next = candidates[(idx + delta + candidates.length) % candidates.length];
    if (!next) return;
    setPickedId(next.id);
    radioRefs.current[next.id]?.focus();
  };
  const onRadioGroupKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
  };

  const handleConfirm = async () => {
    const picked = candidates.find((c) => c.id === pickedId);
    if (!picked) return;
    setSubmitting(true);
    try {
      await onConfirm(picked);
      onOpenChange(false);
    } catch {
      toast.error("Couldn't replace that. Reload and try again.");
      // Keep the dialog open: the picked candidate stays selected so the
      // listener can just retry instead of re-picking from scratch.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{track ? `Replace "${track.title}"` : 'Replace'}</DialogTitle>
          <DialogDescription>Same song, different upload. Pick the one to keep in this list.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Searching YouTube...</div>
        ) : candidates.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No match found on YouTube. You can remove the song instead.
          </div>
        ) : (
          <div
            role="radiogroup"
            onKeyDown={onRadioGroupKeyDown}
            className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto -mx-1 px-1"
          >
            {candidates.map((c) => {
              const checked = c.id === pickedId;
              return (
                <button
                  key={c.id}
                  ref={(el) => { radioRefs.current[c.id] = el; }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => setPickedId(c.id)}
                  className={`flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-card ${checked ? 'bg-card ring-1 ring-ember' : ''}`}
                >
                  <Artwork
                    src={c.artworkUrl}
                    size="xs"
                    className={c.artworkUrl ? 'rounded shrink-0 bg-black' : 'rounded shrink-0 bg-card'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.artist}</div>
                  </div>
                  <div className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatTime(c.durationSec, { empty: '--:--' })}</div>
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!pickedId || submitting}>
            {submitting ? 'Replacing…' : 'Replace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
