const PLUGINS = [
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
  return (
    <section className="max-w-2xl">
      <h2 className="text-xl font-bold tracking-tight">Plugins</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Optional add-ons that layer on top of the player. More to come.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {PLUGINS.map((p) => (
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
