/// <reference path="../pb_data/types.d.ts" />

// Owner-scoped rows keep their owner (security audit 2026-09-25, finding S2).
//
// playlists, likes, plays and recent_searches are rows a member writes with
// their own session, and playlist_tracks rows belong to one of their
// playlists. The update rules only checked the row as it was, never what the
// update asks for, so through /pb a member could:
//
//   * hand a playlist to someone else (it shows up in their library),
//   * move a like or a play onto someone else's account,
//   * move a playlist_tracks row into someone else's playlist, adding a song
//     to it.
//
// Every update now also has to leave the owner as it is: the relation is
// either not in the request, or still points at the caller (for
// playlist_tracks: at a playlist of the caller's). The create rules already
// check the new row's owner. On every boot, like ensure_tracks_rules.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  const keepsOwner = (field) =>
    `${field} = @request.auth.id && (@request.data.${field}:isset = false || @request.data.${field} = @request.auth.id)`;
  const RULES = {
    playlists: keepsOwner("user"),
    likes: keepsOwner("user"),
    plays: keepsOwner("user"),
    recent_searches: keepsOwner("user"),
    playlist_tracks:
      "playlist.user = @request.auth.id && (@request.data.playlist:isset = false || @request.data.playlist.user = @request.auth.id)",
  };

  // Rules come back from Go as string pointers, so compare the JSON form
  // (same as ensure_tabs).
  const rule = (r) => (r === null || r === undefined ? null : JSON.parse(JSON.stringify(r)));
  for (const name in RULES) {
    let col;
    try {
      col = dao.findCollectionByNameOrId(name);
    } catch (_) {
      console.log("[ensure_owner_rules] " + name + " missing, skipping");
      continue;
    }
    if (rule(col.updateRule) === RULES[name]) continue;
    col.updateRule = RULES[name];
    dao.saveCollection(col);
    console.log("[ensure_owner_rules] " + name + ": an update can no longer change the owner");
  }
});
