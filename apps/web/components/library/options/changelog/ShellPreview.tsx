import type { MouseEvent, ReactNode } from 'react';
import {
  FlameIcon,
  HeartIcon,
  HomeIcon,
  LibraryIcon,
  LyricsIcon,
  MenuIcon,
  NextIcon,
  PauseIcon,
  PlusIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  SearchIcon,
  TabsIcon,
  VolumeIcon,
} from '@/components/icons';
import { NavLinks } from '@/components/nav/NavLinks';
import { CollectionNavList } from '@/components/nav/CollectionNavList';
import { PlaylistNavList } from '@/components/nav/PlaylistNavList';
import { Artwork } from '@/components/primitives/Artwork';
import { BASE_NAV } from '@/lib/nav';
import { systemCollections } from '@/lib/collections';
import { cn } from '@/lib/utils';
import { MOCK_NOW_PLAYING } from '@/app/(app)/dizajn/mock';
import { UnreadDot } from '@/components/library/options/changelog/NewBadge';

const MOCK_SIDEBAR_PLAYLISTS = [
  { id: 'p1', name: 'Late Night Drive', href: '/playlist/mock-1' },
  { id: 'p2', name: 'Gym', href: '/playlist/mock-3' },
  { id: 'p3', name: 'Sunday Mornings', href: '/playlist/mock-4' },
  { id: 'p4', name: '90s Alt Rock Deep Cuts', href: '/playlist/mock-5' },
  { id: 'p5', name: 'For Dad', href: '/playlist/mock-6' },
];

const COLLECTIONS = systemCollections().map(({ title, href, icon }) => ({ label: title, href, icon }));

export interface ShellPreviewProps {
  /** Phone shell (top bar, bottom nav) instead of the desktop sidebar.
   *  A prop, not md: classes, because both frames render on the same
   *  viewport. */
  phone: boolean;
  /** Path the nav highlights; '' highlights nothing (a page with no nav
   *  entry of its own). */
  activePath: string;
  /** The page in the content column. */
  content: ReactNode;
  /** An extra row under the sidebar/drawer nav links. */
  navExtra?: ReactNode;
  /** Pinned just above the sidebar/drawer profile row. */
  footerExtra?: ReactNode;
  /** Desktop: floats in the content column's top-right corner. */
  contentCorner?: ReactNode;
  /** Phone: the top bar's right slot. Omitted, it is today's empty w-9
   *  spacer. */
  topBarRight?: ReactNode;
  /** Phone: an unread dot on the menu button. */
  menuDot?: boolean;
  /** Absolutely positioned over the content column (below the phone top
   *  bar), for a popover. */
  overlay?: ReactNode;
  /** Phone: the slide-out menu. The mock's own menu button toggles it. */
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
}

// Every link in the mock is real markup (NavLinks and friends render
// next/link) but must not navigate away from /dizajn. Link bails when the
// event is already defaultPrevented, so a capture-phase preventDefault on
// the shell keeps every click local while buttons still work.
function stopLinkNavigation(e: MouseEvent<HTMLDivElement>) {
  if ((e.target as Element).closest('a')) e.preventDefault();
}

function SidebarLogo() {
  return (
    <div className="flex items-center gap-2 px-4 pt-5 pb-4">
      <FlameIcon className="h-5 w-5 text-ember" />
      <span className="text-lg font-bold tracking-tight">Ember</span>
    </div>
  );
}

function ProfileRow({ className }: { className?: string }) {
  return (
    <div className={cn('border-t border-sidebar-border px-2 py-3', className)}>
      <div className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ember text-xs font-bold text-white">A</div>
        <div className="truncate text-xs text-sidebar-foreground/70">Aron</div>
      </div>
    </div>
  );
}

function PlaylistsHeader({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-between px-4', className)}>
      <span className="text-[11px] uppercase tracking-widest text-sidebar-foreground/55">Playlists</span>
      <span className="grid h-6 w-6 place-items-center rounded-lg text-sidebar-foreground/70">
        <PlusIcon className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

/** A copy of Sidebar's markup (same classes, same order) fed from mock
 *  data: the real one reads auth, the playlists query and the UI store. */
function MockSidebar({ activePath, navExtra, footerExtra }: Pick<ShellPreviewProps, 'activePath' | 'navExtra' | 'footerExtra'>) {
  return (
    <aside className="flex h-full w-(--sidebar-w) shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <SidebarLogo />
      <nav className="flex flex-col gap-1 px-2">
        <NavLinks items={BASE_NAV} activePath={activePath} />
        {navExtra}
      </nav>
      <div className="mt-4 border-t border-sidebar-border pt-3">
        <CollectionNavList items={COLLECTIONS} activePath={activePath} />
      </div>
      <PlaylistsHeader className="mt-6" />
      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        <div className="flex flex-col gap-0.5 px-2 pb-3">
          <PlaylistNavList items={MOCK_SIDEBAR_PLAYLISTS} authed />
        </div>
      </div>
      {footerExtra}
      <ProfileRow className="mt-auto" />
    </aside>
  );
}

/** A copy of Drawer's sheet contents, drawn inside the phone frame rather
 *  than portalled to the page (the real one is a base-ui Sheet). */
function MockDrawer({
  activePath,
  navExtra,
  footerExtra,
  onClose,
}: Pick<ShellPreviewProps, 'activePath' | 'navExtra' | 'footerExtra'> & { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30" data-testid="mock-drawer">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/10 backdrop-blur-xs"
      />
      <div className="absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col border-r border-sidebar-border bg-sidebar text-sm text-sidebar-foreground shadow-lg">
        <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-4 text-base font-medium">
          <FlameIcon className="h-4 w-4 text-ember" />
          Ember
        </div>
        <nav className="flex flex-col gap-1 px-2 py-3">
          <NavLinks items={BASE_NAV} activePath={activePath} />
          {navExtra}
        </nav>
        <div className="mt-4 border-t border-sidebar-border pt-3">
          <CollectionNavList items={COLLECTIONS} activePath={activePath} />
        </div>
        <PlaylistsHeader className="border-t border-sidebar-border pt-3" />
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-2 py-2">
          <PlaylistNavList items={MOCK_SIDEBAR_PLAYLISTS} authed />
        </div>
        {footerExtra}
        <ProfileRow />
      </div>
    </div>
  );
}

function MockTopBar({
  topBarRight,
  menuDot,
  onMenu,
}: Pick<ShellPreviewProps, 'topBarRight' | 'menuDot'> & { onMenu: () => void }) {
  return (
    <header className="flex items-center justify-between gap-2 border-b border-sidebar-border bg-sidebar px-3 py-3">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        data-testid="mock-menu-button"
        className="relative grid size-8 place-items-center rounded-lg transition-colors hover:bg-muted"
      >
        <MenuIcon className="h-5 w-5" />
        {menuDot && <UnreadDot className="right-1 top-1" />}
      </button>
      <div className="flex items-center gap-2 font-bold">
        <FlameIcon className="h-4 w-4 text-ember" />
        Ember
      </div>
      {topBarRight ?? <div className="w-9" />}
    </header>
  );
}

const ghostIcon = 'grid h-8 w-8 place-items-center rounded-lg text-muted-foreground';

/** PlayerBar's markup with a track "playing", no player context. */
function MockPlayerBar({ phone }: { phone: boolean }) {
  const t = MOCK_NOW_PLAYING;
  return (
    <footer className="flex shrink-0 flex-col border-t border-sidebar-border bg-sidebar">
      <div
        className={cn(
          'grid items-center gap-4 px-4 pt-3 pb-2',
          phone ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-[1fr_2fr_1fr]',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Artwork src={t.artworkUrl} size="sm" className="shrink-0 rounded-md bg-black" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{t.title}</div>
            <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
          </div>
          {!phone && (
            <div className="flex shrink-0 items-center gap-1">
              <span className={cn(ghostIcon, 'text-ember')}>
                <HeartIcon className="h-4 w-4 fill-current" />
              </span>
              <span className={ghostIcon}>
                <PlusIcon className="h-4 w-4" />
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-3">
            {!phone && (
              <span className={ghostIcon}>
                <RepeatIcon className="h-4 w-4" />
              </span>
            )}
            <span className="grid size-8 place-items-center">
              <PrevIcon className="h-4 w-4" />
            </span>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-background">
              <PauseIcon className="h-4 w-4 fill-current" />
            </span>
            <span className="grid size-8 place-items-center">
              <NextIcon className="h-4 w-4" />
            </span>
          </div>
          {!phone && (
            <div className="flex w-full max-w-xl items-center gap-2">
              <span className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">1:24</span>
              <div className="relative h-1 flex-1 rounded-full bg-muted">
                <div className="absolute inset-y-0 left-0 w-[35%] rounded-full bg-primary" />
              </div>
              <span className="w-9 text-[10px] tabular-nums text-muted-foreground">4:02</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          {!phone && (
            <>
              <span className={ghostIcon}>
                <LyricsIcon className="h-4 w-4" />
              </span>
              <span className={ghostIcon}>
                <TabsIcon className="h-4 w-4" />
              </span>
            </>
          )}
          <span className={cn(ghostIcon, phone && 'h-10 w-10')}>
            <QueueIcon className={phone ? 'h-5 w-5' : 'h-4 w-4'} />
          </span>
          {!phone && (
            <div className="flex items-center gap-2">
              <span className={ghostIcon}>
                <VolumeIcon className="h-4 w-4" />
              </span>
              <div className="relative h-1 w-24 rounded-full bg-muted">
                <div className="absolute inset-y-0 left-0 w-[70%] rounded-full bg-primary" />
              </div>
            </div>
          )}
        </div>
      </div>
      {phone && (
        <div className="px-3 pb-2">
          <div className="relative h-1 rounded-full bg-muted">
            <div className="absolute inset-y-0 left-0 w-[35%] rounded-full bg-primary" />
          </div>
        </div>
      )}
    </footer>
  );
}

/** MobileNav's markup with Home active. */
function MockMobileNav({ activePath }: { activePath: string }) {
  const items = [
    { href: '/', label: 'Home', Icon: HomeIcon },
    { href: '/search', label: 'Search', Icon: SearchIcon },
    { href: '/library', label: 'Library', Icon: LibraryIcon },
  ];
  return (
    <nav className="flex shrink-0 items-stretch justify-around border-t border-sidebar-border bg-sidebar">
      {items.map(({ href, label, Icon }) => (
        <div
          key={href}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
            activePath === href ? 'text-foreground' : 'text-foreground/55',
          )}
        >
          <Icon className="h-5 w-5" />
          {label}
        </div>
      ))}
    </nav>
  );
}

/** Presentational only, mock data only: the whole Ember app shell (the
 *  structure of app/(app)/layout.tsx) at whatever size its parent gives it,
 *  with slots for each "What's new" entry point. Sidebar, Drawer, TopBar,
 *  PlayerBar and MobileNav are mock copies of the real markup, because the
 *  real ones read auth, react-query, stores or the player; NavLinks,
 *  CollectionNavList, PlaylistNavList and Artwork are the real
 *  presentational components. */
export function ShellPreview({
  phone,
  activePath,
  content,
  navExtra,
  footerExtra,
  contentCorner,
  topBarRight,
  menuDot,
  overlay,
  drawerOpen = false,
  onDrawerOpenChange,
}: ShellPreviewProps) {
  return (
    <div
      data-testid="shell-preview"
      data-phone={phone}
      onClickCapture={stopLinkNavigation}
      className={cn(
        'relative flex h-full w-full overflow-hidden bg-background text-foreground',
        phone ? 'flex-col' : 'flex-row',
      )}
    >
      {!phone && <MockSidebar activePath={activePath} navExtra={navExtra} footerExtra={footerExtra} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {phone && (
          <MockTopBar topBarRight={topBarRight} menuDot={menuDot} onMenu={() => onDrawerOpenChange?.(true)} />
        )}
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0 overflow-y-auto">
            <main className={phone ? 'px-6 py-6' : 'px-8 py-8'}>
              <div className="mx-auto max-w-(--content-max)">{content}</div>
            </main>
          </div>
          {!phone && contentCorner && <div className="absolute right-8 top-[34px] z-10">{contentCorner}</div>}
          {overlay}
        </div>
        <MockPlayerBar phone={phone} />
        {phone && <MockMobileNav activePath={activePath} />}
      </div>
      {phone && drawerOpen && (
        <MockDrawer
          activePath={activePath}
          navExtra={navExtra}
          footerExtra={footerExtra}
          onClose={() => onDrawerOpenChange?.(false)}
        />
      )}
    </div>
  );
}
