import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { Episode } from "./episode.ts";

export async function writeSidecarXml(
  episode: Episode,
  destPath: string,
): Promise<{ path: string | null; skipped: boolean }> {
  if (!episode.rawItemXml) {
    return { path: null, skipped: true };
  }
  await mkdir(dirname(destPath), { recursive: true });
  await Bun.write(destPath, episode.rawItemXml);
  return { path: destPath, skipped: false };
}
