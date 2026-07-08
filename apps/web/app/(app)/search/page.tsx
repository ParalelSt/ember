'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TrackList } from '@/components/track/TrackList';
import { CloseIcon, MicIcon, MusicIcon, SearchIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import { useSearchStore } from '@/stores/useSearchStore';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useOnline } from '@/lib/useOnline';
import { OfflinePlaceholder } from '@/components/OfflinePlaceholder';
import { cn } from '@/lib/utils';

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const isOnline = useOnline();
  const { playTrack } = usePlayer();

  const recentTracks = useSearchStore((s) => s.recentTracks);
  const addRecentTrack = useSearchStore((s) => s.addRecentTrack);
  const removeRecentTrack = useSearchStore((s) => s.removeRecentTrack);

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

  if (!isOnline) return <OfflinePlaceholder />;

  const onMicClick = () => {
    if (!voice.supported) {
      toast.message("Voice search isn't supported in this browser — try Chrome.");
      return;
    }
    voice.toggle();
  };

  const recents = !debouncedQ && recentTracks.length > 0 ? (
    <div className="mt-8 max-w-xl">
      <h2 className="mb-3 text-xl font-bold tracking-tight">Recent searches</h2>
      <div className="flex flex-col">
        {recentTracks.map((t) => (
          <div
            key={t.id}
            onClick={() => playTrack(t)}
            className="group flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer hover:bg-card transition-colors"
          >
            {t.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.artworkUrl} alt="" className="h-10 w-10 rounded shrink-0 object-cover bg-black" />
            ) : (
              <div className="h-10 w-10 rounded shrink-0 bg-black grid place-items-center text-foreground/20">
                <MusicIcon className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{t.title}</div>
              <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                removeRecentTrack(t.id);
              }}
              aria-label={`Remove "${t.title}" from recent searches`}
              className="h-7 w-7 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const results = rateLimited ? (
    <div className="text-muted-foreground text-sm py-12 text-center">Searching too fast — one moment.</div>
  ) : isFetching && !data?.length ? (
    <div className="text-muted-foreground text-sm py-12 text-center">Searching…</div>
  ) : (
    <TrackList
      tracks={data ?? []}
      context={{ type: 'search', query: debouncedQ }}
      onPlayTrack={(t) => addRecentTrack(t)}
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
          placeholder="What do you want to listen to?"
          className="pl-11 pr-12 h-12 rounded-full bg-card border-0"
        />
        {/* Always visible (right side of the bar) — unsupported browsers get a
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

      <h2 className="mt-8 mb-4 text-xl font-bold tracking-tight">
        {debouncedQ ? `Results for "${debouncedQ}"` : 'Trending'}
      </h2>
      {results}
    </div>
  );
}
