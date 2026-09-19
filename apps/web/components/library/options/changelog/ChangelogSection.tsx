'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, MusicIcon } from '@/components/icons';
import { PageTitle } from '@/components/page/PageTitle';
import { SectionHeader } from '@/components/page/SectionHeader';
import { TrackCard } from '@/components/track/TrackCard';
import { cn } from '@/lib/utils';
import { MOCK_CHANGELOG, MOCK_HOME_RECENT, MOCK_HOME_TRACKS } from '@/app/(app)/dizajn/mock';
import {
  CHANGELOG_PLACEMENTS,
  type BadgeStyle,
  type ChangelogPlacement,
  type ChangelogState,
} from '@/components/library/options/changelog';
import { ShellPreview } from '@/components/library/options/changelog/ShellPreview';
import { ChangelogPage } from '@/components/library/options/changelog/ChangelogPage';
import { ChangelogPanel } from '@/components/library/options/changelog/ChangelogPanel';
import {
  HomeWhatsNewBanner,
  SidebarWhatsNewCard,
  SidebarWhatsNewLink,
  TopBarWhatsNewButton,
} from '@/components/library/options/changelog/Placements';

const DESKTOP = { width: 1100, height: 700 };
const PHONE = { width: 390, height: 780 };
const NO_IDS: ReadonlySet<string> = new Set();
const UNREAD_IDS: ReadonlySet<string> = new Set(MOCK_CHANGELOG.filter((e) => e.unread).map((e) => e.id));

const HOME_SHELVES = [
  { title: 'Recommended for you', tracks: MOCK_HOME_TRACKS },
  { title: 'Recently played', tracks: MOCK_HOME_RECENT },
];

/** Home as the live page draws it (PageTitle, then TrackShelf-shaped
 *  sections of real TrackCards), with one row of cards per shelf: six on
 *  desktop (the lg count in lib/layout.ts), two on phone. */
function MockHome({ phone, banner }: { phone: boolean; banner: ReactNode }) {
  const count = phone ? 2 : 6;
  return (
    <div data-testid="mock-home">
      <PageTitle className={cn('mb-8', phone ? 'text-3xl!' : 'text-4xl!')}>Home</PageTitle>
      {banner}
      {HOME_SHELVES.map((s) => (
        <section key={s.title} className="mb-10">
          <SectionHeader
            title={s.title}
            className="mb-3"
            action={
              <span className="text-eyebrow">
                Show all ({s.tracks.length + 6})
              </span>
            }
          />
          <div className={cn('grid gap-4', phone ? 'grid-cols-2' : 'grid-cols-6')}>
            {s.tracks.slice(0, count).map((t) => (
              <TrackCard key={t.id} track={t} onActivate={() => {}} artworkFallback={<MusicIcon className="h-6 w-6" />} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** A fixed-size box (the device's real pixel size) scaled down to the width
 *  its column actually has, never up, keeping proportions. The wrapper
 *  takes the scaled height so nothing below it overlaps. */
export function ScaledFrame({
  width,
  height,
  onScale,
  children,
}: {
  width: number;
  height: number;
  onScale?: (scale: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      // 0 means not laid out (tests, a hidden tab): keep 1:1 rather than
      // collapsing the frame to nothing.
      const w = el.clientWidth;
      setScale(w > 0 ? Math.min(1, w / width) : 1);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  useEffect(() => {
    onScale?.(scale);
  }, [scale, onScale]);

  return (
    <div ref={ref} className="w-full" style={{ height: height * scale }}>
      <div
        className="overflow-hidden rounded-xl border border-border shadow-soft"
        style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {children}
      </div>
    </div>
  );
}

export interface ChangelogSectionProps {
  placement: ChangelogPlacement;
  state: ChangelogState;
  badge: BadgeStyle;
  /** Clicking an entry point inside the preview moves the State picker
   *  (Unread -> Open, and a second click on the popover button closes it
   *  as Read), so the mock behaves like the real thing would. */
  onStateChange: (state: ChangelogState) => void;
}

/** The "What's new" candidates in context: the whole Ember shell twice
 *  (desktop scaled to fit, phone at 390px), a full-screen 1:1 view of the
 *  desktop shell, and the one-line description of the placement. Mark all
 *  as read, the hide-tags switch, the banner's dismiss and the phone menu
 *  all work, locally, so the owner can click through the flow. Nothing
 *  persists except what the page's pickers save. */
export function ChangelogSection({ placement, state, badge, onStateChange }: ChangelogSectionProps) {
  const [hideTags, setHideTags] = useState(false);
  const [markedRead, setMarkedRead] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [desktopScale, setDesktopScale] = useState(1);

  // A new placement or state starts the click-through over (unread again,
  // banner back, menu closed). Adjusting state during render, not in an
  // effect, so the stale combination never paints. hideTags survives on
  // purpose: it is the "always" setting.
  const comboKey = `${placement}:${state}`;
  const [prevComboKey, setPrevComboKey] = useState(comboKey);
  if (comboKey !== prevComboKey) {
    setPrevComboKey(comboKey);
    setMarkedRead(false);
    setBannerDismissed(false);
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const unreadIds = state === 'read' || markedRead ? NO_IDS : UNREAD_IDS;
  const newIds = hideTags ? NO_IDS : unreadIds;
  const showNew = newIds.size > 0;
  const latest = MOCK_CHANGELOG[0];
  const pageOpen = state === 'open' && placement !== 'top-bar';
  const description = CHANGELOG_PLACEMENTS.find((p) => p.id === placement)?.description ?? '';

  const open = () => {
    setDrawerOpen(false);
    if (placement === 'top-bar' && state === 'open') onStateChange('read');
    else if (state !== 'open') onStateChange('open');
  };

  const entryProps = { showNew, badge, onOpen: open };
  const listProps = {
    entries: MOCK_CHANGELOG,
    newIds,
    badge,
    hideTags,
    onHideTagsChange: setHideTags,
    onMarkAllRead: () => setMarkedRead(true),
  };

  const shell = (phone: boolean) => {
    const banner =
      placement === 'home-banner' && showNew && !bannerDismissed ? (
        <HomeWhatsNewBanner {...entryProps} latest={latest} onDismiss={() => setBannerDismissed(true)} />
      ) : null;
    const content = pageOpen ? <ChangelogPage {...listProps} phone={phone} /> : <MockHome phone={phone} banner={banner} />;
    const topBarButton =
      placement === 'top-bar' ? <TopBarWhatsNewButton {...entryProps} phone={phone} open={state === 'open'} /> : undefined;
    const overlay =
      placement === 'top-bar' && state === 'open' ? (
        <div
          className={cn(
            'absolute z-20 flex',
            phone ? 'inset-x-3 top-2 max-h-[calc(100%-1rem)]' : 'right-8 top-[78px] w-[22rem] max-h-[calc(100%-6rem)]',
          )}
        >
          <ChangelogPanel {...listProps} className="w-full" />
        </div>
      ) : undefined;

    return (
      <ShellPreview
        phone={phone}
        activePath={pageOpen ? (placement === 'sidebar-link' ? '/whats-new' : '') : '/'}
        content={content}
        navExtra={
          placement === 'sidebar-link' ? <SidebarWhatsNewLink {...entryProps} active={pageOpen} /> : undefined
        }
        footerExtra={placement === 'sidebar-card' ? <SidebarWhatsNewCard {...entryProps} latest={latest} /> : undefined}
        contentCorner={phone ? undefined : topBarButton}
        topBarRight={phone ? topBarButton : undefined}
        menuDot={(placement === 'sidebar-link' || placement === 'sidebar-card') && showNew}
        overlay={overlay}
        drawerOpen={phone && drawerOpen}
        onDrawerOpenChange={setDrawerOpen}
      />
    );
  };

  const hasDrawerEntry = placement === 'sidebar-link' || placement === 'sidebar-card';

  return (
    <div data-testid="changelog-section" data-placement={placement} data-state={state} data-badge={badge}>
      <div className="flex flex-col gap-stack lg:flex-row lg:items-start">
        <div className="min-w-0 lg:flex-[1100_1_0%]">
          <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
            <div className="text-eyebrow">
              Desktop <span className="normal-case tracking-normal">({Math.round(desktopScale * 100)}%)</span>
            </div>
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium transition-colors hover:bg-card"
            >
              View full screen
            </button>
          </div>
          <ScaledFrame width={DESKTOP.width} height={DESKTOP.height} onScale={setDesktopScale}>
            {shell(false)}
          </ScaledFrame>
        </div>
        <div className="w-full min-w-0 max-w-[390px] lg:flex-[390_1_0%]">
          <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
            <div className="text-eyebrow">Phone (390px)</div>
            {hasDrawerEntry && (
              <button
                type="button"
                onClick={() => setDrawerOpen((o) => !o)}
                aria-pressed={drawerOpen}
                className="rounded-full border border-border px-3 py-1 text-xs font-medium transition-colors hover:bg-card"
              >
                {drawerOpen ? 'Close menu' : 'Open menu'}
              </button>
            )}
          </div>
          <ScaledFrame width={PHONE.width} height={PHONE.height}>
            {shell(true)}
          </ScaledFrame>
        </div>
      </div>

      <p data-testid="changelog-description" className="text-meta mt-4">
        {description}
      </p>

      {fullscreen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Full screen preview"
            data-testid="changelog-fullscreen"
            className="fixed inset-0 z-[70] bg-background"
          >
            {shell(false)}
            <div className="absolute left-1/2 top-3 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover/95 py-1 pl-4 pr-1 text-xs text-muted-foreground shadow-soft backdrop-blur">
              Full-size preview, Esc to close
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                aria-label="Close full screen"
                className="grid h-7 w-7 place-items-center rounded-full text-foreground transition-colors hover:bg-muted"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
