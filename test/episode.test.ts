import { describe, expect, it } from "bun:test";

import { resolveEpisodes, sanitizeFileName } from "../src/episode.ts";

describe("episode filename formatting", () => {
  it("sanitizes unsafe characters", () => {
    expect(sanitizeFileName("Hello/World? *Test*")).toBe("Hello World Test");
  });

  it("builds filenames with fallback numbering", () => {
    const resolved = resolveEpisodes([
      {
        title: "First",
        enclosureUrl: "https://example.com/audio-1.mp3",
        enclosureType: "audio/mpeg",
        pubDate: "Mon, 01 Jan 2024 12:00:00 GMT",
        itunesEpisode: null,
      },
      {
        title: "Second",
        enclosureUrl: "https://example.com/audio-2.mp3",
        enclosureType: "audio/mpeg",
        pubDate: "Mon, 08 Jan 2024 12:00:00 GMT",
        itunesEpisode: "5",
      },
    ]);

    expect(resolved[0]?.number).toBe(1);
    expect(resolved[0]?.fileName).toBe("1 - 01 Jan 2024 - First.mp3");
    expect(resolved[1]?.number).toBe(5);
    expect(resolved[1]?.fileName).toBe("5 - 08 Jan 2024 - Second.mp3");
  });
});
