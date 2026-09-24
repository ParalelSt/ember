'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/nav/Sidebar';
import { TopBar } from '@/components/nav/TopBar';
import { MobileNav } from '@/components/nav/MobileNav';
import { Drawer } from '@/components/nav/Drawer';
import { BackToTop } from '@/components/nav/BackToTop';
import { PlayerBar } from '@/components/player/PlayerBar';
import { NowPlaying } from '@/components/player/NowPlaying';
import { LyricsPanel } from '@/components/player/LyricsPanel';
import { SearchOverlayContainer } from '@/components/search/SearchOverlayContainer';
import { SessionHostBridge } from '@/components/session/SessionHostBridge';
import { hydrateOfflineStore } from '@/lib/offline';
import { useUiStore } from '@/stores/useUiStore';
import { useChangelog } from '@/hooks/useChangelog';

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollerH, setScrollerH] = useState(0);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const { hasNew } = useChangelog();

  // Hydrate the offline store on app boot. On Android this subscribes to the
  // native EmberOffline plugin's pins/trackFiles; elsewhere it reads OPFS
  // (fills downloaded set + totalBytes, and posts every pinned track's
  // videoId to the SW so it knows which streams to serve from OPFS offline).
  useEffect(() => {
    void hydrateOfflineStore();
  }, []);

  // LyricsPanel reads --ember-scroller-h to size itself to one viewport-of-
  // scroller, so its position:sticky inside the scroller keeps it glued to
  // the top while the page below it scrolls.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setScrollerH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    // h-svh (NOT dvh): dvh tracks the mobile address bar, so hard scrolling in
    // Firefox Android collapsed the bar and reflowed the whole shell ("layout
    // moves up"). svh is the stable small-viewport size — the shell never
    // moves; hiding the bar just shows a brief same-color strip below it.
    <div className="h-svh flex flex-col md:flex-row overflow-hidden">
      <Sidebar />
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <div className="flex-1 min-h-0 flex flex-col min-w-0">
        <TopBar onMenu={() => setDrawerOpen(true)} menuDot={hasNew} />
        {/* The content column. --ember-scroller-h is published HERE rather
            than on the scroller itself so both children can read it: the
            LyricsPanel inside sizes itself to it, and the search dropdown
            above caps its panel with it so the results never reach past the
            player bar. */}
        <div
          className="relative flex-1 min-h-0 flex flex-col"
          style={
            scrollerH
              ? ({ ['--ember-scroller-h' as string]: `${scrollerH}px` } as React.CSSProperties)
              : undefined
          }
        >
          {/* Desktop: the search box, a real one, in the page above
              everything the page itself draws, with its results hanging
              under it. Phone: nothing in flow, just the full-screen sheet
              when it is open. */}
          <SearchOverlayContainer />
          {/* The OUTER scroller owns the scrollbar — so it lives on the far
              right edge of the viewport, past the LyricsPanel. Inside, a
              flex row holds <main> (grows tall, drives the scroll) and the
              LyricsPanel (sticky to the top of the scroller's viewport). */}
          <div ref={scrollerRef} data-app-scroller className="flex-1 min-h-0 overflow-y-auto">
            {/* Desktop only: the search pill above now has a plain gap
                under it (SearchDropdown.tsx's wrapper, pb-block), and this
                fade softens the seam where a scrolled page's content
                arrives at the top of the scroller. `sticky top-0` glues it
                to the scroller's own visible top edge as it scrolls, the
                same technique LyricsPanel uses below; the wrapper is
                `h-0 overflow-visible` so it takes no layout space of its
                own (nothing gets pushed down) and the actual h-block
                gradient inside overflows downward from that zero-height
                line, over the top slice of whatever is scrolled under it.
                First page paint (scrollTop 0) still has the page's own top
                padding under it, so the fade sits over blank padding, not
                over content. bg-background (never a hardcoded colour) so
                it holds under every theme; pointer-events-none so it never
                blocks a click. */}
            <div className="sticky top-0 z-10 hidden h-0 overflow-visible md:block">
              <div
                data-testid="app-scroller-fade"
                aria-hidden
                className="pointer-events-none h-block bg-linear-to-b from-background to-transparent"
              />
            </div>
            <div className="flex min-w-0 min-h-full">
              <main className="flex-1 min-w-0 p-page md:p-page-lg">
                {/* pb-section: room past the page's last row, so scrolled
                    to the end nothing is left under Back to top. */}
                <div className="mx-auto max-w-(--content-max) pb-section">{children}</div>
              </main>
              <LyricsPanel />
            </div>
          </div>
          {/* Inside this `relative` column, so it floats a fixed step above
              the scroller's own bottom edge whether or not the player bar
              is showing. */}
          <BackToTop scrollRef={scrollerRef} />
        </div>
        <PlayerBar />
        <MobileNav onSearchClick={() => setSearchOpen(true)} />
      </div>
      <NowPlaying />
      <SessionHostBridge />
    </div>
  );
}
