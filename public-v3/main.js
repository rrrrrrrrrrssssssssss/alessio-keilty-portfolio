/* ─── State ──────────────────────────────────────────────────────── */
let items = [];   // [{ image, project, projectImages }]
let N = 0;
let cur = 0;
let closeAboutTimers = [];
const crossFadeTimers = new WeakMap();
let sidebarScrollRaf = null; // rAF id for the active sidebar scroll animation
let indexWasPushed = false;  // true only when index was opened via pushState (user nav), not replaceState (landing)
let gridHideOnEnd  = false;  // guards the transitionend→hidden so a quick reopen can't get hidden by a stale close

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
const authorNameEl = document.getElementById('author-name');
const bottomBarEl  = document.getElementById('bottom-bar');
const indexHeader  = document.getElementById('index-header');
const indexTitleBtn= document.getElementById('index-title-btn');
const indexAbout   = document.getElementById('index-about');
const indexAuthor  = document.getElementById('index-author');
const indexNav          = document.getElementById('index-nav');
const indexNavAbout     = document.getElementById('index-nav-about');
const indexOnview       = document.getElementById('index-onview');
const indexOnviewClient = document.getElementById('index-onview-client');
const indexOnviewTitle  = document.getElementById('index-onview-title');
const indexOnviewDesc   = document.getElementById('index-onview-desc');

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

  // /3 always opens on the index; #about is the only exception
  if (location.hash === '#about') {
    document.body.classList.remove('preload'); // openGridVisual won't run, so remove it here
    openAboutVisual();
  } else {
    history.replaceState(null, '', '#index');
    openGridVisual(true); // instant: removes preload internally and fades in the landing UI
  }
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
    div.addEventListener('click', () => {
      closeAboutVisual();
      history.replaceState(null, '', location.pathname);
      goTo(i);
    });
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
      thumb.addEventListener('click', () => {
        closeGridVisual(false);
        history.replaceState(null, '', location.pathname);
        goTo(globalIdx);
      });
      colImagesInner.appendChild(thumb);
    });

    const titleYear = [project.title, project.year].filter(Boolean).join(', ');
    // On mobile the inline label uses client as fallback when there is no title
    const mobileFirst    = project.title || project.client || '';
    const mobileTitleYear = [mobileFirst, project.year].filter(Boolean).join(', ');

    if (mobileTitleYear) {
      const titleInline = document.createElement('div');
      titleInline.className = 'col-title-inline';
      if (mobileFirst && project.year) {
        // Two-line layout: title or client on first line, year below
        const titleLine = document.createElement('div');
        titleLine.textContent = mobileFirst + ',';
        const yearLine = document.createElement('div');
        yearLine.textContent = project.year;
        titleInline.appendChild(titleLine);
        titleInline.appendChild(yearLine);
      } else {
        titleInline.textContent = mobileTitleYear;
      }
      colImagesInner.appendChild(titleInline);
    }

    const colMeta = document.createElement('div');
    colMeta.className = 'col-meta';

    if (titleYear)           { const el = document.createElement('div'); el.className = 'col-title'; el.textContent = titleYear; colMeta.appendChild(el); }
    if (project.client)      { const el = document.createElement('div'); el.className = 'col-client'; el.textContent = project.client; colMeta.appendChild(el); }
    if (project.description) { const el = document.createElement('div'); el.className = 'col-desc'; el.textContent = project.description; colMeta.appendChild(el); }

    colImages.appendChild(colImagesInner);
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
  // gesture (trackpad inertia keeps sending events for a while) reads as
  // elastic rather than stuck against a wall.
  const MAX_PULL = 50;
  let wheelEndTimer = null;
  let rawAccum = 0;
  el.addEventListener('wheel', e => {
    const ax = axis();
    if (!ax) return;
    const delta = ax === 'y' ? e.deltaY : e.deltaX;
    const pullingPastStart = delta < 0 && atStart(ax);
    const pullingPastEnd   = delta > 0 && atEnd(ax);
    if (!pullingPastStart && !pullingPastEnd) {
      if (rawAccum !== 0) { rawAccum = 0; clearTimeout(wheelEndTimer); springBack(); }
      return; // real scroll room in this direction — let native scrolling happen
    }
    e.preventDefault();
    rawAccum -= delta * 0.3;
    dragAxis = ax;
    transformEl.style.transition = 'none';
    setOffset(MAX_PULL * Math.tanh(rawAccum / MAX_PULL));
    clearTimeout(wheelEndTimer);
    wheelEndTimer = setTimeout(() => { rawAccum = 0; springBack(); }, 120);
  }, { passive: false });

  // Leaving the element immediately snaps it back rather than waiting for
  // the wheel-silence timeout, which could otherwise look stuck while the
  // cursor lingered (e.g. during trackpad momentum scrolling).
  el.addEventListener('mouseleave', () => {
    clearTimeout(wheelEndTimer);
    rawAccum = 0;
    springBack();
  });
}

function setupIndexElasticBounce() {
  // Desktop (.project-col) is left on native scrolling only — the custom
  // bounce there behaved inconsistently across interactions and wasn't
  // worth the complexity. Mobile (.col-images) keeps it.
  //
  // The transform is applied to .col-images-inner (the thumbnails wrapper),
  // not to .col-images itself: .col-images is the fixed clipping boundary
  // that makes thumbnails disappear behind the page margins while
  // scrolling, same as every other project. Transforming it directly would
  // have dragged that boundary along with the content instead.
  document.querySelectorAll('.col-images').forEach(el => {
    setupElasticBounce(el, el.querySelector('.col-images-inner'));
  });
}

/* ─── Sidebar scroll animation ───────────────────────────────────── */
function scrollSidebarTo(target) {
  const max = sidebarEl.scrollWidth - sidebarEl.clientWidth;
  target = Math.max(0, Math.min(target, max));
  if (sidebarScrollRaf) cancelAnimationFrame(sidebarScrollRaf);
  const start = sidebarEl.scrollLeft;
  const diff = target - start;
  if (Math.abs(diff) < 2) return;
  const duration = 300;
  const t0 = performance.now();
  function step(now) {
    const t = Math.min((now - t0) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out
    sidebarEl.scrollLeft = start + diff * ease;
    sidebarScrollRaf = t < 1 ? requestAnimationFrame(step) : null;
  }
  sidebarScrollRaf = requestAnimationFrame(step);
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
      const delta = thumbRect.left - sidebarRect.left;
      scrollSidebarTo(sidebarEl.scrollLeft + delta);
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

  expandBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (window.innerWidth > 768) {
      // Desktop: "Viewer" goes to viewer only — no-op if already there
      if (document.body.classList.contains('index-open')) closeGrid();
    } else {
      document.body.classList.contains('index-open') ? closeGrid() : openGrid();
    }
  });
  galleryIndexBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (window.innerWidth > 768) {
      // Desktop: "Index overview" opens index only — no-op if already there
      if (!document.body.classList.contains('index-open')) openGrid();
    } else {
      document.body.classList.contains('index-open') ? closeGrid() : openGrid();
    }
    galleryIndexBtn.style.opacity = '';
  });
  aboutLink.addEventListener('click', e => {
    e.stopPropagation();
    if (document.body.classList.contains('about-open') && !document.body.classList.contains('index-open')) {
      closeAboutVisual();
      history.replaceState(null, '', location.pathname);
    } else if (window.innerWidth <= 768 && document.body.classList.contains('index-open')) {
      // Mobile: About from index — same slide-out as going to viewer.
      // about-from-index suppresses the viewport animation (CSS), viewport.transition
      // must be 'none' when index-open is removed so it snaps (not slides) to 100vw.
      document.body.classList.add('about-from-index');
      viewport.style.transition = 'none';
      void viewport.getBoundingClientRect();
      closeGridVisual(false); // grid slides right, bar slides to viewer pos, sidebar fades in
      if (location.hash !== '#about') history.pushState(null, '', '#about');
      openAboutVisual();
      requestAnimationFrame(() => { viewport.style.transition = ''; });
    } else {
      openAbout();
    }
  });
  metaClient.addEventListener('click', closeAbout);
  metaTitle.addEventListener('click', closeAbout);
  metaDesc.addEventListener('click', closeAbout);
  indexTitleBtn.addEventListener('click', () => {
    closeGridVisual(false);
    history.replaceState(null, '', location.pathname);
  });
  document.getElementById('grid-close').addEventListener('click', () => {
    closeGridVisual(false);
    history.replaceState(null, '', location.pathname);
  });
  authorNameEl.addEventListener('click', () => {
    if (document.body.classList.contains('about-open') && !document.body.classList.contains('index-open')) {
      closeAbout();
    } else if (gridOverlay.classList.contains('open')) {
      if (window.innerWidth <= 768) {
        // Mobile index → About: same slide-out as going to viewer.
        document.body.classList.add('about-from-index');
        viewport.style.transition = 'none';
        void viewport.getBoundingClientRect();
        closeGridVisual(false); // grid slides right, bar slides to viewer pos, sidebar fades in
        if (location.hash !== '#about') history.pushState(null, '', '#about');
        openAboutVisual();
        requestAnimationFrame(() => { viewport.style.transition = ''; });
      } else {
        // Desktop index → About: slide grid out, then open about
        closeGridVisual(true);
        if (location.hash !== '#about') history.pushState(null, '', '#about');
        openAboutVisual();
      }
    } else {
      openAbout();
    }
  });
  document.getElementById('meta-back').addEventListener('click', () => {
    // "On view" always goes to the viewer, not back through history
    // (history.back() would reopen the index if coming from there).
    closeAboutVisual();
    if (location.hash === '#about') history.replaceState(null, '', location.pathname);
  });
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
  indexWasPushed = true;
  if (location.hash !== '#index') history.pushState(null, '', '#index');
  openGridVisual();
}

function closeGrid(keepAbout = false) {
  if (location.hash === '#index') {
    if (indexWasPushed) { history.back(); return; }
    // Landing: index was replaceState'd — just clean up hash and close visually
    history.replaceState(null, '', location.pathname);
  }
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
    // When navigating back to the index, suppress the viewport slide-back
    // (the grid overlay will cover the viewport immediately).
    if (location.hash === '#index') document.body.classList.add('about-to-index');
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

/* ─── Index "On view" metadata (desktop only) ───────────────────── */
function updateIndexOnview() {
  const item = items[cur];
  if (!item) return;
  const year = item.image.year || item.project.year;
  const desc = item.image.description || item.project.description;
  const titleYear = [item.project.title, year].filter(Boolean).join(', ');
  indexOnviewClient.textContent = item.project.client || '';
  indexOnviewClient.hidden = !item.project.client;
  indexOnviewTitle.textContent = titleYear;
  indexOnviewTitle.hidden = !titleYear;
  indexOnviewDesc.textContent = desc || '';
  indexOnviewDesc.hidden = !desc;
}

/* ─── Index nav About button (desktop only) ─────────────────────── */
indexNavAbout.addEventListener('click', () => {
  closeGridVisual(true);
  if (location.hash !== '#about') history.pushState(null, '', '#about');
  openAboutVisual();
});

indexOnview.addEventListener('click', () => {
  closeGridVisual(false);
  history.replaceState(null, '', location.pathname);
});

indexAbout.addEventListener('click', () => {
  closeGridVisual(true);
  if (location.hash !== '#about') history.pushState(null, '', '#about');
  openAboutVisual();
});

indexAuthor.addEventListener('click', () => {
  closeGridVisual(true);
  if (location.hash !== '#about') history.pushState(null, '', '#about');
  openAboutVisual();
});

function openGridVisual(instant = false) {
  gridHideOnEnd = false;
  indexCols.scrollLeft = 0;
  indexCols.scrollTop = 0;
  if (instant) {
    // Freeze transition and force the overlay visible before unhiding it, so
    // neither the desktop slide nor the mobile opacity fade-in fires on landing.
    gridOverlay.style.transition = 'none';
    gridOverlay.style.transform  = 'translateX(0)';
    gridOverlay.style.opacity    = '1';
  }
  // Mobile non-instant: slide the grid in from the right.
  const mobileNonInstant = !instant && window.innerWidth <= 768;
  if (mobileNonInstant) {
    gridOverlay.removeAttribute('hidden');
    gridOverlay.offsetHeight;  // commit display:flex at translateX(100%)
    // Defer class adds to next frame so the browser paints translateX(100%)
    // first, guaranteeing the CSS transition fires (element was just shown).
    requestAnimationFrame(() => {
      // Hide meta-group instantly (no transition) — prevents text flash near AK
      // when body.index-open { opacity:0 } would otherwise trigger a 0.5s fade.
      const metaGroupEl = document.getElementById('meta-group');
      metaGroupEl.style.transition = 'none';
      void metaGroupEl.offsetHeight; // commit transition:none before index-open fires
      // Reset about-link label to "About" if we're entering index from about
      if (document.body.classList.contains('about-open')) {
        aboutLink.textContent = 'About';
        aboutLink.style.transition = '';
        aboutLink.style.opacity = '';
      }
      document.body.classList.add('index-open');
      gridOverlay.classList.add('open');
      crossFadeLabel(expandBtn, 'Go to the viewer');
      // Restore CSS transition on meta-group so it fades in on close.
      requestAnimationFrame(() => {
        metaGroupEl.style.transition = '';
      });
    });
    return;
  }

  gridOverlay.removeAttribute('hidden');
  if (!instant) {
    gridOverlay.offsetHeight; // force reflow so overlay starts from opacity:0 before animating
  }

  if (window.innerWidth > 768) {
    const pad = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--pad')) || 14;
    const gap = 3;

    if (instant) {
      indexNav.style.transition    = 'none';
      indexOnview.style.transition = 'none';
    }

    const akH = indexAuthor.offsetHeight;

    // Header at CSS default (top: var(--pad)); AK below header; nav below AK
    const akTargetTop  = pad + indexHeader.offsetHeight + gap;
    const navTargetTop = akTargetTop + akH + 1.5;

    // FLIP indexAuthor (AK viewer position → below header)
    const authorRect = authorNameEl.getBoundingClientRect();
    indexAuthor.style.transition  = 'none';
    indexAuthor.style.top         = instant ? akTargetTop + 'px' : authorRect.top + 'px';
    indexAuthor.style.opacity     = instant ? '0' : '1';
    authorNameEl.style.transition = 'none';
    authorNameEl.style.opacity    = '0';
    if (!instant) {
      indexAuthor.getBoundingClientRect();
      indexAuthor.style.transition = '';
      indexAuthor.style.top = akTargetTop + 'px';
    }
    indexAuthor.style.pointerEvents = 'auto';

    // Header stays at CSS default top: var(--pad) — no JS override needed

    indexNav.style.top     = navTargetTop + 'px';
    indexNav.style.opacity = '0';
    if (!instant) {
      indexNav.getBoundingClientRect();
      setTimeout(() => {
        indexNav.style.transition = 'opacity 0.3s ease';
        indexNav.style.opacity = '1';
      }, 500);
    }

    indexCols.style.paddingTop = (navTargetTop + indexNav.offsetHeight + 6) + 'px';
    updateIndexOnview();
    indexOnview.style.opacity = instant ? '0' : '1';
    indexOnview.style.pointerEvents = 'auto';
  }

  gridOverlay.classList.add('open');
  if (!mobileNonInstant) {
    document.body.classList.add('index-open');
  }

  if (instant) {
    const isMobile    = window.innerWidth <= 768;
    const TEXT_FADE   = 0.35;
    const PHOTO_DELAY = 300;
    const PHOTO_FADE  = 0.4;

    if (isMobile) expandBtn.textContent = 'Go to the viewer';

    const photoEls = Array.from(indexCols.querySelectorAll('.col-thumb, .col-meta, .col-gap'));
    photoEls.forEach(el => { el.style.opacity = '0'; el.style.transition = 'none'; });

    if (isMobile) {
      // Mobile landing: buttons + About/AK bar are hidden by body.preload CSS.
      // Pin opacity:0 inline BEFORE removing that class so the CSS lift doesn't
      // cause a visible flash to opacity:1, then fade in from the committed state.
      const mobileTextEls = [galleryIndexBtn, expandBtn, bottomBarEl];
      mobileTextEls.forEach(el => { el.style.opacity = '0'; el.style.transition = 'none'; });
      document.body.classList.remove('preload');
      void indexCols.offsetHeight; // commit opacity:0 so the transition fires correctly

      requestAnimationFrame(() => {
        mobileTextEls.forEach(el => {
          el.style.transition = `opacity ${TEXT_FADE}s ease`;
          el.style.opacity    = '1';
        });
        setTimeout(() => {
          photoEls.forEach(el => {
            el.style.transition = `opacity ${PHOTO_FADE}s ease`;
            el.style.opacity    = '1';
          });
          setTimeout(() => {
            photoEls.forEach(el => { el.style.transition = ''; el.style.opacity = ''; });
          }, PHOTO_FADE * 1000 + 50);
        }, PHOTO_DELAY);
        setTimeout(() => {
          mobileTextEls.forEach(el => { el.style.transition = ''; el.style.opacity = ''; });
        }, TEXT_FADE * 1000 + 50);
      });

      requestAnimationFrame(() => {
        gridOverlay.style.transition = '';
        gridOverlay.style.transform  = '';
      });
      return;
    }

    // Desktop landing: pin header at opacity:0 and fade it in.
    document.body.classList.remove('preload');
    indexHeader.style.transition = 'none';
    indexHeader.style.opacity    = '0';
    const textEls = [indexHeader, indexAuthor, indexNav, indexOnview];

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Force reflow so Safari commits opacity:0 before the transition fires.
        void indexCols.offsetHeight;
        textEls.forEach(el => {
          el.style.transition = `opacity ${TEXT_FADE}s ease`;
          el.style.opacity    = '1';
        });
        setTimeout(() => {
          photoEls.forEach(el => {
            el.style.transition = `opacity ${PHOTO_FADE}s ease`;
            el.style.opacity    = '1';
          });
          setTimeout(() => {
            photoEls.forEach(el => { el.style.transition = ''; el.style.opacity = ''; });
          }, PHOTO_FADE * 1000 + 50);
        }, PHOTO_DELAY);
        setTimeout(() => {
          indexHeader.style.transition = '';
          indexHeader.style.opacity    = '';
          [indexAuthor, indexNav, indexOnview].forEach(el => { el.style.transition = ''; });
        }, TEXT_FADE * 1000 + 50);
      });
    });

    requestAnimationFrame(() => {
      gridOverlay.style.transition = '';
      gridOverlay.style.transform  = '';
      indexNav.style.transition    = '';
      indexOnview.style.transition = '';
    });
    return;
  }
  crossFadeLabel(expandBtn, 'Go to the viewer');
}

function closeGridVisual(keepAbout = false) {
  indexWasPushed = false;
  if (!keepAbout && document.body.classList.contains('about-open')) {
    // Grid (z-index 50) covers everything — reset About state silently with no animations.
    // Calling closeAboutVisual() here would trigger its viewport transitions and fight the grid slide-out.
    closeAboutTimers.forEach(clearTimeout);
    closeAboutTimers = [];
    document.body.classList.remove('about-open', 'about-closing', 'about-from-index');
    aboutLink.textContent = 'About';
    aboutLink.style.transition = '';
    aboutLink.style.opacity = '';
    metaBack.style.cssText = '';
    indexAbout.style.opacity = '0';
    indexAbout.style.pointerEvents = '';
  }
  indexNav.style.opacity = '0';
  indexOnview.style.opacity = '0';
  indexOnview.style.pointerEvents = '';
  indexCols.style.paddingTop = '';

  // Reverse FLIP: AK flies back to its viewer position
  if (window.innerWidth > 768) {
    const authorRect = authorNameEl.getBoundingClientRect();
    indexAuthor.style.pointerEvents = '';
    indexAuthor.style.transition = 'top 0.5s ease, opacity 0.3s ease';
    indexAuthor.style.top = authorRect.top + 'px';
    const onDown = (e) => {
      if (e.propertyName !== 'top') return;
      indexAuthor.removeEventListener('transitionend', onDown);
      indexAuthor.style.opacity = '0';
      authorNameEl.style.opacity = '';
      authorNameEl.style.transition = '';
    };
    indexAuthor.addEventListener('transitionend', onDown);

    indexHeader.style.top = '';
  } else {
    indexAbout.style.opacity = '0';
    indexAbout.style.pointerEvents = '';
    indexAuthor.style.opacity = '0';
    indexAuthor.style.pointerEvents = '';
  }

  gridOverlay.style.transition = '';  // ensure CSS transition is active (rAF may not have run)
  gridOverlay.style.opacity = '';     // clear any inline pin from instant open
  gridOverlay.classList.remove('open');
  // On mobile: keep meta-group/about-content hidden for the 0.35s slide-out
  if (window.innerWidth <= 768) {
    document.body.classList.add('index-closing');
    setTimeout(() => {
      document.body.classList.remove('index-closing');
    }, 360);
  }
  document.body.classList.remove('index-open');
  // Returning to about from index: restore "Back" label (was reset to "About" on index open)
  if (keepAbout && document.body.classList.contains('about-open') && window.innerWidth <= 768) {
    crossFadeLabel(aboutLink, 'Back');
  }
  if (window.innerWidth <= 768) crossFadeLabel(expandBtn, 'Expand');
  gridHideOnEnd = true;
  const onGridEnd = (e) => {
    if (e.target !== gridOverlay) return;
    gridOverlay.removeEventListener('transitionend', onGridEnd);
    if (gridHideOnEnd) gridOverlay.setAttribute('hidden', '');
  };
  gridOverlay.addEventListener('transitionend', onGridEnd);
}

function crossFadeLabel(el, newText) {
  // Cancel any pending fade so a stale timer can't overwrite the correct text
  const pending = crossFadeTimers.get(el);
  if (pending) {
    clearTimeout(pending);
    crossFadeTimers.delete(el);
    el.style.transition = 'none';
    el.style.opacity = '1';
    el.getBoundingClientRect();
    el.style.transition = '';
    el.style.opacity = '';
  }
  if (el.textContent === newText) return;
  el.style.transition = 'none';
  el.getBoundingClientRect();
  el.style.transition = 'opacity 0.12s ease';
  el.getBoundingClientRect();
  el.style.opacity = '0';
  const timer = setTimeout(() => {
    crossFadeTimers.delete(el);
    el.textContent = newText;
    el.style.transition = 'opacity 0.2s ease';
    el.style.opacity = '1';
    setTimeout(() => {
      el.style.transition = '';
      el.style.opacity = '';
    }, 250);
  }, 150);
  crossFadeTimers.set(el, timer);
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
  crossFadeLabel(aboutLink, window.innerWidth > 768 ? 'On view' : 'Back');
  showMetaBack();
  document.body.classList.add('about-open');
}

function closeAboutVisual() {
  if (!document.body.classList.contains('about-open')) return;

  closeAboutTimers.forEach(clearTimeout);
  closeAboutTimers = [];

  document.body.classList.remove('about-from-index');
  crossFadeLabel(aboutLink, 'About');
  hideMetaBack();

  // CSS animations handle everything: content fades (0.4s), viewport slides back (delay 0.4s, 0.35s).
  // A single class addition triggers both; classes are removed after all animations complete.
  document.body.classList.add('about-closing');

  closeAboutTimers.push(setTimeout(() => {
    document.body.classList.remove('about-open', 'about-closing', 'about-to-index', 'about-from-index');
  }, 800));
}

init();
