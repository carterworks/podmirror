# podmirror

Create a local, static, re-hostable mirror of a podcast RSS feed.

`podmirror` downloads the source feed XML plus in-scope assets (episode enclosures and artwork), rewrites the feed to point at the downloaded files, and keeps incremental snapshots without re-downloading unchanged media.

## Usage

```
podmirror <rssUrl> <outputDir> [--base-url <baseUrl>]
```

### Examples

Mirror a feed into `./out/` (rewritten `feed.xml` uses relative URLs):

```sh
podmirror "https://example.com/podcast/feed.xml" ./out
```

Mirror a feed for rehosting at a public URL (rewritten `feed.xml` uses absolute URLs):

```sh
podmirror "https://example.com/podcast/feed.xml" ./out --base-url "https://cdn.example.net/podcast/"
```

Re-run to update in place (skips unchanged downloads; keeps old asset versions if bytes change):

```sh
podmirror "https://example.com/podcast/feed.xml" ./out
```

## Output

`outputDir/` is a self-contained static directory. Key files:

- `feed.xml`: rewritten feed to serve.
- `feed.source.xml`: exact source feed snapshot.
- `mirror.json`: manifest with `downloadedAt`, HTTP caching info, and asset records.
- `media/`: content-addressed enclosure files (`<sha256>.<ext>`).
- `images/`: content-addressed artwork files (`<sha256>.<ext>`).
- `snapshots/`: timestamped records of `feed.xml`, `feed.source.xml`, and `mirror.json`.

See `SPEC.md` for the normative behavior and edge cases.
