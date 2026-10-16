import { CollectionSkeleton } from '@/components/page/CollectionSkeleton';

/** Shown while /chart/[slug]'s own chunk loads. */
export default function ChartLoading() {
  return <CollectionSkeleton variant="collection" />;
}
