/// <reference path="../pb_data/types.d.ts" />

// Adds an optional `artwork` image file field to the playlists collection so
// users can upload a custom cover.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("playlists");

  collection.schema.addField(new SchemaField({
    id: "plartwk001uniq",
    name: "artwork",
    type: "file",
    required: false,
    presentable: false,
    unique: false,
    options: {
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      thumbs: ["256x256", "512x512"],
      maxSelect: 1,
      maxSize: 5_242_880, // 5 MB
      protected: false,
    },
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("playlists");
  collection.schema.removeField("plartwk001uniq");
  return dao.saveCollection(collection);
});
