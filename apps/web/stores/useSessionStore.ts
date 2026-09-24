'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionClientState {
  /** Set while THIS device hosts a live carlist session (it owns playback).
   *  Persisted so a page refresh keeps the host role; useSessionHost clears
   *  it when the session ends or is gone, and sign-out clears it. Radio
   *  auto-extend is suppressed while
   *  set — the queue is exactly what the group added. */
  hostingSessionId: string | null;
  setHostingSessionId: (id: string | null) => void;
}

export const useSessionStore = create<SessionClientState>()(
  persist(
    (set) => ({
      hostingSessionId: null,
      setHostingSessionId: (hostingSessionId) => set({ hostingSessionId }),
    }),
    { name: 'ember.session.v1' },
  ),
);
