# Free vectorizer benchmark

The same 20 test images traced by the open-source engines behind free image-to-SVG converters,
each at its default settings, and scored against the source image. This is the code and data
behind [vectorizely.com/vectorizer-benchmark](https://vectorizely.com/vectorizer-benchmark/),
which has the write-up, zoomed crops and the list of free tools built on each engine.

Also listed on [SourceForge](https://sourceforge.net/projects/vectorizer-benchmark/).

We built one of the engines tested ([Vectorizely](https://vectorizely.com/)), so the method,
the scoring code and every number are here to check.

## Results on the images in this repository (2026-11-21, 20 images)

All 20 images are here, so this table can be rerun by anyone. Color engines, all 20 images:

| Engine | Settings | See-through pixels | Color error (ΔE) | Anchor points (median) | SVG size (median) |
|---|---|---:|---:|---:|---:|
| Vectorizely | Color mode, colors on Auto | 0.002% | 2.98 | 278.5 | 6.8 KB |
| VTracer 1.0.0-alpha.4 | library defaults | 0.000% | 6.75 | 1,041.5 | 28.6 KB |
| ImageTracer.js 1.2.6 | `default` preset (16 colors) | 8.208% | 4.10 | 4,161.5 | 107.7 KB |
| AutoTrace 0.40.0 | `-color-count 16` | 4.091% | 5.05 | 12,453.5 | 278.2 KB |
| AutoTrace 0.40.0 | command-line defaults | 20.707% | 12.31 | 68,555.5 | 1,604.0 KB |

Black-and-white engines, the 5 line art images:

| Engine | Settings | Ink overlap | Anchor points (median) | SVG size (median) |
|---|---|---:|---:|---:|
| Vectorizely | B&W mode | 93.10% | 5,251 | 82.3 KB |
| Potrace 1.16 | defaults, image thresholded at 50% gray | 93.08% | 6,107 | 107.0 KB |
| VTracer 1.0.0-alpha.4 | `bw` preset | 87.02% | 7,858 | 159.7 KB |

Vectorizely and Potrace are level on ink overlap. Potrace is ahead on the drawing photographed
on paper (95.5% against 91.4%) and behind on the four clean ones. Every row is in
[`reference/open-set-2026-11-21.csv`](reference/open-set-2026-11-21.csv).

## Results on the page (2026-10-05)

[The page](https://vectorizely.com/vectorizer-benchmark/) was measured earlier on a different set
of 20: nine of the images here and eleven from Pixabay, whose license does not let us hand the
files on as they are. Those numbers are in
[`published/results-2026-10-05.csv`](published/results-2026-10-05.csv) (112 rows). The set here
swaps the eleven for public-domain and CC0 files from Wikimedia Commons, picked before the first
run, so the two tables differ. The nine shared images score the same in both, digit for digit.
[CREDITS.md](CREDITS.md) lists every image's source and license.

## Run it

```bash
brew install imagemagick potrace autotrace   # or your system's packages
npm install
npx playwright install chromium
node run.mjs
```

`node run.mjs rocket` runs only the images whose name matches. The run prints a summary and
writes `results/results.csv` and every traced SVG to `results/svg/`. `npm run check` runs
everything and compares the CSV with the reference run. It matched on macOS with Chromium 140,
AutoTrace 0.40.0, Potrace 1.16 and ImageMagick 7; other versions can move the last digit.

## Method

Each engine gets the same pixels. AutoTrace and Potrace cannot read transparency, so they run on
the image flattened onto white. Every SVG is then drawn in headless Chromium at 640 px on the
long side and compared with the source image at the same size
([`score-page.js`](score-page.js)).

- **See-through pixels:** the share of the source's fully opaque pixels that come out less than
  98% opaque. These are the white dots, seams and gaps between shapes.
- **Color error:** the mean CIE76 ΔE between source and SVG over every pixel of the image, both
  placed on white. A pixel neither one covers counts as zero, so an engine that traces the white
  background is averaged over the same pixels as one that leaves it clear.
- **Ink overlap:** for line art, the pixels darker than half brightness in both the source and
  the SVG, divided by those dark in either. Black-and-white engines leave the paper clear, so
  see-through pixels would say nothing about them.
- **Anchor points:** the points you would edit. Shape counts undersell Potrace, which packs many
  outlines into one compound path.
- **SVG size:** the file as written, not minified or compressed.

Trace time is not scored: the engines run in different runtimes (WebAssembly, JavaScript, native
binaries), so their times do not compare.

## Vectorizely's engine

Vectorizely is VTracer plus our own color cleanup and shadow tracing. That code is not in this
repository. Its output is: [`vectorizely/`](vectorizely/) holds the SVG it produced for each
image, and `run.mjs` scores those files with the same code as every other engine. To make them
yourself, load an image at [vectorizely.com](https://vectorizely.com/), leave the settings alone
and download the SVG (for the B&W files, switch the mode to B&W). The site's engine changes, so
a file traced today can differ from the one saved here.

## Add an engine

Add an entry to `ENGINES` in [`run.mjs`](run.mjs): an `id`, a `name`, and a `run(img)` function
that returns an SVG string. `img` has `file` (path), `w`, `h` and `rgba` (8-bit, not
premultiplied). Pull requests with more engines or more freely licensed test images are welcome.

## License

Code: MIT ([LICENSE](LICENSE)). `lib/imagetracer.js` is
[ImageTracer.js](https://github.com/jankovicsandras/imagetracerjs) 1.2.6, in the public domain
under the Unlicense. Images and saved SVGs: see [CREDITS.md](CREDITS.md).
