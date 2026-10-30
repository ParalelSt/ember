'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CarIcon } from '@/components/icons';
import { CarlistSheet } from '@/components/session/CarlistSheet';
import { StartSessionDialog, JoinSessionDialog } from '@/components/session/SessionDialogs';
import { useQueryLiveCarlist } from '@/hooks/useSession';
import { cn } from '@/lib/utils';

const PILL =
  'inline-flex h-11 shrink-0 items-center gap-inset rounded-full px-row text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

/** Your library's one Carlist button, a soft pill with no outline. Nothing
 *  live: a neutral fill with the car and the word, which opens a bottom sheet,
 *  Start a carlist or Join a carlist. A carlist live for you (hosting or
 *  joined): an ember fill reading "Live · CODE" that opens that carlist. */
export function CarlistButton() {
  const { data: live } = useQueryLiveCarlist();
  const [menuOpen, setMenuOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  if (live) {
    return (
      <Link
        href={`/session/${live.id}`}
        data-testid="carlist-live"
        aria-label={`Open the live carlist ${live.name}, code ${live.code}`}
        className={cn(PILL, 'bg-ember/15 text-ember hover:bg-ember/25')}
      >
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-ember" />
        Live · <span className="font-mono tracking-wider">{live.code}</span>
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        data-testid="carlist-entry"
        onClick={() => setMenuOpen(true)}
        className={cn(PILL, 'bg-secondary text-foreground hover:bg-accent active:bg-ember/20 active:text-ember')}
      >
        <CarIcon className="size-5" />
        Carlist
      </button>
      <CarlistSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onStart={() => setStartOpen(true)}
        onJoin={() => setJoinOpen(true)}
      />
      <StartSessionDialog open={startOpen} onOpenChange={setStartOpen} />
      <JoinSessionDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </>
  );
}
