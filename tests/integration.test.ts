import { expect, test, describe } from "bun:test";
import { spawnSync } from "child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const BUN_PATH = "/home/carter/.bun/bin/bun";
const BIN_PATH = join(import.meta.dir, "..", "src", "index.ts");

describe("podmirror CLI", () => {
  const testOutputDir = join(import.meta.dir, "..", "test-output");

  test("should show help when no arguments are provided", () => {
    const { stdout, stderr, status } = spawnSync(BUN_PATH, [BIN_PATH]);
    expect(status).not.toBe(0);
    expect(stderr.toString()).toContain("Usage");
  });

  test("should require rssUrl and outputDir", async () => {
    const { stderr, status } = spawnSync(BUN_PATH, [BIN_PATH, "https://example.com/feed.xml"]);
    expect(status).not.toBe(0);
    expect(stderr.toString()).toContain("Missing required arguments");
  });
});
