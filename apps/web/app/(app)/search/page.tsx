'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { TrackList } from '@/components/track/TrackList';
import { SearchIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

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
    enabled: debouncedQ.length > 0,
  });

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
          className="pl-11 h-12 rounded-full bg-card border-0"
        />
      </div>

      <h2 className="mt-8 mb-4 text-xl font-bold tracking-tight">
        {debouncedQ ? `Results for "${debouncedQ}"` : 'Trending'}
      </h2>
      {isFetching && !data?.length ? (
        <div className="text-muted-foreground text-sm py-12 text-center">Searching…</div>
      ) : (
        <TrackList tracks={data ?? []} context={{ type: 'search', query: debouncedQ }} />
      )}
    </div>
  );
}
