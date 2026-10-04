'use client';

import { use, useState } from 'react';
import { toast } from 'sonner';
import { TrackSearchPicker } from '@/components/track/menus/TrackSearchPicker';
import { CarlistLive, AddChoice } from '@/components/session/CarlistLive';
import { CarlistShareDialog } from '@/components/session/CarlistShare';
import {
  useQuerySession,
  useExecuteAddToSession,
  useExecuteSkipSession,
  useExecuteEndSession,
  useExecuteSaveSession,
} from '@/hooks/useSession';
import { useSessionHost } from '@/hooks/useSessionHost';
import { useCarlistProgress } from '@/hooks/useCarlistProgress';
import { addedMessage, type AddPosition } from '@/lib/carlist';
import type { Track } from '@/types/track';
import { EmptyState } from '@/components/page/EmptyState';

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error, dataUpdatedAt } = useQuerySession(id);
  const addToSession = useExecuteAddToSession(id);
  const skip = useExecuteSkipSession(id);
  const end = useExecuteEndSession(id);
  const save = useExecuteSaveSession(id);
  const [saved, setSaved] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // No-op for guests; hosts mirror the queue into their player.
  useSessionHost(data);
  const progress = useCarlistProgress(data, dataUpdatedAt);

  // A failed poll keeps the last answer: in a car the connection drops
  // often, and the next poll catches up. Only a carlist that is really gone
  // (or never loaded) says so.
  const status = (error as { status?: number } | null)?.status;
  if (error && (!data || status === 403 || status === 404)) {
    return <EmptyState>Carlist not found.</EmptyState>;
  }
  if (isLoading || !data) {
    return <EmptyState>Loading…</EmptyState>;
  }

  const { queue } = data;

  const handleAdd = async (track: Track, position: AddPosition) => {
    try {
      const { ahead } = await addToSession.mutateAsync({ track, position });
      toast.success(addedMessage(track.title, ahead));
    } catch {
      toast.error(`Couldn't add "${track.title}". Please try again.`);
    }
  };

  const handleSkip = () => {
    skip.mutate(undefined, {
      onSuccess: () => toast.message('Skip sent'),
      onError: () => toast.error("Couldn't skip. Please try again."),
    });
  };

  const handleSave = () => {
    save.mutate(undefined, {
      onSuccess: ({ playlist }) => {
        setSaved(true);
        toast.success(`Saved as playlist "${playlist.name}"`);
      },
      onError: () => toast.error("Couldn't save the playlist. Please try again."),
    });
  };

  const handleEnd = () => {
    end.mutate(undefined, {
      onError: () => toast.error("Couldn't end the carlist. Please try again."),
    });
  };

  return (
    <>
      <CarlistLive
        state={data}
        progress={progress}
        saved={saved}
        saving={save.isPending}
        skipping={skip.isPending}
        onSkip={handleSkip}
        onEnd={handleEnd}
        onSave={handleSave}
        onShare={() => setShareOpen(true)}
        addSlot={
          <TrackSearchPicker
            added={queue.map((q) => q.track)}
            seeds={queue.map((q) => q.track)}
            onAdd={(t) => void handleAdd(t, 'end')}
            renderAdd={(t, isAdded) => (
              <AddChoice
                track={t}
                isAdded={isAdded}
                busy={addToSession.isPending}
                onAdd={(position) => void handleAdd(t, position)}
              />
            )}
          />
        }
      />
      <CarlistShareDialog code={data.session.code} open={shareOpen} onOpenChange={setShareOpen} />
    </>
  );
}
