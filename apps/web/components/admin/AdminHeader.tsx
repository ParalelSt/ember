'use client';

import { usePathname } from 'next/navigation';
import { BackButton } from '@/components/ui/back-button';
import { PageTitle } from '@/components/page/PageTitle';
import { cn } from '@/lib/utils';
import { adminSectionFor } from './sections';

/** Admin's heading. Desktop: "Admin" over the tabs, as always. Phone: on
 *  /admin the same "Admin" over the section tiles; inside a section the
 *  section opens full screen, its name next to a back arrow to the tiles. */
export function AdminHeader() {
  const section = adminSectionFor(usePathname());
  return (
    <>
      {section && (
        <div data-testid="admin-section-bar" className="mb-block flex min-w-0 items-center gap-cluster md:hidden">
          <BackButton href="/admin" label="Back to Admin" />
          <h1 className="min-w-0 flex-1 truncate text-section-title">{section.label}</h1>
        </div>
      )}
      <PageTitle className={cn('mb-stack', section && 'hidden md:block')}>Admin</PageTitle>
    </>
  );
}
