import { CloseIcon, SparklesIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { ChangelogEntry } from '@/app/(app)/dizajn/mock';
import type { BadgeStyle } from '@/components/library/options/changelog';
import { NewBadge, UnreadDot } from '@/components/library/options/changelog/NewBadge';

// The four entry-point candidates. Each takes `showNew` (an unread entry
// exists and New tags are not hidden) and an `onOpen` click; none of them
// reads state of its own.

interface EntryProps {
  showNew: boolean;
  badge: BadgeStyle;
  onOpen: () => void;
}

/** Sidebar link: one more row in the sidebar/drawer nav, classes copied
 *  from NavLinks so it is indistinguishable from Home/Search/Library, with
 *  the New tag pushed to the right edge. */
export function SidebarWhatsNewLink({ showNew, badge, onOpen, active }: EntryProps & { active: boolean }) {
  return (
    <button
      type="button"
      data-testid="whats-new-sidebar-link"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
      )}
    >
      <SparklesIcon className="h-4 w-4" />
      <span className="flex-1">What&apos;s new</span>
      {showNew && <NewBadge variant={badge} />}
    </button>
  );
}

/** Sidebar card: pinned just above the profile row. Loud (latest title,
 *  ember link) while something is unread, a quiet one-line row once read. */
export function SidebarWhatsNewCard({ showNew, badge, onOpen, latest }: EntryProps & { latest: ChangelogEntry }) {
  if (!showNew) {
    return (
      <button
        type="button"
        data-testid="whats-new-sidebar-card"
        onClick={onOpen}
        className="mx-2 mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-left text-xs text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
      >
        <SparklesIcon className="h-3.5 w-3.5" />
        What&apos;s new
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid="whats-new-sidebar-card"
      onClick={onOpen}
      className="mx-2 mb-2 block rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3 text-left transition-colors hover:bg-sidebar-accent"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-widest text-sidebar-foreground/55">New in Ember</span>
        <NewBadge variant={badge} />
      </div>
      <div className="mt-1.5 truncate text-sm font-semibold text-sidebar-foreground">{latest.title}</div>
      <div className="mt-1 text-xs font-medium text-ember">See what&apos;s new</div>
    </button>
  );
}

/** Home banner: a card at the top of Home only. Shown while something is
 *  unread and not dismissed; the page decides that and simply omits it. */
export function HomeWhatsNewBanner({
  showNew,
  badge,
  onOpen,
  onDismiss,
  latest,
}: EntryProps & { onDismiss: () => void; latest: ChangelogEntry }) {
  return (
    <div data-testid="whats-new-home-banner" className="relative mb-stack flex items-start gap-4 rounded-2xl bg-card p-5 shadow-soft">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ember/15 text-ember">
        <SparklesIcon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1 pr-8">
        <div className="flex items-center gap-2">
          <span className="text-eyebrow">What&apos;s new</span>
          {showNew && <NewBadge variant={badge} />}
        </div>
        <div className="mt-1 font-semibold">{latest.title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{latest.summary}</p>
        <button
          type="button"
          onClick={onOpen}
          className="mt-3 text-sm font-medium text-ember transition-colors hover:text-ember-soft"
        >
          See all
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Top bar button. Desktop: the sparkle plus the New pill in one rounded
 *  button, collapsing to the bare icon once read. Phone: an icon button the
 *  same size as the menu button (so the logo lands centred) with an unread
 *  dot, since there is no room for a pill in the top bar. */
export function TopBarWhatsNewButton({
  showNew,
  badge,
  onOpen,
  phone,
  open,
}: EntryProps & { phone: boolean; open: boolean }) {
  if (phone) {
    return (
      <button
        type="button"
        data-testid="whats-new-top-bar-button"
        onClick={onOpen}
        aria-label="What's new"
        aria-expanded={open}
        className={cn(
          'relative grid size-8 place-items-center rounded-lg transition-colors hover:bg-muted',
          open && 'bg-muted',
        )}
      >
        <SparklesIcon className="h-5 w-5" />
        {showNew && <UnreadDot className="right-1 top-1" />}
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid="whats-new-top-bar-button"
      onClick={onOpen}
      aria-label="What's new"
      aria-expanded={open}
      className={cn(
        'flex h-9 items-center gap-2 rounded-full border border-border bg-card/80 text-sm shadow-soft backdrop-blur transition-colors hover:bg-card',
        showNew ? 'pl-3 pr-2' : 'w-9 justify-center',
        open && 'bg-card',
      )}
    >
      <SparklesIcon className={cn('h-4 w-4', showNew ? 'text-ember' : 'text-muted-foreground')} />
      {showNew && <NewBadge variant={badge} />}
    </button>
  );
}
