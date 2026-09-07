import * as pdfjsLib from '/assets/pdfjs/pdf.min.js';
import { clearPlanSession, clearToken, formatDate, getPlanSessionToken, getToken, isStaff, loadSession, revokePlanSession, rpc, signIn, signPlanPaths } from '../core.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const projectId = params.get('project') || '';
const planId = params.get('plan') || '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const TAP_MOVE_PX = 12;
const MARK_MIN_PX = 8;

let session = null;
let plan = null;
let markups = [];
let pageUrls = [];
let pdfDocument = null;
let activePage = 1;
let activeTool = '';
let draft = null;
let pointerStart = null;
let strokePoints = [];
let preview = null;
let zoom = 1;
let pinchState = null;
let panState = null;
let gestureAborted = false;
let pdfRenderTask = null;
let pdfRenderTimer = null;
let resizeTimer = null;
let lastRenderedSurfaceWidth = 0;
const activePointers = new Set();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function setStatus(id, kind, text) {
  const node = $(id);
  node.className = kind ? `status show ${kind}` : 'status';
  node.textContent = text || '';
}

function showSignin() {
  $('signin-panel').hidden = false;
  $('desk').hidden = true;
  $('signout').hidden = true;
}

function showDesk() {
  $('signin-panel').hidden = true;
  $('desk').hidden = false;
  $('signout').hidden = false;
}

function normalisedPoint(event) {
  const rect = $('drawing-layer').getBoundingClientRect();
  if (!rect.width || !rect.height) return [0, 0];
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  return [x, y];
}

function clearPreview() {
  if (preview) preview.remove();
  preview = null;
}

function clampZoom(value) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function updateZoomUi() {
  $('zoom-level').value = `${Math.round(zoom * 100)}%`;
  $('zoom-level').textContent = `${Math.round(zoom * 100)}%`;
  $('zoom-out').disabled = zoom <= ZOOM_MIN + 0.001;
  $('zoom-in').disabled = zoom >= ZOOM_MAX - 0.001;
}

function schedulePdfRerender(delay = 140) {
  if (!pdfDocument) return;
  clearTimeout(pdfRenderTimer);
  pdfRenderTimer = setTimeout(() => { void renderPdfPage(); }, delay);
}

function setZoom(next, focalClientX = null, focalClientY = null, rerenderPdf = true) {
  const nextZoom = clampZoom(next);
  if (Math.abs(nextZoom - zoom) < 0.001) return;
  const frame = $('sheet-frame');
  const surface = $('sheet-surface');
  const rect = frame.getBoundingClientRect();
  const localX = Number.isFinite(focalClientX) ? focalClientX - rect.left : frame.clientWidth / 2;
  const localY = Number.isFinite(focalClientY) ? focalClientY - rect.top : frame.clientHeight / 2;
  const contentX = frame.scrollLeft + Math.max(0, localX);
  const contentY = frame.scrollTop + Math.max(0, localY);
  const ratio = nextZoom / zoom;
  zoom = nextZoom;
  surface.style.width = `${zoom * 100}%`;
  updateZoomUi();
  requestAnimationFrame(() => {
    frame.scrollLeft = Math.max(0, contentX * ratio - localX);
    frame.scrollTop = Math.max(0, contentY * ratio - localY);
    renderMarkupLayer();
    if (rerenderPdf) schedulePdfRerender();
  });
}

function fitDrawing() {
  zoom = 1;
  $('sheet-surface').style.width = '100%';
  $('sheet-frame').scrollTo({ left: 0, top: 0, behavior: 'auto' });
  updateZoomUi();
  renderMarkupLayer();
  schedulePdfRerender(0);
}

function renderToolState() {
  const marking = !!activeTool;
  document.querySelectorAll('[data-tool]').forEach((button) => {
    const selected = activeTool ? button.dataset.tool === activeTool : button.dataset.tool === 'browse';
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  $('drawing-layer').hidden = !marking;
  $('sheet-frame').classList.toggle('marking', marking);
  $('gesture-hint').textContent = marking
    ? `${activeTool === 'pin' ? 'Pin' : activeTool === 'zone' ? 'Zone' : 'Draw'} mode · one pointer only · choose Browse to pan or zoom`
    : 'Browse mode · drag or scroll to pan · pinch, trackpad or + / − to zoom';
}

function setTool(tool) {
  if (tool === 'browse') {
    activeTool = '';
    cancelDraft(false);
    renderToolState();
    return;
  }
  if (!plan || !isStaff(session?.role) || !canMarkupPlan()) return;
  activeTool = activeTool === tool ? '' : tool;
  cancelDraft(false);
  renderToolState();
}

function canMarkupPlan() {
  return !!plan && (plan.mimeType?.startsWith('image/') || (Array.isArray(plan.pagePaths) && plan.pagePaths.length > 0));
}

function beginDraft(next) {
  draft = { ...next, clientEventId: crypto.randomUUID(), page: activePage };
  $('draft-box').hidden = false;
  $('draft-note').focus();
  renderDraftPreview();
}

function cancelDraft(resetTool = true) {
  draft = null;
  pointerStart = null;
  strokePoints = [];
  gestureAborted = false;
  activePointers.clear();
  clearPreview();
  $('draft-box').hidden = true;
  $('draft-note').value = '';
  setStatus('markup-status', '', '');
  renderMarkupLayer();
  if (resetTool) activeTool = '';
  renderToolState();
}

function drawZonePreview(x, y, w, h) {
  clearPreview();
  preview = document.createElement('div');
  preview.className = 'markup-zone';
  Object.assign(preview.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
  $('drawing-layer').appendChild(preview);
}

function drawStrokePreview(points) {
  clearPreview();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'markup-svg');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' '));
  svg.appendChild(line);
  preview = svg;
  $('drawing-layer').appendChild(svg);
}

function renderDraftPreview() {
  if (!draft) return;
  clearPreview();
  if (draft.shape === 'zone') drawZonePreview(draft.x, draft.y, draft.w, draft.h);
  if (draft.shape === 'pin') {
    preview = document.createElement('div');
    preview.className = 'markup-pin';
    preview.textContent = '+';
    Object.assign(preview.style, { left: `${draft.x * 100}%`, top: `${draft.y * 100}%` });
    $('drawing-layer').appendChild(preview);
  }
  if (draft.shape === 'freehand') drawStrokePreview(draft.points || []);
}

function renderMarkupLayer() {
  const layer = $('markup-layer');
  layer.innerHTML = '';
  const pageMarkups = markups.filter((item) => Number(item.page) === activePage && !item.voidedAt);
  pageMarkups.forEach((item, index) => {
    const number = markups.filter((m) => !m.voidedAt).indexOf(item) + 1 || index + 1;
    if (item.shape === 'zone') {
      const node = document.createElement('div');
      node.className = 'markup-zone';
      Object.assign(node.style, { left: `${Number(item.x) * 100}%`, top: `${Number(item.y) * 100}%`, width: `${Number(item.w) * 100}%`, height: `${Number(item.h) * 100}%` });
      layer.appendChild(node);
    } else if (item.shape === 'pin') {
      const node = document.createElement('div');
      node.className = 'markup-pin';
      node.textContent = String(number);
      Object.assign(node.style, { left: `${Number(item.x) * 100}%`, top: `${Number(item.y) * 100}%` });
      layer.appendChild(node);
    } else if (item.shape === 'freehand' && Array.isArray(item.points)) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'markup-svg');
      svg.setAttribute('viewBox', '0 0 1000 1000');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('points', item.points.map(([x, y]) => `${Number(x) * 1000},${Number(y) * 1000}`).join(' '));
      svg.appendChild(line);
      layer.appendChild(svg);
    }
  });
}

function renderMarkupList() {
  const list = $('markup-list');
  list.innerHTML = '';
  if (!markups.length) {
    list.innerHTML = '<div class="empty-state">No markups on this revision yet.</div>';
    return;
  }
  markups.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = `markup-card${item.voidedAt ? ' voided' : ''}`;
    const number = index + 1;
    const state = item.voidedAt ? 'WITHDRAWN' : `SHEET ${item.page}`;
    const canWithdraw = !item.voidedAt && isStaff(session?.role) && (item.isYours || session?.role === 'Owner' || session?.role === 'Project manager');
    card.innerHTML = `<p class="markup-note"><strong>${number}.</strong> ${escapeHtml(item.note)}</p><p class="markup-meta">${state} · ${escapeHtml(item.shape?.toUpperCase())} · ${escapeHtml(item.createdBy || 'Blueprint Builds user')} · ${formatDate(item.createdAt)}</p>${canWithdraw ? `<button class="markup-withdraw" type="button" data-withdraw="${escapeHtml(item.id)}">Withdraw markup</button>` : ''}`;
    card.addEventListener('click', (event) => {
      if (event.target.closest('[data-withdraw]')) return;
      activePage = Number(item.page) || 1;
      renderPage();
    });
    list.appendChild(card);
  });
  list.querySelectorAll('[data-withdraw]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await rpc('blueprint_mobile_void_plan_markup', { p_markup_id: button.dataset.withdraw });
      await loadMarkups();
    } catch (reason) {
      alert(reason?.message || 'The markup could not be withdrawn.');
    } finally {
      button.disabled = false;
    }
  }));
}

async function loadMarkups() {
  markups = await rpc('blueprint_mobile_plan_markups', { p_plan_id: planId });
  if (!Array.isArray(markups)) markups = [];
  renderMarkupLayer();
  renderMarkupList();
}

function renderSheetRail(count) {
  const rail = $('sheet-rail');
  rail.innerHTML = '';
  if (count <= 1) return;
  for (let page = 1; page <= count; page += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `sheet-tab${page === activePage ? ' active' : ''}`;
    const total = markups.filter((item) => Number(item.page) === page && !item.voidedAt).length;
    button.textContent = `SHEET ${page}${total ? ` · ${total}` : ''}`;
    button.addEventListener('click', () => { activePage = page; cancelDraft(); renderPage(); });
    rail.appendChild(button);
  }
}

async function renderPdfPage() {
  if (!pdfDocument) return;
  const canvas = $('pdf-canvas');
  const image = $('sheet-image');
  image.hidden = true;
  canvas.hidden = false;
  const page = await pdfDocument.getPage(activePage);
  const base = page.getViewport({ scale: 1 });
  const surfaceWidth = Math.max(280, $('sheet-surface').clientWidth || $('sheet-frame').clientWidth || 1000);
  const cssScale = surfaceWidth / base.width;
  const deviceScale = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
  const dimensionCap = 4096 / Math.max(base.width, base.height);
  const renderScale = Math.min(4, dimensionCap, Math.max(0.5, cssScale * deviceScale));
  const viewport = page.getViewport({ scale: renderScale });
  if (pdfRenderTask) {
    try { pdfRenderTask.cancel(); } catch { /* already settled */ }
  }
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport });
  pdfRenderTask = task;
  try {
    await task.promise;
  } catch (reason) {
    if (reason?.name !== 'RenderingCancelledException') throw reason;
    return;
  } finally {
    if (pdfRenderTask === task) pdfRenderTask = null;
  }
  lastRenderedSurfaceWidth = surfaceWidth;
  $('sheet-loading').hidden = true;
  renderMarkupLayer();
}

async function renderPage() {
  const count = pdfDocument ? pdfDocument.numPages : pageUrls.length;
  activePage = Math.max(1, Math.min(count || 1, activePage));
  renderSheetRail(count || 1);
  $('sheet-loading').hidden = false;
  if (pdfDocument) {
    await renderPdfPage();
    return;
  }
  const url = pageUrls[activePage - 1];
  const image = $('sheet-image');
  $('pdf-canvas').hidden = true;
  image.hidden = false;
  image.onload = () => { $('sheet-loading').hidden = true; renderMarkupLayer(); };
  image.onerror = () => { $('sheet-loading').textContent = 'The secure sheet image could not be loaded. Refresh the Plan Desk and try again.'; };
  image.src = url;
  renderMarkupLayer();
}

async function prepareMedia() {
  const isImage = plan.mimeType?.startsWith('image/');
  const pagePaths = Array.isArray(plan.pagePaths) ? plan.pagePaths.filter(Boolean) : [];
  if (isImage || pagePaths.length) {
    const paths = isImage ? [plan.storagePath] : pagePaths;
    const signed = await signPlanPaths(paths);
    pageUrls = paths.map((path) => signed[path]).filter(Boolean);
    if (!pageUrls.length) throw new Error('The secure drawing sheets could not be prepared.');
    pdfDocument = null;
    await renderPage();
    return;
  }

  if (plan.mimeType === 'application/pdf') {
    const signed = await signPlanPaths([plan.storagePath]);
    const url = signed[plan.storagePath];
    if (!url) throw new Error('The secure PDF could not be prepared.');
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('The secure PDF could not be loaded.');
    const bytes = await response.arrayBuffer();
    pdfDocument = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    $('legacy-note').hidden = false;
    $('legacy-note').textContent = 'This older PDF did not publish with sheet canvases. Blueprint is rendering it privately here instead of handing it to a generic preview. Republish the PDF from Blueprint’s web publisher to enable permanent markups on each sheet.';
    $('tools-panel').hidden = true;
    await renderPage();
    return;
  }

  throw new Error('This drawing type cannot be rendered in the Plan Desk yet.');
}

async function loadPlan() {
  const plans = await rpc('blueprint_mobile_project_plans', { p_project_id: projectId });
  plan = Array.isArray(plans) ? plans.find((item) => item.id === planId) : null;
  if (!plan) throw new Error('This drawing is not in a project assigned to your account.');
  $('plan-title').textContent = plan.title;
  const revision = plan.revision ? ` · Rev ${plan.revision}` : '';
  $('plan-meta').textContent = `${plan.discipline || 'Drawing'}${revision} · ${String(plan.status || 'record').toUpperCase()} · published ${formatDate(plan.uploadedAt)} by ${plan.createdBy || 'Blueprint Builds user'}`;
  const projects = await rpc('blueprint_mobile_projects');
  const project = Array.isArray(projects) ? projects.find((item) => item.id === projectId) : null;
  $('project-name').textContent = project?.name || 'Plan record';
  if (!isStaff(session?.role)) {
    $('tools-panel').hidden = true;
    $('legacy-note').hidden = false;
    $('legacy-note').textContent = 'Client view is read-only. Markups remain visible as part of the verified drawing record.';
  } else if (!canMarkupPlan()) {
    $('tools-panel').hidden = true;
  }
  await Promise.all([loadMarkups(), prepareMedia()]);
  renderSheetRail(pdfDocument ? pdfDocument.numPages : pageUrls.length);
}


async function boot() {
  if (!UUID.test(projectId) || !UUID.test(planId)) {
    $('signin-panel').hidden = false;
    $('signin-panel').innerHTML = '<h2>Drawing link incomplete</h2><p class="hint">Open the plan from the Builder Workspace so Blueprint can verify both the project and drawing record.</p><a class="btn" href="/workspace/">Open Builder Workspace</a>';
    return;
  }
  if (!getToken() && !getPlanSessionToken()) return showSignin();
  try {
    session = await loadSession();
    showDesk();
    await loadPlan();
  } catch (reason) {
    if (/session|sign in|access token/i.test(reason?.message || '')) {
      clearPlanSession();
      clearToken();
      showSignin();
      return;
    }
    $('sheet-loading').textContent = reason?.message || 'The Plan Desk could not load this drawing.';
  }
}

$('signin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('signin');
  button.disabled = true;
  setStatus('signin-status', 'busy', 'Verifying your build access…');
  try {
    await signIn($('email').value, $('password').value);
    session = await loadSession();
    setStatus('signin-status', '', '');
    showDesk();
    await loadPlan();
  } catch (reason) {
    clearToken();
    setStatus('signin-status', 'err', reason?.message || 'Sign-in failed.');
  } finally {
    button.disabled = false;
  }
});

$('signout').addEventListener('click', async () => {
  try { await revokePlanSession(); } catch { clearPlanSession(); }
  clearToken();
  location.reload();
});
document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));
$('cancel-markup').addEventListener('click', () => cancelDraft());
$('fit-drawing').addEventListener('click', fitDrawing);
$('zoom-out').addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
$('zoom-in').addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
updateZoomUi();
renderToolState();

$('save-markup').addEventListener('click', async () => {
  if (!draft) return;
  const note = $('draft-note').value.trim().replace(/\s+/g, ' ');
  if (!note) return setStatus('markup-status', 'err', 'Add a note so the mark has meaning in the record.');
  const button = $('save-markup');
  button.disabled = true;
  setStatus('markup-status', 'busy', 'Sealing markup into the drawing record…');
  try {
    await rpc('blueprint_mobile_create_plan_markup', {
      p_plan_id: planId,
      p_client_event_id: draft.clientEventId,
      p_page: draft.page,
      p_shape: draft.shape,
      p_x: draft.x,
      p_y: draft.y,
      p_w: draft.w,
      p_h: draft.h,
      p_note: note,
      p_points: draft.shape === 'freehand' ? draft.points : null,
    });
    cancelDraft();
    await loadMarkups();
    renderSheetRail(pdfDocument ? pdfDocument.numPages : pageUrls.length);
  } catch (reason) {
    setStatus('markup-status', 'err', reason?.message || 'The markup could not be recorded.');
  } finally {
    button.disabled = false;
  }
});

function resetPointerGesture() {
  pointerStart = null;
  strokePoints = [];
  gestureAborted = false;
  activePointers.clear();
  clearPreview();
}

function abortMarkupGesture() {
  gestureAborted = true;
  pointerStart = null;
  strokePoints = [];
  clearPreview();
}

$('drawing-layer').addEventListener('pointerdown', (event) => {
  if (!activeTool || draft) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  activePointers.add(event.pointerId);
  if (activePointers.size > 1 || (event.pointerType === 'touch' && !event.isPrimary)) {
    abortMarkupGesture();
    activeTool = '';
    renderToolState();
    return;
  }
  event.preventDefault();
  $('drawing-layer').setPointerCapture?.(event.pointerId);
  const [x, y] = normalisedPoint(event);
  pointerStart = {
    x, y,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
  };
  if (activeTool === 'freehand') {
    strokePoints = [[x, y]];
    drawStrokePreview(strokePoints);
  }
});

$('drawing-layer').addEventListener('pointermove', (event) => {
  if (!pointerStart || draft || gestureAborted || event.pointerId !== pointerStart.pointerId) return;
  event.preventDefault();
  const [x, y] = normalisedPoint(event);
  if (activeTool === 'zone') {
    const left = Math.min(pointerStart.x, x);
    const top = Math.min(pointerStart.y, y);
    drawZonePreview(left, top, Math.abs(x - pointerStart.x), Math.abs(y - pointerStart.y));
  } else if (activeTool === 'freehand' && strokePoints.length < 400) {
    const last = strokePoints[strokePoints.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) > 0.002) {
      strokePoints.push([x, y]);
      drawStrokePreview(strokePoints);
    }
  }
});

$('drawing-layer').addEventListener('pointerup', (event) => {
  activePointers.delete(event.pointerId);
  if (!pointerStart || draft || gestureAborted || event.pointerId !== pointerStart.pointerId) {
    if (!activePointers.size && gestureAborted) resetPointerGesture();
    return;
  }
  event.preventDefault();
  const start = pointerStart;
  const [x, y] = normalisedPoint(event);
  const movedPx = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
  pointerStart = null;

  if (activeTool === 'pin') {
    if (movedPx <= TAP_MOVE_PX) beginDraft({ shape: 'pin', x, y, w: 0, h: 0, points: null });
    else clearPreview();
    return;
  }

  if (activeTool === 'zone') {
    const rect = $('drawing-layer').getBoundingClientRect();
    const left = Math.min(start.x, x);
    const top = Math.min(start.y, y);
    const w = Math.abs(x - start.x);
    const h = Math.abs(y - start.y);
    if (w * rect.width < MARK_MIN_PX || h * rect.height < MARK_MIN_PX) { clearPreview(); return; }
    beginDraft({ shape: 'zone', x: left, y: top, w, h, points: null });
    return;
  }

  if (activeTool === 'freehand') {
    const points = strokePoints.slice(0, 400);
    strokePoints = [];
    if (points.length < 2 || movedPx < MARK_MIN_PX) { clearPreview(); return; }
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    beginDraft({
      shape: 'freehand',
      x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
      points,
    });
  }
});

$('drawing-layer').addEventListener('pointercancel', (event) => {
  activePointers.delete(event.pointerId);
  if (pointerStart?.pointerId === event.pointerId) resetPointerGesture();
});

const frame = $('sheet-frame');

frame.addEventListener('wheel', (event) => {
  if (activeTool || !event.ctrlKey) return;
  event.preventDefault();
  const multiplier = Math.exp(-event.deltaY * 0.0025);
  setZoom(zoom * multiplier, event.clientX, event.clientY);
}, { passive: false });

frame.addEventListener('touchstart', (event) => {
  if (activeTool || event.touches.length !== 2) return;
  const [a, b] = event.touches;
  pinchState = {
    distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
    zoom,
  };
}, { passive: true });

frame.addEventListener('touchmove', (event) => {
  if (activeTool || !pinchState || event.touches.length !== 2) return;
  event.preventDefault();
  const [a, b] = event.touches;
  const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  const centerX = (a.clientX + b.clientX) / 2;
  const centerY = (a.clientY + b.clientY) / 2;
  setZoom(pinchState.zoom * (distance / Math.max(1, pinchState.distance)), centerX, centerY, false);
}, { passive: false });

frame.addEventListener('touchend', (event) => {
  if (!pinchState || event.touches.length >= 2) return;
  pinchState = null;
  schedulePdfRerender();
}, { passive: true });

frame.addEventListener('pointerdown', (event) => {
  if (activeTool || event.pointerType !== 'mouse' || event.button !== 0) return;
  panState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: frame.scrollLeft, top: frame.scrollTop };
  frame.setPointerCapture?.(event.pointerId);
});

frame.addEventListener('pointermove', (event) => {
  if (!panState || event.pointerId !== panState.pointerId) return;
  const dx = event.clientX - panState.x;
  const dy = event.clientY - panState.y;
  if (Math.abs(dx) + Math.abs(dy) < 3) return;
  event.preventDefault();
  frame.scrollLeft = panState.left - dx;
  frame.scrollTop = panState.top - dy;
});

function endPan(event) {
  if (panState?.pointerId === event.pointerId) panState = null;
}
frame.addEventListener('pointerup', endPan);
frame.addEventListener('pointercancel', endPan);

frame.addEventListener('keydown', (event) => {
  if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoom + ZOOM_STEP); return; }
  if (event.key === '-') { event.preventDefault(); setZoom(zoom - ZOOM_STEP); return; }
  if (event.key === '0' || event.key.toLowerCase() === 'f') { event.preventDefault(); fitDrawing(); return; }
  if (event.key === 'Escape') { event.preventDefault(); setTool('browse'); return; }
  const step = event.shiftKey ? 180 : 70;
  if (event.key === 'ArrowLeft') { event.preventDefault(); frame.scrollBy({ left: -step, behavior: 'auto' }); }
  if (event.key === 'ArrowRight') { event.preventDefault(); frame.scrollBy({ left: step, behavior: 'auto' }); }
  if (event.key === 'ArrowUp') { event.preventDefault(); frame.scrollBy({ top: -step, behavior: 'auto' }); }
  if (event.key === 'ArrowDown') { event.preventDefault(); frame.scrollBy({ top: step, behavior: 'auto' }); }
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const surfaceWidth = $('sheet-surface').clientWidth;
    if (pdfDocument && Math.abs(surfaceWidth - lastRenderedSurfaceWidth) > 3) schedulePdfRerender(0);
    else renderMarkupLayer();
  }, 220);
});

boot();
