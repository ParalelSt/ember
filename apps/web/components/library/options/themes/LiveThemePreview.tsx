import type { CSSProperties } from 'react';
import { FlameIcon, HeartIcon, HomeIcon, LibraryIcon, PauseIcon, SearchIcon } from '@/components/icons';
import { PlayButton } from '@/components/primitives/PlayButton';
import { Artwork } from '@/components/primitives/Artwork';
import { TrackList } from '@/components/track/TrackList';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { MOCK_HOME_TRACKS, MOCK_NOW_PLAYING } from '@/app/(app)/dizajn/mock';
import { ReadabilityFinding } from '@/components/library/options/themes/ReadabilityFinding';

const NOOP = () => {};
const NO_LIKES = new Set<string>();
const NAV = [
  { id: 'home', label: 'Home', Icon: HomeIcon, active: true },
  { id: 'search', label: 'Search', Icon: SearchIcon, active: false },
  { id: 'library', label: 'Library', Icon: LibraryIcon, active: false },
];

export interface LiveThemePreviewProps {
  /** The candidate theme's derived CSS variables, set on this component's
   *  own wrapper (a scoped style, not on <html>): this is the mock shell
   *  that gets "recoloured", the rest of the gallery frame stays as-is. */
  vars: Record<string, string>;
  /** Whether the candidate's colours currently fail the readability guard
   *  (the plan's Task 0 requirement: show the warning and its Fix it on at
   *  least one frame). */
  showWarning?: boolean;
  onFixIt?: () => void;
  className?: string;
}

/** The editor's own live preview: a small, real-looking copy of the app
 *  (sidebar, a page with rows, a button, a search field, the player bar),
 *  built from REAL presentational pieces (TrackList, PlayButton, Artwork,
 *  Input) on mock data, so it cannot drift far from what the app actually
 *  renders. Everything about its colour comes from the CSS custom
 *  properties set on its own wrapper `<div>`; no component here names a
 *  colour. */
export function LiveThemePreview({ vars, showWarning, onFixIt, className }: LiveThemePreviewProps) {
  return (
    <div
      data-testid="live-theme-preview"
      style={vars as CSSProperties}
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground',
        className,
      )}
    >
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-40 shrink-0 flex-col gap-block border-r border-sidebar-border bg-sidebar p-block text-sidebar-foreground">
          <div className="flex items-center gap-cluster font-bold">
            <FlameIcon className="h-4 w-4 text-ember" />
            Ember
          </div>
          <nav className="flex flex-col gap-inset">
            {NAV.map(({ id, label, Icon, active }) => (
              <div
                key={id}
                className={cn(
                  'flex items-center gap-cluster rounded-md px-cluster py-inset text-sm',
                  active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </div>
            ))}
          </nav>
        </aside>
        <div className="flex min-h-0 flex-1 flex-col gap-row overflow-y-auto p-block">
          <div className="flex items-center justify-between gap-row">
            <div className="text-lg font-bold tracking-tight">Home</div>
            <PlayButton size="sm" playing={false} onClick={NOOP} label="Play all" />
          </div>
          <Input
            readOnly
            value=""
            onChange={NOOP}
            placeholder="Search"
            aria-label="Search"
            className="h-8 rounded-full border-0 bg-card text-xs"
          />
          <TrackList
            tracks={MOCK_HOME_TRACKS.slice(0, 3)}
            currentId={MOCK_NOW_PLAYING.id}
            isPlaying
            likedIds={NO_LIKES}
            onPlay={NOOP}
            onToggle={NOOP}
          />
          {showWarning && <ReadabilityFinding onFixIt={onFixIt} />}
        </div>
      </div>
      <footer className="flex shrink-0 items-center gap-row border-t border-sidebar-border bg-sidebar px-block py-row">
        <Artwork src={MOCK_NOW_PLAYING.artworkUrl} size="xs" className="shrink-0 rounded-md bg-art" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{MOCK_NOW_PLAYING.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">{MOCK_NOW_PLAYING.artist}</div>
        </div>
        <span className={cn('grid size-hit shrink-0 place-items-center rounded-full', 'text-ember')}>
          <HeartIcon className="h-4 w-4 fill-current" />
        </span>
        <span className="grid size-hit shrink-0 place-items-center rounded-full bg-foreground text-background">
          <PauseIcon className="h-4 w-4 fill-current" />
        </span>
      </footer>
    </div>
  );
}
