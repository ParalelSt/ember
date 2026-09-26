'use client';

import { useSyncExternalStore } from 'react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { autoPreampDb, clampBand, EQ_BANDS, EQ_MAX_DB, EQ_PRESETS, presetFor } from '@/lib/playback/eq';
import { eqForDevice, phoneWebAudio } from '@/lib/playback/eqDevice';
import { cn } from '@/lib/utils';

const BAND_LABELS = EQ_BANDS.map((f) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`));

export const formatDb = (db: number) => (db > 0 ? `+${db} dB` : `${db} dB`);

const noSubscribe = () => () => {};

interface Props {
  className?: string;
}

/** The equalizer's controls: the switch, the presets, five band sliders and
 *  the automatic pre-amp. Used in Settings > Plugins and in the sheet the
 *  full-screen player opens. Picking a preset or moving a band switches the
 *  equalizer on: a change nobody can hear would read as broken. */
export function EqualizerPanel({ className }: Props) {
  const account = useSettingsStore((s) => s.equalizer);
  const chosenHere = useSettingsStore((s) => s.eqChosenHere);
  const setEqualizer = useSettingsStore((s) => s.setEqualizer);
  // Server render and first paint say no, then the device answers: no
  // hydration mismatch.
  const risky = useSyncExternalStore(noSubscribe, phoneWebAudio, () => false);
  // A phone browser shows (and plays) it off until it is chosen here, even
  // when the account has it on from another device.
  const eq = eqForDevice(account, risky, chosenHere);
  const elsewhere = account.enabled && !eq.enabled;
  const preset = presetFor(eq.bands);
  const preamp = eq.enabled ? autoPreampDb(eq.bands) : 0;

  const setBand = (i: number, db: number) =>
    setEqualizer({ enabled: true, bands: eq.bands.map((b, k) => (k === i ? clampBand(db) : b)) });

  return (
    <div className={cn('flex flex-col gap-block', className)} data-testid="equalizer">
      <div className="flex items-start justify-between gap-block">
        <div className="min-w-0">
          <div className="font-semibold">Equalizer</div>
          <p className="mt-inset text-sm text-muted-foreground">
            Shape the sound with a preset or five bands. A pre-amp turns the whole song down as far as the boosts
            go up, so nothing clips.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEqualizer({ ...eq, enabled: !eq.enabled })}
          aria-pressed={eq.enabled}
          aria-label={eq.enabled ? 'Turn off Equalizer' : 'Turn on Equalizer'}
          className={cn('shrink-0 relative h-6 w-11 rounded-full transition-colors', eq.enabled ? 'bg-ember' : 'bg-muted')}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full shadow-sm transition-transform',
              eq.enabled ? 'translate-x-5 bg-ember-foreground' : 'bg-foreground',
            )}
          />
        </button>
      </div>

      {risky && (
        <p className="rounded-lg bg-muted px-row py-cluster text-xs text-muted-foreground" role="note">
          In a phone browser the equalizer can stop the music when the screen turns off, and switching it back off
          fully takes a reload. The Ember app does not have this problem.
          {elsewhere && ' It is on for your other devices; switch it on to use it here too.'}
        </p>
      )}

      <div role="group" aria-label="Presets" className="flex flex-wrap gap-cluster">
        {EQ_PRESETS.map((p) => {
          const active = eq.enabled && preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => setEqualizer({ enabled: true, bands: [...p.bands] })}
              className={cn(
                'rounded-full px-row py-inset text-xs font-medium transition-colors',
                active ? 'bg-ember text-ember-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          );
        })}
        {eq.enabled && preset === null && (
          <span className="rounded-full px-row py-inset text-xs font-medium bg-ember/15 text-foreground">Custom</span>
        )}
      </div>

      <div className={cn('flex flex-col gap-cluster', !eq.enabled && 'opacity-60')}>
        {BAND_LABELS.map((label, i) => {
          const db = eq.bands[i] ?? 0;
          return (
            <label key={label} className="grid grid-cols-[4.5rem_1fr_3.75rem] items-center gap-row text-sm">
              <span className="text-muted-foreground tabular-nums">{label}</span>
              <input
                type="range"
                min={-EQ_MAX_DB}
                max={EQ_MAX_DB}
                step={0.5}
                value={db}
                aria-label={label}
                aria-valuetext={formatDb(db)}
                onChange={(e) => setBand(i, Number(e.target.value))}
                className="w-full accent-ember"
              />
              <span className="text-right tabular-nums">{formatDb(db)}</span>
            </label>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-block text-xs text-muted-foreground">
        <span data-testid="equalizer-preamp">
          Pre-amp {formatDb(Math.round(preamp * 10) / 10 + 0)} (automatic)
        </span>
        <button
          type="button"
          onClick={() => setEqualizer({ enabled: eq.enabled, bands: [0, 0, 0, 0, 0] })}
          className="font-medium hover:text-foreground"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
