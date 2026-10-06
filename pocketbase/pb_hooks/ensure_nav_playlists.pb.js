/// <reference path="../pb_data/types.d.ts" />

// Sidebar / drawer playlist order, per user so it follows the account across
// devices:
//
//   navPlaylists  (json)  { "pinned": ["id", ...], "opened": { "id": 1700000000000 } }
//
// `pinned` is the playlists held at the top (newest pin first); `opened` is
// when each playlist was last opened from the nav (server time, ms), which
// orders the rest, most recent first. Only the owner reads or writes it: the
// users collection's view and update rules are already "id = @request.auth.id".
//
// Added on boot if missing, same pattern as ensure_plugin_settings.pb.js.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let users;
  try {
    users = dao.findCollectionByNameOrId("users");
  } catch (err) {
    console.log("[ensure_nav_playlists] users collection missing, skipping:", err);
    return;
  }

  if (users.schema.getFieldByName("navPlaylists")) return;

  users.schema.addField(
    new SchemaField({
      name: "navPlaylists",
      type: "json",
      required: false,
      options: { maxSize: 60000 },
    }),
  );
  // A failed save must not stop PocketBase from booting: warn and carry
  // on, same as ensure_superuser (bughunt X11).
  try {
    dao.saveCollection(users);
    console.log("[ensure_nav_playlists] added the navPlaylists field to users");
  } catch (err) {
    console.warn("[ensure_nav_playlists] could not save the users collection: " + err);
  }
});
