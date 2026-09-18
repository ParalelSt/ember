import { CollectionCover } from '@/components/library/CollectionCover';
import { PlayIcon, ShuffleIcon, DownloadIcon } from '@/components/icons';
import { MOCK_COLLECTION_HERO } from '@/app/(app)/dizajn/mock';
import { cn } from '@/lib/utils';

export type Rhythm = 'even' | 'grouped' | 'today';
export type ActionsPlacement = 'beside' | 'below';

/** The three "meta to actions" / "actions to first row" gap pairs stage 1
 *  is choosing between (docs/design-system.md section 3). `titleToMeta` is
 *  part of the same fix (12 -> 8) but is not itself a picker: Even and
 *  Grouped both use the new stack, Today keeps the live page's number so
 *  it reads as a true reference, not a third variant of the fix. */
const RHYTHM_GAPS: Record<Rhythm, { titleToMeta: number; metaToActions: number; actionsToRow: number }> = {
  even: { titleToMeta: 8, metaToActions: 24, actionsToRow: 24 },
  grouped: { titleToMeta: 8, metaToActions: 16, actionsToRow: 32 },
  today: { titleToMeta: 12, metaToActions: 0, actionsToRow: 48 },
};

// Class per gap. titleToMeta and metaToActions use the new named tokens for
// Even/Grouped (cluster 8, block 16, stack 24); Today intentionally keeps
// the plain Tailwind defaults that already produce the live page's numbers
// (mt-3 = 12px, mt-12 = 48px), since it exists to show what is live today,
// not to be migrated. Grouped's 32 has no named token of its own in section
// 2 (page-lg happens to share the value but is a different role), so it
// stays a plain default (mt-8 = 32px) rather than borrowing an unrelated
// token name.
const TITLE_TO_META_CLASS: Record<Rhythm, string> = {
  even: 'mt-cluster',
  grouped: 'mt-cluster',
  today: 'mt-3',
};
const META_TO_ACTIONS_CLASS: Record<Rhythm, string> = {
  even: 'mt-stack',
  grouped: 'mt-block',
  today: 'mt-0',
};
const ACTIONS_TO_ROW_CLASS: Record<Rhythm, string> = {
  even: 'mt-stack',
  grouped: 'mt-8',
  today: 'mt-12',
};

const COVER_TO_EYEBROW_PX = 24; // gap-stack on the header flex, constant across all six candidates
const EYEBROW_TO_TITLE_PX = 8; // baked into text-hero-title's own mt-2, constant, not a picker choice

/** The legend line under a preview: every gap in the current stack, in px,
 *  so the owner can read the numbers next to the shape. */
export function rhythmLegend(rhythm: Rhythm): string {
  const g = RHYTHM_GAPS[rhythm];
  return [
    `cover to eyebrow ${COVER_TO_EYEBROW_PX}`,
    `eyebrow to title ${EYEBROW_TO_TITLE_PX}`,
    `title to meta ${g.titleToMeta}`,
    `meta to actions ${g.metaToActions}`,
    `actions to first row ${g.actionsToRow}`,
  ].join(' / ');
}

export interface RhythmPreviewProps {
  rhythm: Rhythm;
  actions: ActionsPlacement;
  /** Forces the stacked (phone) header instead of the desktop
   *  `md:flex-row items-end` shape. A real `md:` class would key off the
   *  viewport, not this box, so a 390px container next to a full-width one
   *  would both render the desktop shape; this prop is how the two preview
   *  columns actually differ. */
  phone: boolean;
}

function ActionBarMock({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-cluster', className)} data-testid="mock-action-bar">
      <button
        type="button"
        tabIndex={-1}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-ember text-white"
        aria-hidden="true"
      >
        <PlayIcon className="ml-0.5 h-5 w-5 fill-current" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="flex h-12 w-12 items-center justify-center rounded-full text-muted-foreground"
        aria-hidden="true"
      >
        <ShuffleIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="flex items-center gap-inset rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground"
        aria-hidden="true"
      >
        <DownloadIcon className="h-4 w-4" />
        Download
      </button>
    </div>
  );
}

function MockTrackRow({ track }: { track: (typeof MOCK_COLLECTION_HERO.tracks)[number] }) {
  return (
    <div
      data-testid="mock-track-row"
      className="flex items-center gap-row rounded-md px-row py-cluster hover:bg-card/60"
    >
      <div className="size-art-xs shrink-0 rounded bg-card" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
      </div>
      <div className="shrink-0 text-xs tabular-nums text-muted-foreground">{track.duration}</div>
    </div>
  );
}

/** Presentational only, mock data only (no hooks, no stores, no
 *  react-query, no PlayerProvider, no network): a Liked-songs collection
 *  hero rendered under one of the six Rhythm x Actions combinations, so the
 *  owner can compare candidates for docs/design-system.md section 3 before
 *  anything on a real page changes. Import restricted to app/(app)/dizajn/**
 *  by design (see docs/design-system.md section 6). */
export function RhythmPreview({ rhythm, actions, phone }: RhythmPreviewProps) {
  const hero = MOCK_COLLECTION_HERO;
  const headerRowClass = phone
    ? 'flex flex-col items-start gap-stack'
    : 'flex flex-row items-end gap-stack';

  const actionBarBeside = actions === 'beside' ? <ActionBarMock className={META_TO_ACTIONS_CLASS[rhythm]} /> : null;
  const actionBarBelow = actions === 'below' ? <ActionBarMock className={META_TO_ACTIONS_CLASS[rhythm]} /> : null;

  return (
    <div
      data-testid="rhythm-preview"
      data-rhythm={rhythm}
      data-actions={actions}
      data-phone={phone}
      className="rounded-xl border border-border bg-surface p-inset"
    >
      <div className={headerRowClass}>
        <div className="shrink-0">
          <CollectionCover src={null} icon={null} className="size-art-hero rounded-2xl" />
        </div>
        <div className="min-w-0">
          <div className="text-eyebrow">{hero.eyebrow}</div>
          <h2 className="text-hero-title">{hero.title}</h2>
          <div data-testid="mock-meta" className={cn('text-meta', TITLE_TO_META_CLASS[rhythm])}>
            {hero.meta}
          </div>
          {actionBarBeside}
        </div>
      </div>
      {actionBarBelow}
      <div className={cn('flex flex-col', ACTIONS_TO_ROW_CLASS[rhythm])}>
        {hero.tracks.map((t) => (
          <MockTrackRow key={t.id} track={t} />
        ))}
      </div>
    </div>
  );
}
