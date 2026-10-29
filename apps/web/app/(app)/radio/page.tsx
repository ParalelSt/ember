'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LocateIcon, SearchIcon } from '@/components/icons';
import { OnlineOnly } from '@/components/OnlineOnly';
import { EmptyState } from '@/components/page/EmptyState';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { RowHeader, WideRowHeader } from '@/components/page/RowShelf';
import { StationList } from '@/components/radio/StationList';
import { StationShelf } from '@/components/radio/StationShelf';
import { useAuth } from '@/components/providers/AuthProvider';
import { useIsDesktop } from '@/hooks/useIsDesktop';
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
import { useUiStore } from '@/stores/useUiStore';

const SEARCH_DEBOUNCE_MS = 300;

/** Live internet radio: stations near the listener (their country's until
 *  they share where they are), their favourites, and a search by name. The
 *  favourites and the stations around are Home style shelves of logo tiles
 *  (the owner's "Shelves" pick), every station in its row; a search lists
 *  its finds as rows. The
 *  location is only ever read when they tap "Use my location", or when this
 *  site already has their permission (which asks nothing). */
export default function RadioPage() {
  const { user } = useAuth();
  // Shelves as on Home: 140px tiles by touch on a phone, 180px ones on a
  // desktop window.
  const isDesktop = useIsDesktop();
  const [place, setPlace] = useState<RadioPlace | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  // One query, typed in the top bar's box on a desktop window and in the
  // page's own box on a phone (which has no top search box).
  const q = useUiStore((s) => s.radioQuery);
  const setQ = useUiStore((s) => s.setRadioQuery);
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Leaving the page leaves its search behind: coming back starts clean.
  useEffect(() => () => setQ(''), [setQ]);

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

  /** What stands in for a list that has nothing to show yet, or null. */
  const listState = (stations: RadioStation[] | undefined, loading: boolean, failed: boolean, empty: string) => {
    if (failed && !stations?.length) return <EmptyState className="text-sm">{"Radio isn't reachable right now. Try again in a moment."}</EmptyState>;
    if (loading && !stations?.length) return <EmptyState className="text-sm">Loading…</EmptyState>;
    if (!stations?.length) return <EmptyState className="text-sm">{empty}</EmptyState>;
    return null;
  };

  const list = (stations: RadioStation[] | undefined, name: string, loading: boolean, failed: boolean, empty: string) =>
    listState(stations, loading, failed, empty)
    ?? <StationList stations={stations!} name={name} favoriteIds={favoriteIds} onToggleFavorite={onToggleFavorite} />;

  const shelf = (title: string, stations: RadioStation[] | undefined, loading: boolean, failed: boolean, empty: string, action?: ReactNode) => {
    const state = listState(stations, loading, failed, empty);
    if (state) {
      const Header = isDesktop ? WideRowHeader : RowHeader;
      return (
        <section className="mb-section" aria-label={title}>
          <Header title={title} action={action} />
          {state}
        </section>
      );
    }
    return (
      <StationShelf
        title={title}
        stations={stations!}
        name={title}
        favoriteIds={favoriteIds}
        onToggleFavorite={onToggleFavorite}
        variant={isDesktop ? 'desktop' : 'phone'}
        action={action}
      />
    );
  };

  const nearbyName = place ? 'Nearby' : 'Croatia';
  const locationAction = place ? undefined : (
    <Button variant="ghost" size="sm" onClick={useMyLocation} disabled={locating} className="text-muted-foreground hover:text-foreground">
      <LocateIcon /> {locating ? 'Finding you…' : 'Use my location'}
    </Button>
  );

  return (
    <OnlineOnly>
      <div className="pt-block md:pt-0">
        <PageTitle className="mb-stack">Radio</PageTitle>
        {/* Phones only: a desktop window searches stations from the top
            bar (SearchOverlayContainer), which is not drawn below md. */}
        <div className="relative max-w-xl md:hidden">
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
          <div className="mt-section md:mt-block">
            {!!favorites.data?.length && shelf('Favourites', favorites.data, favorites.isLoading, favorites.isError, '')}
            {locationError && <p className="mb-block text-sm text-muted-foreground">{locationError}</p>}
            {shelf(nearbyName, nearby.data, nearby.isLoading, nearby.isError, 'No stations found here.', locationAction)}
          </div>
        )}
      </div>
    </OnlineOnly>
  );
}
