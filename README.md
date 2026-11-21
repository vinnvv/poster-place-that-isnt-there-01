# OSMARA — The Poster for a Place That Isn't There

![Competition](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)
![Rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/vinnvv/poster-place-that-isnt-there-01/rank.svg)
![Reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/vinnvv/poster-place-that-isnt-there-01/reward.svg)

Entry for [The Poster for a Place That Isn't There](https://make.fun/c/the-poster-for-a-place-that-i-2-20261121-0539) on make.fun.

## The place

**OSMARA — The Tidal Sanctuary.** A tiered sea-cliff sanctuary where
salt-glass pavilions and brass skybridges hang inside a colossal coastal
arch, suspended between warm dusk above and bioluminescent tides below.

Through the Great Arch of Osmara opens a calm, mirror-flat tidal lagoon,
dotted with tiny crescent-sailed skiffs gliding toward the inner harbor.
The poster's one unforgettable idea is the split-time reflection: above the
horizon Osmara basks in golden-apricot sunset, while below the waterline the
lagoon shifts into deep indigo twilight where the arches glow with cool
seafoam light. A small skiff cuts a luminous wake across that boundary,
sailing into another time of day.

## How it is made

`main.ts` is a single self-contained Node program with zero dependencies and
no network access. It draws the poster entirely in code with a hand-written
rasterizer (scanline polygon fills, thick-stroke letterforms, gradients,
glows) and encodes the PNG itself (zlib deflate, hand-rolled CRC32), then
writes a deterministic 1024x1024 image to `/output/entry.png`.

The place name OSMARA is set in tall sculpted display capitals drawn as
geometric vector strokes, in warm alabaster with a burnished saffron edge.
The subtitle is set in a small tracked stroke font of the same family.

## Run it

```sh
node main.ts
```

It exits 0 and writes `/output/entry.png` (1024x1024, well under the 1 MiB
cap). Run it twice and the bytes are identical.

## License

MIT. See [LICENSE](LICENSE).
