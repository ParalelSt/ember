'use client';

import type { ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { uiSwitch } from '@/components/providers/uiSwitch';
import { SettingsHome } from '@/components/settings/SettingsHome';

function NewSettingsIndex() {
  return <SettingsHome />;
}

/** The Classic look's Settings index (docs/classic-look.md): it only
 *  redirects to Profile. Loaded only on a device that chose that look. */
const LegacySettingsIndex = dynamic(() =>
  import('@legacy/app/settings/page').then((m) => m.default as unknown as ComponentType),
);

export default uiSwitch(NewSettingsIndex, LegacySettingsIndex);
