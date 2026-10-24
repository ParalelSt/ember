'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { RADIO_HOME_COUNTRY, roundCoord, type RadioStation } from '@/lib/radio/station';

export const RADIO_FAVORITES_KEY = ['radio', 'favorites'] as const;
/** The server keeps station lists for hours; the page need not ask again
 *  every time it is opened. */
const LIST_STALE_MS = 30 * 60_000;

export interface RadioPlace {
  lat: number;
  lng: number;
}

/** Stations near `place` (already rounded, see useRadioLocation), or the
 *  home country's when there is no place. */
export function useQueryRadioNearby(place: RadioPlace | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: place ? ['radio', 'nearby', place.lat, place.lng] : ['radio', 'country', RADIO_HOME_COUNTRY],
    queryFn: () => (place ? api.radioNearby(place.lat, place.lng) : api.radioCountry(RADIO_HOME_COUNTRY)).then((r) => r.stations),
    enabled: !!user,
    staleTime: LIST_STALE_MS,
  });
}

export function useQueryRadioSearch(q: string) {
  const { user } = useAuth();
  const query = q.trim();
  return useQuery({
    queryKey: ['radio', 'search', query.toLowerCase()],
    queryFn: () => api.radioSearch(query).then((r) => r.stations),
    enabled: !!user && query.length >= 2,
    staleTime: LIST_STALE_MS,
  });
}

export function useQueryRadioFavorites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: RADIO_FAVORITES_KEY,
    queryFn: () => api.radioFavorites().then((r) => r.stations),
    enabled: !!user,
  });
}

/** Adds or removes a favourite at once, put back if the server refuses. */
export function useExecuteToggleRadioFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ station, favorite }: { station: RadioStation; favorite: boolean }): Promise<void> => {
      if (favorite) await api.addRadioFavorite(station.id);
      else await api.removeRadioFavorite(station.id);
    },
    onMutate: async ({ station, favorite }) => {
      await qc.cancelQueries({ queryKey: RADIO_FAVORITES_KEY });
      const prev = qc.getQueryData<RadioStation[]>(RADIO_FAVORITES_KEY);
      const rest = (prev ?? []).filter((s) => s.id !== station.id);
      qc.setQueryData(RADIO_FAVORITES_KEY, favorite ? [station, ...rest] : rest);
      return { prev };
    },
    onError: (_e, { favorite }, ctx) => {
      qc.setQueryData(RADIO_FAVORITES_KEY, ctx?.prev);
      toast.error(favorite ? "Couldn't add the station to your favourites." : "Couldn't remove the station from your favourites.");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: RADIO_FAVORITES_KEY }),
  });
}

/** Where the listener is, to the nearest ~10 km, only once they ask (or
 *  have already let this site know, which asks nothing). */
export function readRadioPlace(): Promise<RadioPlace> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location is not available here'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: roundCoord(pos.coords.latitude), lng: roundCoord(pos.coords.longitude) }),
      (err) => reject(new Error(err.message || 'Location was not shared')),
      { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: 15_000 },
    );
  });
}

/** Whether this site may already read the location without asking. */
export async function locationAlreadyAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}
