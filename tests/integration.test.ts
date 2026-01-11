import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { spawn } from "child_process";
import { mkdir, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import ID3 from "node-id3";

const BUN_PATH = "/home/carter/.bun/bin/bun";
const BIN_PATH = join(import.meta.dir, "..", "src", "index.ts");
const TEST_OUTPUT_DIR = join(import.meta.dir, "..", "test-output");

function runPodmirror(args: string[]): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(BUN_PATH, [BIN_PATH, ...args]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));
    proc.on("close", (status) => resolve({ stdout, stderr, status }));
    proc.on("error", (err) => reject(err));
  });
}

describe("podmirror CLI", () => {
  beforeAll(async () => {
    await rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
  });

  test("should show help when no arguments are provided", async () => {
    const { stderr, status } = await runPodmirror([]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("Usage");
  });

  test("should require rssUrl and outputDir", async () => {
    const { stderr, status } = await runPodmirror(["https://example.com/feed.xml"]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("Missing required arguments");
  });

  test("should download assets and rewrite the feed", async () => {
    const mockFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Test Podcast</title>
    <itunes:image href="http://127.0.0.1:3003/podcast.jpg" />
    <item>
      <title>Episode 1</title>
      <enclosure url="http://127.0.0.1:3003/ep1.mp3" length="12345" type="audio/mpeg" />
      <itunes:image href="http://127.0.0.1:3003/ep1.jpg" />
    </item>
  </channel>
</rss>`;

    const server = Bun.serve({
      port: 3003,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/feed.xml") {
          return new Response(mockFeed, { headers: { "Content-Type": "application/rss+xml" } });
        }
        if (url.pathname === "/ep1.mp3") {
          return new Response("fake-mp3-content", { headers: { "Content-Type": "audio/mpeg" } });
        }
        if (url.pathname === "/ep1.jpg" || url.pathname === "/podcast.jpg") {
          return new Response("fake-image-content", { headers: { "Content-Type": "image/jpeg" } });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      const outputDir = join(TEST_OUTPUT_DIR, "run2");
      const { status, stderr, stdout } = await runPodmirror([
        "http://127.0.0.1:3003/feed.xml",
        outputDir,
      ]);

      if (status !== 0) {
        console.error("stderr:", stderr);
        console.error("stdout:", stdout);
      }
      expect(status).toBe(0);
      
      const manifest = JSON.parse(await readFile(join(outputDir, "mirror.json"), "utf-8"));
      // 3 unique URLs
      expect(Object.keys(manifest.assetsByUrl).length).toBe(3); 
      
      const rewrittenFeed = await readFile(join(outputDir, "feed.xml"), "utf-8");
      expect(rewrittenFeed).toContain("media/");
      expect(rewrittenFeed).toContain("images/");
    } finally {
      server.stop(true);
    }
  }, 10000);

  test("should support incremental updates", async () => {
    const mockFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Podcast</title>
    <item>
      <title>Episode 1</title>
      <enclosure url="http://127.0.0.1:3004/ep1.mp3" length="12345" type="audio/mpeg" />
    </item>
  </channel>
</rss>`;

    let fetchCount = 0;
    const server = Bun.serve({
      port: 3004,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/feed.xml") {
          return new Response(mockFeed, { headers: { "Content-Type": "application/rss+xml" } });
        }
        if (url.pathname === "/ep1.mp3") {
          fetchCount++;
          return new Response("fake-mp3-content", { headers: { "Content-Type": "audio/mpeg" } });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      const outputDir = join(TEST_OUTPUT_DIR, "incremental");
      
      // First run
      await runPodmirror(["http://127.0.0.1:3004/feed.xml", outputDir]);
      expect(fetchCount).toBe(1);

      // Second run
      await runPodmirror(["http://127.0.0.1:3004/feed.xml", outputDir]);
      expect(fetchCount).toBe(1); // Should not have fetched again
    } finally {
      server.stop(true);
    }
  }, 10000);

  test("should synchronize metadata to MP3 files", async () => {
    const mockFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Metadata Podcast</title>
    <itunes:author>Test Author</itunes:author>
    <item>
      <title>Metadata Episode</title>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <enclosure url="http://127.0.0.1:3005/meta.mp3" length="12345" type="audio/mpeg" />
    </item>
  </channel>
</rss>`;

    const server = Bun.serve({
      port: 3005,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/feed.xml") {
          return new Response(mockFeed, { headers: { "Content-Type": "application/rss+xml" } });
        }
        if (url.pathname === "/meta.mp3") {
          return new Response(Buffer.alloc(1024 * 10), { headers: { "Content-Type": "audio/mpeg" } });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      const outputDir = join(TEST_OUTPUT_DIR, "metadata");
      await runPodmirror(["http://127.0.0.1:3005/feed.xml", outputDir]);

      const manifest = JSON.parse(await readFile(join(outputDir, "mirror.json"), "utf-8"));
      const episodeUrl = "http://127.0.0.1:3005/meta.mp3";
      const asset = manifest.assetsByUrl[episodeUrl];
      const fullPath = join(outputDir, asset.localPath);

      const tags = ID3.read(fullPath);
      expect(tags.title).toBe("Metadata Episode");
      expect(tags.album).toBe("Metadata Podcast");
      expect(tags.artist).toBe("Test Author");
      expect(tags.date).toBe("Mon, 01 Jan 2024 12:00:00 GMT");
    } finally {
      server.stop(true);
    }
  }, 10000);

  test("should use absolute URLs when baseUrl is provided", async () => {
    const mockFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BaseUrl Podcast</title>
    <item>
      <title>Episode 1</title>
      <enclosure url="http://127.0.0.1:3006/ep1.mp3" length="12345" type="audio/mpeg" />
    </item>
  </channel>
</rss>`;

    const server = Bun.serve({
      port: 3006,
      hostname: "127.0.0.1",
      fetch(req) {
        return new Response(mockFeed);
      },
    });

    try {
      const outputDir = join(TEST_OUTPUT_DIR, "baseurl");
      await runPodmirror([
        "--baseUrl", "https://cdn.example.com/podcast/",
        "http://127.0.0.1:3006/feed.xml",
        outputDir,
      ]);

      const rewrittenFeed = await readFile(join(outputDir, "feed.xml"), "utf-8");
      expect(rewrittenFeed).toContain("https://cdn.example.com/podcast/media/");
    } finally {
      server.stop(true);
    }
  }, 10000);
});
