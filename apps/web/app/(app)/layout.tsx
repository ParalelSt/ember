'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/nav/Sidebar';
import { TopBar } from '@/components/nav/TopBar';
import { MobileNav } from '@/components/nav/MobileNav';
import { Drawer } from '@/components/nav/Drawer';
import { BackToTop } from '@/components/nav/BackToTop';
import { PlayerBar } from '@/components/player/PlayerBar';
import { NowPlaying } from '@/components/player/NowPlaying';
import { LyricsPanel } from '@/components/player/LyricsPanel';

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  return (
    <div className="h-dvh flex flex-col md:flex-row overflow-hidden">
      <Sidebar />
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <div className="flex-1 min-h-0 flex flex-col min-w-0">
        <TopBar onMenu={() => setDrawerOpen(true)} />
        {/* Inner row so the LyricsPanel sits beside main on md:+ and the
            layout reflows around it — main shrinks, controls below stay
            spanning. Phones tap Lyrics in PlayerBar to open NowPlaying
            scrolled to its lyrics section instead. */}
        <div className="flex-1 min-h-0 flex min-w-0">
          <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto px-6 md:px-8 py-6 md:py-8 min-w-0">
            <div className="mx-auto max-w-7xl">{children}</div>
          </main>
          <LyricsPanel />
        </div>
        <BackToTop scrollRef={mainRef} />
        <PlayerBar />
        <MobileNav />
      </div>
      <NowPlaying />
    </div>
  );
}
