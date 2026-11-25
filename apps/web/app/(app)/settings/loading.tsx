import { newLookOnly, RowsSkeleton } from '@/components/page/NavLoading';
import { Skeleton } from '@/components/ui/skeleton';

/** A Settings page (the index and every section) while it loads. It sits
 *  inside the Settings frame, so the menu stays and only the content area
 *  shows placeholders: a section title and rows. */
export default async function SettingsLoading() {
  return newLookOnly(
    <div data-testid="settings-loading">
      <Skeleton className="h-7 w-32 mb-stack" />
      <RowsSkeleton rows={5} />
    </div>,
  );
}
