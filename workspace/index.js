import { clearToken, formatDate, getToken, loadSession, planDeskUrl, rpc, signIn } from './core.js';

const $ = (id) => document.getElementById(id);
let activeProject = null;
let session = null;
let projects = [];

function status(kind, text) {
  const node = $('signin-status');
  node.className = kind ? `status show ${kind}` : 'status';
  node.textContent = text || '';
}

function setSignedOut() {
  $('signin-panel').hidden = false;
  $('workspace').hidden = true;
  $('password').value = '';
}

function setSignedIn() {
  $('signin-panel').hidden = true;
  $('workspace').hidden = false;
  const name = session?.user?.name || 'Blueprint Builds user';
  const role = session?.role || '';
  const workspace = session?.workspace?.name || 'Workspace';
  $('workspace-user').innerHTML = `<strong>${escapeHtml(name)}</strong> · ${escapeHtml(role)} · ${escapeHtml(workspace)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

async function loadProjects() {
  projects = await rpc('blueprint_mobile_projects');
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
  activeProject = project;
  document.querySelectorAll('.project-button').forEach((node) => node.classList.toggle('active', node === button));
  $('plan-heading').textContent = project.name;
  $('plan-context').textContent = 'Loading the verified plan register…';
  $('plans').innerHTML = '';
  try {
    const plans = await rpc('blueprint_mobile_project_plans', { p_project_id: project.id });
    renderPlans(Array.isArray(plans) ? plans : []);
  } catch (reason) {
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

async function boot() {
  if (!getToken()) return setSignedOut();
  try {
    session = await loadSession();
    setSignedIn();
    await loadProjects();
  } catch {
    clearToken();
    setSignedOut();
  }
}

$('signin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('signin');
  button.disabled = true;
  status('busy', 'Opening your secure workspace…');
  try {
    await signIn($('email').value, $('password').value);
    session = await loadSession();
    status('', '');
    setSignedIn();
    await loadProjects();
  } catch (reason) {
    clearToken();
    status('err', reason?.message || 'Sign-in failed.');
  } finally {
    button.disabled = false;
  }
});

$('signout').addEventListener('click', () => { clearToken(); location.reload(); });
boot();
