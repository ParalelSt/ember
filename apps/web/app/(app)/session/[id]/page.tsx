'use client';

import { use, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TrackSearchPicker } from '@/components/track/TrackSearchPicker';
import { NextIcon, MusicIcon } from '@/components/icons';
import { useQuerySession, useExecuteAddToSession, useExecuteSkipSession, useExecuteEndSession, useExecuteSaveSession } from '@/hooks/useSession';
import { useSessionHost } from '@/hooks/useSessionHost';
import type { SessionQueueItem, Track } from '@/types/track';
import { cn } from '@/lib/utils';

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = useQuerySession(id);
  const addToSession = useExecuteAddToSession(id);
  const skip = useExecuteSkipSession(id);
  const end = useExecuteEndSession(id);
  const save = useExecuteSaveSession(id);
  const [saved, setSaved] = useState(false);

  // No-op for guests; hosts mirror the queue into their player.
  useSessionHost(data);

  if (error) {
    return <div className="text-muted-foreground py-12 text-center">Session not found.</div>;
  }
  if (isLoading || !data) {
    return <div className="text-muted-foreground py-12 text-center">Loading…</div>;
  }

  const { session, queue } = data;
  const nowItem: SessionQueueItem | undefined = queue[session.nowIndex];

  const handleAdd = async (track: Track) => {
    try {
      await addToSession.mutateAsync(track);
      toast.success(`Added "${track.title}"`);
    } catch {
      toast.error(`Couldn't add "${track.title}" — please try again.`);
    }
  };

  const handleSkip = () => {
    skip.mutate(undefined, {
      onSuccess: () => toast.message('Skip sent'),
      onError: () => toast.error("Couldn't skip — please try again."),
    });
  };

  const handleSave = () => {
    save.mutate(undefined, {
      onSuccess: ({ playlist }) => {
        setSaved(true);
        toast.success(`Saved as playlist "${playlist.name}"`);
      },
      onError: () => toast.error("Couldn't save the playlist — please try again."),
    });
  };

  const handleEnd = () => {
    end.mutate(undefined, {
      onError: () => toast.error("Couldn't end the session — please try again."),
    });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/session/${session.id}`);
      toast.success('Link copied');
    } catch {
      toast.message(`Join code: ${session.code}`);
    }
  };

  const endedBanner = !session.active ? (
    <div className="mb-6 rounded-md bg-card px-4 py-3 text-sm text-muted-foreground">
      This session has ended.{!saved && ' You can still save the queue as a playlist.'}
    </div>
  ) : null;

  const nowPlaying = nowItem ? (
    <div className="mb-6 rounded-md bg-card p-4 flex items-center gap-4">
      {nowItem.track.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={nowItem.track.artworkUrl} alt="" className="h-14 w-14 rounded object-cover bg-black shrink-0" />
      ) : (
        <div className="h-14 w-14 rounded bg-black grid place-items-center text-foreground/20 shrink-0">
          <MusicIcon className="h-6 w-6" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Now playing</div>
        <div className="truncate text-sm font-semibold">{nowItem.track.title}</div>
        <div className="truncate text-xs text-muted-foreground">{nowItem.track.artist} · added by {nowItem.addedByName}</div>
      </div>
      {session.active && (
        <Button onClick={handleSkip} disabled={skip.isPending} className="shrink-0 gap-1.5 bg-ember hover:bg-ember-soft text-white">
          <NextIcon className="h-4 w-4" /> Skip
        </Button>
      )}
    </div>
  ) : (
    <div className="mb-6 rounded-md bg-card px-4 py-6 text-center text-sm text-muted-foreground">
      Nothing queued yet — add the first song below.
    </div>
  );

  const queueRows = queue.map((item, i) => {
    const isNow = i === session.nowIndex;
    const isPast = i < session.nowIndex;
    return (
      <div
        key={item.id}
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-md',
          isNow && 'bg-card text-ember',
          isPast && 'opacity-40',
        )}
      >
        <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{i + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.track.title}</div>
          <div className="truncate text-xs text-muted-foreground">{item.track.artist}</div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{item.addedByName}</span>
      </div>
    );
  });

  return (
    <div className="pt-4 md:pt-0 max-w-2xl">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight truncate">{session.name}</h1>
        {session.isHost && session.active && (
          <Button variant="ghost" onClick={handleEnd} className="shrink-0 text-muted-foreground hover:text-foreground">
            End session
          </Button>
        )}
      </div>
      <div className="mb-6 flex items-center gap-3 text-sm text-muted-foreground">
        <span>Hosted by {session.isHost ? 'you' : session.hostName}</span>
        <span>·</span>
        <button onClick={() => void copyLink()} className="hover:text-foreground underline-offset-2 hover:underline">
          Code {session.code} — copy link
        </button>
      </div>

      {endedBanner}
      {nowPlaying}

      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Queue</h2>
          <Button variant="ghost" size="sm" onClick={handleSave} disabled={save.isPending || saved || queue.length === 0} className="text-muted-foreground hover:text-foreground">
            {saved ? 'Saved ✓' : 'Save as playlist'}
          </Button>
        </div>
        {queue.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Empty queue</div>
        ) : (
          <div className="flex flex-col">{queueRows}</div>
        )}
      </div>

      {session.active && (
        <div>
          <h2 className="mb-3 text-xl font-bold tracking-tight">Add songs</h2>
          <TrackSearchPicker added={queue.map((q) => q.track)} seeds={queue.map((q) => q.track)} onAdd={(t) => void handleAdd(t)} />
        </div>
      )}
    </div>
  );
}
