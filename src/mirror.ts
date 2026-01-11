import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, extname } from "node:path";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import ID3 from "node-id3";

const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

export interface MirrorOptions {
  rssUrl: string;
  outputDir: string;
  baseUrl?: string;
  force?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  limit?: number;
  progress?: boolean;
}

export interface Manifest {
  downloadedAt: string;
  sourceUrl: string;
  baseUrl?: string;
  podcastImageAssetHash?: string;
  http: {
    status: number;
    etag?: string;
    lastModified?: string;
  };
  assetsByUrl: Record<string, AssetInfo>;
  items: Record<string, EpisodeInfo>;
}

export interface AssetInfo {
  kind: "enclosure" | "podcastImage" | "episodeImage" | "other";
  sourceUrl: string;
  localPath: string;
  byteLength: number;
  contentHash: string;
  etag?: string;
  lastModified?: string;
}

export interface EpisodeInfo {
  episodeId: string;
  title?: string;
  enclosureAssetHash?: string;
  imageAssetHash?: string;
}

async function downloadAsset(
  url: string,
  kind: AssetInfo["kind"],
  outputDir: string,
  dryRun: boolean,
  onProgress?: (received: number, total: number) => void
): Promise<AssetInfo | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (!onProgress) {
        console.warn(`Failed to download ${kind} from ${url}: ${response.status} ${response.statusText}`);
      }
      return null;
    }

    const total = parseInt(response.headers.get("content-length") || "0", 10);
    let buffer: ArrayBuffer;

    if (response.body && onProgress && total > 0) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress(received, total);
      }

      const combined = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      buffer = combined.buffer;
    } else {
      buffer = await response.arrayBuffer();
      if (onProgress && total > 0) onProgress(total, total);
    }

    const hash = new Bun.CryptoHasher("sha256").update(buffer).digest("hex");

    const contentType = response.headers.get("content-type");
    let ext = extname(new URL(url).pathname);
    if (!ext && contentType) {
      const match = contentType.match(/\/([a-z0-9]+)/i);
      if (match) ext = `.${match[1]}`;
    }
    if (!ext) ext = ".bin";

    const dir = kind === "enclosure" ? "media" : "images";
    const localPath = join(dir, `${hash}${ext}`);
    const fullPath = join(outputDir, localPath);

    if (!dryRun) {
      await writeFile(fullPath, Buffer.from(buffer));
    }

    return {
      kind,
      sourceUrl: url,
      localPath,
      byteLength: buffer.byteLength,
      contentHash: hash,
      etag: response.headers.get("etag") || undefined,
      lastModified: response.headers.get("last-modified") || undefined,
    };
  } catch (error) {
    console.warn(`Error downloading ${kind} from ${url}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function syncMetadata(
  mediaPath: string,
  episode: EpisodeInfo,
  podcastTitle: string,
  author: string,
  pubDate: string,
  manifest: Manifest,
  outputDir: string
) {
  const ext = extname(mediaPath).toLowerCase();
  if (ext !== ".mp3") return; 

  const fullPath = join(outputDir, mediaPath);
  
  let imageBuffer: Buffer | undefined;
  const imageHash = episode.imageAssetHash || manifest.podcastImageAssetHash;
  if (imageHash) {
    const asset = Object.values(manifest.assetsByUrl).find(a => a.contentHash === imageHash);
    if (asset) {
      try {
        imageBuffer = Buffer.from(await readFile(join(outputDir, asset.localPath)));
      } catch (e) {
        console.warn(`Failed to read image for metadata: ${asset.localPath}`);
      }
    }
  }

  const tags: ID3.Tags = {
    title: episode.title,
    album: podcastTitle,
    artist: author,
    date: pubDate,
    image: imageBuffer ? {
      mime: "image/jpeg", 
      type: { id: 3, name: "front cover" },
      description: "Artwork",
      imageBuffer,
    } : undefined,
  };

  try {
    const success = ID3.write(tags, fullPath);
    if (!success) {
      console.warn(`Failed to write ID3 tags to ${fullPath}`);
    }
  } catch (e) {
    console.warn(`Error writing ID3 tags to ${fullPath}:`, e);
  }
}

export async function mirror(options: MirrorOptions) {
  const { rssUrl, outputDir, force, dryRun } = options;
  const downloadedAt = new Date().toISOString();
  const timestampDir = downloadedAt.replace(/[:.]/g, "-");

  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
    await mkdir(join(outputDir, "media"), { recursive: true });
    await mkdir(join(outputDir, "images"), { recursive: true });
    await mkdir(join(outputDir, "snapshots", timestampDir), { recursive: true });
  }

  console.log(`Fetching feed from ${rssUrl}...`);
  const response = await fetch(rssUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`);
  }

  const feedXml = await response.text();
  const etag = response.headers.get("etag") || undefined;
  const lastModified = response.headers.get("last-modified") || undefined;

  if (!dryRun) {
    await writeFile(join(outputDir, "feed.source.xml"), feedXml);
    await writeFile(join(outputDir, "snapshots", timestampDir, "feed.source.xml"), feedXml);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const jsonObj = parser.parse(feedXml);

  const channel = jsonObj.rss?.channel;
  if (!channel) {
    throw new Error("Invalid RSS feed: missing <channel>");
  }

  let existingManifest: Manifest | null = null;
  try {
    const data = await readFile(join(outputDir, "mirror.json"), "utf-8");
    existingManifest = JSON.parse(data);
  } catch (e) {}

  const manifest: Manifest = {
    downloadedAt,
    sourceUrl: rssUrl,
    baseUrl: options.baseUrl,
    http: {
      status: response.status,
      etag,
      lastModified,
    },
    assetsByUrl: existingManifest?.assetsByUrl || {},
    items: existingManifest?.items || {},
  };

  const assetsToDownload: { url: string; kind: AssetInfo["kind"] }[] = [];

  const podcastImage = channel.image?.url || channel["itunes:image"]?.["@_href"];
  if (podcastImage) {
    assetsToDownload.push({ url: podcastImage, kind: "podcastImage" });
  }

  let items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];

  if (options.limit !== undefined) {
    console.log(`Limiting to first ${options.limit} episodes.`);
    items = items.slice(0, options.limit);
    // Update the channel items in the original object so the rewritten XML only contains limited items
    channel.item = items;
  }

  for (const item of items) {
    const guid = item.guid?.["#text"] || item.guid;
    const enclosure = item.enclosure;
    const enclosureUrl = enclosure?.["@_url"];
    
    const episodeId = guid || enclosureUrl || `${item.title}-${item.pubDate}`;
    if (!episodeId) continue;

    const episodeInfo: EpisodeInfo = manifest.items[episodeId] || {
      episodeId,
      title: item.title,
    };
    episodeInfo.title = item.title;

    if (enclosureUrl) {
      assetsToDownload.push({ url: enclosureUrl, kind: "enclosure" });
    }

    const itunesImage = item["itunes:image"]?.["@_href"];
    if (itunesImage) {
      assetsToDownload.push({ url: itunesImage, kind: "episodeImage" });
    }

    manifest.items[episodeId] = episodeInfo;
  }

  const uniqueAssets = Array.from(new Map(assetsToDownload.map((a) => [a.url, a])).values());
  const pendingAssets = uniqueAssets.filter((a) => {
    if (force) return true;
    return !manifest.assetsByUrl[a.url];
  });

  const podcastTitle = channel.title || "";
  const author = channel["itunes:author"] || channel.author || "";

  if (options.progress) {
    console.log(`\n${bold(cyan("🎙️  Mirroring:"))} ${podcastTitle || rssUrl}`);
    console.log(`${bold(cyan("📂  Output:"))}    ${outputDir}`);
    console.log(dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    if (pendingAssets.length === 0) {
      console.log(green("  ✅ All assets are up to date.\n"));
    } else {
      console.log(`${yellow("  📦  Pending:")}   ${pendingAssets.length} new assets\n`);
    }
  } else if (pendingAssets.length > 0) {
    console.log(`Downloading ${pendingAssets.length} new assets...`);
  }

  let completedCount = 0;
  const totalCount = pendingAssets.length;
  const activeDownloads = new Map<string, { received: number; total: number }>();

  const renderProgress = () => {
    if (!options.progress || totalCount === 0) return;

    const barWidth = 30;
    const overallProgress = completedCount / totalCount;
    const filledWidth = Math.round(overallProgress * barWidth);
    const bar = green("█".repeat(filledWidth)) + dim("░".repeat(barWidth - filledWidth));
    const percent = Math.round(overallProgress * 100);

    let statusLine = `\r  ${bar} ${percent}% | ${completedCount}/${totalCount} assets`;

    if (activeDownloads.size > 0) {
      const firstActive = Array.from(activeDownloads.entries())[0];
      if (firstActive) {
        const [url, { received, total }] = firstActive;
        const fileName = url.split("/").pop() || url;
        const truncatedName = fileName.length > 20 ? "..." + fileName.slice(-17) : fileName;
        const filePercent = total > 0 ? Math.round((received / total) * 100) : 0;
        statusLine += ` | ${dim(`Downloading ${truncatedName} (${filePercent}%)`)}`;
      }
    }

    process.stdout.write(statusLine + "\x1b[K");
  };

  const concurrency = options.concurrency || 4;
  for (let i = 0; i < pendingAssets.length; i += concurrency) {
    const batch = pendingAssets.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (a) => {
        const info = await downloadAsset(a.url, a.kind, outputDir, !!dryRun, (received, total) => {
          activeDownloads.set(a.url, { received, total });
          renderProgress();
        });
        activeDownloads.delete(a.url);
        if (info) {
          manifest.assetsByUrl[a.url] = info;
        }
        completedCount++;
        renderProgress();
      })
    );
  }

  if (options.progress && totalCount > 0) {
    renderProgress(); // Final render
    process.stdout.write("\n\n");
  }

  // Associate assets with items
  for (const item of Object.values(manifest.items)) {
    const rssItem = items.find(ri => {
      const guid = ri.guid?.["#text"] || ri.guid;
      const encUrl = ri.enclosure?.["@_url"];
      return (guid || encUrl || `${ri.title}-${ri.pubDate}`) === item.episodeId;
    });

    if (rssItem) {
      const encUrl = rssItem.enclosure?.["@_url"];
      if (encUrl) {
        const asset = manifest.assetsByUrl[encUrl];
        if (asset) {
          item.enclosureAssetHash = asset.contentHash;
          if (!dryRun) {
            await syncMetadata(asset.localPath, item, podcastTitle, author, rssItem.pubDate || "", manifest, outputDir);
          }
        }
      }

      const itImg = rssItem["itunes:image"]?.["@_href"];
      if (itImg) {
        const asset = manifest.assetsByUrl[itImg];
        if (asset) item.imageAssetHash = asset.contentHash;
      }
    }
  }

  if (podcastImage) {
    const asset = manifest.assetsByUrl[podcastImage];
    if (asset) manifest.podcastImageAssetHash = asset.contentHash;
  }

  const getLocalUrlByUrl = (sourceUrl?: string) => {
    if (!sourceUrl) return undefined;
    const asset = manifest.assetsByUrl[sourceUrl];
    if (!asset) return undefined;
    if (options.baseUrl) {
      return new URL(asset.localPath, options.baseUrl).toString();
    }
    return asset.localPath;
  };

  // Rewrite feed
  if (podcastImage) {
    const localUrl = getLocalUrlByUrl(podcastImage);
    if (localUrl) {
      if (channel.image) channel.image.url = localUrl;
      if (channel["itunes:image"]) channel["itunes:image"]["@_href"] = localUrl;
    }
  }

  for (const rssItem of items) {
    const encUrl = rssItem.enclosure?.["@_url"];
    const localEncUrl = getLocalUrlByUrl(encUrl);
    if (localEncUrl) rssItem.enclosure["@_url"] = localEncUrl;

    const itunesImageUrl = rssItem["itunes:image"]?.["@_href"];
    const localItunesImageUrl = getLocalUrlByUrl(itunesImageUrl);
    if (localItunesImageUrl) {
      rssItem["itunes:image"]["@_href"] = localItunesImageUrl;
    }
  }

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
  });
  const rewrittenXml = builder.build(jsonObj);

  if (!dryRun) {
    await writeFile(join(outputDir, "feed.xml"), rewrittenXml);
    await writeFile(join(outputDir, "snapshots", timestampDir, "feed.xml"), rewrittenXml);
    await writeFile(join(outputDir, "mirror.json"), JSON.stringify(manifest, null, 2));
    await writeFile(join(outputDir, "snapshots", timestampDir, "mirror.json"), JSON.stringify(manifest, null, 2));
  }

  return manifest;
}
