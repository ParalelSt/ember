import { redirect } from 'next/navigation';
import { ForbiddenError, requireAdmin, UnauthorizedError } from '@/lib/auth';
import BackupsPanel from './BackupsPanel';

export default async function AdminBackupsPage() {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/auth?next=/admin/backups');
    if (e instanceof ForbiddenError) redirect('/');
    throw e;
  }
  return <BackupsPanel />;
}
