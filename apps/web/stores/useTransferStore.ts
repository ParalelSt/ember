'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** What this device remembers about transfers, so the progress chip and the
 *  "Transfer done" notification behave across reloads: which transfers it
 *  started (a new-playlist transfer is followed only from here), which have
 *  said "Transfer done", and which finished ones the person has looked at.
 *  Only ids, a few dozen at most. */
interface TransferState {
  followed: string[];
  notified: string[];
  seen: string[];
  follow: (id: string) => void;
  markNotified: (id: string) => void;
  markSeen: (id: string) => void;
}

const KEEP = 30;
const add = (list: string[], id: string) => (list.includes(id) ? list : [id, ...list].slice(0, KEEP));

export const useTransferStore = create<TransferState>()(
  persist(
    (set) => ({
      followed: [],
      notified: [],
      seen: [],
      follow: (id) => set((s) => ({ followed: add(s.followed, id) })),
      markNotified: (id) => set((s) => ({ notified: add(s.notified, id) })),
      markSeen: (id) => set((s) => ({ seen: add(s.seen, id) })),
    }),
    { name: 'ember-transfers' },
  ),
);
