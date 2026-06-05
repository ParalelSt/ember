'use client';

import Link from 'next/link';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { TrackList } from '@/components/track/TrackList';
import { DownloadIcon } from '@/components/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useQueryHistory, useQueryLikes, useQueryPlaylists } from '@/hooks/useLibrary';
import { downloadPlaylistAsZip } from '@/lib/download';

export default function LibraryPage() {
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const { data: history = [] } = useQueryHistory();
  const { data: playlists = [] } = useQueryPlaylists();

  if (!user) return <div className="text-muted-foreground py-12 text-center">Sign in to see your library</div>;

  return (
    <div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">Your library</h1>
      <Tabs defaultValue="liked" className="w-full">
        <TabsList>
          <TabsTrigger value="liked">Liked</TabsTrigger>
          <TabsTrigger value="recent">Recently played</TabsTrigger>
          <TabsTrigger value="playlists">Playlists</TabsTrigger>
        </TabsList>
        <TabsContent value="liked" className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-muted-foreground">
              {liked.length} {liked.length === 1 ? 'track' : 'tracks'}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadPlaylistAsZip({ name: 'Liked Songs', tracks: liked })}
              disabled={!liked.length}
              title="Download all liked tracks as a ZIP"
            >
              <DownloadIcon className="h-4 w-4" />
              Download
            </Button>
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
                <Link key={p.id} href={`/playlist/${p.id}`} className="group p-4 rounded-xl bg-card hover:bg-card/80 transition-colors">
                  <div className="aspect-square rounded-lg shadow-soft bg-linear-to-br from-ember to-[oklch(0.3_0.15_25)]" />
                  <div className="mt-3 truncate text-sm font-semibold">{p.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Playlist</div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
