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
const expandBtn    = document.getElementById('expand-btn');
const galleryIndexBtn = document.getElementById('gallery-index-btn');
const metaBack     = document.getElementById('meta-back');
const aboutContent = document.getElementById('about-content');

/* ─── Image URL helpers ──────────────────────────────────────────── */
// Vercel Blob images are stored as full URLs; legacy images use /uploads/.
function imgSrc(filename) {
  return filename.startsWith('http') ? filename : `/uploads/${filename}`;
}

// Small-and-many contexts (sidebar filmstrip, gallery index) use the
// lightweight thumbnail; images uploaded before thumbnails existed fall
// back to the full file.
function thumbSrc(image) {
  return imgSrc(image.thumbFilename || image.filename);
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
  setupIndexElasticBounce();
  goTo(0);
  bindEvents();

  // Direct/shared link landing on #index or #about
  if (location.hash === '#index') openGridVisual();
  else if (location.hash === '#about') openAboutVisual();
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
    img.loading = 'lazy';
    img.decoding = 'async';
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
    img.src = thumbSrc(item.image);
    img.alt = '';
    img.draggable = false;
    img.loading = 'lazy';
    img.decoding = 'async';
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

    const colImagesInner = document.createElement('div');
    colImagesInner.className = 'col-images-inner';

    project.images.forEach((image, idx) => {
      const globalIdx = items.findIndex(it => it.image === image);
      const thumb = document.createElement('div');
      thumb.className = 'col-thumb';

      const img = document.createElement('img');
      img.src = thumbSrc(image);
      img.alt = '';
      img.draggable = false;
      img.loading = 'lazy';
      img.decoding = 'async';

      const num = document.createElement('span');
      num.className = 'col-num';
      num.textContent = String(idx + 1).padStart(2, '0');

      thumb.appendChild(img);
      thumb.appendChild(num);
      thumb.addEventListener('click', () => { closeGrid(); goTo(globalIdx); });
      colImagesInner.appendChild(thumb);
    });

    const titleYear = [project.title, project.year].filter(Boolean).join(', ');

    if (titleYear) {
      const titleInline = document.createElement('div');
      titleInline.className = 'col-title-inline';
      if (project.title && project.year) {
        const titleLine = document.createElement('div');
        titleLine.textContent = project.title + ',';
        const yearLine = document.createElement('div');
        yearLine.textContent = project.year;
        titleInline.appendChild(titleLine);
        titleInline.appendChild(yearLine);
      } else {
        titleInline.textContent = titleYear;
      }
      colImagesInner.appendChild(titleInline);
    }

    const colMeta = document.createElement('div');
    colMeta.className = 'col-meta';

    if (titleYear)           { const el = document.createElement('div'); el.className = 'col-title'; el.textContent = titleYear; colMeta.appendChild(el); }
    if (project.client)      { const el = document.createElement('div'); el.className = 'col-client'; el.textContent = project.client; colMeta.appendChild(el); }
    if (project.description) { const el = document.createElement('div'); el.className = 'col-desc'; el.textContent = project.description; colMeta.appendChild(el); }

    colImages.appendChild(colImagesInner);

    const colInner = document.createElement('div');
    colInner.className = 'project-col-inner';
    colInner.appendChild(colImages);
    colInner.appendChild(colMeta);
    col.appendChild(colInner);

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

// Each project's own image strip (.project-col on desktop, scrolling
// vertically; .col-images on mobile, scrolling horizontally) only gets
// native scroll/rubber-band behavior if it actually has enough photos to
// overflow. A project with too few photos has nothing to scroll, so
// dragging it normally does nothing at all. This adds the same elastic
// "pull and spring back" feel browsers already show at the start/end of a
// real scroll — purely touch/drag feedback, never interfering with normal
// scrolling once a project has enough photos to need it.
function setupElasticBounce(el, transformEl = el) {
  function axis() {
    const cs = getComputedStyle(el);
    if (cs.display === 'contents') return null; // no box generated (e.g. .project-col on mobile) — nothing to scroll
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return 'x';
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return 'y';
    return null; // not an active scroll container at the current viewport width
  }
  // At the start/end of the real native scroll range — including the
  // trivial case where there's no scroll range at all (too little content),
  // where both are always true. Using the boundary rather than "does this
  // overflow at all" means the bounce also kicks in at the edges of a
  // genuinely scrollable project, same as the native behavior it's matching.
  function atStart(ax) { return ax === 'x' ? el.scrollLeft <= 0 : el.scrollTop <= 0; }
  function atEnd(ax) {
    return ax === 'x'
      ? el.scrollLeft + el.clientWidth  >= el.scrollWidth  - 1
      : el.scrollTop  + el.clientHeight >= el.scrollHeight - 1;
  }

  let dragging = false;
  let startPos = 0;
  let pointerId = null;
  let dragAxis = null;

  function setOffset(px) {
    transformEl.style.transform = dragAxis === 'y' ? `translateY(${px}px)` : `translateX(${px}px)`;
  }

  function springBack() {
    transformEl.style.transition = 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
    setOffset(0);
    transformEl.addEventListener('transitionend', function onEnd() {
      transformEl.style.transition = '';
      transformEl.removeEventListener('transitionend', onEnd);
    }, { once: true });
  }

  el.addEventListener('pointerdown', e => {
    const ax = axis();
    if (!ax || !atStart(ax) || !atEnd(ax)) return; // has real scroll room — let native scroll handle it
    dragging = true;
    dragAxis = ax;
    pointerId = e.pointerId;
    startPos = ax === 'y' ? e.clientY : e.clientX;
    transformEl.style.transition = 'none';
  });

  el.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== pointerId) return;
    const pos = dragAxis === 'y' ? e.clientY : e.clientX;
    setOffset((pos - startPos) * 0.4); // resistance, like pulling against a spring
  });

  function endDrag(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    springBack();
  }
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('pointerleave', e => { if (dragging) endDrag(e); });

  // Trackpad/mouse wheel. Only takes over once the pull direction has no
  // more native scroll room left (which is always true when there isn't
  // enough content to scroll at all). Resistance grows the further it's
  // pulled (via tanh) instead of clamping hard at a limit, so a long scroll
  // gesture reads as elastic rather than stuck against a wall.
  //
  // Trackpad inertia keeps sending events for a while after the user has
  // actually stopped scrolling, with no way to tell genuine input from the
  // inertial tail — so silence alone isn't a reliable signal to spring
  // back. MAX_HOLD_MS caps how long a single pull can be held regardless of
  // how long events keep arriving, so it never looks stuck for more than a
  // moment even during a long momentum scroll.
  const MAX_PULL = 50;
  const MAX_HOLD_MS = 300;
  let wheelEndTimer = null;
  let forceEndTimer = null;
  let rawAccum = 0;

  function endPull() {
    rawAccum = 0;
    clearTimeout(wheelEndTimer);
    clearTimeout(forceEndTimer);
    springBack();
  }

  el.addEventListener('wheel', e => {
    const ax = axis();
    if (!ax) return;
    const delta = ax === 'y' ? e.deltaY : e.deltaX;
    const pullingPastStart = delta < 0 && atStart(ax);
    const pullingPastEnd   = delta > 0 && atEnd(ax);
    if (!pullingPastStart && !pullingPastEnd) {
      if (rawAccum !== 0) endPull();
      return; // real scroll room in this direction — let native scrolling happen
    }
    e.preventDefault();
    if (rawAccum === 0) forceEndTimer = setTimeout(endPull, MAX_HOLD_MS);
    rawAccum -= delta * 0.3;
    dragAxis = ax;
    transformEl.style.transition = 'none';
    setOffset(MAX_PULL * Math.tanh(rawAccum / MAX_PULL));
    clearTimeout(wheelEndTimer);
    wheelEndTimer = setTimeout(endPull, 120);
  }, { passive: false });

  // Leaving the element immediately snaps it back rather than waiting for
  // the wheel-silence timeout, which could otherwise look stuck while the
  // cursor lingered (e.g. during trackpad momentum scrolling).
  el.addEventListener('mouseleave', () => { if (rawAccum !== 0) endPull(); });
}

function setupIndexElasticBounce() {
  // The transform always targets the *-inner wrapper, never the scrollable
  // element itself: that element is also the fixed clipping boundary that
  // makes content disappear behind the page margins/header while
  // scrolling, same as every other project. Transforming it directly would
  // drag that boundary along with the content instead.
  document.querySelectorAll('.col-images, .project-col').forEach(el => {
    const inner = el.querySelector(':scope > .col-images-inner, :scope > .project-col-inner');
    setupElasticBounce(el, inner);
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

  // Anno dopo il titolo, separato da virgola.
  // L'immagine corrente può sovrascrivere anno/descrizione del progetto.
  const year  = item.image.year        || item.project.year;
  const desc  = item.image.description || item.project.description;
  const titleYear = [item.project.title, year].filter(Boolean).join(', ');
  metaClient.textContent = item.project.client  || '';
  metaClient.hidden      = !item.project.client;
  metaTitle.textContent  = titleYear;
  metaDesc.textContent   = desc || '';

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

  // Expand apre/chiude la griglia (toggle), l'indice la apre soltanto
  expandBtn.addEventListener('click', e => {
    e.stopPropagation();
    document.body.classList.contains('index-open') ? closeGrid() : openGrid();
  });
  galleryIndexBtn.addEventListener('click', e => {
    e.stopPropagation();
    document.body.classList.contains('index-open') ? closeGrid() : openGrid();
    galleryIndexBtn.style.opacity = '1';
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
    } else if (gridOverlay.classList.contains('open')) {
      // Index → About directly: a single history transition (push '#about'
      // on top of '#index'), not "go back, then push" — calling history.back()
      // and pushState right after it would race against each other.
      closeGridVisual(true);
      if (location.hash !== '#about') history.pushState(null, '', '#about');
      openAboutVisual();
    } else {
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

// Index/About are pushed onto browser history as #index / #about, so the
// hardware/browser back button closes them and returns to the main page.
// open*()/close*() are the entry points used by clicks, swipes, etc. — they
// just navigate history; the popstate handler below calls the *Visual
// functions that actually do the work, so there is one code path whether
// the close was triggered in-app or via the browser's back button.
function openGrid() {
  if (location.hash !== '#index') history.pushState(null, '', '#index');
  openGridVisual();
}

function closeGrid(keepAbout = false) {
  if (location.hash === '#index') { history.back(); return; }
  closeGridVisual(keepAbout);
}

function openAbout() {
  if (location.hash !== '#about') history.pushState(null, '', '#about');
  openAboutVisual();
}

function closeAbout() {
  if (location.hash === '#about') { history.back(); return; }
  closeAboutVisual();
}

window.addEventListener('popstate', () => {
  if (gridOverlay.classList.contains('open') && location.hash !== '#index') {
    closeGridVisual(document.body.classList.contains('about-open'));
  }
  if (document.body.classList.contains('about-open') && location.hash !== '#about') {
    closeAboutVisual();
  }
  // Forward navigation (or a direct/shared link) landing on a hash while
  // its overlay isn't open yet.
  if (location.hash === '#index' && !gridOverlay.classList.contains('open')) {
    openGridVisual();
  }
  if (location.hash === '#about' && !document.body.classList.contains('about-open')) {
    openAboutVisual();
  }
});

function openGridVisual() {
  indexCols.scrollLeft = 0;
  indexCols.scrollTop = 0;
  gridOverlay.removeAttribute('hidden');
  gridOverlay.offsetHeight; // force reflow so transition fires from translateX(100%)
  gridOverlay.classList.add('open');
  document.body.classList.add('index-open');
  crossFadeLabel(expandBtn, 'Back');
}

function closeGridVisual(keepAbout = false) {
  if (!keepAbout && document.body.classList.contains('about-open')) {
    // Grid (z-index 50) covers everything — reset About state silently with no animations.
    // Calling closeAboutVisual() here would trigger its viewport transitions and fight the grid slide-out.
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
  crossFadeLabel(expandBtn, 'Expand');
  gridOverlay.addEventListener('transitionend', () => {
    gridOverlay.setAttribute('hidden', '');
  }, { once: true });
}

function crossFadeLabel(el, newText) {
  if (el.textContent === newText) return;
  // Kill any in-progress transition (avoids iOS race with :active release)
  el.style.transition = 'none';
  el.getBoundingClientRect();
  el.style.transition = 'opacity 0.12s ease';
  el.getBoundingClientRect();
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = newText;
    el.style.transition = 'opacity 0.2s ease';
    el.style.opacity = '1';
    setTimeout(() => {
      el.style.transition = '';
      // Force full opacity (instead of clearing back to the stylesheet value):
      // iOS can leave :active "stuck" after the tap that triggered this label
      // change, which would otherwise show the dimmed 0.3 state permanently.
      el.style.opacity = '1';
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

function openAboutVisual() {
  closeAboutTimers.forEach(clearTimeout);
  closeAboutTimers = [];
  document.body.classList.remove('about-closing');
  crossFadeLabel(aboutLink, 'Back');
  showMetaBack();
  document.body.classList.add('about-open');
}

function closeAboutVisual() {
  if (!document.body.classList.contains('about-open')) return;

  closeAboutTimers.forEach(clearTimeout);
  closeAboutTimers = [];

  crossFadeLabel(aboutLink, 'About');
  hideMetaBack();

  // CSS animations handle everything: content fades (0.4s), viewport slides back (delay 0.4s, 0.35s).
  // A single class addition triggers both; classes are removed after all animations complete.
  document.body.classList.add('about-closing');

  closeAboutTimers.push(setTimeout(() => {
    document.body.classList.remove('about-open', 'about-closing');
  }, 800));
}

init();
