'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TrackList } from '@/components/track/TrackList';
import { ClockIcon, CloseIcon, MicIcon, SearchIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import { useSearchStore } from '@/stores/useSearchStore';
import { useOnline } from '@/lib/useOnline';
import { OfflinePlaceholder } from '@/components/OfflinePlaceholder';
import { cn } from '@/lib/utils';

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const isOnline = useOnline();

  const recentSearches = useSearchStore((s) => s.recentSearches);
  const addRecentSearch = useSearchStore((s) => s.addRecentSearch);
  const removeRecentSearch = useSearchStore((s) => s.removeRecentSearch);

  // Spoken words fill the input live; the debounce below turns them into a
  // search exactly like typing. Recents save on commit (Enter / play), not here.
  const voice = useVoiceSearch((text) => setQ(text));

  useEffect(() => {
    // Trim during debounce so " " / "   abc   " collapse to "" / "abc" —
    // pressing space alone (or starting/ending with whitespace) no longer
    // triggers a search.
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: QK.search(debouncedQ),
    queryFn: () => api.search(debouncedQ).then((r) => r.tracks),
    enabled: isOnline && debouncedQ.length > 0,
  });

  if (!isOnline) return <OfflinePlaceholder />;

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') addRecentSearch(q);
  };

  const micButton = voice.supported ? (
    <Button
      variant="ghost"
      size="icon"
      onClick={voice.toggle}
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
  ) : null;

  const recents = !debouncedQ && recentSearches.length > 0 ? (
    <div className="mt-8 max-w-xl">
      <h2 className="mb-3 text-xl font-bold tracking-tight">Recent searches</h2>
      <div className="flex flex-col">
        {recentSearches.map((r) => (
          <div
            key={r}
            onClick={() => setQ(r)}
            className="group flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer hover:bg-card transition-colors"
          >
            <ClockIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{r}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                removeRecentSearch(r);
              }}
              aria-label={`Remove "${r}" from recent searches`}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const results = isFetching && !data?.length ? (
    <div className="text-muted-foreground text-sm py-12 text-center">Searching…</div>
  ) : (
    <TrackList
      tracks={data ?? []}
      context={{ type: 'search', query: debouncedQ }}
      onPlayTrack={() => addRecentSearch(debouncedQ)}
    />
  );

  return (
    <div className="pt-4 md:pt-0">
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">Search</h1>
      <div className="relative max-w-xl">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="What do you want to listen to?"
          className={cn('pl-11 h-12 rounded-full bg-card border-0', voice.supported && 'pr-12')}
        />
        {micButton}
      </div>

      {recents}

      <h2 className="mt-8 mb-4 text-xl font-bold tracking-tight">
        {debouncedQ ? `Results for "${debouncedQ}"` : 'Trending'}
      </h2>
      {results}
    </div>
  );
}
