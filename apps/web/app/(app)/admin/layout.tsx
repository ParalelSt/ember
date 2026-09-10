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
      <div className="flex flex-col md:flex-row gap-6 md:gap-10">
        <AdminTabs />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
