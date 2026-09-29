# Validation record

Validation date: 29 September 2026. Local host: macOS, Node.js 20.20.2. Tests use generated labels and synthetic inventory, not real departmental records.

## Software evidence

- `npm test`: 18 focused tests passed. Coverage includes atomic duplicates, edit revisions, backup validation/merge conflicts, consistent export/restore size limits, original identifiers, CSV quoting/formula defense, and image geometry.
- `npm run build`: TypeScript and production build passed. App and OCR/barcode runtimes are self-hosted; the precache is approximately 8.4 MB.
- Browser projects: installed Google Chrome 154.0.8037.58 desktop; Chromium with a Pixel 7 viewport; Playwright WebKit 26.6 with an iPhone 13 viewport. These are desktop browser engines/emulation, not phones.
- Final integrated suite: **60 browser checks passed, 3 WebKit cases skipped**, across the three projects (63 total cases). Skips are the synthetic camera stream, failed-install interception and true-offline cache-repair cases. The repository's CI runs the same suite before publishing.
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

Published app: https://yonvisell.github.io/ucsb-surplus-scanner/ . Source: https://github.com/yonvisell/ucsb-surplus-scanner . No inventory or photos are committed to the repository.

GitHub Actions [run 36636610307](https://github.com/yonvisell/ucsb-surplus-scanner/actions/runs/36636610307) passed the build, 18 unit tests and 60 browser checks (3 documented WebKit skips), then deployed code from commit `94cefec0d9b651ac272fb66e20763421f96af511`.

Public HTTPS validation completed at 2026-09-29 22:00:45 UTC in a fresh Chrome 154.0.8037.58 profile:

| Check | Result |
| --- | --- |
| All 18 published asset hashes | Matched the release manifest |
| Active service-worker control | Confirmed |
| Code 128 photo capture | Read the generated test serial correctly |
| Saved record after network-disabled reload | Retained |
| CSV export and JSON backup while offline | Both retained the saved serial |
| Local OCR while offline | Read `A12345` from a generated image |
| Cross-origin processing requests / page errors | None observed |

Verified release digest: `8bff2740c776a96256bcad4be2b6ad780229b99197cd9f360a1f602c7a80ccc8`. Test records existed only in a disposable browser profile.

The first Linux CI run correctly reported no attached camera where a test had assumed permission denial. The test now injects `NotAllowedError` and `NotFoundError` separately and verifies photo fallback after each. Application behavior did not need to change.

## Whole-label correction and compact interface — 29 September 2026

A field report exposed a gap in the original synthetic tests: successfully decoding a QR code did not establish that its payload was a serial number, and the separate OCR token picker did not extract equipment details. The supplied equipment photo was reproduced locally; it and its actual identifiers are excluded from the repository.

Capture now reads printed text and codes together, proposes explicitly labeled fields, and retains MO/MTM as separate evidence. A narrowly constrained Lenovo concatenation check requires manufacturer, a printed MO, a matching QR suffix, and independent printed agreement for the remaining serial. Conflicting serial candidates remain unresolved. Unclassified codes are never selected automatically. Grayscale normalization and automatic text layout replace the uniform-block OCR assumption. Recognition first uses grayscale. If no serial evidence was found, a bounded second pass uses the original colors; conflicting serials are never resolved by discarding a reading. No remote recognition service was added.

Validation for this revision:

- 48 unit tests passed, including 30 field-parser cases covering MO/MTM exclusion, conflicting serials, URL/untyped codes, multiline labels, damaged heading punctuation, and QR corroboration constraints.
- 66 browser checks passed across desktop Chromium, Android-size Chromium and iPhone-size WebKit; the same three documented WebKit limitations remain skipped.
- Synthetic full-label photographs exercise manufacturer, model, serial, inferred equipment type, order/product separation and preservation of original evidence in all three projects. A metadata-only label with a URL QR leaves an existing serial unchanged.
- The privately supplied photo produced the correct serial, manufacturer, model and Laptop suggestion through the actual review/apply interface in Chromium and WebKit. Some non-serial OCR characters remain ambiguous; all suggestions still require review.
- Camera streams stop before full-label analysis; a manual shutter also supports labels with no readable barcode. Photo/keyboard/manual fallbacks remain available. These are software checks, not physical phone camera qualification.
- Updated narrow-screen and enlarged-text containment/accessibility checks passed. Mobile main form, capture review and five-step reference were visually inspected. Mobile text fields retain 16 px text to avoid focus zoom; surrounding text and controls use a smaller, consistent scale.
- Private-photo processing generated no cross-origin requests or browser errors. Public tests use generated labels only.

The interface removes the redundant save-location footer and generic form instructions, reduces padding/type variation, keeps capture evidence inside optional details, and replaces the long default reference with five steps tied to named controls. Existing inventory/backup schemas are unchanged.

Camera-resolution stress checks used the private photo as a synthetic video source at widths 1280 and 1920. The retry recovered the correct serial and manufacturer at both sizes. The model was correct at 1280; the 1920 reading still contained punctuation/I-versus-1 ambiguity and required manual correction. The full-size photo remained correct. This is a concrete limitation of local OCR, not evidence of physical-camera qualification. A separate synthetic camera label with no barcode passed the manual Read this label action.

The first Linux run for this revision revealed OS-font-dependent synthetic OCR images and overflow at 200% text enlargement. Label regression images now use fixed synthetic pixels; status/navigation text can wrap within their cells. No user photograph or identifier is included in these fixtures.
