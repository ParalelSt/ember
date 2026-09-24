'use client';

import { useMemo, useState } from 'react';
import type { CopyStepId } from '@/components/library/options/playlist-copy';
import {
  MOCK_COPY_SOURCE,
  MOCK_LIKED_DESTINATION,
  MOCK_PICKED_IDS,
  type CopyDestination,
} from '@/components/library/options/playlist-copy/mock';
import {
  DEFAULT_SORT,
  planCopy,
  sortTracks,
  type CopyPlan,
  type CopyTrack,
  type SortState,
} from '@/components/library/options/playlist-copy/model';

export interface CopyResult {
  destination: CopyDestination;
  plan: CopyPlan;
}

interface FlowState {
  selecting: boolean;
  selected: string[];
  sort: SortState;
  sortOpen: boolean;
  pickerOpen: boolean;
  /** Liked songs, waiting for the "this likes all of them" confirmation. */
  confirm: CopyDestination | null;
  result: CopyResult | null;
}

const ALL_IDS = MOCK_COPY_SOURCE.map((t) => t.id);

function pick(ids: string[]) {
  return MOCK_COPY_SOURCE.filter((t) => ids.includes(t.id));
}

/** Where each gallery step puts the flow. */
export function initialFlow(step: CopyStepId): FlowState {
  const base: FlowState = {
    selecting: false,
    selected: [],
    sort: DEFAULT_SORT,
    sortOpen: false,
    pickerOpen: false,
    confirm: null,
    result: null,
  };
  switch (step) {
    case 'start':
      return base;
    case 'select':
      return { ...base, selecting: true, selected: MOCK_PICKED_IDS };
    case 'all':
      return { ...base, selecting: true, selected: ALL_IDS };
    case 'sort':
      return { ...base, selecting: true, selected: MOCK_PICKED_IDS, sort: { key: 'artist', dir: 'asc' }, sortOpen: true };
    case 'picker':
      return { ...base, selecting: true, selected: ALL_IDS, pickerOpen: true };
    case 'liked':
      return { ...base, selecting: true, selected: ALL_IDS, confirm: MOCK_LIKED_DESTINATION };
    case 'result':
      return {
        ...base,
        result: { destination: MOCK_LIKED_DESTINATION, plan: planCopy(pick(ALL_IDS), MOCK_LIKED_DESTINATION.tracks) },
      };
  }
}

export interface CopyFlow {
  selecting: boolean;
  /** The source list in the chosen order. */
  tracks: CopyTrack[];
  total: number;
  isSelected: (id: string) => boolean;
  /** The picked songs, in the list's order. */
  picked: CopyTrack[];
  allSelected: boolean;
  sort: SortState;
  sortOpen: boolean;
  pickerOpen: boolean;
  confirm: CopyDestination | null;
  result: CopyResult | null;
  /** How `picked` would land in the Liked songs (for the warning's counts). */
  likedPlan: CopyPlan;
  enter: () => void;
  exit: () => void;
  toggle: (id: string) => void;
  /** Select all, or clear when everything already is. */
  toggleAll: () => void;
  clear: () => void;
  setSort: (sort: SortState) => void;
  setSortOpen: (open: boolean) => void;
  setPickerOpen: (open: boolean) => void;
  /** Copy the picked songs there; Liked songs asks first. */
  choose: (destination: CopyDestination) => void;
  confirmLiked: () => void;
  cancelConfirm: () => void;
  dismissResult: () => void;
}

/** The copy flow's state for one candidate frame, started at `step`. Mock
 *  only: "copying" computes the plan with the real duplicate rule and shows
 *  it, nothing is written. */
export function useCopyFlow(step: CopyStepId): CopyFlow {
  const [s, setS] = useState<FlowState>(() => initialFlow(step));
  const tracks = useMemo(() => sortTracks(MOCK_COPY_SOURCE, s.sort), [s.sort]);
  const picked = useMemo(() => tracks.filter((t) => s.selected.includes(t.id)), [tracks, s.selected]);
  const likedPlan = useMemo(() => planCopy(picked, MOCK_LIKED_DESTINATION.tracks), [picked]);
  const patch = (p: Partial<FlowState>) => setS((prev) => ({ ...prev, ...p }));

  const run = (destination: CopyDestination) =>
    patch({
      result: { destination, plan: planCopy(picked, destination.tracks) },
      selecting: false,
      selected: [],
      pickerOpen: false,
      confirm: null,
      sortOpen: false,
    });

  return {
    selecting: s.selecting,
    tracks,
    total: tracks.length,
    isSelected: (id) => s.selected.includes(id),
    picked,
    allSelected: s.selected.length === tracks.length,
    sort: s.sort,
    sortOpen: s.sortOpen,
    pickerOpen: s.pickerOpen,
    confirm: s.confirm,
    result: s.result,
    likedPlan,
    enter: () => patch({ selecting: true, result: null }),
    exit: () => patch({ selecting: false, selected: [], sortOpen: false, pickerOpen: false, confirm: null }),
    toggle: (id) =>
      setS((prev) => ({
        ...prev,
        selecting: true,
        result: null,
        selected: prev.selected.includes(id) ? prev.selected.filter((x) => x !== id) : [...prev.selected, id],
      })),
    toggleAll: () => setS((prev) => ({ ...prev, selected: prev.selected.length === ALL_IDS.length ? [] : ALL_IDS })),
    clear: () => patch({ selected: [] }),
    setSort: (sort) => patch({ sort }),
    setSortOpen: (sortOpen) => patch({ sortOpen, pickerOpen: false }),
    setPickerOpen: (pickerOpen) => patch({ pickerOpen, sortOpen: false }),
    choose: (destination) => (destination.kind === 'liked' ? patch({ confirm: destination, pickerOpen: false }) : run(destination)),
    confirmLiked: () => s.confirm && run(s.confirm),
    cancelConfirm: () => patch({ confirm: null }),
    dismissResult: () => patch({ result: null }),
  };
}
