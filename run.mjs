// Free vectorizer benchmark: traces every image in images/ with the open-source engines
// behind free vectorizers, each at its default settings, and scores the SVGs against the
// source image in headless Chromium.
//
//   node run.mjs            every image listed in images.json that is present in images/
//   node run.mjs rocket     only images whose id matches the regular expression
//
// Writes results/results.csv and every traced SVG to results/svg/.
// Needs ImageMagick, Potrace and AutoTrace on the PATH, and `npm install`.
import { createRequire } from 'node:module';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { parsePathData } from './lib/path-data.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const vtracer = require('@visioncortex/vtracer');
// PLAYWRIGHT_FROM points at another node_modules folder that already holds Playwright
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)('playwright');

// ImageTracer.js is a CommonJS file in this ES-module package: run it with a module object
const itModule = { exports: {} };
new Function('module', 'exports', readFileSync(join(here, 'lib/imagetracer.js'), 'utf8'))(itModule, itModule.exports);
const ImageTracer = itModule.exports;

const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const listed = JSON.parse(readFileSync(join(here, 'images.json'), 'utf8'));
const IMAGES = [];
for (const meta of listed) {
  meta.id = basename(meta.file, extname(meta.file));
  if (only && !only.test(meta.id)) continue;
  if (!existsSync(join(here, 'images', meta.file))) { console.log(`skipped ${meta.id}: images/${meta.file} is not here (see CREDITS.md)`); continue; }
  IMAGES.push(meta);
}
if (!IMAGES.length) throw new Error('no images to run');

const out = join(here, 'results');
const tmp = mkdtempSync(join(tmpdir(), 'vz-bench-'));
const run = (cmd, args, input) => execFileSync(cmd, args, { input, maxBuffer: 512 << 20, stdio: ['pipe', 'pipe', 'ignore'] });
const versionOf = (cmd, args, re) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  const m = `${r.stdout}${r.stderr}`.match(re);
  if (!m) throw new Error(`could not read the ${cmd} version: is it installed?`);
  return m[1];
};
const flat = ['-background', 'white', '-alpha', 'remove', '-alpha', 'off'];

function decode(file) {
  const [w, h] = run('magick', ['identify', '-format', '%w %h', file]).toString().split(' ').map(Number);
  const rgba = new Uint8Array(run('magick', [file, '-depth', '8', 'rgba:-']));
  if (rgba.length !== w * h * 4) throw new Error(`${file}: expected ${w * h * 4} bytes of RGBA, got ${rgba.length}`);
  return { file, w, h, rgba };
}
function autotrace(img, args = []) {
  const ppm = join(tmp, 'in.ppm'), svg = join(tmp, 'out.svg');
  run('magick', [img.file, ...flat, `ppm:${ppm}`]);
  run('autotrace', ['-output-format', 'svg', '-output-file', svg, ...args, ppm]);
  return readFileSync(svg, 'utf8');
}
function potrace(img) {
  const pbm = run('magick', [img.file, ...flat, '-colorspace', 'Gray', '-threshold', '50%', 'pbm:-']);
  return run('potrace', ['-s', '-o', '-', '-'], pbm).toString();
}
// Vectorizely's engine is not in this repository. Its SVGs are: vectorizely/ holds the file
// vectorizely.com produced for each image, and they are scored here like every other SVG.
function saved(suffix) {
  return (img) => {
    const file = join(here, 'vectorizely', `${basename(img.file, extname(img.file))}.${suffix}.svg`);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  };
}

const vtracerVersion = JSON.parse(readFileSync(require.resolve('@visioncortex/vtracer/package.json'), 'utf8')).version;
const autotraceVersion = versionOf('autotrace', ['-version'], /AutoTrace version (\d+(?:\.\d+)+)/);
const ENGINES = {
  color: [
    { id: 'vectorizely', name: 'Vectorizely', version: 'saved SVGs', settings: 'Color mode, colors on Auto (the defaults)', run: saved('vectorizely') },
    { id: 'vtracer', name: 'VTracer', version: vtracerVersion, settings: 'library defaults', run: (img) => vtracer.convertPixels(img.rgba, img.w, img.h) },
    { id: 'imagetracer', name: 'ImageTracer.js', version: ImageTracer.versionnumber, settings: "the 'default' preset (16 colors)", run: (img) => ImageTracer.imagedataToSVG({ width: img.w, height: img.h, data: new Uint8ClampedArray(img.rgba) }, 'default') },
    // AutoTrace's own default does no color reduction, and on photos and gradients it drops
    // whole regions; front ends set a color count, so it runs with ImageTracer.js's 16
    { id: 'autotrace', name: 'AutoTrace', version: autotraceVersion, settings: '16 colors (-color-count 16), on the image flattened onto white', run: (img) => autotrace(img, ['-color-count', '16']) },
    { id: 'autotrace_default', name: 'AutoTrace', version: autotraceVersion, settings: 'command-line defaults, on the image flattened onto white', run: (img) => autotrace(img) },
  ],
  bw: [
    { id: 'vectorizely_bw', name: 'Vectorizely', version: 'saved SVGs', settings: 'B&W mode', run: saved('vectorizely_bw') },
    { id: 'potrace', name: 'Potrace', version: versionOf('potrace', ['--version'], /potrace (\d+(?:\.\d+)+)/), settings: 'command-line defaults, on the image thresholded at 50% gray', run: potrace },
    { id: 'vtracer_bw', name: 'VTracer', version: vtracerVersion, settings: "the 'bw' preset", run: (img) => vtracer.convertPixels(img.rgba, img.w, img.h, { preset: 'bw' }) },
  ],
};

const SHAPES = /<(path|polygon|polyline|rect|circle|ellipse|line)\b/g;
const countShapes = (svg) => (svg.match(SHAPES) || []).length;
// anchor points: what you'd edit, and comparable across engines (Potrace packs many outlines
// into one compound path, so shape counts undersell it)
function countAnchors(svg) {
  let n = 0;
  for (const [, d] of svg.matchAll(/\sd="([^"]*)"/g)) for (const sub of parsePathData(d)) n += 1 + sub.segs.length;
  for (const [, pts] of svg.matchAll(/\spoints="([^"]*)"/g)) n += (pts.match(/-?[\d.]+/g) || []).length / 2;
  return n;
}

// ---- trace ------------------------------------------------------------------------
mkdirSync(join(out, 'svg'), { recursive: true });
const traced = []; // { image, set, engine, svg }
for (const meta of IMAGES) {
  const img = decode(join(here, 'images', meta.file));
  for (const set of meta.category === 'lineart' ? ['color', 'bw'] : ['color']) {
    for (const e of ENGINES[set]) {
      const svg = e.run(img);
      if (svg === null) continue;
      writeFileSync(join(out, 'svg', `${meta.id}.${e.id}.svg`), svg);
      traced.push({ image: meta.id, set, engine: e.id, svg });
    }
  }
  console.log(`traced ${meta.id}`);
}

// ---- score in Chromium ----------------------------------------------------------------
const types = { '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><script src="/score-page.js"></script>'); }
  const file = p === '/score-page.js' ? join(here, 'score-page.js') : join(here, 'images', basename(p));
  try { const body = readFileSync(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForFunction(() => window.compareReady);

const results = [];
for (const meta of IMAGES) {
  for (const set of ['color', 'bw']) {
    const runs = traced.filter((t) => t.image === meta.id && t.set === set);
    if (!runs.length) continue;
    const r = await page.evaluate(({ url, runs }) => window.scoreCase(url, runs, { tiles: false }),
      { url: `/${meta.file}`, runs: runs.map((t) => ({ id: t.engine, svg: t.svg })) });
    for (const m of r.metrics) {
      const t = runs.find((x) => x.engine === m.id);
      results.push({ set, image: meta.id, category: meta.category, engine: m.id, leakPct: m.leakPct, deltaE: m.meanDE, inkIoU: m.inkIoU, shapes: countShapes(t.svg), anchors: countAnchors(t.svg), kb: +(Buffer.byteLength(t.svg) / 1024).toFixed(1) });
    }
  }
  console.log(`scored ${meta.id}`);
}
const chromiumVersion = browser.version();
await browser.close();
server.close();
rmSync(tmp, { recursive: true, force: true });
if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);

// ---- write ---------------------------------------------------------------------------
const csv = ['set,image,category,engine,leak_pct,delta_e,ink_iou_pct,shapes,anchor_points,kb'];
for (const r of results) csv.push([r.set, r.image, r.category, r.engine, r.leakPct, r.deltaE, r.inkIoU, r.shapes, r.anchors, r.kb].join(','));
writeFileSync(join(out, 'results.csv'), csv.join('\n') + '\n');

const by = (set, engine, k) => results.filter((r) => r.set === set && r.engine === engine).map((r) => r[k]);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
console.log(`\nScored in Chromium ${chromiumVersion}, every SVG and its source at 640 px on the long side`);
for (const set of ['color', 'bw']) {
  const n = new Set(results.filter((r) => r.set === set).map((r) => r.image)).size;
  if (!n) continue;
  console.log(`\n${set === 'color' ? `Color engines, ${n} images` : `Black-and-white engines, ${n} line art images`}`);
  for (const e of ENGINES[set]) {
    if (!by(set, e.id, 'kb').length) continue;
    const head = `  ${e.id.padEnd(18)} ${`${e.name} ${e.version}`.padEnd(28)}`;
    console.log(set === 'color'
      ? `${head} see-through ${mean(by(set, e.id, 'leakPct')).toFixed(3).padStart(7)}%  color error ${mean(by(set, e.id, 'deltaE')).toFixed(2).padStart(5)}  anchors (median) ${String(median(by(set, e.id, 'anchors'))).padStart(8)}  KB (median) ${median(by(set, e.id, 'kb')).toFixed(1).padStart(7)}`
      : `${head} ink overlap ${mean(by(set, e.id, 'inkIoU')).toFixed(2).padStart(6)}%  anchors (median) ${String(median(by(set, e.id, 'anchors'))).padStart(8)}  KB (median) ${median(by(set, e.id, 'kb')).toFixed(1).padStart(7)}`);
  }
}
