'use client';

import { useRef, useState } from 'react';
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
import { QK } from '@/hooks/useLibrary';
import { logger } from '@/lib/logger/client';
import { formatCount } from '@/lib/format';
import type { Track } from '@/types/track';
import type { MatchResult, SourceItem } from '@/lib/import/types';
import { SPOTIFY_EMBED_LIMIT } from '@/lib/import/embed';

const MATCH_BATCH = 8;

type Phase =
  | { step: 'idle' }
  | { step: 'inspecting' }
  | {
      step: 'preview';
      source: 'spotify' | 'ytmusic';
      name: string;
      total: number;
      tracks?: Track[];
      items?: SourceItem[];
      truncated?: boolean;
    }
  | { step: 'importing'; name: string; done: number; total: number }
  | { step: 'done'; name: string; added: number; total: number; review: MatchResult[]; misses: MatchResult[] };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Import a public Spotify / YouTube Music playlist from a pasted link.
 *  YTM arrives as ready tracks (one shot); Spotify goes through client-driven
 *  match batches so big playlists never hit one long request. Only confident
 *  matches are added: the rest are listed as "needs review" or "not found"
 *  (the real review screen comes with background imports, docs/imports.md). */
export function ImportPlaylistDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  // Closing the dialog mid-import stops the batch loop.
  const cancelledRef = useRef(false);

  const reset = () => {
    setUrl('');
    setPhase({ step: 'idle' });
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      cancelledRef.current = true;
      reset();
    }
    onOpenChange(o);
  };

  const inspect = async () => {
    setPhase({ step: 'inspecting' });
    try {
      const r = await api.importInspect(url);
      if (r.source === 'ytmusic') {
        setPhase({ step: 'preview', source: 'ytmusic', name: r.name, total: r.tracks.length, tracks: r.tracks });
      } else {
        setPhase({
          step: 'preview',
          source: 'spotify',
          name: r.name,
          total: r.items.length,
          items: r.items,
          truncated: r.truncated,
        });
      }
    } catch (e) {
      // Server messages here are written for users (private, not found, bad
      // link, Spotify unreachable): show them as-is.
      toast.error((e as Error).message);
      setPhase({ step: 'idle' });
    }
  };

  const runImport = async (p: Extract<Phase, { step: 'preview' }>) => {
    cancelledRef.current = false;
    setPhase({ step: 'importing', name: p.name, done: 0, total: p.total });
    logger.breadcrumb('import', 'start', { source: p.source, total: p.total });
    try {
      const { playlist } = await api.createPlaylist(p.name);
      let added = 0;
      let done = 0;
      const review: MatchResult[] = [];
      const misses: MatchResult[] = [];
      const bump = () => {
        done += 1;
        setPhase({ step: 'importing', name: p.name, done, total: p.total });
      };

      const addTrack = async (t: Track) => {
        try {
          await api.addToPlaylist(playlist.id, t);
          added += 1;
        } catch {
          // Duplicate within the source playlist (same song twice): skip.
        }
      };

      if (p.source === 'ytmusic') {
        for (const t of p.tracks ?? []) {
          if (cancelledRef.current) return;
          await addTrack(t);
          bump();
        }
      } else {
        const items = p.items ?? [];
        for (let i = 0; i < items.length; i += MATCH_BATCH) {
          if (cancelledRef.current) return;
          const slice = items.slice(i, i + MATCH_BATCH);
          const { results } = await api.importMatch(slice);
          for (const r of results) {
            if (cancelledRef.current) return;
            if (r.status === 'accepted' && r.candidates[0]) await addTrack(r.candidates[0].track);
            else if (r.status === 'review') review.push(r);
            else misses.push(r);
            bump();
          }
        }
      }

      void qc.invalidateQueries({ queryKey: QK.playlists });
      logger.breadcrumb('import', 'done', {
        source: p.source,
        added,
        total: p.total,
        review: review.length,
        misses: misses.length,
      });
      setPhase({ step: 'done', name: p.name, added, total: p.total, review, misses });
    } catch {
      toast.error('Import failed partway, so the playlist may be incomplete. Try again.');
      void qc.invalidateQueries({ queryKey: QK.playlists });
      setPhase({ step: 'idle' });
    }
  };

  const body = (() => {
    if (phase.step === 'inspecting') {
      return <div className="py-8 text-center text-sm text-muted-foreground">Looking up the playlist...</div>;
    }
    if (phase.step === 'preview') {
      return (
        <div className="py-4">
          <div className="text-sm font-semibold truncate">{phase.name}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {formatCount(phase.total, 'track')} · {phase.source === 'spotify' ? 'Spotify' : 'YouTube Music'}
            {phase.source === 'spotify' && '. Each song is matched on YouTube Music.'}
          </div>
          {phase.truncated && (
            <div className="mt-block text-sm text-muted-foreground">
              Spotify only shares the first {SPOTIFY_EMBED_LIMIT} songs of a playlist through a link, so a longer
              playlist stops there.
            </div>
          )}
        </div>
      );
    }
    if (phase.step === 'importing') {
      const pct = phase.total ? Math.round((phase.done / phase.total) * 100) : 0;
      return (
        <div className="py-4">
          <div className="text-sm text-muted-foreground mb-2">
            Importing {phase.done}/{phase.total}. Keep this open.
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-ember transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    if (phase.step === 'done') {
      return (
        <div className="py-4">
          <div className="text-sm font-semibold">
            Added {phase.added} of {phase.total} to “{phase.name}”
          </div>
          {phase.review.length > 0 && (
            <div className="mt-3">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">
                Needs review ({phase.review.length})
              </div>
              <div className="max-h-40 overflow-y-auto text-sm text-muted-foreground">
                {phase.review.map((r) => {
                  const best = r.candidates[0];
                  return (
                    <div key={`review-${r.item.position}`} className="truncate">
                      {r.item.title}, {r.item.artist}
                      {best && `: maybe “${best.track.title}” by ${best.track.artist} (${best.reasons.join(', ')})`}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {phase.misses.length > 0 && (
            <div className="mt-block">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-cluster">
                Not found ({phase.misses.length})
              </div>
              <div className="max-h-40 overflow-y-auto text-sm text-muted-foreground">
                {phase.misses.map((m) => (
                  <div key={`missing-${m.item.position}`} className="truncate">
                    {m.item.title}, {m.item.artist}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
    return (
      <Input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && url.trim()) void inspect();
        }}
        placeholder="Paste a Spotify or YouTube Music playlist link"
        className="mt-2"
      />
    );
  })();

  const footer = (() => {
    if (phase.step === 'idle') {
      return (
        <Button onClick={() => void inspect()} disabled={!url.trim()} className="bg-ember hover:bg-ember-soft text-white">
          Look up
        </Button>
      );
    }
    if (phase.step === 'preview') {
      return (
        <>
          <Button variant="ghost" onClick={reset}>Back</Button>
          <Button onClick={() => void runImport(phase)} className="bg-ember hover:bg-ember-soft text-white">
            Import {formatCount(phase.total, 'track')}
          </Button>
        </>
      );
    }
    if (phase.step === 'done') {
      return <Button onClick={() => handleOpenChange(false)}>Close</Button>;
    }
    return null;
  })();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import playlist</DialogTitle>
          <DialogDescription>
            Public Spotify and YouTube Music playlists are supported.
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
