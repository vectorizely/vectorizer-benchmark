// Runs inside headless Chromium (driven by run.mjs). Scores finished SVGs from any engine
// against their source image. The tile code cuts the zoomed crops the benchmark page shows;
// run.mjs does not ask for them.

const LONG = 640; // every SVG and its source are compared at this size, long side
const fit = (w, h, max) => {
  const s = max / Math.max(w, h);
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
};
function pixels(src, w, h) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
async function svgImage(svg) {
  // SVGs with only width and height (AutoTrace, ImageTracer.js) get a viewBox, so they scale
  if (!/viewBox=/.test(svg)) {
    const w = svg.match(/<svg[^>]*\bwidth="([\d.]+)/), h = svg.match(/<svg[^>]*\bheight="([\d.]+)/);
    if (w && h) svg = svg.replace('<svg', `<svg viewBox="0 0 ${w[1]} ${h[1]}"`);
  }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  return img;
}
function lab(r, g, b) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const white = (d, i) => { const a = d[i + 3] / 255; return [0, 1, 2].map((k) => d[i + k] * a + 255 * (1 - a)); };

/**
 * leak: opaque source pixels the SVG leaves see-through; dE: mean CIE76 color error over
 * every pixel, both placed on white (a pixel neither covers adds zero, so an engine that
 * traces a white background is judged on the same pixels as one that keeps it clear); ink: overlap of the dark pixels (luma under half, over white), intersection over
 * union, for line art, where paper is meant to come out transparent.
 */
function score(ref, out) {
  let opaque = 0, leaks = 0, dSum = 0, both = 0, either = 0, refInk = 0, outInk = 0;
  const err = new Float32Array(ref.width * ref.height);
  const inkErr = new Float32Array(ref.width * ref.height);
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (let p = 0; p < err.length; p++) {
    const i = p * 4, sa = ref.data[i + 3], oa = out.data[i + 3];
    if (sa === 255) { opaque++; if (oa < 250) leaks++; }
    const rc = white(ref.data, i), oc = white(out.data, i);
    const ri = luma(rc) < 128, oi = luma(oc) < 128;
    if (ri && oi) both++;
    if (ri || oi) either++;
    if (ri) refInk++;
    if (oi) outInk++;
    if (ri !== oi) inkErr[p] = 1;
    if (sa || oa) {
      const a = lab(...rc), b = lab(...oc);
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      err[p] = d + (sa === 255 && oa < 250 ? 40 : 0);
      dSum += d;
    }
  }
  // ink precision: how much of the SVG's ink is ink in the source (low: strokes too heavy);
  // recall: how much of the source's ink the SVG has (low: strokes too thin, or lost)
  return { leakPct: opaque ? (100 * leaks) / opaque : 0, meanDE: dSum / err.length, inkIoU: either ? (100 * both) / either : 100,
    inkP: outInk ? (100 * both) / outInk : 100, inkR: refInk ? (100 * both) / refInk : 100, err, inkErr };
}

/**
 * @param {string} url the source image
 * @param {Array<{ id: string, svg: string }>} runs one finished SVG per engine
 * @param {{ tiles: boolean, tile: number, crop: number, cropBy?: 'color' | 'ink' }} opts tile: crop size in px; crop: its
 *   side in the 640 px comparison; cropBy: crop where colors disagree most, or (line art) where the ink does
 */
window.scoreCase = async (url, runs, opts) => {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const [rw, rh] = fit(bmp.width, bmp.height, LONG);
  const ref = pixels(bmp, rw, rh);
  const results = [];
  for (const r of runs) {
    const img = await svgImage(r.svg);
    const m = score(ref, pixels(img, rw, rh));
    results.push({ id: r.id, img, err: opts.cropBy === 'ink' ? m.inkErr : m.err, leakPct: m.leakPct, meanDE: m.meanDE, inkIoU: m.inkIoU, inkP: m.inkP, inkR: m.inkR });
  }
  const metrics = results.map(({ id, leakPct, meanDE, inkIoU, inkP, inkR }) => ({ id, leakPct: +leakPct.toFixed(3), meanDE: +meanDE.toFixed(2), inkIoU: +inkIoU.toFixed(1), inkP: +inkP.toFixed(1), inkR: +inkR.toFixed(1) }));
  if (!opts.tiles) return { metrics };

  // crop where the engines disagree most with the source: the busiest square window
  const cw = Math.min(rw, rh, opts.crop);
  const tot = new Float32Array(rw * rh);
  for (const r of results) for (let i = 0; i < tot.length; i++) tot[i] += r.err[i];
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y + cw <= rh; y += 4) for (let x = 0; x + cw <= rw; x += 4) {
    let s = 0;
    for (let yy = y; yy < y + cw; yy += 2) for (let xx = x; xx < x + cw; xx += 2) s += tot[yy * rw + xx];
    if (s > best) { best = s; bx = x; by = y; }
  }
  const zoom = opts.tile / cw;
  const tile = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = opts.tile;
    const ctx = c.getContext('2d');
    // a light checkerboard shows any see-through gap
    for (let y = 0; y < opts.tile; y += 16) for (let x = 0; x < opts.tile; x += 16) {
      ctx.fillStyle = ((x + y) / 16) % 2 ? '#e9edf2' : '#ffffff';
      ctx.fillRect(x, y, 16, 16);
    }
    draw(ctx);
    return c.toDataURL('image/webp', 0.86);
  };
  const s = bmp.width / rw; // source px per comparison px
  const tiles = { source: tile((ctx) => { ctx.imageSmoothingEnabled = false; ctx.drawImage(bmp, bx * s, by * s, cw * s, cw * s, 0, 0, opts.tile, opts.tile); }) };
  for (const r of results) tiles[r.id] = tile((ctx) => ctx.drawImage(r.img, -bx * zoom, -by * zoom, rw * zoom, rh * zoom));
  return { metrics, crop: { x: +(bx / rw).toFixed(4), y: +(by / rh).toFixed(4), size: +(cw / rw).toFixed(4) }, tiles };
};
window.compareReady = true;
