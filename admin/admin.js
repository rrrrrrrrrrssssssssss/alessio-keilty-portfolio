/* ─── State ─────────────────────────────────────────────── */
let projects = [];
let activeId = null;
let imageSortable = null;
let aboutData = { email: '', instagram: '', bio: '' };
let selectedProjectIds = new Set();
let selectedImageIds = new Set();
let insertAtIndex = null; // null = append to end; number = insert before that index
let isUploading = false;  // guard against concurrent uploads causing DB races

/* ─── DOM refs ───────────────────────────────────────────── */
const projectList     = document.getElementById('project-list');
const projectBulkBar     = document.getElementById('project-bulk-bar');
const projectBulkCount   = document.getElementById('project-bulk-count');
const projectBulkDelete  = document.getElementById('project-bulk-delete');
const projectBulkCancel  = document.getElementById('project-bulk-cancel');
const imageBulkDelete    = document.getElementById('image-bulk-delete');
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
const publishToggleBtn = document.getElementById('publish-toggle-btn');
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
  const res = await fetch('/api/projects?all=1');
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
    const isDraft = p.published === false;
    const li = document.createElement('li');
    li.className = 'project-item' + (p.id === activeId ? ' active' : '') + (isDraft ? ' is-draft' : '');
    li.dataset.id = p.id;
    li.innerHTML = `
      <input type="checkbox" class="project-item-check" ${selectedProjectIds.has(p.id) ? 'checked' : ''}>
      <span class="project-item-drag" title="Trascina per riordinare">⠿</span>
      <span class="project-item-name">${p.title || p.client || '(senza titolo)'}</span>
      ${isDraft ? '<span class="project-item-badge">Bozza</span>' : ''}
      <span class="project-item-meta">${p.images.length} img</span>
    `;
    const checkbox = li.querySelector('.project-item-check');
    checkbox.addEventListener('click', e => e.stopPropagation());
    checkbox.addEventListener('change', e => {
      if (e.target.checked) selectedProjectIds.add(p.id);
      else selectedProjectIds.delete(p.id);
      updateProjectBulkBar();
    });
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

function updateProjectBulkBar() {
  const n = selectedProjectIds.size;
  projectBulkBar.hidden = n === 0;
  projectBulkCount.textContent = `${n} selezionat${n === 1 ? 'o' : 'i'}`;
}

function selectProject(id) {
  activeId = id;
  const p = projects.find(x => x.id === id);
  if (!p) return;
  selectedImageIds.clear();

  // Update list highlight
  document.querySelectorAll('.project-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.id) === id)
  );

  // Fill form
  formTitle.textContent = p.title || p.client || '(senza titolo)';
  fTitle.value  = p.title  || '';
  fClient.value = p.client || '';
  fYear.value   = p.year   || '';
  fDesc.value   = p.description || '';
  updatePublishButton(p);

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
  formTitle.textContent = updated.title || updated.client || '(senza titolo)';
  renderProjectList();
  flashStatus('Salvato ✓');
}

function updatePublishButton(p) {
  const isDraft = p.published === false;
  publishToggleBtn.textContent = isDraft ? 'Pubblica' : 'Riporta in bozza';
}

async function toggleProjectPublished() {
  const p = projects.find(x => x.id === activeId);
  if (!p) return;
  const published = p.published === false; // currently draft → publish, and vice versa
  const res = await fetch(`/api/projects/${activeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ published })
  });
  const updated = await res.json();
  p.published = updated.published;
  updatePublishButton(p);
  renderProjectList();
  flashStatus(published ? 'Pubblicato ✓' : 'Spostato in bozza ✓');
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
    const wrap = document.createElement('div');
    wrap.className = 'img-card-wrap';
    wrap.dataset.id = img.id;
    const thumb = img.thumbFilename || img.filename;
    const src = thumb.startsWith('http') ? thumb : `/uploads/${thumb}`;
    wrap.innerHTML = `
      <div class="img-card">
        <label class="img-check-wrap">
          <input type="checkbox" class="img-check" ${selectedImageIds.has(img.id) ? 'checked' : ''}>
        </label>
        <img src="${src}" alt="" loading="lazy" decoding="async">
        <span class="img-card-num">${String(i + 1).padStart(2, '0')}</span>
        <button class="img-delete" title="Elimina">×</button>
      </div>
      <div class="img-card-fields">
        <input type="text" class="img-field-year" data-field="year" placeholder="Anno" title="Sovrascrive l'anno del progetto solo per questa immagine">
        <input type="text" class="img-field-desc" data-field="description" placeholder="Descrizione" title="Sovrascrive la descrizione del progetto solo per questa immagine">
      </div>
    `;
    wrap.querySelector('.img-field-year').value = img.year        || '';
    wrap.querySelector('.img-field-desc').value = img.description || '';
    wrap.querySelectorAll('.img-field-year, .img-field-desc').forEach(input => {
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
      input.addEventListener('blur', () => saveImageField(img.id, input.dataset.field, input.value.trim()));
    });

    const checkWrap = wrap.querySelector('.img-check-wrap');
    checkWrap.addEventListener('click', e => e.stopPropagation());
    checkWrap.querySelector('.img-check').addEventListener('change', e => {
      if (e.target.checked) selectedImageIds.add(img.id);
      else selectedImageIds.delete(img.id);
      updateImageBulkBar();
    });
    wrap.querySelector('.img-delete').addEventListener('click', e => {
      e.stopPropagation();
      confirmDelete(
        'Eliminare questa immagine?',
        () => deleteImage(img.id)
      );
    });
    imageGrid.appendChild(wrap);
  });

  updateImageBulkBar();

  // Drag-and-drop reorder
  if (imageSortable) imageSortable.destroy();
  imageSortable = Sortable.create(imageGrid, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    filter: '.img-field-year, .img-field-desc',
    preventOnFilter: false,
    onEnd: async () => {
      const cards = Array.from(imageGrid.querySelectorAll('.img-card-wrap'));
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

/* ─── Drag-to-position helpers ───────────────────────────── */
// Returns the index before which new files should be inserted, based on
// where the cursor is relative to the existing card centers.
function getInsertIndex(e, cards) {
  const x = e.clientX, y = e.clientY;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (y < r.top + r.height / 2 || (y <= r.bottom && x < r.left + r.width / 2)) return i;
  }
  return cards.length;
}

function updateDropPlaceholder(idx) {
  const old = imageGrid.querySelector('.drop-placeholder');
  if (old) old.remove();
  const cards = Array.from(imageGrid.querySelectorAll('.img-card-wrap'));
  const ph = document.createElement('div');
  ph.className = 'drop-placeholder';
  if (idx === 0 || cards.length === 0) {
    imageGrid.prepend(ph);
  } else if (idx >= cards.length) {
    imageGrid.append(ph);
  } else {
    imageGrid.insertBefore(ph, cards[idx]);
  }
}

function clearDropState() {
  insertAtIndex = null;
  const ph = imageGrid.querySelector('.drop-placeholder');
  if (ph) ph.remove();
}

function updateImageBulkBar() {
  const n = selectedImageIds.size;
  imageBulkDelete.hidden = n === 0;
  imageBulkDelete.textContent = n > 0 ? `Elimina selezionate (${n})` : 'Elimina selezionate';
}

// Vercel Serverless Functions reject any request body over 4.5MB, and
// camera originals routinely exceed that on their own. Re-encode oversized
// files down to a small JPEG in the browser before upload so the request
// always stays well under the limit — the server still re-optimizes to
// WebP afterwards, this is purely about getting the upload there reliably.
// imageOrientation:'from-image' bakes the EXIF rotation into the redrawn
// pixels, since canvas-exported JPEGs carry no EXIF for the server to read.
async function resizeForUpload(file) {
  const TARGET_MAX_BYTES = 3 * 1024 * 1024;
  if (file.size <= TARGET_MAX_BYTES) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // browser could not decode it client-side — let the server try as-is
  }

  const MAX_DIM = 2400;
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let blob = null;
  for (const quality of [0.85, 0.7, 0.55]) {
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= TARGET_MAX_BYTES) break;
  }
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

// Two-phase upload:
//   Phase 1 — resize all files client-side + upload to Blob in parallel (fast)
//   Phase 2 — single DB write to register all images at once (no race condition)
// Local state is updated directly from the server response — no full reload —
// so existing image order (from a prior reorder) is always preserved.
async function uploadFiles(files, insertAt = null) {
  if (isUploading || !files.length || !activeId) return;
  isUploading = true;

  const statusCard = document.createElement('div');
  statusCard.className = 'img-card';
  const statusLabel = document.createElement('div');
  statusLabel.className = 'img-uploading';
  statusLabel.textContent = 'Ottimizzazione...';
  statusCard.appendChild(statusLabel);
  imageGrid.appendChild(statusCard);
  dropHint.classList.add('hidden');

  try {
    // Phase 1a: resize all files concurrently (CPU only, no network)
    const resized = await Promise.all(files.map(f => resizeForUpload(f)));

    // Phase 1b: upload all resized files to Blob in parallel
    let done = 0;
    const uploaded = await Promise.all(resized.map(async (file) => {
      const formData = new FormData();
      formData.append('image', file);
      try {
        const res = await fetch('/api/upload-temp', { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`${res.status}`);
        return await res.json(); // { filename, thumbFilename }
      } catch {
        return null;
      } finally {
        statusLabel.textContent = `Caricamento... ${++done}/${files.length}`;
      }
    }));

    // Promise.all preserves array order → uploaded[i] corresponds to files[i]
    const toRegister = uploaded.filter(Boolean);
    const failed = files.length - toRegister.length;

    // Phase 2: single DB write
    let registered = [];
    if (toRegister.length > 0) {
      statusLabel.textContent = 'Salvataggio...';
      try {
        const res = await fetch(`/api/projects/${activeId}/images/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: toRegister, insertAt })
        });
        if (res.ok) registered = await res.json();
      } catch { /* images uploaded to Blob but not in DB — user must retry */ }
    }

    // Update local state directly from register response, without re-fetching from
    // server, so any reorder the user just did is not lost to a stale server read.
    const p = projects.find(x => x.id === activeId);
    if (p && registered.length > 0) {
      if (insertAt !== null) {
        const current = [...p.images];
        const idx = Math.max(0, Math.min(insertAt, current.length));
        current.splice(idx, 0, ...registered);
        p.images = current;
      } else {
        p.images = [...p.images, ...registered];
      }
      renderImages(p.images);
      renderProjectList();
    }

    if (failed) {
      alert(`${failed} immagine${failed === 1 ? '' : 'i'} non caricat${failed === 1 ? 'a' : 'e'} correttamente.`);
    }
  } finally {
    statusCard.remove();
    isUploading = false;
  }
}

async function saveImageField(imgId, field, value) {
  const res = await fetch(`/api/images/${imgId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [field]: value })
  });
  const updated = await res.json();
  const p = projects.find(x => x.id === activeId);
  const img = p && p.images.find(i => i.id === imgId);
  if (img) img[field] = updated[field];
}

async function deleteImage(imgId) {
  await fetch(`/api/images/${imgId}`, { method: 'DELETE' });
  selectedImageIds.delete(imgId);
  const p = projects.find(x => x.id === activeId);
  if (p) {
    p.images = p.images.filter(i => i.id !== imgId);
    renderImages(p.images);
    renderProjectList();
  }
}

async function deleteSelectedImages() {
  const ids = Array.from(selectedImageIds);
  if (!ids.length) return;
  await fetch('/api/images', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
  selectedImageIds.clear();
  const p = projects.find(x => x.id === activeId);
  if (p) {
    p.images = p.images.filter(i => !ids.includes(i.id));
    renderImages(p.images);
    renderProjectList();
  }
}

async function deleteSelectedProjects() {
  const ids = Array.from(selectedProjectIds);
  if (!ids.length) return;
  await fetch('/api/projects', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
  projects = projects.filter(p => !ids.includes(p.id));
  selectedProjectIds.clear();
  if (ids.includes(activeId)) {
    activeId = null;
    editorForm.hidden  = true;
    editorEmpty.hidden = false;
    document.body.classList.remove('mobile-editor');
  }
  updateProjectBulkBar();
  renderProjectList();
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

  // Save — manual button, Enter key, and autosave on blur
  saveBtn.addEventListener('click', saveProject);
  [fTitle, fClient, fYear, fDesc].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') saveProject(); });
    el.addEventListener('blur', () => { if (activeId !== null) saveProject(); });
  });

  // Publish / unpublish
  publishToggleBtn.addEventListener('click', toggleProjectPublished);

  // Delete project
  deleteProjBtn.addEventListener('click', () => {
    confirmDelete(
      `Eliminare il progetto "${fTitle.value || fClient.value || '(senza titolo)'}" e tutte le sue immagini?`,
      async () => {
        await fetch(`/api/projects/${activeId}`, { method: 'DELETE' });
        projects = projects.filter(p => p.id !== activeId);
        selectedProjectIds.delete(activeId);
        activeId = null;
        renderProjectList();
        editorForm.hidden  = true;
        editorEmpty.hidden = false;
        document.body.classList.remove('mobile-editor');
      }
    );
  });

  // Bulk delete: projects
  projectBulkDelete.addEventListener('click', () => {
    const n = selectedProjectIds.size;
    confirmDelete(
      `Eliminare ${n} progett${n === 1 ? 'o' : 'i'} e tutte le loro immagini?`,
      deleteSelectedProjects
    );
  });
  projectBulkCancel.addEventListener('click', () => {
    selectedProjectIds.clear();
    updateProjectBulkBar();
    renderProjectList();
  });

  // Bulk delete: images
  imageBulkDelete.addEventListener('click', () => {
    const n = selectedImageIds.size;
    confirmDelete(
      `Eliminare ${n} immagin${n === 1 ? 'e' : 'i'}?`,
      deleteSelectedImages
    );
  });

  // File input
  fileInput.addEventListener('change', () => {
    uploadFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  // Drag-and-drop files onto drop zone, with position-aware insertion.
  // When dragging over the image grid, a placeholder shows exactly where
  // the files will land; dropping outside the grid appends to the end.
  dropZone.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dropZone.classList.add('drag-over');

    const overGrid = imageGrid === e.target || imageGrid.contains(e.target);
    if (overGrid) {
      const cards = Array.from(imageGrid.querySelectorAll('.img-card-wrap'));
      const newIdx = cards.length === 0 ? 0 : getInsertIndex(e, cards);
      if (newIdx !== insertAtIndex) {
        insertAtIndex = newIdx;
        updateDropPlaceholder(newIdx);
      }
    } else {
      if (insertAtIndex !== null) clearDropState();
    }
  });

  dropZone.addEventListener('dragleave', e => {
    if (dropZone.contains(e.relatedTarget)) return;
    dropZone.classList.remove('drag-over');
    clearDropState();
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    const idx = insertAtIndex;
    clearDropState();
    uploadFiles(files, idx);
  });
}

init();
