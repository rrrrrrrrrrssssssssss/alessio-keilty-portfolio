const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = __dirname;
const UPLOADS = path.join(BASE, 'uploads');

// ─── Storage mode ─────────────────────────────────────────────────────────────
// BLOB_READ_WRITE_TOKEN is set automatically by Vercel when Blob storage is enabled.
// Without it (local dev), the app uses the local filesystem as before.
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const { put, list, del } = USE_BLOB ? require('@vercel/blob') : {};

// ─── Database ─────────────────────────────────────────────────────────────────
const DB_PATH = path.join(BASE, 'data.json');

// Cache the blob URL within a single serverless invocation to avoid repeated list() calls
let cachedDbUrl = null;

function readLocalDB() {
  if (!fs.existsSync(DB_PATH)) return { projects: [] };
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { projects: [] }; }
}

async function readDB() {
  if (!USE_BLOB) return readLocalDB();
  try {
    // Try the cached URL first
    if (cachedDbUrl) {
      const res = await fetch(cachedDbUrl + '?t=' + Date.now());
      if (res.ok) return await res.json();
      cachedDbUrl = null;
    }
    // Find the blob by prefix
    const { blobs } = await list({ prefix: 'db/data.json' });
    if (blobs.length > 0) {
      cachedDbUrl = blobs[0].url;
      const res = await fetch(cachedDbUrl + '?t=' + Date.now());
      if (res.ok) return await res.json();
    }
    // First deploy: seed blob from the data.json bundled in the repo
    const local = readLocalDB();
    await writeDB(local);
    return local;
  } catch (e) {
    console.error('readDB error:', e);
    return readLocalDB();
  }
}

async function writeDB(data) {
  if (!USE_BLOB) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return;
  }
  const blob = await put('db/data.json', JSON.stringify(data, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json'
  });
  cachedDbUrl = blob.url;
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

// ─── Multer ───────────────────────────────────────────────────────────────────
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.gif'];

const upload = multer({
  storage: USE_BLOB
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: UPLOADS,
        filename: (req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        }
      }),
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase()));
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ─── Static ───────────────────────────────────────────────────────────────────
if (!USE_BLOB) fs.mkdirSync(UPLOADS, { recursive: true });
app.use(express.json());
app.use('/uploads', express.static(UPLOADS));
app.use('/fonts',   express.static(path.join(BASE, 'Font')));
app.use(express.static(path.join(BASE, 'public')));
app.use('/admin',   express.static(path.join(BASE, 'admin')));

// ─── About API ────────────────────────────────────────────────────────────────
app.get('/api/about', async (req, res) => {
  const db = await readDB();
  res.json(db.about || { email: '', instagram: '', bio: '' });
});

app.put('/api/about', async (req, res) => {
  const db = await readDB();
  const { email = '', instagram = '', instagramUrl = '', bio = '' } = req.body;
  db.about = { email, instagram, instagramUrl, bio };
  await writeDB(db);
  res.json(db.about);
});

// ─── Projects API ─────────────────────────────────────────────────────────────
app.get('/api/projects', async (req, res) => {
  const { projects } = await readDB();
  const sorted = [...projects]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(p => ({ ...p, images: [...p.images].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) }));
  res.json(sorted);
});

app.post('/api/projects', async (req, res) => {
  const db = await readDB();
  const { title = '', client = '', year = '', description = '' } = req.body;
  const maxOrder = db.projects.reduce((m, p) => Math.max(m, p.sort_order ?? 0), -1);
  const project = {
    id: maxId(db.projects) + 1,
    title, client, year, description,
    sort_order: maxOrder + 1,
    images: []
  };
  db.projects.push(project);
  await writeDB(db);
  res.json(project);
});

// PUT reorder must come before PUT :id
app.put('/api/projects/reorder', async (req, res) => {
  const db = await readDB();
  const { order } = req.body;
  order.forEach(o => {
    const p = db.projects.find(x => x.id === o.id);
    if (p) p.sort_order = o.sort_order;
  });
  await writeDB(db);
  res.json({ ok: true });
});

app.put('/api/projects/:id', async (req, res) => {
  const db = await readDB();
  const p  = db.projects.find(x => x.id === parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { title, client, year, description, sort_order } = req.body;
  if (title       !== undefined) p.title       = title;
  if (client      !== undefined) p.client      = client;
  if (year        !== undefined) p.year        = year;
  if (description !== undefined) p.description = description;
  if (sort_order  !== undefined) p.sort_order  = sort_order;
  await writeDB(db);
  res.json(p);
});

app.delete('/api/projects/:id', async (req, res) => {
  const db = await readDB();
  const p  = db.projects.find(x => x.id === parseInt(req.params.id));
  if (p) {
    await Promise.all(p.images.map(img => deleteImageFile(img.filename)));
    db.projects = db.projects.filter(x => x.id !== p.id);
    await writeDB(db);
  }
  res.json({ ok: true });
});

// ─── Images API ───────────────────────────────────────────────────────────────
app.post('/api/projects/:id/images', upload.array('images', 200), async (req, res) => {
  const db  = await readDB();
  const pid = parseInt(req.params.id);
  const p   = db.projects.find(x => x.id === pid);
  if (!p) return res.status(404).json({ error: 'Not found' });

  const allImgIds = db.projects.flatMap(x => x.images.map(i => i.id));
  let nextImgId   = (allImgIds.length === 0 ? 0 : Math.max(...allImgIds)) + 1;
  let nextOrder   = p.images.reduce((m, i) => Math.max(m, i.sort_order ?? 0), -1) + 1;

  let inserted;
  if (USE_BLOB) {
    // Upload each file buffer to Vercel Blob; store the returned URL as filename
    inserted = await Promise.all(req.files.map(async (f) => {
      const ext  = path.extname(f.originalname).toLowerCase();
      const name = `images/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const blob = await put(name, f.buffer, {
        access: 'public',
        addRandomSuffix: false,
        contentType: f.mimetype
      });
      return { id: nextImgId++, filename: blob.url, sort_order: nextOrder++ };
    }));
  } else {
    inserted = req.files.map(f => ({
      id: nextImgId++,
      filename: f.filename,
      sort_order: nextOrder++
    }));
  }

  p.images.push(...inserted);
  await writeDB(db);
  res.json(inserted);
});

app.put('/api/images/reorder', async (req, res) => {
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
});

app.delete('/api/images/:id', async (req, res) => {
  const db  = await readDB();
  const id  = parseInt(req.params.id);
  for (const p of db.projects) {
    const img = p.images.find(i => i.id === id);
    if (img) {
      await deleteImageFile(img.filename);
      p.images = p.images.filter(i => i.id !== id);
      break;
    }
  }
  await writeDB(db);
  res.json({ ok: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────
module.exports = app; // exported for Vercel serverless

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Portfolio → http://localhost:${PORT}`);
    console.log(`  Admin    → http://localhost:${PORT}/admin\n`);
  });
}
