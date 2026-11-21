'use client';

import { AppearanceEditor } from '@/components/settings/appearance/AppearanceEditor';
import dynamic from 'next/dynamic';
import { uiSwitch } from '@/components/providers/uiSwitch';

/** Settings > Appearance (components/settings/appearance/AppearanceEditor). */
function NewSettingsAppearance() {
  return <AppearanceEditor />;
}

/** The Classic look's page (RULES.md "Classic look"), loaded only on a
 *  device that chose it. */
const LegacySettingsAppearance = dynamic(() => import('@legacy/app/settings/appearance/page'));

export default uiSwitch(NewSettingsAppearance, LegacySettingsAppearance);
