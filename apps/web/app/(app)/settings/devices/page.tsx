import { DevicesPanel } from '@/components/settings/DevicesPanel';
import { HeadUnitSettings } from '@/components/settings/HeadUnitSettings';
import { serverUiMode } from '@/components/providers/serverUiMode';

function NewSettingsDevices() {
  return (
    <>
      <DevicesPanel />
      <HeadUnitSettings />
    </>
  );
}

/** The new look's page, or on a device on the Classic look the frozen one
 *  (docs/classic-look.md), imported only then. */
export default async function SettingsDevices() {
  if ((await serverUiMode()) === 'legacy') {
    const { default: Legacy } = await import('@legacy/app/settings/devices/page');
    return <Legacy />;
  }
  return NewSettingsDevices();
}
