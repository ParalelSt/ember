import { TrackPageClient } from '@legacy/app/lazy';

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TrackPageClient videoId={id} />;
}
