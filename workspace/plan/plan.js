import * as pdfjsLib from '/assets/pdfjs/pdf.min.js';
import { clearPlanSession, clearToken, formatDate, getPlanSessionToken, getToken, isStaff, loadOfflineMarkupReceipts, loadSession, registerPdfPageCount, revokePlanSession, rpc, signIn, signPlanPaths, syncOfflinePlanMarkup } from '../core.js';
import { deleteQueuedMarkup, getPlanPack, listQueuedMarkups, planPackKey, queueMarkup, refreshPackMarkups, registerPlanDeskServiceWorker, requestPersistentStorage, savePlanPack, storageSnapshot } from '../offline.js';

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
let activePagePaths = [];
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
let projectRecord = null;
let offlinePack = null;
let offlineMode = false;
let queuedMarkups = [];
let receiptMap = new Map();
let pdfSourceUrl = '';
let pdfSourceBlob = null;
let mediaPathUrls = {};
let syncingOfflineQueue = false;
const objectUrls = new Set();
const activePointers = new Set();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function setStatus(id, kind, text) {
  const node = $(id);
  node.className = kind ? `status show ${kind}` : 'status';
  node.textContent = text || '';
}

function setOfflineState(kind, text) {
  const node = $('offline-state');
  node.className = `offline-state${kind ? ` ${kind}` : ''}`;
  node.textContent = text || '';
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function isNetworkError(reason) {
  const message = String(reason?.message || reason || '');
  return !navigator.onLine || /network|fetch|offline|connection|unreachable/i.test(message);
}

function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function queuedToMarkup(item) {
  return {
    id: `local:${item.clientEventId}`,
    clientEventId: item.clientEventId,
    planId: item.planId,
    page: item.page,
    shape: item.shape,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    points: item.points,
    note: item.note,
    createdAt: item.capturedAt,
    capturedAt: item.capturedAt,
    createdBy: 'You',
    isYours: true,
    pending: true,
    voidedAt: null,
  };
}

async function refreshQueued() {
  queuedMarkups = await listQueuedMarkups(projectId, planId).catch(() => []);
  return queuedMarkups;
}

function mergeMarkupState(base) {
  const merged = (Array.isArray(base) ? base : []).map((item) => {
    const receipt = receiptMap.get(item.id);
    return receipt ? { ...item, ...receipt, offlineCapture: true } : item;
  });
  return [...merged, ...queuedMarkups.map(queuedToMarkup)];
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
  if (!plan) return false;
  if (plan.mimeType?.startsWith('image/')) return true;
  if (Array.isArray(plan.pagePaths) && plan.pagePaths.length > 0) return true;
  return plan.mimeType === 'application/pdf' && (Number(plan.pageCount) > 0 || !!pdfDocument);
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
    card.className = `markup-card${item.voidedAt ? ' voided' : ''}${item.pending ? ' pending' : ''}`;
    const number = index + 1;
    const state = item.pending ? `PENDING SYNC · SHEET ${item.page}` : item.voidedAt ? 'WITHDRAWN' : `SHEET ${item.page}`;
    const canWithdraw = !item.pending && !item.voidedAt && isStaff(session?.role) && (item.isYours || session?.role === 'Owner' || session?.role === 'Project manager');
    const time = item.pending
      ? `captured offline ${formatDateTime(item.capturedAt || item.createdAt)}`
      : item.offlineCapture
        ? `captured offline ${formatDateTime(item.capturedAt)} · synced ${formatDateTime(item.syncedAt)}`
        : formatDate(item.createdAt);
    card.innerHTML = `<p class="markup-note"><strong>${number}.</strong> ${escapeHtml(item.note)}</p><p class="markup-meta">${state} · ${escapeHtml(item.shape?.toUpperCase())} · ${escapeHtml(item.createdBy || 'Blueprint Builds user')} · ${escapeHtml(time)}</p>${canWithdraw ? `<button class="markup-withdraw" type="button" data-withdraw="${escapeHtml(item.id)}">Withdraw markup</button>` : ''}`;
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
  await refreshQueued();
  if (offlineMode) {
    receiptMap = new Map();
    markups = mergeMarkupState(offlinePack?.markups || []);
  } else {
    const [base, receipts] = await Promise.all([
      rpc('blueprint_mobile_plan_markups', { p_plan_id: planId }),
      (getPlanSessionToken() || getToken()) ? loadOfflineMarkupReceipts(planId).catch(() => []) : Promise.resolve([]),
    ]);
    receiptMap = new Map((Array.isArray(receipts) ? receipts : []).map((item) => [item.markupId, item]));
    const clean = Array.isArray(base) ? base : [];
    markups = mergeMarkupState(clean);
    if (offlinePack) refreshPackMarkups(projectId, planId, clean).catch(() => {});
  }
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
  const url = pageUrls[activePage - 1] || await ensurePageUrl(activePage - 1);
  if (!url) throw new Error('The secure sheet could not be prepared.');
  const image = $('sheet-image');
  $('pdf-canvas').hidden = true;
  image.hidden = false;
  image.onload = () => { $('sheet-loading').hidden = true; renderMarkupLayer(); preloadAdjacentSheet(); };
  image.onerror = () => { $('sheet-loading').textContent = 'The secure sheet image could not be loaded. Refresh the Plan Desk and try again.'; };
  image.src = url;
  renderMarkupLayer();
}

async function queueCurrentDraft(note) {
  const capturedAt = new Date().toISOString();
  const item = {
    planKey: planPackKey(projectId, planId),
    projectId,
    planId,
    clientEventId: draft.clientEventId,
    page: draft.page,
    shape: draft.shape,
    x: draft.x,
    y: draft.y,
    w: draft.w,
    h: draft.h,
    points: draft.shape === 'freehand' ? draft.points : null,
    note,
    capturedAt,
  };
  await queueMarkup(item);
  await refreshQueued();
  const base = markups.filter((entry) => !entry.pending);
  markups = mergeMarkupState(base);
  cancelDraft();
  renderMarkupLayer();
  renderMarkupList();
  renderSheetRail(pdfDocument ? pdfDocument.numPages : pageUrls.length);
  setOfflineState('offline', `${queuedMarkups.length} markup${queuedMarkups.length === 1 ? '' : 's'} waiting to sync · capture time preserved`);
}

async function syncOfflineQueue() {
  if (syncingOfflineQueue || offlineMode || !navigator.onLine || (!getPlanSessionToken() && !getToken())) return;
  await refreshQueued();
  if (!queuedMarkups.length) return;
  syncingOfflineQueue = true;
  setOfflineState('busy', `Syncing ${queuedMarkups.length} offline markup${queuedMarkups.length === 1 ? '' : 's'}…`);
  try {
    for (const item of [...queuedMarkups]) {
      await syncOfflinePlanMarkup({
        p_plan_id: item.planId,
        p_client_event_id: item.clientEventId,
        p_page: item.page,
        p_shape: item.shape,
        p_x: item.x,
        p_y: item.y,
        p_w: item.w,
        p_h: item.h,
        p_note: item.note,
        ...(item.points ? { p_points: item.points } : {}),
        p_captured_at: item.capturedAt,
      });
      await deleteQueuedMarkup(item.clientEventId);
    }
    await refreshQueued();
    await loadMarkups();
    setOfflineState('ready', offlinePack ? `Offline copy current · ${formatDateTime(offlinePack.savedAt)}` : 'Offline markups synced into the verified drawing record.');
  } catch (reason) {
    await refreshQueued();
    if (isNetworkError(reason)) setOfflineState('offline', `${queuedMarkups.length} markup${queuedMarkups.length === 1 ? '' : 's'} still waiting for connection`);
    else if (/session|expired|sign in/i.test(reason?.message || '')) setOfflineState('err', 'Offline edits are safe. Reopen this plan from the app to refresh the secure session and sync them.');
    else setOfflineState('err', reason?.message || 'Offline edits remain stored on this device and will retry later.');
  } finally {
    syncingOfflineQueue = false;
  }
}

async function fetchOfflineBlob(url) {
  const response = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('One of the secure plan files could not be saved for offline use.');
  return response.blob();
}

async function mapLimited(items, limit, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return result;
}

async function saveCurrentPlanOffline() {
  if (offlineMode || !plan || !projectRecord) return;
  const button = $('save-offline');
  button.disabled = true;
  setOfflineState('busy', 'Preparing full-quality offline plan pack…');
  try {
    await requestPersistentStorage();
    const snapshot = await storageSnapshot();
    const expected = Math.max(Number(plan.sizeBytes || 0), 8 * 1024 * 1024);
    if (snapshot.quota && snapshot.quota - snapshot.usage < expected * 1.25) {
      throw new Error('This device is too close to its browser storage limit for a safe offline copy. Free some space and try again.');
    }
    const pagePaths = Array.isArray(plan.pagePaths) ? plan.pagePaths.filter(Boolean) : [];
    const paths = plan.mimeType?.startsWith('image/') ? [plan.storagePath] : pagePaths.length ? pagePaths : [plan.storagePath];
    const signed = await signPlanPaths(paths);
    let completed = 0;
    const media = await mapLimited(paths, 3, async (path) => {
      const url = signed[path];
      if (!url) throw new Error('Blueprint could not prepare every sheet for offline use.');
      const blob = await fetchOfflineBlob(url);
      completed += 1;
      setOfflineState('busy', `Saving full-quality plan media… ${completed}/${paths.length}`);
      return { path, mimeType: blob.type || (path === plan.storagePath ? plan.mimeType : 'image/png'), blob };
    });
    const serverMarkups = markups.filter((item) => !item.pending).map(({ pending, ...item }) => item);
    offlinePack = await savePlanPack({
      projectId,
      planId,
      project: projectRecord,
      plan,
      role: session?.role,
      markups: serverMarkups,
      media,
    });
    button.textContent = 'Offline saved';
    button.classList.add('saved');
    setOfflineState('ready', `Full-quality offline copy saved until ${formatDateTime(offlinePack.expiresAt)}`);
  } catch (reason) {
    setOfflineState('err', reason?.message || 'Blueprint could not save this drawing offline.');
  } finally {
    button.disabled = false;
  }
}

async function ensurePageUrl(index) {
  if (pageUrls[index]) return pageUrls[index];
  const path = activePagePaths[index];
  if (!path || offlineMode) return '';
  const signed = await signPlanPaths([path]);
  const url = signed[path] || '';
  if (url) {
    pageUrls[index] = url;
    mediaPathUrls[path] = url;
  }
  return url;
}

function preloadAdjacentSheet() {
  if (pdfDocument || !pageUrls.length) return;
  const candidates = [activePage, activePage - 2].filter((index) => index >= 0 && index < pageUrls.length);
  for (const index of candidates) {
    void ensurePageUrl(index).then((url) => {
      if (!url) return;
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
    }).catch(() => {});
  }
}

async function prepareOfflineMedia() {
  const media = Array.isArray(offlinePack?.media) ? offlinePack.media : [];
  const byPath = new Map(media.map((item) => [item.path, item]));
  const pagePaths = Array.isArray(plan.pagePaths) ? plan.pagePaths.filter(Boolean) : [];
  if (plan.mimeType?.startsWith('image/') || pagePaths.length) {
    const paths = plan.mimeType?.startsWith('image/') ? [plan.storagePath] : pagePaths;
    activePagePaths = paths;
    pageUrls = paths.map((path) => {
      const blob = byPath.get(path)?.blob;
      if (!blob) throw new Error('This offline plan pack is missing one or more drawing sheets. Refresh it while online.');
      return objectUrl(blob);
    });
    pdfDocument = null;
    await renderPage();
    return;
  }
  if (plan.mimeType === 'application/pdf') {
    const blob = byPath.get(plan.storagePath)?.blob;
    if (!blob) throw new Error('This offline plan pack is missing its PDF. Refresh it while online.');
    pdfSourceBlob = blob;
    pdfDocument = await pdfjsLib.getDocument({ data: await blob.arrayBuffer(), isEvalSupported: false }).promise;
    plan.pageCount = Number(plan.pageCount) || pdfDocument.numPages;
    $('legacy-note').hidden = false;
    $('legacy-note').textContent = isStaff(session?.role)
      ? 'Offline copy · original PDF quality preserved. Pin, Zone and Draw stay available and will queue as pending sync.'
      : 'Offline copy · original PDF quality preserved on this device. Client access remains read-only.';
    applyPlanHeader();
    await renderPage();
    return;
  }
  throw new Error('This saved drawing type cannot be rendered offline yet.');
}

async function prepareMedia() {
  if (offlineMode) return prepareOfflineMedia();
  const isImage = plan.mimeType?.startsWith('image/');
  const pagePaths = Array.isArray(plan.pagePaths) ? plan.pagePaths.filter(Boolean) : [];
  if (isImage || pagePaths.length) {
    const paths = isImage ? [plan.storagePath] : pagePaths;
    activePagePaths = paths;
    pageUrls = new Array(paths.length).fill('');
    mediaPathUrls = {};
    await ensurePageUrl(0);
    if (!pageUrls[0]) throw new Error('The secure drawing sheet could not be prepared.');
    pdfDocument = null;
    await renderPage();
    preloadAdjacentSheet();
    return;
  }

  if (plan.mimeType === 'application/pdf') {
    const signed = await signPlanPaths([plan.storagePath]);
    const url = signed[plan.storagePath];
    if (!url) throw new Error('The secure PDF could not be prepared.');
    activePagePaths = [];
    mediaPathUrls = signed;
    pdfSourceUrl = url;
    // Give pdf.js the signed URL instead of waiting for a full ArrayBuffer.
    // When the storage edge supports byte ranges/streaming, first-sheet work
    // starts immediately; the original PDF remains untouched at full quality.
    pdfDocument = await pdfjsLib.getDocument({
      url,
      isEvalSupported: false,
      disableRange: false,
      disableStream: false,
      disableAutoFetch: false,
      rangeChunkSize: 131072,
    }).promise;
    if (isStaff(session?.role) && Number(plan.pageCount) !== pdfDocument.numPages) {
      const registered = await registerPdfPageCount(planId, pdfDocument.numPages);
      plan.pageCount = Number(registered?.pageCount) || pdfDocument.numPages;
    } else {
      plan.pageCount = pdfDocument.numPages;
    }
    $('legacy-note').hidden = false;
    $('legacy-note').textContent = isStaff(session?.role)
      ? 'Blueprint is streaming the original PDF at full quality. Pin, Zone and Draw are anchored directly to this exact PDF revision.'
      : 'Blueprint is streaming the original PDF privately at full quality. Client access remains read-only.';
    applyPlanHeader();
    await renderPage();
    return;
  }

  throw new Error('This drawing type cannot be rendered in the Plan Desk yet.');
}

function applyPlanHeader() {
  $('plan-title').textContent = plan.title;
  const revision = plan.revision ? ` · Rev ${plan.revision}` : '';
  $('plan-meta').textContent = `${plan.discipline || 'Drawing'}${revision} · ${String(plan.status || 'record').toUpperCase()} · published ${formatDate(plan.uploadedAt)} by ${plan.createdBy || 'Blueprint Builds user'}`;
  $('project-name').textContent = projectRecord?.name || 'Plan record';
  if (!isStaff(session?.role)) {
    $('tools-panel').hidden = true;
    $('legacy-note').hidden = false;
    $('legacy-note').textContent = 'Client view is read-only. Markups remain visible as part of the verified drawing record.';
  } else if (!canMarkupPlan()) {
    $('tools-panel').hidden = true;
  } else {
    $('tools-panel').hidden = false;
  }
}

async function loadPlan() {
  if (offlineMode) {
    plan = offlinePack.plan;
    projectRecord = offlinePack.project;
  } else {
    const [plans, projects] = await Promise.all([
      rpc('blueprint_mobile_project_plans', { p_project_id: projectId }),
      rpc('blueprint_mobile_projects'),
    ]);
    plan = Array.isArray(plans) ? plans.find((item) => item.id === planId) : null;
    if (!plan) throw new Error('This drawing is not in a project assigned to your account.');
    projectRecord = Array.isArray(projects) ? projects.find((item) => item.id === projectId) : null;
  }
  if (!plan) throw new Error('This drawing is not available on this device.');
  applyPlanHeader();
  await Promise.all([loadMarkups(), prepareMedia()]);
  renderSheetRail(pdfDocument ? pdfDocument.numPages : pageUrls.length);
  if (offlineMode) setOfflineState('offline', `OFFLINE · saved ${formatDateTime(offlinePack.savedAt)} · edits queue on this device`);
}

async function bootOfflinePack() {
  offlineMode = true;
  session = { role: offlinePack.role, offline: true };
  showDesk();
  $('signout').textContent = 'Close offline copy';
  await loadPlan();
}

async function boot() {
  registerPlanDeskServiceWorker().catch(() => {});
  if (!UUID.test(projectId) || !UUID.test(planId)) {
    $('signin-panel').hidden = false;
    $('signin-panel').innerHTML = '<h2>Drawing link incomplete</h2><p class="hint">Open the plan from the Builder Workspace so Blueprint can verify both the project and drawing record.</p><a class="btn" href="/workspace/">Open Builder Workspace</a>';
    return;
  }
  offlinePack = await getPlanPack(projectId, planId).catch(() => null);
  if (offlinePack) {
    $('save-offline').textContent = 'Offline saved';
    $('save-offline').classList.add('saved');
    setOfflineState('ready', `Saved on this device until ${formatDateTime(offlinePack.expiresAt)}`);
  }
  if (!getToken() && !getPlanSessionToken()) {
    if (!navigator.onLine && offlinePack) return bootOfflinePack();
    return showSignin();
  }
  try {
    session = await loadSession();
    showDesk();
    await loadPlan();
    await syncOfflineQueue();
  } catch (reason) {
    if (offlinePack && isNetworkError(reason)) return bootOfflinePack();
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
    await syncOfflineQueue();
  } catch (reason) {
    clearToken();
    setStatus('signin-status', 'err', reason?.message || 'Sign-in failed.');
  } finally {
    button.disabled = false;
  }
});

$('signout').addEventListener('click', async () => {
  if (!offlineMode) {
    try { await revokePlanSession(); } catch { clearPlanSession(); }
    clearToken();
  }
  location.href = '/workspace/';
});
document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));
$('cancel-markup').addEventListener('click', () => cancelDraft());
$('fit-drawing').addEventListener('click', fitDrawing);
$('zoom-out').addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
$('zoom-in').addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
$('save-offline').addEventListener('click', saveCurrentPlanOffline);
updateZoomUi();
renderToolState();

$('save-markup').addEventListener('click', async () => {
  if (!draft) return;
  const note = $('draft-note').value.trim().replace(/\s+/g, ' ');
  if (!note) return setStatus('markup-status', 'err', 'Add a note so the mark has meaning in the record.');
  const button = $('save-markup');
  button.disabled = true;
  if (offlineMode || !navigator.onLine) {
    try { await queueCurrentDraft(note); }
    catch (reason) { setStatus('markup-status', 'err', reason?.message || 'The offline markup could not be stored on this device.'); }
    finally { button.disabled = false; }
    return;
  }
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
      ...(draft.shape === 'freehand' ? { p_points: draft.points } : {}),
    });
    cancelDraft();
    await loadMarkups();
    renderSheetRail(pdfDocument ? pdfDocument.numPages : pageUrls.length);
  } catch (reason) {
    if (isNetworkError(reason)) await queueCurrentDraft(note);
    else setStatus('markup-status', 'err', reason?.message || 'The markup could not be recorded.');
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

window.addEventListener('online', () => {
  if (offlineMode) {
    setOfflineState('ready', 'Connection restored · reopen this drawing from the app to refresh its secure session and sync offline edits.');
    return;
  }
  void syncOfflineQueue();
});
window.addEventListener('offline', () => {
  setOfflineState('offline', offlinePack ? 'OFFLINE · saved plan remains available · new markups will queue' : 'OFFLINE · keep this desk open; save a plan pack while online for future offline reopening');
});
window.addEventListener('beforeunload', () => {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
});
