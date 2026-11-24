import { TabsPage } from '@legacy/app/lazy';
import { trackIdFromParam } from '@/lib/tabSources';

/** The tab page for a track (the Sheet
 *  page). The id is the app's compound track id, `youtube:abc`. */
export default async function TabPage({ params }: { params: Promise<{ trackId: string }> }) {
  const { trackId } = await params;
  return <TabsPage trackId={trackIdFromParam(trackId)} />;
}
