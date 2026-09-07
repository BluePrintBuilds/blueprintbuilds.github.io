const SUPABASE_URL = 'https://mxjuknqwzbvvmmdrvkql.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJteGp1a253d3pidnZtbWRydmtxbCIsInJlZiI6Im14anVrbnF3emJ2dm1tZHJ2a3FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5ODU4MjcsImV4cCI6MjEwMTU2MTgyN30.RNrDixA6B1TgVHqoswkMDSYlwywGYfcC0P7SYY8A_lY';
const PLAN_DESK_EDGE = `${SUPABASE_URL}/functions/v1/blueprint-plan-desk-v1`;
const TOKEN_KEY = 'blueprint.workspace.token';
const PLAN_SESSION_KEY = 'blueprint.plan.desk.session';
const STAFF_ROLES = new Set(['Owner', 'Project manager', 'Site lead']);

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function getPlanSessionToken() {
  return sessionStorage.getItem(PLAN_SESSION_KEY) || '';
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function clearPlanSession() {
  sessionStorage.removeItem(PLAN_SESSION_KEY);
}

export function isStaff(role) {
  return STAFF_ROLES.has(role);
}

function inPlanDesk() {
  return location.pathname.startsWith('/workspace/plan/');
}

function authHeaders(token, json = true) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

function planSessionHeaders(token, json = true) {
  return {
    apikey: ANON_KEY,
    'X-Blueprint-API-Version': '1',
    'X-Blueprint-Client': 'web-plan-desk',
    ...(token ? { 'X-Blueprint-Plan-Session': token } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function responseError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  const edgeMessage = body?.error?.message;
  if (typeof edgeMessage === 'string' && edgeMessage) return edgeMessage;
  if (response.status === 401) return 'Your Blueprint Builds session expired. Sign in again.';
  if (response.status === 403 || body?.code === '42501') return 'This account does not have access to that build record.';
  return body?.message || body?.msg || body?.error_description || fallback;
}

async function planDeskFetch(path, { token = getPlanSessionToken(), body } = {}) {
  const response = await fetch(`${PLAN_DESK_EDGE}${path}`, {
    method: 'POST',
    headers: planSessionHeaders(token),
    body: body === undefined ? '{}' : JSON.stringify(body),
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(await responseError(response, 'Blueprint Plan Desk could not load that record.'));
  if (response.status === 204) return null;
  return response.json();
}

export async function redeemPlanHandoff(code) {
  const payload = await planDeskFetch('/redeem', { token: '', body: { code } });
  const token = payload?.data?.sessionToken;
  const projectId = payload?.data?.projectId;
  const planId = payload?.data?.planId;
  if (typeof token !== 'string' || typeof projectId !== 'string' || typeof planId !== 'string') {
    throw new Error('Blueprint returned an invalid Plan Desk session.');
  }
  sessionStorage.setItem(PLAN_SESSION_KEY, token);
  return { projectId, planId, expiresAt: payload?.data?.expiresAt };
}

export async function revokePlanSession() {
  const token = getPlanSessionToken();
  if (!token) return;
  try { await planDeskFetch('/revoke', { token }); }
  finally { clearPlanSession(); }
}

export async function signIn(email, password) {
  clearPlanSession();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (!response.ok) throw new Error(await responseError(response, 'Check the email and password and try again.'));
  const payload = await response.json();
  if (!payload?.access_token) throw new Error('Blueprint Builds did not return a usable session.');
  sessionStorage.setItem(TOKEN_KEY, payload.access_token);
  return payload.access_token;
}

export async function rpc(name, params = {}, token) {
  const planToken = inPlanDesk() ? getPlanSessionToken() : '';
  if (planToken) {
    const payload = await planDeskFetch('/call', { token: planToken, body: { name, params } });
    return payload?.data;
  }
  const accessToken = token || getToken();
  if (!accessToken) throw new Error('Sign in is required.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(await responseError(response, 'Blueprint Builds could not load that record.'));
  return response.json();
}

export async function loadSession(token) {
  return rpc('blueprint_mobile_session', {}, token);
}

export async function syncOfflinePlanMarkup(params) {
  if (getPlanSessionToken()) {
    const payload = await planDeskFetch('/offline/sync', { body: params });
    return payload?.data;
  }
  return rpc('blueprint_mobile_sync_offline_plan_markup', params);
}

export async function loadOfflineMarkupReceipts(planId) {
  if (getPlanSessionToken()) {
    const payload = await planDeskFetch('/offline/receipts', { body: {} });
    return Array.isArray(payload?.data) ? payload.data : [];
  }
  const payload = await rpc('blueprint_mobile_offline_markup_receipts', { p_plan_id: planId });
  return Array.isArray(payload) ? payload : [];
}

export async function registerPdfPageCount(planId, pageCount) {
  const count = Number(pageCount);
  if (!Number.isInteger(count) || count < 1 || count > 999) throw new Error('Blueprint could not verify the PDF page count.');
  if (getPlanSessionToken()) {
    const payload = await planDeskFetch('/pdf/register-pages', { body: { pageCount: count } });
    return payload?.data;
  }
  return rpc('blueprint_mobile_register_plan_page_count', { p_plan_id: planId, p_page_count: count });
}

export async function signPlanPaths(paths, token) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const planToken = inPlanDesk() ? getPlanSessionToken() : '';
  let payload;
  if (planToken) {
    const wrapped = await planDeskFetch('/media/sign', { token: planToken, body: { paths: unique } });
    payload = wrapped?.data;
  } else {
    const accessToken = token || getToken();
    if (!accessToken) throw new Error('Sign in is required.');
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/plans`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ expiresIn: 900, paths: unique }),
    });
    if (!response.ok) throw new Error(await responseError(response, 'The secure plan view could not be prepared.'));
    payload = await response.json();
  }

  const result = {};
  for (const entry of Array.isArray(payload) ? payload : []) {
    if (!entry?.error && typeof entry?.path === 'string' && typeof entry?.signedURL === 'string' && unique.includes(entry.path)) {
      if (/^https:\/\//i.test(entry.signedURL)) result[entry.path] = entry.signedURL;
      else {
        const slash = entry.signedURL.startsWith('/') ? '' : '/';
        result[entry.path] = `${SUPABASE_URL}/storage/v1${slash}${entry.signedURL}`;
      }
    }
  }
  return result;
}

export function planDeskUrl(projectId, planId) {
  const query = new URLSearchParams({ project: projectId, plan: planId });
  return `/workspace/plan/?${query.toString()}`;
}

export function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString('en-AU');
}
