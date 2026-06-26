// One-off maintenance pass: re-encode every image (both the full-size file and
// its thumbnail) from JPEG to WebP, which is ~30-40% lighter at equivalent
// visual quality. Mirrors the encoder settings now used for new uploads (see
// optimizeImage/makeThumb in server.js). Run once with:
//   node scripts/reoptimize-webp.js
//
// Safety: an image is only replaced if the WebP version is actually smaller;
// the old file is deleted only after the new one is stored and the DB saved.

require('dotenv').config();
const path  = require('path');
const fs    = require('fs');
const sharp = require('sharp');

const BASE     = path.join(__dirname, '..');
const UPLOADS  = path.join(BASE, 'uploads');
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const { put, list, del } = USE_BLOB ? require('@vercel/blob') : {};

const MAX_DIMENSION   = 2400;
const WEBP_QUALITY    = 80;
const THUMB_DIMENSION = 360;
const THUMB_QUALITY   = 70;

async function toWebpFull(buffer) {
  const image = sharp(buffer, { failOn: 'none' }).rotate();
  const meta  = await image.metadata();
  if ((meta.width || 0) > MAX_DIMENSION || (meta.height || 0) > MAX_DIMENSION) {
    image.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
  }
  return image.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer();
}

async function toWebpThumb(buffer) {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY, effort: 4 })
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
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
  if (USE_BLOB) {
    const blob = await put(`images/${name}`, buffer, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'image/webp'
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

function fmtKB(bytes) { return (bytes / 1024).toFixed(0) + 'KB'; }

// Re-encodes one field (`filename` or `thumbFilename`) on an image record, in place.
async function reencodeField(img, field, encode) {
  const current = img[field];
  if (!current) return null;
  const original = await readOriginal(current);
  const reencoded = await encode(original);
  if (reencoded.length >= original.length) return { skipped: true };
  const oldFilename = current;
  img[field] = await storeImageBuffer(reencoded);
  return { skipped: false, oldFilename, before: original.length, after: reencoded.length };
}

async function main() {
  const db = await readDB();
  let processed = 0, skipped = 0, failed = 0;
  let totalBefore = 0, totalAfter = 0;

  for (const project of db.projects) {
    for (const img of project.images) {
      const label = `[${project.title || project.id}] image ${img.id}`;
      try {
        const fullResult  = await reencodeField(img, 'filename', toWebpFull);
        const thumbResult = await reencodeField(img, 'thumbFilename', toWebpThumb);

        const didAnything = (fullResult && !fullResult.skipped) || (thumbResult && !thumbResult.skipped);
        if (!didAnything) { skipped++; console.log(`- skip  ${label}: already optimal`); continue; }

        await writeDB(db); // persist incrementally so a crash mid-run loses minimal progress

        if (fullResult && !fullResult.skipped) {
          await deleteOriginal(fullResult.oldFilename);
          totalBefore += fullResult.before; totalAfter += fullResult.after;
        }
        if (thumbResult && !thumbResult.skipped) {
          await deleteOriginal(thumbResult.oldFilename);
          totalBefore += thumbResult.before; totalAfter += thumbResult.after;
        }

        processed++;
        const fullMsg  = fullResult && !fullResult.skipped  ? `full ${fmtKB(fullResult.before)}→${fmtKB(fullResult.after)}` : 'full unchanged';
        const thumbMsg = thumbResult && !thumbResult.skipped ? `thumb ${fmtKB(thumbResult.before)}→${fmtKB(thumbResult.after)}` : 'thumb unchanged';
        console.log(`✓ done  ${label}: ${fullMsg}, ${thumbMsg}`);
      } catch (err) {
        failed++;
        console.error(`✗ FAIL  ${label}: ${err.message}`);
      }
    }
  }

  console.log(`\nDone. processed=${processed} skipped=${skipped} failed=${failed}`);
  if (totalBefore > 0) {
    console.log(`Total: ${(totalBefore/1024/1024).toFixed(2)}MB → ${(totalAfter/1024/1024).toFixed(2)}MB (saved ${((totalBefore-totalAfter)/1024/1024).toFixed(2)}MB)`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
