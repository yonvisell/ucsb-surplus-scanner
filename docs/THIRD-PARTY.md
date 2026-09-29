# Third-party runtimes

The application loads these assets from its own origin, not from CDNs. Their upstream licenses remain applicable.

| Component | Purpose | Upstream / license |
| --- | --- | --- |
| zxing-wasm 3.1.4 | Barcode decoder and ZXing-C++ WebAssembly | https://github.com/Sec-ant/zxing-wasm (MIT wrapper); https://github.com/zxing-cpp/zxing-cpp (Apache-2.0 decoder) |
| Tesseract.js 7.0.0 | Local OCR worker | https://github.com/naptha/tesseract.js (Apache-2.0) |
| tesseract.js-core | Tesseract WebAssembly / Leptonica | https://github.com/naptha/tesseract.js-core (see packaged Apache-2.0 license and upstream notices) |
| @tesseract.js-data/eng 1.0.0 | English trained recognition data | https://github.com/naptha/tessdata (package MIT; Tesseract trained data source https://github.com/tesseract-ocr/tessdata) |

`npm run vendor` copies the installed runtime files and packaged license notices into `public/vendor/`. Dependency versions are recorded in `package-lock.json`. React, idb and Lucide provide the interface, storage wrapper and icons; their packaged notices remain in the dependencies/bundles. This project uses no UCSB seal or official institutional logo.
