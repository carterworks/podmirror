# podmirror — Specification

## Summary
`podmirror` creates a local, static, re-hostable mirror of a podcast RSS feed.

Given a podcast RSS URL and an output directory, it:

- Downloads the feed XML.
- Downloads in-scope assets (episode enclosures and artwork images).
- Rewrites the feed so all asset URLs point at the locally downloaded files.
- Ensures each media file’s embedded metadata matches what the feed declares (when feasible, and only if needed).
- Supports incremental re-runs: records when a snapshot was taken and avoids re-downloading unchanged assets.

The output is intended to be served by any static file server (S3, nginx, GitHub Pages, etc.) to “rehost” the podcast.

## Goals
- **Archival mirror**: preserve a usable, self-contained copy of a podcast feed + assets.
- **Rehosting**: produce a rewritten feed that points at locally hosted files.
- **Incremental updates**: re-running against the same output directory updates the mirror without unnecessarily re-downloading large files.
- **Deterministic layout**: stable file naming so repeated runs converge on the same on-disk structure.
- **Minimal mutation**: do not transcode media; only adjust embedded metadata when required.

## Non-goals
- Podcast discovery / directory crawling.
- Uploading to hosting providers (only writes a local directory).
- DRM breaking or decrypting protected media.
- Perfect metadata writing for every possible codec/container (best-effort per format).
- Guaranteeing legality of redistribution (operator responsibility).

## Terminology
- **Source feed**: the original RSS XML at `rssUrl`.
- **Mirror**: the output directory containing rewritten feed + assets.
- **Snapshot**: the state of the mirror at a specific time (including a timestamped record).
- **Asset**: a downloaded binary file referenced by the feed (media enclosures, images).

## Inputs
### Required
- `rssUrl`: HTTP(S) URL to the podcast RSS feed.
- `outputDir`: destination directory for the mirror.

### Optional
- `baseUrl`: the public URL where `outputDir` will be hosted.
  - If provided, rewritten URLs MUST be absolute using `baseUrl`.
  - If omitted, rewritten URLs MUST be relative paths within `outputDir` (default).

Note: some podcast clients prefer absolute enclosure URLs; set `baseUrl` when rehosting for broad compatibility.

### Optional behavior flags (nice-to-have)
- `--update` / default behavior: reuse existing downloads; only fetch what changed.
- `--force` (or `--redownload`): re-fetch even if local copies exist.
- `--dry-run`: report planned actions without writing.
- `--concurrency N`: control parallel downloads.

## Outputs
### Directory layout (normative)
`outputDir` MUST be a self-contained static directory.

A recommended layout:

```
outputDir/
  feed.xml                   # rewritten feed (ready to host)
  feed.source.xml            # exact source feed snapshot (as fetched)
  mirror.json                # current state/manifest (machine-readable)
  snapshots/
    2026-01-11T16:40:00Z/
      feed.xml               # rewritten feed at that time
      feed.source.xml        # source feed at that time
      mirror.json            # manifest at that time
  media/
    <sha256>.<ext>           # content-addressed enclosure files
  images/
    <sha256>.<ext>           # content-addressed artwork files
```

Notes:
- `feed.xml` SHOULD be the primary “latest” rewritten feed.
- Snapshot directories SHOULD reference the shared `media/` and `images/` files (assets are not duplicated per snapshot).
- Asset filenames MUST be content-addressed (hash-based) so changed bytes produce new paths without overwriting old files.
- Filenames MUST be safe for common filesystems.

### Manifest (`mirror.json`)
The mirror MUST include a machine-readable manifest capturing at minimum:

- `downloadedAt`: ISO-8601 timestamp (UTC) when the snapshot was produced.
- `sourceUrl`: the original feed URL.
- `baseUrl`: base URL used for rewriting (if any).
- `http`: request/response metadata for the feed fetch (e.g., `etag`, `lastModified`, `status`).
- `assets`: a list/map of downloaded assets (content-hash keyed is recommended) with:
  - `kind`: `enclosure` | `podcastImage` | `episodeImage` | other.
  - `sourceUrl` (and optionally `sourceUrlHistory`)
  - `localPath`
  - `byteLength`
  - `contentHash` (SHA-256 recommended; SHOULD match the filename)
  - caching hints (`etag`, `lastModified`) when available
- `items`: episode entries keyed by a stable episode identifier, including references to the current enclosure/image assets and (optionally) prior enclosure versions.

The manifest SHOULD be stable and append-friendly so it can be used to avoid re-downloads.

## Mirroring semantics
### Fetching the feed
- The tool MUST fetch the source feed via HTTP(S).
- The tool SHOULD store the exact response body as `feed.source.xml`.
- The tool MUST parse the XML to enumerate assets and episode metadata.

### Selecting what to download
By default, the tool MUST mirror only:

- Episode media enclosures
- Podcast-level artwork and per-episode artwork (when present)

The tool MUST NOT mirror other linked resources (transcripts, chapters, etc.) unless an opt-in mode is added.

For each in-scope asset URL found in the feed:

- If an equivalent asset is already present locally AND is known to match the remote bytes, the tool MUST NOT re-download it.
- “Known to match” SHOULD be determined using one or more of:
  - HTTP caching metadata: `ETag` / `Last-Modified` via conditional requests.
  - A stored `contentHash` (preferred for integrity and deduplication).
  - Content-Length match (fallback).

Handling enclosure URL changes:
- Episodes are identified by `episodeId` (see below), not by enclosure URL.
- If an episode’s enclosure URL changes but `episodeId` stays the same:
  - If the remote bytes match an existing local asset, reuse it.
  - If the remote bytes differ, download the new asset and keep the old one; update the rewritten feed to point at the newest asset.

### Stable identifiers and filenames
Each episode MUST have a stable identifier (`episodeId`) used for manifest keys. Priority order:

1. RSS `<guid>` (verbatim value, normalized for hashing)
2. Enclosure URL
3. A fallback derived from `(title, pubDate)`

Assets MUST use content-addressed filenames derived from their bytes:

- Media: `media/<sha256>.<ext>`
- Images: `images/<sha256>.<ext>`

The extension SHOULD be derived from the URL path or HTTP `Content-Type`. If unknown, the tool MAY use `.bin`.

### Rewriting the feed
The rewritten `feed.xml` MUST be functionally equivalent to the source feed, except:

- All enclosure URLs MUST point to the mirrored local media files.
- Podcast-level and episode-level image URLs MUST point to mirrored local image files.
- If `baseUrl` is omitted, rewritten asset URLs MUST be relative paths within `outputDir` (default).
- If `baseUrl` is provided, rewritten asset URLs MUST be absolute using `baseUrl`.

Rewriting MUST cover (at minimum) common podcast fields:

- `item/enclosure[@url]`
- `channel/itunes:image[@href]`
- `channel/image/url`
- `item/itunes:image[@href]` (when present)
- `atom:link[@rel="self"]` (when present; points at the hosted `feed.xml` — relative `feed.xml` by default, or absolute when `baseUrl` is provided)

The tool SHOULD preserve formatting as much as practical, but correctness wins over formatting.

## Media metadata synchronization
After downloading (or when assets already exist), the tool MUST ensure media file metadata matches the feed metadata where feasible.

Key expectations:
- **No transcoding**: audio/video streams SHOULD remain unchanged.
- **Conditional writing**: if metadata already matches, the tool SHOULD not rewrite the file.
- **Format scope**: MP3/ID3 MUST be supported; MP4/M4A SHOULD be supported; other containers (e.g. OGG/Opus) MAY be added later.

A minimal “must support” mapping (when the container supports it):
- Episode title → media title
- Podcast title → album/collection
- Author/artist → artist
- Publication date → date
- Episode number / season (if present in feed) → track/episode fields
- Artwork → embedded cover art (podcast-level image by default; episode image if available)

If metadata updates fail for a file, the tool MUST:
- Keep the downloaded file (do not delete/lose it).
- Record the failure in the manifest.
- Continue processing other episodes when possible.

## Incremental updates and snapshots
- Every run MUST record `downloadedAt` and write a snapshot record under `snapshots/<timestamp>/`.
- Re-running against the same `outputDir` SHOULD:
  - Fetch the feed and compare against existing state.
  - Download only new/changed assets.
  - When remote bytes change, store a new content-hash asset and keep the old one.
  - Preserve existing assets and avoid rework.
- When a feed removes an episode, the mirror SHOULD keep previously downloaded assets by default (archival behavior). A cleanup mode MAY be added later.

## Failure handling
- Partial success is acceptable: if some episodes fail, `feed.xml` and `mirror.json` SHOULD still be produced, with failures recorded.
- The tool SHOULD be restartable: repeated runs should recover from interruptions without manual cleanup.

## Security and safety
- Treat remote XML as untrusted input.
- Avoid executing external entities (disable XXE).
- Validate and sanitize filenames.
- Prefer streaming downloads to avoid large memory usage.

## Project conventions (from `AGENTS.md`)
Implementation of this spec SHOULD follow these repo conventions:

- Use Jujutsu (`jj`) for version control workflows.
- Use Bun as the JavaScript runtime, package manager, and test runner.
- Favor test-driven development (fast, reproducible integration/E2E tests; minimal mocking).
- Avoid adding dependencies unless necessary; prefer native language/Bun APIs.
- Write self-contained code with no unintended side effects.

## Future considerations
- Add a retention/pruning mode for old asset versions (e.g. `--prune-old-assets`).
- Add opt-in mirroring for additional linked resources (transcripts, chapters, etc.).
- Add an “absolute-only” mode that requires `baseUrl` and fails if missing.
- Add optional human-friendly alias paths in addition to content-addressed storage.