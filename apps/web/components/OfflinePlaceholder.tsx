'use client';

import { toast } from 'sonner';
import { CloudArrowDownIcon } from '@/components/icons';
import { EmptyState } from '@/components/page/EmptyState';

interface Props {
  href?: string;
  label?: string;
}

/** Try again. A reload with no network can land on the browser's own error
 *  page and lose the app (Settings > Downloads says as much), so it only
 *  reloads when the browser says the connection is there, for a missed
 *  `online` event. Otherwise it says so: this screen is what useOnline shows,
 *  and it lifts by itself when the connection comes back. */
function retry() {
  if (navigator.onLine) window.location.reload();
  else toast.message('Still offline. This page comes back by itself once you are connected.');
}

/** Shown on every route except /library and /playlist/<id> when the user
 *  is offline. Library is special-cased to show their downloaded pins. */
export function OfflinePlaceholder({ href = '/library', label = 'Go to Downloaded' }: Props) {
  return (
    <EmptyState
      icon={<CloudArrowDownIcon />}
      title="You're offline"
      titleAs="h1"
      action={{ label, href }}
      secondaryAction={{ label: 'Try again', onClick: retry }}
    >
      Only your downloaded playlists are available right now.
    </EmptyState>
  );
}
