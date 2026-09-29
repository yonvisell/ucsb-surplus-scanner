import { expect, test, type Page } from "@playwright/test";
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

async function printedLabelPng(
  page: Page,
  lines: string[],
  qrText: string,
  dark: boolean,
): Promise<Buffer> {
  const qr = await bwipjs.toBuffer({
    bcid: "qrcode",
    text: qrText,
    scale: 10,
    padding: 12,
  });
  const base64 = await page.evaluate(
    async ({ lines, qrUrl, dark }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1050;
      const context = canvas.getContext("2d")!;
      context.fillStyle = dark ? "#181818" : "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = dark ? "#fff" : "#111";
      lines.forEach((line, index) => {
        // The model needs a distinct I/1; printed identifiers scan more
        // reliably without the serifs that can split a final 9.
        context.font = index <= 1 ? "bold 64px Georgia" : "bold 64px Arial";
        context.fillText(line, 55, 120 + index * 130);
      });
      const qrImage = new Image();
      qrImage.src = qrUrl;
      await qrImage.decode();
      context.fillStyle = "#fff";
      context.fillRect(1120, 340, 430, 430);
      context.drawImage(qrImage, 1130, 350, 410, 410);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { lines, qrUrl: `data:image/png;base64,${qr.toString("base64")}`, dark },
  );
  return Buffer.from(base64, "base64");
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
    await expect(dialog.getByLabel("Identifier to use")).toHaveValue("");
    await dialog
      .locator(".label-result")
      .filter({ hasText: fixture.text })
      .click();
    if (fixture.bcid === "upca") {
      // ZXing may report UPC-A as its equivalent EAN-13 representation,
      // with one additional leading zero; keep this visible for review.
      const value = await dialog.getByLabel("Identifier to use").inputValue();
      expect([fixture.text, `0${fixture.text}`]).toContain(value);
      expect(await dialog.locator(".label-result small").innerText()).toMatch(
        /^(UPCA|EAN13)\b/,
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

test("full-label photo applies an explicit serial and model without treating the order as a serial", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto(appUrl(testInfo.project.use.baseURL));
  const qrText = "pf7ab2c9pf8xy1234567";
  const image = await printedLabelPng(
    page,
    [
      "Model Name",
      "Legion 5 15IAH7H",
      "S/N PF7AB2C9",
      "MTM 82RB0000US",
      "Manufactured for Lenovo",
      "MO PF8XY1234567",
    ],
    qrText,
    true,
  );
  await page.getByRole("button", { name: "Label photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture serial number" });
  await dialog.getByLabel("Choose label photo").setInputFiles({
    name: "synthetic-label.png",
    mimeType: "image/png",
    buffer: image,
  });
  await dialog.getByRole("button", { name: "Read full label" }).click();
  const review = dialog.getByRole("region", {
    name: "Equipment details found",
  });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await expect(review.getByLabel("Manufacturer found")).toHaveValue("Lenovo");
  await expect(review.getByLabel("Model found")).toHaveValue(
    "Legion 5 15IAH7H",
  );
  await expect(
    review.getByLabel("Equipment type (inferred from model)"),
  ).toHaveValue("Laptop");
  await expect(dialog.getByLabel("Serial number to use")).toHaveValue(
    "PF7AB2C9",
  );
  await expect(dialog.getByLabel("Serial number to use")).not.toHaveValue(
    /PF8XY1234567/i,
  );
  await expect(review).toContainText("MTM");
  await expect(review).toContainText(/82RB[0o]{4}US/i);
  await expect(review).toContainText("MO");
  await expect(review).toContainText("PF8XY1234567");
  await dialog.getByRole("button", { name: "Use label details" }).click();
  await expect(page.getByLabel("Manufacturer", { exact: true })).toHaveValue(
    "Lenovo",
  );
  await expect(page.getByLabel("Model / description")).toHaveValue(
    "Legion 5 15IAH7H",
  );
  await expect(page.getByLabel("Equipment type")).toHaveValue("Laptop");
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    "PF7AB2C9",
  );
  await page.locator(".more-details > summary").click();
  await page.locator(".capture-history summary").click();
  const raw = JSON.parse(
    await page.locator(".capture-history pre").last().innerText(),
  );
  expect(raw.text).toMatch(/S\/N\s+PF7AB2C9/i);
  expect(raw.codes).toEqual(
    expect.arrayContaining([expect.objectContaining({ value: qrText })]),
  );
});

test("metadata-only label and a URL QR preserve the existing serial", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto(appUrl(testInfo.project.use.baseURL));
  await page
    .getByLabel("Serial number", { exact: true })
    .fill("EXISTING-SERIAL-01");
  const url = "https://example.invalid/inventory/12345";
  const image = await printedLabelPng(
    page,
    ["Model Name", "Legion 5 15IAH7H", "Manufactured for Lenovo"],
    url,
    false,
  );
  await page.getByRole("button", { name: "Label photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture serial number" });
  await dialog.getByLabel("Choose label photo").setInputFiles({
    name: "metadata-only-label.png",
    mimeType: "image/png",
    buffer: image,
  });
  await dialog.getByRole("button", { name: "Read full label" }).click();
  const review = dialog.getByRole("region", {
    name: "Equipment details found",
  });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await expect(review.getByLabel("Manufacturer found")).toHaveValue("Lenovo");
  await expect(dialog.getByLabel("Serial number to use")).toHaveValue("");
  await expect(dialog.locator(".label-result")).toContainText(url);
  await dialog.getByRole("button", { name: "Use label details" }).click();
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    "EXISTING-SERIAL-01",
  );
  await expect(page.getByLabel("Manufacturer", { exact: true })).toHaveValue(
    "Lenovo",
  );
  await expect(page.getByLabel("Model / description")).toHaveValue(
    "Legion 5 15IAH7H",
  );
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
        value: {
          getUserMedia: async () => {
            throw new DOMException("Simulated camera failure", name);
          },
        },
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
  await expect(dialog.locator(".label-result")).toContainText(fixtures[0].text);
  await expect(dialog.getByLabel("Identifier to use")).toHaveValue("");
  await dialog.locator(".label-result").click();
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
  await page.locator(".more-details > summary").click();
  await page.locator(".capture-history summary").click();
  await expect(page.locator(".capture-history pre")).toHaveText(
    fixtures[0].text,
  );
});

test("live camera frames are confirmed once and the camera stops for review", async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
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
  await expect(dialog.getByLabel("Choose label photo")).toBeAttached({
    timeout: 20_000,
  });
  await expect(
    dialog.getByRole("button", { name: "Read full label" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("region", { name: "Equipment details found" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(dialog.locator(".label-result")).toContainText(fixtures[0].text);
  await expect(dialog.getByLabel("Serial number to use")).toHaveValue("");
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { cameraTracks: MediaStreamTrack[] }
      ).cameraTracks.every((track) => track.readyState === "ended"),
    ),
  ).toBeTruthy();
  await dialog.getByLabel("Serial number to use").fill(fixtures[0].text);
  await dialog
    .getByRole("button", { name: "Use label details", exact: true })
    .click();
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    fixtures[0].text,
  );
  await expect(
    page.getByRole("button", { name: "Save & next", exact: true }),
  ).toBeVisible();
});
