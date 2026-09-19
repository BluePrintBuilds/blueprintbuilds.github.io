import { rpc } from './core.js';

export function mountProjectBriefs(root) {
  let disposed = false;
  let busy = false;
  let records = [];
  let draftId = '';
  let version = 0;
  let baseline = '';
  const requests = new Set();
  root.innerHTML = '<p class="kicker">Private planning</p><h2>Start your own project</h2><p>Add your business details if relevant and describe the outcome you want. Only you can see these briefs. Builder access is arranged separately.</p><button class="btn quiet" id="new-brief" type="button">New project brief</button><p id="brief-status" role="status" aria-live="polite"></p><form id="brief-form" hidden><h3 id="brief-editor-title">New private brief</h3><div class="brief-fields"><label class="field"><span>Project name</span><input name="name" maxlength="200" required></label><label class="field"><span>Business name (optional)</span><input name="businessName" maxlength="160"></label><label class="field"><span>Location (optional)</span><input name="location" maxlength="300"></label><label class="field"><span>Target date (optional)</span><input name="targetDate" type="date"></label></div><label class="field"><span>What would a successful outcome look like?</span><textarea name="objective" maxlength="2000" rows="5" required></textarea></label><p class="hint">This is a planning draft, not an approved build or a quote. Save while online. It stays separate from your assigned projects.</p><div class="brief-actions"><button class="btn" id="save-brief" type="submit">Save private brief</button><button class="btn quiet" id="close-brief" type="button">Close editor</button></div></form><h3>Your saved briefs</h3><div id="brief-list"></div><button class="btn quiet" id="reload-briefs" type="button">Reload saved briefs</button>';
  const find = (selector) => root.querySelector(selector);
  const form = find('#brief-form');
  const fields = ['name', 'businessName', 'location', 'objective', 'targetDate'];
  const values = () => Object.fromEntries(fields.map((key) => [key, form.elements.namedItem(key).value]));
  const dirty = () => !form.hidden && JSON.stringify(values()) !== baseline;
  const status = (text, error = false) => { find('#brief-status').textContent = text; find('#brief-status').className = error ? 'brief-error' : 'brief-notice'; };
  const controls = (disabled) => root.querySelectorAll('button,input,textarea').forEach((node) => { node.disabled = disabled; });
  async function call(name, params = {}) {
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { return await rpc(name, params, undefined, { signal: controller.signal }); }
    catch (error) {
      if (controller.signal.aborted) throw new Error('The request could not be confirmed. Your entries are still here; reconnect and try again.');
      throw error;
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function open(item) {
    if (busy || (dirty() && !window.confirm('Discard unsaved changes? The saved brief will stay unchanged.'))) return;
    draftId = item?.id || crypto.randomUUID(); version = item?.version || 0;
    for (const key of fields) form.elements.namedItem(key).value = item?.[key] || '';
    baseline = JSON.stringify(values());
    find('#brief-editor-title').textContent = version ? 'Edit your brief' : 'New private brief';
    form.hidden = false; status(''); form.elements.namedItem('name').focus();
  }
  function render() {
    const list = find('#brief-list'); list.replaceChildren();
    if (!records.length) { const empty = document.createElement('p'); empty.textContent = 'No private briefs saved yet. Your assigned projects are unchanged.'; list.append(empty); }
    for (const item of records) {
      const article = document.createElement('article'); article.className = 'brief-record';
      const heading = document.createElement('h3'); heading.textContent = item.name; article.append(heading);
      for (const value of [item.businessName, item.location, item.objective, item.targetDate ? 'Target: ' + item.targetDate : '', 'Private draft · no builder access granted']) {
        if (!value) continue; const p = document.createElement('p'); p.textContent = value; article.append(p);
      }
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn quiet'; edit.textContent = 'Edit brief'; edit.setAttribute('aria-label', 'Edit ' + item.name); edit.addEventListener('click', () => open(item)); article.append(edit);
      list.append(article);
    }
  }
  async function load() {
    if (busy) return;
    busy = true; controls(true); status('Loading your briefs…');
    try {
      const data = await call('blueprint_mobile_project_briefs');
      if (disposed) return;
      if (!Array.isArray(data)) throw new Error('Blueprint returned an invalid brief list.');
      records = data; render(); status('');
    } catch (error) { if (!disposed) status(error?.message || 'Your briefs could not be loaded.', true); }
    finally { busy = false; if (!disposed) controls(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const input = { id: draftId, version, ...values() };
    if (!input.name.trim() || !input.objective.trim()) { status('Add a project name and describe the outcome you want.', true); return; }
    busy = true; controls(true); status('Saving your private brief…');
    try {
      const item = await call('blueprint_mobile_save_project_brief', { p_input: input });
      if (disposed) return;
      if (!item?.id || !Number.isInteger(item.version)) throw new Error('The save could not be confirmed. Reload your saved briefs before trying again.');
      records = [item, ...records.filter((other) => other.id !== item.id)]; version = item.version;
      for (const key of fields) form.elements.namedItem(key).value = item[key] || '';
      baseline = JSON.stringify(values()); render();
      status('Saved privately to your account. No builder has been given access.');
    } catch (error) { if (!disposed) status(error?.message || 'The brief could not be saved. Your entries are still here.', true); }
    finally { busy = false; if (!disposed) controls(false); }
  }
  const beforeUnload = (event) => { if (dirty() || busy) { event.preventDefault(); event.returnValue = ''; } };
  find('#new-brief').addEventListener('click', () => open(null));
  find('#close-brief').addEventListener('click', () => { if (!dirty() || window.confirm('Discard unsaved changes?')) { form.hidden = true; baseline = ''; status(''); } });
  find('#reload-briefs').addEventListener('click', () => { void load(); });
  form.addEventListener('submit', save); window.addEventListener('beforeunload', beforeUnload);
  void load();
  return { dispose() { disposed = true; for (const controller of requests) controller.abort(); window.removeEventListener('beforeunload', beforeUnload); root.replaceChildren(); } };
}
