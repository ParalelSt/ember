'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import { usePlayer } from '@/components/player/PlayerProvider';
import { useQueryLyrics } from '@/hooks/useLyrics';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LyricsSheet({ open, onOpenChange }: Props) {
  const { current } = usePlayer();
  const { data, isLoading, error } = useQueryLyrics(current, open);

  const [reportOpen, setReportOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/lyrics-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          trackTitle: current.title,
          trackArtist: current.artist,
          source: data?.source ?? 'unknown',
          note,
          lyrics: data?.lyrics ?? '',
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Request failed: ${res.status}`);
      }
      toast.success('Report sent — thanks');
      setNote('');
      setReportOpen(false);
    } catch (err) {
      toast.error(`Couldn't send: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const hasLyrics = !!current && !!data?.lyrics;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:w-md sm:max-w-[90vw] flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border p-0"
        >
          <SheetHeader className="px-4 py-4 border-b border-sidebar-border">
            <SheetTitle className="text-base">Lyrics</SheetTitle>
          </SheetHeader>

          {current && (
            <div className="px-4 py-3 border-b border-sidebar-border flex items-center gap-3">
              {current.artworkUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.artworkUrl}
                  alt=""
                  className="h-12 w-12 rounded shrink-0 object-cover bg-black"
                />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{current.title}</div>
                <div className="truncate text-xs text-sidebar-foreground/55">{current.artist}</div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-5">
            {!current && (
              <div className="text-sidebar-foreground/55 text-sm py-12 text-center">
                Play a track to see its lyrics.
              </div>
            )}

            {current && isLoading && (
              <div className="text-sidebar-foreground/55 text-sm py-12 text-center">
                Looking up the lyrics…
              </div>
            )}

            {current && error && (
              <div className="text-destructive text-sm py-12 text-center">
                Couldn&apos;t fetch lyrics: {(error as Error).message}
              </div>
            )}

            {current && data && data.lyrics && (
              <>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-sidebar-foreground">
                  {data.lyrics}
                </pre>
                {data.url && (
                  <a
                    href={data.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 inline-block text-xs uppercase tracking-widest text-sidebar-foreground/55 hover:text-sidebar-foreground transition-colors"
                  >
                    Source: Genius
                  </a>
                )}
              </>
            )}

            {current && data && !data.lyrics && (
              <div className="text-sidebar-foreground/55 text-sm py-12 text-center">
                No lyrics found for this track.
              </div>
            )}
          </div>

          {hasLyrics && (
            <div className="border-t border-sidebar-border px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReportOpen(true)}
                className="text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground"
              >
                Report incorrect lyrics
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitReport}>
            <DialogHeader>
              <DialogTitle>Report wrong lyrics</DialogTitle>
              <DialogDescription>
                What&apos;s wrong with the lyrics for &quot;{current?.title}&quot;? Goes to the project&apos;s Discord channel.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. The chorus is wrong / different song / wrong artist / missing the second verse…"
              maxLength={1000}
              rows={5}
              className="mt-4"
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setReportOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !note.trim()} className="bg-ember hover:bg-ember-soft text-white">
                Send
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
