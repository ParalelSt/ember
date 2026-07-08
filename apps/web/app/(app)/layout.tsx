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
import { hydrateOfflineStore } from '@/lib/offline';

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollerH, setScrollerH] = useState(0);

  // Hydrate the offline store from OPFS on app boot — fills downloaded set
  // + totalBytes, and posts every pinned track's videoId to the SW so it
  // knows which streams to serve from OPFS when offline.
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
        <TopBar onMenu={() => setDrawerOpen(true)} />
        {/* The OUTER scroller owns the scrollbar — so it lives on the far
            right edge of the viewport, past the LyricsPanel. Inside, a
            flex row holds <main> (grows tall, drives the scroll) and the
            LyricsPanel (sticky to the top of the scroller's viewport). */}
        <div
          ref={scrollerRef}
          className="flex-1 min-h-0 overflow-y-auto"
          style={
            scrollerH
              ? ({ ['--ember-scroller-h' as string]: `${scrollerH}px` } as React.CSSProperties)
              : undefined
          }
        >
          <div className="flex min-w-0 min-h-full">
            <main className="flex-1 min-w-0 px-6 md:px-8 py-6 md:py-8">
              <div className="mx-auto max-w-7xl">{children}</div>
            </main>
            <LyricsPanel />
          </div>
        </div>
        <BackToTop scrollRef={scrollerRef} />
        <PlayerBar />
        <MobileNav />
      </div>
      <NowPlaying />
    </div>
  );
}
