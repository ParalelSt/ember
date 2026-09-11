/// <reference path="../pb_data/types.d.ts" />

// Unavailable-song flag: two fields on the shared `tracks` row:
//
//   unavailable_at      → when the server last confirmed yt-dlp can't play it
//   unavailable_reason  → why (removed / private / geo / members / terminated
//                          / unavailable), see lib/sources/youtube.ts
//
// The flag lives on the track, not on a per-user or per-playlist row, because
// availability is a property of the SONG on YouTube, not of who's looking at
// it: one server-side detection (a stream attempt) serves every playlist that
// track is in and every member who can see it. Duplicating the check per
// listener would be both slower and inconsistent (one listener's play could
// mark it dead while another's list still shows it healthy).
//
// Only the server ever writes these fields (via the admin client in
// lib/trackAvailability.ts): a client-writable flag would let anyone hide a
// song from everyone else, so there is no user-facing rule granting write
// access to it.
//
// Added on boot if missing, same pattern as the other ensure_* hooks.

onAfterBootstrap((e) => {
  const dao = $app.dao();

  let tracks;
  try {
    tracks = dao.findCollectionByNameOrId("tracks");
  } catch (err) {
    console.log("[ensure_track_availability] tracks collection missing, skipping:", err);
    return;
  }

  let added = 0;

  if (!tracks.schema.getFieldByName("unavailable_at")) {
    tracks.schema.addField(
      new SchemaField({
        name: "unavailable_at",
        type: "date",
        required: false,
        options: {},
      }),
    );
    added++;
  }

  if (!tracks.schema.getFieldByName("unavailable_reason")) {
    tracks.schema.addField(
      new SchemaField({
        name: "unavailable_reason",
        type: "text",
        required: false,
        options: { max: 60 },
      }),
    );
    added++;
  }

  if (added === 0) return;

  dao.saveCollection(tracks);
  console.log("[ensure_track_availability] added " + added + " field(s)");
});
