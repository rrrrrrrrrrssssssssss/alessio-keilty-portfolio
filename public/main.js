/* ─── State ──────────────────────────────────────────────────────── */
let items = [];   // [{ image, project, projectImages }]
let N = 0;
let cur = 0;
let closeAboutTimers = [];

/* ─── DOM refs ───────────────────────────────────────────────────── */
const track       = document.getElementById('track');
const viewport    = document.getElementById('viewport');
const sidebarEl   = document.getElementById('sidebar');
const sidebarInner= document.getElementById('sidebar-inner');
const curEl       = document.getElementById('cur');
const totEl       = document.getElementById('tot');
const metaClient  = document.getElementById('meta-client');
const metaTitle   = document.getElementById('meta-title');
const metaDesc    = document.getElementById('meta-desc');
const gridOverlay = document.getElementById('grid-overlay');
const indexCols   = document.getElementById('index-cols');
const aboutLink    = document.getElementById('about-link');
const metaBack     = document.getElementById('meta-back');
const aboutContent = document.getElementById('about-content');

/* ─── Image URL helper ───────────────────────────────────────────── */
// Vercel Blob images are stored as full URLs; legacy images use /uploads/.
function imgSrc(filename) {
  return filename.startsWith('http') ? filename : `/uploads/${filename}`;
}

/* ─── Init ───────────────────────────────────────────────────────── */
async function init() {
  const [projects, about] = await Promise.all([
    fetch('/api/projects').then(r => r.json()),
    fetch('/api/about').then(r => r.json()).catch(() => ({ email: '', instagram: '', bio: '' }))
  ]);

  const aboutEmailEl = document.getElementById('about-email');
  aboutEmailEl.textContent = about.email || '';
  if (about.email) aboutEmailEl.href = `mailto:${about.email}`;

  const aboutIgEl = document.getElementById('about-instagram');
  aboutIgEl.textContent = about.instagram || '';
  if (about.instagramUrl) aboutIgEl.href = about.instagramUrl;

  document.getElementById('about-bio').textContent = about.bio || '';

  for (const project of projects) {
    for (const image of project.images) {
      items.push({ image, project, projectImages: project.images });
    }
  }

  N = items.length;

  if (N === 0) {
    document.getElementById('empty-state').hidden = false;
    return;
  }

  buildTrack();
  buildSidebar();
  buildIndex();
  goTo(0);
  bindEvents();
}

/* ─── Carousel ───────────────────────────────────────────────────── */
function buildTrack() {
  track.innerHTML = '';

  function makeSlide(item) {
    const div = document.createElement('div');
    div.className = 'slide';
    const img = document.createElement('img');
    img.src = imgSrc(item.image.filename);
    img.alt = item.project.title;
    img.draggable = false;
    div.appendChild(img);
    return div;
  }

  track.appendChild(makeSlide(items[N - 1])); // leading clone of last slide
  items.forEach(item => track.appendChild(makeSlide(item)));
  track.appendChild(makeSlide(items[0]));      // trailing clone of first slide
}

function goTo(index) {
  cur = ((index % N) + N) % N;
  track.style.transition = 'none';
  track.style.transform = `translateX(${-(cur + 1) * viewport.clientWidth}px)`;
  updateUI();
}

function next() { goTo(cur + 1); }
function prev() { goTo(cur - 1); }

/* ─── Sidebar ────────────────────────────────────────────────────── */
function buildSidebar() {
  sidebarInner.innerHTML = '';
  items.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    const img = document.createElement('img');
    img.src = imgSrc(item.image.filename);
    img.alt = '';
    img.draggable = false;
    div.appendChild(img);
    div.addEventListener('click', () => { closeAbout(); goTo(i); });
    sidebarInner.appendChild(div);
  });
}

/* ─── Index overlay ──────────────────────────────────────────────── */
function buildIndex() {
  const seen = new Set();
  const projects = [];
  items.forEach(({ project }) => {
    if (!seen.has(project)) { seen.add(project); projects.push(project); }
  });

  indexCols.innerHTML = '';
  projects.forEach(project => {
    const unit = document.createElement('div');
    unit.className = 'col-unit';

    const col = document.createElement('div');
    col.className = 'project-col';

    const colImages = document.createElement('div');
    colImages.className = 'col-images';

    project.images.forEach((image, idx) => {
      const globalIdx = items.findIndex(it => it.image === image);
      const thumb = document.createElement('div');
      thumb.className = 'col-thumb';

      const img = document.createElement('img');
      img.src = imgSrc(image.filename);
      img.alt = '';
      img.draggable = false;

      const num = document.createElement('span');
      num.className = 'col-num';
      num.textContent = String(idx + 1).padStart(2, '0');

      thumb.appendChild(img);
      thumb.appendChild(num);
      thumb.addEventListener('click', () => { closeGrid(); goTo(globalIdx); });
      colImages.appendChild(thumb);
    });

    const colMeta = document.createElement('div');
    colMeta.className = 'col-meta';

    const titleYear = [project.title, project.year].filter(Boolean).join(', ');
    if (titleYear)           { const el = document.createElement('div'); el.textContent = titleYear;           colMeta.appendChild(el); }
    if (project.client)      { const el = document.createElement('div'); el.textContent = project.client;      colMeta.appendChild(el); }
    if (project.description) { const el = document.createElement('div'); el.textContent = project.description; colMeta.appendChild(el); }

    col.appendChild(colImages);
    col.appendChild(colMeta);

    const colGap = document.createElement('div');
    colGap.className = 'col-gap';
    const colTotal = document.createElement('div');
    colTotal.className = 'col-total';
    colTotal.textContent = '/' + String(project.images.length).padStart(2, '0');
    colGap.appendChild(colTotal);

    unit.appendChild(col);
    unit.appendChild(colGap);
    indexCols.appendChild(unit);
  });
}

/* ─── Update UI ──────────────────────────────────────────────────── */
function updateUI() {
  const item = items[cur];
  if (!item) return;

  // Contatore relativo al progetto corrente
  const posInProject = item.projectImages.indexOf(item.image) + 1;
  const total = item.projectImages.length;
  curEl.textContent = String(posInProject).padStart(2, '0');
  totEl.textContent = '/' + String(total).padStart(2, '0');

  // Anno dopo il titolo, separato da virgola
  const titleYear = [item.project.title, item.project.year].filter(Boolean).join(', ');
  metaClient.textContent = item.project.client  || '';
  metaClient.hidden      = !item.project.client;
  metaTitle.textContent  = titleYear;
  metaDesc.textContent   = item.project.description || '';

  // Sidebar: porta la miniatura attiva in vista
  const thumbs = sidebarInner.querySelectorAll('.thumb');
  if (thumbs[cur]) {
    const thumbRect   = thumbs[cur].getBoundingClientRect();
    const sidebarRect = sidebarEl.getBoundingClientRect();
    if (window.innerWidth <= 768) {
      sidebarEl.scrollTo({ left: sidebarEl.scrollLeft + (thumbRect.left - sidebarRect.left), behavior: 'smooth' });
    } else {
      sidebarEl.scrollTo({ top: sidebarEl.scrollTop + (thumbRect.top - sidebarRect.top), behavior: 'smooth' });
    }
  }
}

/* ─── Events ─────────────────────────────────────────────────────── */
function bindEvents() {
  // Enable :active pseudo-class on iOS Safari
  document.addEventListener('touchstart', function(){}, { passive: true });

  // Touch swipe for mobile carousel
  let touchStartX = 0;
  let didSwipe = false;

  viewport.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    didSwipe = false;
    track.style.transition = 'none';
  }, { passive: true });

  viewport.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - touchStartX;
    track.style.transform = `translateX(${-(cur + 1) * viewport.clientWidth + dx}px)`;
  }, { passive: true });

  viewport.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) {
      didSwipe = true;
      const isNext = dx < 0;
      const targetCur = isNext ? (cur + 1) % N : (cur - 1 + N) % N;
      const targetPos = (cur + 1) + (isNext ? 1 : -1);
      track.style.transition = 'transform 0.3s ease';
      track.style.transform = `translateX(${-targetPos * viewport.clientWidth}px)`;
      track.addEventListener('transitionend', () => {
        track.style.transition = 'none';
        cur = targetCur;
        track.style.transform = `translateX(${-(cur + 1) * viewport.clientWidth}px)`;
      }, { once: true });
      cur = targetCur;
      updateUI();
    } else {
      track.style.transition = 'transform 0.2s ease';
      track.style.transform = `translateX(${-(cur + 1) * viewport.clientWidth}px)`;
      track.addEventListener('transitionend', () => { track.style.transition = 'none'; }, { once: true });
    }
  });

  // Custom arrow cursor on desktop: left half = ←, right half = →
  viewport.addEventListener('mousemove', e => {
    const isNext = e.clientX > viewport.clientWidth / 2;
    viewport.classList.toggle('cursor-next', isNext);
    viewport.classList.toggle('cursor-prev', !isNext);
  });
  viewport.addEventListener('mouseleave', () => {
    viewport.classList.remove('cursor-prev', 'cursor-next');
  });

  // Click viewport: metà sinistra = prev, metà destra = next (desktop only)
  viewport.addEventListener('click', e => {
    if (window.innerWidth <= 768) return;
    if (didSwipe) { didSwipe = false; return; }
    if (e.clientX > viewport.clientWidth / 2) next();
    else prev();
  });

  // Tastiera
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next();
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prev();
    if (e.key === 'Escape') { closeGrid(); closeAbout(); }
  });

  // Entrambi i bottoni aprono la griglia
  document.getElementById('expand-btn').addEventListener('click', e => {
    e.stopPropagation();
    openGrid();
  });
  document.getElementById('gallery-index-btn').addEventListener('click', e => {
    e.stopPropagation();
    openGrid();
  });
  aboutLink.addEventListener('click', e => {
    e.stopPropagation();
    document.body.classList.contains('about-open') ? closeAbout() : openAbout();
  });
  metaClient.addEventListener('click', closeAbout);
  metaTitle.addEventListener('click', closeAbout);
  metaDesc.addEventListener('click', closeAbout);
  document.getElementById('index-title-btn').addEventListener('click', () => closeGrid(true));
  document.getElementById('grid-close').addEventListener('click', () => closeGrid(true));
  document.getElementById('author-name').addEventListener('click', () => {
    if (document.body.classList.contains('about-open')) {
      closeAbout();
    } else {
      if (gridOverlay.classList.contains('open')) closeGrid();
      openAbout();
    }
  });
  document.getElementById('meta-back').addEventListener('click', closeAbout);
  document.getElementById('about-bio').addEventListener('click', closeAbout);

  // Unified touch tracking shared by all swipe gesture handlers below
  let swipeStartX = 0, swipeStartY = 0, swipeTarget = null;
  document.addEventListener('touchstart', e => {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeTarget = e.target;
  }, { passive: true });

  // Bottom area (below carousel, y > innerHeight - 185): swipe right → About, swipe left → Index
  document.addEventListener('touchend', e => {
    if (window.innerWidth > 768) return;
    if (document.body.classList.contains('about-open')) return;
    if (document.body.classList.contains('index-open')) return;
    if (swipeTarget && swipeTarget.closest('#grid-overlay')) return;
    if (swipeStartY < window.innerHeight - 185) return;
    if (swipeTarget && swipeTarget.closest('#sidebar')) return;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    if (dx > 50) openAbout();
    else if (dx < -50) openGrid();
  }, { passive: true });

  // About open: swipe left → close
  document.addEventListener('touchend', e => {
    if (!document.body.classList.contains('about-open')) return;
    if (window.innerWidth > 768) return;
    if (swipeTarget && swipeTarget.closest('#sidebar')) return;
    if ((e.changedTouches[0].clientX - swipeStartX) < -50) closeAbout();
  }, { passive: true });

  // Index open: swipe right → close (not from horizontal filmstrips)
  gridOverlay.addEventListener('touchend', e => {
    if (window.innerWidth > 768) return;
    if (swipeTarget && swipeTarget.closest('.col-images')) return;
    if ((e.changedTouches[0].clientX - swipeStartX) > 50) closeGrid();
  }, { passive: true });

  // Resize
  window.addEventListener('resize', () => {
    track.style.transition = 'none';
    track.style.transform = `translateX(${-(cur + 1) * viewport.clientWidth}px)`;
  });
}

function openGrid() {
  indexCols.scrollLeft = 0;
  indexCols.scrollTop = 0;
  gridOverlay.removeAttribute('hidden');
  gridOverlay.offsetHeight; // force reflow so transition fires from translateX(100%)
  gridOverlay.classList.add('open');
  document.body.classList.add('index-open');
}

function closeGrid(keepAbout = false) {
  if (!keepAbout && document.body.classList.contains('about-open')) {
    // Grid (z-index 50) covers everything — reset About state silently with no animations.
    // Calling closeAbout() here would trigger its viewport transitions and fight the grid slide-out.
    closeAboutTimers.forEach(clearTimeout);
    closeAboutTimers = [];
    document.body.classList.remove('about-open', 'about-closing');
    aboutLink.textContent = 'About';
    aboutLink.style.transition = '';
    aboutLink.style.opacity = '';
    metaBack.style.cssText = '';
  }
  gridOverlay.classList.remove('open');
  document.body.classList.remove('index-open');
  gridOverlay.addEventListener('transitionend', () => {
    gridOverlay.setAttribute('hidden', '');
  }, { once: true });
}

function crossFadeLabel(newText) {
  if (aboutLink.textContent === newText) return;
  // Kill any in-progress transition (avoids iOS race with :active release)
  aboutLink.style.transition = 'none';
  aboutLink.getBoundingClientRect();
  aboutLink.style.transition = 'opacity 0.12s ease';
  aboutLink.getBoundingClientRect();
  aboutLink.style.opacity = '0';
  setTimeout(() => {
    aboutLink.textContent = newText;
    aboutLink.style.transition = 'opacity 0.2s ease';
    aboutLink.style.opacity = '1';
    setTimeout(() => {
      aboutLink.style.transition = '';
      aboutLink.style.opacity = '';
    }, 250);
  }, 150);
}

function showMetaBack() {
  if (window.innerWidth > 768) return;
  // Measure natural height invisibly (no layout impact)
  metaBack.style.display = 'block';
  metaBack.style.visibility = 'hidden';
  metaBack.style.height = 'auto';
  const h = metaBack.offsetHeight;
  // Reset to collapsed starting state
  metaBack.style.visibility = '';
  metaBack.style.height = '0';
  metaBack.style.overflow = 'hidden';
  metaBack.style.opacity = '0';
  metaBack.style.transition = 'none';
  metaBack.style.pointerEvents = 'none';
  metaBack.getBoundingClientRect();
  // Double rAF ensures iOS registers the initial state before animating
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Height slides first, then opacity appears after siblings have settled
      metaBack.style.transition = 'height 0.35s ease, opacity 0.3s ease 0.35s';
      metaBack.style.height = h + 'px';
      metaBack.style.opacity = '1';
      metaBack.style.pointerEvents = 'auto';
    });
  });
}

function hideMetaBack() {
  if (window.innerWidth > 768) return;
  if (metaBack.style.display !== 'block') return;
  const h = metaBack.offsetHeight;
  metaBack.style.height = h + 'px';
  metaBack.style.overflow = 'hidden';
  metaBack.style.pointerEvents = 'none';
  metaBack.getBoundingClientRect();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Opacity fades first, then height collapses after Back to is gone
      metaBack.style.transition = 'opacity 0.3s ease, height 0.35s ease 0.3s';
      metaBack.style.height = '0';
      metaBack.style.opacity = '0';
    });
  });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    metaBack.style.cssText = '';
  };
  metaBack.addEventListener('transitionend', function onHide(e) {
    if (e.propertyName !== 'height') return;
    cleanup();
    metaBack.removeEventListener('transitionend', onHide);
  });
  setTimeout(cleanup, 750);
}

function openAbout() {
  closeAboutTimers.forEach(clearTimeout);
  closeAboutTimers = [];
  document.body.classList.remove('about-closing');
  crossFadeLabel('Back');
  showMetaBack();
  document.body.classList.add('about-open');
}

function closeAbout() {
  if (!document.body.classList.contains('about-open')) return;

  closeAboutTimers.forEach(clearTimeout);
  closeAboutTimers = [];

  crossFadeLabel('About');
  hideMetaBack();

  // CSS animations handle everything: content fades (0.4s), viewport slides back (delay 0.4s, 0.35s).
  // A single class addition triggers both; classes are removed after all animations complete.
  document.body.classList.add('about-closing');

  closeAboutTimers.push(setTimeout(() => {
    document.body.classList.remove('about-open', 'about-closing');
  }, 800));
}

init();
