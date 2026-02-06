import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { downloadFile } from "../src/download.ts";

describe("downloadFile", () => {
  it("downloads and skips when file exists", async () => {
    const server = Bun.serve({
      fetch() {
        return new Response("audio-bytes", {
          headers: { "content-type": "audio/mpeg" },
        });
      },
      port: 0,
    });

    const dir = await mkdtemp(join(tmpdir(), "podmirror-download-"));
    const dest = join(dir, "episode.mp3");
    const url = `http://localhost:${server.port}/audio.mp3`;

    const first = await downloadFile(url, dest, false);
    expect(first.skipped).toBe(false);

    const second = await downloadFile(url, dest, false);
    expect(second.skipped).toBe(true);

    server.stop();
  });
});
