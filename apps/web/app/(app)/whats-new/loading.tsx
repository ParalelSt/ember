import { newLookOnly, RowsSkeleton, TitleSkeleton } from '@/components/page/NavLoading';

/** What's new while the changelog page loads: the title and entry rows. */
export default async function WhatsNewLoading() {
  return newLookOnly(
    <div data-testid="whats-new-loading">
      <TitleSkeleton className="h-8 w-36 mb-stack" />
      <RowsSkeleton rows={6} />
    </div>,
  );
}
