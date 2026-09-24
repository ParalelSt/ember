/// <reference path="../pb_data/types.d.ts" />

// Two fields on `likes`, for songs brought in from another platform
// (docs/superpowers plan "Transfer", section 2.2):
//
//   liked_at  (date)    when the song was liked. PocketBase's own `created`
//                       cannot be set through the API, so a transfer could
//                       never place an imported like anywhere but on top of
//                       the list. With an explicit date the server decides
//                       the order: imported likes are dated below every real
//                       like the person already had, in source order.
//   origin    (select)  `user` for a like made by pressing the heart in
//                       Ember, `import` for one a transfer created. Mixes
//                       weigh an imported like half (lib/mixes/likeWeight).
//
// Existing rows are backfilled once: liked_at = created, origin = user. The
// backfill is driven off "liked_at is empty", so a boot that already ran it
// does nothing, and a boot interrupted half way finishes the rest.
//
// Added on boot if missing, same pattern as the other ensure_* hooks.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let likes;
  try {
    likes = dao.findCollectionByNameOrId("likes");
  } catch (err) {
    console.log("[ensure_likes_fields] likes collection missing, skipping:", err);
    return;
  }

  let added = 0;

  if (!likes.schema.getFieldByName("liked_at")) {
    likes.schema.addField(new SchemaField({ name: "liked_at", type: "date", required: false, options: {} }));
    added++;
  }

  if (!likes.schema.getFieldByName("origin")) {
    likes.schema.addField(
      new SchemaField({
        name: "origin",
        type: "select",
        required: false,
        options: { maxSelect: 1, values: ["user", "import"] },
      }),
    );
    added++;
  }

  // A failed save must not stop PocketBase from booting: warn and carry on,
  // same as ensure_superuser (bughunt X11).
  if (added) {
    try {
      dao.saveCollection(likes);
      console.log("[ensure_likes_fields] added " + added + " like field(s)");
    } catch (err) {
      console.warn("[ensure_likes_fields] could not save the likes collection: " + err);
    }
  }

  // Backfill in pages. The filter shrinks as rows are filled in, so every
  // page starts at offset 0; the round cap is only there so a row that
  // refuses to save can never spin the boot forever.
  let filled = 0;
  for (let round = 0; round < 2000; round++) {
    let rows;
    try {
      rows = dao.findRecordsByFilter("likes", 'liked_at = ""', "created", 500, 0);
    } catch (err) {
      console.log("[ensure_likes_fields] backfill query failed:", err);
      break;
    }
    if (!rows || rows.length === 0) break;
    let saved = 0;
    for (const row of rows) {
      row.set("liked_at", row.get("created"));
      if (!row.getString("origin")) row.set("origin", "user");
      try {
        dao.saveRecord(row);
        saved++;
      } catch (err) {
        console.log("[ensure_likes_fields] backfill skipped a row:", err);
      }
    }
    filled += saved;
    // Nothing moved: every remaining row refuses to save, so stop.
    if (saved === 0) break;
  }
  if (filled) console.log("[ensure_likes_fields] backfilled " + filled + " like(s)");
});
