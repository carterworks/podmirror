import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { downloadImage, extensionFromContentType } from "../src/thumbnail.ts";

describe("thumbnail", () => {
  it("detects extension from content type", () => {
    expect(extensionFromContentType("image/jpeg")).toBe("jpeg");
    expect(extensionFromContentType("image/png")).toBe("png");
  });

  it("downloads image with content-type extension", async () => {
    const server = Bun.serve({
      fetch() {
        return new Response("image-bytes", {
          headers: { "content-type": "image/png" },
        });
      },
      port: 0,
    });

    const dir = await mkdtemp(join(tmpdir(), "podmirror-thumb-"));
    const base = join(dir, "cover");
    const url = `http://localhost:${server.port}/cover`;

    const result = await downloadImage(url, base, false);
    expect(result.path).toBe(`${base}.png`);

    server.stop();
  });
});
