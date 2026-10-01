'use client';

import { create } from 'zustand';
import { BAR_MESSAGE_MS, barLines, songsOf, type BarMessage } from '@/lib/playback/unplayableBar';
import type { UnplayableNotice } from '@/lib/playback/unplayable';

/** Songs that could not play, on screen: the message in the player bar (and
 *  the full-screen player's title area), and the queue sheet's "Couldn't
 *  play" list for this session. Fed by the provider (through the notifier,
 *  which holds what failed while the app was away); never persisted. */
interface UnplayableState {
  /** What the bar says instead of the song, or null for the song. */
  message: BarMessage | null;
  /** This session's songs that could not play, oldest first, one entry per
   *  song: the queue sheet's "Couldn't play" section. Cleared when a new
   *  queue starts. */
  couldntPlay: UnplayableNotice[];
}

export const useUnplayableStore = create<UnplayableState>()(() => ({ message: null, couldntPlay: [] }));

let timer: ReturnType<typeof setTimeout> | null = null;
let lastKey = 0;

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Put a message in the bar. One that arrives while a skip is still showing
 *  joins it ("Skipped 3 songs", and the few seconds start again), so a burst
 *  is one message, not a flicker of them. A skip goes after BAR_MESSAGE_MS;
 *  one that stopped the music stays until the listener acts. `away`: these
 *  failed while the app was in the background (the one summary on return). */
export function showUnplayable(notices: readonly UnplayableNotice[], opts: { away?: boolean } = {}) {
  const songs = songsOf(notices);
  if (!songs.length) return;
  const away = !!opts.away;
  const prev = useUnplayableStore.getState().message;
  // A message that stopped the music is about a situation the listener has
  // not answered yet: a new one replaces it rather than blending into it.
  const message: BarMessage = prev && !barLines(prev).sticky
    ? { key: prev.key, notices: songsOf([...prev.notices, ...songs]), away: prev.away || away }
    : { key: ++lastKey, notices: songs, away };
  stopTimer();
  useUnplayableStore.setState({ message });
  if (!barLines(message).sticky) {
    timer = setTimeout(() => {
      timer = null;
      if (useUnplayableStore.getState().message?.key === message.key) useUnplayableStore.setState({ message: null });
    }, BAR_MESSAGE_MS);
  }
}

/** The bar shows the song again: the listener acted (play, next, a tap). */
export function dismissUnplayable() {
  stopTimer();
  if (useUnplayableStore.getState().message) useUnplayableStore.setState({ message: null });
}

/** Playback moved on by itself or from outside the app (the lock screen, the
 *  car): a message that stopped the music is over once a different song is
 *  current or the music starts again. Skips are left to their timer. */
export function settleUnplayable(currentId: string | null, startedPlaying: boolean) {
  const m = useUnplayableStore.getState().message;
  if (!m || !barLines(m).sticky) return;
  const anchor = songsOf(m.notices).find((n) => n.outcome === 'stopped' || n.outcome === 'gave-up')?.trackId ?? null;
  if (startedPlaying || (currentId !== null && anchor !== null && currentId !== anchor)) dismissUnplayable();
}

/** Add to the queue's "Couldn't play" list (the latest word on each song). */
export function recordCouldntPlay(notices: readonly UnplayableNotice[]) {
  const fresh = songsOf(notices);
  if (!fresh.length) return;
  useUnplayableStore.setState((s) => ({ couldntPlay: songsOf([...s.couldntPlay, ...fresh]) }));
}

/** A song on the list played after all (a passing failure): off the list. */
export function forgetCouldntPlay(trackId: string) {
  const list = useUnplayableStore.getState().couldntPlay;
  if (list.some((n) => n.trackId === trackId)) {
    useUnplayableStore.setState({ couldntPlay: list.filter((n) => n.trackId !== trackId) });
  }
}

/** A new queue: the old one's failures are no longer about it. */
export function clearCouldntPlay() {
  if (useUnplayableStore.getState().couldntPlay.length) useUnplayableStore.setState({ couldntPlay: [] });
}

/** Tests: back to nothing on screen, no timer running. */
export function resetUnplayableStore() {
  stopTimer();
  useUnplayableStore.setState({ message: null, couldntPlay: [] });
}
