import { CollectionSkeleton } from '@/components/page/CollectionSkeleton';

/** Shown while /mix/[key]'s own chunk loads. */
export default function MixLoading() {
  return <CollectionSkeleton variant="collection" />;
}
