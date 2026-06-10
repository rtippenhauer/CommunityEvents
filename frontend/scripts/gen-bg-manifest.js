const fs = require('fs');
const path = require('path');

function toLabel(filename) {
  // bear-master-chef.jpg → "Master Chef"
  const base = path.basename(filename, path.extname(filename)); // bear-master-chef
  const afterDash = base.replace(/^[^-]+-/, '');                // master-chef
  return afterDash
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function writeManifest(dir, transform) {
  const out = path.join(dir, 'manifest.json');
  if (!fs.existsSync(dir)) {
    fs.writeFileSync(out, '[]\n');
    return 0;
  }
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .sort();
  fs.writeFileSync(out, JSON.stringify(files.map(transform), null, 2) + '\n');
  return files.length;
}

// Backgrounds — plain filename array
const bgDir = path.join(__dirname, '../public/backgrounds');
const bgCount = writeManifest(bgDir, f => f);
console.log(`[bg-manifest]     ${bgCount} background(s)`);

// Avatars — array of { path, label }
const avDir = path.join(__dirname, '../public/avatars');
const avCount = writeManifest(avDir, f => ({ path: `/avatars/${f}`, label: toLabel(f) }));
console.log(`[avatar-manifest] ${avCount} avatar(s)`);
