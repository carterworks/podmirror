export type Episode = {
  title: string;
  enclosureUrl: string | null;
  enclosureType?: string | null;
  enclosureLength?: string | null;
  pubDate?: string | null;
  itunesEpisode?: string | null;
  itunesSeason?: string | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  guid?: string | null;
  description?: string | null;
  rawItemXml?: string | null;
};

export type ResolvedEpisode = Episode & {
  number: number;
  extension: string;
  dateLabel: string;
  baseName: string;
  fileName: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g;

export function sanitizeFileName(value: string): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "Untitled Episode";
}

export function formatEpisodeDate(pubDate?: string | null): string {
  if (!pubDate) {
    return "Unknown Date";
  }
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) {
    return "Unknown Date";
  }
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS[date.getUTCMonth()] ?? "Jan";
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export function resolveExtension(
  enclosureUrl?: string | null,
  enclosureType?: string | null,
): string {
  const fromUrl = enclosureUrl ? extensionFromUrl(enclosureUrl) : null;
  if (fromUrl) {
    return fromUrl;
  }
  const fromMime = enclosureType ? extensionFromMime(enclosureType) : null;
  if (fromMime) {
    return fromMime;
  }
  return "bin";
}

export function resolveEpisodes(episodes: Episode[]): ResolvedEpisode[] {
  const fallbackNumbers = computeFallbackNumbers(episodes);
  return episodes.map((episode, index) => {
    const parsedNumber = parseEpisodeNumber(episode.itunesEpisode);
    const number = parsedNumber ?? fallbackNumbers[index] ?? index + 1;
    const extension = resolveExtension(episode.enclosureUrl, episode.enclosureType);
    const dateLabel = formatEpisodeDate(episode.pubDate);
    const title = sanitizeFileName(episode.title || "Untitled Episode");
    const baseName = `${number} - ${dateLabel} - ${title}`;
    const fileName = `${baseName}.${extension}`;
    return {
      ...episode,
      number,
      extension,
      dateLabel,
      baseName,
      fileName,
    };
  });
}

function parseEpisodeNumber(value?: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function computeFallbackNumbers(episodes: Episode[]): number[] {
  const sortable = episodes.map((episode, index) => {
    const date = episode.pubDate ? new Date(episode.pubDate) : null;
    const time = date && !Number.isNaN(date.getTime()) ? date.getTime() : Number.POSITIVE_INFINITY;
    return { index, time };
  });
  sortable.sort((a, b) => {
    if (a.time === b.time) {
      return a.index - b.index;
    }
    return a.time - b.time;
  });
  const numbers: number[] = [];
  for (const [i, entry] of sortable.entries()) {
    numbers[entry.index] = i + 1;
  }
  return numbers;
}

function extensionFromUrl(url: string): string | null {
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

function extensionFromMime(mime: string): string | null {
  const normalized = mime.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/opus":
      return "opus";
    case "audio/x-m4a":
      return "m4a";
    case "audio/wav":
    case "audio/wave":
      return "wav";
    default:
      return null;
  }
}
