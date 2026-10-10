'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CarIcon } from '@/components/icons';
import { HeaderIconButton } from '@/components/page/HeaderIconButton';
import { CarlistSheet } from '@/components/session/CarlistSheet';
import { StartSessionDialog, JoinSessionDialog } from '@/components/session/SessionDialogs';
import { useQueryLiveCarlist } from '@/hooks/useSession';
import { cn } from '@/lib/utils';

const PILL =
  'inline-flex h-11 shrink-0 items-center gap-inset rounded-full border px-row text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

/** Your library's one Carlist button. Nothing live: an icon button that opens a
 *  bottom sheet, Start a carlist or Join a carlist. A carlist live for you (hosting or joined): it reads
 *  "Live · CODE" and opens that carlist. */
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
        className={cn(PILL, 'border-ember bg-ember/15 text-ember hover:bg-ember/25')}
      >
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-ember" />
        Live · <span className="font-mono tracking-wider">{live.code}</span>
      </Link>
    );
  }

  return (
    <>
      <HeaderIconButton data-testid="carlist-entry" aria-label="Carlist" onClick={() => setMenuOpen(true)}>
        <CarIcon className="size-5" />
      </HeaderIconButton>
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
