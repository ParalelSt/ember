/// <reference path="../pb_data/types.d.ts" />

// Which look each device shows (apps/web/lib/uiMode.ts): "new" (the
// redesign) or "legacy" (the Classic look). Sent with the device's version
// note (POST /api/devices/seen); empty for a device that has not said yet,
// such as one still on an older web build. Same superuser-only rules as the
// rest of user_devices.
migrate((db) => {
  const dao = new Dao(db);
  const devices = dao.findCollectionByNameOrId("user_devices");
  devices.schema.addField(new SchemaField({
    id: "userdevuimode01",   // 15 lowercase alphanumeric, PB v0.22 quirk
    name: "ui_mode",
    type: "select",
    required: false,
    options: { maxSelect: 1, values: ["new", "legacy"] },
  }));
  return dao.saveCollection(devices);
}, (db) => {
  const dao = new Dao(db);
  const devices = dao.findCollectionByNameOrId("user_devices");
  devices.schema.removeField("userdevuimode01");
  return dao.saveCollection(devices);
});
