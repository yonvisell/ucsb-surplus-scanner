import { expect, test, type Page } from "@playwright/test";

async function waitForOfflineReady(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Offline ready" })).toBeVisible(
    { timeout: 30_000 },
  );
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(
    true,
  );
}

async function showCapture(page: Page): Promise<void> {
  const navigation = page.getByRole("navigation", { name: "Workspace" });
  if (await navigation.isVisible())
    await navigation.getByRole("button", { name: "Capture" }).click();
}

test("prepares every published asset and retains a saved entry across reload", async ({
  page,
  context,
  browserName,
}) => {
  await page.goto("./");
  await waitForOfflineReady(page);
  const missing = await page.evaluate(async () => {
    const manifest = (await (await fetch("offline-manifest.json")).json()) as {
      base: string;
      release: string;
      assets: Array<{ url: string }>;
    };
    const cache = await caches.open(
      `ucsb-surplus-scanner::${manifest.base}::${manifest.release}`,
    );
    const urls = [
      ...manifest.assets.map((asset) => asset.url),
      `${manifest.base}offline-manifest.json`,
    ];
    return (
      await Promise.all(
        urls.map(async (url) => ({ url, present: !!(await cache.match(url)) })),
      )
    )
      .filter((asset) => !asset.present)
      .map((asset) => asset.url);
  });
  expect(missing).toEqual([]);

  const serial = "OFFLINE-RELOAD-001";
  await page.getByLabel("Serial number", { exact: true }).fill(serial);
  await page.getByRole("button", { name: "Save & next" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `${serial} saved on this device.` }),
  ).toBeVisible();

  // Playwright WebKit currently fails an offline reload even with a minimal
  // single-file service worker; Chromium exercises the actual offline path.
  if (browserName === "chromium") await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: browserName === "chromium" ? "Working offline" : "Offline ready",
    }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Workspace" });
  if (await navigation.isVisible())
    await navigation.getByRole("button", { name: /Inventory/ }).click();
  await expect(
    page.locator(".asset-row .asset-identifiers").filter({ hasText: serial }),
  ).toBeVisible();

  // The capture dialog is a separate JS chunk and has not been opened before
  // the connection was removed.
  await showCapture(page);
  await page.getByRole("button", { name: "Label photo" }).click();
  await expect(
    page.getByRole("dialog", { name: "Capture serial number" }),
  ).toBeVisible();
  const assetResults = await page.evaluate(async () => {
    const manifest = (await (await fetch("offline-manifest.json")).json()) as {
      assets: Array<{ url: string; bytes: number }>;
    };
    const vendor = manifest.assets.filter((asset) =>
      asset.url.includes("/vendor/"),
    );
    return Promise.all(
      vendor.map(async (asset) => {
        const response = await fetch(asset.url);
        return {
          url: asset.url,
          ok: response.ok,
          bytes: (await response.arrayBuffer()).byteLength,
          expected: asset.bytes,
        };
      }),
    );
  });
  expect(assetResults.length).toBeGreaterThanOrEqual(4);
  for (const asset of assetResults) {
    expect(asset.ok, asset.url).toBe(true);
    expect(asset.bytes, asset.url).toBeGreaterThan(0);
    // Servers may send .gz model files with Content-Encoding: gzip, in which
    // case fetch exposes the decoded bytes rather than the source file size.
    if (!asset.url.endsWith(".gz"))
      expect(asset.bytes, asset.url).toBe(asset.expected);
  }
});

test("shows a failed IndexedDB write without claiming the entry was saved", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "assets")
        throw new DOMException("Write access denied", "QuotaExceededError");
      return Reflect.apply(originalPut, this, args);
    };
  });
  await page.goto("./");
  await expect(page.getByLabel("Serial number", { exact: true })).toBeVisible();

  await page
    .getByLabel("Serial number", { exact: true })
    .fill("DENIED-WRITE-001");
  await page.getByRole("button", { name: "Save & next" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your changes were not saved.",
  );
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    "DENIED-WRITE-001",
  );
  await expect(page.locator(".export-bar strong")).toHaveText(
    "0 saved records",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "saved on this device" }),
  ).toHaveCount(0);
});

test("reports that inventory storage cannot open", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get() {
        throw new DOMException("Site storage denied", "SecurityError");
      },
    });
  });
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText(
    "Inventory storage could not open.",
  );
  await expect(page.getByRole("alert")).toContainText("records can be saved");
  await expect(page.getByRole("button", { name: "Save & next" })).toHaveCount(
    0,
  );
});

test("failed offline repair preserves the cached app shell", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Playwright WebKit cannot reload even a minimal service worker offline.",
  );
  await page.goto("./");
  await waitForOfflineReady(page);
  const release = await page.evaluate(async () => {
    const manifest = (await (await fetch("offline-manifest.json")).json()) as {
      base: string;
      release: string;
      assets: Array<{ url: string }>;
    };
    const cacheName = `ucsb-surplus-scanner::${manifest.base}::${manifest.release}`;
    const model = manifest.assets.find((asset) =>
      asset.url.endsWith("/eng.traineddata.gz"),
    );
    if (!model)
      throw new Error("Expected OCR model is missing from the manifest.");
    const cache = await caches.open(cacheName);
    if (!(await cache.delete(model.url)))
      throw new Error("Expected cached OCR model was not present.");
    return { cacheName, shell: `${manifest.base}index.html` };
  });

  await context.setOffline(true);
  await expect(
    page.getByRole("button", { name: "Offline setup" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Offline setup" }).click();
  const tools = page.getByRole("dialog", { name: "Export & device tools" });
  await tools.getByRole("button", { name: "Check offline files" }).click();
  await expect(tools.getByRole("alert")).toBeVisible();
  expect(
    await page.evaluate(async ({ cacheName, shell }) => {
      const cache = await caches.open(cacheName);
      return !!(await cache.match(shell));
    }, release),
  ).toBe(true);

  await page.reload();
  await expect(page.getByLabel("Serial number", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Offline setup" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Offline ready" })).toHaveCount(
    0,
  );
});

test("does not claim offline readiness if an installation asset fails", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Service-worker request interception is verified in Chromium.",
  );
  test.setTimeout(80_000);
  await page.clock.install();
  let failedRequests = 0;
  await context.route("**/vendor/eng.traineddata.gz", async (route) => {
    failedRequests++;
    await route.fulfill({ status: 503, body: "simulated unavailable model" });
  });
  await page.goto("./");
  await expect
    .poll(() => failedRequests, { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Offline ready" })).toHaveCount(
    0,
  );

  // The registration's ready promise cannot resolve after an install failure.
  // Advance the app's explicit 60-second timeout without a minute of wall time.
  await page.clock.fastForward(61_000);
  await expect(
    page.getByRole("button", { name: "Offline setup" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Offline setup" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Export & device tools" })
      .getByRole("status"),
  ).toContainText("Offline installation did not finish");
  await expect(page.getByRole("button", { name: "Offline ready" })).toHaveCount(
    0,
  );
});

test("missing capture code leaves the manual entry available", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route("**/assets/CapturePanel-*.js", (route) =>
    route.abort("failed"),
  );
  await page.goto(baseURL!);
  await expect(page.getByLabel("Serial number", { exact: true })).toBeVisible();
  await page
    .getByLabel("Serial number", { exact: true })
    .fill("RETAIN-DRAFT-01");
  await page.getByRole("button", { name: "Label photo", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Label tools could not load" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Return to entry", exact: true })
    .click();
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    "RETAIN-DRAFT-01",
  );
  await page.getByRole("button", { name: "Save & next", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "RETAIN-DRAFT-01 saved on this device." }),
  ).toBeVisible();
  await context.close();
});
