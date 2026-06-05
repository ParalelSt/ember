/// <reference path="../pb_data/types.d.ts" />

// Adds is_admin boolean to the users collection. PB super-admin toggles it
// via the admin UI; AuthProvider + server route guards check it for the
// admin dashboard.
migrate((db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId("users");
  users.schema.addField(new SchemaField({
    id: "usersisadmin01",   // 15 lowercase alphanumeric — PB v0.22 quirk
    name: "is_admin",
    type: "bool",
    required: false,
    options: {},
  }));
  return dao.saveCollection(users);
}, (db) => {
  const dao = new Dao(db);
  const users = dao.findCollectionByNameOrId("users");
  users.schema.removeField("usersisadmin01");
  return dao.saveCollection(users);
});
