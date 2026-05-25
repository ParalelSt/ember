'use client';

import { useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/nav/Sidebar';
import { TopBar } from '@/components/nav/TopBar';
import { MobileNav } from '@/components/nav/MobileNav';
import { Drawer } from '@/components/nav/Drawer';
import { PlayerBar } from '@/components/player/PlayerBar';

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="h-screen flex flex-col md:flex-row overflow-hidden">
      <Sidebar />
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenu={() => setDrawerOpen(true)} />
        <main className="flex-1 overflow-y-auto px-6 md:px-8 py-6 md:py-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
        <PlayerBar />
        <MobileNav />
      </div>
    </div>
  );
}
