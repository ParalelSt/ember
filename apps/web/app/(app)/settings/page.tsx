import { SettingsHome } from '@/components/settings/SettingsHome';
import { serverUiMode } from '@/components/providers/serverUiMode';

function NewSettingsIndex() {
  return <SettingsHome />;
}

/** The new look's page, or on a device on the Classic look the frozen one
 *  (RULES.md "Classic look"), imported only then. */
export default async function SettingsIndex() {
  if ((await serverUiMode()) === 'legacy') {
    const { default: Legacy } = await import('@legacy/app/settings/page');
    // The Classic look's index only redirects to its first section.
    Legacy();
    return null;
  }
  return NewSettingsIndex();
}
