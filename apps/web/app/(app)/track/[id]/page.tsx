import type { Metadata } from 'next';
import { fetchTrackMeta } from '@/lib/trackMeta';
import { TrackPageClient } from '@/components/track/TrackPageClient';

/** Discord / Messenger / iMessage embed cards for shared song links. Runs
 *  server-side for crawlers too (the /track path is public in proxy.ts —
 *  crawlers never log in). Failures fall back to the app's default metadata. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const track = await fetchTrackMeta(id);
    if (!track) return { title: 'Ember — Music' };
    const title = `${track.title} — ${track.artist}`;
    const description = track.album ? `${track.album} · Listen on Ember` : 'Listen on Ember';
    return {
      title: `${title} · Ember`,
      description,
      openGraph: {
        title,
        description,
        type: 'music.song',
        siteName: 'Ember',
        images: track.artworkUrl ? [{ url: track.artworkUrl, width: 544, height: 544 }] : [],
      },
      twitter: {
        card: track.artworkUrl ? 'summary_large_image' : 'summary',
        title,
        description,
        images: track.artworkUrl ? [track.artworkUrl] : [],
      },
    };
  } catch {
    return { title: 'Ember — Music' };
  }
}

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TrackPageClient videoId={id} />;
}
