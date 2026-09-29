# Implementation plan

Mobile-first, local-only inventory capture for departmental IT. Static React/TypeScript app deployed under a GitHub Pages project path. No account, cloud OCR, tracking, external fonts, spreadsheet credential, or public inventory data.

## Slices
1. **Capture and keep:** batches with persistent defaults; labeled manual and keyboard-scanner inputs; item review; atomic IndexedDB writes; duplicates checked within a batch in the write transaction; optimistic edit revisions; editable queue; recoverable delete; CSV and lossless JSON backup/merge restore.
2. **Read labels:** shared self-hosted ZXing WASM for camera and still photos; stop camera during review and when hidden; multiple barcode chooser; original capture retained; explicit text extraction via local Tesseract; crop/rotate photos; every result reviewed. Never infer serial by stripping S/1S or UPC prefixes.
3. **Offline and resilience:** app-scoped versioned service worker, local model assets, explicit preparation status, no destructive cache upgrade, storage failure states, safe export, visible draft state. No claim of permanent browser storage. Desktop keyboard scanner works without camera.
4. **Verify and publish:** realistic browser tests in Chromium and WebKit with mobile viewports; generated barcode/OCR fixtures; offline reload, file import/export, duplicate/edit race, denial and storage errors, accessibility and responsive checks. Create public repository and Pages deployment; verify public app and offline assets.

## Product decisions
- Staff review an identifier before saving; saving prepares the next item with batch defaults. No automatic burst commit of noisy barcodes.
- Missing/unreadable labels permitted with a useful description; quantity only for untagged/unserialized items.
- Asset tag presence is separate from legal inventory classification. No price threshold determines disposal route.
- Drive state starts unknown, never wiped by default. Verified wiping records verifier and method/reference; the app does not certify a wipe.
- CSV works with Excel/Sheets; JSON is the exact archival format and enables device transfer. Direct Sheets synchronization deferred: a public unauthenticated webhook is inappropriate and OAuth ownership is a department deployment decision.
- Guidance links lead to official EIMR/Surplus/EH&S processes; the app itself never authorizes disposal.

## Failure coverage
Incorrect label selection, multiple labels, repeated video frames, vendor prefixes, O/0/I/1 ambiguity, leading zeros, damaged labels, camera permission/device loss, backgrounding, unsupported torch, huge/unsupported photos, OCR timeout, offline first visit, stale service worker, quota/security failures, concurrent tabs, malformed or hostile backup, duplicate backup restore, spreadsheet formula injection, user cancellation, narrow screens and text zoom.

## Qualification boundary
Desktop automation with emulated mobile viewports and WebKit provides software evidence, not physical iPhone/Android camera, torch, focus, thermal, home-screen lifecycle or sharing qualification. Record remaining device checks explicitly.

## Field-report correction

Read whole equipment labels rather than assuming the first decoded code is a serial. Combine local text and barcode evidence; distinguish serial, order and product identifiers; propose manufacturer/model and a conservative equipment-type suggestion; preserve blank/current fields. Verify the reported photo privately and publish only synthetic regressions. Simplify the form and quick reference around the capture/review/save/export operations. Keep the existing storage schema and verify the deployed update retains saved records.
