'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Sidebar } from '@/components/nav/Sidebar';
import { TopBar } from '@/components/nav/TopBar';
import { MobileNav } from '@/components/nav/MobileNav';
import { Drawer } from '@/components/nav/Drawer';
import { BackToTop } from '@/components/nav/BackToTop';
import { DesktopTopBar } from '@/components/nav/DesktopTopBar';
import { PlayerBar } from '@/components/player/PlayerBar';
import { NowPlaying } from '@/components/player/NowPlaying';
import { LyricsPanel } from '@/components/player/LyricsPanel';
import { SearchOverlayContainer } from '@/components/search/SearchOverlayContainer';
import { hydrateOfflineStore } from '@/lib/offline';
import { useUiStore } from '@/stores/useUiStore';
import { useChangelog } from '@/hooks/useChangelog';
import { useIsDesktop } from '@/hooks/useIsDesktop';

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollerH, setScrollerH] = useState(0);
  const [barH, setBarH] = useState(0);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const { hasNew } = useChangelog();
  // Desktop: the search bar lives INSIDE the scroller (DesktopTopBar).
  // Phone: the search sheet stays outside it, as before.
  const isDesktop = useIsDesktop();

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
            than on the scroller itself so everything in the column can read
            it: the LyricsPanel sizes itself to it, and the search dropdown
            caps its panel with it so the results never reach past the
            player bar. --ember-topbar-h is the desktop top bar's height
            (0 on a phone and on /search): the things that stick to the
            scroller's top (lyrics, the tabs toolbar, the Appearance
            preview) stick just under the bar instead. */}
        <div
          className="flex-1 min-h-0 flex flex-col"
          style={
            {
              ...(scrollerH ? { ['--ember-scroller-h' as string]: `${scrollerH}px` } : null),
              ['--ember-topbar-h' as string]: `${isDesktop ? barH : 0}px`,
            } as CSSProperties
          }
        >
          {/* Phone: nothing in flow, just the full-screen sheet when it is
              open (the TopBar above has the search button). */}
          {!isDesktop && <SearchOverlayContainer />}
          {/* The OUTER scroller owns the scrollbar, from the very top of
              the column to its bottom, on the far right edge of the
              viewport past the LyricsPanel. Inside: the desktop top bar
              (sticky, the page scrolls under it), then a flex row holding
              <main> (grows tall, drives the scroll) and the LyricsPanel
              (sticky just under the bar). */}
          <div ref={scrollerRef} data-app-scroller className="flex-1 min-h-0 overflow-y-auto">
            {isDesktop && (
              <DesktopTopBar raised={searchOpen} onHeightChange={setBarH}>
                <SearchOverlayContainer />
              </DesktopTopBar>
            )}
            {/* Fills what is left under the bar, so a short page does not
                scroll by the bar's height. */}
            <div className="flex min-w-0 min-h-[calc(100%-var(--ember-topbar-h,0px))]">
              <main className="flex-1 min-w-0 p-page md:p-page-lg">
                <div className="mx-auto max-w-(--content-max)">{children}</div>
              </main>
              <LyricsPanel />
            </div>
          </div>
        </div>
        <BackToTop scrollRef={scrollerRef} />
        <PlayerBar />
        <MobileNav onSearchClick={() => setSearchOpen(true)} />
      </div>
      <NowPlaying />
    </div>
  );
}
