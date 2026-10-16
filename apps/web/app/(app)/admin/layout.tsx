import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ForbiddenError, requireAdmin, UnauthorizedError } from '@/lib/auth';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { AdminHeader } from '@/components/admin/AdminHeader';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError) redirect('/');
    if (e instanceof UnauthorizedError) redirect('/auth?next=/admin');
    throw e;
  }
  return (
    <div>
      <AdminHeader />
      {/* Side nav from lg only: at md the sidebar already takes 240px, and a
          second column left the page ~230px (bughunt V8). From md to lg the
          tabs are a row across the top. Below md there are no tabs: /admin
          is a grid of section tiles and each section has a back arrow
          (AdminHeader). The gaps are the same 24px and 40px as before,
          now as tokens. */}
      <div className="flex flex-col lg:flex-row gap-stack lg:gap-section">
        <AdminTabs />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
