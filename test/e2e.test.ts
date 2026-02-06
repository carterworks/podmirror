import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runPipeline } from "../src/index.ts";

const FIXTURE_PATH = "/home/carter/code/podmirror/test/fixtures/feed.xml";

describe("e2e pipeline", () => {
  it("downloads episodes, thumbnails, and sidecars", async () => {
    let port = 0;
    const server = Bun.serve({
      async fetch(req): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname === "/feed.xml") {
          const xml = await readFile(FIXTURE_PATH, "utf8");
          return new Response(xml.replace(/\{\{BASE_URL\}\}/g, `http://localhost:${port}`), {
            headers: { "content-type": "application/xml" },
          });
        }
        if (url.pathname.endsWith(".wav")) {
          return new Response(buildTestWav(), {
            headers: { "content-type": "audio/wav" },
          });
        }
        if (url.pathname.endsWith(".jpg") || url.pathname.endsWith(".jpeg")) {
          return new Response("image-bytes", {
            headers: { "content-type": "image/jpeg" },
          });
        }
        return new Response("not found", { status: 404 });
      },
      port: 0,
    });
    const resolvedPort = server.port;
    if (!resolvedPort) {
      throw new Error("Server did not expose a port");
    }
    port = resolvedPort;

    const dir = await mkdtemp(join(tmpdir(), "podmirror-e2e-"));
    const url = `http://localhost:${server.port}/feed.xml`;

    const result = await runPipeline({
      url,
      output: dir,
      downloadThumbnail: true,
      downloadSidecar: true,
      setTags: true,
      force: true,
      concurrency: 2,
    });

    expect(result.failures).toBe(0);
    expect(await Bun.file(join(dir, "feed.xml")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "cover.jpg")).exists()).toBe(true);
    expect(
      await Bun.file(join(dir, "10 - 01 Jan 2024 - First Episode Hello World.wav")).exists(),
    ).toBe(true);
    expect(
      await Bun.file(join(dir, "10 - 01 Jan 2024 - First Episode Hello World.jpg")).exists(),
    ).toBe(true);
    expect(
      await Bun.file(join(dir, "10 - 01 Jan 2024 - First Episode Hello World.xml")).exists(),
    ).toBe(true);

    server.stop();
  });
});

function buildTestWav(): Uint8Array {
  const sampleRate = 8000;
  const durationSeconds = 0.1;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < dataSize; i += 1) {
    bytes[44 + i] = 128;
  }
  return bytes;
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
