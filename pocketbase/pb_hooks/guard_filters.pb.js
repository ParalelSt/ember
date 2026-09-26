/// <reference path="../pb_data/types.d.ts" />

// No joins in client filters (security audit 2026-09-25, finding S1).
//
// /pb is publicly proxied, and a list request's `filter` and `sort` may name
// fields of related records. PocketBase does not apply the related
// collection's rules to those joins, so any member could read another
// member's likes and listening history through the shared `tracks` catalog
// (`likes_via_track.user = "<id>"`), or their private playlist names, one
// guess at a time, through a shared upload, tab or theme
// (`uploader.playlists_via_user.name ~ "a%"`).
//
// The app never needs a join in a filter, so for everyone but a superuser
// (the server's own admin client) a filter or sort that uses a back-relation
// or a dotted related field is refused, on list requests and on realtime
// subscriptions alike. The check itself lives in lib/filterGuard.js so the
// node tests can run it too.

onRecordsListRequest((e) => {
  if ($apis.requestInfo(e.httpContext).admin) return;
  const guard = require(`${__hooks}/lib/filterGuard.js`);
  for (const key of ["filter", "sort"]) {
    const why = guard.unsafeQueryExpr(e.httpContext.queryParam(key));
    if (why) throw new BadRequestError("This " + key + " is not allowed: " + why + ".");
  }
});

onRealtimeBeforeSubscribeRequest((e) => {
  if ($apis.requestInfo(e.httpContext).admin) return;
  const guard = require(`${__hooks}/lib/filterGuard.js`);
  for (const topic of e.subscriptions || []) {
    const why = guard.unsafeSubscription(topic);
    if (why) throw new BadRequestError("This subscription is not allowed: " + why + ".");
  }
});
