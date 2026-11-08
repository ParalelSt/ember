'use client';

import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { createBackoff, retryAfterOf } from '@/lib/pranks/backoff';
import { decideAttach } from '@/lib/remote/attach';
import { controllerPollDelay } from '@/lib/remote/cadence';
import { clockOffset } from '@/lib/remote/extrapolate';
import { STALE_MS, type StateAnswer } from '@/lib/remote/types';

/** After the target changes (a move), the music is not "elsewhere" yet:
 *  the device it went to may not have started. Following the device still
 *  playing waits until the new target has reported, or this long. */
export const FOLLOW_GRACE_MS = 5_000;
import { mergeDevices, remoteDevice, useRemoteStore } from '@/stores/useRemoteStore';

/** The controller's side: asks the server about the account's other
 *  devices (once on open and on coming back to the page, every 1.5 s while
 *  controlling one and the page is visible, nothing while hidden), keeps
 *  stores/useRemoteStore, and decides when this device starts or stops
 *  controlling another:
 *  - another device is active and nothing plays here: attach to it;
 *  - the active device changes to a third one while controlling: follow it;
 *  - the device controlled is stale (the server's STALE_MS without a beat),
 *    or has been missing (or unanswered) for STALE_MS: detach. */
export function useRemoteDevices({
  enabled,
  me,
  localPlaying,
  onAttach,
  onDetach,
  fetchState = (device: string, rev: number | null, controlling: string | null) => api.remote.state(device, rev, controlling),
}: {
  enabled: boolean;
  me: string | null;
  localPlaying: () => boolean;
  onAttach: (deviceId: string) => void;
  onDetach: () => void;
  fetchState?: (device: string, rev: number | null, controlling: string | null) => Promise<StateAnswer>;
}) {
  const latest = useRef({ localPlaying, onAttach, onDetach, fetchState });
  useEffect(() => {
    latest.current = { localPlaying, onAttach, onDetach, fetchState };
  });

  useEffect(() => {
    if (!enabled || !me) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    const backoff = createBackoff();
    /** When the controlled device was last seen fresh here. */
    let lastFresh = Date.now();
    /** When the music last moved from the device controlled to another. */
    let targetSince = 0;

    const hidden = () => typeof document !== 'undefined' && document.hidden;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (disposed) return;
      const st = useRemoteStore.getState();
      const delay = controllerPollDelay({ controlling: st.mode === 'controlling', pickerOpen: st.pickerOpen, hidden: hidden() });
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
      // The server calls a device stale after STALE_MS without a beat:
      // that is the wait already. A device missing from the answer (the
      // host restarted) gets the same grace here before giving up on it.
      if (target?.stale) {
        latest.current.onDetach();
        return;
      }
      if (target) lastFresh = now;
      if (active && !active.stale && active.deviceId !== me && active.deviceId !== st.target && active.snapshot?.isPlaying) {
        // The target's report since the change, in this device's clock.
        const reported = !!target?.snapshot && target.snapshot.at - st.offset > targetSince;
        if (reported || now - targetSince >= FOLLOW_GRACE_MS) {
          lastFresh = now;
          st.set({ target: active.deviceId });
          return;
        }
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
        const rs = useRemoteStore.getState();
        const answer = await latest.current.fetchState(me!, rs.rev, rs.mode === 'controlling' ? rs.target : null);
        if (disposed) return;
        backoff.ok();
        const st = useRemoteStore.getState();
        st.set({
          devices: mergeDevices(st.devices, answer),
          active: answer.active,
          rev: answer.rev,
          offset: clockOffset(answer.now, sentAt, Date.now()),
          heardAt: Date.now(),
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
      if (s.target && p.target && s.target !== p.target) targetSince = Date.now();
      if (s.mode !== p.mode) {
        lastFresh = Date.now();
        schedule();
      }
      // The picker opening asks at once: its list must be current.
      if (s.pickerOpen !== p.pickerOpen) {
        if (s.pickerOpen && !hidden()) void poll();
        else schedule();
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
