import { clearToken, getToken } from '../core.js';
const ENDPOINT = 'https://mxjuknqwzbvvmmdrvkql.supabase.co/functions/v1/blueprint-reviewer-v1/v1';
const $ = id => document.getElementById(id);
let generation = 0, controller = null, projects = [], decisions = [];
function wipe() {
  $('preview-content').hidden = true;
  for (const id of ['preview-projects','preview-decisions','preview-identity','preview-title','preview-summary','preview-milestone','preview-checked','preview-progress']) $(id).replaceChildren();
  projects = []; decisions = [];
}
function message(text, retry = false, signin = false) {
  $('preview-state').hidden = false; $('preview-message').textContent = text;
  $('preview-retry').hidden = !retry; $('preview-signin').hidden = !signin;
}
function element(tag, text, parent) { const node = document.createElement(tag); node.textContent = text; parent.appendChild(node); return node; }
function selectProject(project) {
  document.querySelectorAll('#preview-projects button').forEach(button => { button.classList.toggle('active', button.dataset.project === project.id); button.setAttribute('aria-pressed', String(button.dataset.project === project.id)); });
  $('preview-title').textContent = project.name;
  $('preview-summary').textContent = [project.location, project.stage, project.status].filter(Boolean).join(' / ');
  $('preview-progress').replaceChildren();
  if (typeof project.progress === 'number' && Number.isFinite(project.progress)) {
    const value = Math.max(0, Math.min(100, project.progress));
    element('p', `${Math.round(value)}% complete`, $('preview-progress'));
    const progress = document.createElement('progress'); progress.max = 100; progress.value = value; progress.setAttribute('aria-label', 'Project progress'); $('preview-progress').appendChild(progress);
  }
  $('preview-milestone').textContent = project.nextMilestone || 'No next milestone has been recorded.';
  const list = $('preview-decisions'); list.replaceChildren();
  const related = decisions.filter(item => item.projectId === project.id);
  if (!related.length) element('p', 'No decisions are recorded for this project.', list);
  for (const decision of related) {
    const card = document.createElement('article'); element('h4', decision.title, card);
    element('p', `Status: ${decision.status || 'Not recorded'}`, card); element('p', decision.detail || '', card);
    if (typeof decision.costImpactCents === 'number') element('p', 'Proposed cost impact: ' + new Intl.NumberFormat('en-AU', {style:'currency',currency:'AUD'}).format(decision.costImpactCents / 100), card);
    if (typeof decision.timeImpactDays === 'number') element('p', `Proposed time impact: ${decision.timeImpactDays} days`, card);
    list.appendChild(card);
  }
}
async function load() {
  const current = ++generation; controller?.abort(); controller = new AbortController(); const signal = controller.signal;
  const token = getToken(); wipe();
  if (!token) { message('Sign in with your existing Blueprint account, then open Client View Preview from the business workspace.', false, true); return; }
  message('Checking your review access...');
  const timer = setTimeout(() => controller?.signal === signal && controller.abort(), 15000);
  async function read(path) {
    const response = await fetch(ENDPOINT + path, {method:'GET',headers:{Authorization:'Bearer '+token},signal,cache:'no-store',referrerPolicy:'no-referrer'});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.error?.message || 'The preview is temporarily unavailable.'); error.status = response.status; throw error; }
    if (body.perspective !== 'client-preview' || body.readOnly !== true) throw new Error('The server did not confirm a read-only preview.');
    return body.data;
  }
  try {
    const identity = await read('/session');
    const results = await Promise.all([read('/projects'), read('/decisions')]);
    if (current !== generation || token !== getToken()) return;
    if (!Array.isArray(results[0]) || !Array.isArray(results[1])) throw new Error('The preview returned an unreadable project list.');
    [projects, decisions] = results;
    $('preview-identity').textContent = `${identity.userName || 'Reviewer'} / ${identity.workspaceName || 'Review workspace'}`;
    $('preview-checked').textContent = 'Last checked ' + new Date().toLocaleString('en-AU') + '. Refresh to check for changes. This browser preview requires a connection.';
    for (const project of projects) {
      const button = document.createElement('button');button.type = 'button';button.className = 'project-button';button.dataset.project = project.id;
      element('strong', project.name, button);element('small', project.stage || project.status || 'Project', button);button.addEventListener('click', () => selectProject(project));$('preview-projects').appendChild(button);
    }
    if (projects.length) selectProject(projects[0]); else $('preview-projects').textContent = 'No projects are assigned to this review account.';
    $('preview-state').hidden = true;$('preview-content').hidden = false;
  } catch (error) {
    if (current !== generation || token !== getToken()) return;
    wipe();
    if (error.status === 401) { clearToken();message('Your sign-in needs renewing. Use your existing account; a new invitation is not required.',false,true); }
    else if (error.status === 403) message('Client View Preview is not enabled for this account. Return to your own workspace or contact Blueprint support.');
    else message('The preview could not be checked. Your account has not been signed out. Reconnect and try again.',true);
  } finally { clearTimeout(timer); }
}
$('preview-retry').addEventListener('click', load);$('preview-refresh').addEventListener('click', load);
$('preview-signout').addEventListener('click', () => { ++generation;controller?.abort();wipe();clearToken();location.assign('/workspace/'); });
window.addEventListener('pagehide', () => { ++generation;controller?.abort();wipe(); });
window.addEventListener('pageshow', event => { if (event.persisted) void load(); });
void load();
