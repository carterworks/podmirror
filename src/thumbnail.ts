import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type ImageDownloadResult = {
  path: string | null;
  skipped: boolean;
};

export async function downloadImage(
  url: string | null | undefined,
  destBasePath: string,
  force: boolean,
): Promise<ImageDownloadResult> {
  if (!url) {
    return { path: null, skipped: true };
  }
  const extension = extensionFromUrl(url);
  if (extension) {
    const destPath = `${destBasePath}.${extension}`;
    if (!force && (await Bun.file(destPath).exists())) {
      return { path: destPath, skipped: true };
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image ${url}: ${response.status} ${response.statusText}`);
    }
    await mkdir(dirname(destPath), { recursive: true });
    await Bun.write(destPath, await response.arrayBuffer());
    return { path: destPath, skipped: false };
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image ${url}: ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get("content-type");
  const resolvedExtension = extensionFromContentType(contentType) ?? "img";
  const destPath = `${destBasePath}.${resolvedExtension}`;
  if (!force && (await Bun.file(destPath).exists())) {
    return { path: destPath, skipped: true };
  }
  await mkdir(dirname(destPath), { recursive: true });
  await Bun.write(destPath, await response.arrayBuffer());
  return { path: destPath, skipped: false };
}

export function extensionFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const dot = path.lastIndexOf(".");
    if (dot === -1) {
      return null;
    }
    const ext = path.slice(dot + 1).toLowerCase();
    return ext.length > 0 ? ext : null;
  } catch {
    const dot = url.lastIndexOf(".");
    if (dot === -1) {
      return null;
    }
    const ext = url.slice(dot + 1).toLowerCase();
    return ext.length > 0 ? ext : null;
  }
}

export function extensionFromContentType(contentType?: string | null): string | null {
  if (!contentType) {
    return null;
  }
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "image/jpeg":
      return "jpeg";
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}
