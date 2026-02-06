import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type DownloadResult = {
  path: string;
  skipped: boolean;
};

export async function downloadFile(
  url: string,
  destPath: string,
  force: boolean,
): Promise<DownloadResult> {
  const file = Bun.file(destPath);
  if (!force && (await file.exists())) {
    return { path: destPath, skipped: true };
  }

  await mkdir(dirname(destPath), { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const body = await response.arrayBuffer();
  await Bun.write(destPath, body);
  return { path: destPath, skipped: false };
}

export async function runConcurrently<T>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const concurrency = Math.max(1, limit);
  let currentIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;
      const item = items[index];
      if (item !== undefined) {
        await handler(item, index);
      }
    }
  });
  await Promise.all(workers);
}
