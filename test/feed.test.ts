import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

import { parseFeed } from "../src/feed.ts";

const FIXTURE_PATH = "/home/carter/code/podmirror/test/fixtures/feed.xml";

describe("parseFeed", () => {
  it("extracts podcast and episode metadata", async () => {
    const xml = await readFile(FIXTURE_PATH, "utf8");
    const feed = parseFeed(xml.replace(/\{\{BASE_URL\}\}/g, "https://example.com"));

    expect(feed.podcast.title).toBe("Sample Podcast");
    expect(feed.podcast.author).toBe("Sample Host");
    expect(feed.podcast.imageUrl).toBe("https://example.com/cover.jpg");
    expect(feed.episodes.length).toBe(2);

    const first = feed.episodes.at(0);
    expect(first).toBeTruthy();
    if (!first) {
      throw new Error("Missing first episode");
    }
    expect(first.title).toBe("First Episode: Hello/World?");
    expect(first.enclosureUrl).toBe("https://example.com/audio-1.wav");
    expect(first.itunesEpisode).toBe("10");
    expect(first.rawItemXml).toContain("<item>");
  });
});
