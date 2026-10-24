/// <reference path="../pb_data/types.d.ts" />

// Favourite radio stations (live internet radio, apps/web/lib/radio): one row
// per member and station, written by the Next routes (app/api/radio/
// favorites) with the member's own session. Station details come from Radio
// Browser through the server, never from the client.
//
//   user        relation to users (the owner; deleted with them)
//   station_id  Radio Browser's station uuid
//   name, url, favicon   as Radio Browser listed them when it was added
//   added       when it was added
//
// Security: /pb is publicly proxied, so these rules are the boundary. Only
// the owner sees, adds or removes their rows; nobody edits one.
//
// Added on boot if missing, same pattern as the other ensure_* hooks. A
// failed save must not stop PocketBase from booting: warn and carry on.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  try {
    dao.findCollectionByNameOrId("radio_favorites");
    return; // already exists
  } catch (_) {
    // Missing: create it below.
  }

  let users;
  try {
    users = dao.findCollectionByNameOrId("users");
  } catch (err) {
    console.log("[ensure_radio_favorites] users collection missing, skipping:", err);
    return;
  }

  const collection = new Collection({
    name: "radio_favorites",
    type: "base",
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: '@request.auth.id != "" && user = @request.auth.id',
    updateRule: null,
    deleteRule: "user = @request.auth.id",
    indexes: [
      "CREATE UNIQUE INDEX idx_radio_favorites_user_station ON radio_favorites (user, station_id)",
      "CREATE INDEX idx_radio_favorites_added ON radio_favorites (added)",
    ],
    schema: [
      {
        name: "user",
        type: "relation",
        required: true,
        options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      },
      {
        name: "station_id",
        type: "text",
        required: true,
        options: { min: 36, max: 36, pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
      },
      { name: "name", type: "text", required: true, options: { max: 200 } },
      { name: "url", type: "text", required: false, options: { max: 2000 } },
      { name: "favicon", type: "text", required: false, options: { max: 500 } },
      { name: "added", type: "date", required: true, options: {} },
    ],
  });
  try {
    dao.saveCollection(collection);
    console.log("[ensure_radio_favorites] created radio_favorites");
  } catch (err) {
    console.warn("[ensure_radio_favorites] could not create radio_favorites: " + err);
  }
});
