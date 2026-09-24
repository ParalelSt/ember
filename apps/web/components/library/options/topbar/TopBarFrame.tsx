import { FlameIcon, HeartIcon, HomeIcon, LibraryIcon, MicIcon, SearchIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { cn } from '@/lib/utils';
import type { TopBarCandidate } from '@/components/library/options/topbar';

const NAV_ITEMS = [
  { label: 'Home', Icon: HomeIcon, active: true },
  { label: 'Search', Icon: SearchIcon, active: false },
  { label: 'Library', Icon: LibraryIcon, active: false },
];

const QUICK_PICKS = ['Liked songs', 'Late night drive', 'Radiohead mix', 'Focus', 'Discover weekly', 'On repeat'];
const CARDS = ['Blue Monday', 'Nights', 'Everything In Its Right Place', 'Motion Sickness', 'Pink + White', 'Teardrop'];
const ROWS = [
  'Paranoid Android',
  'Ivy',
  'Kyoto',
  'Self Control',
  'Harvest Moon',
  'Chamber of Reflection',
  'Weird Fishes',
  'Seigfried',
  'Night Owl',
  'Retrograde',
];

/** Stand-in sidebar: real token classes, plain markup. The subject here is
 *  the content column's top edge, not sidebar fidelity. */
function MockSidebar() {
  return (
    <aside className="flex h-full w-(--sidebar-w) shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-cluster px-block pb-block pt-stack">
        <FlameIcon className="h-5 w-5 text-ember" />
        <span className="text-lg font-bold tracking-tight">Ember</span>
      </div>
      <nav className="flex flex-col gap-inset px-cluster">
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
    </aside>
  );
}

/** A red measuring bar hanging under the pill: the gap the owner judges.
 *  Lives inside the pill's own box so it lines up with the pill at every
 *  width. */
function Measure({ px, kind }: { px: number; kind: 'heading-gap' | 'band' }) {
  return (
    <div
      data-testid="topbar-measure"
      data-kind={kind}
      data-px={px}
      aria-hidden
      className="pointer-events-none absolute -left-3 top-full z-30 w-0.5 bg-ember"
      style={{ height: Math.max(px, 2) }}
    >
      <span className="absolute right-full top-1/2 -translate-y-1/2 whitespace-nowrap pr-inset text-xs font-bold text-ember">
        {px}
      </span>
    </div>
  );
}

/** The real search pill's markup (SearchOverlay's Input classes inside
 *  SearchDropdown's `mx-auto max-w-(--content-max)` > `max-w-xl`), static. */
function PillRow({ measure, spacer }: { measure?: { px: number; kind: 'heading-gap' | 'band' }; spacer?: boolean }) {
  return (
    <div className="mx-auto max-w-(--content-max)">
      <div data-testid={spacer ? undefined : 'topbar-pill'} className="relative max-w-xl">
        <div className="relative flex h-12 items-center rounded-full bg-card pl-11 pr-12 text-sm text-muted-foreground">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
          What do you want to listen to?
          <MicIcon className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2" />
        </div>
        {measure && <Measure {...measure} />}
      </div>
    </div>
  );
}

interface BarProps {
  candidate: TopBarCandidate;
  scrolled: boolean;
  /** The in-flow copy that only reserves the bar's height (it is what a
   *  sticky bar does inside the scroller): no covers, no measure. */
  spacer?: boolean;
  measure?: { px: number; kind: 'heading-gap' | 'band' };
}

/** The bar itself, per candidate. Every cover is decoration hanging off the
 *  bar's box (absolute), so none of them takes layout space: the page
 *  heading sits exactly where it does today. */
function Bar({ candidate, scrolled, spacer, measure }: BarProps) {
  const row = <PillRow measure={spacer ? undefined : measure} spacer={spacer} />;
  switch (candidate.id) {
    case 'float':
      return (
        <div data-testid={spacer ? undefined : 'topbar-bar'} className="relative px-page-lg pt-page-lg">
          {!spacer && (
            <>
              {/* Page background behind the pill row and a 16px band under
                  it, then a 24px fade: content is gone before it reaches
                  the pill. Only once scrolled: at the top there is nothing
                  under it to hide, and the fade would dim the heading. */}
              {scrolled && (
                <div aria-hidden className="pointer-events-none absolute inset-0">
                  <div className="h-full bg-background" />
                  <div data-testid="topbar-band" className="h-block bg-background" />
                  <div className="h-stack bg-linear-to-b from-background to-transparent" />
                </div>
              )}
            </>
          )}
          <div className="relative">{row}</div>
        </div>
      );
    case 'frosted':
      return (
        <div
          data-testid={spacer ? undefined : 'topbar-bar'}
          className={cn(
            'relative border-b px-page-lg pb-block pt-page-lg',
            !spacer && 'bg-background/80 backdrop-blur-xl',
            scrolled ? 'border-border' : 'border-transparent',
          )}
        >
          {!spacer && <div data-testid="topbar-band" aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-block" />}
          {row}
        </div>
      );
    case 'solid':
      return (
        <div
          data-testid={spacer ? undefined : 'topbar-bar'}
          className="relative border-b border-sidebar-border bg-sidebar px-page-lg py-block"
        >
          {!spacer && <div data-testid="topbar-band" aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-block" />}
          {row}
        </div>
      );
    case 'now':
      return (
        <div data-testid="topbar-bar" className="relative z-20 shrink-0 px-page-lg pt-page-lg">
          {row}
        </div>
      );
  }
}

/** A drawn scrollbar (track + thumb) on the scroller's right edge, with a
 *  label pointing at where it starts: that is what the owner is judging, and
 *  a native scrollbar would not show up in a scaled picture. */
function MockScrollbar({ topPx, scrolled }: { topPx: number; scrolled: boolean }) {
  return (
    <>
      <div
        data-testid="topbar-scrollbar"
        data-top-px={topPx}
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 top-0 z-30 w-3 bg-muted/60"
      >
        <div
          className="absolute inset-x-0.5 rounded-full bg-muted-foreground/60"
          style={{ top: scrolled ? '18%' : '1%', height: '42%' }}
        />
      </div>
      <div aria-hidden className="pointer-events-none absolute right-0 top-0 z-30 w-40 border-t-2 border-dashed border-ember" />
      <div
        aria-hidden
        className="pointer-events-none absolute right-5 top-1 z-30 rounded-md bg-ember px-cluster py-inset text-xs font-semibold text-ember-foreground shadow-soft"
      >
        Scrollbar starts here, {topPx}px down &rarr;
      </div>
    </>
  );
}

/** The page under the bar: a Home-like heading, quick picks, a card shelf
 *  and rows, enough to pass under the bar at 300px. */
function MockPage({ padTop }: { padTop: string }) {
  return (
    <div className={cn('px-page-lg pb-section', padTop)}>
      <div className="mx-auto max-w-(--content-max)">
        <div data-testid="topbar-heading">
          <PageTitle className="mb-stack">Good evening</PageTitle>
        </div>
        <div className="mb-section grid grid-cols-3 gap-row">
          {QUICK_PICKS.map((t, i) => (
            <div key={t} className="flex h-16 items-center gap-row overflow-hidden rounded-md bg-card">
              <div className={cn('h-16 w-16 shrink-0', i % 2 ? 'bg-art' : 'bg-muted')} />
              <span className="truncate text-sm font-semibold">{t}</span>
            </div>
          ))}
        </div>
        <h2 className="text-section-title mb-block">Recently played</h2>
        <div className="mb-section grid grid-cols-6 gap-block">
          {CARDS.map((t, i) => (
            <div key={t} className="min-w-0">
              <div className={cn('mb-cluster aspect-square rounded-md', i % 3 === 1 ? 'bg-muted' : 'bg-art')} />
              <div className="truncate text-sm font-semibold">{t}</div>
              <div className="text-meta truncate">Playlist</div>
            </div>
          ))}
        </div>
        <h2 className="text-section-title mb-block">Liked songs</h2>
        <div className="flex flex-col">
          {ROWS.map((t, i) => (
            <div key={t} className="flex items-center gap-row border-b border-border py-cluster">
              <span className="w-6 text-right text-sm text-muted-foreground">{i + 1}</span>
              <div className="h-10 w-10 shrink-0 rounded-sm bg-art" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{t}</div>
                <div className="text-meta truncate">Various artists</div>
              </div>
              <HeartIcon className="h-4 w-4 text-ember" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface TopBarFrameProps {
  candidate: TopBarCandidate;
  /** Simulated scroll position of the page, px. */
  scrollY: number;
}

/** The whole desktop shell (sidebar + content column) at whatever size its
 *  parent gives it. Scrolling is simulated (the page is translated up by
 *  `scrollY`) so every picture is deterministic. Candidates a to c model the
 *  bar as `sticky top-0` INSIDE the scroller: an invisible in-flow copy
 *  reserves its height, the visible copy sits on top, and the scroller (with
 *  its scrollbar) is the whole column. "As it is" mirrors layout.tsx today:
 *  bar in flow above the scroller, 24px sticky fade at the scroller's top. */
export function TopBarFrame({ candidate, scrollY }: TopBarFrameProps) {
  const scrolled = scrollY > 0;
  const measure = scrolled
    ? { px: candidate.bandPx, kind: 'band' as const }
    : { px: candidate.headingGapPx, kind: 'heading-gap' as const };
  const pageShift = { transform: `translateY(-${scrollY}px)` };

  return (
    <div
      data-testid="topbar-frame"
      data-candidate={candidate.id}
      data-scroll={scrollY}
      className="flex h-full w-full overflow-hidden bg-background text-foreground"
    >
      <MockSidebar />
      {candidate.fullHeightScroller ? (
        <div data-testid="topbar-scroller" className="relative min-w-0 flex-1 overflow-hidden">
          <div className="absolute inset-x-0 top-0" style={pageShift}>
            <div className="invisible" aria-hidden>
              <Bar candidate={candidate} scrolled={scrolled} spacer />
            </div>
            <MockPage padTop={candidate.id === 'float' ? 'pt-page-lg' : 'pt-block'} />
          </div>
          <div className="absolute left-0 right-3 top-0 z-20">
            <Bar candidate={candidate} scrolled={scrolled} measure={measure} />
          </div>
          <MockScrollbar topPx={candidate.scrollbarTopPx} scrolled={scrolled} />
        </div>
      ) : (
        <div className="relative flex min-w-0 flex-1 flex-col">
          <Bar candidate={candidate} scrolled={scrolled} measure={measure} />
          <div data-testid="topbar-scroller" className="relative min-h-0 flex-1 overflow-hidden">
            <div className="absolute inset-x-0 top-0" style={pageShift}>
              <MockPage padTop="pt-page-lg" />
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 right-3 top-0 z-10 h-stack bg-linear-to-b from-background to-transparent"
            />
            <MockScrollbar topPx={candidate.scrollbarTopPx} scrolled={scrolled} />
          </div>
        </div>
      )}
    </div>
  );
}
