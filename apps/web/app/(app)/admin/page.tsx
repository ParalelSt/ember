import { AdminHome } from '@/components/admin/AdminHome';
import { serverUiMode } from '@/components/providers/serverUiMode';

function NewAdminIndex() {
  return <AdminHome />;
}

/** The new look's page, or on a device on the Classic look the frozen one
 *  (docs/classic-look.md), imported only then. */
export default async function AdminIndex() {
  if ((await serverUiMode()) === 'legacy') {
    const { default: Legacy } = await import('@legacy/app/admin/page');
    // The Classic look's index only redirects to its first section.
    Legacy();
    return null;
  }
  return NewAdminIndex();
}
