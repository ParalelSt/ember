'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Artwork } from '@/components/primitives/Artwork';
import { TrackRow } from '@/components/track/TrackRow';
import {
  AlertIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  LinkIcon,
  MusicIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
} from '@/components/icons';
import { cn } from '@/lib/utils';
import { MOCK_HOME_TRACKS, type ImportSource } from '@/app/(app)/dizajn/mock';
import { SPOTIFY_EMBED_CAP, type ImportChoiceStyle } from '@/components/library/options/imports';
import { SourceBadge, SOURCE_NAME } from '@/components/library/options/imports/parts';

// The create-playlist dialog with the import choice, three ways. Drawn in
// place (not portalled) so it sits inside the gallery's shell frame; the
// classes are DialogContent's, DialogHeader's and DialogFooter's from
// components/ui/dialog.tsx with the spacing moved onto tokens, and the
// "Start empty" body is CreatePlaylistDialog's form with TrackSearchPicker's
// markup fed from mock tracks (the real picker queries search).

type Mode = 'empty' | 'import';

export interface ImportDialogProps {
  style: ImportChoiceStyle;
  /** true: a link has been pasted (the "Link pasted" step). */
  pasted: boolean;
  source: ImportSource;
  phone: boolean;
  /** Create on the import preview: the section moves to Importing. */
  onCreate: () => void;
}

/** The dialog chrome: a blurred backdrop over the whole shell and the
 *  popup centred on it, title and close button included. */
function DialogFrame({
  phone,
  title,
  lead,
  children,
}: {
  phone: boolean;
  title: string;
  /** Before the title (the Cards option's back button). */
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-40" data-testid="import-dialog">
      <div className="absolute inset-0 bg-black/10 backdrop-blur-xs" />
      <div
        role="dialog"
        aria-label={title}
        className={cn(
          'absolute top-1/2 left-1/2 flex max-h-[90%] w-full -translate-x-1/2 -translate-y-1/2 flex-col gap-block rounded-xl bg-popover p-block text-sm text-popover-foreground ring-1 ring-foreground/10',
          phone ? 'max-w-[calc(100%-2rem)]' : 'max-w-2xl',
        )}
      >
        <div className="flex items-center gap-cluster pr-stack">
          {lead}
          <div className="font-heading text-base leading-none font-medium">{title}</div>
        </div>
        {children}
        <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" aria-label="Close">
          <CloseIcon />
        </Button>
      </div>
    </div>
  );
}

function Footer({ phone, children }: { phone: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        '-mx-block -mb-block flex gap-cluster rounded-b-xl border-t bg-muted/50 p-block',
        phone ? 'flex-col-reverse' : 'flex-row justify-end',
      )}
    >
      {children}
    </div>
  );
}

const CREATE_CLASS = 'bg-ember hover:bg-ember-soft text-white';

/** TrackSearchPicker's look with four mock recommendations. */
function MockSongPicker({ rows }: { rows: number }) {
  return (
    <div className="flex min-h-0 flex-col gap-row">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search for songs to add…" className="pl-10" readOnly />
      </div>
      <div className="flex items-center justify-between gap-cluster">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Recommended</div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="Refresh recommendations">
          <RefreshIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex flex-col gap-inset">
        {MOCK_HOME_TRACKS.slice(0, rows).map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            density="compact"
            artworkFallback={<MusicIcon className="h-4 w-4" />}
            trailing={
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label={`Add ${t.title}`}>
                <PlusIcon className="h-3.5 w-3.5" />
              </Button>
            }
          />
        ))}
      </div>
    </div>
  );
}

/** Today's "New playlist" body: the name field and the song picker. */
function StartEmptyBody({ phone, nameField }: { phone: boolean; nameField?: ReactNode }) {
  return (
    <>
      {nameField ?? <Input placeholder="Playlist name (e.g. Metal)" readOnly />}
      <MockSongPicker rows={phone ? 3 : 4} />
    </>
  );
}

/** The link field, empty or holding the pasted link. */
function LinkField({ value, placeholder }: { value: string; placeholder?: string }) {
  return (
    <div className="relative">
      <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label="Playlist link"
        value={value}
        placeholder={placeholder ?? 'Paste a Spotify or YouTube Music playlist link'}
        readOnly
        className="truncate pl-10"
      />
    </div>
  );
}

/** What the pasted link points at: cover, name, owner, song count, source,
 *  and the 100-song note when Spotify will cut the playlist short. */
export function LinkPreview({ source, phone }: { source: ImportSource; phone: boolean }) {
  const capped = source.kind === 'spotify' && source.songCount > SPOTIFY_EMBED_CAP;
  return (
    <div data-testid="link-preview" className="flex flex-col gap-row rounded-lg border border-border bg-card p-row">
      <div className={cn('flex gap-block', phone ? 'items-start' : 'items-center')}>
        <Artwork src={source.cover} className={cn('shrink-0 rounded-md bg-black shadow-soft', phone ? 'size-20' : 'size-24')} />
        <div className="min-w-0 flex-1">
          <SourceBadge kind={source.kind} />
          <div className="mt-cluster truncate text-lg font-bold tracking-tight">{source.name}</div>
          <div className="text-meta">
            {source.owner} · {source.songCount} songs
          </div>
        </div>
      </div>
      {capped && (
        <div data-testid="first-100-note" className="flex items-start gap-cluster rounded-md bg-muted/60 px-row py-cluster text-xs text-muted-foreground">
          <AlertIcon className="h-3.5 w-3.5 shrink-0 translate-y-px text-ember" />
          <span>
            <span className="font-medium text-foreground">First 100 songs.</span> Spotify only shares the first{' '}
            {SPOTIFY_EMBED_CAP} songs of a playlist through a link, so the other {source.songCount - SPOTIFY_EMBED_CAP}{' '}
            stay behind.
          </span>
        </div>
      )}
    </div>
  );
}

function NextSteps() {
  return (
    <p className="text-xs text-muted-foreground">
      The playlist shows up in your sidebar right away and fills in while songs are matched on YouTube. Anything
      unsure waits for you to check.
    </p>
  );
}

/** Link field plus, once pasted, the preview. Shared by all three styles. */
function ImportBody({ pasted, source, phone }: { pasted: boolean; source: ImportSource; phone: boolean }) {
  return (
    <>
      <LinkField value={pasted ? source.url : ''} />
      {pasted ? (
        <>
          <LinkPreview source={source} phone={phone} />
          <NextSteps />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Public playlists from open.spotify.com or music.youtube.com. Private playlists and Liked Songs come later.
        </p>
      )}
    </>
  );
}

function ImportFooter({ phone, pasted, source, onCreate }: { phone: boolean; pasted: boolean; source: ImportSource; onCreate: () => void }) {
  const n = Math.min(source.songCount, source.kind === 'spotify' ? SPOTIFY_EMBED_CAP : source.songCount);
  return (
    <Footer phone={phone}>
      <Button type="button" variant="ghost">
        Cancel
      </Button>
      <Button type="button" disabled={!pasted} onClick={onCreate} className={CREATE_CLASS}>
        {pasted ? `Create, import ${n} songs` : 'Create'}
      </Button>
    </Footer>
  );
}

function EmptyFooter({ phone }: { phone: boolean }) {
  return (
    <Footer phone={phone}>
      <Button type="button" variant="ghost">
        Cancel
      </Button>
      <Button type="button" disabled className={CREATE_CLASS}>
        Create
      </Button>
    </Footer>
  );
}

/** A. Tabs: "Start empty" / "Import from a link" under the title. */
function TabsDialog({ pasted, source, phone, onCreate }: Omit<ImportDialogProps, 'style'>) {
  const [mode, setMode] = useState<Mode>(pasted ? 'import' : 'empty');
  const tabs: { id: Mode; label: string }[] = [
    { id: 'empty', label: 'Start empty' },
    { id: 'import', label: 'Import from a link' },
  ];
  return (
    <DialogFrame phone={phone} title="New playlist">
      <div role="tablist" aria-label="New playlist" className="flex gap-stack border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={mode === t.id}
            onClick={() => setMode(t.id)}
            className={cn(
              '-mb-px flex items-center gap-cluster border-b-2 pb-cluster text-sm font-medium transition-colors',
              mode === t.id ? 'border-ember text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.id === 'import' ? <LinkIcon className="h-3.5 w-3.5" /> : <PlusIcon className="h-3.5 w-3.5" />}
            {t.label}
          </button>
        ))}
      </div>
      {mode === 'empty' ? (
        <>
          <StartEmptyBody phone={phone} />
          <EmptyFooter phone={phone} />
        </>
      ) : (
        <>
          <ImportBody pasted={pasted} source={source} phone={phone} />
          <ImportFooter phone={phone} pasted={pasted} source={source} onCreate={onCreate} />
        </>
      )}
    </DialogFrame>
  );
}

/** B. Cards: two big choices; picking one slides to its step. */
function CardsDialog({ pasted, source, phone, onCreate }: Omit<ImportDialogProps, 'style'>) {
  const [mode, setMode] = useState<Mode | null>(pasted ? 'import' : null);
  if (mode === null) {
    const cards: { id: Mode; title: string; body: string; icon: ReactNode }[] = [
      {
        id: 'empty',
        title: 'Start empty',
        body: 'Name it and add songs yourself.',
        icon: <PlusIcon className="h-5 w-5" />,
      },
      {
        id: 'import',
        title: 'Import from a link',
        body: 'Bring over a playlist from Spotify or YouTube Music.',
        icon: <LinkIcon className="h-5 w-5" />,
      },
    ];
    return (
      <DialogFrame phone={phone} title="New playlist">
        <div className={cn('grid gap-row', phone ? 'grid-cols-1' : 'grid-cols-2')}>
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              data-testid="import-choice-card"
              onClick={() => setMode(c.id)}
              className={cn(
                'group flex rounded-xl border border-border bg-card p-block text-left transition-colors hover:border-ember/50 hover:bg-accent/40',
                phone ? 'items-center gap-block' : 'flex-col gap-block',
              )}
            >
              <span
                className={cn(
                  'grid size-11 shrink-0 place-items-center rounded-full',
                  c.id === 'import' ? 'bg-ember/15 text-ember' : 'bg-secondary text-foreground/85',
                )}
              >
                {c.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{c.title}</span>
                <span className="mt-inset block text-meta">{c.body}</span>
                {c.id === 'import' && !phone && (
                  <span className="mt-row flex flex-wrap gap-inset">
                    <SourceBadge kind="spotify" />
                    <SourceBadge kind="ytm" />
                  </span>
                )}
              </span>
              {phone && <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>
          ))}
        </div>
        <Footer phone={phone}>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Footer>
      </DialogFrame>
    );
  }
  const back = (
    <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => setMode(null)} className="-my-inset -ml-inset">
      <ChevronLeftIcon />
    </Button>
  );
  return (
    <DialogFrame phone={phone} title={mode === 'import' ? 'Import from a link' : 'New playlist'} lead={back}>
      <div key={mode} className="flex min-h-0 flex-col gap-block animate-in fade-in-0 slide-in-from-right-4 duration-200">
        {mode === 'empty' ? <StartEmptyBody phone={phone} /> : <ImportBody pasted={pasted} source={source} phone={phone} />}
      </div>
      {mode === 'empty' ? (
        <EmptyFooter phone={phone} />
      ) : (
        <ImportFooter phone={phone} pasted={pasted} source={source} onCreate={onCreate} />
      )}
    </DialogFrame>
  );
}

/** C. Smart field: one field; a pasted link turns the dialog into import. */
function SmartFieldDialog({ pasted, source, phone, onCreate }: Omit<ImportDialogProps, 'style'>) {
  if (!pasted) {
    return (
      <DialogFrame phone={phone} title="New playlist">
        <StartEmptyBody
          phone={phone}
          nameField={
            <div className="flex flex-col gap-cluster">
              <Input aria-label="Name or link" placeholder="Playlist name, or paste a link" readOnly />
              <div data-testid="smart-field-hint" className="flex items-center gap-cluster text-xs text-muted-foreground">
                <LinkIcon className="h-3.5 w-3.5" />
                Paste a Spotify or YouTube Music link to import a playlist instead.
              </div>
            </div>
          }
        />
        <EmptyFooter phone={phone} />
      </DialogFrame>
    );
  }
  return (
    <DialogFrame phone={phone} title="New playlist">
      <div className="flex flex-col gap-cluster">
        <div className="relative">
          <Input
            aria-label="Name or link"
            value={source.url}
            readOnly
            className={cn('truncate', phone ? 'pr-row' : 'pr-36')}
          />
          {!phone && (
            <span className="pointer-events-none absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-inset rounded-full bg-ember/15 px-cluster text-[11px] font-medium leading-5 text-ember">
              <LinkIcon className="h-3 w-3" />
              {SOURCE_NAME[source.kind]} link
            </span>
          )}
        </div>
        <div data-testid="smart-field-hint" className="flex items-center gap-cluster text-xs text-muted-foreground">
          <LinkIcon className="h-3.5 w-3.5" />
          Importing from a link. Clear the field to name a playlist yourself.
        </div>
      </div>
      <div className="flex flex-col gap-block animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
        <LinkPreview source={source} phone={phone} />
        <NextSteps />
      </div>
      <ImportFooter phone={phone} pasted source={source} onCreate={onCreate} />
    </DialogFrame>
  );
}

/** The create-playlist dialog with the import choice, in the picked style.
 *  Keyed by style and step by the caller, so each combination starts from
 *  its own initial state. */
export function ImportDialog({ style, ...rest }: ImportDialogProps) {
  if (style === 'tabs') return <TabsDialog {...rest} />;
  if (style === 'cards') return <CardsDialog {...rest} />;
  return <SmartFieldDialog {...rest} />;
}
