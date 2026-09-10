'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TrackList } from '@/components/track/TrackList';
import { TrackRow } from '@/components/track/TrackRow';
import { renderTrackMenu } from '@/components/track/TrackMenu';
import { MicIcon, MusicIcon, SearchIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import {
  useQueryRecentSearches,
  useExecuteAddRecentSearch,
  useExecuteRemoveRecentSearch,
} from '@/hooks/useRecentSearches';
import { useTrackActions } from '@/hooks/useTrackActions';
import { useOnline } from '@/lib/useOnline';
import { OnlineOnly } from '@/components/OnlineOnly';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/page/EmptyState';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const isOnline = useOnline();
  const trackActions = useTrackActions();

  const { data: recentTracks = [] } = useQueryRecentSearches();
  const addRecentTrack = useExecuteAddRecentSearch();
  const removeRecentTrack = useExecuteRemoveRecentSearch();

  // Spoken words fill the input live; the debounce below turns them into a
  // search exactly like typing.
  const voice = useVoiceSearch((text) => setQ(text));

  useEffect(() => {
    // Trim during debounce so " " / "   abc   " collapse to "" / "abc" —
    // pressing space alone (or starting/ending with whitespace) no longer
    // triggers a search.
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching, error } = useQuery({
    queryKey: QK.search(debouncedQ),
    queryFn: () => api.search(debouncedQ).then((r) => r.tracks),
    enabled: isOnline && debouncedQ.length > 0,
    retry: false,
  });

  // Surface the rate-limit 429 quietly instead of a blank result set.
  const rateLimited = (error as { status?: number } | null)?.status === 429;

  const onMicClick = () => {
    if (!voice.supported) {
      toast.message("Voice search isn't supported in this browser — try Chrome.");
      return;
    }
    voice.toggle();
  };

  const recents = !debouncedQ && recentTracks.length > 0 ? (
    <div className="mt-8 max-w-xl">
      <SectionHeader title="Recent searches" className="mb-3" />
      <div className="flex flex-col">
        {recentTracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            density="compact"
            active={trackActions.currentId === t.id}
            artworkFallback={<MusicIcon className="h-4 w-4" />}
            onPlay={() => trackActions.onPlay(t)}
            onRemove={() => removeRecentTrack.mutate(t.id)}
            removeLabel={`Remove "${t.title}" from recent searches`}
          />
        ))}
      </div>
    </div>
  ) : null;

  const results = rateLimited ? (
    <EmptyState className="text-sm">Searching too fast, one moment.</EmptyState>
  ) : isFetching && !data?.length ? (
    <EmptyState className="text-sm">Searching…</EmptyState>
  ) : (
    <TrackList
      tracks={data ?? []}
      context={{ type: 'search', query: debouncedQ }}
      trailing={renderTrackMenu}
      {...trackActions}
      // Playing a result also saves it to recent searches; everything else
      // about playback comes from the spread above.
      onPlay={(track, list, context) => {
        addRecentTrack.mutate(track);
        trackActions.onPlay(track, list, context);
      }}
    />
  );

  return (
    <OnlineOnly>
      <div className="pt-4 md:pt-0">
        <PageTitle className="mb-6">Search</PageTitle>
        <div className="relative max-w-xl">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="What do you want to listen to?"
            className="pl-11 pr-12 h-12 rounded-full bg-card border-0"
          />
          {/* Always visible (right side of the bar): unsupported browsers get a
              pointer to Chrome instead of a hidden button. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onMicClick}
            aria-label={voice.listening ? 'Stop voice search' : 'Search by voice'}
            aria-pressed={voice.listening}
            title="Search by voice"
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full',
              voice.listening
                ? 'text-ember hover:text-ember animate-pulse'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <MicIcon className="h-4 w-4" />
          </Button>
        </div>

        {recents}

        <SectionHeader
          title={debouncedQ ? `Results for "${debouncedQ}"` : 'Trending'}
          className="mt-8 mb-4"
        />
        {results}
      </div>
    </OnlineOnly>
  );
}
