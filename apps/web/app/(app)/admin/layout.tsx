import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ForbiddenError, requireAdmin, UnauthorizedError } from '@/lib/auth';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { serverUiMode } from '@/components/providers/serverUiMode';

async function NewAdminLayout({ children }: { children: ReactNode }) {
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

/** The new look's layout, or on a device on the Classic look the frozen one
 *  (docs/classic-look.md), imported only then. */
export default async function AdminLayout(props: Parameters<typeof NewAdminLayout>[0]) {
  if ((await serverUiMode()) === 'legacy') {
    const { default: Legacy } = await import('@legacy/app/admin/layout');
    return <Legacy {...props} />;
  }
  return await NewAdminLayout(props);
}
