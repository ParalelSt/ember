/// <reference path="../pb_data/types.d.ts" />

// Initial schema — mirrors the old Supabase tables. Tracks are a shared
// catalog (any authed user can read/upsert); playlists/likes/plays are scoped
// to their owner via API rules (PocketBase equivalent of Postgres RLS).
migrate((db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId("users");

  // tracks — cached track metadata. external_id is the app-facing id
  // (e.g. "yt_dQw4w9WgXcQ"); a unique index enforces one row per source track.
  const tracks = new Collection({
    name: "tracks",
    type: "base",
    schema: [
      { name: "external_id", type: "text", required: true, options: { max: 200 } },
      { name: "source", type: "text", required: true, options: { max: 50 } },
      { name: "source_id", type: "text", required: true, options: { max: 200 } },
      { name: "title", type: "text", required: true, options: { max: 500 } },
      { name: "artist", type: "text", options: { max: 500 } },
      { name: "album", type: "text", options: { max: 500 } },
      { name: "duration_sec", type: "number" },
      { name: "artwork_url", type: "text", options: { max: 2000 } },
      { name: "stream_url", type: "text", options: { max: 2000 } },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_tracks_external_id` ON `tracks` (`external_id`)",
    ],
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: null,
  });
  dao.saveCollection(tracks);

  // playlists — user-owned named collections of tracks.
  const playlists = new Collection({
    name: "playlists",
    type: "base",
    schema: [
      { name: "user", type: "relation", required: true, options: { maxSelect: 1, collectionId: users.id, cascadeDelete: true } },
      { name: "name", type: "text", required: true, options: { max: 200 } },
    ],
    indexes: [
      "CREATE INDEX `idx_playlists_user` ON `playlists` (`user`)",
    ],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: "user = @request.auth.id",
    updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
  });
  dao.saveCollection(playlists);

  // playlist_tracks — junction with ordering. Unique on (playlist, track)
  // mirrors the composite PK in the old SQL schema.
  const playlistTracks = new Collection({
    name: "playlist_tracks",
    type: "base",
    schema: [
      { name: "playlist", type: "relation", required: true, options: { maxSelect: 1, collectionId: playlists.id, cascadeDelete: true } },
      { name: "track", type: "relation", required: true, options: { maxSelect: 1, collectionId: tracks.id, cascadeDelete: true } },
      { name: "position", type: "number", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_playlist_tracks_pair` ON `playlist_tracks` (`playlist`, `track`)",
      "CREATE INDEX `idx_playlist_tracks_position` ON `playlist_tracks` (`playlist`, `position`)",
    ],
    listRule: "playlist.user = @request.auth.id",
    viewRule: "playlist.user = @request.auth.id",
    createRule: "playlist.user = @request.auth.id",
    updateRule: "playlist.user = @request.auth.id",
    deleteRule: "playlist.user = @request.auth.id",
  });
  dao.saveCollection(playlistTracks);

  // likes — user/track pairs.
  const likes = new Collection({
    name: "likes",
    type: "base",
    schema: [
      { name: "user", type: "relation", required: true, options: { maxSelect: 1, collectionId: users.id, cascadeDelete: true } },
      { name: "track", type: "relation", required: true, options: { maxSelect: 1, collectionId: tracks.id, cascadeDelete: true } },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_likes_user_track` ON `likes` (`user`, `track`)",
    ],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: "user = @request.auth.id",
    updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
  });
  dao.saveCollection(likes);

  // plays — listening history.
  const plays = new Collection({
    name: "plays",
    type: "base",
    schema: [
      { name: "user", type: "relation", required: true, options: { maxSelect: 1, collectionId: users.id, cascadeDelete: true } },
      { name: "track", type: "relation", required: true, options: { maxSelect: 1, collectionId: tracks.id, cascadeDelete: true } },
      { name: "played_at", type: "date", required: true },
    ],
    indexes: [
      "CREATE INDEX `idx_plays_user_played` ON `plays` (`user`, `played_at`)",
    ],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: "user = @request.auth.id",
    updateRule: "user = @request.auth.id",
    deleteRule: "user = @request.auth.id",
  });
  dao.saveCollection(plays);
}, (db) => {
  const dao = new Dao(db);
  for (const name of ["plays", "likes", "playlist_tracks", "playlists", "tracks"]) {
    try {
      const collection = dao.findCollectionByNameOrId(name);
      if (collection) dao.deleteCollection(collection);
    } catch (_) {
      // already missing — ignore
    }
  }
});
