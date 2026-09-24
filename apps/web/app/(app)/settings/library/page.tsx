'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { UploadIcon } from '@/components/icons';
import { SectionHeader } from '@/components/page/SectionHeader';
import { TransferDialog } from '@/components/import/TransferDialog';

/** Settings > Library. One row today: bringing songs liked somewhere else
 *  into Ember. It lives here rather than on the Liked songs page because it
 *  is a once-in-a-while setup job, not something to meet every time you
 *  open your likes. */
export default function SettingsLibrary() {
  const [transferOpen, setTransferOpen] = useState(false);
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
        <Button
          onClick={() => setTransferOpen(true)}
          variant="ember"
          className="shrink-0"
          data-testid="settings-transfer-button"
        >
          <UploadIcon className="h-4 w-4" />
          Transfer
        </Button>
      </div>
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} from="settings" />
    </section>
  );
}
