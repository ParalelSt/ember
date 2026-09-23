# 07. Search always showed an empty "Trending" section

**What you'd notice:** opening Search before typing anything showed a "Trending" heading with "No tracks" underneath, every time, even though the server has a real trending chart to show there.

**Why it happened:** the search box only asked the server for results once you'd typed something. With nothing typed, it never asked at all, so "Trending" was just a label with nothing behind it.

**What changed:** Search now asks the server even with an empty box; the server already knows to answer that with the trending chart. Files: `apps/web/hooks/useSearchQuery.ts` (the fetch is no longer gated on having typed something).

**Compare:** before = `9d0dad2`, after = `cdcc61b`.
- Test: `npx vitest run hooks/useSearchQuery.test.tsx "app/(app)/search/page.test.tsx"`: new cases `[bughunt W07] fetches with an empty query too...` and `[bughunt W07] shows real tracks under Trending...` fail before (the hook never called the API for an empty query), pass after: `Test Files 2 passed (2)`, part of full suite `Tests 2750 passed (2750)`.
- Screenshots: `shots/07-before.png` (Trending / "No tracks", with the server response for the empty query mocked to prove real data was available and still not shown) vs `shots/07-after.png` (same mocked data, now rendered as three tracks under Trending).
- Try it yourself: open Search without typing anything — you should see real tracks under "Trending" (network permitting).
**Risk:** low, one query's enabled condition.
