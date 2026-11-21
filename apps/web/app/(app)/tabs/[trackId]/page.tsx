import type { Metadata } from 'next';
import { TabsPage } from '@/components/tabs/TabsPage';
import { trackIdFromParam } from '@/lib/tabSources';
import { serverUiMode } from '@/components/providers/serverUiMode';

export const metadata: Metadata = { title: 'Guitar tab · Ember' };

/** The tab page for a track (the Sheet
 *  page). The id is the app's compound track id, `youtube:abc`. */
async function NewTabPage({ params }: { params: Promise<{ trackId: string }> }) {
  const { trackId } = await params;
  return <TabsPage trackId={trackIdFromParam(trackId)} />;
}

/** The new look's page, or on a device on the Classic look the frozen one
 *  (docs/classic-look.md), imported only then. */
export default async function TabPage(props: Parameters<typeof NewTabPage>[0]) {
  if ((await serverUiMode()) === 'legacy') {
    const { default: Legacy } = await import('@legacy/app/tabs/[trackId]/page');
    return <Legacy {...props} />;
  }
  return await NewTabPage(props);
}
