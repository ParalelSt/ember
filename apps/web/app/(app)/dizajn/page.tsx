'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { HomeChips } from '@/components/home/HomeChips';
import { QuickGrid, type QuickGridProps } from '@/components/home/QuickGrid';
import { useCollections } from '@/hooks/useCollections';
import { usePlayCollection } from '@/hooks/usePlayCollection';
import { countLabel } from '@/lib/collections';
import { homeChips, quickPicks, type HomeFilter, type QuickPick } from '@/lib/home';

type Option = { id: string; description: string; props: Partial<QuickGridProps> };
const options: Option[] = [
  { id: 'A1', description: 'Today: four equal columns that stretch to fill the frame.', props: {} },
  { id: 'A2', description: 'Fixed 280px tiles, wrapping as space allows.', props: { layout: 'fixed-280' } },
  { id: 'A3', description: 'Fixed 320px tiles, wrapping as space allows.', props: { layout: 'fixed-320' } },
  { id: 'A4', description: 'Fixed 360px tiles, wrapping as space allows.', props: { layout: 'fixed-360' } },
  { id: 'A5', description: 'Auto-fill columns with a 220px minimum.', props: { layout: 'auto-220' } },
  { id: 'A6', description: 'Auto-fill columns with a 260px minimum.', props: { layout: 'auto-260' } },
  { id: 'A7', description: 'Auto-fill columns with a 300px minimum.', props: { layout: 'auto-300' } },
  { id: 'A8', description: 'Four equal columns in a grid capped at 1200px.', props: { layout: 'capped' } },
  { id: 'A9', description: 'Up to six columns with a 200px minimum.', props: { layout: 'six-columns' } },
  { id: 'A10', description: '260px minimum, two rows maximum; Show all reveals extra tiles.', props: { layout: 'two-rows' } },
  { id: 'B1', description: 'A6 with compact 48px tiles and flush covers.', props: { layout: 'auto-260', tileHeight: 48 } },
  { id: 'B2', description: 'A6 with 56px tiles and flush covers.', props: { layout: 'auto-260', tileHeight: 56 } },
  { id: 'B3', description: 'A6 with today’s 64px height and flush covers.', props: { layout: 'auto-260', tileHeight: 64 } },
  { id: 'B4', description: 'A6 with roomier 72px tiles and flush covers.', props: { layout: 'auto-260', tileHeight: 72 } },
  { id: 'B5', description: 'A6 with 80px covers and song counts under the names.', props: { layout: 'auto-260', tileHeight: 80, showSongCount: true } },
  { id: 'B6', description: 'A6 with 64px tiles, 6px cover insets and rounded artwork.', props: { layout: 'auto-260', tileStyle: 'inset' } },
  { id: 'B7', description: '120px square covers with names below, like Your top mixes.', props: { layout: 'auto-260', tileStyle: 'covers' } },
  { id: 'B8', description: 'A6 with fully rounded 48px pill tiles.', props: { layout: 'auto-260', tileStyle: 'pill' } },
];

export default function DizajnPage() {
  const [width, setWidth] = useState('Actual');
  const [count, setCount] = useState(3);
  const [showChips, setShowChips] = useState(true);
  const [filter, setFilter] = useState<HomeFilter>('all');
  const { system, playlists, isLoading } = useCollections();
  const collection = usePlayCollection();
  const liked = system.find((item) => item.ref.kind === 'liked');
  const source = quickPicks({ liked, playlists, carlist: null, max: 8 });
  const items: QuickPick[] = source.length ? Array.from({ length: count }, (_, index) => {
    const item = source[index % source.length];
    const summary = item.ref?.kind === 'liked' ? liked : playlists.find((p) => p.pinId === item.key);
    return {
      ...item,
      key: `${item.key}-${index}`,
      songCount: summary?.ref.kind === 'liked' ? summary.subtitle : summary?.trackCount !== undefined ? countLabel(summary.trackCount) : undefined,
    };
  }) : [];
  const chips = homeChips(new Set(playlists.length ? ['playlists'] : []));
  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success(`Copied ${id}`);
    } catch {
      toast.error(`Couldn't copy. Your pick is ${id}.`);
    }
  };

  return (
    <div data-home-wide className="min-w-0">
      <h1 className="text-2xl font-bold">Dizajn: quick grid</h1>
      <p className="mt-cluster mb-stack text-sm text-muted-foreground">Compare your Home playlists. Click an option label to copy your pick. Counts include Liked songs; collections repeat when needed.</p>
      <div className="sticky top-[var(--ember-topbar-h,0px)] z-20 mb-stack flex flex-wrap items-center gap-block rounded-lg border border-border bg-background p-block shadow-soft">
        <label className="flex items-center gap-cluster text-sm font-semibold">Preview width
          <select value={width} onChange={(e) => setWidth(e.target.value)} className="rounded-md border border-border bg-secondary p-cluster">
            {['Actual', '1280', '1600', '1920', '2560'].map((value) => <option key={value} value={value}>{value === 'Actual' ? value : `${value}px`}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-cluster text-sm font-semibold">Playlist count
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="rounded-md border border-border bg-secondary p-cluster">
            {[3, 5, 8].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-cluster text-sm font-semibold"><input type="checkbox" checked={showChips} onChange={(e) => setShowChips(e.target.checked)} className="accent-ember" />Show chips</label>
      </div>
      {isLoading && <p role="status" className="mb-stack text-muted-foreground">Loading your collections...</p>}
      <div className="space-y-stack">
        {options.map((option) => (
          <section key={option.id} aria-label={option.id} className="min-w-0 rounded-lg border border-border bg-background">
            <div className="flex items-baseline gap-row border-b border-border p-block">
              <h2><button type="button" aria-label={`Copy ${option.id}`} onClick={() => void copy(option.id)} className="rounded-md bg-foreground/10 px-row py-cluster font-bold text-ember hover:bg-foreground/20">{option.id}</button></h2>
              <p className="text-sm text-muted-foreground">{option.description}</p>
            </div>
            <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={`${option.id} scrollable preview`}>
              <div data-testid="preview-frame" style={{ width: width === 'Actual' ? '100%' : `${width}px` }} className="py-stack">
                {showChips && <HomeChips variant="desktop" chips={chips} active={filter} onChange={setFilter} />}
                <QuickGrid {...option.props} variant="desktop" items={items}
                  onPlay={(item) => { if (item.ref) void collection.play(item.ref, item.title); }}
                  isPlaying={(item) => !!item.ref && collection.isPlaying(item.ref)} />
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
