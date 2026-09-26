/** A volume multiplier that moves to a new value either at once or as a
 *  short fade. The engines use it for the song's normalization gain: a gain
 *  that arrives while the song is already playing (or the setting switched
 *  mid-song) fades in over a few hundred milliseconds instead of jumping.
 *
 *  The fade is even in dB (what the ear hears as even) and is stepped on a
 *  timer, calling `onStep` with each new value; the owner applies it. In a
 *  background tab the browser may slow the timer to once a second: the fade
 *  then simply finishes on the next tick. */

export interface GainRamp {
  /** The multiplier right now (mid-fade: where the fade has got to). */
  value(): number;
  /** Go to `target`: at once when `ms` <= 0, else over `ms`. Asking again for
   *  the value it is already going to changes nothing, so an unrelated
   *  update (the slider) never cuts a fade short. */
  set(target: number, ms: number): void;
  /** Stop any fade where it is (the engine is going away). */
  cancel(): void;
}

const STEP_MS = 25;

const toDb = (g: number) => 20 * Math.log10(g);
const fromDb = (db: number) => Math.pow(10, db / 20);

/** Where a fade from `from` to `to` is after `elapsed` of `duration` ms. */
export function rampAt(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to;
  if (elapsed <= 0) return from;
  const t = elapsed / duration;
  // Silence has no dB: fade those linearly (never happens for song gains).
  if (from <= 0 || to <= 0) return from + (to - from) * t;
  return fromDb(toDb(from) + (toDb(to) - toDb(from)) * t);
}

export function createGainRamp(
  onStep: (value: number) => void,
  opts: { now?: () => number; stepMs?: number } = {},
): GainRamp {
  const now = opts.now ?? (() => Date.now());
  const stepMs = opts.stepMs ?? STEP_MS;
  let current = 1;
  let from = 1;
  let target = 1;
  let startedAt = 0;
  let duration = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const tick = () => {
    current = rampAt(from, target, now() - startedAt, duration);
    if (current === target) stop();
    onStep(current);
  };

  return {
    value: () => current,
    set(next, ms) {
      if (!Number.isFinite(next) || next < 0) return;
      if (next === target) return;
      target = next;
      if (ms <= 0) {
        stop();
        current = next;
        return;
      }
      from = current;
      startedAt = now();
      duration = ms;
      if (!timer) timer = setInterval(tick, stepMs);
    },
    cancel() {
      stop();
      target = current;
    },
  };
}
