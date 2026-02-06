import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { applyTags, isFfmpegAvailable, isFfprobeAvailable, readTags } from "../src/tags.ts";

describe("tags", () => {
  it("applies ffmpeg metadata tags", async () => {
    const hasFfmpeg = await isFfmpegAvailable();
    const hasFfprobe = await isFfprobeAvailable();
    if (!hasFfmpeg || !hasFfprobe) {
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), "podmirror-tags-"));
    const audioPath = join(dir, "sample.wav");
    await writeFile(audioPath, buildTestWav());

    await applyTags(
      audioPath,
      {
        title: "Episode Title",
        enclosureUrl: audioPath,
        number: 3,
        extension: "wav",
        dateLabel: "01 Jan 2024",
        baseName: "3 - 01 Jan 2024 - Episode Title",
        fileName: "3 - 01 Jan 2024 - Episode Title.wav",
        pubDate: "Mon, 01 Jan 2024 12:00:00 GMT",
      },
      {
        title: "Podcast Title",
        author: "Host Name",
      },
      null,
    );

    const tags = await readTags(audioPath);
    expect(tags.title ?? tags.TITLE).toBe("Episode Title");
    expect(tags.album ?? tags.ALBUM).toBe("Podcast Title");
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
