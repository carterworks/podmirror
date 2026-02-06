# podmirror — Implementation Plan

## Architecture

Single-entry CLI (`src/index.ts`) orchestrating a pipeline: **parse args → fetch feed → parse XML → resolve episodes → download with concurrency → post-process (thumbnails, sidecars, tags)**.

```
src/
  index.ts          # CLI entry: arg parsing, orchestration
  feed.ts           # fetch + parse RSS/Atom XML
  episode.ts        # episode data model + filename formatting
  download.ts       # concurrent file downloader with progress
  sidecar.ts        # extract per-episode XML snippet
  thumbnail.ts      # download episode + podcast cover images
  tags.ts           # shell out to ffmpeg for metadata tagging
  log.ts            # simple console logger ([OK], [3/355], etc.)
```

## Decisions

- XML parsing: `fast-xml-parser` (one dep, zero transitive)
- Media tagging: shell out to system `ffmpeg` (no npm dep)
- Arg parsing: `parseArgs` from `node:util`
- Concurrency: hand-rolled semaphore pattern (no dep)
- HTTP: `fetch()` (Bun native)
- File I/O: `Bun.write`, `Bun.file`
- Testing: `bun:test`, fixtures, minimal mocking
- Filename format: `{number} - {DD Mon YYYY} - {sanitized title}.{ext}`
- Episode numbering: `itunes:episode` first, fall back to position (oldest=1)
- Single feed URL per invocation (no OPML)
- All common audio formats supported (MP3, M4A, OGG, Opus) via ffmpeg

## Phases

### Phase 1: Feed Fetching & Parsing (`feed.ts`)

- [x] Fetch RSS XML via `fetch()`
- [x] Parse with `fast-xml-parser`
- [x] Extract podcast-level metadata: title, description, link, itunes:image, language
- [x] Extract per-episode: title, enclosure (url, type, length), pubDate, itunes:episode, itunes:season, itunes:image, media:thumbnail, guid, raw `<item>` XML
- [x] Save raw feed XML to `{output}/feed.xml`
- [x] Test: parse a real feed fixture, assert extracted data

### Phase 2: Episode Model & Filename Formatting (`episode.ts`)

- [x] Define episode type with all parsed fields
- [x] Numbering: use `itunes:episode` if present, else derive from position (oldest=1)
- [x] Filename: `{number} - {DD Mon YYYY} - {sanitized title}.{ext}`
- [x] Sanitize: strip filesystem-unsafe chars (`/\:*?"<>|`), collapse whitespace, trim
- [x] Extension from enclosure URL or MIME type
- [x] Test: filename generation with edge cases (missing number, special chars, long titles)

### Phase 3: Concurrent Downloader (`download.ts`)

- [x] Generic `download(url, destPath, force)` — skip if file exists and `!force`
- [x] Semaphore-based concurrency pool, configurable N (default 3)
- [x] Progress: log `[current/total] Downloading "filename"` as each starts
- [x] Stream response body to disk via `Bun.write()`
- [x] Test: integration test with `Bun.serve` serving fixtures

### Phase 4: CLI Argument Parsing (`index.ts`)

- [x] `parseArgs` from `node:util` with `strict: true`
- [x] Flags: `--url` (string, required), `--output` (string, required), `--download-thumbnail` (boolean), `--download-sidecar` (boolean), `--set-tags` (boolean), `--force` (boolean), `--concurrency` (string→int, default 3)
- [x] Validate required args, print usage on bad input
- [x] Test: arg strings map to correct config objects

### Phase 5: Thumbnail Downloads (`thumbnail.ts`)

- [x] Podcast cover: `itunes:image` → `{output}/cover.{ext}`
- [x] Per-episode: `itunes:image` on `<item>` or `media:thumbnail` → `{output}/{episodeBase}.{imgExt}`
- [x] Image extension from URL or content-type header
- [x] Test: correct URLs resolved, filenames match

### Phase 6: Sidecar XML (`sidecar.ts`)

- [x] Extract raw `<item>...</item>` substring from original XML text
- [x] Write to `{output}/{episodeBase}.xml`
- [x] Test: sidecar content matches original `<item>` block

### Phase 7: Media Tagging via FFmpeg (`tags.ts`)

- [x] Check `ffmpeg` on PATH; warn and skip if missing
- [x] Run `ffmpeg -i input -metadata ... -codec copy output`, rename over input
- [x] Tags: title, artist (podcast author), album (podcast title), album_artist, track (episode number), date (publish year), comment (description), genre ("Podcast")
- [x] Optionally embed cover art via `-i cover.jpeg -map 0 -map 1 -disposition:v attached_pic`
- [x] Works for MP3, M4A, OGG, Opus — ffmpeg handles all with `-codec copy`
- [x] Test: integration test with tiny audio fixture, verify tags via `ffprobe`

### Phase 8: Orchestration & Error Handling (`index.ts`)

- [x] Wire phases together:
  1. Parse args
  2. Fetch + parse feed
  3. Save `feed.xml`
  4. Download podcast cover (if `--download-thumbnail`)
  5. For each episode (concurrent): download audio → download thumbnail → write sidecar → set tags
  6. Print summary
- [x] Individual episode failures log and continue, don't abort
- [x] Report failures at the end
- [x] Exit code: 0 all success, 1 any failures

### Phase 9: Integration & E2E Tests

- [x] Fixture: save a real RSS feed XML as `test/fixtures/feed.xml`
- [x] Spin up `Bun.serve` to serve fixtures
- [x] Run full pipeline with all flags against local server
- [x] Verify output files exist and are correct
- [x] Test `--force` re-downloads, default skips existing

## Build Order

Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

Feed parsing first (foundation), CLI after core modules exist, integration tests last.

## Notes

_Use this section as a scratchpad during implementation._

- Sidecar XML extraction uses a regex for `<item>` blocks to preserve original RSS snippets.
- Tagging skips cleanly when `ffmpeg` is missing; tests also skip if `ffprobe` is unavailable.
- Cover art embedding is limited to formats that support attached pictures (mp3/m4a/ogg/opus).
