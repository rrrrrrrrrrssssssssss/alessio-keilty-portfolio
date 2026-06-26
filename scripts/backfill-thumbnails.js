// One-off maintenance pass: generate the small `thumbFilename` derivative
// (used by the sidebar filmstrip and the gallery index grid) for images that
// were uploaded before thumbnails existed. Does not touch the existing
// full-size `filename` — purely additive, nothing is deleted or replaced.
// Run once with: node scripts/backfill-thumbnails.js

require('dotenv').config();
const path  = require('path');
const fs    = require('fs');
const sharp = require('sharp');

const BASE     = path.join(__dirname, '..');
const UPLOADS  = path.join(BASE, 'uploads');
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const { put, list } = USE_BLOB ? require('@vercel/blob') : {};

const THUMB_DIMENSION = 360;
const THUMB_QUALITY   = 75;

async function makeThumb(buffer) {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toBuffer();
}

async function readDB() {
  if (!USE_BLOB) return JSON.parse(fs.readFileSync(path.join(BASE, 'data.json'), 'utf8'));
  const { blobs } = await list({ prefix: 'db/data.json' });
  if (!blobs.length) throw new Error('db/data.json not found on Blob');
  const res = await fetch(blobs[0].url + '?t=' + Date.now());
  if (!res.ok) throw new Error(`readDB failed (${res.status})`);
  return res.json();
}

async function writeDB(data) {
  if (!USE_BLOB) {
    fs.writeFileSync(path.join(BASE, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
    return;
  }
  await put('db/data.json', JSON.stringify(data, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
}

async function readOriginal(filename) {
  if (filename.startsWith('http')) {
    const res = await fetch(filename);
    if (!res.ok) throw new Error(`fetch failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(path.join(UPLOADS, filename));
}

async function storeImageBuffer(buffer) {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  if (USE_BLOB) {
    const blob = await put(`images/${name}`, buffer, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'image/jpeg'
    });
    return blob.url;
  }
  fs.writeFileSync(path.join(UPLOADS, name), buffer);
  return name;
}

function fmtKB(bytes) { return (bytes / 1024).toFixed(0) + 'KB'; }

async function main() {
  const db = await readDB();
  let processed = 0, skipped = 0, failed = 0;

  for (const project of db.projects) {
    for (const img of project.images) {
      const label = `[${project.title || project.id}] image ${img.id}`;
      if (img.thumbFilename) { skipped++; continue; }
      try {
        const original = await readOriginal(img.filename);
        const thumb = await makeThumb(original);
        img.thumbFilename = await storeImageBuffer(thumb);
        await writeDB(db); // persist incrementally
        processed++;
        console.log(`✓ done  ${label}: thumb ${fmtKB(thumb.length)}`);
      } catch (err) {
        failed++;
        console.error(`✗ FAIL  ${label}: ${err.message}`);
      }
    }
  }

  console.log(`\nDone. processed=${processed} skipped=${skipped} failed=${failed}`);
}

main().catch(err => { console.error(err); process.exit(1); });
