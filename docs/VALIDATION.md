# Validation record

Validation date: 29 September 2026. Local host: macOS, Node.js 20.20.2. Tests use generated labels and synthetic inventory, not real departmental records.

## Software evidence

- `npm test`: 18 focused tests passed. Coverage includes atomic duplicates, edit revisions, backup validation/merge conflicts, consistent export/restore size limits, original identifiers, CSV quoting/formula defense, and image geometry.
- `npm run build`: TypeScript and production build passed. App and OCR/barcode runtimes are self-hosted; the precache is approximately 8.4 MB.
- Browser projects: installed Google Chrome 154.0.8037.58 desktop; Chromium with a Pixel 7 viewport; Playwright WebKit 26.6 with an iPhone 13 viewport. These are desktop browser engines/emulation, not phones.
- Final integrated suite: **57 browser checks passed, 3 WebKit cases skipped**, across the three projects (60 total cases). Skips are the synthetic camera stream, failed-install interception and true-offline cache-repair cases. The repository's CI runs the same suite before publishing.
- Barcode photo fixtures: Code 128, Code 39, QR, Data Matrix, EAN-13, UPC-A. UPC-A can be returned as EAN-13 with a leading zero; the UI warns that product codes generally do not identify an individual item.
- Local OCR read a generated serial and passed candidate selection. Chromium also read it with the network disabled after offline preparation. Request checks found no cross-origin processing requests.
- Save/edit/delete/undo, batch defaults, draft reload, quantity grouping, wipe verification fields, CSV download, JSON restore into another browser profile, duplicate rejection, stale concurrent edits, and post-commit refresh failure were exercised.
- Failure injection: denied camera, blocked IndexedDB open, failed writes, failed cache installation, failed cache repair, and missing capture code. Current entries remain available where the page/storage is usable; no unsuccessful write is reported as saved.
- Responsive checks: narrow 320-pixel viewport and 200% text enlargement; no page overflow. Axe checks for WCAG 2 A/AA and WCAG 2.1 AA passed on the main capture surface. Desktop/mobile capture, inventory, and quick-reference screenshots were visually reviewed. This is not a full accessibility certification.

## WebKit test limitation

Playwright WebKit's network-offline toggle produced an internal navigation error on both this application and a minimal independent service-worker page. WebKit evidence therefore covers complete cache staging, normal reload persistence, local barcode/OCR, and the ordinary workflows. It does **not** qualify a true offline Safari reload. The failed-repair and failed-installation interception cases run in Chromium only. The synthetic live-camera stream runs in Chromium only.

## Reproduce

```sh
npm ci
npm test
npm run build
npx playwright install webkit
npm run test:e2e
```

Local tests use installed Google Chrome. For bundled Chromium, install it and run with `CI=1`. The test runner starts the production preview when necessary. GitHub Actions installs Chromium and WebKit with the required OS dependencies and runs the same suite before deploying `dist/`.

## Physical checks still required

On a real iPhone/iPad and Android phone: confirm camera permission/recovery, autofocus on small/reflective labels, torch where available, long-session responsiveness, photo orientation/HEIC support, home-screen installation/lifecycle, offline reopening, download/share behavior, and an actual USB/Bluetooth scanner. Repeat with a representative departmental label collection. Browser persistence permission does not replace a downloaded backup.

## Publication

Target: https://yonvisell.github.io/ucsb-surplus-scanner/ from https://github.com/yonvisell/ucsb-surplus-scanner . Public-origin checks are recorded below after deployment completes. No inventory or photos are committed to the repository.
