/// <reference path="../pb_data/types.d.ts" />

// Adds artist_id + album_id columns to the tracks collection so the artist /
// album links can survive a PocketBase round-trip. Previously mapTrack.ts
// returned artistId: null for every row because the columns didn't exist.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("tracks");

  collection.schema.addField(new SchemaField({
    id: "tracksartistid",
    name: "artist_id",
    type: "text",
    required: false,
    presentable: false,
    unique: false,
    options: { max: 200 },
  }));

  collection.schema.addField(new SchemaField({
    id: "tracksalbumid",
    name: "album_id",
    type: "text",
    required: false,
    presentable: false,
    unique: false,
    options: { max: 200 },
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("tracks");
  collection.schema.removeField("tracksartistid");
  collection.schema.removeField("tracksalbumid");
  return dao.saveCollection(collection);
});
