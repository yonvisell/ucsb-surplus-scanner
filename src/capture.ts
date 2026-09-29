import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

export type DecodedLabel = { value: string; format: string };
export type NormalizedCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const BARCODE_FORMATS = [
  "Code128",
  "Code39",
  "QRCode",
  "DataMatrix",
  "EAN13",
  "EAN8",
  "UPCA",
  "UPCE",
] as const;
const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_PHOTO_SIDE = 2500;
const MAX_CAMERA_SIDE = 1600;
const SCAN_INTERVAL_MS = 200;
const OCR_TIMEOUT_MS = 60_000;

function vendorUrl(filename: string): string {
  return new URL(
    `${import.meta.env.BASE_URL}vendor/${filename}`,
    location.origin,
  ).href;
}

prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) =>
      path.endsWith(".wasm") ? vendorUrl("zxing_reader.wasm") : prefix + path,
  },
});

export function scaledDimensions(
  width: number,
  height: number,
  maximumSide: number,
): { width: number; height: number } {
  if (
    ![width, height, maximumSide].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    maximumSide < 1
  ) {
    throw new Error("Invalid image dimensions.");
  }
  if (width * height > MAX_IMAGE_PIXELS)
    throw new Error("Image dimensions exceed the 50-megapixel limit.");
  const scale = Math.min(1, maximumSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvas2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable on this device.");
  return context;
}

export async function photoToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  if (!file.size || file.size > MAX_PHOTO_BYTES)
    throw new Error("Image file must be between 1 byte and 30 MB.");
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("The image cannot be opened by this browser."));
      image.src = objectUrl;
    });
    const dimensions = scaledDimensions(
      image.naturalWidth,
      image.naturalHeight,
      MAX_PHOTO_SIDE,
    );
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas2d(canvas);
    // Transparent barcode PNGs otherwise become black pixels in the decoder.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = "";
    URL.revokeObjectURL(objectUrl);
  }
}

export function rotateCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  if (!canvas.width || !canvas.height)
    throw new Error("Cannot rotate an empty image.");
  const rotated = document.createElement("canvas");
  rotated.width = canvas.height;
  rotated.height = canvas.width;
  const context = canvas2d(rotated);
  context.translate(rotated.width, 0);
  context.rotate(Math.PI / 2);
  context.drawImage(canvas, 0, 0);
  return rotated;
}

export function cropPixels(
  imageWidth: number,
  imageHeight: number,
  crop: NormalizedCrop,
): { x: number; y: number; width: number; height: number } {
  if (
    ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1 + 1e-9 ||
    crop.y + crop.height > 1 + 1e-9
  ) {
    throw new Error("Crop must be a nonempty rectangle within the image.");
  }
  scaledDimensions(imageWidth, imageHeight, Math.max(imageWidth, imageHeight));
  const x = Math.min(imageWidth - 1, Math.floor(crop.x * imageWidth));
  const y = Math.min(imageHeight - 1, Math.floor(crop.y * imageHeight));
  const right = Math.min(
    imageWidth,
    Math.ceil((crop.x + crop.width) * imageWidth),
  );
  const bottom = Math.min(
    imageHeight,
    Math.ceil((crop.y + crop.height) * imageHeight),
  );
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

export function cropCanvas(
  canvas: HTMLCanvasElement,
  crop: NormalizedCrop,
): HTMLCanvasElement {
  const rectangle = cropPixels(canvas.width, canvas.height, crop);
  const result = document.createElement("canvas");
  result.width = rectangle.width;
  result.height = rectangle.height;
  canvas2d(result).drawImage(
    canvas,
    rectangle.x,
    rectangle.y,
    rectangle.width,
    rectangle.height,
    0,
    0,
    rectangle.width,
    rectangle.height,
  );
  return result;
}

function boundedImageData(source: ImageData): ImageData {
  const size = scaledDimensions(source.width, source.height, MAX_PHOTO_SIDE);
  if (size.width === source.width && size.height === source.height)
    return flattenTransparency(source);
  const original = document.createElement("canvas");
  original.width = source.width;
  original.height = source.height;
  canvas2d(original).putImageData(source, 0, 0);
  const bounded = document.createElement("canvas");
  bounded.width = size.width;
  bounded.height = size.height;
  canvas2d(bounded).drawImage(original, 0, 0, size.width, size.height);
  return flattenTransparency(
    canvas2d(bounded).getImageData(0, 0, size.width, size.height),
  );
}

function flattenTransparency(image: ImageData): ImageData {
  const pixels = image.data;
  if (!pixels.some((_, index) => index % 4 === 3 && pixels[index] < 255))
    return image;
  const composite = new Uint8ClampedArray(pixels);
  for (let index = 0; index < composite.length; index += 4) {
    const alpha = composite[index + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      composite[index + channel] =
        composite[index + channel] * alpha + 255 * (1 - alpha);
    }
    composite[index + 3] = 255;
  }
  return new ImageData(composite, image.width, image.height);
}

// Serialize accesses to the shared ZXing WebAssembly instance. A stopped scanner
// discards any result from work already in flight.
let decodeTail: Promise<unknown> = Promise.resolve();
function readImage(
  image: ImageData,
  maxNumberOfSymbols: number,
  isCanceled: () => boolean = () => false,
): Promise<DecodedLabel[]> {
  const run = () =>
    isCanceled()
      ? Promise.resolve([])
      : readBarcodes(image, {
          formats: [...BARCODE_FORMATS],
          maxNumberOfSymbols,
          tryHarder: true,
          textMode: "Plain",
        }).then((results) =>
          isCanceled()
            ? []
            : results
                .filter((result) => result.isValid && result.text.length > 0)
                .map((result) => ({
                  value: result.text,
                  format: result.format,
                })),
        );
  const task = decodeTail.then(run, run);
  decodeTail = task.catch(() => undefined);
  return task;
}

export async function decodeImage(
  source: Blob | ImageData,
  signal?: AbortSignal,
): Promise<DecodedLabel[]> {
  if (signal?.aborted) throw new DOMException("Decode canceled.", "AbortError");
  let imageData: ImageData;
  if (source instanceof Blob) {
    const canvas = await photoToCanvas(source);
    imageData = canvas2d(canvas).getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
  } else {
    imageData = boundedImageData(source);
  }
  const labels = await readImage(imageData, 8, () => signal?.aborted ?? false);
  if (signal?.aborted) throw new DOMException("Decode canceled.", "AbortError");
  return labels;
}

export async function openCamera(
  video: HTMLVideoElement,
  signal?: AbortSignal,
): Promise<{
  stream: MediaStream;
  stop(): void;
  torchAvailable: boolean;
  setTorch(on: boolean): Promise<void>;
}> {
  if (signal?.aborted) throw new DOMException("Camera canceled.", "AbortError");
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("Camera requires HTTPS and a supported browser.");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  } catch (cause) {
    const name = cause instanceof DOMException ? cause.name : "";
    if (name === "NotAllowedError" || name === "SecurityError")
      throw new Error("Camera permission was denied or blocked.");
    if (name === "NotFoundError" || name === "OverconstrainedError")
      throw new Error("No usable camera was found.");
    throw new Error("Camera could not be started.");
  }
  if (signal?.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    throw new DOMException("Camera canceled.", "AbortError");
  }
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener("abort", stop);
    stream.getTracks().forEach((track) => track.stop());
    if (video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    if (stopped) throw new DOMException("Camera canceled.", "AbortError");
  } catch {
    stop();
    if (signal?.aborted)
      throw new DOMException("Camera canceled.", "AbortError");
    throw new Error("Camera preview could not be played.");
  }
  const track = stream.getVideoTracks()[0];
  const capabilities = track?.getCapabilities?.() as
    | (MediaTrackCapabilities & { torch?: boolean })
    | undefined;
  const torchAvailable = capabilities?.torch === true;
  return {
    stream,
    stop,
    torchAvailable,
    async setTorch(on: boolean) {
      if (stopped || track.readyState !== "live")
        throw new Error("Camera is no longer active.");
      if (!torchAvailable)
        throw new Error("Torch is unavailable on this camera.");
      await track.applyConstraints({
        advanced: [{ torch: on } as MediaTrackConstraintSet],
      });
    },
  };
}

export function scanCamera(
  video: HTMLVideoElement,
  onResult: (labels: DecodedLabel[]) => void,
  onError: (error: Error) => void,
): () => void {
  let stopped = false;
  let pending = false;
  let frameId = 0;
  let lastAttempt = 0;
  let previousKey = "";
  let matchingFrames = 0;
  const canvas = document.createElement("canvas");
  const context = canvas2d(canvas);
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frameId);
  };
  const frame = (time: number) => {
    if (stopped) return;
    frameId = requestAnimationFrame(frame);
    if (
      pending ||
      time - lastAttempt < SCAN_INTERVAL_MS ||
      !video.videoWidth ||
      !video.videoHeight
    )
      return;
    lastAttempt = time;
    try {
      const size = scaledDimensions(
        video.videoWidth,
        video.videoHeight,
        MAX_CAMERA_SIDE,
      );
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      context.drawImage(video, 0, 0, size.width, size.height);
      const image = context.getImageData(0, 0, size.width, size.height);
      pending = true;
      void readImage(image, 1, () => stopped)
        .then((labels) => {
          if (stopped) return;
          const candidate = labels[0];
          const key = candidate
            ? JSON.stringify([candidate.format, candidate.value])
            : "";
          matchingFrames =
            key && key === previousKey ? matchingFrames + 1 : key ? 1 : 0;
          previousKey = key;
          if (matchingFrames >= 2) {
            stop();
            onResult(labels);
          }
        })
        .catch((cause) => {
          if (stopped) return;
          stop();
          onError(cause instanceof Error ? cause : new Error(String(cause)));
        })
        .finally(() => {
          pending = false;
        });
    } catch (cause) {
      stop();
      onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };
  frameId = requestAnimationFrame(frame);
  return stop;
}

export async function recognizeImage(
  source: HTMLCanvasElement | Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ text: string; confidence: number }> {
  const aborted = () => new DOMException("OCR canceled.", "AbortError");
  if (signal?.aborted) throw aborted();
  const original =
    source instanceof Blob ? await photoToCanvas(source) : source;
  if (signal?.aborted) throw aborted();
  if (!original.width || !original.height)
    throw new Error("Cannot recognize an empty image.");
  const size = scaledDimensions(
    original.width,
    original.height,
    MAX_PHOTO_SIDE,
  );
  const image = document.createElement("canvas");
  image.width = size.width;
  image.height = size.height;
  const context = canvas2d(image);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(original, 0, 0, size.width, size.height);
  let worker: { terminate(): Promise<unknown> } | undefined;
  let termination: Promise<unknown> | undefined;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    if (worker && !termination)
      termination = worker.terminate().catch(() => undefined);
    return termination;
  };
  let rejectCancellation: (reason: DOMException) => void = () => undefined;
  const cancellation = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });
  const onAbort = () => {
    void terminate();
    rejectCancellation(aborted());
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void terminate();
      reject(new Error("OCR timed out. Try a smaller crop."));
    }, OCR_TIMEOUT_MS);
  });
  const work = async () => {
    const { createWorker, OEM } = await import("tesseract.js");
    if (signal?.aborted) throw aborted();
    const created = await createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: vendorUrl("worker.min.js"),
      // A fixed non-SIMD LSTM core works on both target browsers and keeps
      // the optional offline OCR download below 10 MB.
      corePath: vendorUrl("tesseract-core-lstm.wasm.js"),
      langPath: new URL(`${import.meta.env.BASE_URL}vendor`, location.origin)
        .href,
      workerBlobURL: false,
      cacheMethod: "write",
      logger: (message) => {
        if (!signal?.aborted && !timedOut)
          onProgress(Math.max(0, Math.min(1, message.progress)));
      },
    });
    worker = created;
    if (timedOut || signal?.aborted) {
      await terminate();
      throw signal?.aborted
        ? aborted()
        : new Error("OCR timed out. Try a smaller crop.");
    }
    const result = await created.recognize(image);
    if (signal?.aborted) throw aborted();
    return { text: result.data.text, confidence: result.data.confidence };
  };
  try {
    return await Promise.race([work(), timeout, cancellation]);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    await terminate();
  }
}
