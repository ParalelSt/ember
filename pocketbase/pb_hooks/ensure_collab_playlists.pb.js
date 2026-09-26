/// <reference path="../pb_data/types.d.ts" />

// Collaborative playlists: a playlist's owner lets other people on this
// server add, remove and reorder its songs.
//
//   playlists.collaborative  (bool)  the owner turned collaboration on
//   playlists.invite_code    (text)  the secret in the invite link, or ""
//                                    when the link is off
//   playlist_tracks.added_by (users) who put the song there; empty for rows
//                                    from before this, and for someone whose
//                                    account was deleted since
//   playlist_members         playlist, user: who may edit whose playlist
//
// Security: /pb is publicly proxied, so what a member can do here is the
// boundary. Nothing about collaboration is opened up in PocketBase itself:
//
//   * playlists and playlist_tracks keep their owner-only rules
//     (ensure_owner_rules), so a member cannot read, list, subscribe to or
//     write someone else's playlist through /pb, collaborative or not.
//   * playlist_members has no client rules at all (null = the server only).
//   * The Next routes under app/api/playlists check "owner, or a member of a
//     playlist that is collaborative right now" themselves
//     (lib/playlistAccess.ts) and only then use the server's admin client.
//   * The hooks below stop anyone but that admin client from setting
//     collaborative, invite_code or added_by: an owner could otherwise pick
//     their own invite code (and take over a link someone else shared) or
//     write a song into their playlist as "added by" a friend.
//
// Named so it sorts before ensure_owner_rules; nothing in there depends on
// these fields, but a fresh install then has every field on the first boot.
// Added on boot if missing, same pattern as the other ensure_* hooks.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  const find = (name) => {
    try {
      return dao.findCollectionByNameOrId(name);
    } catch (_) {
      return null;
    }
  };

  const users = find("users");
  const playlists = find("playlists");
  const playlistTracks = find("playlist_tracks");
  if (!users || !playlists || !playlistTracks) {
    console.log("[ensure_collab_playlists] users/playlists/playlist_tracks missing, skipping");
    return;
  }

  let addedPlaylistFields = 0;
  if (!playlists.schema.getFieldByName("collaborative")) {
    playlists.schema.addField(new SchemaField({ name: "collaborative", type: "bool", required: false, options: {} }));
    addedPlaylistFields++;
  }
  if (!playlists.schema.getFieldByName("invite_code")) {
    playlists.schema.addField(
      new SchemaField({ name: "invite_code", type: "text", required: false, options: { max: 64 } }),
    );
    addedPlaylistFields++;
  }
  if (addedPlaylistFields > 0) {
    dao.saveCollection(playlists);
    console.log("[ensure_collab_playlists] added " + addedPlaylistFields + " field(s) to playlists");
  }

  if (!playlistTracks.schema.getFieldByName("added_by")) {
    // Not required and no cascade: deleting someone's account keeps the
    // songs they added (PocketBase just empties the field).
    playlistTracks.schema.addField(
      new SchemaField({
        name: "added_by",
        type: "relation",
        required: false,
        options: { collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      }),
    );
    dao.saveCollection(playlistTracks);
    console.log("[ensure_collab_playlists] added added_by to playlist_tracks");
  }

  if (!find("playlist_members")) {
    dao.saveCollection(
      new Collection({
        name: "playlist_members",
        type: "base",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        indexes: [
          "CREATE UNIQUE INDEX idx_playlist_members_pair ON playlist_members (playlist, user)",
          "CREATE INDEX idx_playlist_members_user ON playlist_members (user)",
        ],
        schema: [
          {
            name: "playlist",
            type: "relation",
            required: true,
            options: { collectionId: playlists.id, maxSelect: 1, cascadeDelete: true },
          },
          {
            name: "user",
            type: "relation",
            required: true,
            options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
          },
        ],
      }),
    );
    console.log("[ensure_collab_playlists] created playlist_members");
  }

  // An existing install may have made the collection by hand with rules:
  // close them, the server is the only writer and reader.
  const members = find("playlist_members");
  const rule = (r) => (r === null || r === undefined ? null : JSON.parse(JSON.stringify(r)));
  if (
    members &&
    [members.listRule, members.viewRule, members.createRule, members.updateRule, members.deleteRule].some(
      (r) => rule(r) !== null,
    )
  ) {
    members.listRule = null;
    members.viewRule = null;
    members.createRule = null;
    members.updateRule = null;
    members.deleteRule = null;
    dao.saveCollection(members);
    console.log("[ensure_collab_playlists] playlist_members is server-only now");
  }
});

// Only the server (the app's admin client) turns collaboration on or off or
// sets the invite code. A member's own session gets a 403 for trying, on a
// create as well as an update, whatever the body looks like.
onRecordBeforeCreateRequest((e) => {
  if ($apis.requestInfo(e.httpContext).admin) return;
  if (e.record.getBool("collaborative") || e.record.getString("invite_code") !== "") {
    throw new ForbiddenError("Only the server can share a playlist.");
  }
}, "playlists");

onRecordBeforeUpdateRequest((e) => {
  if ($apis.requestInfo(e.httpContext).admin) return;
  const before = e.record.originalCopy();
  if (
    e.record.getBool("collaborative") !== before.getBool("collaborative") ||
    e.record.getString("invite_code") !== before.getString("invite_code")
  ) {
    throw new ForbiddenError("Only the server can share a playlist.");
  }
}, "playlists");

// "Added by" is who really added it: a member's own session may only name
// themselves on a new row, and never change it afterwards.
onRecordBeforeCreateRequest((e) => {
  const info = $apis.requestInfo(e.httpContext);
  if (info.admin) return;
  const by = e.record.getString("added_by");
  const me = info.authRecord ? info.authRecord.id : "";
  if (by !== "" && by !== me) {
    throw new ForbiddenError("A song can only be added by you.");
  }
}, "playlist_tracks");

onRecordBeforeUpdateRequest((e) => {
  if ($apis.requestInfo(e.httpContext).admin) return;
  if (e.record.getString("added_by") !== e.record.originalCopy().getString("added_by")) {
    throw new ForbiddenError("Who added a song cannot be changed.");
  }
}, "playlist_tracks");
