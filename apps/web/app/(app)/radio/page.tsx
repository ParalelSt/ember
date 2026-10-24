'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LocateIcon, SearchIcon } from '@/components/icons';
import { OnlineOnly } from '@/components/OnlineOnly';
import { EmptyState } from '@/components/page/EmptyState';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { StationGrid } from '@/components/radio/StationGrid';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  locationAlreadyAllowed,
  readRadioPlace,
  useExecuteToggleRadioFavorite,
  useQueryRadioFavorites,
  useQueryRadioNearby,
  useQueryRadioSearch,
  type RadioPlace,
} from '@/hooks/useRadio';
import type { RadioStation } from '@/lib/radio/station';

const SEARCH_DEBOUNCE_MS = 300;

/** Live internet radio: the listener's favourites first, then stations near
 *  them (their country's until they share where they are), and a search by
 *  name; every list a grid of station logos (components/radio/StationGrid). The
 *  location is only ever read when they tap "Use my location", or when this
 *  site already has their permission (which asks nothing). */
export default function RadioPage() {
  const { user } = useAuth();
  const [place, setPlace] = useState<RadioPlace | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Already allowed: Nearby is really nearby from the start, no prompt.
  useEffect(() => {
    let alive = true;
    void locationAlreadyAllowed().then((ok) => {
      if (!ok || !alive) return;
      readRadioPlace().then((p) => { if (alive) setPlace(p); }, () => {});
    });
    return () => { alive = false; };
  }, []);

  const nearby = useQueryRadioNearby(place);
  const favorites = useQueryRadioFavorites();
  const search = useQueryRadioSearch(debouncedQ);
  const toggleFavorite = useExecuteToggleRadioFavorite();
  const favoriteIds = useMemo(() => new Set((favorites.data ?? []).map((s) => s.id)), [favorites.data]);
  const onToggleFavorite = (station: RadioStation, favorite: boolean) => toggleFavorite.mutate({ station, favorite });

  const useMyLocation = () => {
    setLocating(true);
    setLocationError(null);
    readRadioPlace()
      .then(setPlace, () => setLocationError("Couldn't get your location. Showing Croatia."))
      .finally(() => setLocating(false));
  };

  if (!user) return <EmptyState>Sign in to listen to radio</EmptyState>;

  const list = (stations: RadioStation[] | undefined, name: string, loading: boolean, failed: boolean, empty: string) => {
    if (failed && !stations?.length) return <EmptyState className="text-sm">{"Radio isn't reachable right now. Try again in a moment."}</EmptyState>;
    if (loading && !stations?.length) return <EmptyState className="text-sm">Loading…</EmptyState>;
    if (!stations?.length) return <EmptyState className="text-sm">{empty}</EmptyState>;
    return <StationGrid stations={stations} name={name} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} />;
  };

  const nearbyName = place ? 'Nearby' : 'Croatia';

  return (
    <OnlineOnly>
      <div className="pt-block md:pt-0">
        <PageTitle className="mb-stack">Radio</PageTitle>
        <div className="relative max-w-xl">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search stations"
            aria-label="Search stations"
            className="pl-[2.75rem] pr-block h-12 rounded-full bg-card border-0"
          />
        </div>

        {debouncedQ ? (
          <>
            <SectionHeader title={`Stations for "${debouncedQ}"`} className="mt-section mb-block" />
            {debouncedQ.length < 2
              ? <EmptyState className="text-sm">Type a little more.</EmptyState>
              : list(search.data, 'Search', search.isFetching, search.isError, 'No stations by that name.')}
          </>
        ) : (
          <>
            {!!favorites.data?.length && (
              <>
                <SectionHeader title="Favourites" className="mt-section mb-block" />
                {list(favorites.data, 'Favourites', favorites.isLoading, favorites.isError, '')}
              </>
            )}
            <SectionHeader
              title={nearbyName}
              className="mt-section mb-block"
              action={place ? undefined : (
                <Button variant="ghost" size="sm" onClick={useMyLocation} disabled={locating} className="text-muted-foreground hover:text-foreground">
                  <LocateIcon /> {locating ? 'Finding you…' : 'Use my location'}
                </Button>
              )}
            />
            {locationError && <p className="mb-block text-sm text-muted-foreground">{locationError}</p>}
            {list(nearby.data, nearbyName, nearby.isLoading, nearby.isError, 'No stations found here.')}
          </>
        )}
      </div>
    </OnlineOnly>
  );
}
