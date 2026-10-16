'use client';

import { use, useState } from 'react';
import { toast } from 'sonner';
import { OnlineOnly } from '@/components/OnlineOnly';
import { GeneratedListPage } from '@/components/library/GeneratedListPage';
import { BrowseError } from '@/components/page/BrowseError';
import { EmptyState } from '@/components/page/EmptyState';
import { renderTrackMenu } from '@/components/track/menus/TrackMenu';
import { useQueryChart } from '@/hooks/useLibrary';
import { useTrackActions } from '@/hooks/useTrackActions';
import { useCollectionPlayback } from '@/hooks/useCollectionPlayback';
import { useSaveAsPlaylist } from '@/hooks/useSaveAsPlaylist';
import { chartMeta, snapshotName } from '@/lib/chartsView';
import { formatAddedDate, formatSince } from '@/lib/format';
import { topCovers } from '@/lib/genres/covers';
import type { PlaybackContext } from '@/types/track';

/** A chart: Popular now (`popular`) or one genre chart, in rank order. */
export default function ChartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <OnlineOnly>
      <ChartView slug={slug} />
    </OnlineOnly>
  );
}

function ChartView({ slug }: { slug: string }) {
  const { data, isLoading, error, refetch } = useQueryChart(slug);
  const tracks = data?.tracks ?? [];
  const context: PlaybackContext = { type: 'chart', chartSlug: slug, chartTitle: data?.title ?? '' };
  const playback = useCollectionPlayback(tracks, context);
  const trackActions = useTrackActions();
  const save = useSaveAsPlaylist();
  const [saved, setSaved] = useState(false);

  if (error) return <BrowseError error={error} kind="Chart" onRetry={() => void refetch()} />;
  if (isLoading || !data) return <EmptyState>Loading…</EmptyState>;

  const onSave = () => {
    const name = snapshotName(data.title, 'chart', formatAddedDate(new Date().toISOString()));
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

  return (
    <GeneratedListPage
      eyebrow="Chart"
      title={data.title}
      meta={chartMeta(data, (iso) => formatSince(iso))}
      cover={{ icon: null, fallback: 'card', ...topCovers(tracks) }}
      tracks={tracks}
      context={context}
      playback={playback}
      trackActions={trackActions}
      trailing={renderTrackMenu}
      showRank
      emptyMessage="This chart has no songs right now."
      onSave={onSave}
      saving={save.isPending}
      saved={saved}
    />
  );
}
