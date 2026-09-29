import { copyFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(projectRoot, "public", "vendor");
const files = [
  ["zxing-wasm/dist/reader/zxing_reader.wasm", "zxing_reader.wasm"],
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  [
    "tesseract.js-core/tesseract-core-lstm.wasm.js",
    "tesseract-core-lstm.wasm.js",
  ],
  [
    "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    "eng.traineddata.gz",
  ],
];

await mkdir(output, { recursive: true });
let totalBytes = 0;
for (const [source, filename] of files) {
  const sourcePath = join(projectRoot, "node_modules", source);
  const destination = join(output, filename);
  await copyFile(sourcePath, destination);
  const { size } = await stat(destination);
  totalBytes += size;
  console.log(`${filename}: ${(size / 1024 / 1024).toFixed(2)} MiB`);
}
console.log(`Vendor assets: ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);

// Distribute the upstream notices with the self-hosted runtimes.
for (const [source, filename] of [
  ["zxing-wasm/LICENSE", "ZXING-WASM-LICENSE.txt"],
  ["tesseract.js/LICENSE.md", "TESSERACT-JS-LICENSE.txt"],
  ["tesseract.js-core/LICENSE", "TESSERACT-CORE-LICENSE.txt"],
]) {
  await copyFile(
    join(projectRoot, "node_modules", source),
    join(output, filename),
  );
}
