import { openDB, type IDBPDatabase } from "idb";
import {
  CATEGORIES,
  type Asset,
  type AssetInput,
  type Backup,
  type Batch,
  type Capture,
  type Category,
  type StorageStatus,
  type AssetState,
} from "./types";

const DB_NAME = "ucsb-surplus-scanner";
const DB_VERSION = 1;
const DEFAULT_BATCH_NAME = "Equipment collection";
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const MAX_BACKUP_RECORDS = 20_000;

interface Stores {
  batches: { key: string; value: Batch };
  assets: { key: string; value: Asset; indexes: { "by-batch": string } };
}

export class ConflictError extends Error {
  constructor(
    message = "This record changed elsewhere. Reload it before saving.",
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

export class DuplicateError extends Error {
  readonly existing: Asset;

  constructor(existing: Asset, field: "serial" | "asset tag") {
    super(
      `This ${field} matches ${existing.manufacturer} ${existing.model || "equipment"} already in this batch.`,
    );
    this.name = "DuplicateError";
    this.existing = existing;
  }
}

export class DataStorageError extends Error {
  constructor(
    message = "Local browser storage is unavailable. Your changes were not saved.",
  ) {
    super(message);
    this.name = "DataStorageError";
  }
}

let dbPromise: Promise<IDBPDatabase<Stores>> | undefined;

function getDatabase(): Promise<IDBPDatabase<Stores>> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new DataStorageError());
  if (!dbPromise) {
    dbPromise = openDB<Stores>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("batches"))
          db.createObjectStore("batches", { keyPath: "id" });
        if (!db.objectStoreNames.contains("assets")) {
          const assets = db.createObjectStore("assets", { keyPath: "id" });
          assets.createIndex("by-batch", "batchId", { unique: false });
        }
      },
      blocked() {
        dbPromise = undefined;
      },
      blocking() {
        dbPromise = undefined;
      },
    }).catch((error: unknown) => {
      dbPromise = undefined;
      throw asStorageError(error);
    });
  }
  return dbPromise;
}

function asStorageError(error: unknown): Error {
  if (
    error instanceof ConflictError ||
    error instanceof DuplicateError ||
    error instanceof DataStorageError ||
    error instanceof TypeError
  )
    return error;
  const detail = error instanceof Error ? ` ${error.message}` : "";
  return new DataStorageError(
    `Local browser storage failed.${detail} Your changes were not saved.`,
  );
}

function abortTransaction(transaction: {
  done: Promise<unknown>;
  abort(): void;
}): void {
  // idb rejects `done` for an intentional abort; observe it before aborting so callers see our domain error.
  void transaction.done.catch(() => undefined);
  transaction.abort();
}

function id(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function now(): string {
  return new Date().toISOString();
}

function makeDefaultBatch(): Batch {
  const timestamp = now();
  return {
    id: id(),
    name: DEFAULT_BATCH_NAME,
    department: "",
    location: "",
    scannedBy: "",
    defaultCategory: "Other",
    defaultManufacturer: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
  };
}

export function comparisonKey(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
}

const STORAGE_STATUSES: readonly StorageStatus[] = [
  "unknown",
  "none",
  "needs-sanitization",
  "wiped-verified",
  "removed",
];
const ASSET_STATES: readonly AssetState[] = ["unknown", "present", "not-found"];
const CAPTURE_SOURCES = [
  "manual",
  "keyboard",
  "barcode",
  "photo-barcode",
  "ocr",
] as const;
const SUSPICIOUS_CONTROL = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function text(value: unknown): value is string {
  return typeof value === "string";
}

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function validIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function validIsoTimestamp(value: string): boolean {
  if (!ISO_TIMESTAMP.test(value)) return false;
  const parsed = new Date(value);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString() ===
      (value.includes(".") ? value : value.replace("Z", ".000Z"))
  );
}

function validateCapture(capture: unknown): string[] {
  if (!isRecord(capture)) return ["Each capture must be an object."];
  if (!hasExactKeys(capture, ["value", "source", "format", "capturedAt"]))
    return ["Capture fields are invalid."];
  const errors: string[] = [];
  if (!text(capture.value) || capture.value.length > 20_000)
    errors.push("Capture value must be text no longer than 20,000 characters.");
  if (!(CAPTURE_SOURCES as readonly unknown[]).includes(capture.source))
    errors.push("Capture source is invalid.");
  if (!text(capture.format) || capture.format.length > 100)
    errors.push("Capture format must be text no longer than 100 characters.");
  if (!text(capture.capturedAt) || !validIsoTimestamp(capture.capturedAt))
    errors.push("Capture date must be a valid ISO timestamp.");
  return errors;
}

export function validateAsset(asset: AssetInput): string[] {
  if (!isRecord(asset)) return ["Asset must be an object."];
  const candidate = asset as unknown as Record<string, unknown>;
  const errors: string[] = [];
  const stringLimits: Record<string, number> = {
    batchId: 128,
    manufacturer: 120,
    model: 240,
    serial: 240,
    assetTag: 160,
    mediaSerial: 240,
    wipeReference: 500,
    verifiedBy: 160,
    verifiedAt: 10,
    location: 240,
    scannedBy: 160,
    notes: 4_000,
  };
  for (const [field, limit] of Object.entries(stringLimits)) {
    const value = candidate[field];
    if (!text(value)) errors.push(`${field} must be text.`);
    else if (value.length > limit)
      errors.push(`${field} must be ${limit} characters or fewer.`);
  }
  if (!(CATEGORIES as readonly unknown[]).includes(candidate.category))
    errors.push("Category is invalid.");
  if (!(ASSET_STATES as readonly unknown[]).includes(candidate.assetState))
    errors.push("Asset state is invalid.");
  if (
    !(STORAGE_STATUSES as readonly unknown[]).includes(candidate.storageStatus)
  )
    errors.push("Storage status is invalid.");
  if (
    typeof candidate.quantity !== "number" ||
    !Number.isSafeInteger(candidate.quantity) ||
    candidate.quantity < 1 ||
    candidate.quantity > 10_000
  ) {
    errors.push("Quantity must be a whole number from 1 to 10,000.");
  }
  if (typeof candidate.handlingFlag !== "boolean")
    errors.push("Handling flag must be true or false.");
  if (!Array.isArray(candidate.captures) || candidate.captures.length > 100)
    errors.push("Captures must be a list of no more than 100 entries.");
  else
    candidate.captures.forEach((capture) =>
      errors.push(...validateCapture(capture)),
    );

  for (const field of ["serial", "assetTag", "mediaSerial"] as const) {
    const value = candidate[field];
    if (text(value) && SUSPICIOUS_CONTROL.test(value))
      errors.push(
        `${field} contains a control character; review the identifier.`,
      );
  }
  const serial = text(candidate.serial) ? candidate.serial.trim() : "";
  const assetTag = text(candidate.assetTag) ? candidate.assetTag.trim() : "";
  if (candidate.assetState === "present" && !assetTag)
    errors.push("Record the asset tag when its state is present.");
  if (candidate.assetState === "not-found" && assetTag)
    errors.push("A not-found asset tag cannot have a recorded tag value.");
  if (text(candidate.batchId) && !saneId(candidate.batchId))
    errors.push("Batch ID is invalid.");
  if (!serial && !assetTag) {
    const model = text(candidate.model) ? candidate.model.trim() : "";
    const notes = text(candidate.notes) ? candidate.notes.trim() : "";
    if (!model && !notes)
      errors.push(
        "Add a model or useful notes when no serial number or asset tag is available.",
      );
  }
  if (
    typeof candidate.quantity === "number" &&
    candidate.quantity > 1 &&
    (serial || assetTag)
  ) {
    errors.push(
      "Quantity greater than one is only allowed when serial number and asset tag are both blank.",
    );
  }
  if (candidate.storageStatus === "wiped-verified") {
    if (!text(candidate.wipeReference) || !nonBlank(candidate.wipeReference))
      errors.push("Enter a wipe method or reference for verified wiping.");
    if (!text(candidate.verifiedBy) || !nonBlank(candidate.verifiedBy))
      errors.push("Enter the verifier for verified wiping.");
    if (!text(candidate.verifiedAt) || !validIsoDate(candidate.verifiedAt))
      errors.push("Enter a valid verification date for verified wiping.");
  } else if (
    text(candidate.verifiedAt) &&
    candidate.verifiedAt &&
    !validIsoDate(candidate.verifiedAt)
  ) {
    errors.push("Verification date must use YYYY-MM-DD.");
  }
  return [...new Set(errors)];
}

export function reviewReasons(asset: AssetInput): string[] {
  const reasons: string[] = [];
  if (asset.assetState === "unknown")
    reasons.push("Check for a UCSB asset tag.");
  if (!asset.serial.trim() && !asset.assetTag.trim())
    reasons.push("No serial number or asset tag was recorded.");
  if (asset.storageStatus === "unknown")
    reasons.push("Storage media status has not been checked.");
  if (asset.storageStatus === "needs-sanitization")
    reasons.push(
      "Storage media needs sanitization before release or recycling.",
    );
  if (
    asset.storageStatus === "wiped-verified" &&
    (!asset.wipeReference.trim() ||
      !asset.verifiedBy.trim() ||
      !asset.verifiedAt.trim())
  ) {
    reasons.push("Verified wipe details are incomplete.");
  }
  if (asset.handlingFlag)
    reasons.push("Review the handling flag and arrange the approved route.");
  return reasons;
}

export async function listBatches(): Promise<Batch[]> {
  try {
    const db = await getDatabase();
    const tx = db.transaction("batches", "readwrite");
    const store = tx.objectStore("batches");
    const batches = await store.getAll();
    if (batches.length === 0) {
      const initial = makeDefaultBatch();
      await store.add(initial);
      await tx.done;
      return [initial];
    }
    await tx.done;
    return batches.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  } catch (error) {
    throw asStorageError(error);
  }
}

export async function createBatch(name = "New batch"): Promise<Batch> {
  const timestamp = now();
  const batch: Batch = {
    id: id(),
    name: name.trim().slice(0, 500) || "New batch",
    department: "",
    location: "",
    scannedBy: "",
    defaultCategory: "Other",
    defaultManufacturer: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
  };
  try {
    const db = await getDatabase();
    const tx = db.transaction("batches", "readwrite");
    await tx.objectStore("batches").add(batch);
    await tx.done;
    return batch;
  } catch (error) {
    throw asStorageError(error);
  }
}

export async function saveBatch(input: Batch): Promise<Batch> {
  const errors = validateBatch(input);
  if (errors.length) throw new TypeError(errors.join(" "));
  try {
    const db = await getDatabase();
    const tx = db.transaction("batches", "readwrite");
    const store = tx.objectStore("batches");
    const existing = await store.get(input.id);
    if (!existing || existing.revision !== input.revision) {
      abortTransaction(tx);
      throw new ConflictError(
        existing ? undefined : "This batch no longer exists.",
      );
    }
    const updated: Batch = {
      ...input,
      updatedAt: now(),
      revision: existing.revision + 1,
    };
    await store.put(updated);
    await tx.done;
    return updated;
  } catch (error) {
    throw asStorageError(error);
  }
}

function validateBatch(value: unknown): string[] {
  if (!isRecord(value)) return ["Batch must be an object."];
  const errors: string[] = [];
  for (const field of [
    "id",
    "name",
    "department",
    "location",
    "scannedBy",
    "defaultManufacturer",
    "createdAt",
    "updatedAt",
  ] as const) {
    if (!text(value[field])) errors.push(`Batch ${field} must be text.`);
    else if (value[field].length > 500)
      errors.push(`Batch ${field} is too long.`);
  }
  if (text(value.id) && !saneId(value.id)) errors.push("Batch ID is invalid.");
  if (!text(value.name) || !nonBlank(value.name))
    errors.push("Batch name cannot be blank.");
  if (!text(value.createdAt) || !validIsoTimestamp(value.createdAt))
    errors.push("Batch creation date is invalid.");
  if (!text(value.updatedAt) || !validIsoTimestamp(value.updatedAt))
    errors.push("Batch update date is invalid.");
  if (!(CATEGORIES as readonly unknown[]).includes(value.defaultCategory))
    errors.push("Batch default category is invalid.");
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1)
    errors.push("Batch revision is invalid.");
  return errors;
}

export async function listAssets(batchId: string): Promise<Asset[]> {
  try {
    const db = await getDatabase();
    const assets = await db.getAllFromIndex("assets", "by-batch", batchId);
    return assets.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
  } catch (error) {
    throw asStorageError(error);
  }
}

export async function saveAsset(
  input: AssetInput,
  assetId?: string,
  expectedRevision?: number,
): Promise<Asset> {
  const errors = validateAsset(input);
  if (errors.length) throw new TypeError(errors.join(" "));
  const canonical: AssetInput = {
    ...input,
    serial: input.serial.trim(),
    assetTag: input.assetTag.trim(),
  };
  try {
    const db = await getDatabase();
    const tx = db.transaction(["assets", "batches"], "readwrite");
    const assets = tx.objectStore("assets");
    const batch = await tx.objectStore("batches").get(canonical.batchId);
    if (!batch) {
      abortTransaction(tx);
      throw new ConflictError("The selected batch no longer exists.");
    }
    const existing = assetId ? await assets.get(assetId) : undefined;
    if (
      assetId &&
      (!existing ||
        expectedRevision === undefined ||
        existing.revision !== expectedRevision)
    ) {
      abortTransaction(tx);
      throw new ConflictError(
        existing ? undefined : "This asset no longer exists.",
      );
    }
    const records = await assets.index("by-batch").getAll(canonical.batchId);
    checkDuplicate(canonical, records, assetId);
    const timestamp = now();
    const saved: Asset = {
      ...canonical,
      id: existing?.id ?? id(),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      revision: existing ? existing.revision + 1 : 1,
    };
    await assets.put(saved);
    await tx.done;
    return saved;
  } catch (error) {
    throw asStorageError(error);
  }
}

function checkDuplicate(
  candidate: Pick<AssetInput, "serial" | "assetTag">,
  records: Asset[],
  excludingId?: string,
): void {
  const serialKey = comparisonKey(candidate.serial);
  const tagKey = comparisonKey(candidate.assetTag);
  for (const record of records) {
    if (record.id === excludingId) continue;
    if (serialKey && serialKey === comparisonKey(record.serial))
      throw new DuplicateError(record, "serial");
    if (tagKey && tagKey === comparisonKey(record.assetTag))
      throw new DuplicateError(record, "asset tag");
  }
}

export async function deleteAsset(
  assetId: string,
  expectedRevision: number,
): Promise<Asset> {
  try {
    const db = await getDatabase();
    const tx = db.transaction("assets", "readwrite");
    const store = tx.objectStore("assets");
    const existing = await store.get(assetId);
    if (!existing || existing.revision !== expectedRevision) {
      abortTransaction(tx);
      throw new ConflictError(
        existing ? undefined : "This asset no longer exists.",
      );
    }
    await store.delete(assetId);
    await tx.done;
    return existing;
  } catch (error) {
    throw asStorageError(error);
  }
}

export async function restoreAsset(asset: Asset): Promise<void> {
  const errors = validateFullAsset(asset);
  if (errors.length) throw new TypeError(errors.join(" "));
  try {
    const db = await getDatabase();
    const tx = db.transaction(["assets", "batches"], "readwrite");
    const store = tx.objectStore("assets");
    if (!(await tx.objectStore("batches").get(asset.batchId))) {
      abortTransaction(tx);
      throw new ConflictError("The original batch no longer exists.");
    }
    const existing = await store.get(asset.id);
    if (existing) {
      abortTransaction(tx);
      throw new ConflictError("An asset with this ID already exists.");
    }
    const batchAssets = await store.index("by-batch").getAll(asset.batchId);
    checkDuplicate(asset, batchAssets);
    await store.add(asset);
    await tx.done;
  } catch (error) {
    throw asStorageError(error);
  }
}

export async function makeBackup(): Promise<Backup> {
  try {
    const db = await getDatabase();
    const tx = db.transaction(["batches", "assets"], "readonly");
    const [batches, assets] = await Promise.all([
      tx.objectStore("batches").getAll(),
      tx.objectStore("assets").getAll(),
    ]);
    await tx.done;
    return {
      schema: "ucsb-surplus-scanner",
      version: 1,
      exportedAt: now(),
      batches,
      assets,
    };
  } catch (error) {
    throw asStorageError(error);
  }
}

export function encodeBackup(backup: Backup): string {
  const encoded = JSON.stringify(backup);
  if (
    backup.batches.length + backup.assets.length > MAX_BACKUP_RECORDS ||
    new TextEncoder().encode(encoded).byteLength > MAX_BACKUP_BYTES
  ) {
    throw new Error(
      "This backup exceeds the restore limit (10 MB or 20,000 batches/items). Download one batch at a time from Export & device tools.",
    );
  }
  return encoded;
}

export async function importBackup(
  textValue: string,
): Promise<{ added: number; skipped: number; conflicts: number }> {
  if (
    typeof textValue !== "string" ||
    new TextEncoder().encode(textValue).byteLength > MAX_BACKUP_BYTES
  ) {
    throw new TypeError("Backup must be no larger than 10 MB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textValue);
  } catch {
    throw new TypeError("Backup is not valid JSON.");
  }
  const incoming = validateBackup(parsed);
  if (incoming.batches.length + incoming.assets.length > MAX_BACKUP_RECORDS) {
    throw new TypeError(
      `Backup cannot contain more than ${MAX_BACKUP_RECORDS.toLocaleString()} records.`,
    );
  }

  try {
    const db = await getDatabase();
    const tx = db.transaction(["batches", "assets"], "readwrite");
    const batchStore = tx.objectStore("batches");
    const assetStore = tx.objectStore("assets");
    const [localBatches, localAssets] = await Promise.all([
      batchStore.getAll(),
      assetStore.getAll(),
    ]);
    const batchesById = new Map(localBatches.map((batch) => [batch.id, batch]));
    const assetsById = new Map(localAssets.map((asset) => [asset.id, asset]));
    const availableBatchIds = new Set([
      ...batchesById.keys(),
      ...incoming.batches.map((batch) => batch.id),
    ]);
    const missingParent = incoming.assets.find(
      (asset) => !availableBatchIds.has(asset.batchId),
    );
    if (missingParent) {
      abortTransaction(tx);
      throw new TypeError(
        `Asset ${missingParent.id} refers to batch ${missingParent.batchId}, which is absent from this backup and this browser.`,
      );
    }
    const localAndIncomingAssets = [...localAssets];
    const conflictingBatchIds = new Set<string>();
    let added = 0;
    let skipped = 0;
    let conflicts = 0;

    for (const batch of incoming.batches) {
      const existing = batchesById.get(batch.id);
      if (!existing) {
        await batchStore.add(batch);
        batchesById.set(batch.id, batch);
        added++;
      } else if (sameJson(existing, batch)) skipped++;
      else {
        conflicts++;
        conflictingBatchIds.add(batch.id);
      }
    }

    for (const asset of incoming.assets) {
      if (conflictingBatchIds.has(asset.batchId)) {
        conflicts++;
        continue;
      }
      const byId = assetsById.get(asset.id);
      if (byId) {
        if (sameJson(byId, asset)) skipped++;
        else conflicts++;
        continue;
      }
      const duplicate = findDuplicate(
        asset,
        localAndIncomingAssets.filter(
          (candidate) => candidate.batchId === asset.batchId,
        ),
      );
      if (duplicate) {
        conflicts++;
        continue;
      }
      await assetStore.add(asset);
      assetsById.set(asset.id, asset);
      localAndIncomingAssets.push(asset);
      added++;
    }
    await tx.done;
    return { added, skipped, conflicts };
  } catch (error) {
    throw asStorageError(error);
  }
}

function findDuplicate(
  candidate: Pick<AssetInput, "serial" | "assetTag">,
  records: Asset[],
): Asset | undefined {
  const serialKey = comparisonKey(candidate.serial);
  const tagKey = comparisonKey(candidate.assetTag);
  return records.find(
    (record) =>
      (serialKey && serialKey === comparisonKey(record.serial)) ||
      (tagKey && tagKey === comparisonKey(record.assetTag)),
  );
}

function sameJson(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function validateBackup(value: unknown): Backup {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema",
      "version",
      "exportedAt",
      "batches",
      "assets",
    ])
  ) {
    throw new TypeError("Backup structure is invalid.");
  }
  if (
    value.schema !== "ucsb-surplus-scanner" ||
    value.version !== 1 ||
    !text(value.exportedAt) ||
    !validIsoTimestamp(value.exportedAt)
  ) {
    throw new TypeError("Backup schema, version, or export date is invalid.");
  }
  if (!Array.isArray(value.batches) || !Array.isArray(value.assets))
    throw new TypeError("Backup batches and assets must be lists.");
  if (value.batches.length + value.assets.length > MAX_BACKUP_RECORDS)
    throw new TypeError(
      `Backup cannot contain more than ${MAX_BACKUP_RECORDS.toLocaleString()} records.`,
    );
  const batches = value.batches.map((entry) => {
    const errors = validateFullBatch(entry);
    if (errors.length)
      throw new TypeError(`Invalid batch: ${errors.join(" ")}`);
    return entry as unknown as Batch;
  });
  const assets = value.assets.map((entry) => {
    const errors = validateFullAsset(entry);
    if (errors.length)
      throw new TypeError(`Invalid asset: ${errors.join(" ")}`);
    return entry as unknown as Asset;
  });
  if (new Set(batches.map((batch) => batch.id)).size !== batches.length)
    throw new TypeError("Backup contains duplicate batch IDs.");
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length)
    throw new TypeError("Backup contains duplicate asset IDs.");
  return {
    schema: "ucsb-surplus-scanner",
    version: 1,
    exportedAt: value.exportedAt,
    batches,
    assets,
  };
}

function validateFullBatch(value: unknown): string[] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "name",
      "department",
      "location",
      "scannedBy",
      "defaultCategory",
      "defaultManufacturer",
      "createdAt",
      "updatedAt",
      "revision",
    ])
  )
    return ["Batch fields are invalid."];
  return validateBatch(value);
}

function validateFullAsset(value: unknown): string[] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "batchId",
      "createdAt",
      "updatedAt",
      "revision",
      "category",
      "manufacturer",
      "model",
      "serial",
      "assetTag",
      "assetState",
      "quantity",
      "storageStatus",
      "mediaSerial",
      "wipeReference",
      "verifiedBy",
      "verifiedAt",
      "location",
      "scannedBy",
      "notes",
      "handlingFlag",
      "captures",
    ])
  )
    return ["Asset fields are invalid."];
  if (!saneId(value.id) || !saneId(value.batchId))
    return ["Asset ID or batch ID is invalid."];
  if (
    !text(value.createdAt) ||
    !validIsoTimestamp(value.createdAt) ||
    !text(value.updatedAt) ||
    !validIsoTimestamp(value.updatedAt)
  )
    return ["Asset timestamps are invalid."];
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1)
    return ["Asset revision is invalid."];
  return validateAsset(value as unknown as AssetInput);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function saneId(value: unknown): value is string {
  return text(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function csvCell(value: unknown): string {
  let source = value == null ? "" : String(value);
  if (/^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(source)) source = `'${source}`;
  return `"${source.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS: Array<
  [string, (batch: Batch, asset?: Asset, exportedAt?: string) => unknown]
> = [
  ["Exported At", (_batch, _asset, exportedAt) => exportedAt],
  ["Batch ID", (batch) => batch.id],
  ["Batch Name", (batch) => batch.name],
  ["Department", (batch) => batch.department],
  ["Batch Location", (batch) => batch.location],
  ["Scanned By", (batch) => batch.scannedBy],
  ["Asset ID", (_batch, asset) => asset?.id],
  ["Asset Revision", (_batch, asset) => asset?.revision],
  ["Item Created At", (_batch, asset) => asset?.createdAt],
  ["Item Updated At", (_batch, asset) => asset?.updatedAt],
  ["Category", (_batch, asset) => asset?.category],
  ["Manufacturer", (_batch, asset) => asset?.manufacturer],
  ["Model", (_batch, asset) => asset?.model],
  ["Serial", (_batch, asset) => asset?.serial],
  ["Asset Tag", (_batch, asset) => asset?.assetTag],
  ["Asset State", (_batch, asset) => asset?.assetState],
  ["Quantity", (_batch, asset) => asset?.quantity],
  ["Storage Status", (_batch, asset) => asset?.storageStatus],
  ["Media Serial", (_batch, asset) => asset?.mediaSerial],
  ["Wipe Reference", (_batch, asset) => asset?.wipeReference],
  ["Verified By", (_batch, asset) => asset?.verifiedBy],
  ["Verified At", (_batch, asset) => asset?.verifiedAt],
  ["Location", (_batch, asset) => asset?.location],
  ["Item Scanned By", (_batch, asset) => asset?.scannedBy],
  ["Handling Flag", (_batch, asset) => asset?.handlingFlag],
  ["Notes", (_batch, asset) => asset?.notes],
  [
    "Raw Captures JSON",
    (_batch, asset) => (asset ? JSON.stringify(asset.captures) : ""),
  ],
];

export function assetsToCsv(batch: Batch, assets: Asset[]): string {
  const exportedAt = now();
  const lines = [CSV_COLUMNS.map(([header]) => csvCell(header)).join(",")];
  for (const asset of assets)
    lines.push(
      CSV_COLUMNS.map(([, value]) =>
        csvCell(value(batch, asset, exportedAt)),
      ).join(","),
    );
  // Quote fields and neutralize formula-leading values; spreadsheet imports still need text column types.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function exportFilename(batch: Batch, ext: "csv" | "json"): string {
  const source = batch.department.trim() || batch.name;
  const slug =
    source
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "equipment_collection";
  return `ucsb_ewaste_${slug}_${now().slice(0, 10)}.${ext}`;
}
