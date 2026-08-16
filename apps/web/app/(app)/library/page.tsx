'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { TrackList } from '@/components/track/TrackList';
import { ImportPlaylistDialog } from '@/components/track/ImportPlaylistDialog';
import { UploadTrackDialog } from '@/components/track/UploadTrackDialog';
import { StartSessionDialog, JoinSessionDialog } from '@/components/session/SessionDialogs';
import { CheckIcon, DownloadIcon, QueueIcon, UploadIcon } from '@/components/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useQueryHistory, useQueryLikes, useQueryPlaylists, useQueryUploads } from '@/hooks/useLibrary';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { useOnline } from '@/lib/useOnline';

export default function LibraryPage() {
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const { data: history = [] } = useQueryHistory();
  const { data: playlists = [] } = useQueryPlaylists();
  const isOnline = useOnline();
  const downloadedIds = useOfflineStore((s) => s.downloaded);
  const { data: uploads = [] } = useQueryUploads();
  const [importOpen, setImportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  if (!user) return <div className="text-muted-foreground py-12 text-center">Sign in to see your library</div>;

  // Offline: hide Liked + Recent (those need server data) and show only the
  // playlists that have been pinned via the Download-for-offline button.
  if (!isOnline) {
    const downloadedPlaylists = playlists.filter((p) => downloadedIds.includes(p.id));
    return (
      <div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">Your library</h1>
        <p className="text-sm text-muted-foreground mb-6">Offline — showing downloaded playlists only.</p>
        {downloadedPlaylists.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center">
            No downloaded playlists. Go online and tap “Download for offline” on a playlist to pin it.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {downloadedPlaylists.map((p) => (
              <Link key={p.id} href={`/playlist/${p.id}`} className="group p-4 rounded-md bg-card hover:bg-card/80 transition-colors">
                <div className="aspect-square rounded-md shadow-soft bg-linear-to-br from-ember to-[oklch(0.3_0.15_25)]" />
                <div className="mt-3 flex items-center gap-1.5">
                  <CheckIcon className="h-3.5 w-3.5 text-ember shrink-0" />
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Downloaded</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Your library</h1>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => setStartOpen(true)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <QueueIcon className="h-4 w-4" /> Session
          </Button>
          <Button
            variant="ghost"
            onClick={() => setJoinOpen(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            Join
          </Button>
          <Button
            variant="ghost"
            onClick={() => setImportOpen(true)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <DownloadIcon className="h-4 w-4" /> Import
          </Button>
          <Button
            variant="ghost"
            onClick={() => setUploadOpen(true)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <UploadIcon className="h-4 w-4" /> Upload
          </Button>
        </div>
      </div>
      <ImportPlaylistDialog open={importOpen} onOpenChange={setImportOpen} />
      <UploadTrackDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <StartSessionDialog open={startOpen} onOpenChange={setStartOpen} />
      <JoinSessionDialog open={joinOpen} onOpenChange={setJoinOpen} />
      <Tabs defaultValue="liked" className="w-full">
        <TabsList>
          <TabsTrigger value="liked">Liked</TabsTrigger>
          <TabsTrigger value="recent">Recently played</TabsTrigger>
          <TabsTrigger value="playlists">Playlists</TabsTrigger>
          <TabsTrigger value="uploads">Uploads</TabsTrigger>
        </TabsList>
        <TabsContent value="liked" className="mt-6">
          <div className="text-sm text-muted-foreground mb-4">
            {liked.length} {liked.length === 1 ? 'track' : 'tracks'}
          </div>
          <TrackList tracks={liked} />
        </TabsContent>
        <TabsContent value="recent" className="mt-6"><TrackList tracks={history} /></TabsContent>
        <TabsContent value="playlists" className="mt-6">
          {playlists.length === 0 ? (
            <div className="text-muted-foreground py-12 text-center">No playlists yet</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {playlists.map((p) => (
                <Link key={p.id} href={`/playlist/${p.id}`} className="group p-4 rounded-md bg-card hover:bg-card/80 transition-colors">
                  <div className="aspect-square rounded-md shadow-soft bg-linear-to-br from-ember to-[oklch(0.3_0.15_25)]" />
                  <div className="mt-3 flex items-center gap-1.5">
                    {downloadedIds.includes(p.id) && (
                      <CheckIcon className="h-3.5 w-3.5 text-ember shrink-0" />
                    )}
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {downloadedIds.includes(p.id) ? 'Downloaded' : 'Playlist'}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="uploads" className="mt-6">
          {uploads.length === 0 ? (
            <div className="text-muted-foreground py-12 text-center">
              Nothing uploaded yet. Use <span className="text-foreground">Upload</span> to add a song from your
              device — everyone on the server can then find it.
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground mb-4">
                {uploads.length} {uploads.length === 1 ? 'song' : 'songs'} added by members of this server
              </div>
              <TrackList tracks={uploads} />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
