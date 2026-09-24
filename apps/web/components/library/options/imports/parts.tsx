import { Artwork } from '@/components/primitives/Artwork';
import { PlayIcon } from '@/components/icons';
import { Kbd, Reason } from '@/components/import/parts';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ImportCandidate, ImportSource } from '@/app/(app)/dizajn/mock';

// Presentational bits shared by every import candidate on /dizajn: mock
// data in, callbacks out, nothing fetched. The generic pieces (ring, key
// hint, reason, status pill) are the production ones.
export { ProgressRing } from '@/components/primitives/ProgressRing';
export { Kbd, Reason, StatusPill } from '@/components/import/parts';

/** Brand dot colours for the two sources. Stand-ins for the services' own
 *  marks (the only non-token colours in the section), kept to a 6px dot so
 *  the badge still reads as Ember. */
const SOURCE_DOT: Record<ImportSource['kind'], string> = {
  spotify: 'bg-[#1ed760]',
  ytm: 'bg-[#ff0033]',
};

export const SOURCE_NAME: Record<ImportSource['kind'], string> = {
  spotify: 'Spotify',
  ytm: 'YouTube Music',
};

/** "Spotify" / "YouTube Music" pill: where the pasted playlist lives. */
export function SourceBadge({ kind, className }: { kind: ImportSource['kind']; className?: string }) {
  return (
    <span
      data-testid="source-badge"
      className={cn(
        'inline-flex items-center gap-cluster rounded-full border border-border px-cluster py-inset text-xs font-medium text-foreground/85',
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', SOURCE_DOT[kind])} />
      {SOURCE_NAME[kind]}
    </span>
  );
}

/** A small uppercase-free pill for a candidate's type ("Official audio"). */
export function KindBadge({ kind }: { kind: ImportCandidate['kind'] }) {
  return (
    <span className="rounded-full bg-secondary px-cluster text-[11px] font-medium leading-5 text-foreground/85">
      {kind}
    </span>
  );
}

export interface CandidateRowProps {
  candidate: ImportCandidate;
  /** Shown as a key hint (1, 2, 3) in the side sheet. */
  keyHint?: string;
  selected?: boolean;
  /** Top of the list: labelled "Best match". */
  best?: boolean;
  onPick: () => void;
}

/** One YouTube candidate: a thumbnail with a (gallery-inert) preview
 *  button, title, channel and length, its type, its score and the reasons
 *  behind the score. The info block is the pick button; the preview is a
 *  separate one so the two never nest. */
export function CandidateRow({ candidate: c, keyHint, selected = false, best = false, onPick }: CandidateRowProps) {
  return (
    <div
      data-testid="candidate-row"
      data-selected={selected}
      className={cn(
        'group flex items-start gap-row rounded-lg px-row py-cluster transition-colors',
        selected ? 'bg-accent/70 ring-1 ring-ember/60' : 'hover:bg-card',
      )}
    >
      {keyHint && (
        <div className="pt-cluster">
          <Kbd>{keyHint}</Kbd>
        </div>
      )}
      <div className="relative shrink-0">
        <Artwork src={c.artworkUrl} size="sm" className="rounded-md bg-art" />
        <button
          type="button"
          aria-label={`Preview "${c.title}"`}
          title="Preview 20 seconds"
          className="absolute inset-0 grid place-items-center rounded-md bg-black/35 text-white opacity-90 transition-opacity hover:bg-black/50"
        >
          <PlayIcon className="h-4 w-4 fill-current" />
        </button>
      </div>
      <button type="button" onClick={onPick} className="min-w-0 flex-1 text-left" aria-pressed={selected}>
        <div className="flex items-baseline gap-cluster">
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{c.title}</div>
          <div className={cn('shrink-0 text-xs tabular-nums', c.score >= 65 ? 'text-foreground/85' : 'text-muted-foreground')}>
            {c.score}% match
          </div>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {c.channel} · {formatTime(c.durationSec)}
        </div>
        <div className="mt-inset flex flex-wrap items-center gap-x-cluster gap-y-inset">
          {best && (
            <span className="rounded-full bg-ember/15 px-cluster text-[11px] font-medium leading-5 text-ember">Best match</span>
          )}
          <KindBadge kind={c.kind} />
          {c.reasons.map((r) => (
            <Reason key={r.text} text={r.text} good={r.good} />
          ))}
        </div>
      </button>
    </div>
  );
}
