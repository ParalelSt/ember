/// <reference path="../pb_data/types.d.ts" />

// Which versions each member runs, one row per member and device, for the
// admin Users page (apps/web/lib/versions/store.ts).
//
//   user           relation to users (the owner; deleted with them)
//   device_key     a random id the device made up for itself; means nothing
//                  outside this table
//   platform       android, ios, windows, macos, linux or browser
//   shell_version  the app shell's version; empty in a browser and on a phone
//                  app too old to say
//   web_version    the web build's version
//   last_seen      when it last checked in (at most every few hours)
//
// Security: /pb is publicly proxied, so these rules are the boundary. All of
// them are null (superuser only): a member's writes go through
// POST /api/devices/seen, which takes the member from the session and checks
// every value, and only GET /api/admin/users, for admins, reads it back.
migrate((db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId("users");
  const collection = new Collection({
    name: "user_devices",
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: ["CREATE UNIQUE INDEX idx_user_devices_user_key ON user_devices (user, device_key)"],
    schema: [
      {
        name: "user",
        type: "relation",
        required: true,
        options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      },
      {
        name: "device_key",
        type: "text",
        required: true,
        options: { min: 8, max: 64, pattern: "^[A-Za-z0-9_-]+$" },
      },
      {
        name: "platform",
        type: "select",
        required: true,
        options: { maxSelect: 1, values: ["android", "ios", "windows", "macos", "linux", "browser"] },
      },
      { name: "shell_version", type: "text", required: false, options: { max: 40 } },
      { name: "web_version", type: "text", required: false, options: { max: 40 } },
      { name: "last_seen", type: "date", required: true, options: {} },
    ],
  });
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  return dao.deleteCollection(dao.findCollectionByNameOrId("user_devices"));
});
