import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireUser, UnauthorizedError } from '@/lib/auth';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { PageTitle } from '@/components/page/PageTitle';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    const { user } = await requireUser();
    if (!user.isAdmin) redirect('/');
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/auth?next=/admin');
    throw e;
  }
  return (
    <div>
      <PageTitle className="mb-6">Admin</PageTitle>
      {/* Side nav from lg only: at md the sidebar already takes 240px, and a
          second column left the page ~230px (bughunt V8). Below lg the tabs
          are the row across the top that phones use. */}
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
        <AdminTabs />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
