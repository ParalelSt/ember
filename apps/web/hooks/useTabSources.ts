'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { QK, useQueryTrack } from '@/hooks/useLibrary';
import { canGenerateFor, drawableTabs, type GeneratedStatus, type TabSummary } from '@/lib/tabSources';
import { isLinedUp, type TabTiming } from '@/lib/tabSync';
import type { TabMatch } from '@/lib/songsterr';
import type { Track } from '@/types/track';

/** The song a tab page is for: enough to look tabs up and to title the
 *  page. `track` is the full Track when Ember knows it (so it can be
 *  played); `null` for an upload that is not playing, named from its tab. */
export interface TabSong {
  id: string;
  title: string;
  artist: string;
  track: Track | null;
}

/** Resolve `/tabs/<trackId>` to a song: the playing track when it is that
 *  one, a YouTube track's metadata, an upload from the server's shared
 *  uploads, or (for anything else) the title the track's own tab row
 *  carries. */
export function useTabSong(trackId: string, current: Track | null): { song: TabSong | null; loading: boolean } {
  const isCurrent = current?.id === trackId;
  const youtubeId = trackId.startsWith('youtube:') ? trackId.slice('youtube:'.length) : null;
  const isUpload = trackId.startsWith('upload:');
  const remote = useQueryTrack(!isCurrent ? youtubeId : null);
  const uploads = useQuery({
    queryKey: QK.uploads,
    queryFn: () => api.listUploads().then((r) => r.tracks),
    enabled: !isCurrent && isUpload,
  });
  const upload = uploads.data?.find((t) => t.id === trackId) ?? null;
  const byRow = useQuery({
    queryKey: ['track-tabs', trackId, '', ''],
    queryFn: () => api.getTrackTabs(trackId, '', '').then((r) => r.tabs),
    enabled: !isCurrent && !youtubeId && (!isUpload || (uploads.isFetched && !upload)),
  });

  const known = isCurrent ? current : youtubeId ? remote.data : upload;
  if (known) {
    return { song: { id: trackId, title: known.title, artist: known.artist, track: known }, loading: false };
  }
  if (youtubeId) return { song: null, loading: remote.isLoading };
  const row = byRow.data?.find((t) => t.trackId === trackId) ?? byRow.data?.[0];
  return {
    song: row ? { id: trackId, title: row.title, artist: row.artist === 'Unknown artist' ? '' : row.artist, track: null } : null,
    loading: uploads.isLoading || byRow.isLoading,
  };
}

export interface TabSourcesState {
  /** Tabs that can be drawn, file first (lib/tabSources.ts drawableTabs). */
  tabs: TabSummary[];
  /** Songsterr link-outs for the song. */
  matches: TabMatch[];
  generated: GeneratedStatus;
  generatedError: string | null;
  canGenerate: boolean;
  loading: boolean;
  generate: () => void;
  generating: boolean;
  generateError: string | null;
  upload: (file: File) => void;
  uploading: boolean;
  uploadError: string | null;
  remove: (id: string) => void;
  saveOffset: (id: string, offsetMs: number) => Promise<unknown>;
  /** Ember is looking for the song online (the automatic search when the
   *  page opens, or "Search online again"). */
  searchingOnline: boolean;
  searchOnlineAgain: () => void;
  /** After "Search online again": what it came back with, for one quiet
   *  line. Null before or while it runs. */
  searchAgainResult: 'found' | 'none' | 'failed' | null;
  /** Line one of the song's tabs up with the recording, from the Source
   *  sheet's row (docs/tabs-v3.md stage 6). */
  lineUp: (tabId: string) => void;
  /** Tabs whose "Line it up" is still running. */
  liningUp: string[];
}

function againResult(
  pending: boolean,
  failed: boolean,
  data: { status: string; added: number } | undefined,
): TabSourcesState['searchAgainResult'] {
  if (pending || (!failed && !data)) return null;
  if (failed || data?.status === 'failed') return 'failed';
  return data && data.added > 0 ? 'found' : 'none';
}

/** align.py gives up after five minutes (lib/tabAlign.ts); a row waiting
 *  longer than that has nothing left to wait for. */
const ALIGN_GIVE_UP_MS = 6 * 60 * 1000;

/** Of the tabs someone pressed "Line it up" on, the ones still waiting: the
 *  row is there, its confidence is the one it had when the job was asked
 *  for, and align.py has not had longer than its own cap. Worked out at
 *  render time, so a finished job needs no effect to clear it. */
function stillWaiting(asked: Record<string, { was: number | null; at: number }>, rows: TabSummary[] | undefined): string[] {
  return Object.entries(asked)
    .filter(([tabId, started]) => {
      if (Date.now() - started.at >= ALIGN_GIVE_UP_MS) return false;
      if (!rows) return true;
      const row = rows.find((t) => t.id === tabId);
      return !!row && (row.timing?.confidence ?? null) === started.was;
    })
    .map(([tabId]) => tabId);
}

/** The source chain for one song (docs/tabs-rebuild.md section 3), plus the
 *  flows that add to it: generate from the recording, add a file, delete,
 *  and save the sync nudge for everyone. */
export function useTabSources(song: TabSong | null): TabSourcesState {
  const qc = useQueryClient();
  const id = song?.id ?? '';
  const title = song?.title ?? '';
  const artist = song?.artist ?? '';
  const canGenerate = !!song && canGenerateFor(id);
  const tabsKey = ['track-tabs', id, title, artist];

  // Tabs the listener asked to line up from the Source sheet. While one is
  // waiting the chain is re-read every few seconds; a tab leaves the list
  // when its row comes back with a different confidence (align.py wrote a
  // new timing), or when the job has had longer than align.py's own cap.
  const [waiting, setWaiting] = useState<Record<string, { was: number | null; at: number }>>({});

  const tabsQuery = useQuery({
    queryKey: tabsKey,
    queryFn: () => api.getTrackTabs(id, title, artist).then((r) => r.tabs),
    enabled: !!song,
    refetchInterval: (q) => (stillWaiting(waiting, q.state.data).length > 0 ? 4000 : false),
  });
  const liningUp = stillWaiting(waiting, tabsQuery.data);
  const generatedQuery = useQuery({
    queryKey: ['generated-tab', id],
    queryFn: () => api.getGeneratedTab(id),
    enabled: canGenerate,
    // Poll only while a job is running; a finished or absent tab does not change.
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 5000 : false),
  });
  const matchesQuery = useQuery({
    queryKey: ['tabs', id],
    queryFn: () => api.getTabs(title, artist).then((r) => r.matches),
    enabled: !!song && !!title,
    staleTime: 60 * 60 * 1000,
  });

  // Look online once per song: the server remembers it was searched and
  // answers "cached" after that, so this costs a site request only the
  // first time any listener opens the song (docs/tabs-v3.md, owner's
  // decision 2). Asked after the store answered, so the page draws what it
  // has at once.
  const online = useQuery({
    queryKey: ['tabs-online', id, title, artist],
    queryFn: () => api.findTabsOnline(id, title, artist),
    enabled: !!song && !!title && tabsQuery.isFetched,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const onlineAdded = online.data?.added ?? 0;
  useEffect(() => {
    if (onlineAdded > 0) void qc.invalidateQueries({ queryKey: ['track-tabs', id] });
  }, [onlineAdded, id, qc]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['track-tabs', id] });
    void qc.invalidateQueries({ queryKey: ['generated-tab', id] });
  };
  const generate = useMutation({
    mutationFn: () => api.generateTab(id, title, artist),
    // The job is queued: show it running now (the poll takes over from
    // here) rather than flashing the empty state until the next fetch.
    onSuccess: (r) => {
      qc.setQueryData(['generated-tab', id], { status: r.status });
      void qc.invalidateQueries({ queryKey: ['track-tabs', id] });
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadTabFile(file, { title, artist, trackId: id }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (tabId: string) => api.deleteTabFile(tabId),
    onSuccess: refresh,
  });
  const searchAgain = useMutation({
    mutationFn: () => api.findTabsOnline(id, title, artist, true),
    onSuccess: (r) => {
      if (r.added > 0) void qc.invalidateQueries({ queryKey: ['track-tabs', id] });
    },
  });
  const saveOffset = useMutation({
    mutationFn: ({ tabId, offsetMs }: { tabId: string; offsetMs: number }) => api.saveTabOffset(tabId, offsetMs),
    onSuccess: refresh,
  });
  const lineUpOne = useMutation({
    mutationFn: (tabId: string) => api.lineTabUp(tabId),
    onError: (_e, tabId) =>
      setWaiting((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== tabId))),
  });

  // A job that finishes is drawable at once: drawableTabs stands in for its
  // row until the next fetch of the chain brings the real one.
  const generated: GeneratedStatus = generatedQuery.data?.status ?? 'none';

  return {
    tabs: song ? drawableTabs(tabsQuery.data ?? [], generated, { id, title, artist }) : [],
    matches: matchesQuery.data ?? [],
    generated,
    generatedError: generatedQuery.data?.error ?? null,
    canGenerate,
    loading: !!song && (tabsQuery.isLoading || (canGenerate && generatedQuery.isLoading)),
    generate: () => generate.mutate(),
    generating: generate.isPending,
    generateError: generate.error ? (generate.error as Error).message : null,
    upload: (file) => upload.mutate(file),
    uploading: upload.isPending,
    uploadError: upload.error ? (upload.error as Error).message : null,
    remove: (tabId) => remove.mutate(tabId),
    saveOffset: (tabId, offsetMs) => saveOffset.mutateAsync({ tabId, offsetMs }),
    searchingOnline: online.isFetching || searchAgain.isPending,
    searchOnlineAgain: () => searchAgain.mutate(),
    searchAgainResult: againResult(searchAgain.isPending, searchAgain.isError, searchAgain.data),
    lineUp: (tabId) => {
      if (!tabId || tabId.startsWith('generated:')) return;
      const was = (tabsQuery.data ?? []).find((t) => t.id === tabId)?.timing?.confidence ?? null;
      setWaiting((m) => ({ ...m, [tabId]: { was, at: Date.now() } }));
      lineUpOne.mutate(tabId);
    },
    liningUp,
  };
}


// ── lining a tab up with the recording ────────────────────────────────────

export interface TabAlignment {
  /** Where the tab sits in the recording, once it is known. */
  timing: TabTiming | null;
  /** A job is running (the fetch started one, or "Line it up" did). */
  running: boolean;
  /** Why the last attempt failed, if it did. */
  error: string | null;
  lineUp: () => void;
}

/** The alignment of the tab on screen (docs/tabs-v3.md section 3): what the
 *  server worked out, whether a job is running now (asked again every few
 *  seconds while it is), and the button that runs it again. Every kind of
 *  tab can be lined up now (stage 7 ranks them by how well they match); a
 *  generated tab with no row of its own yet is the one exception. */
export function useTabAlignment(tab: TabSummary | null): TabAlignment {
  const qc = useQueryClient();
  const id = tab && !tab.id.startsWith('generated:') ? tab.id : '';
  const known = isLinedUp(tab?.timing);
  const query = useQuery({
    queryKey: ['tab-align', id],
    queryFn: () => api.getTabAlignment(id),
    enabled: !!id,
    // A tab already lined up needs no asking; one that is not may have a
    // job running from the search that found it.
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : false),
    staleTime: known ? Infinity : 0,
    retry: false,
  });
  const lineUp = useMutation({
    mutationFn: () => api.lineTabUp(id),
    onSuccess: () => qc.setQueryData(['tab-align', id], { status: 'running' as const }),
  });

  // A job that finished brings the row its timing.
  const status = query.data?.status;
  useEffect(() => {
    if (status === 'ready' && tab?.id) void qc.invalidateQueries({ queryKey: ['track-tabs'] });
  }, [status, tab?.id, qc]);

  return {
    timing: query.data?.status === 'ready' ? (query.data.timing ?? null) : (tab?.timing ?? null),
    running: status === 'running' || lineUp.isPending,
    error: query.data?.status === 'failed' ? (query.data.error ?? 'It could not be lined up.') : null,
    lineUp: () => {
      if (id) lineUp.mutate();
    },
  };
}
