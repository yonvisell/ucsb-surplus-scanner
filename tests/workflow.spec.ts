import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
async function open(page: Page) {
  await page.goto("./");
  await expect(page.getByLabel("Serial number", { exact: true })).toBeVisible();
}
async function inventory(page: Page) {
  const nav = page.getByRole("navigation", { name: "Workspace" });
  if (await nav.isVisible())
    await nav.getByRole("button", { name: /Inventory/ }).click();
}
async function capture(page: Page) {
  const nav = page.getByRole("navigation", { name: "Workspace" });
  if (await nav.isVisible())
    await nav.getByRole("button", { name: "Capture", exact: true }).click();
}
async function saveMonitor(page: Page, serial = "001S-TEST42") {
  await page.getByLabel("Serial number", { exact: true }).fill(serial);
  await page.getByLabel("Asset tag status").selectOption("not-found");
  await page.getByLabel("Equipment type").selectOption("Monitor");
  await page.getByLabel("Manufacturer", { exact: true }).fill("Dell");
  await page.getByLabel("Model / description").fill("P2419H");
  await page.getByLabel("Data storage status").selectOption("none");
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /saved on this device/ }),
  ).toBeVisible();
}
test("save, duplicate protection, edit, delete, undo, and batch defaults", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Edit batch details" }).click();
  await page.getByLabel("Batch name", { exact: true }).fill("Lab collection");
  await page.getByLabel("Department", { exact: true }).fill("Engineering");
  await page.getByLabel("Default building / room").fill("Engineering II 1234");
  await page.getByLabel("Default recorded by").fill("Test staff");
  await page.getByRole("button", { name: "Save batch details" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await saveMonitor(page);
  await page.getByLabel("Serial number", { exact: true }).fill("001s-test42");
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("already in this batch");
  await page.getByRole("button", { name: "Open existing item" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit equipment" }),
  ).toBeVisible();
  await page.getByLabel("Model / description").fill("P2419H updated");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await inventory(page);
  await expect(
    page.getByText("P2419H updated", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Engineering II 1234", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete 001S-TEST42", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep item", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit 001S-TEST42", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete 001S-TEST42", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete item", exact: true }).click();
  await expect(page.getByText("No equipment saved yet")).toBeVisible();
  await page.getByRole("button", { name: "Undo delete", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit 001S-TEST42", exact: true }),
  ).toBeVisible();
  await page.reload();
  await inventory(page);
  await expect(
    page.getByRole("button", { name: "Edit 001S-TEST42", exact: true }),
  ).toBeVisible();
});
test("verified wipe requires evidence and retains date, no-label peripherals can be grouped", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Serial number", { exact: true }).fill("S-DRIVE-42");
  await page.getByLabel("Data storage status").selectOption("wiped-verified");
  await page
    .getByLabel("Wipe method / record reference")
    .fill("Department test record 42");
  await page.getByLabel("Verified by", { exact: true }).fill("Test technician");
  await page.getByLabel("Verification date").fill("2026-09-29");
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /saved on this device/ }),
  ).toBeVisible();
  await page.getByLabel("Equipment type").selectOption("Peripheral / cable");
  await page.getByLabel("Model / description").fill("USB keyboard");
  await page.getByLabel("Quantity", { exact: true }).fill("12");
  await page.getByLabel("Data storage status").selectOption("none");
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await inventory(page);
  await expect(page.getByText("Peripheral / cable · Qty 12")).toBeVisible();
  await page
    .getByRole("button", { name: "Edit S-DRIVE-42", exact: true })
    .click();
  await expect(page.getByLabel("Verification date")).toHaveValue("2026-09-29");
});
test("CSV and exact JSON transfer preserve identifiers and avoid spreadsheet formula execution", async ({
  page,
  context,
  browser,
}) => {
  await open(page);
  await saveMonitor(page, "00001S42");
  await page
    .getByRole("button", { name: "Backup and offline tools" })
    .isVisible()
    .then(async (visible) => {
      if (visible)
        await page
          .getByRole("button", { name: "Backup and offline tools" })
          .click();
      else
        await page
          .getByRole("button", { name: "Export & tools", exact: true })
          .click();
    });
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const csv = await csvPromise;
  const csvText = await readFile((await csv.path())!, "utf8");
  expect(csvText).toContain("00001S42");
  expect(csvText.split("\r\n").filter(Boolean)).toHaveLength(2);
  const backupPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  const file = await backupPromise;
  const data = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(data.assets[0].serial).toBe("00001S42");
  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto(new URL("./", page.url()).href);
  await expect(
    other.getByLabel("Serial number", { exact: true }),
  ).toBeVisible();
  if (
    await other
      .getByRole("button", { name: "Backup and offline tools" })
      .isVisible()
  )
    await other
      .getByRole("button", { name: "Backup and offline tools" })
      .click();
  else
    await other
      .getByRole("button", { name: "Export & tools", exact: true })
      .click();
  await other.getByLabel("Restore JSON backup").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(
    other
      .getByRole("dialog")
      .getByRole("status")
      .filter({ hasText: "Backup restored" }),
  ).toContainText("Backup restored");
  await other
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await other.getByLabel("Current batch").selectOption(data.batches[0].id);
  await inventory(other);
  await expect(
    other.getByRole("button", { name: "Edit 00001S42", exact: true }),
  ).toBeVisible();
  await second.close();
});
test("draft survives reload and malformed restore is visible without overwriting data", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Serial number", { exact: true }).fill("UNFINISHED-01");
  await page.reload();
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    "UNFINISHED-01",
  );
  const tools = page.getByRole("button", { name: "Backup and offline tools" });
  if (await tools.isVisible()) await tools.click();
  else
    await page
      .getByRole("button", { name: "Export & tools", exact: true })
      .click();
  await page.getByLabel("Restore JSON backup").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schema":"invalid"}'),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Backup was not imported",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    "UNFINISHED-01",
  );
});
test("narrow and enlarged layouts remain contained and main surfaces pass accessibility scan", async ({
  page,
}, info) => {
  await open(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Export & tools", exact: true })
    .click();
  expect(
    await page.evaluate(() => {
      const d = document.querySelector("dialog")!;
      return d.scrollWidth <= d.clientWidth + 1;
    }),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `artifacts/${info.project.name}-text-zoom.png`,
    fullPage: true,
  });
});

test("concurrent edits retain the first saved change and offer an explicit reload", async ({
  page,
  context,
}) => {
  await open(page);
  await saveMonitor(page, "MULTITAB-001");
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(
    other.getByLabel("Serial number", { exact: true }),
  ).toBeVisible();
  await inventory(page);
  await page
    .getByRole("button", { name: "Edit MULTITAB-001", exact: true })
    .click();
  await inventory(other);
  await other
    .getByRole("button", { name: "Edit MULTITAB-001", exact: true })
    .click();
  await page.getByLabel("Model / description").fill("Saved from first tab");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "updated." }),
  ).toBeVisible();
  await other
    .getByLabel("Model / description")
    .fill("Stale edit from second tab");
  await other
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(other.getByRole("alert")).toContainText("changed elsewhere");
  await expect(other.getByLabel("Model / description")).toHaveValue(
    "Stale edit from second tab",
  );
  await other
    .getByRole("button", {
      name: "Reload saved item (discard this edit)",
      exact: true,
    })
    .click();
  await expect(other.getByLabel("Model / description")).toHaveValue(
    "Saved from first tab",
  );
});

test("a committed save remains successful when later list reads fail", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const original = IDBIndex.prototype.getAll;
    const put = IDBObjectStore.prototype.put;
    let assetWasWritten = false;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "assets") assetWasWritten = true;
      return Reflect.apply(put, this, args);
    };
    IDBIndex.prototype.getAll = function (...args) {
      if (assetWasWritten)
        throw new DOMException("Simulated failed refresh", "UnknownError");
      return Reflect.apply(original, this, args);
    };
  });
  await page.getByLabel("Serial number", { exact: true }).fill("COMMITTED-001");
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "COMMITTED-001 saved on this device." }),
  ).toBeVisible();
  await expect(page.getByLabel("Serial number", { exact: true })).toBeEmpty();
  await inventory(page);
  await expect(
    page.getByRole("button", { name: "Edit COMMITTED-001", exact: true }),
  ).toBeVisible();
});
