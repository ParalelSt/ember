# jsQR (vendored)

QR decoder for the in-app scanner's fallback (lib/qrScan/decoder.ts), used
where the browser has no BarcodeDetector (iOS WKWebView, Safari, Firefox).

- Source: https://github.com/cozmo/jsQR, src/ at 1.4.0 (commit 8e6a036, the
  last upstream commit). Apache-2.0, see LICENSE.
- Not an npm dependency on purpose: vendoring keeps package-lock untouched.

Ember changes:
- The Shift JIS table (126 KB) is left out; Kanji mode reads as U+FFFD.
- Options are merged into a fresh object per call (upstream mutated the
  shared defaults, so one call's options leaked into the next).
- Strict-mode types (nullable returns, non-null asserts), no `any`.
- Tests (and their PNG fixtures) are left out; lib/qrScan/decoder.test.ts
  round-trips our own encoder (lib/qr.ts) through this decoder instead.
