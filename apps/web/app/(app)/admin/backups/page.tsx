import { redirect } from 'next/navigation';
import { ForbiddenError, requireAdmin, UnauthorizedError } from '@/lib/auth';
import BackupsPanel from './BackupsPanel';
import { serverUiMode } from '@/components/providers/serverUiMode';

async function NewAdminBackupsPage() {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/auth?next=/admin/backups');
    if (e instanceof ForbiddenError) redirect('/');
    throw e;
  }
  return <BackupsPanel />;
}

/** The new look's page, or on a device on the Classic look the frozen one
 *  (docs/classic-look.md), imported only then. */
export default async function AdminBackupsPage() {
  if ((await serverUiMode()) === 'legacy') {
    // A client page: through its loader, so the new look never downloads it.
    const { AdminBackupsPage: Legacy } = await import('@legacy/app/lazy');
    return <Legacy />;
  }
  return await NewAdminBackupsPage();
}
