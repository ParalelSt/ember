'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LinkIcon } from '@/components/icons';
import { LinkPreview } from '@/components/import/LinkPreview';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { QK } from '@/hooks/useLibrary';
import { IMPORT_QK } from '@/hooks/useImports';
import { logger } from '@/lib/logger/client';
import { parseImportUrl } from '@/lib/import/url';

/** Wait this long after typing stops before looking a pasted link up. */
const LOOKUP_DELAY_MS = 350;

interface Preview {
  url: string;
  name: string;
  coverUrl: string | null;
  count: number;
  truncated: boolean;
}

type State =
  | { step: 'idle' }
  | { step: 'looking' }
  | { step: 'error'; message: string }
  | { step: 'preview'; preview: Preview };

export interface ImportLinkFormProps {
  onCancel: () => void;
  /** The playlist exists and its import is queued. */
  onCreated: (playlistId: string) => void;
}

/** The create-playlist dialog's "Import from a link" tab: paste a Spotify
 *  or YouTube Music link, see what it points at, Create. The playlist is
 *  made at once and fills in on the server. */
export function ImportLinkForm({ onCancel, onCreated }: ImportLinkFormProps) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [state, setState] = useState<State>({ step: 'idle' });
  const [creating, setCreating] = useState(false);
  const lookedUp = useRef('');

  const lookUp = useCallback(async (link: string) => {
    lookedUp.current = link;
    setState({ step: 'looking' });
    try {
      const r = await api.importInspect(link);
      if (lookedUp.current !== link) return;
      setState({
        step: 'preview',
        preview:
          r.source === 'spotify'
            ? { url: link, name: r.name, coverUrl: r.coverUrl, count: r.items.length, truncated: r.truncated }
            : {
                url: link,
                name: r.name,
                coverUrl: r.tracks[0]?.artworkUrl ?? null,
                count: r.tracks.length,
                truncated: false,
              },
      });
    } catch (e) {
      // Server messages here are written for people (private, not found,
      // Spotify unreachable): show them as they are.
      if (lookedUp.current === link) setState({ step: 'error', message: (e as Error).message });
    }
  }, []);

  // A valid link looks itself up; no button needed.
  useEffect(() => {
    const link = url.trim();
    if (!link || link === lookedUp.current || !parseImportUrl(link)) return;
    const t = setTimeout(() => void lookUp(link), LOOKUP_DELAY_MS);
    return () => clearTimeout(t);
  }, [url, lookUp]);

  // Only the preview of the link in the box counts: once it is edited, the
  // old link's preview (and its Create) goes until the new one is read.
  const preview = state.step === 'preview' && state.preview.url === url.trim() ? state.preview : null;

  const create = async () => {
    if (!preview || creating) return;
    setCreating(true);
    try {
      const { playlistId, job } = await api.importStart(preview.url);
      logger.breadcrumb('import', 'queued', { source: job.source, total: job.total });
      void qc.invalidateQueries({ queryKey: QK.playlists });
      void qc.invalidateQueries({ queryKey: IMPORT_QK.jobs });
      // This form always imports into a playlist, so there is always one.
      if (playlistId) onCreated(playlistId);
    } catch (e) {
      setState({ step: 'error', message: (e as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const invalid = !!url.trim() && !parseImportUrl(url.trim());

  return (
    <div className="flex min-h-0 flex-col gap-block">
      <div className="relative">
        <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          aria-label="Playlist link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (preview) void create();
            else if (parseImportUrl(url.trim())) void lookUp(url.trim());
          }}
          placeholder="Paste a Spotify or YouTube Music playlist link"
          className="truncate pl-10"
        />
      </div>
      {preview ? (
        <LinkPreview name={preview.name} coverUrl={preview.coverUrl} count={preview.count} truncated={preview.truncated} />
      ) : state.step === 'looking' ? (
        <p className="text-xs text-muted-foreground">Looking up the playlist…</p>
      ) : state.step === 'error' ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : invalid ? (
        <p className="text-xs text-muted-foreground">That is not a playlist link Ember can read yet.</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Public playlists from open.spotify.com or music.youtube.com. Private playlists and Liked Songs come later.
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={!preview || creating} onClick={() => void create()} variant="ember">
          {creating ? 'Creating…' : preview ? `Create, import ${formatCount(preview.count, 'song')}` : 'Create'}
        </Button>
      </DialogFooter>
    </div>
  );
}
