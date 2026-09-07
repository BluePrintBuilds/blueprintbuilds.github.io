import * as pdfjsLib from '/assets/pdfjs/pdf.min.js';
import { clearPlanSession, clearToken, formatDate, getPlanSessionToken, getToken, isStaff, loadSession, revokePlanSession, rpc, signIn, signPlanPaths } from '../core.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const projectId = params.get('project') || '';
const planId = params.get('plan') || '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function setTool(tool) {
  if (!plan || !isStaff(session?.role) || !canMarkupPlan()) return;
  activeTool = activeTool === tool ? '' : tool;
  document.querySelectorAll('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === activeTool));
  $('drawing-layer').hidden = !activeTool;
  cancelDraft(false);
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
  clearPreview();
  $('draft-box').hidden = true;
  $('draft-note').value = '';
  setStatus('markup-status', '', '');
  renderMarkupLayer();
  if (resetTool) {
    activeTool = '';
    document.querySelectorAll('[data-tool]').forEach((button) => button.classList.remove('active'));
    $('drawing-layer').hidden = true;
  }
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
  const canvas = $('pdf-canvas');
  const image = $('sheet-image');
  image.hidden = true;
  canvas.hidden = false;
  const page = await pdfDocument.getPage(activePage);
  const base = page.getViewport({ scale: 1 });
  const frameWidth = Math.max(320, $('sheet-frame').clientWidth || 1000);
  const scale = Math.min(2.5, Math.max(0.5, frameWidth / base.width));
  const viewport = page.getViewport({ scale });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
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

$('drawing-layer').addEventListener('pointerdown', (event) => {
  if (!activeTool || draft) return;
  event.preventDefault();
  $('drawing-layer').setPointerCapture?.(event.pointerId);
  const [x, y] = normalisedPoint(event);
  if (activeTool === 'pin') {
    beginDraft({ shape: 'pin', x, y, w: 0, h: 0, points: null });
    return;
  }
  pointerStart = [x, y];
  if (activeTool === 'freehand') {
    strokePoints = [[x, y]];
    drawStrokePreview(strokePoints);
  }
});

$('drawing-layer').addEventListener('pointermove', (event) => {
  if (!pointerStart || draft) return;
  event.preventDefault();
  const [x, y] = normalisedPoint(event);
  if (activeTool === 'zone') {
    const left = Math.min(pointerStart[0], x);
    const top = Math.min(pointerStart[1], y);
    drawZonePreview(left, top, Math.abs(x - pointerStart[0]), Math.abs(y - pointerStart[1]));
  } else if (activeTool === 'freehand' && strokePoints.length < 400) {
    const last = strokePoints[strokePoints.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) > 0.002) {
      strokePoints.push([x, y]);
      drawStrokePreview(strokePoints);
    }
  }
});

$('drawing-layer').addEventListener('pointerup', (event) => {
  if (!pointerStart || draft) return;
  event.preventDefault();
  const [x, y] = normalisedPoint(event);
  if (activeTool === 'zone') {
    const left = Math.min(pointerStart[0], x);
    const top = Math.min(pointerStart[1], y);
    const w = Math.abs(x - pointerStart[0]);
    const h = Math.abs(y - pointerStart[1]);
    pointerStart = null;
    if (w < 0.004 || h < 0.004) { clearPreview(); return; }
    beginDraft({ shape: 'zone', x: left, y: top, w, h, points: null });
  } else if (activeTool === 'freehand') {
    const points = strokePoints.slice(0, 400);
    pointerStart = null;
    strokePoints = [];
    if (points.length < 2) { clearPreview(); return; }
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    beginDraft({ shape: 'freehand', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), points });
  }
});

window.addEventListener('resize', () => { if (pdfDocument) renderPage(); else renderMarkupLayer(); });
boot();
