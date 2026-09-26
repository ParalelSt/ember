// Shared by guard_filters.pb.js (PocketBase loads it with require) and the
// node tests (tests/pb-filter-guard.test.mjs). Plain CommonJS, no
// dependencies: PocketBase's JS engine runs it as it is.
//
// Why it exists: a list request's `filter` and `sort` may name fields of
// related records, and PocketBase does not apply the related collection's
// rules to those joins. Anyone signed in could list the shared catalog
// (`tracks`) with `filter=likes_via_track.user = "<someone>"` and get that
// person's likes and listening history back, or walk from a shared upload,
// tab or theme to its owner (`uploader.playlists_via_user.name ~ "a%"`) and
// read their private playlists one guess at a time. Nothing the app sends
// needs a join: every filter it builds names the collection's own fields.
// So a filter or sort from anyone but a superuser may not:
//
//   * use a back-relation (`<collection>_via_<field>`), or
//   * follow a relation with a dot (`user.name`, `track.title`).
//
// `@request.*` (the caller's own auth record and request data) stays
// allowed; `@collection.*` PocketBase already refuses to non-superusers.

/** The expression with every quoted string removed, or null when a quote
 *  is never closed (PocketBase would refuse it too; refusing here keeps an
 *  unclosed quote from hiding a path). Same escaping as PocketBase's own
 *  scanner: a backslash takes the next character with it. */
function stripStrings(expr) {
  let out = '';
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '"' || ch === "'") {
      i++;
      let closed = false;
      while (i < expr.length) {
        if (expr[i] === '\\') {
          i += 2;
          continue;
        }
        if (expr[i] === ch) {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (!closed) return null;
      out += ' "" ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Why this filter or sort is refused, or '' when it is fine. */
function unsafeQueryExpr(expr) {
  if (expr === undefined || expr === null) return '';
  const text = String(expr);
  if (text.trim() === '') return '';
  const bare = stripStrings(text);
  if (bare === null) return 'unclosed quote';
  if (/_via_/i.test(bare)) return 'back-relations are not allowed';
  // A dotted path that is not an @request/@collection macro: a field of a
  // related record. Anything glued to the left (a letter, a digit, a dot or
  // an @) means the dot belongs to a macro or a number.
  if (/(^|[^@\w.])[A-Za-z_]\w*\.[A-Za-z_]/.test(bare)) return 'related fields are not allowed';
  return '';
}

/** Why a realtime subscription topic (`<collection>/<id or *>?options=<json>`)
 *  is refused, or '' when it is fine. Its options carry a filter and sort
 *  that PocketBase checks each event against, the same oracle as a list.
 *  Every `options` value is checked, and one that cannot be read refuses. */
function unsafeSubscription(topic) {
  const s = String(topic || '');
  const q = s.indexOf('?');
  if (q < 0) return '';
  for (const part of s.slice(q + 1).split('&')) {
    const eq = part.indexOf('=');
    let key;
    try {
      key = decodeURIComponent((eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, ' '));
    } catch (_) {
      return 'unreadable options';
    }
    if (key !== 'options') continue;
    let opts;
    try {
      opts = JSON.parse(decodeURIComponent((eq < 0 ? '' : part.slice(eq + 1)).replace(/\+/g, ' ')));
    } catch (_) {
      return 'unreadable options';
    }
    const query = (opts && typeof opts === 'object' && opts.query) || {};
    const why = unsafeQueryExpr(query.filter) || unsafeQueryExpr(query.sort);
    if (why) return why;
  }
  return '';
}

module.exports = { stripStrings, unsafeQueryExpr, unsafeSubscription };
