import { useEffect, useRef, useState } from "react";
import {
  Camera,
  ImagePlus,
  RotateCw,
  ScanLine,
  Type,
  RefreshCw,
  Zap,
  Square,
  Check,
} from "lucide-react";
import Dialog from "./Dialog";
import { CATEGORIES, type Capture, type Category } from "./types";
import { analyzeLabel } from "./label";
export type LabelDetails = Partial<{
  manufacturer: string;
  model: string;
  category: Category;
}>;
import {
  decodeImage,
  openCamera,
  scanCamera,
  recognizeImage,
  photoToCanvas,
  rotateCanvas,
  cropCanvas,
} from "./capture";
import type { DecodedLabel } from "./capture";
type Mode = "camera" | "photo" | "keyboard";
type Rect = { x: number; y: number; width: number; height: number };
export default function CapturePanel({
  mode,
  target,
  onCapture,
  onClose,
  currentValues,
}: {
  mode: Mode;
  target: "serial" | "assetTag";
  currentValues?: LabelDetails & { serial?: string };
  onCapture: (
    capture: Capture,
    identifier?: string,
    details?: LabelDetails,
  ) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    file = useRef<HTMLInputElement>(null),
    preview = useRef<HTMLDivElement>(null);
  const reviewStart = useRef<HTMLDivElement>(null);
  const session = useRef<Awaited<ReturnType<typeof openCamera>> | null>(null),
    stopScan = useRef<(() => void) | null>(null),
    cameraAbort = useRef<AbortController | null>(null),
    workAbort = useRef<AbortController | null>(null),
    alive = useRef(true),
    generation = useRef(0);
  const [activeMode, setActiveMode] = useState(mode),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false),
    [torch, setTorch] = useState(false),
    [torchAvailable, setTorchAvailable] = useState(false);
  const [labels, setLabels] = useState<DecodedLabel[]>([]),
    [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null),
    [original, setOriginal] = useState<HTMLCanvasElement | null>(null),
    [crop, setCrop] = useState<Rect | null>(null),
    [progress, setProgress] = useState<number | null>(null),
    [ocrText, setOcrText] = useState(""),
    [candidate, setCandidate] = useState(""),
    [rawValue, setRawValue] = useState(""),
    [source, setSource] = useState<Capture["source"]>(
      mode === "keyboard" ? "keyboard" : "barcode",
    ),
    [format, setFormat] = useState("");
  const [details, setDetails] = useState<LabelDetails | null>(null);
  const [identifiers, setIdentifiers] = useState<
    ReturnType<typeof analyzeLabel>["identifiers"]
  >([]);
  const hasDetails = details !== null;
  useEffect(() => {
    if (hasDetails) reviewStart.current?.scrollIntoView({ block: "start" });
  }, [hasDetails]);
  const drag = useRef<{ x: number; y: number } | null>(null);
  function stop() {
    cameraAbort.current?.abort();
    cameraAbort.current = null;
    stopScan.current?.();
    stopScan.current = null;
    session.current?.stop();
    session.current = null;
    setRunning(false);
    setTorch(false);
    setTorchAvailable(false);
  }
  useEffect(() => {
    alive.current = true;
    const hidden = () => {
      if (document.hidden) {
        generation.current++;
        workAbort.current?.abort();
        stop();
        setStatus("Capture paused while this page was hidden.");
        setBusy(false);
        setProgress(null);
      }
    };
    const leave = () => {
      generation.current++;
      stop();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      alive.current = false;
      generation.current++;
      workAbort.current?.abort();
      cameraAbort.current?.abort();
      stopScan.current?.();
      session.current?.stop();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
    };
  }, []);
  async function start() {
    if (busy) return;
    const token = ++generation.current;
    setBusy(true);
    setError("");
    setLabels([]);
    setDetails(null);
    setIdentifiers([]);
    setCandidate("");
    setRawValue("");
    setStatus("Starting camera…");
    try {
      cameraAbort.current = new AbortController();
      const camera = await openCamera(
        video.current!,
        cameraAbort.current.signal,
      );
      if (!alive.current || token !== generation.current) {
        camera.stop();
        return;
      }
      session.current = camera;
      setTorchAvailable(camera.torchAvailable);
      setRunning(true);
      setStatus(
        "Include the printed serial, model, and manufacturer. Hold steady, or tap Read this label.",
      );
      stopScan.current = scanCamera(
        video.current!,
        (found) => {
          if (!alive.current || token !== generation.current) return;
          takeFrame(found);
          navigator.vibrate?.(40);
        },
        (err) => {
          if (!alive.current || token !== generation.current) return;
          stop();
          setError(err.message);
        },
      );
      camera.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (alive.current && token === generation.current) {
          stop();
          setStatus("Camera disconnected. Resume or choose a photo.");
        }
      });
    } catch (e) {
      if (alive.current && token === generation.current) {
        setError((e as Error).message);
        setStatus(
          "Photo, keyboard scanner, and manual entry remain available.",
        );
      }
    } finally {
      if (alive.current && token === generation.current) setBusy(false);
    }
  }
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (activeMode === "camera") {
      const timer = window.setTimeout(() => void startRef.current(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [activeMode]);
  // Camera mode opens only after the staff member selects a camera action.
  function changeMode(next: Mode) {
    generation.current++;
    workAbort.current?.abort();
    stop();
    setBusy(false);
    setError("");
    setStatus("");
    setActiveMode(next);
    setCandidate("");
    setRawValue("");
    setLabels([]);
    setDetails(null);
    setIdentifiers([]);
    setOcrText("");
    setSource(next === "keyboard" ? "keyboard" : "photo-barcode");
  }
  async function loadPhoto(f: File) {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    setLabels([]);
    setDetails(null);
    setIdentifiers([]);
    setOcrText("");
    setCandidate("");
    try {
      const c = await photoToCanvas(f);
      if (alive.current && token === generation.current) {
        setCanvas(c);
        setOriginal(c);
        setCrop(null);
        setStatus(
          "Choose Read full label to find the serial, manufacturer and model. Drag over the label first if the photo includes other equipment.",
        );
      }
    } catch (e) {
      if (alive.current && token === generation.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && token === generation.current) setBusy(false);
    }
  }
  function takeFrame(found: DecodedLabel[] = []) {
    const v = video.current;
    if (!v?.videoWidth || !v.videoHeight) return;
    const frame = document.createElement("canvas");
    frame.width = v.videoWidth;
    frame.height = v.videoHeight;
    frame.getContext("2d")!.drawImage(v, 0, 0);
    stop();
    setCanvas(frame);
    setOriginal(frame);
    setCrop(null);
    setActiveMode("photo");
    void read("label", frame, found, true);
  }
  async function read(
    kind: "label" | "barcode" | "text" = "label",
    frame?: HTMLCanvasElement,
    knownCodes: DecodedLabel[] = [],
    fromCamera = false,
  ) {
    if ((!canvas && !frame) || busy) return;
    const token = ++generation.current;
    setBusy(true);
    setError("");
    setLabels([]);
    setDetails(null);
    setIdentifiers([]);
    setOcrText("");
    setCandidate("");
    setRawValue("");
    setFormat("");
    setProgress(kind !== "barcode" ? 0 : null);
    setStatus(
      kind === "barcode"
        ? "Reading barcodes…"
        : "Reading label text and codes on this device…",
    );
    const c = frame || (crop ? cropCanvas(canvas!, crop) : canvas!);
    workAbort.current = new AbortController();
    const signal = workAbort.current.signal;
    const isCurrent = () => alive.current && token === generation.current;
    try {
      let codes = knownCodes;
      let text = "";
      const warnings: string[] = [];
      if (kind !== "text") {
        try {
          codes = await decodeImage(
            c.getContext("2d")!.getImageData(0, 0, c.width, c.height),
            signal,
          );
        } catch (e) {
          if (signal.aborted) throw e;
          warnings.push(
            "Barcode reading failed. You can still review the printed text.",
          );
        }
      }
      if (!isCurrent()) return;
      if (kind !== "barcode") {
        try {
          const result = await recognizeImage(
            c,
            (p) => {
              if (isCurrent()) setProgress(p);
            },
            signal,
          );
          text = result.text;
          if (!isCurrent()) return;
        } catch (e) {
          if (signal.aborted) throw e;
          warnings.push(
            (e as Error).message + " Codes, if found, remain available below.",
          );
        }
      }
      if (!isCurrent()) return;
      setLabels(codes);
      setOcrText(text);
      setSource(
        fromCamera ? "barcode" : kind === "barcode" ? "photo-barcode" : "ocr",
      );
      if (kind === "label" && target === "serial") {
        const result = analyzeLabel(text, codes);
        const { serial, ...metadata } = result.fields;
        setDetails(metadata);
        setIdentifiers(result.identifiers);
        setCandidate(serial || "");
        setRawValue(JSON.stringify({ text, codes }));
        setFormat("equipment-label");
        setStatus(
          serial
            ? ""
            : "No unambiguous serial label was read. Check the photo and enter the serial below, or apply only the details found.",
        );
      } else {
        setRawValue(text || codes.map((c) => c.value).join("\n"));
        setFormat(
          kind === "text"
            ? "text"
            : codes.length === 1
              ? codes[0].format
              : "text",
        );
        // Decoding establishes a value, not whether it identifies an individual device.
        setStatus(
          text || codes.length
            ? "Select the value that matches the printed serial or asset tag. A barcode alone does not identify its purpose."
            : "No text or codes found. Crop closer, rotate the photo, or type the value.",
        );
      }
      setError(warnings.join(" "));
    } catch (e) {
      if (isCurrent() && !signal.aborted) setError((e as Error).message);
    } finally {
      if (isCurrent()) {
        setBusy(false);
        setProgress(null);
      }
    }
  }
  function point(e: React.PointerEvent) {
    const box = preview.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
    };
  }
  const tokens = Array.from(
    new Set(ocrText.split(/[\s:]+/).filter((t) => t.length >= 3)),
  ).slice(0, 36);
  function accept() {
    if (!candidate.trim() && !Object.values(details || {}).some(Boolean))
      return;
    stop();
    onCapture(
      {
        value: source === "keyboard" ? candidate : rawValue || candidate,
        source,
        format: format || "text",
        capturedAt: new Date().toISOString(),
      },
      candidate,
      details || undefined,
    );
  }
  return (
    <Dialog
      title={`Capture ${target === "serial" ? "serial number" : "asset tag"}`}
      onClose={onClose}
      wide
    >
      <div className="mode-tabs" role="group" aria-label="Capture method">
        {(
          [
            ["camera", Camera, "Camera"],
            ["photo", ImagePlus, "Photo"],
            ["keyboard", ScanLine, "Scanner"],
          ] as const
        ).map(([key, Icon, text]) => (
          <button
            key={key}
            className={activeMode === key ? "selected" : ""}
            disabled={busy}
            onClick={() => changeMode(key)}
          >
            <Icon size={18} />
            {text}
          </button>
        ))}
      </div>
      {activeMode === "camera" && (
        <>
          <div className="viewfinder">
            <video
              ref={video}
              muted
              playsInline
              aria-label="Live camera preview"
            />
            {!running && (
              <div className="viewfinder-message">
                <Camera size={36} />
                <p>Point the rear camera at one label.</p>
                <button
                  className="button primary light"
                  onClick={() => void start()}
                  disabled={busy}
                >
                  {busy ? "Starting…" : "Start camera"}
                </button>
              </div>
            )}
            {running && <div className="scan-guide" aria-hidden="true" />}
          </div>
          <div className="button-row">
            {running && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => takeFrame()}
              >
                Read this label
              </button>
            )}
            {running && (
              <button
                className="button"
                onClick={() => {
                  generation.current++;
                  stop();
                  setStatus("Camera paused.");
                }}
              >
                <Square size={16} />
                Pause
              </button>
            )}
            {torchAvailable && (
              <button
                className="button"
                aria-pressed={torch}
                onClick={async () => {
                  try {
                    await session.current?.setTorch(!torch);
                    setTorch(!torch);
                  } catch {
                    setError("This camera could not change its light.");
                  }
                }}
              >
                <Zap size={17} />
                Light {torch ? "on" : "off"}
              </button>
            )}
            <button
              className="button subtle"
              onClick={() => changeMode("photo")}
            >
              <ImagePlus size={17} />
              Use a photo
            </button>
          </div>
        </>
      )}
      {activeMode === "photo" && (
        <>
          <input
            ref={file}
            type="file"
            accept="image/*"
            aria-label="Choose label photo"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadPhoto(f);
              e.target.value = "";
            }}
          />
          <button
            className="photo-picker"
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            <ImagePlus size={25} />
            {canvas ? "Choose another photo" : "Take or choose a label photo"}
          </button>
          {canvas && (
            <>
              <div
                ref={preview}
                className="photo-preview"
                onPointerDown={(e) => {
                  if (busy) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = point(e);
                  setCrop(null);
                }}
                onPointerMove={(e) => {
                  if (!drag.current) return;
                  const p = point(e),
                    a = drag.current;
                  setCrop({
                    x: Math.min(a.x, p.x),
                    y: Math.min(a.y, p.y),
                    width: Math.abs(p.x - a.x),
                    height: Math.abs(p.y - a.y),
                  });
                }}
                onPointerUp={() => {
                  drag.current = null;
                  if (crop && (crop.width < 0.03 || crop.height < 0.03))
                    setCrop(null);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setCrop(null);
                }}
              >
                <img
                  src={canvas.toDataURL("image/jpeg", 0.85)}
                  alt="Label photo; drag a rectangle to select the label"
                  draggable={false}
                />
                {crop && (
                  <div
                    className="crop-box"
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                      height: `${crop.height * 100}%`,
                    }}
                  />
                )}
              </div>
              <div className="button-row">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setCanvas(rotateCanvas(canvas));
                    setCrop(null);
                  }}
                >
                  <RotateCw size={16} />
                  Rotate
                </button>
                <button
                  className="button"
                  disabled={busy || !crop}
                  onClick={() => {
                    setCanvas(cropCanvas(canvas, crop!));
                    setCrop(null);
                  }}
                >
                  <Square size={16} />
                  Crop selection
                </button>
                <button
                  className="icon-button"
                  aria-label="Reset photo"
                  disabled={busy}
                  onClick={() => {
                    setCanvas(original);
                    setCrop(null);
                  }}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void read("label")}
                >
                  <ScanLine size={18} />
                  Read full label
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void read("barcode")}
                >
                  Read barcode
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void read("text")}
                >
                  <Type size={18} />
                  Read text
                </button>
              </div>
            </>
          )}
        </>
      )}
      {activeMode === "keyboard" && (
        <div className="keyboard-help">
          <ScanLine size={28} />
          <p>
            Scan with a USB or Bluetooth scanner, or paste an identifier. Enter
            moves it to review.
          </p>
          <label>
            Scanner input
            <input
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  accept();
                }
              }}
            />
          </label>
        </div>
      )}
      {status && (
        <p role="status" className="hint">
          {status}
        </p>
      )}
      {progress !== null && (
        <progress
          aria-label="Text recognition progress"
          value={progress}
          max={1}
        />
      )}{" "}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div ref={reviewStart} />
      {activeMode !== "keyboard" &&
        (candidate || labels.length > 0 || ocrText || details !== null) && (
          <label className="candidate-label">
            {details !== null ? "Serial number to use" : "Identifier to use"}
            <input
              className="mono"
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
            />
            {currentValues?.serial &&
              candidate &&
              currentValues.serial !== candidate && (
                <span className="hint">Replaces: {currentValues.serial}</span>
              )}
            <span className="hint">
              {details !== null
                ? "Blank keeps the current serial."
                : "Use the printed serial or asset number. Product and order codes are different identifiers."}
            </span>
          </label>
        )}
      {details !== null && (
        <section className="label-review" aria-label="Equipment details found">
          <p className="hint">
            Check the photo for O/0 and I/1 errors. Clear fields you do not want
            to apply.
          </p>
          <div className="label-fields">
            {(["manufacturer", "model"] as const).map((key) => (
              <label key={key}>
                {key === "manufacturer" ? "Manufacturer found" : "Model found"}
                <input
                  maxLength={key === "manufacturer" ? 120 : 240}
                  value={details[key] || ""}
                  onChange={(e) =>
                    setDetails({ ...details, [key]: e.target.value })
                  }
                />
                {currentValues?.[key] &&
                  details[key] &&
                  currentValues[key] !== details[key] && (
                    <span className="hint">Replaces: {currentValues[key]}</span>
                  )}
              </label>
            ))}
            <label>
              Equipment type (inferred from model)
              <select
                value={details.category || ""}
                onChange={(e) =>
                  setDetails({
                    ...details,
                    category: (e.target.value || undefined) as
                      | Category
                      | undefined,
                  })
                }
              >
                <option value="">Keep current type</option>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          {identifiers.length > 0 && (
            <ul className="identified-values">
              {identifiers
                .filter(
                  (id) =>
                    id.kind !== "unknown" &&
                    (id.kind !== "serial" ||
                      identifiers.filter((other) => other.kind === "serial")
                        .length > 1),
                )
                .map((id, i) => (
                  <li key={i}>
                    <strong>{id.label}</strong>:{" "}
                    <span className="mono">{id.value}</span>
                    {id.kind === "serial" && (
                      <button
                        className="button subtle"
                        onClick={() => setCandidate(id.value)}
                      >
                        Use this serial
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
      {(labels.length > 0 || ocrText) && (
        <details
          className="reading-evidence"
          open={details === null || undefined}
        >
          <summary hidden={details === null}>Text and codes read</summary>
          {labels.length > 0 && (
            <div className="label-results">
              {labels.map((item, i) => (
                <button
                  className={
                    candidate === item.value
                      ? "label-result selected"
                      : "label-result"
                  }
                  key={i}
                  onClick={() => {
                    setCandidate(item.value);
                    if (details === null) {
                      setRawValue(item.value);
                      setFormat(item.format);
                    }
                  }}
                >
                  <span className="mono">{item.value}</span>
                  <small>
                    {item.format} ·{" "}
                    {details !== null
                      ? "Raw code — select only if it is the serial"
                      : "Select only if this is the requested identifier"}
                  </small>
                </button>
              ))}
            </div>
          )}
          {ocrText && (
            <div className="ocr-results">
              {details === null && (
                <p className="hint">
                  Check every character against the photo, especially O/0 and
                  I/1.
                </p>
              )}
              <details>
                <summary>All recognized text</summary>
                <pre>{ocrText}</pre>
              </details>
              {details === null && (
                <div className="token-list">
                  {tokens.map((token, i) => (
                    <button key={i} onClick={() => setCandidate(token)}>
                      {token}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </details>
      )}
      {/^(EAN|UPC)/.test(format) && (
        <p className="notice warning">
          This is usually a product code shared by many items. Use the
          equipment’s serial label. UPC may appear as EAN with an extra leading
          zero.
        </p>
      )}
      <div className="dialog-actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={
            (!candidate.trim() &&
              !Object.values(details || {}).some(Boolean)) ||
            busy
          }
          onClick={accept}
        >
          <Check size={18} />
          {details !== null ? "Use label details" : "Use identifier"}
        </button>
      </div>
    </Dialog>
  );
}
