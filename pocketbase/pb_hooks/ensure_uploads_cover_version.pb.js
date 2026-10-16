/// <reference path="../pb_data/types.d.ts" />

// Cover version for member uploads.
//
// Settings > Uploads lets the uploader set or remove a song's cover by hand
// (POST/DELETE /api/uploads/<id>/cover). The art route caches a cover for a
// year under its URL, so each change bumps this number and the cover URL
// carries it (`/api/uploads/<id>/art?v=<n>`): a new URL is a fresh fetch.
// Zero or absent means "never changed by hand", which keeps the old URL, so
// existing uploads look and cache exactly as before.
//
// Added on boot if missing, same pattern as ensure_uploads_artwork. Nothing
// is removed or rewritten.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let uploads;
  try {
    uploads = dao.findCollectionByNameOrId("uploads");
  } catch (err) {
    // ensure_uploads creates the collection, and hook order is not
    // guaranteed: the next boot adds the field.
    console.log("[ensure_uploads_cover_version] uploads collection missing, skipping:", err);
    return;
  }

  if (uploads.schema.getFieldByName("artwork_v")) return;

  uploads.schema.addField(
    new SchemaField({
      name: "artwork_v",
      type: "number",
      required: false,
      options: { min: 0 },
    }),
  );

  // A failed save must not stop PocketBase from booting: warn and carry on,
  // same as ensure_superuser (bughunt X11).
  try {
    dao.saveCollection(uploads);
    console.log("[ensure_uploads_cover_version] added artwork_v to uploads");
  } catch (err) {
    console.warn("[ensure_uploads_cover_version] could not save the uploads collection: " + err);
  }
});
