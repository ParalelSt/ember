'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CarIcon, KeyIcon } from '@/components/icons';
import { StartSessionDialog, JoinSessionDialog } from '@/components/session/SessionDialogs';
import { useQueryLiveCarlist } from '@/hooks/useSession';
import { cn } from '@/lib/utils';

const PILL =
  'inline-flex h-9 shrink-0 items-center gap-inset rounded-full border px-row text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

/** Your library's one Carlist button. Nothing live: a menu, Start a carlist
 *  or Join a carlist. A carlist live for you (hosting or joined): it reads
 *  "Live · CODE" and opens that carlist. */
export function CarlistButton() {
  const { data: live } = useQueryLiveCarlist();
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
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="carlist-entry"
          className={cn(PILL, 'border-border text-muted-foreground hover:bg-card hover:text-foreground')}
        >
          <CarIcon className="size-4" /> Carlist
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onClick={() => setStartOpen(true)}>
            <CarIcon /> Start a carlist
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setJoinOpen(true)}>
            <KeyIcon /> Join a carlist
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <StartSessionDialog open={startOpen} onOpenChange={setStartOpen} />
      <JoinSessionDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </>
  );
}
