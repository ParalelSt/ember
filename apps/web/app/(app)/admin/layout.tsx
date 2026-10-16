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
      <div className="flex flex-col md:flex-row gap-stack lg:gap-section">
        <AdminTabs />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
