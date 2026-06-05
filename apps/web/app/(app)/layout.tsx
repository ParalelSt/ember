'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/nav/Sidebar';
import { TopBar } from '@/components/nav/TopBar';
import { MobileNav } from '@/components/nav/MobileNav';
import { Drawer } from '@/components/nav/Drawer';
import { BackToTop } from '@/components/nav/BackToTop';
import { PlayerBar } from '@/components/player/PlayerBar';
import { NowPlaying } from '@/components/player/NowPlaying';

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  return (
    <div className="h-dvh flex flex-col md:flex-row overflow-hidden">
      <Sidebar />
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <div className="flex-1 min-h-0 flex flex-col min-w-0">
        <TopBar onMenu={() => setDrawerOpen(true)} />
        <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto px-6 md:px-8 py-6 md:py-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
        <BackToTop scrollRef={mainRef} />
        <PlayerBar />
        <MobileNav />
      </div>
      <NowPlaying />
    </div>
  );
}
