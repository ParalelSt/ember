'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { UploadIcon } from '@/components/icons';
import { SectionHeader } from '@/components/page/SectionHeader';
import { cn } from '@/lib/utils';

/** The Transfer page, returning here when it is done or left. */
const SETTINGS_TRANSFER_HREF = `/transfer?from=${encodeURIComponent('/settings/library')}`;

/** Settings > Library. One row today: bringing songs liked somewhere else
 *  into Ember. It opens the same Transfer page as the button on Liked songs. */
export default function SettingsLibrary() {
  return (
    <section className="max-w-2xl">
      <SectionHeader title="Library" />
      <div className="mt-stack flex items-start justify-between gap-block rounded-2xl bg-card p-stack shadow-soft">
        <div className="min-w-0">
          <div className="font-semibold">Transfer from another app</div>
          <p className="mt-inset text-sm text-muted-foreground">
            Bring the songs you liked on Spotify, Apple Music or anywhere else into Ember. Upload
            your data export or a CSV, paste a list of songs, or paste a public playlist link. They
            become your likes, or a new playlist, and Ember matches them on YouTube Music in the
            background.
          </p>
        </div>
        <Link
          href={SETTINGS_TRANSFER_HREF}
          className={cn(buttonVariants({ variant: 'ember' }), 'shrink-0')}
          data-testid="settings-transfer-button"
        >
          <UploadIcon className="h-4 w-4" />
          Transfer
        </Link>
      </div>
    </section>
  );
}
