import { XMLParser } from "fast-xml-parser";

import type { Episode } from "./episode.ts";

export type PodcastMeta = {
  title: string;
  description?: string | null;
  link?: string | null;
  language?: string | null;
  imageUrl?: string | null;
  author?: string | null;
};

export type FeedData = {
  podcast: PodcastMeta;
  episodes: Episode[];
  rawXml: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: true,
});

export async function fetchFeed(url: string): Promise<FeedData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  return parseFeed(xml);
}

export function parseFeed(xml: string): FeedData {
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel ?? parsed?.channel ?? parsed?.feed ?? {};
  const items = ensureArray(channel.item ?? channel.entry ?? []);
  const rawItems = extractItemXml(xml);

  const podcast: PodcastMeta = {
    title: textValue(channel.title) ?? "Untitled Podcast",
    description: textValue(channel.description) ?? textValue(channel.subtitle) ?? null,
    link: textValue(channel.link) ?? null,
    language: textValue(channel.language) ?? null,
    imageUrl: extractImageUrl(channel["itunes:image"]) ?? textValue(channel.image?.url) ?? null,
    author: textValue(channel["itunes:author"]) ?? textValue(channel.author) ?? null,
  };

  const episodes: Episode[] = items.map((item: Record<string, unknown>, index: number) => {
    const enclosure = item.enclosure as Record<string, unknown> | undefined;
    const enclosureUrl = attributeValue(enclosure, "@_url");
    const enclosureType = attributeValue(enclosure, "@_type");
    const enclosureLength = attributeValue(enclosure, "@_length");
    const itunesImage = extractImageUrl(item["itunes:image"]);
    const mediaThumbnail = extractImageUrl(item["media:thumbnail"]);
    return {
      title: textValue(item.title) ?? "Untitled Episode",
      enclosureUrl: enclosureUrl ?? null,
      enclosureType: enclosureType ?? null,
      enclosureLength: enclosureLength ?? null,
      pubDate: textValue(item.pubDate) ?? null,
      itunesEpisode: textValue(item["itunes:episode"]) ?? null,
      itunesSeason: textValue(item["itunes:season"]) ?? null,
      imageUrl: itunesImage ?? null,
      thumbnailUrl: mediaThumbnail ?? null,
      guid: textValue(item.guid) ?? null,
      description: textValue(item.description) ?? textValue(item["content:encoded"]) ?? null,
      rawItemXml: rawItems[index] ?? null,
    } satisfies Episode;
  });

  return { podcast, episodes, rawXml: xml };
}

function ensureArray<T>(value: T | T[]): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}

function textValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && value && "#text" in value) {
    const text = (value as Record<string, unknown>)["#text"];
    return typeof text === "string" ? text.trim() : String(text ?? "").trim();
  }
  return null;
}

function attributeValue(value: Record<string, unknown> | undefined, key: string): string | null {
  if (!value) {
    return null;
  }
  const attr = value[key];
  if (typeof attr === "string") {
    return attr;
  }
  if (typeof attr === "number") {
    return String(attr);
  }
  return null;
}

function extractImageUrl(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = extractImageUrl(entry);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    const href = (value as Record<string, unknown>)["@_href"];
    const url = (value as Record<string, unknown>)["@_url"];
    if (typeof href === "string") {
      return href;
    }
    if (typeof url === "string") {
      return url;
    }
  }
  return null;
}

function extractItemXml(xml: string): string[] {
  const matches = xml.match(/<item\b[\s\S]*?<\/item>/gi);
  return matches ?? [];
}
