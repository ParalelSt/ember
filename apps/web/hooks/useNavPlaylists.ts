'use client';

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { applyNavPatch, EMPTY_NAV_PREFS, orderNavPlaylists, type NavPatch, type NavPrefs } from '@/lib/navPlaylists';

export const NAV_PLAYLISTS_KEY = ['nav-playlists'] as const;

/** The nav playlists in the owner's order (pinned first, then most recently
 *  opened), with `onOpen` (call when a row is tapped) and `onTogglePin`.
 *  Changes show at once and are saved to the account; a failed save puts the
 *  old order back. */
export function useNavPlaylists<T extends { id: string }>(items: T[]) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: prefs = EMPTY_NAV_PREFS } = useQuery({
    queryKey: NAV_PLAYLISTS_KEY,
    queryFn: () => api.getNavPlaylists(),
    enabled: !!user,
    staleTime: 60_000,
  });

  const patch = useMutation({
    mutationFn: (p: NavPatch) => api.patchNavPlaylists(p),
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: NAV_PLAYLISTS_KEY });
      const prev = qc.getQueryData<NavPrefs>(NAV_PLAYLISTS_KEY);
      qc.setQueryData<NavPrefs>(NAV_PLAYLISTS_KEY, applyNavPatch(prev ?? EMPTY_NAV_PREFS, p, Date.now()));
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(NAV_PLAYLISTS_KEY, ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: NAV_PLAYLISTS_KEY }),
  });
  const { mutate } = patch;

  const ordered = useMemo(() => orderNavPlaylists(items, prefs), [items, prefs]);
  const onOpen = useCallback((id: string) => mutate({ opened: id }), [mutate]);
  const onTogglePin = useCallback(
    (id: string) => mutate({ pin: id, pinned: !prefs.pinned.includes(id) }),
    [mutate, prefs.pinned],
  );
  return { items: ordered, onOpen, onTogglePin };
}
