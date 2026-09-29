import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import {
  assetsToCsv,
  comparisonKey,
  createBatch,
  DataStorageError,
  deleteAsset,
  DuplicateError,
  exportFilename,
  encodeBackup,
  importBackup,
  listAssets,
  listBatches,
  makeBackup,
  restoreAsset,
  saveAsset,
  saveBatch,
  validateAsset,
  reviewReasons,
} from "./data";
import type { AssetInput, Batch, Capture } from "./types";

const DB_NAME = "ucsb-surplus-scanner";
const fixedDate = "2026-09-29T12:00:00.000Z";

async function clearData(): Promise<void> {
  await listBatches();
  const db = await openDB(DB_NAME, 1);
  const tx = db.transaction(["assets", "batches"], "readwrite");
  await Promise.all([
    tx.objectStore("assets").clear(),
    tx.objectStore("batches").clear(),
  ]);
  await tx.done;
  db.close();
}

async function batch(): Promise<Batch> {
  const created = await createBatch("Lab sweep");
  return { ...created, department: "Engineering", location: "Room 12" };
}

function assetInput(
  batchId: string,
  overrides: Partial<AssetInput> = {},
): AssetInput {
  return {
    batchId,
    category: "Laptop",
    manufacturer: "Dell",
    model: "Latitude 7440",
    serial: "",
    assetTag: "",
    assetState: "unknown",
    quantity: 1,
    storageStatus: "unknown",
    mediaSerial: "",
    wipeReference: "",
    verifiedBy: "",
    verifiedAt: "",
    location: "Room 12",
    scannedBy: "Staff",
    notes: "",
    handlingFlag: false,
    captures: [],
    ...overrides,
  };
}

function capture(value: string): Capture {
  return {
    value,
    source: "barcode",
    format: "CODE_128",
    capturedAt: fixedDate,
  };
}

beforeEach(clearData);

describe("local data layer", () => {
  it("creates exactly one initial batch when first-use calls race", async () => {
    const calls = await Promise.all([
      listBatches(),
      listBatches(),
      listBatches(),
    ]);
    expect(calls.flat().map((item) => item.id)).toHaveLength(3);
    expect(new Set(calls.flat().map((item) => item.id)).size).toBe(1);
    expect(calls[0][0].name).toBe("Equipment collection");
    expect(calls[0][0].defaultManufacturer).toBe("");
  });

  it("protects batch edits with revisions", async () => {
    const created = await batch();
    const saved = await saveBatch(created);
    expect(saved.revision).toBe(created.revision + 1);
    await expect(saveBatch(created)).rejects.toMatchObject({
      name: "ConflictError",
    });
  });

  it("serializes duplicate checks in concurrent saves and allows edits only at the current revision", async () => {
    const currentBatch = await batch();
    const sameSerialA = assetInput(currentBatch.id, { serial: "  AbC-001 " });
    const sameSerialB = assetInput(currentBatch.id, {
      serial: "abc-001",
      model: "Other model",
    });
    const results = await Promise.allSettled([
      saveAsset(sameSerialA),
      saveAsset(sameSerialB),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason).toBeInstanceOf(
      DuplicateError,
    );
    const saved = (await listAssets(currentBatch.id))[0];
    expect(saved.serial).toBe("AbC-001");
    const edited = await saveAsset(
      { ...sameSerialA, model: "Latitude 7450" },
      saved.id,
      saved.revision,
    );
    expect(edited.revision).toBe(saved.revision + 1);
    await expect(
      saveAsset(sameSerialA, saved.id, saved.revision),
    ).rejects.toMatchObject({ name: "ConflictError" });
  });

  it("preserves raw captures and leading-zero/prefix identifier text through JSON backup", async () => {
    const currentBatch = await batch();
    const raw = "  1S0O-00042  ";
    const saved = await saveAsset(
      assetInput(currentBatch.id, {
        serial: "  00123 ",
        assetTag: "  SB-0007 ",
        captures: [capture(raw)],
      }),
    );
    expect(saved.serial).toBe("00123");
    expect(saved.assetTag).toBe("SB-0007");
    expect(saved.captures[0].value).toBe(raw);
    const backup = await makeBackup();
    expect(JSON.stringify(backup)).toContain(raw);
    expect(JSON.stringify(backup)).toContain("00123");
  });

  it("exports UTF-8 BOM, RFC 4180 quoting, formula protection, and raw capture JSON", async () => {
    const currentBatch = { ...(await batch()), name: '=Inventory, "fall"' };
    const saved = await saveAsset(
      assetInput(currentBatch.id, {
        model: 'Desk, "Latitude"\r\nrev 2',
        serial: "00017",
        notes: '  =HYPERLINK("x")',
        location: "\t =cmd",
        captures: [capture("S/1S:00017")],
      }),
    );
    const csv = assetsToCsv(currentBatch, [saved]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=Inventory, ""fall"""');
    expect(csv).toContain('"Desk, ""Latitude""\r\nrev 2"');
    expect(csv).toContain('"\'  =HYPERLINK(""x"")"');
    expect(csv).toContain('"\'\t =cmd"');
    expect(csv).toContain('"[{""value"":""S/1S:00017""');
    expect(csv.match(/"Exported At"/gu)).toHaveLength(1);
    expect(csv).toContain(`"${saved.createdAt}"`);
    expect(csv).toContain(`"${saved.updatedAt}"`);
    expect(csv).not.toContain('"metadata"');
    expect(csv).toContain("\r\n");
    expect(
      exportFilename({ ...currentBatch, department: "ME 179L" }, "csv"),
    ).toMatch(/^ucsb_ewaste_me_179l_\d{4}-\d{2}-\d{2}\.csv$/u);
  });

  it("merges valid backups idempotently, skips IDs without overwrite, and reports identifier conflicts", async () => {
    const currentBatch = await batch();
    const saved = await saveAsset(
      assetInput(currentBatch.id, { serial: "SN-1" }),
    );
    const source = await makeBackup();
    expect(await importBackup(JSON.stringify(source))).toEqual({
      added: 0,
      skipped: 2,
      conflicts: 0,
    });
    const changed = { ...saved, model: "Local edit", revision: 2 };
    const db = await openDB(DB_NAME, 1);
    await db.put("assets", changed);
    db.close();
    expect(await importBackup(JSON.stringify(source))).toEqual({
      added: 0,
      skipped: 1,
      conflicts: 1,
    });
    const colliding: AssetInput = assetInput(currentBatch.id, {
      serial: "sn-1",
      model: "Another item",
    });
    const separate = {
      ...source,
      assets: [
        {
          ...colliding,
          id: "different-id",
          createdAt: fixedDate,
          updatedAt: fixedDate,
          revision: 1,
        },
      ],
    };
    expect(await importBackup(JSON.stringify(separate))).toEqual({
      added: 0,
      skipped: 1,
      conflicts: 1,
    });
    expect((await listAssets(currentBatch.id))[0].model).toBe("Local edit");
  });

  it("rejects malformed, unbounded, and invalid-date backups before writing anything", async () => {
    const currentBatch = await batch();
    const original = await makeBackup();
    await expect(importBackup("{broken")).rejects.toThrow("valid JSON");
    await expect(
      importBackup(" ".repeat(10 * 1024 * 1024 + 1)),
    ).rejects.toThrow("10 MB");
    const invalid = {
      ...original,
      assets: [
        {
          ...assetInput(currentBatch.id),
          id: "valid-id",
          createdAt: "not a date",
          updatedAt: fixedDate,
          revision: 1,
        },
      ],
    };
    await expect(importBackup(JSON.stringify(invalid))).rejects.toThrow(
      "timestamps",
    );
    const injected = JSON.parse(JSON.stringify(original)) as Record<
      string,
      unknown
    >;
    Object.defineProperty(injected, "__proto__", {
      enumerable: true,
      value: { polluted: true },
    });
    await expect(importBackup(JSON.stringify(injected))).rejects.toThrow(
      "structure",
    );
    const alteredAsset = {
      ...original,
      assets: [
        {
          ...assetInput(currentBatch.id),
          id: "extra-field-id",
          createdAt: fixedDate,
          updatedAt: fixedDate,
          revision: 1,
          injected: "ignored?",
        },
      ],
    };
    await expect(importBackup(JSON.stringify(alteredAsset))).rejects.toThrow(
      "fields are invalid",
    );
    expect(await listAssets(currentBatch.id)).toEqual([]);
  });

  it("allows an omitted parent only when it exists locally and rejects unresolved parents atomically", async () => {
    const currentBatch = await batch();
    const importedAsset = {
      ...assetInput(currentBatch.id),
      id: "asset-from-partial",
      createdAt: fixedDate,
      updatedAt: fixedDate,
      revision: 1,
    };
    const partial = {
      schema: "ucsb-surplus-scanner",
      version: 1,
      exportedAt: fixedDate,
      batches: [],
      assets: [importedAsset],
    };
    expect(await importBackup(JSON.stringify(partial))).toEqual({
      added: 1,
      skipped: 0,
      conflicts: 0,
    });
    await clearData();
    const unresolved = {
      ...partial,
      assets: [
        { ...importedAsset, id: "orphaned-asset", batchId: "missing-batch" },
      ],
    };
    await expect(importBackup(JSON.stringify(unresolved))).rejects.toThrow(
      "absent from this backup and this browser",
    );
    expect(await listBatches()).toHaveLength(1);
    expect(await listAssets("missing-batch")).toEqual([]);
  });

  it("does not attach backup assets to a local batch whose same ID has conflicting contents", async () => {
    const currentBatch = await batch();
    await saveAsset(assetInput(currentBatch.id, { serial: "SERIAL-1" }));
    const source = await makeBackup();
    const db = await openDB(DB_NAME, 1);
    const localBatch = await db.get("batches", currentBatch.id);
    if (!localBatch) throw new Error("test batch missing");
    await db.put("batches", {
      ...localBatch,
      name: "Changed local batch",
      revision: localBatch.revision + 1,
    });
    db.close();
    expect(await importBackup(JSON.stringify(source))).toEqual({
      added: 0,
      skipped: 0,
      conflicts: 2,
    });
    expect(await listAssets(currentBatch.id)).toHaveLength(1);
    expect((await listBatches())[0].name).toBe("Changed local batch");
  });

  it("restores a deleted record once and checks duplicates in the restore transaction", async () => {
    const currentBatch = await batch();
    const saved = await saveAsset(
      assetInput(currentBatch.id, { assetTag: "TAG-5" }),
    );
    const removed = await deleteAsset(saved.id, saved.revision);
    await restoreAsset(removed);
    await expect(restoreAsset(removed)).rejects.toMatchObject({
      name: "ConflictError",
    });
    await expect(
      restoreAsset({ ...removed, id: "another-id" }),
    ).rejects.toBeInstanceOf(DuplicateError);
  });

  it("rejects unsafe/no-description and incomplete wipe records", async () => {
    const currentBatch = await batch();
    const noDescription = assetInput(currentBatch.id, {
      model: "  ",
      notes: " ",
    });
    await expect(saveAsset(noDescription)).rejects.toThrow("useful notes");
    const control = assetInput(currentBatch.id, { serial: "AB\u0000CD" });
    await expect(saveAsset(control)).rejects.toThrow("control character");
    const incompleteWipe = assetInput(currentBatch.id, {
      model: "Desktop",
      storageStatus: "wiped-verified",
    });
    await expect(saveAsset(incompleteWipe)).rejects.toThrow(
      "wipe method or reference",
    );
  });

  it("keeps unknown asset-tag state reviewable and enforces present/not-found consistency", async () => {
    const currentBatch = await batch();
    const unknown = assetInput(currentBatch.id);
    expect(reviewReasons(unknown)).toContain("Check for a UCSB asset tag.");
    expect(
      validateAsset(
        assetInput(currentBatch.id, { assetState: "present", assetTag: "" }),
      ),
    ).toContain("Record the asset tag when its state is present.");
    expect(
      validateAsset(
        assetInput(currentBatch.id, {
          assetState: "not-found",
          assetTag: "TAG-1",
        }),
      ),
    ).toContain("A not-found asset tag cannot have a recorded tag value.");
    expect(
      validateAsset(assetInput(currentBatch.id, { quantity: 10_001 })),
    ).toContain("Quantity must be a whole number from 1 to 10,000.");
  });

  it("fails clearly when IndexedDB is unavailable and keeps comparison keys literal about zeros and prefixes", async () => {
    expect(comparisonKey(" s/1s:0008 ")).toBe("S/1S:0008");
    expect(comparisonKey("S/1S:0008")).not.toBe(comparisonKey("0008"));
    const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    try {
      await expect(listBatches()).rejects.toBeInstanceOf(DataStorageError);
    } finally {
      if (original) Object.defineProperty(globalThis, "indexedDB", original);
    }
  });
});

it("only creates backup files within the same limits accepted by restore", async () => {
  const backup = await makeBackup();
  const encoded = encodeBackup(backup);
  expect(JSON.parse(encoded)).toEqual(backup);
  expect(await importBackup(encoded)).toMatchObject({ added: 0, conflicts: 0 });
  const tooLarge = {
    ...backup,
    batches: Array.from({ length: 20001 }, () => backup.batches[0]),
  };
  expect(() => encodeBackup(tooLarge)).toThrow("restore limit");
});
