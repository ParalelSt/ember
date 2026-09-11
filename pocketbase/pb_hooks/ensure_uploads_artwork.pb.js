/// <reference path="../pb_data/types.d.ts" />

// Cover art for member uploads.
//
// Most files people upload already carry a cover in their tag, so the upload
// route pulls the first embedded picture out and writes it beside the audio as
// MUSIC_DIR/uploads/<record id>.<jpg|png>. This field records which extension
// was written; empty (or absent) means the file had no usable cover.
//
// Stored as the extension rather than a bool so the art route knows the
// content type without sniffing the file. Uploads created before this existed
// have no value, which reads as "no artwork" everywhere, so they keep working
// exactly as they did.
//
// Added on boot if missing, same pattern as ensure_privacy_fields.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let uploads;
  try {
    uploads = dao.findCollectionByNameOrId("uploads");
  } catch (err) {
    // ensure_uploads creates the collection with this field absent too, and
    // hook order is not guaranteed, so a missing collection here just means
    // the next boot will add it.
    console.log("[ensure_uploads_artwork] uploads collection missing, skipping:", err);
    return;
  }

  if (uploads.schema.getFieldByName("artwork_ext")) return;

  uploads.schema.addField(
    new SchemaField({
      name: "artwork_ext",
      type: "text",
      required: false,
      options: { max: 4 },
    }),
  );

  dao.saveCollection(uploads);
  console.log("[ensure_uploads_artwork] added artwork_ext to uploads");
});
