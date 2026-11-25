import { newLookOnly, RowsSkeleton, TitleSkeleton } from '@/components/page/NavLoading';

/** Transfer (move likes in from another service) while it loads. */
export default async function TransferLoading() {
  return newLookOnly(
    <div data-testid="transfer-loading">
      <TitleSkeleton className="h-8 w-40 mb-stack" />
      <RowsSkeleton rows={4} />
    </div>,
  );
}
