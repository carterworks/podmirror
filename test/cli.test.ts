import { describe, expect, it } from "bun:test";

import { parseCliArgs } from "../src/index.ts";

describe("parseCliArgs", () => {
  it("maps flags into config", () => {
    const config = parseCliArgs([
      "--url",
      "https://example.com/feed.xml",
      "--output",
      "./out",
      "--download-thumbnail",
      "--download-sidecar",
      "--set-tags",
      "--force",
      "--concurrency",
      "5",
    ]);

    expect(config.url).toBe("https://example.com/feed.xml");
    expect(config.output).toBe("./out");
    expect(config.downloadThumbnail).toBe(true);
    expect(config.downloadSidecar).toBe(true);
    expect(config.setTags).toBe(true);
    expect(config.force).toBe(true);
    expect(config.concurrency).toBe(5);
  });
});
