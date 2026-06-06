'use client';

import { useSettingsStore } from '@/stores/useSettingsStore';
import { cn } from '@/lib/utils';

const PLACEHOLDERS = [
  {
    name: 'Songsterr integration',
    description: 'Guitar tabs and guitar mode for the currently-playing track.',
  },
  {
    name: 'TikTok window',
    description: 'Pinned side panel for TikTok while you listen.',
  },
];

export default function SettingsPlugins() {
  const partyVolume = useSettingsStore((s) => s.partyVolume);
  const setPartyVolume = useSettingsStore((s) => s.setPartyVolume);

  return (
    <section className="max-w-2xl">
      <h2 className="text-xl font-bold tracking-tight">Plugins</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Optional add-ons that layer on top of the player. More to come.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <PluginToggle
          name="Party-size volume slider"
          tag="PC only"
          description="Wider slider in the player bar and removes the 85% cap so the audio can go all the way to max. Visible on desktop — phones don't show the volume slider at all."
          on={partyVolume}
          onToggle={() => setPartyVolume(!partyVolume)}
        />

        {PLACEHOLDERS.map((p) => (
          <div
            key={p.name}
            className="rounded-2xl bg-card p-5 shadow-soft flex items-start justify-between gap-4 opacity-60"
          >
            <div className="min-w-0">
              <div className="font-semibold line-through">{p.name}</div>
              <p className="mt-1 text-sm text-muted-foreground line-through">{p.description}</p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              Coming soon
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

interface ToggleProps {
  name: string;
  description: string;
  on: boolean;
  onToggle: () => void;
  tag?: string;
}

function PluginToggle({ name, description, on, onToggle, tag }: ToggleProps) {
  return (
    <div className="rounded-2xl bg-card p-5 shadow-soft flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{name}</span>
          {tag && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              {tag}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        aria-label={on ? `Turn off ${name}` : `Turn on ${name}`}
        className={cn(
          'shrink-0 relative h-6 w-11 rounded-full transition-colors',
          on ? 'bg-ember' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            on && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}
