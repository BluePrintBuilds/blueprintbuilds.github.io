import { clearToken, formatDate, getToken, isStaff, loadSession, planDeskUrl, rpc, signIn } from './core.js';
import { mountProjectBriefs } from './project-briefs.js';

const $ = (id) => document.getElementById(id);
let activeProject = null;
let projectRequest = 0;
let session = null;
let projects = [];
let privateBriefs = null;
let bootGeneration = 0, activeBoot = 0;

function status(kind, text) {
  const node = $('signin-status');
  node.className = kind ? `status show ${kind}` : 'status';
  node.textContent = text || '';
}

function setSignedOut() {
  ++bootGeneration; session = null;
  document.getElementById('recovery-panel').hidden = true;
  ++projectRequest; activeProject = null; projects = [];
  privateBriefs?.dispose(); privateBriefs = null;
  for (const id of ['workspace-user', 'projects', 'plans']) $(id).replaceChildren();
  $('signin-panel').hidden = false;
  $('workspace').hidden = true;
  $('password').value = '';
}

function setSignedIn() {
  $('recovery-panel').hidden = true;
  $('signin-panel').hidden = true;
  $('workspace').hidden = false;
  privateBriefs?.dispose();
  privateBriefs = mountProjectBriefs($('project-briefs'));
  const name = session?.user?.name || 'Blueprint Builds user';
  const role = session?.role || '';
  const staff = isStaff(role);
  $('client-preview-entry').hidden = !(role === 'Site lead' && Array.isArray(session?.capabilities) && session.capabilities.includes('client-view-preview'));
  document.querySelector('h1').textContent = staff ? 'Builder Workspace' : 'Client Workspace';
  document.querySelector('.lede').textContent = 'Start a private project brief, then review the plans and revisions assigned to your account.';
  document.querySelectorAll('a[href="/publish/"]').forEach((link) => { link.hidden = !staff; });
  const workspace = session?.workspace?.name || 'Workspace';
  $('workspace-user').innerHTML = `<strong>${escapeHtml(name)}</strong> · ${escapeHtml(role)} · ${escapeHtml(workspace)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

async function loadProjects(stillCurrent = () => true) {
  const next = await rpc('blueprint_mobile_projects');
  if (!stillCurrent()) return;
  if (!Array.isArray(next) || !next.every(item => item && typeof item.id === 'string' && typeof item.name === 'string')) throw new Error('The project list could not be checked. Try again.');
  projects = next;
  const list = $('projects');
  list.innerHTML = '';
  if (!Array.isArray(projects) || !projects.length) {
    list.innerHTML = '<div class="empty-state">No active projects are assigned to this account.</div>';
    return;
  }
  projects.forEach((project, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'project-button';
    button.innerHTML = `<strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.stage || project.status || 'Active build')}</small>`;
    button.addEventListener('click', () => selectProject(project, button));
    list.appendChild(button);
    if (index === 0) button.click();
  });
}

async function selectProject(project, button) {
  const request = ++projectRequest;
  activeProject = project;
  document.querySelectorAll('.project-button').forEach((node) => node.classList.toggle('active', node === button));
  $('plan-heading').textContent = project.name;
  $('plan-context').textContent = 'Loading the verified plan register…';
  $('plans').innerHTML = '';
  try {
    const plans = await rpc('blueprint_mobile_project_plans', { p_project_id: project.id });
    if (request !== projectRequest || activeProject?.id !== project.id) return;
    renderPlans(Array.isArray(plans) ? plans : []);
  } catch (reason) {
    if (request !== projectRequest || activeProject?.id !== project.id) return;
    $('plans').innerHTML = `<div class="empty-state">${escapeHtml(reason?.message || 'Plans could not be loaded.')}</div>`;
  }
}

function renderPlans(plans) {
  $('plan-context').textContent = `${plans.length} drawing${plans.length === 1 ? '' : 's'} in the record · current revisions stay clearly separated from superseded issues.`;
  const list = $('plans');
  list.innerHTML = '';
  if (!plans.length) {
    list.innerHTML = '<div class="empty-state">No drawings have been published to this project yet.</div>';
    return;
  }
  plans.forEach((plan) => {
    const row = document.createElement('article');
    row.className = 'plan-row';
    const revision = plan.revision ? ` · Rev ${escapeHtml(plan.revision)}` : '';
    const markups = Number(plan.markupCount || 0);
    row.innerHTML = `<div><p class="plan-title">${escapeHtml(plan.title)}</p><p class="plan-meta">${escapeHtml(String(plan.status || 'record').toUpperCase())} · ${escapeHtml(plan.discipline || 'Drawing')}${revision} · ${formatDate(plan.uploadedAt)} · ${markups} markup${markups === 1 ? '' : 's'}</p></div><a class="plan-open" href="${planDeskUrl(activeProject.id, plan.id)}">Open Plan Desk →</a>`;
    list.appendChild(row);
  });
}

function recover(reason) {
  const rejected = !reason?.configurationFailure && [401, 403].includes(reason?.status);
  if (rejected || !getToken()) {
    clearToken(); setSignedOut(); status('err', reason?.message || 'Sign in again to check your workspace.'); return;
  }
  setSignedOut(); $('signin-panel').hidden = true; $('recovery-panel').hidden = false;
  $('recovery-message').textContent = reason?.configurationFailure ? 'Blueprint needs a service correction. Your password has not been checked.' : 'Reconnect and try again. Your sign-in is kept in this tab; no password reset is needed.';
}
async function boot() {
  const token = getToken();
  if (!token) return setSignedOut();
  const request = ++bootGeneration; activeBoot = request;
  const current = () => request === bootGeneration && getToken() === token;
  $('retry-workspace').disabled = true;
  try {
    const next = await loadSession(token);
    if (!current()) return;
    if (!next?.user?.id || !(isStaff(next?.role) || next?.role === 'Client')) throw new Error('The workspace details could not be checked. Try again.');
    session = next;
    await loadProjects(current);
    if (current()) setSignedIn();
  } catch (reason) { if (current()) recover(reason); }
  finally { if (activeBoot === request) { activeBoot = 0; $('retry-workspace').disabled = false; } }
}

$('signin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('signin');
  button.disabled = true;
  status('busy', 'Opening your secure workspace…');
  try {
    await signIn($('email').value, $('password').value);
    session = await loadSession();
    if (!session?.user?.id || !(isStaff(session?.role) || session?.role === 'Client')) throw new Error('The workspace details could not be checked. Try again.');
    await loadProjects();
    status('', '');
    setSignedIn();
  } catch (reason) {
    recover(reason);
  } finally {
    button.disabled = false;
  }
});

$('retry-workspace').addEventListener('click', () => { void boot(); });
$('change-account').addEventListener('click', () => { clearToken(); setSignedOut(); });
$('signout').addEventListener('click', () => { clearToken(); location.reload(); });
boot();
