import { redirect } from 'next/navigation';
import { serverUiMode } from '@/components/providers/serverUiMode';

/** Settings > Library is gone on phones too (its Transfer moved to Uploads and
 *  its Blocked songs to Profile, as on desktop); old links open Profile. */
function NewSettingsLibrary(): never {
  redirect('/settings/profile');
}

/** The new look's page, or on a device on the Classic look the frozen one
 *  (docs/classic-look.md), imported only then. */
export default async function SettingsLibrary() {
  if ((await serverUiMode()) === 'legacy') {
    // A client page: through its loader, so the new look never downloads it.
    const { SettingsLibraryPage: Legacy } = await import('@legacy/app/lazy');
    return <Legacy />;
  }
  return NewSettingsLibrary();
}
