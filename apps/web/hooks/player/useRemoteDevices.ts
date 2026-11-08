'use client';

import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { createBackoff, retryAfterOf } from '@/lib/pranks/backoff';
import { decideAttach } from '@/lib/remote/attach';
import { controllerPollDelay } from '@/lib/remote/cadence';
import { clockOffset } from '@/lib/remote/extrapolate';
import { STALE_MS, type StateAnswer } from '@/lib/remote/types';
import { mergeDevices, remoteDevice, useRemoteStore } from '@/stores/useRemoteStore';

/** The controller's side: asks the server about the account's other
 *  devices (once on open and on coming back to the page, every 1.5 s while
 *  controlling one and the page is visible, nothing while hidden), keeps
 *  stores/useRemoteStore, and decides when this device starts or stops
 *  controlling another:
 *  - another device is active and nothing plays here: attach to it;
 *  - the active device changes to a third one while controlling: follow it;
 *  - the device controlled has not been seen fresh for STALE_MS: detach. */
export function useRemoteDevices({
  enabled,
  me,
  localPlaying,
  onAttach,
  onDetach,
  pickerOpen = false,
  fetchState = (device: string, rev: number | null) => api.remote.state(device, rev),
}: {
  enabled: boolean;
  me: string | null;
  localPlaying: () => boolean;
  onAttach: (deviceId: string) => void;
  onDetach: () => void;
  pickerOpen?: boolean;
  fetchState?: (device: string, rev: number | null) => Promise<StateAnswer>;
}) {
  const latest = useRef({ localPlaying, onAttach, onDetach, fetchState, pickerOpen });
  useEffect(() => {
    latest.current = { localPlaying, onAttach, onDetach, fetchState, pickerOpen };
  });

  useEffect(() => {
    if (!enabled || !me) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    const backoff = createBackoff();
    /** When the controlled device was last seen fresh here. */
    let lastFresh = Date.now();

    const hidden = () => typeof document !== 'undefined' && document.hidden;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (disposed) return;
      const st = useRemoteStore.getState();
      const delay = controllerPollDelay({ controlling: st.mode === 'controlling', pickerOpen: latest.current.pickerOpen, hidden: hidden() });
      if (delay === null) return;
      timer = setTimeout(() => void poll(), Math.max(delay, backoff.remaining()));
    };

    const evaluate = () => {
      const st = useRemoteStore.getState();
      const now = Date.now();
      const active = remoteDevice(st.active);
      if (st.mode === 'local') {
        const id = decideAttach(me, active, latest.current.localPlaying(), st.dismissed);
        if (id) {
          lastFresh = now;
          latest.current.onAttach(id);
        }
        return;
      }
      const target = remoteDevice(st.target);
      if (target && !target.stale) lastFresh = now;
      if (active && !active.stale && active.deviceId !== me && active.deviceId !== st.target && active.snapshot?.isPlaying) {
        lastFresh = now;
        st.set({ target: active.deviceId });
        return;
      }
      if (now - lastFresh > STALE_MS) latest.current.onDetach();
    };

    async function poll() {
      if (disposed || inFlight) return;
      if (backoff.blocked()) {
        schedule();
        return;
      }
      inFlight = true;
      const sentAt = Date.now();
      try {
        const answer = await latest.current.fetchState(me!, useRemoteStore.getState().rev);
        if (disposed) return;
        backoff.ok();
        const st = useRemoteStore.getState();
        st.set({
          devices: mergeDevices(st.devices, answer),
          active: answer.active,
          rev: answer.rev,
          offset: clockOffset(answer.now, sentAt, Date.now()),
        });
        evaluate();
      } catch (e) {
        if (disposed) return;
        backoff.fail(retryAfterOf(e));
        // No answer at all still counts towards giving up on the device.
        if (useRemoteStore.getState().mode === 'controlling') evaluate();
      } finally {
        inFlight = false;
      }
      schedule();
    }

    const onVisibility = () => {
      if (!hidden()) void poll();
      else schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Controlling starts or stops, the picker opens: a new cadence.
    const unsubscribe = useRemoteStore.subscribe((s, p) => {
      if (s.mode !== p.mode) {
        lastFresh = Date.now();
        schedule();
      }
    });
    if (!hidden()) void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, me]);
}
