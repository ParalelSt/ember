'use client';

import dynamic from 'next/dynamic';

/* The Classic look's client views that a SERVER route file renders, each
 * behind next/dynamic. A server file under app/(app)/ that picks the legacy
 * page imports it only on a Classic device, but the bundler still adds every
 * client component that page reaches to the route's own chunk, which the
 * new look downloads too. Through these loaders the route's chunk holds only
 * the loader, and the view itself loads only when it renders. Added with the
 * switch (docs/classic-look.md); the views themselves are unchanged. */

export const AdminTabs = dynamic(() => import('@legacy/components/admin/AdminTabs').then((m) => m.AdminTabs));
export const ApproveLinkView = dynamic(() =>
  import('@legacy/components/auth/ApproveLinkView').then((m) => m.ApproveLinkView),
);
export const DevicesPanel = dynamic(() => import('@legacy/components/settings/DevicesPanel').then((m) => m.DevicesPanel));
export const HeadUnitSettings = dynamic(() =>
  import('@legacy/components/settings/HeadUnitSettings').then((m) => m.HeadUnitSettings),
);
export const TabsPage = dynamic(() => import('@legacy/components/tabs/TabsPage').then((m) => m.TabsPage));
export const TrackPageClient = dynamic(() =>
  import('@legacy/components/track/TrackPageClient').then((m) => m.TrackPageClient),
);
export const TransferFlow = dynamic(() => import('@legacy/components/import/TransferFlow').then((m) => m.TransferFlow));
export const TransferReview = dynamic(() =>
  import('@legacy/components/import/TransferReview').then((m) => m.TransferReview),
);
/** Classic pages that are client components themselves, picked by a server
 *  route file of the new look. */
export const AdminBackupsPage = dynamic(() => import('@legacy/app/admin/backups/page'));
export const SettingsLibraryPage = dynamic(() => import('@legacy/app/settings/library/page'));
