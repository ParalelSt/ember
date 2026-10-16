/// <reference path="../pb_data/types.d.ts" />

// artist_genres: the genre family of each artist Ember has looked at, for
// the genre mixes (docs/mixes.md). One row per artist, shared by every
// member (an artist's genre is the same whoever plays them).
//
//   artist_key  normalized first artist name (apps/web/lib/genres/artistKey.ts)
//   artist_id   YouTube channel id, when known
//   name        display name as last seen
//   family      primary family slug (lib/genres/taxonomy.ts), "" when unknown
//   families    { slug: weight } of the primary and the secondary families
//   sub         the heavier half of the primary family ("rock", "metal",
//               "hiphop", "rnb"), "" when it has none or the tags do not say
//   tags        the raw top tags with their counts, for debugging and re-mapping
//   source      lastfm, musicbrainz, chart (a weak prior from a genre chart)
//               or manual (an admin's override, never replaced)
//   status      found or none (looked up, nothing mappable)
//   fetched_at  ISO time of the last lookup ("" for a chart prior never
//               looked up); none is retried after 30 days, found refreshed
//               after 180
//
// Admin only (every rule null): the web app reads and writes it with the
// admin client, like tab_lookups.

onAfterBootstrap((e) => {
  const dao = $app.dao();
  let existing = null;
  try {
    existing = dao.findCollectionByNameOrId("artist_genres");
  } catch (_) {
    existing = null;
  }
  if (existing) return;
  try {
    dao.saveCollection(new Collection({
      name: "artist_genres",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: [
        "CREATE UNIQUE INDEX idx_artist_genres_key ON artist_genres (artist_key)",
        "CREATE INDEX idx_artist_genres_family ON artist_genres (family)",
      ],
      schema: [
        { name: "artist_key", type: "text", required: true, options: { max: 200 } },
        { name: "artist_id", type: "text", options: { max: 60 } },
        { name: "name", type: "text", options: { max: 200 } },
        { name: "family", type: "text", options: { max: 40 } },
        { name: "families", type: "json", options: { maxSize: 2000 } },
        { name: "sub", type: "text", options: { max: 20 } },
        { name: "tags", type: "json", options: { maxSize: 20000 } },
        { name: "source", type: "select", required: true, options: { maxSelect: 1, values: ["lastfm", "musicbrainz", "chart", "manual"] } },
        { name: "status", type: "select", required: true, options: { maxSelect: 1, values: ["found", "none"] } },
        { name: "fetched_at", type: "text", options: { max: 40 } },
      ],
    }));
    console.log("[ensure_artist_genres] created artist_genres");
  } catch (err) {
    // Never stop PocketBase from booting over this.
    console.warn("[ensure_artist_genres] could not create artist_genres: " + err);
  }
});
