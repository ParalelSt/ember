'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Artwork } from '@/components/primitives/Artwork';
import { ArrowDownIcon, ArrowUpIcon, GripIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';

export interface ReorderListProps {
  tracks: Track[];
  /** Move the song at `from` to `to` (0-based, the list after the move). */
  onMove: (from: number, to: number) => void;
}

/** Presentational only: a playlist's songs in Edit order mode. Every row
 *  has up and down arrows and a drag handle; no heart, no number, nothing
 *  plays. A drag reorders the list under the finger as it goes. The page
 *  keeps the order and saves it on Done. */
export function ReorderList({ tracks, onMove }: ReorderListProps) {
  const rows = useRef(new Map<string, HTMLDivElement>());
  const [dragId, setDragId] = useState<string | null>(null);
  // The listeners below outlive a render: they read the latest list here.
  const latest = useRef({ tracks, onMove });
  useEffect(() => {
    latest.current = { tracks, onMove };
  });

  useEffect(() => {
    if (!dragId) return;
    const move = (ev: PointerEvent) => {
      const { tracks: list, onMove: moveTo } = latest.current;
      const from = list.findIndex((t) => t.id === dragId);
      if (from < 0) return;
      let to = 0;
      for (const t of list) {
        if (t.id === dragId) continue;
        const box = rows.current.get(t.id)?.getBoundingClientRect();
        if (box && box.top + box.height / 2 < ev.clientY) to++;
      }
      if (to !== from) moveTo(from, to);
    };
    const end = () => setDragId(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragId]);

  const startDrag = (id: string) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragId(id);
  };

  return (
    <div data-testid="reorder-list" className="flex flex-col">
      {tracks.map((t, i) => (
        <div
          key={t.id}
          ref={(el) => {
            if (el) rows.current.set(t.id, el);
            else rows.current.delete(t.id);
          }}
          data-testid="reorder-row"
          data-dragging={dragId === t.id ? 'true' : undefined}
          className={cn(
            'flex min-h-14 items-center gap-row rounded-md px-row py-cluster transition-colors',
            dragId === t.id ? 'bg-card shadow-soft' : 'hover:bg-card/60',
          )}
        >
          <Artwork src={t.artworkUrl} size="xs" className="shrink-0 rounded bg-art" />
          <div className="min-w-0 flex-1">
            <div data-testid="reorder-title" className="truncate text-sm font-medium">{t.title}</div>
            <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
          </div>
          <div className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              className="size-hit md:size-8 text-muted-foreground"
              aria-label={`Move ${t.title} up`}
              disabled={i === 0}
              onClick={() => onMove(i, i - 1)}
            >
              <ArrowUpIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-hit md:size-8 text-muted-foreground"
              aria-label={`Move ${t.title} down`}
              disabled={i === tracks.length - 1}
              onClick={() => onMove(i, i + 1)}
            >
              <ArrowDownIcon className="size-4" />
            </Button>
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Drag ${t.title}`}
              onPointerDown={startDrag(t.id)}
              className="grid size-hit md:size-8 cursor-grab touch-none select-none place-items-center text-muted-foreground active:cursor-grabbing"
            >
              <GripIcon className="size-4" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
