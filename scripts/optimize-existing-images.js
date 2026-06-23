// One-off maintenance pass: re-encode every already-uploaded image through the
// same resize+compress pipeline used for new uploads (see optimizeImage in
// server.js). Run once with: node scripts/optimize-existing-images.js
//
// Safety: backs up the current db/data.json and every original file it touches
// to ./backup-before-optimize/ before replacing or deleting anything. An image
// is only replaced if the optimized version is actually smaller.

require('dotenv').config();
const path  = require('path');
const fs    = require('fs');
const sharp = require('sharp');

const BASE       = path.join(__dirname, '..');
const UPLOADS    = path.join(BASE, 'uploads');
const BACKUP_DIR = path.join(BASE, 'backup-before-optimize');
const USE_BLOB   = !!process.env.BLOB_READ_WRITE_TOKEN;
const { put, list, del } = USE_BLOB ? require('@vercel/blob') : {};

const MAX_DIMENSION = 2400;
const JPEG_QUALITY  = 85;

async function optimizeImage(buffer) {
  const image = sharp(buffer, { failOn: 'none' }).rotate();
  const meta  = await image.metadata();
  if ((meta.width || 0) > MAX_DIMENSION || (meta.height || 0) > MAX_DIMENSION) {
    image.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
  }
  return image.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}

async function readDB() {
  if (!USE_BLOB) {
    return JSON.parse(fs.readFileSync(path.join(BASE, 'data.json'), 'utf8'));
  }
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

async function storeOptimized(buffer) {
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

async function deleteOriginal(filename) {
  if (filename.startsWith('http')) {
    if (USE_BLOB) await del(filename).catch(() => {});
  } else {
    const fp = path.join(UPLOADS, filename);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
  }
}

function fmtMB(bytes) { return (bytes / 1024 / 1024).toFixed(2) + 'MB'; }

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const db = await readDB();
  fs.writeFileSync(path.join(BACKUP_DIR, 'data.json'), JSON.stringify(db, null, 2), 'utf8');
  console.log(`Backup mode: ${USE_BLOB ? 'Vercel Blob' : 'local disk'}`);
  console.log(`Backed up current data.json → ${path.join(BACKUP_DIR, 'data.json')}\n`);

  let processed = 0, skipped = 0, failed = 0;
  let totalBefore = 0, totalAfter = 0;

  for (const project of db.projects) {
    for (const img of project.images) {
      const label = `[${project.title || project.id}] image ${img.id}`;
      try {
        const original = await readOriginal(img.filename);
        const optimized = await optimizeImage(original);

        if (optimized.length >= original.length) {
          console.log(`- skip  ${label}: already optimal (${fmtMB(original.length)})`);
          skipped++;
          continue;
        }

        // Back up the original bytes before touching anything
        const backupName = `${img.id}-${path.basename(img.filename).split('?')[0]}`;
        fs.writeFileSync(path.join(BACKUP_DIR, backupName), original);

        const newFilename = await storeOptimized(optimized);
        const oldFilename = img.filename;
        img.filename = newFilename;
        await writeDB(db); // persist incrementally so a crash mid-run loses minimal progress
        await deleteOriginal(oldFilename);

        totalBefore += original.length;
        totalAfter  += optimized.length;
        processed++;
        console.log(`✓ done  ${label}: ${fmtMB(original.length)} → ${fmtMB(optimized.length)}`);
      } catch (err) {
        failed++;
        console.error(`✗ FAIL  ${label}: ${err.message}`);
      }
    }
  }

  console.log(`\nDone. processed=${processed} skipped=${skipped} failed=${failed}`);
  if (processed > 0) {
    console.log(`Total: ${fmtMB(totalBefore)} → ${fmtMB(totalAfter)} (saved ${fmtMB(totalBefore - totalAfter)})`);
  }
  console.log(`Originals of replaced images backed up in: ${BACKUP_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
