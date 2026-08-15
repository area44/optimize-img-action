import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { findImageFiles, optimizeImage, processImages, getOptionsFromEnv } from "../src/index.ts";

const TEST_DIR = join(process.cwd(), "tmp_test_images");

// Helper to generate a dummy large/uncompressed PNG using Bun.Image pipeline from a base 1x1 PNG
async function createTestPng(filepath: string) {
  const base1x1Png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  // Expand 1x1 to 100x100 uncompressed PNG
  const pngBytes = await new Bun.Image(base1x1Png)
    .resize(200, 200)
    .png({ compressionLevel: 0 })
    .bytes();
  await writeFile(filepath, pngBytes);
}

// Helper to generate a dummy JPEG
async function createTestJpeg(filepath: string) {
  const base1x1Png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const jpegBytes = await new Bun.Image(base1x1Png).resize(200, 200).jpeg({ quality: 100 }).bytes();
  await writeFile(filepath, jpegBytes);
}

describe("Image Optimizer", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("findImageFiles", () => {
    it("should recursively find JPEG, PNG, and WebP files and respect ignore list", async () => {
      const subDir = join(TEST_DIR, "sub");
      const ignoreDir = join(TEST_DIR, "node_modules");
      await mkdir(subDir, { recursive: true });
      await mkdir(ignoreDir, { recursive: true });

      await createTestPng(join(TEST_DIR, "test1.png"));
      await createTestJpeg(join(subDir, "test2.jpg"));
      await createTestPng(join(ignoreDir, "ignored.png"));
      await writeFile(join(TEST_DIR, "text.txt"), "hello world");

      const files = await findImageFiles(TEST_DIR, ["node_modules"]);

      expect(files.length).toBe(2);
      expect(files.some((f) => f.endsWith("test1.png"))).toBe(true);
      expect(files.some((f) => f.endsWith("test2.jpg"))).toBe(true);
      expect(files.some((f) => f.endsWith("ignored.png"))).toBe(false);
    });
  });

  describe("optimizeImage", () => {
    it("should compress an uncompressed PNG and reduce size", async () => {
      const pngPath = join(TEST_DIR, "uncompressed.png");
      await createTestPng(pngPath);

      const origSize = (await stat(pngPath)).size;

      const result = await optimizeImage(pngPath, {
        pngCompressionLevel: 9,
      });

      expect(result.status).toBe("optimized");
      expect(result.optimizedBytes).toBeLessThan(origSize);
      expect(result.savedBytes).toBe(origSize - result.optimizedBytes);

      const newSize = (await stat(pngPath)).size;
      expect(newSize).toBe(result.optimizedBytes);
    });

    it("should convert JPEG to WebP if convertToWebp option is enabled and webp is smaller", async () => {
      const jpegPath = join(TEST_DIR, "sample.jpeg");
      await createTestJpeg(jpegPath);

      const origSize = (await stat(jpegPath)).size;

      const result = await optimizeImage(jpegPath, {
        convertToWebp: true,
        webpQuality: 60,
      });

      expect(result.status).toBe("converted_to_webp");
      expect(result.newPath).toBeDefined();
      expect(result.newPath?.endsWith(".webp")).toBe(true);

      const webpExists = await stat(result.newPath!).catch(() => null);
      expect(webpExists).not.toBeNull();

      const origExists = await stat(jpegPath).catch(() => null);
      expect(origExists).toBeNull();
    });
  });

  describe("processImages & getOptionsFromEnv", () => {
    it("should process directory and calculate correct batch summary", async () => {
      await createTestPng(join(TEST_DIR, "img1.png"));
      await createTestJpeg(join(TEST_DIR, "img2.jpg"));

      const summary = await processImages({
        path: TEST_DIR,
        jpegQuality: 50,
        pngCompressionLevel: 9,
      });

      expect(summary.results.length).toBe(2);
      expect(summary.totalOriginalBytes).toBeGreaterThan(0);
      expect(summary.totalOptimizedBytes).toBeLessThanOrEqual(summary.totalOriginalBytes);
    });

    it("should correctly parse options from env variables", () => {
      process.env.INPUT_PATH = "./custom_path";
      process.env.INPUT_IGNORE_PATHS = "build, .cache";
      process.env.INPUT_JPEG_QUALITY = "75";
      process.env.INPUT_PNG_COMPRESSION_LEVEL = "8";
      process.env.INPUT_WEBP_QUALITY = "70";
      process.env.INPUT_CONVERT_TO_WEBP = "true";

      const opts = getOptionsFromEnv();

      expect(opts.path).toBe("./custom_path");
      expect(opts.ignorePaths).toEqual(["build", ".cache"]);
      expect(opts.jpegQuality).toBe(75);
      expect(opts.pngCompressionLevel).toBe(8);
      expect(opts.webpQuality).toBe(70);
      expect(opts.convertToWebp).toBe(true);
    });
  });
});
