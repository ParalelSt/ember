import { FlameIcon, HomeIcon, LibraryIcon, MicIcon, SearchIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { SearchGapCandidate } from '@/components/library/options/searchgap';

const NAV_ITEMS = [
  { label: 'Home', Icon: HomeIcon, active: false },
  { label: 'Search', Icon: SearchIcon, active: false },
  { label: 'Library', Icon: LibraryIcon, active: false },
];

/** Bullet rows standing in for the What's new page (the owner's
 *  screenshot): title, one line of description, art-less. Presentational,
 *  mock data only. */
const MOCK_ROWS = [
  { title: 'Custom themes', body: 'Five presets, an editor for the eight colours behind them, a readability guard, and sharing.' },
  { title: 'Trending now', body: 'A charts-backed shelf on Home, refreshed daily.' },
  { title: 'Android Auto', body: 'Ember now shows up as a media app in the car.' },
  { title: 'Offline downloads', body: 'Pin a track or a whole playlist to keep it without a connection.' },
  { title: 'Discord presence', body: 'Share what you are listening to, on by default, one toggle to turn off.' },
  { title: 'Guitar tabs', body: 'Chords and tabs generated for any track that has them.' },
];

function GapPillLogo() {
  return (
    <div className="flex items-center gap-cluster px-block pb-block pt-stack">
      <FlameIcon className="h-5 w-5 text-ember" />
      <span className="text-lg font-bold tracking-tight">Ember</span>
    </div>
  );
}

/** A stand-in sidebar: real token classes and the real nav labels, but
 *  plain markup (no NavLinks/CollectionNavList) since the subject of this
 *  gallery is the search pill's bottom edge, not sidebar fidelity. */
function GapSidebar() {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <GapPillLogo />
      <nav className="flex flex-col gap-inset px-row">
        {NAV_ITEMS.map(({ label, Icon, active }) => (
          <div
            key={label}
            className={cn(
              'flex items-center gap-row rounded-lg px-row py-cluster text-sm font-medium',
              active ? 'bg-muted text-foreground' : 'text-sidebar-foreground/70',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </div>
        ))}
      </nav>
      <div className="mt-auto flex items-center gap-row border-t border-sidebar-border px-block py-stack">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ember text-xs font-bold text-white">A</div>
        <div className="truncate text-xs text-sidebar-foreground/70">Aron</div>
      </div>
    </aside>
  );
}

/** The real search pill's own markup (SearchOverlay.tsx's Input classes),
 *  static: no Input/Dialog primitives needed for a picture of it. */
function GapSearchPill() {
  return (
    <div className="relative flex h-12 shrink-0 items-center rounded-full border-0 bg-card pl-11 pr-12 text-sm text-muted-foreground">
      <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      What do you want to listen to?
      <MicIcon className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

const GAP_CLASS: Record<SearchGapCandidate['gapPx'], string> = {
  0: 'pb-0',
  8: 'pb-cluster',
  16: 'pb-block',
};

export interface SearchGapFrameProps {
  candidate: SearchGapCandidate;
}

/** The whole shell (sidebar + content column) at whatever size its parent
 *  gives it, desktop only (the phone has no in-flow search bar, so this
 *  fix does not apply there). The content column mirrors
 *  app/(app)/layout.tsx: a shrink-0 search wrapper directly above the
 *  scroll area, `data-app-scroller` included. Rather than actually
 *  scrolling a real DOM node, the list starts with no leading padding of
 *  its own, the same way it looks once a real page has been scrolled past
 *  its own top padding: whatever gap the owner sees here is only the one
 *  the search wrapper itself adds. */
export function SearchGapFrame({ candidate }: SearchGapFrameProps) {
  const { id, gapPx, tintGap, hasFade } = candidate;
  return (
    <div
      data-testid="searchgap-frame"
      data-candidate={id}
      data-gap-px={gapPx}
      data-fade={hasFade}
      className="flex h-full w-full overflow-hidden bg-background text-foreground"
    >
      <GapSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          data-testid="searchgap-pill-wrap"
          className={cn('shrink-0 px-page-lg pt-page-lg', GAP_CLASS[gapPx], tintGap && 'bg-card')}
        >
          <div data-testid="searchgap-pill">
            <GapSearchPill />
          </div>
        </div>
        <div data-app-scroller className="relative min-h-0 flex-1 overflow-hidden">
          {hasFade && (
            <div
              data-testid="searchgap-fade"
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-block bg-linear-to-b from-background to-transparent"
            />
          )}
          <div className="px-page-lg">
            {MOCK_ROWS.map((row, i) => (
              <div
                key={row.title}
                data-testid={i === 0 ? 'searchgap-first-row' : undefined}
                className="flex gap-row border-b border-border py-block first:pt-0"
              >
                <span className="mt-inset h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{row.title}</div>
                  <div className="text-sm text-muted-foreground">{row.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
