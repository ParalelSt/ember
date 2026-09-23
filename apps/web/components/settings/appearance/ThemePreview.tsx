import type { CSSProperties } from 'react';
import { FlameIcon, HeartIcon, HomeIcon, LibraryIcon, PauseIcon, SearchIcon } from '@/components/icons';
import { PlayButton } from '@/components/primitives/PlayButton';
import { Artwork } from '@/components/primitives/Artwork';
import { TrackList } from '@/components/track/TrackList';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PREVIEW_NOW_PLAYING, PREVIEW_TRACKS } from '@/components/settings/appearance/previewData';

const NOOP = () => {};
const NO_LIKES = new Set<string>();
const NAV = [
  { id: 'home', label: 'Home', Icon: HomeIcon, active: true },
  { id: 'search', label: 'Search', Icon: SearchIcon, active: false },
  { id: 'library', label: 'Library', Icon: LibraryIcon, active: false },
];

export interface ThemePreviewProps {
  /** The draft's derived CSS variables, set on this wrapper only, so the
   *  preview shows the draft even where the page around it does not. */
  vars: Record<string, string>;
  className?: string;
}

/** A small copy of the app (sidebar, a page with rows, a search field, the
 *  player bar) built from the real pieces on stand-in tracks, so it cannot
 *  drift from what the app renders. No piece here names a colour: all of
 *  it comes from the variables on the wrapper. */
export function ThemePreview({ vars, className }: ThemePreviewProps) {
  return (
    <div
      data-testid="theme-preview"
      // A picture of the app, not part of this page: nothing in it can be
      // focused or clicked.
      inert
      style={vars as CSSProperties}
      className={cn(
        '@container flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground',
        className,
      )}
    >
      <div className="flex min-h-0 flex-1">
        {/* A narrow preview gets the sidebar as an icon rail, so the rows
            keep room for their titles. */}
        <aside className="flex w-14 shrink-0 flex-col items-center gap-block border-r border-sidebar-border bg-sidebar p-cluster text-sidebar-foreground @lg:w-40 @lg:items-stretch @lg:p-block">
          <div className="flex h-8 items-center gap-cluster font-bold">
            <FlameIcon className="h-4 w-4 text-ember" />
            <span className="hidden @lg:inline">Ember</span>
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
                <span className="hidden @lg:inline">{label}</span>
              </div>
            ))}
          </nav>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-row overflow-hidden p-block">
          <div className="flex items-center justify-between gap-row">
            <div className="min-w-0">
              <div className="text-lg font-bold tracking-tight">Home</div>
              <div className="truncate text-xs text-muted-foreground">
                Picked for you, <span className="text-ember">see all</span>
              </div>
            </div>
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
            tracks={PREVIEW_TRACKS}
            currentId={PREVIEW_NOW_PLAYING.id}
            isPlaying
            likedIds={NO_LIKES}
            onPlay={NOOP}
            onToggle={NOOP}
          />
        </div>
      </div>
      <footer className="flex shrink-0 items-center gap-row border-t border-sidebar-border bg-sidebar px-block py-row">
        <Artwork src={PREVIEW_NOW_PLAYING.artworkUrl} size="xs" className="shrink-0 rounded-md bg-art" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{PREVIEW_NOW_PLAYING.title}</div>
          <div className="truncate text-xs text-muted-foreground">{PREVIEW_NOW_PLAYING.artist}</div>
        </div>
        <span className="grid size-hit shrink-0 place-items-center rounded-full text-ember">
          <HeartIcon className="h-4 w-4 fill-current" />
        </span>
        <span className="grid size-hit shrink-0 place-items-center rounded-full bg-foreground text-background">
          <PauseIcon className="h-4 w-4 fill-current" />
        </span>
      </footer>
    </div>
  );
}
