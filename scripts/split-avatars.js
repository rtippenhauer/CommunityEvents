// Splits the 4x3 bear composite into 12 individual avatars.
// Usage:
//   1. Place the composite image at scripts/bears-composite.jpg
//   2. npm install sharp  (one-time, in the repo root)
//   3. node scripts/split-avatars.js

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const INPUT = path.join(__dirname, 'bears-composite.png');
const OUTPUT_DIR = path.join(__dirname, '..', 'frontend', 'public', 'avatars');

const NAMES = [
  'bear-chef',
  'bear-flannel',
  'bear-cool',
  'bear-rainbow',
  'bear-hoodie',
  'bear-bookworm',
  'bear-explorer',
  'bear-musician',
  'bear-athlete',
  'bear-dapper',
  'bear-astronaut',
  'bear-artist',
];

async function split() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const { width, height } = await sharp(INPUT).metadata();
  const cols = 4;
  const rows = 3;
  const tileW = Math.floor(width / cols);
  const tileH = Math.floor(height / rows);

  console.log(`Image: ${width}x${height} → tiles: ${tileW}x${tileH}`);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const name = NAMES[index];
      const outPath = path.join(OUTPUT_DIR, `${name}.jpg`);

      const insetSide = 6;
      const insetTop = 6;
      const insetBottom = 16;
      await sharp(INPUT)
        .extract({
          left: col * tileW + insetSide,
          top: row * tileH + insetTop,
          width: tileW - insetSide * 2,
          height: tileH - insetTop - insetBottom,
        })
        .jpeg({ quality: 90 })
        .toFile(outPath);

      console.log(`  ✓ ${name}.jpg`);
    }
  }

  console.log(`\nDone — 12 avatars saved to frontend/public/avatars/`);
}

split().catch(console.error);
