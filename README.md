# UCSB Surplus Scanner

[Open the app](https://yonvisell.github.io/ucsb-surplus-scanner/) · [Source repository](https://github.com/yonvisell/ucsb-surplus-scanner)

A local-first tool for recording departmental IT equipment and preparing a surplus handoff. It does not submit UCSB forms, determine asset classification, approve disposal, or certify data sanitization.

## Quick use

1. Open the app while online. Select a batch or create one, then use **Batch details** to set its department and location.
2. Choose **Scan with camera** and include the printed label, or choose **Label photo → Read full label**. Review the serial, manufacturer, model and suggested equipment type; choose **Use label details**. Codes and text are read together. MO (order) and MTM (product) remain separate from the serial. Unclassified barcodes are never selected automatically. You can also enter the serial number. Record the UCSB asset number separately and set its tag status to **Tag found**, **No tag found**, or **Not checked**. Review every scan; prefixes and leading zeroes can be part of an identifier.
3. Check the equipment type, manufacturer and model; supply a useful description when the label does not provide one. Quantity above one is for items with no serial number and no UCSB asset number. Check storage status and add handling notes when needed.
4. Save the entry. Saved records stay on this device in the current browser. Use the review flags to find incomplete entries; they do not determine disposal approval.
5. Export the batch as CSV for review. Download a JSON backup of all batches for archival or transfer to another device.

For the campus handoff, follow [UCSB disposal and recycling guidance](docs/UCSB-GUIDANCE.md). The app does not replace the EIMR, Surplus Sales, Furniture Services, or EH&S processes.

## Offline and data handling

Open the deployed app online and wait for **Offline ready** before relying on it without a connection. Use **Check offline files** if needed. Equipment records are stored in this browser's IndexedDB; an unfinished entry is kept in session storage. Browser storage can be cleared or evicted, and separate browsers/devices have separate records. Download backups regularly and keep them in an approved department location.

Camera scanning, photo reading, and OCR run locally. When the first reading finds no serial, the app retries the original colors once. Recognition can still miss or substitute characters, especially on small or worn print: the review form is editable, and blank suggestions leave existing values unchanged. Full-label readings retain the text and decoded codes in the capture history. The app does not open QR links or query manufacturer databases. Equipment type is inferred only for recognized laptop model families; it is a suggestion to review. Inventory and images are not uploaded by the app. The public site still requires ordinary web requests to load or update its files.

CSV is for review and reporting. Excel or Sheets may remove leading zeroes or convert identifier values; import those columns as text. JSON preserves the saved identifiers and original capture readings for restoration. Restore merges records without overwriting: identical records count as skipped; changed records, duplicate identifiers, and batch-ID conflicts count as conflicts and remain unchanged. Assets are restored only when their batch exists locally or in the backup.

## Development

Requires Node.js 20.19+ or 22.12+. The deployment workflow uses Node.js 22.

```sh
npm ci
npm run dev
```

Other project commands:

```sh
npm test             # Vitest unit tests
npm run build        # TypeScript check, Vite build, and offline service-worker generation
npm run preview      # Preview the built app locally
npm run vendor       # Copy the local barcode/OCR runtime assets into public/vendor
npm run test:e2e     # Desktop Chrome, Android viewport, and WebKit iPhone viewport
```

Install browser engines with `npx playwright install webkit` (local runs use installed Google Chrome) or `CI=1 npx playwright install chromium webkit` for bundled engines. Run `npm run build` before `npm run preview`. Playwright starts the preview automatically when none is running. Test offline behavior against the built preview; the development server does not establish production service-worker behavior. `npm run vendor` is needed when the packaged runtime assets are missing or need refresh after dependency changes.

## Deployment

The repository is [`yonvisell/ucsb-surplus-scanner`](https://github.com/yonvisell/ucsb-surplus-scanner). Vite uses the GitHub Pages project path `/ucsb-surplus-scanner/`; the static output is `dist/`.

`.github/workflows/pages.yml` runs the unit suite, production build, and browser tests before publishing `dist/` to GitHub Pages. Pushes to `main` run this workflow. The repository's Pages source must be **GitHub Actions**. The application needs no runtime server, account, API key, or Google authorization. Google Sheets users import the CSV; direct synchronization is not configured.

## Permissions and recovery

- Camera access is requested only after a camera action. If blocked or unavailable, use **Label photo**, **USB / Bluetooth**, or type the serial. Torch is offered only when the selected camera reports support.
- Opening the HTTPS page is sufficient; home-screen installation and persistent-storage permission are optional. The app does not request notification, location, microphone, or broad filesystem access.
- IndexedDB must be available to save inventory. A blocked or full store produces an error and keeps the current entry visible. Ordinary file downloads and file pickers handle export/restore; no folder-access API is required.
- An offline first visit cannot work. Wait for **Offline ready** during the first online visit. Camera denial does not block photo, scanner or manual entry.
- Restore accepts up to 10 MB and 20,000 batches/items per file. Export checks the same limits. For a larger collection, the tools offer individual batch backups; a single oversized batch can still be retained as CSV for external recovery. Keep the original backup when restore reports conflicts; it is never overwritten.
- A phone's home-screen app and browser tab may have separate inventories. Use a JSON backup to transfer between them. Private browsing and clearing website data can discard local data.

## Qualification boundary

Desktop browser tests and emulated phone layouts do not qualify physical iPhone or Android cameras, focus, torch, home-screen lifecycle, file sharing, or offline persistence. See [validation status and checks](docs/VALIDATION.md); physical-device qualification remains pending.

Bundled runtime attribution is in [Third-party runtimes](docs/THIRD-PARTY.md).
