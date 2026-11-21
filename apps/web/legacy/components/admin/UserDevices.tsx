import { formatLastSeen } from '@/lib/format';
import type { AdminDevice } from '@/lib/api';
import { platformName } from '@/lib/versions/label';

function Behind({ newest }: { newest: string | null }) {
  return (
    <span className="rounded-full bg-ember/15 px-inset text-[11px] font-semibold text-ember">
      behind{newest ? ` (newest ${newest})` : ''}
    </span>
  );
}

/** The versions a member's devices run, under their row on the Users page. A
 *  phone wraps each device onto as many lines as it needs. */
export function UserDevices({ email, devices }: { email: string; devices: AdminDevice[] }) {
  return (
    <div className="col-span-2 border-t border-border pt-cluster md:col-span-full">
      {devices.length === 0 ? (
        <p className="text-xs text-muted-foreground">No devices seen yet</p>
      ) : (
        <ul aria-label={`Devices of ${email}`} className="flex flex-col gap-inset">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-cluster gap-y-inset text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {platformName(d.platform)}
                {d.platform === 'browser' ? '' : ` ${d.shellVersion ?? '(version unknown)'}`}
              </span>
              {d.shellBehind && <Behind newest={d.newestShell} />}
              <span>web {d.webVersion ?? 'unknown'}</span>
              {d.webBehind && <Behind newest={d.newestWeb} />}
              <span>seen {formatLastSeen(d.lastSeen)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
