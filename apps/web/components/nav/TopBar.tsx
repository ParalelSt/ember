'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MenuIcon, FlameIcon } from '@/components/icons';

export function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="md:hidden flex items-center justify-between gap-2 px-3 py-3 bg-sidebar border-b border-sidebar-border" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
      <Button variant="ghost" size="icon" onClick={onMenu} aria-label="Open menu">
        <MenuIcon className="h-5 w-5" />
      </Button>
      <Link href="/" className="flex items-center gap-2 font-bold hover:opacity-80 transition-opacity" aria-label="Home">
        <FlameIcon className="h-4 w-4 text-ember" />
        Ember
      </Link>
      <div className="w-9" />
    </header>
  );
}
