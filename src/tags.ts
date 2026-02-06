import { rename, rm, stat } from "node:fs/promises";
import { join, parse } from "node:path";

import type { PodcastMeta } from "./feed.ts";
import type { ResolvedEpisode } from "./episode.ts";

const ffmpegCache: { available?: boolean } = {};
const ffprobeCache: { available?: boolean } = {};

export async function isFfmpegAvailable(): Promise<boolean> {
  if (ffmpegCache.available !== undefined) {
    return ffmpegCache.available;
  }
  ffmpegCache.available = await commandExists("ffmpeg");
  return ffmpegCache.available;
}

export async function isFfprobeAvailable(): Promise<boolean> {
  if (ffprobeCache.available !== undefined) {
    return ffprobeCache.available;
  }
  ffprobeCache.available = await commandExists("ffprobe");
  return ffprobeCache.available;
}

export async function applyTags(
  inputPath: string,
  episode: ResolvedEpisode,
  podcast: PodcastMeta,
  coverPath?: string | null,
): Promise<void> {
  if (!(await isFfmpegAvailable())) {
    return;
  }
  await stat(inputPath);

  const metadata = buildMetadata(episode, podcast);
  const tempPath = buildTempPath(inputPath);
  await rm(tempPath, { force: true });

  const args = ["-y", "-i", inputPath];
  if (coverPath && supportsCoverArt(inputPath)) {
    args.push("-i", coverPath, "-map", "0", "-map", "1", "-disposition:v", "attached_pic");
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (value) {
      args.push("-metadata", `${key}=${sanitizeMetadata(value)}`);
    }
  }
  args.push("-codec", "copy", tempPath);

  const result = Bun.spawn(["ffmpeg", ...args], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const exitCode = await result.exited;
  if (exitCode !== 0) {
    await rm(tempPath, { force: true });
    throw new Error(`ffmpeg failed with exit code ${exitCode}`);
  }

  await rename(tempPath, inputPath);
}

function buildTempPath(inputPath: string): string {
  const parsed = parse(inputPath);
  if (!parsed.ext) {
    return `${inputPath}.tagged`;
  }
  return join(parsed.dir, `${parsed.name}.tagged${parsed.ext}`);
}

function supportsCoverArt(inputPath: string): boolean {
  const ext = parse(inputPath).ext.toLowerCase();
  return ext === ".mp3" || ext === ".m4a" || ext === ".ogg" || ext === ".opus";
}

export async function readTags(path: string): Promise<Record<string, string>> {
  if (!(await isFfprobeAvailable())) {
    return {};
  }
  const result = Bun.spawn([
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format_tags",
    "-of",
    "json",
    path,
  ]);
  const stdout = await new Response(result.stdout).text();
  const exitCode = await result.exited;
  if (exitCode !== 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> } };
    return parsed.format?.tags ?? {};
  } catch {
    return {};
  }
}

function buildMetadata(episode: ResolvedEpisode, podcast: PodcastMeta): Record<string, string> {
  const year = extractYear(episode.pubDate ?? "");
  return {
    title: episode.title,
    artist: podcast.author ?? "",
    album: podcast.title,
    album_artist: podcast.author ?? "",
    track: String(episode.number),
    date: year ? String(year) : "",
    comment: episode.description ?? "",
    genre: "Podcast",
  };
}

function extractYear(value: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getUTCFullYear();
}

function sanitizeMetadata(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

async function commandExists(command: string): Promise<boolean> {
  try {
    const result = Bun.spawn([command, "-version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await result.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}
