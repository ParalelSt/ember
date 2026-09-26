import type { Metadata } from 'next';
import { TabsPage } from '@/components/tabs/TabsPage';
import { trackIdFromParam } from '@/lib/tabSources';

export const metadata: Metadata = { title: 'Guitar tab · Ember' };

/** The tab page for a track (the Sheet
 *  page). The id is the app's compound track id, `youtube:abc`. */
export default async function TabPage({ params }: { params: Promise<{ trackId: string }> }) {
  const { trackId } = await params;
  return <TabsPage trackId={trackIdFromParam(trackId)} />;
}
