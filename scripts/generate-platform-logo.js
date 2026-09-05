/**
 * Generates the platform fallback logo PNG (v2-10).
 *
 * Why a generated raster rather than the SVG marks the app uses: this file is
 * for **email and push notifications**, which cannot take an SVG. Gmail and
 * Outlook strip SVG entirely, and browsers do not reliably render an SVG as a
 * notification icon -- so the in-app generated marks cannot reach either
 * surface, and a raster is the only thing that works.
 *
 * Why a script rather than a checked-in binary with no provenance: the output
 * is committed, but this makes it reproducible and says plainly what it is --
 * a STAND-IN built from the CommunityEvents mark's geometry (a 2x2 grid of
 * rounded tiles around a centre circle). It carries no wordmark, because
 * rasterising text needs font data this deliberately does not pull in.
 *
 * To replace it with the real artwork, just overwrite the output file. Nothing
 * reads this script at build or run time.
 *
 *   node scripts/generate-platform-logo.js
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'frontend', 'public', 'brand', 'communityevents-logo.png');

// Rendered at height 100 in the email header, so 200 gives 2x for retina.
const SIZE = 200;
// Supersample, then box-filter down -- the only anti-aliasing available
// without a rasteriser, and rounded corners look like stairs without it.
const SS = 4;
const W = SIZE * SS;

// The CommunityEvents mark's four tiles, clockwise from top-left.
const TILES = [
  { x: 0, y: 0, color: [0x25, 0x63, 0xeb] }, // blue
  { x: 1, y: 0, color: [0x7c, 0x3a, 0xed] }, // purple
  { x: 0, y: 1, color: [0xf5, 0x9e, 0x0b] }, // orange
  { x: 1, y: 1, color: [0x4f, 0x46, 0xe5] }, // indigo
];

const GAP = 0.045 * W;
const TILE = (W - GAP) / 2;
const RADIUS = TILE * 0.28;
const CENTER_R = W * 0.085;

function insideRoundedRect(px, py, x0, y0, w, h, r) {
  if (px < x0 || py < y0 || px > x0 + w || py > y0 + h) return false;
  const cx = Math.min(Math.max(px, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(py, y0 + r), y0 + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

// Supersampled RGBA buffer, transparent by default so the mark composites onto
// whatever ground the mail client or notification shade uses.
const hi = new Uint8ClampedArray(W * W * 4);
const mid = W / 2;

for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    let rgba = null;
    for (const t of TILES) {
      const x0 = t.x * (TILE + GAP);
      const y0 = t.y * (TILE + GAP);
      if (insideRoundedRect(x + 0.5, y + 0.5, x0, y0, TILE, TILE, RADIUS)) {
        rgba = [...t.color, 255];
        break;
      }
    }
    // The centre circle punches through where the four tiles meet, matching
    // the mark. Transparent rather than white so it works on any ground.
    const dx = x + 0.5 - mid;
    const dy = y + 0.5 - mid;
    if (dx * dx + dy * dy <= CENTER_R * CENTER_R) rgba = null;

    const i = (y * W + x) * 4;
    if (rgba) {
      hi[i] = rgba[0];
      hi[i + 1] = rgba[1];
      hi[i + 2] = rgba[2];
      hi[i + 3] = rgba[3];
    }
  }
}

// Box-filter down to SIZE. Averaging straight RGBA would darken edge pixels
// toward transparent black, so colour is averaged weighted by alpha.
const out = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  out[y * (SIZE * 4 + 1)] = 0; // PNG filter type 0 (None) per scanline
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        const av = hi[i + 3];
        r += hi[i] * av;
        g += hi[i + 1] * av;
        b += hi[i + 2] * av;
        a += av;
      }
    }
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    out[o] = a ? Math.round(r / a) : 0;
    out[o + 1] = a ? Math.round(g / a) : 0;
    out[o + 2] = a ? Math.round(b / a) : 0;
    out[o + 3] = Math.round(a / (SS * SS));
  }
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
ihdr[10] = 0; // deflate
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(out, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)}KB)`);
