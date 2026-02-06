import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { writeSidecarXml } from "../src/sidecar.ts";

describe("sidecar", () => {
  it("writes raw item XML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "podmirror-sidecar-"));
    const dest = join(dir, "episode.xml");
    const xml = "<item><title>Test</title></item>";

    const result = await writeSidecarXml(
      {
        title: "Test",
        enclosureUrl: null,
        rawItemXml: xml,
      },
      dest,
    );

    expect(result.skipped).toBe(false);
    const saved = await readFile(dest, "utf8");
    expect(saved).toBe(xml);
  });
});
