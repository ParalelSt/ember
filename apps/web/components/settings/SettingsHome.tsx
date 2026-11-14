'use client';

import { SettingsPicker } from './SettingsPicker';

/** The grouped phone Settings list (desktop opens a section instead, see
 *  components/settings/desktop). */
export function SettingsHome() {
  return <div className="lg:hidden"><SettingsPicker /></div>;
}
