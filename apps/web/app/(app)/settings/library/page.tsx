import { redirect } from 'next/navigation';

/** Settings > Library is gone on phones too (its Transfer moved to Uploads and
 *  its Blocked songs to Profile, as on desktop); old links open Profile. */
export default function SettingsLibrary(): never {
  redirect('/settings/profile');
}
