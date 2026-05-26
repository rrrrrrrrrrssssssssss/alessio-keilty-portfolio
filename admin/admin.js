/* ─── State ─────────────────────────────────────────────── */
let projects = [];
let activeId = null;
let imageSortable = null;
let aboutData = { email: '', instagram: '', bio: '' };

/* ─── DOM refs ───────────────────────────────────────────── */
const projectList     = document.getElementById('project-list');
const editorEmpty     = document.getElementById('editor-empty');
const editorForm      = document.getElementById('editor-form');
const formTitle       = document.getElementById('form-title');
const fTitle          = document.getElementById('f-title');
const fClient         = document.getElementById('f-client');
const fYear           = document.getElementById('f-year');
const fDesc           = document.getElementById('f-desc');
const saveBtn         = document.getElementById('save-btn');
const saveStatus      = document.getElementById('save-status');
const deleteProjBtn   = document.getElementById('delete-project-btn');
const imageGrid       = document.getElementById('image-grid');
const dropZone        = document.getElementById('drop-zone');
const dropHint        = document.getElementById('drop-hint');
const imagesCount     = document.getElementById('images-count');
const fileInput       = document.getElementById('file-input');
const confirmOverlay  = document.getElementById('confirm-overlay');
const confirmMsg      = document.getElementById('confirm-msg');
const confirmYes      = document.getElementById('confirm-yes');
const confirmNo       = document.getElementById('confirm-no');
const aboutEditor     = document.getElementById('about-editor');
const fAboutEmail     = document.getElementById('f-about-email');
const fAboutIg        = document.getElementById('f-about-ig');
const fAboutIgUrl     = document.getElementById('f-about-ig-url');
const fAboutBio       = document.getElementById('f-about-bio');
const aboutSaveStatus = document.getElementById('about-save-status');

/* ─── Init ───────────────────────────────────────────────── */
async function init() {
  await Promise.all([loadProjects(), loadAbout()]);
  bindEvents();
}

async function loadProjects() {
  const res = await fetch('/api/projects');
  projects = await res.json();
  renderProjectList();
}

async function loadAbout() {
  aboutData = await fetch('/api/about').then(r => r.json());
}

/* ─── Project list ───────────────────────────────────────── */
function renderProjectList() {
  projectList.innerHTML = '';
  projects.forEach(p => {
    const li = document.createElement('li');
    li.className = 'project-item' + (p.id === activeId ? ' active' : '');
    li.dataset.id = p.id;
    li.innerHTML = `
      <span class="project-item-drag" title="Trascina per riordinare">⠿</span>
      <span class="project-item-name">${p.title || '(senza titolo)'}</span>
      <span class="project-item-meta">${p.images.length} img</span>
    `;
    li.addEventListener('click', () => selectProject(p.id));
    projectList.appendChild(li);
  });

  // Drag-and-drop reorder of projects
  if (window._projectSortable) window._projectSortable.destroy();
  window._projectSortable = Sortable.create(projectList, {
    handle: '.project-item-drag',
    animation: 150,
    onEnd: async () => {
      const items = Array.from(projectList.querySelectorAll('.project-item'));
      const order = items.map((el, i) => ({ id: parseInt(el.dataset.id), sort_order: i }));
      await fetch('/api/projects/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      });
      await loadProjects();
    }
  });
}

function selectProject(id) {
  activeId = id;
  const p = projects.find(x => x.id === id);
  if (!p) return;

  // Update list highlight
  document.querySelectorAll('.project-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.id) === id)
  );

  // Fill form
  formTitle.textContent = p.title || '(senza titolo)';
  fTitle.value  = p.title  || '';
  fClient.value = p.client || '';
  fYear.value   = p.year   || '';
  fDesc.value   = p.description || '';

  aboutEditor.hidden = true;
  editorEmpty.hidden = true;
  editorForm.hidden  = false;
  document.body.classList.add('mobile-editor');

  renderImages(p.images);
}

/* ─── About editor ───────────────────────────────────────── */
function openAboutEditor() {
  activeId = null;
  document.querySelectorAll('.project-item').forEach(el => el.classList.remove('active'));
  editorForm.hidden  = true;
  editorEmpty.hidden = true;
  fAboutEmail.value  = aboutData.email        || '';
  fAboutIg.value     = aboutData.instagram   || '';
  fAboutIgUrl.value  = aboutData.instagramUrl || '';
  fAboutBio.value    = aboutData.bio          || '';
  aboutEditor.hidden = false;
  document.body.classList.add('mobile-editor');
}

async function saveAbout() {
  const body = {
    email:        fAboutEmail.value.trim(),
    instagram:    fAboutIg.value.trim(),
    instagramUrl: fAboutIgUrl.value.trim(),
    bio:          fAboutBio.value.trim()
  };
  const res = await fetch('/api/about', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  aboutData = await res.json();
  aboutSaveStatus.textContent = 'Salvato ✓';
  setTimeout(() => { aboutSaveStatus.textContent = ''; }, 2000);
}

/* ─── Save project ───────────────────────────────────────── */
async function saveProject() {
  const body = {
    title:       fTitle.value.trim(),
    client:      fClient.value.trim(),
    year:        fYear.value.trim(),
    description: fDesc.value.trim()
  };
  const res = await fetch(`/api/projects/${activeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const updated = await res.json();
  projects = projects.map(p => p.id === activeId ? { ...updated, images: p.images } : p);
  formTitle.textContent = updated.title || '(senza titolo)';
  renderProjectList();
  flashStatus('Salvato ✓');
}

function flashStatus(msg) {
  saveStatus.textContent = msg;
  setTimeout(() => { saveStatus.textContent = ''; }, 2000);
}

/* ─── Images ─────────────────────────────────────────────── */
function renderImages(images) {
  imageGrid.innerHTML = '';
  dropHint.classList.toggle('hidden', images.length > 0);
  imagesCount.textContent = `${images.length} immagin${images.length === 1 ? 'e' : 'i'}`;

  images.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'img-card';
    card.dataset.id = img.id;
    const src = img.filename.startsWith('http') ? img.filename : `/uploads/${img.filename}`;
    card.innerHTML = `
      <img src="${src}" alt="">
      <span class="img-card-num">${String(i + 1).padStart(2, '0')}</span>
      <button class="img-delete" title="Elimina">×</button>
    `;
    card.querySelector('.img-delete').addEventListener('click', e => {
      e.stopPropagation();
      confirmDelete(
        'Eliminare questa immagine?',
        () => deleteImage(img.id)
      );
    });
    imageGrid.appendChild(card);
  });

  // Drag-and-drop reorder
  if (imageSortable) imageSortable.destroy();
  imageSortable = Sortable.create(imageGrid, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: async () => {
      const cards = Array.from(imageGrid.querySelectorAll('.img-card'));
      const order = cards.map((el, i) => ({ id: parseInt(el.dataset.id), sort_order: i }));
      // Update numbers visually
      cards.forEach((card, i) => {
        card.querySelector('.img-card-num').textContent = String(i + 1).padStart(2, '0');
      });
      await fetch('/api/images/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      });
      // Sync local state
      const p = projects.find(x => x.id === activeId);
      if (p) {
        p.images = order.map(o => p.images.find(img => img.id === o.id)).filter(Boolean);
      }
    }
  });
}

async function uploadFiles(files) {
  if (!files.length || !activeId) return;

  const formData = new FormData();
  for (const f of files) formData.append('images', f);

  // Show uploading placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'img-card';
  placeholder.innerHTML = `<div class="img-uploading">Caricamento...</div>`;
  imageGrid.appendChild(placeholder);
  dropHint.classList.add('hidden');

  try {
    const res = await fetch(`/api/projects/${activeId}/images`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Errore server ${res.status}`);
    }
    const newImgs = await res.json();
    placeholder.remove();

    // Sync local project images
    const p = projects.find(x => x.id === activeId);
    if (p) {
      p.images = [...p.images, ...newImgs];
      renderImages(p.images);
      renderProjectList();
    }
  } catch (err) {
    placeholder.remove();
    alert('Errore durante il caricamento.');
  }
}

async function deleteImage(imgId) {
  await fetch(`/api/images/${imgId}`, { method: 'DELETE' });
  const p = projects.find(x => x.id === activeId);
  if (p) {
    p.images = p.images.filter(i => i.id !== imgId);
    renderImages(p.images);
    renderProjectList();
  }
}

/* ─── Confirm dialog ─────────────────────────────────────── */
let confirmCallback = null;

function confirmDelete(msg, callback) {
  confirmMsg.textContent = msg;
  confirmCallback = callback;
  confirmOverlay.hidden = false;
}

confirmYes.addEventListener('click', () => {
  confirmOverlay.hidden = true;
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
});

confirmNo.addEventListener('click', () => {
  confirmOverlay.hidden = true;
  confirmCallback = null;
});

/* ─── Events ─────────────────────────────────────────────── */
function bindEvents() {
  // Mobile back button
  document.getElementById('mobile-back-btn').addEventListener('click', () => {
    document.body.classList.remove('mobile-editor');
  });

  // About editor
  document.getElementById('about-btn').addEventListener('click', openAboutEditor);
  document.getElementById('about-save-btn').addEventListener('click', saveAbout);
  [fAboutEmail, fAboutIg].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') saveAbout(); });
  });

  // New project
  document.getElementById('new-project-btn').addEventListener('click', async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nuovo progetto' })
    });
    const p = await res.json();
    projects.push(p);
    renderProjectList();
    selectProject(p.id);
    fTitle.focus();
    fTitle.select();
  });

  // Save
  saveBtn.addEventListener('click', saveProject);
  [fTitle, fClient, fYear, fDesc].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') saveProject(); });
  });

  // Delete project
  deleteProjBtn.addEventListener('click', () => {
    confirmDelete(
      `Eliminare il progetto "${fTitle.value || '(senza titolo)'}" e tutte le sue immagini?`,
      async () => {
        await fetch(`/api/projects/${activeId}`, { method: 'DELETE' });
        projects = projects.filter(p => p.id !== activeId);
        activeId = null;
        renderProjectList();
        editorForm.hidden  = true;
        editorEmpty.hidden = false;
        document.body.classList.remove('mobile-editor');
      }
    );
  });

  // File input
  fileInput.addEventListener('change', () => {
    uploadFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  // Drag-and-drop files onto drop zone
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    uploadFiles(files);
  });
}

init();
