import { appendFileSync } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { join, extname, relative, resolve } from "node:path";

export interface OptimizationOptions {
  path?: string;
  ignorePaths?: string[];
  jpegQuality?: number;
  pngCompressionLevel?: number;
  webpQuality?: number;
  convertToWebp?: boolean;
}

export interface OptimizationResult {
  filePath: string;
  originalBytes: number;
  optimizedBytes: number;
  savedBytes: number;
  status: "optimized" | "skipped" | "converted_to_webp" | "error";
  newPath?: string;
  error?: string;
}

export interface BatchSummary {
  totalOriginalBytes: number;
  totalOptimizedBytes: number;
  totalSavedBytes: number;
  optimizedCount: number;
  results: OptimizationResult[];
}

function parseBool(val: string | undefined, defaultVal: boolean): boolean {
  if (val === undefined || val === "") return defaultVal;
  return val.toLowerCase() === "true" || val === "1";
}

function parseIntOption(val: string | undefined, defaultVal: number): number {
  if (val === undefined || val === "") return defaultVal;
  const num = parseInt(val, 10);
  return isNaN(num) ? defaultVal : num;
}

export function getOptionsFromEnv(): OptimizationOptions {
  const path = process.env.INPUT_PATH || ".";
  const ignoreStr = process.env.INPUT_IGNORE_PATHS || "node_modules,.git,dist,build";
  const ignorePaths = ignoreStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const jpegQuality = parseIntOption(process.env.INPUT_JPEG_QUALITY, 80);
  const pngCompressionLevel = parseIntOption(process.env.INPUT_PNG_COMPRESSION_LEVEL, 6);
  const webpQuality = parseIntOption(process.env.INPUT_WEBP_QUALITY, 80);
  const convertToWebp = parseBool(process.env.INPUT_CONVERT_TO_WEBP, false);

  return {
    path,
    ignorePaths,
    jpegQuality,
    pngCompressionLevel,
    webpQuality,
    convertToWebp,
  };
}

export async function findImageFiles(
  targetPath: string,
  ignoreList: string[] = [],
): Promise<string[]> {
  const absoluteTarget = resolve(targetPath);
  const imageFiles: string[] = [];

  const validExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

  async function walk(currentDir: string) {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const relPath = relative(absoluteTarget, fullPath) || entry.name;

      // Check if entry should be ignored
      const shouldIgnore = ignoreList.some((pattern) => {
        if (pattern === entry.name || relPath === pattern || relPath.startsWith(pattern + "/")) {
          return true;
        }
        return false;
      });

      if (shouldIgnore) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (validExtensions.has(ext)) {
          imageFiles.push(fullPath);
        }
      }
    }
  }

  const baseStat = await stat(absoluteTarget).catch(() => null);
  if (!baseStat) return [];

  if (baseStat.isFile()) {
    const ext = extname(absoluteTarget).toLowerCase();
    if (validExtensions.has(ext)) {
      imageFiles.push(absoluteTarget);
    }
  } else if (baseStat.isDirectory()) {
    await walk(absoluteTarget);
  }

  return imageFiles;
}

export async function optimizeImage(
  filePath: string,
  options: OptimizationOptions,
): Promise<OptimizationResult> {
  const fileStat = await stat(filePath);
  const originalBytes = fileStat.size;
  const ext = extname(filePath).toLowerCase();

  try {
    const bunFile = Bun.file(filePath);
    let pipeline = bunFile.image();

    const jpegQuality = options.jpegQuality ?? 80;
    const pngCompressionLevel = options.pngCompressionLevel ?? 6;
    const webpQuality = options.webpQuality ?? 80;

    let optimizedBuffer: Uint8Array;
    let targetFormat: string = ext;

    if (options.convertToWebp && ext !== ".webp") {
      pipeline = pipeline.webp({ quality: webpQuality });
      optimizedBuffer = await pipeline.bytes();
      targetFormat = ".webp";
    } else if (ext === ".jpg" || ext === ".jpeg") {
      pipeline = pipeline.jpeg({ quality: jpegQuality });
      optimizedBuffer = await pipeline.bytes();
    } else if (ext === ".png") {
      pipeline = pipeline.png({ compressionLevel: pngCompressionLevel });
      optimizedBuffer = await pipeline.bytes();
    } else if (ext === ".webp") {
      pipeline = pipeline.webp({ quality: webpQuality });
      optimizedBuffer = await pipeline.bytes();
    } else {
      return {
        filePath,
        originalBytes,
        optimizedBytes: originalBytes,
        savedBytes: 0,
        status: "skipped",
      };
    }

    const optimizedBytes = optimizedBuffer.byteLength;

    if (options.convertToWebp && ext !== ".webp") {
      if (optimizedBytes < originalBytes) {
        const newPath = filePath.substring(0, filePath.lastIndexOf(".")) + ".webp";
        await Bun.write(newPath, optimizedBuffer);
        await unlink(filePath);
        return {
          filePath,
          originalBytes,
          optimizedBytes,
          savedBytes: originalBytes - optimizedBytes,
          status: "converted_to_webp",
          newPath,
        };
      } else {
        return {
          filePath,
          originalBytes,
          optimizedBytes: originalBytes,
          savedBytes: 0,
          status: "skipped",
        };
      }
    } else {
      if (optimizedBytes < originalBytes) {
        await Bun.write(filePath, optimizedBuffer);
        return {
          filePath,
          originalBytes,
          optimizedBytes,
          savedBytes: originalBytes - optimizedBytes,
          status: "optimized",
        };
      } else {
        return {
          filePath,
          originalBytes,
          optimizedBytes: originalBytes,
          savedBytes: 0,
          status: "skipped",
        };
      }
    }
  } catch (err: any) {
    return {
      filePath,
      originalBytes,
      optimizedBytes: originalBytes,
      savedBytes: 0,
      status: "error",
      error: err?.message || String(err),
    };
  }
}

export async function processImages(options: OptimizationOptions): Promise<BatchSummary> {
  const target = options.path || ".";
  const files = await findImageFiles(target, options.ignorePaths);

  const results: OptimizationResult[] = [];
  let totalOriginalBytes = 0;
  let totalOptimizedBytes = 0;
  let totalSavedBytes = 0;
  let optimizedCount = 0;

  for (const file of files) {
    const res = await optimizeImage(file, options);
    results.push(res);
    totalOriginalBytes += res.originalBytes;
    totalOptimizedBytes += res.optimizedBytes;
    if (res.status === "optimized" || res.status === "converted_to_webp") {
      totalSavedBytes += res.savedBytes;
      optimizedCount++;
    }
  }

  return {
    totalOriginalBytes,
    totalOptimizedBytes,
    totalSavedBytes,
    optimizedCount,
    results,
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function writeGitHubOutput(key: string, value: string | number) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

export async function main() {
  console.log("🚀 Starting Auto Image Optimization with Bun.Image...");
  const options = getOptionsFromEnv();
  console.log("Configuration:", JSON.stringify(options, null, 2));

  const summary = await processImages(options);

  console.log("\n--- Optimization Summary ---");
  console.log(`Found images: ${summary.results.length}`);
  console.log(`Optimized images: ${summary.optimizedCount}`);
  console.log(`Original total size: ${formatBytes(summary.totalOriginalBytes)}`);
  console.log(`Optimized total size: ${formatBytes(summary.totalOptimizedBytes)}`);
  console.log(`Total saved: ${formatBytes(summary.totalSavedBytes)}`);

  if (summary.results.length > 0) {
    console.log("\nDetails:");
    for (const r of summary.results) {
      if (r.status === "optimized") {
        const savedPct = ((r.savedBytes / r.originalBytes) * 100).toFixed(1);
        console.log(
          ` ✅ ${relative(process.cwd(), r.filePath)}: ${formatBytes(r.originalBytes)} -> ${formatBytes(r.optimizedBytes)} (-${savedPct}%)`,
        );
      } else if (r.status === "converted_to_webp") {
        const savedPct = ((r.savedBytes / r.originalBytes) * 100).toFixed(1);
        console.log(
          ` 🔄 ${relative(process.cwd(), r.filePath)} -> ${relative(process.cwd(), r.newPath!)}: ${formatBytes(r.originalBytes)} -> ${formatBytes(r.optimizedBytes)} (-${savedPct}%)`,
        );
      } else if (r.status === "error") {
        console.log(` ❌ ${relative(process.cwd(), r.filePath)}: Error - ${r.error}`);
      } else {
        console.log(` ➖ ${relative(process.cwd(), r.filePath)}: Already optimized`);
      }
    }
  }

  writeGitHubOutput("total_original_bytes", summary.totalOriginalBytes);
  writeGitHubOutput("total_optimized_bytes", summary.totalOptimizedBytes);
  writeGitHubOutput("total_saved_bytes", summary.totalSavedBytes);
  writeGitHubOutput("optimized_count", summary.optimizedCount);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error during image optimization:", err);
    process.exit(1);
  });
}
