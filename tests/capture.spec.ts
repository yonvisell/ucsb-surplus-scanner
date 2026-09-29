import { expect, test } from "@playwright/test";
import bwipjs from "bwip-js";

type BarcodeFixture = { bcid: string; text: string; expectedFormat: string };

const fixtures: BarcodeFixture[] = [
  { bcid: "code128", text: "IT-0042197", expectedFormat: "Code128" },
  { bcid: "code39", text: "CODE39-001", expectedFormat: "Code39" },
  { bcid: "qrcode", text: "QR-001273", expectedFormat: "QRCode" },
  { bcid: "datamatrix", text: "DM-001273", expectedFormat: "DataMatrix" },
  { bcid: "ean13", text: "0123456789012", expectedFormat: "EAN13" },
  { bcid: "upca", text: "012345678905", expectedFormat: "UPCA" },
];

async function barcodePng({ bcid, text }: BarcodeFixture): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid, text, scale: 5, height: 35, padding: 35 });
}

function appUrl(baseURL: string | undefined): string {
  if (!baseURL) throw new Error("Playwright baseURL is required");
  return baseURL;
}

test("photo picker reads the required barcode families without remote requests", async ({
  page,
}, testInfo) => {
  const offOrigin: string[] = [];
  const origin = new URL(appUrl(testInfo.project.use.baseURL)).origin;
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      offOrigin.push(request.url());
  });
  await page.goto(appUrl(testInfo.project.use.baseURL));
  await page.getByRole("button", { name: "Label photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture serial number" });
  const input = dialog.getByLabel("Choose label photo");

  for (const fixture of fixtures) {
    await input.setInputFiles({
      name: `${fixture.bcid}.png`,
      mimeType: "image/png",
      buffer: await barcodePng(fixture),
    });
    await expect(
      dialog.getByRole("button", { name: "Read barcode" }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Read barcode" }).click();
    await expect(dialog.locator(".label-result")).toContainText(
      [fixture.text],
      { timeout: 15_000 },
    );
    if (fixture.bcid === "upca") {
      // ZXing may report UPC-A as its equivalent EAN-13 representation,
      // with one additional leading zero; keep this visible for review.
      const value = await dialog.getByLabel("Identifier to use").inputValue();
      expect([fixture.text, `0${fixture.text}`]).toContain(value);
      expect(await dialog.locator(".label-result small").innerText()).toMatch(
        /^(UPCA|EAN13)$/,
      );
    } else {
      await expect(dialog.locator(".label-result")).toContainText([
        fixture.expectedFormat,
      ]);
      await expect(dialog.getByLabel("Identifier to use")).toHaveValue(
        fixture.text,
      );
    }
  }
  expect(offOrigin).toEqual([]);
});

test("photo can be rotated, cropped, and reset visibly", async ({
  page,
}, testInfo) => {
  await page.goto(appUrl(testInfo.project.use.baseURL));
  await page.getByRole("button", { name: "Label photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture serial number" });
  await dialog.getByLabel("Choose label photo").setInputFiles({
    name: "wide-code128.png",
    mimeType: "image/png",
    buffer: await barcodePng(fixtures[0]),
  });
  const preview = dialog.locator(".photo-preview");
  const dimensions = () =>
    preview.locator("img").evaluate((image) => {
      const element = image as HTMLImageElement;
      return { width: element.naturalWidth, height: element.naturalHeight };
    });
  const original = await dimensions();
  expect(original.width).toBeGreaterThan(original.height);
  await dialog.getByRole("button", { name: "Rotate" }).click();
  await expect
    .poll(async () => (await dimensions()).width)
    .toBe(original.height);
  await expect
    .poll(async () => (await dimensions()).height)
    .toBe(original.width);
  await dialog.getByRole("button", { name: "Reset photo" }).click();
  await expect
    .poll(async () => (await dimensions()).width)
    .toBe(original.width);

  const box = await preview.boundingBox();
  if (!box) throw new Error("Photo preview has no visible bounds");
  await page.mouse.move(box.x + box.width * 0.04, box.y + box.height * 0.08);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.96, box.y + box.height * 0.92, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(preview.locator(".crop-box")).toBeVisible();
  await dialog.getByRole("button", { name: "Crop selection" }).click();
  await expect(preview.locator(".crop-box")).toHaveCount(0);
  expect((await dimensions()).width).toBeLessThan(original.width);
  await dialog.getByRole("button", { name: "Read barcode" }).click();
  await expect(dialog.locator(".label-result")).toContainText([
    fixtures[0].text,
  ]);
});

test("scanner Enter retains the full raw identifier for review", async ({
  page,
}, testInfo) => {
  await page.goto(appUrl(testInfo.project.use.baseURL));
  await page.getByRole("button", { name: "USB / Bluetooth" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture serial number" });
  const raw = "1S-00A-0042197";
  await dialog.getByLabel("Scanner input").fill(raw);
  await dialog.getByLabel("Scanner input").press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Serial number" }),
  ).toHaveValue(raw);
  await expect(
    page.getByText(
      "Identifier captured. Check the label, then save the equipment.",
    ),
  ).toBeVisible();
});

test("OCR uses local files with true offline coverage in Chromium", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  const offOrigin: string[] = [];
  const origin = new URL(appUrl(testInfo.project.use.baseURL)).origin;
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      offOrigin.push(request.url());
  });
  await page.goto(appUrl(testInfo.project.use.baseURL));
  await expect(page.getByRole("button", { name: /Offline ready/ })).toBeVisible(
    { timeout: 45_000 },
  );
  // Playwright WebKit's offline toggle also fails on a minimal independent
  // service-worker app. Verify its local OCR online; Chromium verifies offline.
  if (testInfo.project.name !== "webkit-mobile") await context.setOffline(true);
  await page.getByRole("button", { name: "Label photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture serial number" });
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 180;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000";
    context.font = "bold 80px Arial";
    context.fillText("SERIAL A12345", 30, 120);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await dialog.getByLabel("Choose label photo").setInputFiles({
    name: "serial.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await dialog.getByRole("button", { name: "Read text" }).click();
  await expect(
    dialog.getByRole("button", { name: "A12345", exact: true }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await dialog.getByRole("button", { name: "A12345", exact: true }).click();
  await expect(dialog.getByLabel("Identifier to use")).toHaveValue("A12345");
  await dialog.getByRole("button", { name: "Use identifier" }).click();
  await expect(
    page.getByRole("textbox", { name: "Serial number" }),
  ).toHaveValue("A12345");
  expect(offOrigin).toEqual([]);
});

for (const failure of [
  {
    name: "NotAllowedError",
    message: "Camera permission was denied or blocked.",
  },
  { name: "NotFoundError", message: "No usable camera was found." },
])
  test(`camera ${failure.name} leaves photo capture usable`, async ({
    page,
    context,
  }, testInfo) => {
    await page.goto(appUrl(testInfo.project.use.baseURL));
    await page.evaluate((name) => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {getUserMedia: async () => {
          throw new DOMException("Simulated camera failure", name);
        }},
      });
    }, failure.name);
    await page.getByRole("button", { name: "Scan with camera" }).click();
    const dialog = page.getByRole("dialog", { name: "Capture serial number" });
    await expect(dialog.getByRole("alert")).toContainText(failure.message);
    await dialog.getByRole("button", { name: "Use a photo" }).click();
    await dialog.getByLabel("Choose label photo").setInputFiles({
      name: "fallback.png",
      mimeType: "image/png",
      buffer: await barcodePng(fixtures[0]),
    });
    await dialog.getByRole("button", { name: "Read barcode" }).click();
    await expect(dialog.locator(".label-result")).toContainText([
      fixtures[0].text,
    ]);
  });

test("correcting a decoded serial retains the original label reading", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Label photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture serial number" });
  await dialog.getByLabel("Choose label photo").setInputFiles({
    name: "serial.png",
    mimeType: "image/png",
    buffer: await barcodePng(fixtures[0]),
  });
  await dialog
    .getByRole("button", { name: "Read barcode", exact: true })
    .click();
  await expect(dialog.getByLabel("Identifier to use")).toHaveValue(
    fixtures[0].text,
  );
  await dialog.getByLabel("Identifier to use").fill("CORRECTED-001");
  await dialog
    .getByRole("button", { name: "Use identifier", exact: true })
    .click();
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    "CORRECTED-001",
  );
  await page.locator(".capture-history summary").click();
  await expect(page.locator(".capture-history pre")).toHaveText(
    fixtures[0].text,
  );
});

test("live camera frames are confirmed once and the camera stops for review", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Synthetic canvas camera stream is exercised in Chromium.",
  );
  const data =
    "data:image/png;base64," +
    (await barcodePng(fixtures[0])).toString("base64");
  await page.addInitScript((imageUrl) => {
    const testWindow = window as unknown as {
      cameraTracks: MediaStreamTrack[];
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = 900;
        const ctx = canvas.getContext("2d")!;
        const image = new Image();
        image.src = imageUrl;
        await image.decode();
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 1600, 900);
        ctx.drawImage(image, 100, 100, 1400, 650);
        const stream = canvas.captureStream(10);
        testWindow.cameraTracks = stream.getTracks();
        return stream;
      },
    });
  }, data);
  await page.goto("./");
  await page
    .getByRole("button", { name: "Scan with camera", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Capture serial number" });
  await expect(dialog.getByLabel("Identifier to use")).toHaveValue(
    fixtures[0].text,
    { timeout: 15000 },
  );
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { cameraTracks: MediaStreamTrack[] }
      ).cameraTracks.every((track) => track.readyState === "ended"),
    ),
  ).toBeTruthy();
  await dialog
    .getByRole("button", { name: "Use identifier", exact: true })
    .click();
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    fixtures[0].text,
  );
  await expect(
    page.getByRole("button", { name: "Save & next", exact: true }),
  ).toBeVisible();
});
