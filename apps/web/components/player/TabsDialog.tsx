'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TabViewer } from '@/components/player/TabViewer';
import { api } from '@/lib/api';
import type { Track } from '@/types/track';

interface Props {
  track: Track | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Guitar tabs for the playing track.
 *
 *  Two sources, in this order:
 *   1. Your own Guitar Pro files, rendered right here by AlphaTab.
 *   2. Songsterr, which can only ever be a link: it sends
 *      `X-Frame-Options: deny` and the notation is its licensed content.
 *
 *  So Songsterr answers "which song is this", and a file you supply answers
 *  "what are the notes". */
export function TabsDialog({ track, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<{ id: string; url: string; title: string } | null>(null);

  // The viewer's own Next/Previous change the song. A tab for the old song
  // must not stay open over the new one, so fall back to the list, which is
  // keyed to whatever is playing now.
  const [viewingFor, setViewingFor] = useState<string | null>(null);
  if (viewing && viewingFor !== (track?.id ?? null)) {
    setViewing(null);
  }
  const openViewer = (v: { id: string; url: string; title: string }) => {
    setViewingFor(track?.id ?? null);
    setViewing(v);
  };

  const { data: myTabs = [] } = useQuery({
    queryKey: ['tab-files', track?.title, track?.artist],
    queryFn: () => api.getTabFiles(track?.title, track?.artist).then((r) => r.tabs),
    enabled: open && !!track?.title,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', track?.title ?? file.name);
      form.append('artist', track?.artist ?? '');
      const res = await fetch('/api/tabs/files', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'That file could not be added.');
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tab-files'] }),
  });
  const { data: matches = [], isFetching } = useQuery({
    queryKey: ['tabs', track?.id],
    queryFn: () => api.getTabs(track!.title, track!.artist).then((r) => r.matches),
    enabled: open && !!track?.title,
    staleTime: 60 * 60 * 1000,
  });

  const canGenerate = !!track && (track.source === 'youtube' || track.source === 'upload');
  const { data: generated } = useQuery({
    queryKey: ['generated-tab', track?.id],
    queryFn: () => api.getGeneratedTab(track!.id),
    enabled: open && canGenerate,
    // Poll only while a job is running; a finished or absent tab does not change.
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 5000 : false),
  });
  const generate = useMutation({
    mutationFn: () => api.generateTab(track!.id, track!.title),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['generated-tab', track?.id] }),
  });

  const body = isFetching && matches.length === 0 ? (
    <div className="py-10 text-center text-sm text-muted-foreground">Looking for tabs…</div>
  ) : matches.length === 0 ? (
    <div className="py-10 text-center text-sm text-muted-foreground">
      No tabs found for this song.
    </div>
  ) : (
    <div className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto -mx-1 px-1">
      {matches.map((m) => (
        <a
          key={m.id}
          href={m.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-card transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{m.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {m.artist}
              {m.instruments.length > 0 && ` · ${m.instruments.join(', ')}`}
            </div>
          </div>
          {m.hasChords && (
            <span className="shrink-0 rounded bg-ember/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ember">
              chords
            </span>
          )}
        </a>
      ))}
    </div>
  );

  /** The recording itself as the source. It takes minutes, so the button is
   *  honest about that, and the row only appears once the file exists. */
  const fromRecording = canGenerate && (
    <div>
      <div className="px-1 pb-1 text-xs uppercase tracking-wide text-muted-foreground">
        From the recording
      </div>
      {generated?.status === 'ready' ? (
        <button
          type="button"
          onClick={() =>
            openViewer({
              id: `generated:${track!.id}`,
              url: `/api/tabs/generated/${encodeURIComponent(track!.id)}`,
              title: track!.title,
            })
          }
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-card transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">Guitar · generated</div>
            <div className="truncate text-xs text-muted-foreground">
              Transcribed from this recording. Rough in places.
            </div>
          </div>
          <span className="shrink-0 rounded bg-ember/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ember">
            open
          </span>
        </button>
      ) : generated?.status === 'running' || generate.isPending ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          Transcribing… this takes a few minutes.
        </div>
      ) : (
        <div className="flex flex-col gap-1 px-1">
          {generated?.status === 'failed' && (
            <div className="text-xs text-destructive">{generated.error ?? 'The last attempt failed.'}</div>
          )}
          {generate.error && (
            <div className="text-xs text-destructive">{(generate.error as Error).message}</div>
          )}
          <Button size="sm" variant="outline" className="self-start" onClick={() => generate.mutate()}>
            Generate guitar tab
          </Button>
          <div className="text-xs text-muted-foreground">
            Listens to the song and writes a tab. A few minutes; rough in places.
          </div>
        </div>
      )}
    </div>
  );

  const mine = (
    <div className="flex flex-col gap-1">
      {myTabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => openViewer({ id: t.id, url: t.downloadUrl, title: t.title })}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-card transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{t.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {t.instrument ? `${t.instrument} · ` : ''}
              {t.ext.replace('.', '').toUpperCase()} file
            </div>
          </div>
          <span className="shrink-0 rounded bg-ember/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ember">
            open
          </span>
        </button>
      ))}
      <input
        ref={fileRef}
        type="file"
        accept=".gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml,.mxl"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = '';
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="self-start mt-1"
        disabled={upload.isPending}
        onClick={() => fileRef.current?.click()}
      >
        {upload.isPending ? 'Adding…' : 'Add a Guitar Pro or MusicXML file'}
      </Button>
      {upload.error && (
        <div className="text-xs text-destructive px-1">{(upload.error as Error).message}</div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={viewing ? 'sm:max-w-4xl' : 'sm:max-w-lg'}>
        <DialogHeader>
          <DialogTitle>{viewing ? viewing.title : 'Guitar tabs'}</DialogTitle>
          <DialogDescription>
            {viewing
              ? viewing.id.startsWith('generated:')
                ? 'Transcribed from the recording. Nudge the sync if it drifts.'
                : 'Your Guitar Pro file, rendered here.'
              : track
                ? `Tabs for "${track.title}": generated or yours render here, Songsterr opens in a browser.`
                : 'Nothing playing.'}
          </DialogDescription>
        </DialogHeader>

        {viewing ? (
          <TabViewer url={viewing.url} tabId={viewing.id} onBack={() => setViewing(null)} />
        ) : (
          <div className="flex flex-col gap-4">
            {fromRecording}
            {mine}
            <div>
              <div className="px-1 pb-1 text-xs uppercase tracking-wide text-muted-foreground">
                On Songsterr
              </div>
              {body}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
