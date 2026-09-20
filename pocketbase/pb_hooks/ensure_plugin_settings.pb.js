/// <reference path="../pb_data/types.d.ts" />

// Plugin switches (Settings > Plugins), per user so they follow the account
// across devices:
//
//   plugins  (json)  e.g. { "partyVolume": false, "tabsEnabled": true }
//
// One JSON field rather than a column per plugin, so a new plugin needs no
// schema change. A key that is missing means "never saved": the web app then
// writes that device's local value up (apps/web/stores/useSettingsStore.ts).
// Only the owner reads or writes it: the users collection's view and update
// rules are already "id = @request.auth.id".
//
// Added on boot if missing, same pattern as ensure_changelog_fields.pb.js.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let users;
  try {
    users = dao.findCollectionByNameOrId("users");
  } catch (err) {
    console.log("[ensure_plugin_settings] users collection missing, skipping:", err);
    return;
  }

  if (users.schema.getFieldByName("plugins")) return;

  users.schema.addField(
    new SchemaField({
      name: "plugins",
      type: "json",
      required: false,
      options: { maxSize: 20000 },
    }),
  );
  dao.saveCollection(users);
  console.log("[ensure_plugin_settings] added the plugins field to users");
});
