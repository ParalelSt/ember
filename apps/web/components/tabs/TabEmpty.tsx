'use client';

import { useState, type ComponentProps } from 'react';
import { CheckIcon, ExternalIcon, PasteIcon, RepeatIcon, UploadIcon } from '@/components/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { announceOpen } from '@/components/ExternalLinks';
import type { TabSourcesState } from '@/hooks/useTabSources';
import { openExternal } from '@/lib/openExternal';
import { emptyStateFor } from '@/lib/tabSources';
import type { TabSearchLink } from '@/lib/tabSearchLinks';
import { parseTabText, reportLine } from '@/lib/tabText';
import { cn } from '@/lib/utils';

/** Open a link out of Ember: a new tab, or the system browser in the
 *  desktop app, where the webview drops new-tab links (lib/openExternal.ts). */
export function openLink(url: string): void {
  void openExternal(url).then(announceOpen);
}

/** A link out of Ember that opens through lib/openExternal (the desktop
 *  app drops plain new-tab links). `onOpen` runs as it opens. */
function OutLink({ href, className, children, onOpen, ...rest }: ComponentProps<'a'> & { onOpen?: () => void }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        if (href) openLink(href);
        onOpen?.();
      }}
      className={className}
      {...rest}
    >
      {children}
    </a>
  );
}

/** The three places to find a tab, in the order the cards show them. */
const SITE_ORDER: TabSearchLink['id'][] = ['songsterr', 'ultimate-guitar', 'guitar-pro'];

const SITE_LOOK: Record<TabSearchLink['id'], { mark: string; className: string; note: string }> = {
  songsterr: { mark: 'SS', className: 'bg-ember/15 text-ember', note: 'Tabs that play along with the song' },
  'ultimate-guitar': { mark: 'UG', className: 'bg-primary/15 text-primary', note: 'Text and Guitar Pro tabs, rated by players' },
  'guitar-pro': { mark: 'GP', className: 'bg-muted text-muted-foreground', note: 'A web search for .gp and .gpx files' },
};

const FILE_NOTE = 'A Guitar Pro or MusicXML tab. Everyone here gets it.';

/** What the paste reads as, under the box: the parser's own report, the
 *  same one the server saves from (lib/tabText.ts). */
function pasteCheck(text: string, song: { title: string; artist: string }): { ok: boolean; line: string } {
  if (!text.trim()) return { ok: false, line: '' };
  const parsed = parseTabText(text, { title: song.title, artist: song.artist });
  return parsed.ok ? { ok: true, line: `Looks like a tab: ${reportLine(parsed.report)}.` } : { ok: false, line: parsed.error };
}

/** No tab to draw (the owner's pick, "Find one, then add"): a line that
 *  Ember already looked on Songsterr, with Look again; the three places
 *  people post tabs, each with Find one; and once one was opened, a card
 *  at the top waiting for what the listener found there: the file, or a
 *  text tab pasted in. */
export function NoTab({
  sources,
  searchLinks,
  song,
  onAddFile,
}: {
  sources: TabSourcesState;
  searchLinks: TabSearchLink[];
  song: { title: string; artist: string };
  onAddFile: () => void;
}) {
  const state = emptyStateFor({
    loading: sources.loading,
    searchingOnline: sources.searchingOnline,
    matchesLoading: sources.matchesLoading,
    matches: sources.matches,
  });
  const searching = state.kind === 'searching';
  const n = state.kind === 'matches' ? state.matches.length : 0;
  const [went, setWent] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState('');
  const check = pasteCheck(text, song);
  const sites = SITE_ORDER.map((id) => searchLinks.find((l) => l.id === id)).filter((l): l is TabSearchLink => !!l);

  const line = searching
    ? 'Looking on Songsterr…'
    : state.kind === 'matches'
      ? `Songsterr has ${n === 1 ? '1 tab' : `${n} tabs`} Ember could not draw here. Find ${n === 1 ? 'it' : 'one'} there, then add it here.`
      : 'Ember looked on Songsterr: nothing yet. Find one, then add it here.';

  return (
    <div data-testid="tabs-empty" data-state={state.kind} className="mt-stack flex max-w-2xl flex-col gap-row">
      {went && (
        <section
          data-testid="tabs-return"
          aria-label={`Back from ${went}`}
          className="flex flex-col gap-row rounded-2xl border border-ember/40 bg-ember/10 p-row"
        >
          <div className="flex min-w-0 items-center gap-cluster">
            <CheckIcon className="size-4 shrink-0 text-ember" />
            <h2 className="min-w-0 flex-1 text-sm font-semibold">Back from {went}? Add what you found.</h2>
          </div>
          <div className="flex flex-wrap items-center gap-cluster">
            <Button variant="ember" onClick={onAddFile} disabled={sources.uploading}>
              <UploadIcon className="size-4" />
              {sources.uploading ? 'Adding…' : 'Add the file'}
            </Button>
            <Button variant="outline" aria-expanded={pasteOpen} onClick={() => setPasteOpen((v) => !v)}>
              <PasteIcon className="size-4" />
              Paste a text tab
            </Button>
          </div>
          {pasteOpen && (
            <div className="flex flex-col gap-cluster">
              <Textarea
                aria-label="Text tab"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'e|---0---3---|\nB|---1---0---|'}
                rows={6}
                className="min-h-24 font-mono text-xs"
              />
              <div className="flex flex-wrap items-center justify-between gap-cluster">
                <span data-testid="tabs-paste-check" className={cn('text-meta min-w-0 flex-1', text.trim() && !check.ok && 'text-destructive')}>
                  {check.line}
                </span>
                <Button size="sm" variant="ember" disabled={!check.ok || sources.pasting} onClick={() => sources.paste(text)}>
                  {sources.pasting ? 'Adding…' : 'Add this tab'}
                </Button>
              </div>
              {sources.pasteError && (
                <p role="alert" className="text-meta text-destructive">
                  {sources.pasteError}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="flex min-w-0 items-center gap-cluster">
        <p
          role={searching ? 'status' : undefined}
          data-testid={searching ? 'tabs-searching' : 'tabs-looked'}
          className="min-w-0 flex-1 text-sm text-muted-foreground"
        >
          {line}
        </p>
        <Button size="sm" variant="ghost" disabled={searching} onClick={sources.searchOnlineAgain}>
          <RepeatIcon className="size-3.5" />
          Look again
        </Button>
      </div>

      <ul className="flex flex-col gap-cluster" aria-busy={searching || undefined}>
        {sites.map((l) => {
          const look = SITE_LOOK[l.id];
          const again = went === l.label;
          const note = l.id === 'songsterr' && n > 0 ? `${n} version${n === 1 ? '' : 's'} there` : look.note;
          return (
            <li
              key={l.id}
              data-testid="tabs-empty-site"
              data-link={l.id}
              className="flex min-w-0 items-center gap-row rounded-2xl border border-border bg-card/60 p-row"
            >
              <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-lg text-xs font-extrabold', look.className)}>
                {look.mark}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{l.label}</span>
                <span className="block text-xs text-muted-foreground">{note}</span>
              </span>
              <OutLink
                href={l.url}
                aria-label={`Find one on ${l.label}`}
                onOpen={() => setWent(l.label)}
                className={cn(buttonVariants({ size: 'sm', variant: again ? 'outline' : 'ember' }), 'shrink-0 rounded-full')}
              >
                {again ? 'Again' : 'Find one'}
                <ExternalIcon className="size-3.5" />
              </OutLink>
            </li>
          );
        })}
      </ul>

      {!went && (
        <div className="flex flex-wrap items-center gap-x-cluster gap-y-inset text-xs text-muted-foreground">
          <span>Already have a file?</span>
          <Button size="sm" variant="outline" onClick={onAddFile} disabled={sources.uploading}>
            <UploadIcon className="size-3.5" />
            {sources.uploading ? 'Adding…' : 'Add a file'}
          </Button>
          <span className="min-w-0 basis-56">{FILE_NOTE}</span>
        </div>
      )}
    </div>
  );
}
