import { LaptopIcon, PhoneIcon } from '@/components/icons';
import { formatLastSeen } from '@/lib/format';
import type { AdminDevice } from '@/lib/api';
import { platformName } from '@/lib/versions/label';
import { cn } from '@/lib/utils';

function Behind({ newest }: { newest: string | null }) {
  return (
    <span className="rounded-full bg-ember/15 px-inset text-[11px] font-semibold text-ember">
      behind{newest ? ` (newest ${newest})` : ''}
    </span>
  );
}

/** The versions a member's devices run, at the bottom of a phone card on
 *  the Users page. Each device wraps onto as many lines as it needs. */
export function UserDevices({ email, devices, className }: { email: string; devices: AdminDevice[]; className?: string }) {
  return (
    <div className={cn('border-t border-border pt-cluster', className)}>
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

/** One device as the chip says it: the app's version (the web version for
 *  a browser), and the whole story for the tooltip. */
function chip(d: AdminDevice) {
  const browser = d.platform === 'browser';
  const version = browser ? `web ${d.webVersion ?? 'unknown'}` : d.shellVersion ?? 'version unknown';
  const behind = d.shellBehind || d.webBehind;
  const details = [
    `${platformName(d.platform)}${browser ? '' : ` ${d.shellVersion ?? '(version unknown)'}`}`,
    d.shellBehind ? `behind${d.newestShell ? ` (newest ${d.newestShell})` : ''}` : null,
    `web ${d.webVersion ?? 'unknown'}`,
    d.webBehind ? `behind${d.newestWeb ? ` (newest ${d.newestWeb})` : ''}` : null,
    `seen ${formatLastSeen(d.lastSeen)}`,
  ].filter(Boolean);
  return { version, behind, title: details.join(' · ') };
}

/** The desktop Users table's Devices column (the owner's desktop pick A):
 *  a chip per device with its icon and version; one that is behind is
 *  amber and says so. The tooltip has the rest (web version, last seen,
 *  the newest version). */
export function UserDeviceChips({ email, devices }: { email: string; devices: AdminDevice[] }) {
  if (devices.length === 0) return <span className="text-xs text-muted-foreground">None yet</span>;
  return (
    <ul aria-label={`Devices of ${email}`} className="flex flex-wrap gap-inset">
      {devices.map((d) => {
        const c = chip(d);
        const Icon = d.platform === 'android' || d.platform === 'ios' ? PhoneIcon : LaptopIcon;
        return (
          <li
            key={d.id}
            title={c.title}
            data-behind={c.behind || undefined}
            className={cn(
              'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-cluster py-inset text-[11px] font-medium tabular-nums',
              c.behind ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground',
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="sr-only">{platformName(d.platform)} </span>
            {c.version}
            {c.behind && <span>{' · behind'}</span>}
          </li>
        );
      })}
    </ul>
  );
}
