import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  ScanLine,
  Camera,
  ImagePlus,
  Keyboard,
  Plus,
  Download,
  Upload,
  Settings2,
  Check,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  WifiOff,
  HardDrive,
  ChevronDown,
  ChevronRight,
  Search,
  Pencil,
  Trash2,
  Undo2,
  X,
  FolderOpen,
  BookOpen,
  Share2,
  RefreshCw,
  Package,
  ArrowLeft,
  FileJson,
} from "lucide-react";
import { CATEGORIES, MAKES } from "./types";
import type { Asset, AssetInput, Batch, Capture, StorageStatus } from "./types";
import {
  listBatches,
  listAssets,
  createBatch,
  saveBatch,
  saveAsset,
  deleteAsset,
  restoreAsset,
  makeBackup,
  encodeBackup,
  importBackup,
  assetsToCsv,
  exportFilename,
  reviewReasons,
  validateAsset,
  DuplicateError,
  ConflictError,
} from "./data";
import {
  startOffline,
  prepareOffline,
  applyUpdate,
  requestPersistence,
} from "./offline";
import type { OfflineState } from "./offline";
import Dialog from "./Dialog";
import CaptureBoundary from "./CaptureBoundary";
const CapturePanel = lazy(() => import("./CapturePanel"));
const STORAGE: Record<StorageStatus, string> = {
  unknown: "Not checked",
  none: "No data storage",
  "needs-sanitization": "Needs sanitization",
  "wiped-verified": "Wipe verified by IT",
  removed: "Storage removed",
};
const DRAFT_KEY = "ucsb-surplus-scanner:draft:v1",
  BATCH_KEY = "ucsb-surplus-scanner:batch:v1";
function blank(batch: Batch): AssetInput {
  return {
    batchId: batch.id,
    category: batch.defaultCategory,
    manufacturer: batch.defaultManufacturer,
    model: "",
    serial: "",
    assetTag: "",
    assetState: "unknown",
    quantity: 1,
    storageStatus: "unknown",
    mediaSerial: "",
    wipeReference: "",
    verifiedBy: "",
    verifiedAt: "",
    location: batch.location,
    scannedBy: batch.scannedBy,
    notes: "",
    handlingFlag: false,
    captures: [],
  };
}
function download(text: string, name: string, type: string) {
  const blob = new Blob([text], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function getMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function draftHasData(draft: AssetInput | null) {
  return (
    !!draft &&
    (!!draft.serial ||
      !!draft.assetTag ||
      !!draft.model ||
      !!draft.notes ||
      draft.captures.length > 0)
  );
}
function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const fn = () => setOnline(navigator.onLine);
    window.addEventListener("online", fn);
    window.addEventListener("offline", fn);
    return () => {
      window.removeEventListener("online", fn);
      window.removeEventListener("offline", fn);
    };
  }, []);
  return online;
}
export default function App() {
  const [batches, setBatches] = useState<Batch[]>([]),
    [batch, setBatch] = useState<Batch | null>(null),
    [assets, setAssets] = useState<Asset[]>([]),
    [draft, setDraft] = useState<AssetInput | null>(null),
    [editing, setEditing] = useState<Asset | null>(null);
  const [tab, setTab] = useState<"capture" | "inventory">("capture"),
    [capture, setCapture] = useState<{
      mode: "camera" | "photo" | "keyboard";
      target: "serial" | "assetTag";
    } | null>(null),
    [dialog, setDialog] = useState<"tools" | "batch" | "help" | "new" | null>(
      null,
    ),
    [batchDraft, setBatchDraft] = useState<Batch | null>(null),
    [newName, setNewName] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [deleted, setDeleted] = useState<Asset | null>(null),
    [deleteConfirm, setDeleteConfirm] = useState<Asset | null>(null),
    [duplicate, setDuplicate] = useState<Asset | null>(null),
    [staleAsset, setStaleAsset] = useState<Asset | null>(null),
    [cleared, setCleared] = useState<{
      draft: AssetInput;
      editing: Asset | null;
    } | null>(null);
  const [backupTooLarge, setBackupTooLarge] = useState(false);
  const [search, setSearch] = useState(""),
    [reviewOnly, setReviewOnly] = useState(false),
    [continueScanning, setContinueScanning] = useState(true),
    [offline, setOffline] = useState<OfflineState>({
      status: "preparing",
      message: "Preparing offline tools…",
      updateAvailable: false,
    }),
    [offlineBusy, setOfflineBusy] = useState(false),
    [persistent, setPersistent] = useState<boolean | null>(null),
    [draftRetained, setDraftRetained] = useState(true);
  const serialRef = useRef<HTMLInputElement>(null),
    upload = useRef<HTMLInputElement>(null),
    channel = useRef<BroadcastChannel | null>(null),
    batchRef = useRef<Batch | null>(null),
    online = useOnline();
  batchRef.current = batch;
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const bs = await listBatches();
        if (!active) return;
        let preferred: string | null = null;
        try {
          preferred = localStorage.getItem(BATCH_KEY);
        } catch {}
        let selected = bs.find((b) => b.id === preferred) || bs[0];
        let retained: AssetInput | null = null,
          edit: Asset | null = null;
        try {
          const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
          if (
            saved?.draft &&
            bs.some((b) => b.id === saved.draft.batchId) &&
            Array.isArray(saved.draft.captures)
          ) {
            selected = bs.find((b) => b.id === saved.draft.batchId)!;
            retained = saved.draft;
            edit = saved.editing ?? null;
          }
        } catch {
          setDraftRetained(false);
        }
        const rows = await listAssets(selected.id);
        if (!active) return;
        setBatches(bs);
        setBatch(selected);
        setAssets(rows);
        setDraft(retained || blank(selected));
        setEditing(edit);
        if (retained && draftHasData(retained))
          setNotice("Your unfinished entry has been restored.");
      } catch (e) {
        if (active)
          setError(
            `Inventory storage could not open. ${getMessage(e)} Your browser must allow site storage before records can be saved.`,
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let stop: (() => void) | undefined,
      active = true;
    void startOffline((s) => {
      if (active) setOffline(s);
    })
      .then((fn) => {
        if (active) stop = fn;
        else fn();
      })
      .catch((e) => {
        if (active)
          setOffline({
            status: "error",
            message: getMessage(e),
            updateAvailable: false,
          });
      });
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  useEffect(() => {
    if (!draft) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, editing }));
      setDraftRetained(true);
    } catch {
      setDraftRetained(false);
    }
  }, [draft, editing]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (draftHasData(draft)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [draft]);
  useEffect(() => {
    async function refresh() {
      const current = batchRef.current;
      if (!current) return;
      try {
        const [bs, rows] = await Promise.all([
          listBatches(),
          listAssets(current.id),
        ]);
        if (batchRef.current?.id !== current.id) return;
        setBatches(bs);
        setAssets(rows);
        const updated = bs.find((b) => b.id === current.id);
        if (updated) setBatch(updated);
      } catch (e) {
        setError(getMessage(e));
      }
    }
    try {
      channel.current = new BroadcastChannel("ucsb-surplus-scanner:changes");
      channel.current.onmessage = () => void refresh();
    } catch {}
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      channel.current?.close();
      channel.current = null;
    };
  }, []);
  function broadcast() {
    channel.current?.postMessage("changed");
  }
  function openDialog(next: "tools" | "batch" | "help" | "new") {
    setError("");
    setNotice("");
    setDialog(next);
  }
  function update<K extends keyof AssetInput>(key: K, value: AssetInput[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setError("");
    setNotice("");
    setDuplicate(null);
    setStaleAsset(null);
  }
  async function changeBatch(id: string) {
    const b = batches.find((item) => item.id === id);
    if (!b) return;
    try {
      setAssets(await listAssets(b.id));
      setCleared(null);
      setBatch(b);
      setDraft(blank(b));
      setEditing(null);
      setError("");
      setDuplicate(null);
      setNotice("");
      try {
        localStorage.setItem(BATCH_KEY, b.id);
      } catch {}
    } catch (e) {
      setError(getMessage(e));
    }
  }
  function reset() {
    if (!batch) return;
    if (draft && draftHasData(draft)) setCleared({ draft, editing });
    setDraft(blank(batch));
    setEditing(null);
    setError("");
    setDuplicate(null);
    setNotice("Entry cleared. Saved equipment is unchanged.");
    serialRef.current?.focus();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !batch || saving) return;
    setError("");
    setNotice("");
    setDuplicate(null);
    const problems = validateAsset(draft);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setSaving(true);
    try {
      const wasEditing = !!editing;
      const saved = await saveAsset(draft, editing?.id, editing?.revision);
      setAssets((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      broadcast();
      setNotice(
        `${saved.serial || saved.assetTag || saved.model || saved.category} ${wasEditing ? "updated" : "saved on this device"}.`,
      );
      const previous = draft;
      setCleared(null);
      setDraft({
        ...blank(batch),
        category: previous.category,
        manufacturer: previous.manufacturer,
        location: previous.location,
        scannedBy: previous.scannedBy,
      });
      setEditing(null);
      if (
        !wasEditing &&
        continueScanning &&
        previous.captures.at(-1)?.source === "barcode"
      )
        setCapture({ mode: "camera", target: "serial" });
      else serialRef.current?.focus();
    } catch (e) {
      setError(getMessage(e));
      if (e instanceof DuplicateError) setDuplicate(e.existing);
      if (e instanceof ConflictError && editing) {
        try {
          const latest = (await listAssets(batch.id)).find(
            (a) => a.id === editing.id,
          );
          setStaleAsset(latest || null);
        } catch {}
      }
    } finally {
      setSaving(false);
    }
  }
  function edit(asset: Asset) {
    setCleared(null);
    setEditing(asset);
    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      revision: _r,
      ...input
    } = asset;
    setDraft(input);
    setTab("capture");
    setError("");
    setDuplicate(null);
    setNotice("Editing saved equipment. Changes require Save changes.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function remove() {
    if (!deleteConfirm) return;
    setSaving(true);
    try {
      const removed = await deleteAsset(
        deleteConfirm.id,
        deleteConfirm.revision,
      );
      setDeleted(removed);
      setDeleteConfirm(null);
      if (editing?.id === removed.id) reset();
      setAssets((current) => current.filter((item) => item.id !== removed.id));
      broadcast();
      setNotice("Item deleted. Undo is available below.");
    } catch (e) {
      setError(getMessage(e));
    } finally {
      setSaving(false);
    }
  }
  async function undo() {
    if (!deleted) return;
    try {
      await restoreAsset(deleted);
      if (deleted.batchId === batch?.id)
        setAssets((current) => [
          deleted,
          ...current.filter((item) => item.id !== deleted.id),
        ]);
      setDeleted(null);
      broadcast();
      setNotice("Deleted item restored.");
    } catch (e) {
      setError(getMessage(e));
    }
  }
  async function exportCsv(share = false) {
    if (!batch) return;
    try {
      const rows = await listAssets(batch.id),
        csv = assetsToCsv(batch, rows),
        name = exportFilename(batch, "csv");
      if (share) {
        const f = new File([csv], name, { type: "text/csv;charset=utf-8" });
        if (navigator.canShare?.({ files: [f] })) {
          await navigator.share({ files: [f], title: batch.name });
          return;
        }
      }
      download(csv, name, "text/csv;charset=utf-8");
      setNotice(
        `CSV prepared: ${rows.length} saved records. Keep a JSON backup for exact identifiers and restore.`,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(getMessage(e));
    }
  }
  async function backup(currentOnly = false) {
    try {
      const data = await makeBackup();
      if (currentOnly && batch) {
        data.batches = data.batches.filter((b) => b.id === batch.id);
        data.assets = data.assets.filter((a) => a.batchId === batch.id);
      }
      const encoded = encodeBackup(data);
      download(
        encoded,
        `ucsb_surplus_${currentOnly ? "batch" : "all"}_backup_${new Date().toISOString().slice(0, 10)}.json`,
        "application/json",
      );
      setNotice(
        `Backup prepared with ${currentOnly ? "the current batch" : "all saved batches"}. Keep it in an approved department location.`,
      );
    } catch (e) {
      setError(getMessage(e));
      if (getMessage(e).includes("restore limit")) {
        setBackupTooLarge(true);
        setDialog("tools");
      }
    }
  }
  async function restore(file: File) {
    setSaving(true);
    setError("");
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Choose a backup smaller than 10 MB.");
      const result = await importBackup(await file.text());
      try {
        setBatches(await listBatches());
        if (batch) setAssets(await listAssets(batch.id));
      } catch {
        setError(
          "Backup imported. The saved list could not refresh; reload this page to view the imported records.",
        );
      }
      broadcast();
      setNotice(
        `Backup restored: ${result.added} batches/items added, ${result.skipped} unchanged, ${result.conflicts} conflicts skipped. Keep the source backup for skipped records.`,
      );
    } catch (e) {
      setError(`Backup was not imported. ${getMessage(e)}`);
    } finally {
      setSaving(false);
    }
  }
  async function saveBatchSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!batchDraft) return;
    setSaving(true);
    try {
      const saved = await saveBatch(batchDraft);
      setBatches((current) =>
        current.map((b) => (b.id === saved.id ? saved : b)),
      );
      setBatch(saved);
      if (draft && !draftHasData(draft) && !editing) setDraft(blank(saved));
      setDialog(null);
      setNotice(
        "Batch defaults saved. Existing equipment keeps its recorded details.",
      );
      broadcast();
    } catch (e) {
      setError(getMessage(e));
    } finally {
      setSaving(false);
    }
  }
  async function addBatch(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await createBatch(newName.trim() || undefined);
      setBatches((current) => [...current, created]);
      setBatch(created);
      setCleared(null);
      setAssets([]);
      setDraft(blank(created));
      setEditing(null);
      setDialog(null);
      setNewName("");
      try {
        localStorage.setItem(BATCH_KEY, created.id);
      } catch {}
      broadcast();
      setNotice(
        "New batch ready. Set the department and location in Batch details.",
      );
    } catch (e) {
      setError(getMessage(e));
    } finally {
      setSaving(false);
    }
  }
  function acceptCapture(value: Capture, identifier = value.value) {
    if (!capture || !draft) return;
    const cleaned = identifier.replace(
      /^[\s\u0000-\u001f\u007f]+|[\s\u0000-\u001f\u007f]+$/g,
      "",
    );
    setDraft({
      ...draft,
      [capture.target]: cleaned,
      assetState: capture.target === "assetTag" ? "present" : draft.assetState,
      captures: [...draft.captures, value],
    });
    setCapture(null);
    setError("");
    setNotice("Identifier captured. Check the label, then save the equipment.");
  }
  const quantity = assets.reduce((sum, a) => sum + a.quantity, 0),
    reviewCount = assets.filter((a) => reviewReasons(a).length).length;
  const filtered = assets.filter(
    (a) =>
      (!reviewOnly || reviewReasons(a).length > 0) &&
      [
        a.serial,
        a.assetTag,
        a.manufacturer,
        a.model,
        a.category,
        a.location,
        a.notes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const offlineLabel = offline.updateAvailable
    ? "Update ready"
    : offline.status === "ready"
      ? "Offline ready"
      : offline.status === "preparing"
        ? "Preparing offline"
        : "Offline setup";
  const dirty = draftHasData(draft);
  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <a
            className="brand"
            href="./"
            onClick={(e) => {
              e.preventDefault();
              setTab("capture");
            }}
            aria-label="Surplus Scanner home"
          >
            <div className="brand-mark">
              <ScanLine size={28} />
            </div>
            <span>
              <strong>Surplus Scanner</strong>
              <small>UCSB · DEPARTMENT IT</small>
            </span>
          </a>
          <div className="header-actions">
            <button
              className={`offline-pill ${offline.status === "ready" ? "ready" : ""}`}
              onClick={() => openDialog("tools")}
            >
              {!online ? (
                <WifiOff size={16} />
              ) : offline.status === "ready" ? (
                <ShieldCheck size={16} />
              ) : (
                <HardDrive size={16} />
              )}
              <span>
                {!online && offline.status === "ready"
                  ? "Working offline"
                  : offlineLabel}
              </span>
            </button>
            <button
              className="header-icon"
              aria-label="UCSB guidance and help"
              onClick={() => openDialog("help")}
            >
              <BookOpen size={21} />
            </button>
          </div>
        </div>
      </header>
      <main className="workspace">
        <div className="batch-bar">
          <div className="batch-title">
            <span className="eyebrow">DEPARTMENTAL INVENTORY</span>
            <div className="batch-name">
              <h1>{batch?.name || "Your surplus batch"}</h1>
              <button
                className="text-button batch-details"
                aria-label="Edit batch details"
                disabled={!batch || saving}
                onClick={() => {
                  setBatchDraft(batch);
                  openDialog("batch");
                }}
              >
                <Settings2 size={16} />
                <span>Batch details</span>
              </button>
            </div>
            <p>
              {batch?.department || "Department not set"}
              <span> / </span>
              {batch?.location || "Location not set"}
            </p>
          </div>
          <div className="batch-actions">
            <label className="batch-selector">
              <span className="sr-only">Current batch</span>
              <FolderOpen size={18} />
              <select
                aria-label="Current batch"
                value={batch?.id || ""}
                disabled={dirty || !!editing || saving}
                onChange={(e) => void changeBatch(e.target.value)}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
            <button
              className="button"
              disabled={dirty || !!editing || saving}
              title={
                dirty ? "Save or clear the entry first" : "Start a new batch"
              }
              onClick={() => openDialog("new")}
            >
              <Plus size={18} />
              New batch
            </button>
          </div>
        </div>
        {(dirty || editing) && (
          <p className="batch-lock hint">
            Save or clear the current entry before switching batches.
          </p>
        )}
        {error && !dialog && !deleteConfirm && (
          <div className="notice error" role="alert">
            <AlertCircle size={19} />
            <div>
              {error}
              {duplicate && (
                <button className="text-button" onClick={() => edit(duplicate)}>
                  Open existing item
                </button>
              )}
              {staleAsset && (
                <button
                  className="text-button"
                  onClick={() => {
                    edit(staleAsset);
                    setStaleAsset(null);
                  }}
                >
                  Reload saved item (discard this edit)
                </button>
              )}
            </div>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {notice && !dialog && (
          <div className="notice success" role="status">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setNotice("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {cleared && !dirty && (
          <div className="undo-bar">
            <span>Previous entry cleared.</span>
            <button
              className="text-button"
              onClick={() => {
                setDraft(cleared.draft);
                setEditing(cleared.editing);
                setCleared(null);
                setNotice("Previous entry restored.");
              }}
            >
              <Undo2 size={16} />
              Undo clear
            </button>
          </div>
        )}
        {deleted && (
          <div className="undo-bar">
            <span>
              Deleted:{" "}
              {deleted.serial ||
                deleted.assetTag ||
                deleted.model ||
                deleted.category}
            </span>
            <button className="text-button" onClick={() => void undo()}>
              <Undo2 size={16} />
              Undo delete
            </button>
          </div>
        )}
        <div className="work-grid">
          <section
            className={`capture-card panel ${tab !== "capture" ? "mobile-hidden" : ""}`}
            aria-labelledby="capture-heading"
          >
            <div className="panel-title">
              <div>
                <h2 id="capture-heading">
                  {editing ? "Edit equipment" : "Capture equipment"}
                </h2>
              </div>
              <button
                className="text-button quick-reference"
                onClick={() => openDialog("help")}
              >
                Quick reference
              </button>
            </div>
            {loading ? (
              <p className="empty-message">Opening your saved inventory…</p>
            ) : (
              draft && (
                <>
                  <div className="capture-methods">
                    <button
                      className="camera-button"
                      onClick={() =>
                        setCapture({ mode: "camera", target: "serial" })
                      }
                    >
                      <Camera size={23} />
                      <span>Scan with camera</span>
                    </button>
                    <div className="capture-alternatives">
                      <button
                        onClick={() =>
                          setCapture({ mode: "photo", target: "serial" })
                        }
                      >
                        <ImagePlus size={18} />
                        Label photo
                      </button>
                      <button
                        onClick={() =>
                          setCapture({ mode: "keyboard", target: "serial" })
                        }
                      >
                        <Keyboard size={19} />
                        USB / Bluetooth
                      </button>
                    </div>
                  </div>
                  <form onSubmit={submit} className="asset-form">
                    <fieldset disabled={saving} className="asset-fields">
                      <p className="form-divider">
                        Check the label, then save the item.
                      </p>
                      <label>
                        Serial number
                        <div className="input-with-action">
                          <input
                            ref={serialRef}
                            name="serial"
                            className="mono"
                            value={draft.serial}
                            onChange={(e) => update("serial", e.target.value)}
                            autoComplete="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            placeholder="S/N on the equipment label"
                            maxLength={240}
                          />
                          <button
                            type="button"
                            aria-label="Scan serial number"
                            onClick={() =>
                              setCapture({ mode: "camera", target: "serial" })
                            }
                          >
                            <ScanLine size={20} />
                          </button>
                        </div>
                      </label>
                      <div className="field-grid">
                        <label>
                          Asset tag status
                          <select
                            value={draft.assetState}
                            onChange={(e) =>
                              update(
                                "assetState",
                                e.target.value as AssetInput["assetState"],
                              )
                            }
                          >
                            <option value="unknown">Not checked</option>
                            <option value="present">Tag found</option>
                            <option value="not-found">No tag found</option>
                          </select>
                        </label>
                        <label>
                          UCSB asset number
                          <div className="input-with-action">
                            <input
                              className="mono"
                              value={draft.assetTag}
                              autoComplete="off"
                              autoCapitalize="off"
                              spellCheck={false}
                              placeholder="If present"
                              aria-label="UCSB asset number"
                              maxLength={160}
                              onChange={(e) => {
                                update("assetTag", e.target.value);
                                if (e.target.value.trim())
                                  update("assetState", "present");
                              }}
                            />
                            <button
                              type="button"
                              aria-label="Scan asset number"
                              onClick={() =>
                                setCapture({
                                  mode: "camera",
                                  target: "assetTag",
                                })
                              }
                            >
                              <ScanLine size={20} />
                            </button>
                          </div>
                        </label>
                      </div>
                      <div className="field-grid">
                        <label>
                          Equipment type
                          <select
                            value={draft.category}
                            onChange={(e) =>
                              update(
                                "category",
                                e.target.value as AssetInput["category"],
                              )
                            }
                          >
                            {CATEGORIES.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Manufacturer
                          <input
                            value={draft.manufacturer}
                            list="manufacturers"
                            placeholder="Select or type"
                            maxLength={120}
                            onChange={(e) =>
                              update("manufacturer", e.target.value)
                            }
                          />
                          <datalist id="manufacturers">
                            {MAKES.map((m) => (
                              <option key={m} value={m} />
                            ))}
                          </datalist>
                        </label>
                      </div>
                      <div className="model-quantity">
                        <label>
                          Model / description
                          <input
                            value={draft.model}
                            placeholder="e.g. OptiPlex 7050"
                            maxLength={240}
                            onChange={(e) => update("model", e.target.value)}
                          />
                        </label>
                        <label>
                          Quantity
                          <input
                            type="number"
                            min={1}
                            max={10000}
                            step={1}
                            value={draft.quantity}
                            onChange={(e) =>
                              update("quantity", Number(e.target.value))
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Data storage status
                        <select
                          value={draft.storageStatus}
                          onChange={(e) =>
                            update(
                              "storageStatus",
                              e.target.value as StorageStatus,
                            )
                          }
                        >
                          {Object.entries(STORAGE).map(([key, text]) => (
                            <option key={key} value={key}>
                              {text}
                            </option>
                          ))}
                        </select>
                      </label>
                      {draft.storageStatus === "wiped-verified" && (
                        <div className="verification-fields">
                          <p className="hint">
                            Record the completed IT verification. Saving here
                            does not perform or certify a wipe.
                          </p>
                          <label>
                            Wipe method / record reference
                            <input
                              value={draft.wipeReference}
                              onChange={(e) =>
                                update("wipeReference", e.target.value)
                              }
                              required
                              maxLength={500}
                            />
                          </label>
                          <div className="field-grid">
                            <label>
                              Verified by
                              <input
                                value={draft.verifiedBy}
                                onChange={(e) =>
                                  update("verifiedBy", e.target.value)
                                }
                                required
                                maxLength={160}
                              />
                            </label>
                            <label>
                              Verification date
                              <input
                                type="date"
                                value={draft.verifiedAt.slice(0, 10)}
                                onChange={(e) =>
                                  update("verifiedAt", e.target.value)
                                }
                                required
                              />
                            </label>
                          </div>
                        </div>
                      )}
                      <details
                        className="more-details"
                        key={`${editing?.id || "new"}-${draft.batchId}`}
                      >
                        <summary>
                          Location, handling & notes
                          <ChevronDown size={17} />
                        </summary>
                        <div className="detail-fields">
                          <div className="field-grid">
                            <label>
                              Building / room
                              <input
                                value={draft.location}
                                maxLength={240}
                                onChange={(e) =>
                                  update("location", e.target.value)
                                }
                                placeholder="Batch location"
                              />
                            </label>
                            <label>
                              Recorded by
                              <input
                                value={draft.scannedBy}
                                maxLength={160}
                                onChange={(e) =>
                                  update("scannedBy", e.target.value)
                                }
                                placeholder="Name or NetID"
                              />
                            </label>
                          </div>
                          <label>
                            Storage media serial / reference
                            <input
                              value={draft.mediaSerial}
                              maxLength={240}
                              onChange={(e) =>
                                update("mediaSerial", e.target.value)
                              }
                            />
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={draft.handlingFlag}
                              onChange={(e) =>
                                update("handlingFlag", e.target.checked)
                              }
                            />
                            Special handling needed (battery, damage,
                            contamination)
                          </label>
                          <label>
                            Notes
                            <textarea
                              value={draft.notes}
                              rows={2}
                              maxLength={4000}
                              placeholder="Missing label, condition, contents, or handling concern"
                              onChange={(e) => update("notes", e.target.value)}
                            />
                          </label>
                        </div>
                      </details>
                      {draft.captures.length > 0 && (
                        <details className="capture-history">
                          <summary>
                            Original label readings ({draft.captures.length})
                          </summary>
                          {draft.captures.map((c, i) => (
                            <div key={i}>
                              <small>
                                {
                                  {
                                    manual: "Manual entry",
                                    keyboard: "Keyboard scanner",
                                    barcode: "Camera barcode",
                                    "photo-barcode": "Barcode from photo",
                                    ocr: "Text from photo",
                                  }[c.source]
                                }{" "}
                                · {c.format}
                              </small>
                              <pre>{c.value}</pre>
                            </div>
                          ))}
                          <p className="hint">
                            Original readings are retained in your export.
                            Prefixes are never automatically removed.
                          </p>
                        </details>
                      )}
                      {!draftRetained && (
                        <p className="notice warning">
                          Draft recovery is unavailable. Save this entry before
                          leaving the page.
                        </p>
                      )}
                      {draft.captures.at(-1)?.source === "barcode" &&
                        !editing && (
                          <label className="checkbox-label scan-next">
                            <input
                              type="checkbox"
                              checked={continueScanning}
                              onChange={(e) =>
                                setContinueScanning(e.target.checked)
                              }
                            />
                            Return to camera after saving
                          </label>
                        )}
                      <div className="save-row">
                        <button
                          className="button primary save-button"
                          type="submit"
                          disabled={saving}
                        >
                          <Check size={20} />
                          {saving
                            ? "Saving…"
                            : editing
                              ? "Save changes"
                              : "Save & next"}
                        </button>
                        <button
                          className="button subtle"
                          type="button"
                          onClick={reset}
                          disabled={saving}
                        >
                          {editing ? "Cancel edit" : "Clear entry"}
                        </button>
                      </div>
                      <p className="save-hint">
                        <HardDrive size={13} />
                        Saved on this device. Export before clearing browser
                        data.
                      </p>
                    </fieldset>
                  </form>
                </>
              )
            )}
          </section>
          <section
            className={`inventory-panel ${tab !== "inventory" ? "mobile-hidden" : ""}`}
            aria-labelledby="inventory-heading"
          >
            <div className="inventory-top">
              <div>
                <h2 id="inventory-heading">Saved equipment</h2>
              </div>
              <button
                className="text-button desktop-tools"
                aria-label="Backup and offline tools"
                onClick={() => openDialog("tools")}
              >
                <Settings2 size={17} />
                Export &amp; tools
              </button>
            </div>
            <div className="stats">
              <div>
                <strong>{quantity.toLocaleString()}</strong>
                <span>items saved</span>
              </div>
              <button
                className={reviewOnly ? "stat-review selected" : "stat-review"}
                onClick={() => setReviewOnly(!reviewOnly)}
                aria-pressed={reviewOnly}
              >
                <strong>{reviewCount}</strong>
                <span>records to review</span>
              </button>
            </div>
            <div className="inventory-toolbar">
              <label className="search">
                <Search size={18} />
                <input
                  aria-label="Search equipment"
                  placeholder="Search serial, tag, model…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button"
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                  >
                    <X size={16} />
                  </button>
                )}
              </label>
              <button
                className={
                  reviewOnly ? "filter-button active" : "filter-button"
                }
                aria-pressed={reviewOnly}
                onClick={() => setReviewOnly(!reviewOnly)}
              >
                <AlertCircle size={16} />
                Review
              </button>
            </div>
            <div className="inventory-list panel">
              {!assets.length ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <Package size={38} />
                  </div>
                  <h3>No equipment saved yet</h3>
                  <p>
                    Use Scan with camera, Label photo, or the form to add your
                    first item.
                  </p>
                  <button
                    className="button mobile-only"
                    onClick={() => setTab("capture")}
                  >
                    Capture equipment
                  </button>
                </div>
              ) : !filtered.length ? (
                <div className="empty-state small">
                  <Search size={30} />
                  <h3>No matching equipment</h3>
                  <button
                    className="text-button"
                    onClick={() => {
                      setSearch("");
                      setReviewOnly(false);
                    }}
                  >
                    Show all records
                  </button>
                </div>
              ) : (
                <>
                  <div className="list-header">
                    <span>EQUIPMENT</span>
                    <span>IDENTIFIERS</span>
                    <span>REVIEW</span>
                    <span className="sr-only">Actions</span>
                  </div>
                  <ul>
                    {filtered.map((a) => {
                      const reasons = reviewReasons(a);
                      return (
                        <li className="asset-row" key={a.id}>
                          <div className="asset-description">
                            <span className="equipment-icon">
                              <Package size={20} />
                            </span>
                            <div>
                              <strong>
                                {[a.manufacturer, a.model]
                                  .filter(Boolean)
                                  .join(" ") || a.category}
                              </strong>
                              <span>
                                {a.category}
                                {a.quantity > 1 ? ` · Qty ${a.quantity}` : ""}
                              </span>
                              <small>
                                {a.location || "No location recorded"}
                              </small>
                            </div>
                          </div>
                          <div className="asset-identifiers">
                            <strong className="mono">
                              {a.serial || "No serial recorded"}
                            </strong>
                            <span>
                              {a.assetTag
                                ? `UCSB ${a.assetTag}`
                                : a.assetState === "not-found"
                                  ? "No asset tag found"
                                  : "Asset tag not checked"}
                            </span>
                          </div>
                          <div className="review-cell">
                            {reasons.length ? (
                              <details>
                                <summary className="review-badge">
                                  <AlertCircle size={14} />
                                  {reasons.length}{" "}
                                  {reasons.length === 1 ? "check" : "checks"}
                                </summary>
                                <ul>
                                  {reasons.map((reason) => (
                                    <li key={reason}>{reason}</li>
                                  ))}
                                </ul>
                              </details>
                            ) : (
                              <span className="checked-badge">
                                <CheckCircle2 size={14} />
                                Recorded
                              </span>
                            )}
                          </div>
                          <div className="row-actions">
                            <button
                              className="icon-button"
                              aria-label={`Edit ${a.serial || a.assetTag || a.model || a.category}`}
                              disabled={
                                saving || (dirty && editing?.id !== a.id)
                              }
                              onClick={() => edit(a)}
                            >
                              <Pencil size={17} />
                            </button>
                            <button
                              className="icon-button danger-icon"
                              aria-label={`Delete ${a.serial || a.assetTag || a.model || a.category}`}
                              disabled={saving}
                              onClick={() => setDeleteConfirm(a)}
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
            <div className="export-bar">
              <div>
                <strong>
                  {assets.length} saved{" "}
                  {assets.length === 1 ? "record" : "records"}
                </strong>
                <p>Export includes every saved record in this batch.</p>
              </div>
              <button
                className="button primary"
                disabled={!assets.length}
                onClick={() => void exportCsv()}
              >
                <Download size={18} />
                Export CSV
              </button>
            </div>
            <div className="utility-links">
              <button onClick={() => void backup()}>
                <FileJson size={16} />
                Back up all batches
              </button>
              <button onClick={() => openDialog("help")}>
                <BookOpen size={16} />
                UCSB disposal guidance
              </button>
            </div>
            <p className="inventory-note">
              Review flags highlight missing details and handling follow-up.
              They do not determine disposal approval.
            </p>
          </section>
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Workspace">
        <button
          className={tab === "capture" ? "active" : ""}
          aria-current={tab === "capture" ? "page" : undefined}
          onClick={() => setTab("capture")}
        >
          <ScanLine size={22} />
          Capture
        </button>
        <button
          className={tab === "inventory" ? "active" : ""}
          aria-current={tab === "inventory" ? "page" : undefined}
          onClick={() => setTab("inventory")}
        >
          <Package size={22} />
          Inventory <span>{assets.length}</span>
        </button>
        <button onClick={() => openDialog("tools")}>
          <Download size={21} />
          Export & tools
        </button>
      </nav>
      {capture && (
        <CaptureBoundary onClose={() => setCapture(null)}>
          <Suspense
            fallback={
              <Dialog title="Opening capture" onClose={() => setCapture(null)}>
                <p>Loading label tools…</p>
              </Dialog>
            }
          >
            <CapturePanel
              mode={capture.mode}
              target={capture.target}
              onCapture={acceptCapture}
              onClose={() => setCapture(null)}
            />
          </Suspense>
        </CaptureBoundary>
      )}
      {dialog === "batch" && batchDraft && (
        <Dialog
          error={error}
          title="Batch details"
          onClose={() => setDialog(null)}
        >
          <form onSubmit={saveBatchSettings} className="dialog-form">
            <p className="hint">
              Defaults fill new entries. Saved equipment keeps its own details.
            </p>
            <label>
              Batch name
              <input
                value={batchDraft.name}
                required
                maxLength={160}
                onChange={(e) =>
                  setBatchDraft({ ...batchDraft, name: e.target.value })
                }
              />
            </label>
            <label>
              Department
              <input
                value={batchDraft.department}
                maxLength={200}
                placeholder="e.g. Mechanical Engineering"
                onChange={(e) =>
                  setBatchDraft({ ...batchDraft, department: e.target.value })
                }
              />
            </label>
            <label>
              Default building / room
              <input
                value={batchDraft.location}
                maxLength={500}
                onChange={(e) =>
                  setBatchDraft({ ...batchDraft, location: e.target.value })
                }
              />
            </label>
            <label>
              Default recorded by
              <input
                value={batchDraft.scannedBy}
                maxLength={200}
                onChange={(e) =>
                  setBatchDraft({ ...batchDraft, scannedBy: e.target.value })
                }
              />
            </label>
            <div className="field-grid">
              <label>
                Default equipment type
                <select
                  value={batchDraft.defaultCategory}
                  onChange={(e) =>
                    setBatchDraft({
                      ...batchDraft,
                      defaultCategory: e.target
                        .value as Batch["defaultCategory"],
                    })
                  }
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Default manufacturer
                <input
                  value={batchDraft.defaultManufacturer}
                  list="manufacturers"
                  maxLength={200}
                  onChange={(e) =>
                    setBatchDraft({
                      ...batchDraft,
                      defaultManufacturer: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={saving}
              >
                Save batch details
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {dialog === "new" && (
        <Dialog
          error={error}
          title="New collection batch"
          onClose={() => setDialog(null)}
        >
          <form onSubmit={addBatch} className="dialog-form">
            <p className="hint">
              Your previous batches remain saved on this device.
            </p>
            <label>
              Batch name
              <input
                autoFocus
                value={newName}
                maxLength={200}
                placeholder="e.g. Engineering lab · fall collection"
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={saving}
              >
                Create batch
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {deleteConfirm && (
        <Dialog
          error={error}
          title="Delete this item?"
          onClose={() => setDeleteConfirm(null)}
        >
          <p>
            <strong>
              {deleteConfirm.serial ||
                deleteConfirm.assetTag ||
                deleteConfirm.model ||
                deleteConfirm.category}
            </strong>{" "}
            will be removed from this device’s batch. Previous exported files
            are unchanged.
          </p>
          <p className="hint">
            You can undo the most recent deletion during this visit.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setDeleteConfirm(null)}>
              Keep item
            </button>
            <button
              className="button danger"
              disabled={saving}
              onClick={() => void remove()}
            >
              Delete item
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "tools" && (
        <Dialog
          error={error}
          notice={notice}
          title="Export & device tools"
          onClose={() => setDialog(null)}
        >
          <button className="text-button" onClick={() => openDialog("help")}>
            <BookOpen size={17} />
            Quick reference
          </button>
          <div className="tools-section">
            <h3>
              <Download size={19} />
              Export this batch
            </h3>
            <p className="hint">
              {assets.length} saved records. Unfinished entries are not
              included.
            </p>
            <div className="button-row">
              <button
                className="button primary"
                disabled={!assets.length}
                onClick={() => void exportCsv()}
              >
                <Download size={17} />
                Download CSV
              </button>
              {typeof navigator.share === "function" && (
                <button
                  className="button"
                  disabled={!assets.length}
                  onClick={() => void exportCsv(true)}
                >
                  <Share2 size={17} />
                  Share CSV
                </button>
              )}
            </div>
            <p className="hint">
              In Excel or Google Sheets, import serial and asset-number columns
              as text to keep leading zeros. Use JSON for exact archival values.
            </p>
          </div>
          <div className="tools-section">
            <h3>
              <FileJson size={19} />
              Backup & transfer
            </h3>
            <p className="hint">
              JSON includes all saved batches and original readings. Restore on
              another device to continue. Existing records are never
              overwritten.
            </p>
            <div className="button-row">
              <button className="button" onClick={() => void backup()}>
                <Download size={17} />
                Download backup
              </button>
              <button
                className="button"
                disabled={saving}
                onClick={() => upload.current?.click()}
              >
                <Upload size={17} />
                Restore backup
              </button>
            </div>
            {backupTooLarge && (
              <div className="notice warning">
                <span>
                  Back up each batch separately. Choose a batch in the main
                  screen, then return here. For a batch that exceeds the limit,
                  keep its CSV export for recovery.
                </span>
                <button className="button" onClick={() => void backup(true)}>
                  Download batch backup
                </button>
              </div>
            )}
            <input
              ref={upload}
              className="sr-only"
              type="file"
              accept=".json,application/json"
              aria-label="Restore JSON backup"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void restore(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="tools-section">
            <h3>
              {offline.status === "ready" ? (
                <ShieldCheck size={20} />
              ) : (
                <HardDrive size={20} />
              )}
              Offline tools
            </h3>
            <p role="status">{offline.message}</p>
            <p className="hint">
              Open this app online and wait for Offline ready before entering a
              dead zone. The download includes barcode and text readers (about 8
              MB).
            </p>
            <div className="button-row">
              <button
                className="button"
                disabled={offlineBusy}
                onClick={async () => {
                  setOfflineBusy(true);
                  try {
                    await prepareOffline();
                    setNotice("Offline files checked.");
                  } catch (e) {
                    setError(getMessage(e));
                  } finally {
                    setOfflineBusy(false);
                  }
                }}
              >
                <RefreshCw size={17} />
                {offlineBusy ? "Checking…" : "Check offline files"}
              </button>
              <button
                className="button"
                onClick={async () => {
                  try {
                    const granted = await requestPersistence();
                    setPersistent(granted);
                  } catch (e) {
                    setError(getMessage(e));
                  }
                }}
              >
                <HardDrive size={17} />
                Request persistent storage
              </button>
            </div>
            {persistent !== null && (
              <p className="hint">
                {persistent
                  ? "Browser persistence granted. Backups are still needed."
                  : "This browser did not grant persistent storage. Download regular backups."}
              </p>
            )}
            {offline.updateAvailable && (
              <div className="notice warning">
                <span>App update ready. Save or clear your entry first.</span>
                <button
                  className="button"
                  disabled={dirty || !!editing}
                  onClick={() =>
                    void applyUpdate()
                      .then(() => location.reload())
                      .catch((e) => setError(getMessage(e)))
                  }
                >
                  Install update
                </button>
              </div>
            )}
            <p className="hint">
              Browser data can be removed by the browser or by clearing site
              data. Installed apps, tabs and other browsers may use separate
              storage.
            </p>
          </div>
          <div className="tools-section">
            <h3>Install on your phone (optional)</h3>
            <p className="hint">
              iPhone / iPad: Safari → Share → Add to Home Screen. Android:
              Chrome menu → Install app or Add to Home screen.
            </p>
          </div>
        </Dialog>
      )}
      {dialog === "help" && (
        <Dialog title="Quick reference" onClose={() => setDialog(null)} wide>
          <ol className="quick-steps">
            <li>
              <strong>Set the batch.</strong> Use Batch details beside the batch
              name to set the department, room and staff defaults.
            </li>
            <li>
              <strong>Read a label.</strong> Choose Scan with camera, Label
              photo, or USB / Bluetooth. You can also type in Serial number.
            </li>
            <li>
              <strong>Check and save.</strong> Verify the serial, asset tag and
              data storage status. Save &amp; next adds one record and clears
              the item fields.
            </li>
            <li>
              <strong>Export the batch.</strong> Export CSV downloads the saved
              records. Download backup keeps all batches and original readings
              for later restore.
            </li>
          </ol>
          <details className="help-details">
            <summary>Unreadable labels, offline use &amp; permissions</summary>
            <p>
              For a damaged barcode, use Label photo → Read text. Crop close to
              the label. Check O/0 and I/1, then choose Use identifier.
            </p>
            <p>
              If camera access is denied, choose Photo or Scanner in the capture
              window, or close it and type the identifier. Only the camera
              requires camera permission.
            </p>
            <p>
              For several identical items without serials or asset tags, enter a
              Model / description and Quantity.
            </p>
            <p>
              Before going offline, open the app online and wait for Offline
              ready. Download backup regularly; clearing browser data removes
              the saved inventory. If site storage is blocked, use a normal
              browser window with storage allowed before saving equipment.
            </p>
            <p>
              Do not remove S, 1S or leading zeros unless the equipment label
              confirms they are not part of the serial. Product barcodes often
              identify a model, not an individual device.
            </p>
          </details>
          <details className="help-details">
            <summary>UCSB disposal steps &amp; official forms</summary>
            <p className="help-intro">
              This app prepares an inventory. It does not submit campus forms or
              approve disposal.
            </p>
            <ol className="guidance-list">
              <li>
                <strong>Record the asset number.</strong>
                <p>
                  For equipment with an assigned UCSB Asset number, use the
                  Equipment Inventory Modification Request (EIMR). Current form
                  guidance specifies “Transfer” and “Surplus Sales.” Confirm
                  inventory status with your equipment custodian when uncertain.
                </p>
                <a
                  href="https://bfs.ucsb.edu/equipment/forms"
                  target="_blank"
                  rel="noreferrer"
                >
                  Equipment Management forms
                </a>
              </li>
              <li>
                <strong>Arrange the campus handoff.</strong>
                <p>
                  Follow EIMR approval and Surplus / Furniture Services
                  instructions. Items larger than 2 × 2 × 2 feet or heavier than
                  50 lb require a Furniture Services pickup. Coordinate items
                  without an asset number with Surplus; do not infer disposal
                  eligibility from purchase price.
                </p>
                <a
                  href="https://www.dls.ucsb.edu/surplus-sales/ucsb-departments"
                  target="_blank"
                  rel="noreferrer"
                >
                  Surplus for UCSB departments
                </a>
              </li>
              <li>
                <strong>Verify storage and flag special handling.</strong>
                <p>
                  Record IT verification of wiped storage, or flag it for
                  sanitization or removal. Seek EH&S handling guidance for loose
                  departmental batteries, damaged batteries, contamination or
                  hazardous equipment.
                </p>
                <a
                  href="https://www.dls.ucsb.edu/furniture-services/ucsb-e-waste-recycling-disposal"
                  target="_blank"
                  rel="noreferrer"
                >
                  E-waste recycling & disposal
                </a>
                <a
                  href="https://www.ehs.ucsb.edu/programs-services/hazardous-waste"
                  target="_blank"
                  rel="noreferrer"
                >
                  Environmental Health & Safety
                </a>
              </li>
            </ol>
          </details>
          <div className="tools-section">
            <h3>Data stays on your device</h3>
            <p>
              There is no account, analytics, cloud OCR or automatic upload.
              Export files only to approved departmental locations. Avoid
              passwords, security keys and unnecessary personal information in
              notes.
            </p>
            <p className="hint">
              The public site distributes app files; GitHub receives ordinary
              web requests. Inventory and photos are processed locally. Guidance
              links checked 29 September 2026; official UCSB instructions
              govern.
            </p>
          </div>
        </Dialog>
      )}
    </>
  );
}
