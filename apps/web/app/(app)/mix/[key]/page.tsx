'use client';

import { use, useState } from 'react';
import { toast } from 'sonner';
import { OnlineOnly } from '@/components/OnlineOnly';
import { GeneratedListPage } from '@/components/library/GeneratedListPage';
import { BrowseError } from '@/components/page/BrowseError';
import { EmptyState } from '@/components/page/EmptyState';
import { renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { useQueryMix } from '@/hooks/useLibrary';
import { useTrackActions } from '@/hooks/useTrackActions';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { useSaveAsPlaylist } from '@/hooks/useSaveAsPlaylist';
import { snapshotName } from '@/lib/chartsView';
import { builtLine } from '@/lib/mixesView';
import { KIND_EYEBROW, mixFullTitle, mixKind, refreshNote } from '@/lib/mixes/kinds';
import { countLabel } from '@/lib/collections';
import { formatAddedDate } from '@/lib/format';
import { topCovers } from '@/lib/genres/covers';
import type { PlaybackContext } from '@/types/track';

/** One of the member's mixes (style, artist, Discover, On repeat,
 *  Throwback): rebuilt every night (Discover every Monday) from what they
 *  play, Play, Shuffle and Save as playlist. */
export default function MixPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  return (
    <OnlineOnly>
      <MixView mixKey={key} />
    </OnlineOnly>
  );
}

function MixView({ mixKey }: { mixKey: string }) {
  const { data, isLoading, error, refetch } = useQueryMix(mixKey);
  const tracks = data?.tracks ?? [];
  const title = data ? mixFullTitle(mixKey, data.title) : '';
  const kind = data?.kind ?? mixKind(mixKey);
  const context: PlaybackContext = { type: 'mix', mixKey, mixTitle: title };
  const playback = useCollectionPlayback(tracks, context);
  const trackActions = useTrackActions();
  const save = useSaveAsPlaylist();
  const [saved, setSaved] = useState(false);

  if (error) return <BrowseError error={error} kind="Mix" onRetry={() => void refetch()} />;
  if (isLoading || !data) return <EmptyState>Loading…</EmptyState>;

  const onSave = () => {
    const name = snapshotName(kind === 'style' || kind === 'artist' ? data.title : title, 'mix', formatAddedDate(new Date().toISOString()));
    save.mutate(
      { name, tracks },
      {
        onSuccess: (playlist) => {
          setSaved(true);
          toast.success(`Saved as playlist "${playlist.name}"`);
        },
        onError: () => toast.error("Couldn't save the playlist. Please try again."),
      },
    );
  };

  const cover = data.cover.artworkUrls.length ? { src: data.cover.artworkUrls[0] } : topCovers(tracks);

  return (
    <GeneratedListPage
      eyebrow={KIND_EYEBROW[kind] ?? 'Mix'}
      title={title}
      meta={[countLabel(tracks.length), refreshNote(mixKey)]}
      belowTitle={<span data-testid="mix-built" className="text-sm text-muted-foreground">{builtLine(data, Date.now())}</span>}
      cover={{ icon: null, fallback: 'card', ...cover }}
      tracks={tracks}
      context={context}
      playback={playback}
      trackActions={trackActions}
      trailing={renderTrackMenu}
      emptyMessage="This mix has no songs right now."
      onSave={onSave}
      saving={save.isPending}
      saved={saved}
    />
  );
}
