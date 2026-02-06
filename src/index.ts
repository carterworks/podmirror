import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { fetchFeed } from "./feed.ts";
import { resolveEpisodes } from "./episode.ts";
import { downloadFile, runConcurrently } from "./download.ts";
import { downloadImage } from "./thumbnail.ts";
import { writeSidecarXml } from "./sidecar.ts";
import { applyTags, isFfmpegAvailable } from "./tags.ts";
import { createProgress, logError, logOk, logWarn } from "./log.ts";

export type CliConfig = {
  url: string;
  output: string;
  downloadThumbnail: boolean;
  downloadSidecar: boolean;
  setTags: boolean;
  force: boolean;
  concurrency: number;
};

export function parseCliArgs(argv: string[]): CliConfig {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      url: { type: "string" },
      output: { type: "string" },
      "download-thumbnail": { type: "boolean" },
      "download-sidecar": { type: "boolean" },
      "set-tags": { type: "boolean" },
      force: { type: "boolean" },
      concurrency: { type: "string" },
    },
  });

  const url = values.url;
  const output = values.output;
  if (!url || !output) {
    throw new Error("Missing required arguments: --url and --output");
  }

  const concurrency = values.concurrency ? Number.parseInt(values.concurrency, 10) : 3;
  return {
    url,
    output,
    downloadThumbnail: values["download-thumbnail"] ?? false,
    downloadSidecar: values["download-sidecar"] ?? false,
    setTags: values["set-tags"] ?? false,
    force: values.force ?? false,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3,
  };
}

export async function runPipeline(config: CliConfig): Promise<{ failures: number }> {
  await mkdir(config.output, { recursive: true });

  const feed = await fetchFeed(config.url);
  await Bun.write(join(config.output, "feed.xml"), feed.rawXml);

  logOk(`Podcast "${feed.podcast.title}" has ${feed.episodes.length} episodes`);

  let coverPath: string | null = null;
  if (config.downloadThumbnail && feed.podcast.imageUrl) {
    const coverBase = join(config.output, "cover");
    const coverResult = await downloadImage(feed.podcast.imageUrl, coverBase, config.force);
    coverPath = coverResult.path;
  }

  if (config.setTags && !(await isFfmpegAvailable())) {
    logWarn("ffmpeg not found on PATH, skipping tag updates");
  }

  const resolved = resolveEpisodes(feed.episodes);
  const failures: string[] = [];
  const progress = createProgress(resolved.length);

  await runConcurrently(resolved, config.concurrency, async (episode) => {
    const taskId = episode.fileName;
    try {
      if (!episode.enclosureUrl) {
        throw new Error("Missing enclosure URL");
      }
      progress.startTask(taskId, `[audio] Downloading "${episode.fileName}"`);
      const audioPath = join(config.output, episode.fileName);
      await downloadFile(episode.enclosureUrl, audioPath, config.force);

      progress.updateTask(taskId, `[post] Processing "${episode.fileName}"`);

      if (config.downloadThumbnail) {
        progress.updateTask(taskId, `[thumb] Fetching image for "${episode.baseName}"`);
        const imageUrl = episode.imageUrl ?? episode.thumbnailUrl;
        await downloadImage(imageUrl, join(config.output, episode.baseName), config.force);
      }

      if (config.downloadSidecar) {
        progress.updateTask(taskId, `[sidecar] Writing XML for "${episode.baseName}"`);
        await writeSidecarXml(episode, join(config.output, `${episode.baseName}.xml`));
      }

      if (config.setTags && (await Bun.file(audioPath).exists())) {
        progress.updateTask(taskId, `[tags] Applying metadata for "${episode.baseName}"`);
        await applyTags(audioPath, episode, feed.podcast, coverPath);
      }
      progress.finishTask(taskId, `[done] Downloaded "${episode.fileName}"`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      progress.logError(`Episode "${episode.title}" failed: ${message}`);
      failures.push(episode.title);
      progress.failTask(taskId, `[fail] "${episode.fileName}"`);
    }
  });

  progress.stop();

  if (failures.length > 0) {
    logWarn(`Done with ${failures.length} failures`);
    return { failures: failures.length };
  }

  logOk("Done!");
  return { failures: 0 };
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  podmirror --url <feed> --output <dir> [flags]");
  console.log("\nFlags:");
  console.log("  --download-thumbnail  Download podcast + episode images");
  console.log("  --download-sidecar    Write per-episode XML sidecars");
  console.log("  --set-tags            Apply media tags with ffmpeg");
  console.log("  --force               Re-download existing files");
  console.log("  --concurrency <n>     Download N episodes in parallel (default 3)");
}

async function main(): Promise<void> {
  try {
    const config = parseCliArgs(process.argv.slice(2));
    const result = await runPipeline(config);
    process.exit(result.failures > 0 ? 1 : 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(message);
    printUsage();
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
