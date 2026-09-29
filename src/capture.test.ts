import { describe, expect, it } from "vitest";
import { cropPixels, photoToCanvas, scaledDimensions } from "./capture";

describe("bounded image geometry", () => {
  it("preserves aspect ratio and never upscales", () => {
    expect(scaledDimensions(4032, 3024, 2500)).toEqual({
      width: 2500,
      height: 1875,
    });
    expect(scaledDimensions(640, 480, 1600)).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("rejects zero and unreasonably large decoded images", () => {
    expect(() => scaledDimensions(0, 480, 1600)).toThrow(
      "Invalid image dimensions",
    );
    expect(() => scaledDimensions(10_000, 10_000, 2500)).toThrow(
      "50-megapixel",
    );
  });

  it("maps a normalized crop to valid pixel bounds", () => {
    expect(
      cropPixels(1000, 800, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }),
    ).toEqual({ x: 250, y: 200, width: 500, height: 400 });
    expect(
      cropPixels(1000, 800, {
        x: 0.999,
        y: 0.999,
        width: 0.001,
        height: 0.001,
      }),
    ).toEqual({ x: 999, y: 799, width: 1, height: 1 });
    expect(() =>
      cropPixels(1000, 800, { x: 0.8, y: 0, width: 0.3, height: 1 }),
    ).toThrow("Crop");
  });

  it("rejects overlarge photos before decoding", async () => {
    const large = new Blob();
    Object.defineProperty(large, "size", { value: 30 * 1024 * 1024 + 1 });
    await expect(photoToCanvas(large)).rejects.toThrow("30 MB");
  });
});
