require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const sharp   = require('sharp');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = __dirname;
const UPLOADS = path.join(BASE, 'uploads');

// ─── Async error wrapper (Express 4 doesn't catch async errors automatically) ──
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// ─── Storage mode ─────────────────────────────────────────────────────────────
// BLOB_READ_WRITE_TOKEN is set automatically by Vercel when Blob storage is enabled.
// Without it (local dev), the app uses the local filesystem as before.
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const { put, list, del } = USE_BLOB ? require('@vercel/blob') : {};

// ─── Database ─────────────────────────────────────────────────────────────────
const DB_PATH = path.join(BASE, 'data.json');

// In-memory cache: used in local dev (single persistent process) for performance.
// In Vercel serverless, warm instances can serve multiple requests but different
// instances don't share memory — so a write on one instance leaves others stale.
// To avoid serving outdated data after an upload/edit, blob mode always fetches
// fresh from Blob on each request. The blob URL is cached after first discovery
// to skip the list() call on every request.
let dbCache = null;
let blobUrl = null;
let dbCacheWrittenAt = 0; // timestamp of the last writeDB call on this instance

function readLocalDB() {
  if (!fs.existsSync(DB_PATH)) return { projects: [] };
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { projects: [] }; }
}

async function readDB() {
  if (!USE_BLOB) {
    // Local dev: single persistent process — memory is always current
    if (dbCache) return dbCache;
    dbCache = readLocalDB();
    return dbCache;
  }

  // Blob mode: if this instance wrote the DB recently, trust its in-memory cache.
  // This avoids stale CDN reads for sequential operations on the same warm instance
  // (which is the common case for a single admin session). Cross-instance reads
  // still go to Blob once the 30-second window expires.
  if (dbCache && Date.now() - dbCacheWrittenAt < 30000) {
    return dbCache;
  }

  // Cache cold or stale: fetch fresh from Blob with CDN cache bypass headers.
  if (!blobUrl) {
    const { blobs } = await list({ prefix: 'db/data.json' });
    if (blobs.length === 0) {
      // First deploy: seed blob from the data.json bundled in the repo
      const local = readLocalDB();
      await writeDB(local);
      return local;
    }
    blobUrl = blobs[0].url;
  }

  const res = await fetch(blobUrl + '?t=' + Date.now(), {
    headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
  });
  if (!res.ok) throw new Error(`readDB: blob fetch failed (${res.status})`);
  dbCache = await res.json();
  return dbCache;
}

async function writeDB(data) {
  dbCache = data;
  dbCacheWrittenAt = Date.now(); // record when this instance last wrote, for cache trust window

  if (!USE_BLOB) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return;
  }
  const result = await put('db/data.json', JSON.stringify(data, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
  blobUrl = result.url; // keep URL in sync in case it ever changes
}

function maxId(arr) {
  return arr.length === 0 ? 0 : Math.max(...arr.map(x => x.id ?? 0));
}

// ─── Image helpers ─────────────────────────────────────────────────────────────
async function deleteImageFile(filename) {
  if (!filename) return;
  if (USE_BLOB && filename.startsWith('http')) {
    await del(filename).catch(() => {});
  } else {
    const fp = path.join(UPLOADS, filename);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
  }
}

async function deleteImageRecord(img) {
  await Promise.all([deleteImageFile(img.filename), deleteImageFile(img.thumbFilename)]);
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

// ─── Image optimization ────────────────────────────────────────────────────────
// Camera originals are often huge (10-30MB, 6000px+) — way more than any screen
// needs. Resize to a long-edge cap that still looks sharp full-screen on retina
// displays, and re-encode as WebP (~30-40% lighter than JPEG at equivalent
// visual quality). Runs on every upload, regardless of storage backend, so
// both local disk and Vercel Blob get the same lighter file.
const MAX_DIMENSION = 2400;
const WEBP_QUALITY   = 80;

// Thumbnails: used everywhere an image shows up small but many-at-once (the
// gallery index grid, the sidebar filmstrip) — no point shipping a 2400px
// file for a 76px-wide thumbnail. Long edge is generous enough for retina.
const THUMB_DIMENSION = 360;
const THUMB_QUALITY   = 70;

async function optimizeImage(buffer) {
  const image = sharp(buffer, { failOn: 'none' }).rotate(); // auto-orient from EXIF, then strip it
  const meta  = await image.metadata();
  if ((meta.width || 0) > MAX_DIMENSION || (meta.height || 0) > MAX_DIMENSION) {
    image.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
  }
  return image.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer();
}

async function makeThumb(buffer) {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY, effort: 4 })
    .toBuffer();
}

// ─── Multer ───────────────────────────────────────────────────────────────────
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.gif'];

const upload = multer({
  // Always buffer in memory: every upload now passes through sharp before
  // being persisted (to disk or to Blob), regardless of storage backend.
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase()));
  },
  limits: { fileSize: 30 * 1024 * 1024 }
});

// ─── Static ───────────────────────────────────────────────────────────────────
if (!USE_BLOB) fs.mkdirSync(UPLOADS, { recursive: true });
app.use(express.json());
// Prevent browsers and Vercel edge from caching API responses so changes
// made in the admin are always visible immediately on the public site.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/uploads', express.static(UPLOADS));
app.use('/fonts',   express.static(path.join(BASE, 'Font')));
app.use(express.static(path.join(BASE, 'public')));
app.use('/admin',   express.static(path.join(BASE, 'admin')));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, blob: USE_BLOB });
});

// ─── About API ────────────────────────────────────────────────────────────────
app.get('/api/about', wrap(async (req, res) => {
  const db = await readDB();
  res.json(db.about || { email: '', instagram: '', bio: '' });
}));

app.put('/api/about', wrap(async (req, res) => {
  const db = await readDB();
  const { email = '', instagram = '', instagramUrl = '', bio = '' } = req.body;
  db.about = { email, instagram, instagramUrl, bio };
  await writeDB(db);
  res.json(db.about);
}));

// ─── Projects API ─────────────────────────────────────────────────────────────
// Public front-end gets published projects only; admin passes ?all=1 to see drafts too.
// Projects created before the draft feature existed have no `published` field —
// treat that as published, so nothing already live silently disappears.
app.get('/api/projects', wrap(async (req, res) => {
  const { projects } = await readDB();
  const visible = req.query.all ? projects : projects.filter(p => p.published !== false);
  const sorted = [...visible]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(p => ({ ...p, images: [...p.images].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) }));
  res.json(sorted);
}));

app.post('/api/projects', wrap(async (req, res) => {
  const db = await readDB();
  const { title = '', client = '', year = '', description = '' } = req.body;
  const maxOrder = db.projects.reduce((m, p) => Math.max(m, p.sort_order ?? 0), -1);
  const project = {
    id: maxId(db.projects) + 1,
    title, client, year, description,
    published: false, // new projects start as drafts until explicitly published
    sort_order: maxOrder + 1,
    images: []
  };
  db.projects.push(project);
  await writeDB(db);
  res.json(project);
}));

// PUT reorder must come before PUT :id
app.put('/api/projects/reorder', wrap(async (req, res) => {
  const db = await readDB();
  const { order } = req.body;
  order.forEach(o => {
    const p = db.projects.find(x => x.id === o.id);
    if (p) p.sort_order = o.sort_order;
  });
  await writeDB(db);
  res.json({ ok: true });
}));

// Full state save: atomically replaces metadata + images in one write.
// Assigns real IDs to any images with negative (client-temp) IDs.
// Cleans up Blob files for images removed from the list, and for any
// temp blobs the client deleted before saving (passed as filesToDelete).
app.put('/api/projects/:id/state', wrap(async (req, res) => {
  const db  = await readDB();
  const pid = parseInt(req.params.id);
  const p   = db.projects.find(x => x.id === pid);
  if (!p) return res.status(404).json({ error: 'Not found' });

  const { title, client, year, description, published, images, filesToDelete = [] } = req.body;
  if (title       !== undefined) p.title       = title;
  if (client      !== undefined) p.client      = client;
  if (year        !== undefined) p.year        = year;
  if (description !== undefined) p.description = description;
  if (published   !== undefined) p.published   = published;

  if (images !== undefined) {
    const newFilenames = new Set(images.flatMap(img => [img.filename, img.thumbFilename].filter(Boolean)));
    const removedImgs  = p.images.filter(img => !newFilenames.has(img.filename) && !newFilenames.has(img.thumbFilename));

    const allImgIds = db.projects.flatMap(x => x.images.map(i => i.id)).filter(id => id > 0);
    let nextId = (allImgIds.length === 0 ? 0 : Math.max(...allImgIds)) + 1;

    p.images = images.map((img, i) => {
      const id = (img.id && img.id > 0) ? img.id : nextId++;
      const out = { id, filename: img.filename, thumbFilename: img.thumbFilename, sort_order: i };
      if (img.year)        out.year        = img.year;
      if (img.description) out.description = img.description;
      return out;
    });

    const toDelete = [...removedImgs.map(i => i.filename), ...removedImgs.map(i => i.thumbFilename), ...filesToDelete];
    Promise.all(toDelete.filter(Boolean).map(deleteImageFile)).catch(() => {});
  }

  await writeDB(db);
  res.json(p);
}));

app.put('/api/projects/:id', wrap(async (req, res) => {
  const db = await readDB();
  const p  = db.projects.find(x => x.id === parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { title, client, year, description, sort_order, published } = req.body;
  if (title       !== undefined) p.title       = title;
  if (client      !== undefined) p.client      = client;
  if (year        !== undefined) p.year        = year;
  if (description !== undefined) p.description = description;
  if (sort_order  !== undefined) p.sort_order  = sort_order;
  if (published   !== undefined) p.published   = published;
  await writeDB(db);
  res.json(p);
}));

app.delete('/api/projects/:id', wrap(async (req, res) => {
  const db = await readDB();
  const p  = db.projects.find(x => x.id === parseInt(req.params.id));
  if (p) {
    await Promise.all(p.images.map(deleteImageRecord));
    db.projects = db.projects.filter(x => x.id !== p.id);
    await writeDB(db);
  }
  res.json({ ok: true });
}));

// Bulk delete: { ids: [1, 2, 3] }
app.delete('/api/projects', wrap(async (req, res) => {
  const db  = await readDB();
  const ids = (req.body.ids || []).map(Number);
  const toDelete = db.projects.filter(p => ids.includes(p.id));
  await Promise.all(toDelete.flatMap(p => p.images.map(deleteImageRecord)));
  db.projects = db.projects.filter(p => !ids.includes(p.id));
  await writeDB(db);
  res.json({ ok: true });
}));

// ─── Images API ───────────────────────────────────────────────────────────────
// Two-phase upload to allow parallel file transfers with a single atomic DB write:
//   1. POST /api/upload-temp  — upload one image to Blob, return {filename, thumbFilename}
//   2. POST /api/projects/:id/images/register — insert pre-uploaded images into DB in one write
// This avoids the race condition of per-file DB reads/writes and removes the main bottleneck.

app.post('/api/upload-temp', upload.single('image'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const [optimized, thumb] = await Promise.all([
    optimizeImage(req.file.buffer),
    makeThumb(req.file.buffer)
  ]);
  const [filename, thumbFilename] = await Promise.all([
    storeImageBuffer(optimized),
    storeImageBuffer(thumb)
  ]);
  res.json({ filename, thumbFilename });
}));

app.post('/api/projects/:id/images/register', wrap(async (req, res) => {
  const db  = await readDB();
  const pid = parseInt(req.params.id);
  const p   = db.projects.find(x => x.id === pid);
  if (!p) return res.status(404).json({ error: 'Not found' });

  const { images = [], insertAt = null } = req.body;
  if (!images.length) return res.json([]);

  const allImgIds = db.projects.flatMap(x => x.images.map(i => i.id));
  const nextImgId = (allImgIds.length === 0 ? 0 : Math.max(...allImgIds)) + 1;

  const newImages = images.map((img, i) => ({
    id: nextImgId + i,
    filename: img.filename,
    thumbFilename: img.thumbFilename
  }));

  if (insertAt !== null) {
    const sorted = [...p.images].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const idx = Math.max(0, Math.min(insertAt, sorted.length));
    sorted.splice(idx, 0, ...newImages);
    sorted.forEach((img, i) => { img.sort_order = i; });
    p.images = sorted;
  } else {
    const nextOrder = p.images.reduce((m, i) => Math.max(m, i.sort_order ?? 0), -1) + 1;
    newImages.forEach((img, i) => { img.sort_order = nextOrder + i; });
    p.images.push(...newImages);
  }

  await writeDB(db);
  res.json(newImages);
}));

app.post('/api/projects/:id/images', upload.array('images', 200), wrap(async (req, res) => {
  const db  = await readDB();
  const pid = parseInt(req.params.id);
  const p   = db.projects.find(x => x.id === pid);
  if (!p) return res.status(404).json({ error: 'Not found' });

  const allImgIds = db.projects.flatMap(x => x.images.map(i => i.id));
  const nextImgId = (allImgIds.length === 0 ? 0 : Math.max(...allImgIds)) + 1;

  const newImages = await Promise.all(req.files.map(async (f, i) => {
    const [optimized, thumb] = await Promise.all([
      optimizeImage(f.buffer),
      makeThumb(f.buffer)
    ]);
    const [filename, thumbFilename] = await Promise.all([
      storeImageBuffer(optimized),
      storeImageBuffer(thumb)
    ]);
    return { id: nextImgId + i, filename, thumbFilename };
  }));

  // insertAt: insert before index N in sorted order, then re-number all sort_orders.
  // Without insertAt, append to end (legacy behaviour).
  const insertAt = req.query.insertAt !== undefined ? parseInt(req.query.insertAt) : null;
  if (insertAt !== null) {
    const sorted = [...p.images].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const idx = Math.max(0, Math.min(insertAt, sorted.length));
    sorted.splice(idx, 0, ...newImages);
    sorted.forEach((img, i) => { img.sort_order = i; });
    p.images = sorted;
  } else {
    const nextOrder = p.images.reduce((m, i) => Math.max(m, i.sort_order ?? 0), -1) + 1;
    newImages.forEach((img, i) => { img.sort_order = nextOrder + i; });
    p.images.push(...newImages);
  }

  await writeDB(db);
  res.json(newImages);
}));

app.put('/api/images/reorder', wrap(async (req, res) => {
  const db = await readDB();
  const { order } = req.body;
  db.projects.forEach(p =>
    p.images.forEach(img => {
      const entry = order.find(o => o.id === img.id);
      if (entry) img.sort_order = entry.sort_order;
    })
  );
  await writeDB(db);
  res.json({ ok: true });
}));

app.put('/api/images/:id', wrap(async (req, res) => {
  const db  = await readDB();
  const id  = parseInt(req.params.id);
  let img = null;
  for (const p of db.projects) {
    img = p.images.find(i => i.id === id);
    if (img) break;
  }
  if (!img) return res.status(404).json({ error: 'Not found' });
  const { description, year } = req.body;
  if (description !== undefined) img.description = description;
  if (year        !== undefined) img.year        = year;
  await writeDB(db);
  res.json(img);
}));

app.delete('/api/images/:id', wrap(async (req, res) => {
  const db  = await readDB();
  const id  = parseInt(req.params.id);
  for (const p of db.projects) {
    const img = p.images.find(i => i.id === id);
    if (img) {
      await deleteImageRecord(img);
      p.images = p.images.filter(i => i.id !== id);
      break;
    }
  }
  await writeDB(db);
  res.json({ ok: true });
}));

// Bulk delete: { ids: [1, 2, 3] }
app.delete('/api/images', wrap(async (req, res) => {
  const db  = await readDB();
  const ids = (req.body.ids || []).map(Number);
  const toDelete = [];
  db.projects.forEach(p => {
    const keep = [];
    p.images.forEach(img => {
      if (ids.includes(img.id)) toDelete.push(img);
      else keep.push(img);
    });
    p.images = keep;
  });
  await Promise.all(toDelete.map(deleteImageRecord));
  await writeDB(db);
  res.json({ ok: true });
}));

// ─── Error handler ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
module.exports = app; // exported for Vercel serverless

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Portfolio → http://localhost:${PORT}`);
    console.log(`  Admin    → http://localhost:${PORT}/admin\n`);
  });
}
