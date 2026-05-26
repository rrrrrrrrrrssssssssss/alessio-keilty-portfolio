const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = __dirname;
const UPLOADS = path.join(BASE, 'uploads');

fs.mkdirSync(UPLOADS, { recursive: true });

// ─── JSON database ────────────────────────────────────────────────────────────
// Stores everything in data.json: { projects: [{id, title, client, year,
//   description, sort_order, images: [{id, filename, sort_order}]}] }

const DB_PATH = path.join(BASE, 'data.json');

function readDB() {
  if (!fs.existsSync(DB_PATH)) return { projects: [] };
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { projects: [] }; }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function maxId(arr) {
  return arr.length === 0 ? 0 : Math.max(...arr.map(x => x.id ?? 0));
}

// ─── Multer ───────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.gif'];
    cb(null, ok.includes(path.extname(file.originalname).toLowerCase()));
  },
  limits: { fileSize: 100 * 1024 * 1024 }
});

// ─── Static ───────────────────────────────────────────────────────────────────
app.use(express.json());
app.use('/uploads', express.static(UPLOADS));
app.use('/fonts',   express.static(path.join(BASE, 'Font')));
app.use(express.static(path.join(BASE, 'public')));
app.use('/admin',   express.static(path.join(BASE, 'admin')));

// ─── About API ────────────────────────────────────────────────────────────────

app.get('/api/about', (req, res) => {
  const db = readDB();
  res.json(db.about || { email: '', instagram: '', bio: '' });
});

app.put('/api/about', (req, res) => {
  const db = readDB();
  const { email = '', instagram = '', instagramUrl = '', bio = '' } = req.body;
  db.about = { email, instagram, instagramUrl, bio };
  writeDB(db);
  res.json(db.about);
});

// ─── Projects API ─────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  const { projects } = readDB();
  const sorted = [...projects]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(p => ({ ...p, images: [...p.images].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) }));
  res.json(sorted);
});

app.post('/api/projects', (req, res) => {
  const db = readDB();
  const { title = '', client = '', year = '', description = '' } = req.body;
  const maxOrder = db.projects.reduce((m, p) => Math.max(m, p.sort_order ?? 0), -1);
  const project = {
    id: maxId(db.projects) + 1,
    title, client, year, description,
    sort_order: maxOrder + 1,
    images: []
  };
  db.projects.push(project);
  writeDB(db);
  res.json(project);
});

// PUT reorder must come before PUT :id so Express matches correctly
app.put('/api/projects/reorder', (req, res) => {
  const db = readDB();
  const { order } = req.body;
  order.forEach(o => {
    const p = db.projects.find(x => x.id === o.id);
    if (p) p.sort_order = o.sort_order;
  });
  writeDB(db);
  res.json({ ok: true });
});

app.put('/api/projects/:id', (req, res) => {
  const db = readDB();
  const p  = db.projects.find(x => x.id === parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { title, client, year, description, sort_order } = req.body;
  if (title       !== undefined) p.title       = title;
  if (client      !== undefined) p.client      = client;
  if (year        !== undefined) p.year        = year;
  if (description !== undefined) p.description = description;
  if (sort_order  !== undefined) p.sort_order  = sort_order;
  writeDB(db);
  res.json(p);
});

app.delete('/api/projects/:id', (req, res) => {
  const db = readDB();
  const p  = db.projects.find(x => x.id === parseInt(req.params.id));
  if (p) {
    p.images.forEach(img => {
      const fp = path.join(UPLOADS, img.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    db.projects = db.projects.filter(x => x.id !== p.id);
    writeDB(db);
  }
  res.json({ ok: true });
});

// ─── Images API ───────────────────────────────────────────────────────────────

app.post('/api/projects/:id/images', upload.array('images', 200), (req, res) => {
  const db  = readDB();
  const pid = parseInt(req.params.id);
  const p   = db.projects.find(x => x.id === pid);
  if (!p) return res.status(404).json({ error: 'Not found' });

  // Global max image id across all projects
  const allImgIds = db.projects.flatMap(x => x.images.map(i => i.id));
  let nextImgId   = (allImgIds.length === 0 ? 0 : Math.max(...allImgIds)) + 1;
  let nextOrder   = p.images.reduce((m, i) => Math.max(m, i.sort_order ?? 0), -1) + 1;

  const inserted = req.files.map(f => ({
    id: nextImgId++,
    filename: f.filename,
    sort_order: nextOrder++
  }));
  p.images.push(...inserted);
  writeDB(db);
  res.json(inserted);
});

app.put('/api/images/reorder', (req, res) => {
  const db = readDB();
  const { order } = req.body;
  db.projects.forEach(p =>
    p.images.forEach(img => {
      const entry = order.find(o => o.id === img.id);
      if (entry) img.sort_order = entry.sort_order;
    })
  );
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/images/:id', (req, res) => {
  const db  = readDB();
  const id  = parseInt(req.params.id);
  for (const p of db.projects) {
    const img = p.images.find(i => i.id === id);
    if (img) {
      const fp = path.join(UPLOADS, img.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      p.images = p.images.filter(i => i.id !== id);
      break;
    }
  }
  writeDB(db);
  res.json({ ok: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Portfolio → http://localhost:${PORT}`);
  console.log(`  Admin    → http://localhost:${PORT}/admin\n`);
});
