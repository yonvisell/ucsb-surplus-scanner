import { expect, test } from "@playwright/test";
import bwipjs from "bwip-js";

type CameraFixtureWindow = Window & {
  revealCameraLabel: () => void;
  cameraTracks: MediaStreamTrack[];
};

for (const trigger of ["automatic", "manual after resize"] as const) {
  test(`portrait camera capture matches the visible window: ${trigger}`, async ({
    page,
    browserName,
  }, testInfo) => {
    test.setTimeout(90_000);
    test.skip(
      browserName !== "chromium",
      "Synthetic canvas camera streams are exercised in Chromium.",
    );
    const qr = await bwipjs.toBuffer({
      bcid: "qrcode",
      text: "FRAME-ONLY-001",
      scale: 5,
      padding: 8,
    });
    await page.addInitScript(
      (qrUrl) => {
        const fixture = window as CameraFixtureWindow;
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: async () => {
            const canvas = document.createElement("canvas");
            canvas.width = 900;
            canvas.height = 1600;
            const ctx = canvas.getContext("2d")!;
            const image = new Image();
            image.src = qrUrl;
            await image.decode();
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, 900, 1600);
            // These source regions are outside the centered camera window.
            ctx.fillStyle = "red";
            ctx.fillRect(0, 0, 900, 350);
            ctx.fillStyle = "blue";
            ctx.fillRect(0, 1250, 900, 350);
            fixture.revealCameraLabel = () => {
              ctx.drawImage(image, 360, 710, 180, 180);
            };
            const stream = canvas.captureStream(10);
            fixture.cameraTracks = stream.getTracks();
            return stream;
          },
        });
      },
      `data:image/png;base64,${qr.toString("base64")}`,
    );

    await page.goto("./");
    await page
      .getByRole("button", { name: "Scan with camera", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Capture serial number" });
    const shutter = dialog.getByRole("button", {
      name: "Read this label",
      exact: true,
    });
    await expect(shutter).toBeEnabled();

    if (trigger === "manual after resize") {
      // The crop must follow the current window, not dimensions saved at startup.
      await page.setViewportSize({ width: 740, height: 420 });
      await expect(shutter).toBeEnabled();
    }
    const view = await dialog.locator("video").boundingBox();
    if (!view) throw new Error("Camera window has no visible bounds.");
    expect(view.width / view.height).toBeGreaterThan(1);

    if (trigger === "automatic") {
      await page.evaluate(() =>
        (window as CameraFixtureWindow).revealCameraLabel(),
      );
    } else {
      await shutter.click();
    }

    const preview = dialog.locator(".photo-preview img");
    await expect(preview).toBeVisible({ timeout: 20_000 });
    const captured = await preview.evaluate(async (element) => {
      const img = element as HTMLImageElement;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const corners = [
        [8, 8],
        [canvas.width - 9, 8],
        [8, canvas.height - 9],
        [canvas.width - 9, canvas.height - 9],
      ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
      return { width: canvas.width, height: canvas.height, corners };
    });
    expect(captured.width).toBe(900);
    expect(captured.height).toBeLessThan(900);
    expect(
      Math.abs(captured.width / captured.height - view.width / view.height),
    ).toBeLessThan(0.01);
    for (const rgba of captured.corners) {
      expect(rgba.slice(0, 3).every((value) => value > 235)).toBeTruthy();
    }
    expect(
      await page.evaluate(() =>
        (window as CameraFixtureWindow).cameraTracks.every(
          (track) => track.readyState === "ended",
        ),
      ),
    ).toBeTruthy();
    await testInfo.attach("visible-window-and-captured-frame", {
      body: JSON.stringify({ view, captured }),
      contentType: "application/json",
    });
    if (trigger === "automatic") {
      await expect(dialog.locator(".label-result")).toContainText(
        "FRAME-ONLY-001",
        { timeout: 60_000 },
      );
    }
  });
}
