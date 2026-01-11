import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, extname } from "node:path";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import ID3 from "node-id3";

export interface MirrorOptions {
  rssUrl: string;
  outputDir: string;
  baseUrl?: string;
  force?: boolean;
  dryRun?: boolean;
  concurrency?: number;
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
  assets: Record<string, AssetInfo>;
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
  dryRun: boolean
): Promise<AssetInfo | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to download ${kind} from ${url}: ${response.status} ${response.statusText}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
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
    console.warn(`Error downloading ${kind} from ${url}:`, error);
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
  if (ext !== ".mp3") return; // Currently only MP3 supported

  const fullPath = join(outputDir, mediaPath);
  
  let imageBuffer: Buffer | undefined;
  const imageHash = episode.imageAssetHash || manifest.podcastImageAssetHash;
  if (imageHash) {
    const asset = manifest.assets[imageHash];
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
      mime: "image/jpeg", // Basic assumption
      type: { id: 3, name: "front cover" },
      description: "Artwork",
      imageBuffer,
    } : undefined,
  };

  // TODO: Add episode/season numbers if available in RSS

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
  // ... (previous setup)

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

  // Load existing manifest for incremental updates
  let existingManifest: Manifest | null = null;
  try {
    const data = await readFile(join(outputDir, "mirror.json"), "utf-8");
    existingManifest = JSON.parse(data);
  } catch (e) {
    // No existing manifest
  }

  const manifest: Manifest = {
    downloadedAt,
    sourceUrl: rssUrl,
    baseUrl: options.baseUrl,
    http: {
      status: response.status,
      etag,
      lastModified,
    },
    assets: existingManifest?.assets || {},
    items: existingManifest?.items || {},
  };

  const assetsToDownload: { url: string; kind: AssetInfo["kind"] }[] = [];

  const podcastImage = channel.image?.url || channel["itunes:image"]?.["@_href"];
  if (podcastImage) {
    assetsToDownload.push({ url: podcastImage, kind: "podcastImage" });
  }

  const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];

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
  console.log(`Found ${uniqueAssets.length} unique assets in feed.`);
  const pendingAssets = uniqueAssets.filter((a) => {
    if (force) return true;
    const existing = Object.values(manifest.assets).find((ea) => ea.sourceUrl === a.url);
    return !existing;
  });

  console.log(`Downloading ${pendingAssets.length} new assets...`);

  const concurrency = options.concurrency || 4;
  for (let i = 0; i < pendingAssets.length; i += concurrency) {
    const batch = pendingAssets.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (a) => {
        const info = await downloadAsset(a.url, a.kind, outputDir, !!dryRun);
        if (info) {
          manifest.assets[info.contentHash] = info;
        }
      })
    );
  }

  const podcastTitle = channel.title || "";
  const author = channel["itunes:author"] || channel.author || "";

  // Associate assets with items (both existing and newly downloaded)
  for (const item of Object.values(manifest.items)) {
    const rssItem = items.find(ri => {
      const guid = ri.guid?.["#text"] || ri.guid;
      const encUrl = ri.enclosure?.["@_url"];
      return (guid || encUrl || `${ri.title}-${ri.pubDate}`) === item.episodeId;
    });

    if (rssItem) {
      const encUrl = rssItem.enclosure?.["@_url"];
      if (encUrl) {
        const asset = Object.values(manifest.assets).find(a => a.sourceUrl === encUrl);
        if (asset) {
          item.enclosureAssetHash = asset.contentHash;
          // Sync metadata
          if (!dryRun) {
            await syncMetadata(
              asset.localPath,
              item,
              podcastTitle,
              author,
              rssItem.pubDate || "",
              manifest,
              outputDir
            );
          }
        }
      }

      const itImg = rssItem["itunes:image"]?.["@_href"];
      if (itImg) {
        const asset = Object.values(manifest.assets).find(a => a.sourceUrl === itImg);
        if (asset) item.imageAssetHash = asset.contentHash;
      }
    }
  }

  if (podcastImage) {
    const asset = Object.values(manifest.assets).find(a => a.sourceUrl === podcastImage);
    if (asset) manifest.podcastImageAssetHash = asset.contentHash;
  }

  // Rewriting the feed
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
  });

  const getLocalUrl = (assetHash?: string) => {
    if (!assetHash) return undefined;
    const asset = manifest.assets[assetHash];
    if (!asset) return undefined;
    if (options.baseUrl) {
      return new URL(asset.localPath, options.baseUrl).toString();
    }
    return asset.localPath;
  };

  // Update podcast image
  if (manifest.podcastImageAssetHash) {
    const localUrl = getLocalUrl(manifest.podcastImageAssetHash);
    if (localUrl) {
      if (channel.image) channel.image.url = localUrl;
      if (channel["itunes:image"]) channel["itunes:image"]["@_href"] = localUrl;
    }
  }

  // Update items
  for (const item of items) {
    const guid = item.guid?.["#text"] || item.guid;
    const enclosureUrl = item.enclosure?.["@_url"];
    const episodeId = guid || enclosureUrl || `${item.title}-${item.pubDate}`;
    const episodeInfo = manifest.items[episodeId];

    if (episodeInfo) {
      if (episodeInfo.enclosureAssetHash) {
        const localUrl = getLocalUrl(episodeInfo.enclosureAssetHash);
        if (localUrl) item.enclosure["@_url"] = localUrl;
      }
      if (episodeInfo.imageAssetHash) {
        const localUrl = getLocalUrl(episodeInfo.imageAssetHash);
        if (localUrl) {
          if (item["itunes:image"]) item["itunes:image"]["@_href"] = localUrl;
        }
      }
    }
  }

  // Update atom:link if present
  if (channel["atom:link"]) {
    const links = Array.isArray(channel["atom:link"]) ? channel["atom:link"] : [channel["atom:link"]];
    for (const link of links) {
      if (link["@_rel"] === "self") {
        link["@_href"] = options.baseUrl ? new URL("feed.xml", options.baseUrl).toString() : "feed.xml";
      }
    }
  }

  const rewrittenXml = builder.build(jsonObj);

  if (!dryRun) {
    await writeFile(join(outputDir, "feed.xml"), rewrittenXml);
    await writeFile(join(outputDir, "snapshots", timestampDir, "feed.xml"), rewrittenXml);
    await writeFile(join(outputDir, "mirror.json"), JSON.stringify(manifest, null, 2));
    await writeFile(join(outputDir, "snapshots", timestampDir, "mirror.json"), JSON.stringify(manifest, null, 2));
  }

  return manifest;
}
