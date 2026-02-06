# podmirror

`podmirror` is a simple script to download all the episodes of a podcast, to be replayed in a standard media player like foobar or Plex.

```
$ podmirror --url "https://feeds.npr.org/510289/podcast.xml" --output "./Planet Money" --download-thumbnail --download-sidecar --set-tags --force
[OK]      Podcast "Planet Money" has 355 episodes
[354/355] Downloading "355 -Can Trump make buying a home more affordable.mp3"
# later
[OK]      Done!
$ ls
./Planet Money/feed.xml
./Planet Money/cover.jpeg
./Planet Money/355 - Can Trump make buying a home more affordable.mp3
./Planet Money/355 - Can Trump make buying a home more affordable.jpeg
./Planet Money/355 - Can Trump make buying a home more affordable.xml
```

- `--url "https://feeds.npr.org/510289/podcast.xml"`
- `--output "./Planet Money"`
- `--download-thumbnail`: saves the `itunes:image` or `media:thumbnail` as a standalone file.
- `--download-sidecar`: saves the `<item>` from the full feed XML as a standalone file.
- `--set-tags`: sets the appropiate embedded media tags (id3 or whatever is idiomatic for the file format)
- `--force`: by default, `podmirror` will not download episodes that already exist in the output directory. But if `--force` is applied, it will download them anyways.
