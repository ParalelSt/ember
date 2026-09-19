import type { ReactNode } from 'react';
import { Artwork } from '@/components/primitives/Artwork';
import { CheckIcon, CloseIcon, MusicIcon, PauseIcon, PlayIcon } from '@/components/icons';
import { formatTime } from '@/lib/format';
import { candidateReasons, kindOf } from '@/lib/import/reasons';
import type { ImportCandidate, ImportSourceKind } from '@/lib/import/types';
import { cn } from '@/lib/utils';

// Presentational bits of the playlist import (the approved /dizajn
// candidates: Tabs dialog, progress, Side sheet review). Data in, callbacks
// out, nothing fetched.

/** Brand dot colours for the sources: stand-ins for the services' own marks,
 *  kept to a 6px dot so the badge still reads as Ember. */
const SOURCE_DOT: Record<ImportSourceKind, string> = {
  spotify: 'bg-[#1ed760]',
  ytmusic: 'bg-[#ff0033]',
  youtube: 'bg-[#ff0033]',
};

export const SOURCE_NAME: Record<ImportSourceKind, string> = {
  spotify: 'Spotify',
  ytmusic: 'YouTube Music',
  youtube: 'YouTube',
};

/** "Spotify" / "YouTube Music" pill: where the pasted playlist lives. */
export function SourceBadge({ kind, className }: { kind: ImportSourceKind; className?: string }) {
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

/** A candidate's type ("Official audio"). */
export function KindBadge({ kind }: { kind: string }) {
  return <span className="rounded-full bg-secondary px-cluster text-[11px] font-medium leading-5 text-foreground/85">{kind}</span>;
}

/** One plain-words reason a candidate scored the way it did: a check for a
 *  point in its favour, a cross for a point against. */
export function Reason({ text, good }: { text: string; good: boolean }) {
  const Icon = good ? CheckIcon : CloseIcon;
  return (
    <span
      data-testid="candidate-reason"
      data-good={good}
      className={cn('inline-flex items-center gap-inset text-[11px] leading-5', good ? 'text-foreground/80' : 'text-muted-foreground')}
    >
      <Icon className={cn('h-3 w-3', good ? 'text-ember' : 'text-muted-foreground')} />
      {text}
    </span>
  );
}

/** A keyboard key hint, for the side sheet's 1 to 3 and S. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="grid h-5 min-w-5 place-items-center rounded border border-border bg-background px-inset font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}

/** "Needs review" / "Not found" marker at the end of a playlist row. */
export function StatusPill({ status }: { status: 'review' | 'not-found' }) {
  return status === 'review' ? (
    <span
      data-testid="needs-review-pill"
      className="inline-flex items-center gap-inset whitespace-nowrap rounded-full border border-ember/40 px-cluster text-[11px] font-medium leading-5 text-ember"
    >
      <span className="size-1.5 rounded-full bg-ember" />
      Needs review
    </span>
  ) : (
    <span
      data-testid="not-found-pill"
      className="whitespace-nowrap rounded-full border border-border px-cluster text-[11px] font-medium leading-5 text-muted-foreground"
    >
      Not found
    </span>
  );
}

export interface CandidateRowProps {
  candidate: ImportCandidate;
  /** Shown as a key hint (1, 2, 3) in the side sheet, on desktop. */
  keyHint?: string;
  /** Top of the list: labelled "Best match". */
  best?: boolean;
  /** The one in the playlist now (a re-match). */
  current?: boolean;
  /** This candidate is the one the player is previewing. */
  previewing?: boolean;
  playing?: boolean;
  disabled?: boolean;
  onPick: () => void;
  onPreview: () => void;
}

/** One YouTube candidate: a thumbnail with a preview button, title,
 *  channel and length, its type, its score and the reasons behind it. The
 *  info block is the pick button; the preview is a separate button so the
 *  two never nest. */
export function CandidateRow({
  candidate: c,
  keyHint,
  best = false,
  current = false,
  previewing = false,
  playing = false,
  disabled = false,
  onPick,
  onPreview,
}: CandidateRowProps) {
  const kind = kindOf(c.videoType);
  const channel = c.artists.length ? c.artists.join(', ') : c.track.artist;
  const hearing = previewing && playing;
  return (
    <div
      data-testid="candidate-row"
      data-current={current}
      className={cn(
        'group flex items-start gap-row rounded-lg px-row py-cluster transition-colors',
        current ? 'bg-accent/70 ring-1 ring-ember/60' : 'hover:bg-card',
      )}
    >
      {keyHint && (
        <div className="pt-cluster max-md:hidden">
          <Kbd>{keyHint}</Kbd>
        </div>
      )}
      <div className="relative shrink-0">
        <Artwork src={c.track.artworkUrl} size="sm" className="grid place-items-center rounded-md bg-black text-foreground/20">
          <MusicIcon className="h-4 w-4" />
        </Artwork>
        <button
          type="button"
          onClick={onPreview}
          aria-label={`${hearing ? 'Pause' : 'Preview'} "${c.track.title}"`}
          title={hearing ? 'Pause' : 'Preview 20 seconds'}
          className="absolute inset-0 grid place-items-center rounded-md bg-black/35 text-white opacity-90 transition-opacity hover:bg-black/50"
        >
          {hearing ? <PauseIcon className="h-4 w-4 fill-current" /> : <PlayIcon className="h-4 w-4 fill-current" />}
        </button>
      </div>
      <button type="button" onClick={onPick} disabled={disabled} className="min-w-0 flex-1 text-left disabled:opacity-60">
        <div className="flex items-baseline gap-cluster">
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{c.track.title}</div>
          <div className={cn('shrink-0 text-xs tabular-nums', c.score >= 65 ? 'text-foreground/85' : 'text-muted-foreground')}>
            {c.score}% match
          </div>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {channel} · {formatTime(c.track.durationSec)}
        </div>
        <div className="mt-inset flex flex-wrap items-center gap-x-cluster gap-y-inset">
          {current ? (
            <span className="rounded-full bg-ember/15 px-cluster text-[11px] font-medium leading-5 text-ember">In the playlist</span>
          ) : (
            best && <span className="rounded-full bg-ember/15 px-cluster text-[11px] font-medium leading-5 text-ember">Best match</span>
          )}
          {kind && <KindBadge kind={kind} />}
          {candidateReasons(c).map((r) => (
            <Reason key={r.text} text={r.text} good={r.good} />
          ))}
        </div>
      </button>
    </div>
  );
}
