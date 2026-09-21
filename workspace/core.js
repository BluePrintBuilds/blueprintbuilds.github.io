const SUPABASE_URL = 'https://mxjuknqwzbvvmmdrvkql.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_NuXysCFLmpv66WEOx0YFQg__GTwZz4K';
const PLAN_DESK_EDGE = `${SUPABASE_URL}/functions/v1/blueprint-plan-desk-v1`;
const TOKEN_KEY = 'blueprint.workspace.token';
const SESSION_KEY = 'blueprint.workspace.session.v1';
const PLAN_SESSION_KEY = 'blueprint.plan.desk.session';
const STAFF_ROLES = new Set(['Owner', 'Project manager', 'Site lead']);
let refreshPromise = null;

function browserStorage(name) {
  try { return globalThis[name] || null; } catch { return null; }
}

function epochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normaliseSession(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : '';
  if (!accessToken) return null;
  const seconds = Number(payload.expires_in);
  const expiresAt = Number(payload.expires_at) || (Number.isFinite(seconds) && seconds > 0 ? epochSeconds() + seconds : 0);
  return { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt };
}

function readSession() {
  for (const target of [browserStorage('localStorage'), browserStorage('sessionStorage')]) {
    if (!target) continue;
    try {
      const session = normaliseSession(JSON.parse(target.getItem(SESSION_KEY) || 'null'));
      if (session) return session;
    } catch { /* ignore unreadable browser storage */ }
  }
  const legacy = browserStorage('sessionStorage')?.getItem(TOKEN_KEY)
    || browserStorage('localStorage')?.getItem(TOKEN_KEY)
    || '';
  if (!legacy) return null;
  const migrated = { access_token: legacy, refresh_token: '', expires_at: 0 };
  persistSession(migrated);
  return migrated;
}

function persistSession(payload) {
  const session = normaliseSession(payload);
  if (!session) return null;
  const target = browserStorage('localStorage') || browserStorage('sessionStorage');
  try { target?.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* memory session still works */ }
  for (const store of [browserStorage('localStorage'), browserStorage('sessionStorage')]) {
    try { store?.removeItem(TOKEN_KEY); } catch { /* best effort legacy cleanup */ }
  }
  return session;
}

export function getToken() {
  return readSession()?.access_token || '';
}

export async function getValidToken({ forceRefresh = false } = {}) {
  return refreshSession(forceRefresh);
}

export function getPlanSessionToken() {
  return browserStorage('sessionStorage')?.getItem(PLAN_SESSION_KEY) || '';
}

export function clearToken() {
  for (const store of [browserStorage('localStorage'), browserStorage('sessionStorage')]) {
    try {
      store?.removeItem(SESSION_KEY);
      store?.removeItem(TOKEN_KEY);
    } catch { /* best effort */ }
  }
}

export function clearPlanSession() {
  browserStorage('sessionStorage')?.removeItem(PLAN_SESSION_KEY);
}

export function isStaff(role) {
  return STAFF_ROLES.has(role);
}

function inPlanDesk() {
  return location.pathname.startsWith('/workspace/plan/');
}

function authHeaders(token, json = true) {
  return {
    apikey: PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

function planSessionHeaders(token, json = true) {
  return {
    apikey: PUBLISHABLE_KEY,
    'X-Blueprint-API-Version': '1',
    'X-Blueprint-Client': 'web-plan-desk',
    ...(token ? { 'X-Blueprint-Plan-Session': token } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function responseError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  const configurationError = [body?.message, body?.msg, body?.error_description]
    .some(value => typeof value === 'string' && /invalid api key/i.test(value));
  if (configurationError) return 'Blueprint sign-in configuration needs attention. Your password has not been checked.';
  const edgeMessage = body?.error?.message;
  if (typeof edgeMessage === 'string' && edgeMessage) return edgeMessage;
  if (response.status === 401) return 'Your Blueprint Builds session expired. Sign in again.';
  if (response.status === 403 || body?.code === '42501') return 'This account does not have access to that build record.';
  return body?.message || body?.msg || body?.error_description || fallback;
}

async function responseFailure(response, fallback) {
  const message = await responseError(response, fallback);
  return Object.assign(new Error(message), {
    status: response.status,
    configurationFailure: message.includes('sign-in configuration needs attention'),
  });
}

async function refreshSession(force = false) {
  const session = readSession();
  if (!session?.access_token) return '';
  if (!force && (!session.expires_at || session.expires_at - epochSeconds() > 90)) return session.access_token;
  if (!session.refresh_token) return session.access_token;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) {
        const failure = await responseFailure(response, 'Your Blueprint Builds session could not be renewed.');
        if ([400, 401, 403].includes(response.status)) clearToken();
        throw failure;
      }
      const saved = persistSession(await response.json());
      if (!saved) {
        clearToken();
        throw new Error('Blueprint Builds returned an unusable refreshed session.');
      }
      return saved.access_token;
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function planDeskFetch(path, { token = getPlanSessionToken(), body } = {}) {
  const response = await fetch(`${PLAN_DESK_EDGE}${path}`, {
    method: 'POST',
    headers: planSessionHeaders(token),
    body: body === undefined ? '{}' : JSON.stringify(body),
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw await responseFailure(response, 'Blueprint Plan Desk could not load that record.');
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
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (!response.ok) throw await responseFailure(response, 'Check the email and password and try again.');
  const saved = persistSession(await response.json());
  if (!saved) throw new Error('Blueprint Builds did not return a usable session.');
  return saved.access_token;
}

export async function rpc(name, params = {}, token, options = {}) {
  const planToken = inPlanDesk() ? getPlanSessionToken() : '';
  if (planToken) {
    const payload = await planDeskFetch('/call', { token: planToken, body: { name, params } });
    return payload?.data;
  }
  let accessToken = token || await getValidToken();
  if (!accessToken) throw Object.assign(new Error('Sign in is required.'), { status: 401 });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 15000);
  try {
    const request = (credential) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: authHeaders(credential), body: JSON.stringify(params), signal: controller.signal,
      cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    let response = await request(accessToken);
    if (response.status === 401 && !token) {
      accessToken = await getValidToken({ forceRefresh: true });
      if (accessToken) response = await request(accessToken);
    }
    if (!response.ok) throw await responseFailure(response, 'Blueprint Builds could not load that record.');
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw Object.assign(new Error('The connection took too long. Reconnect and try again.'), { status: 408 });
    throw error;
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
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
    let accessToken = token || await getValidToken();
    if (!accessToken) throw Object.assign(new Error('Sign in is required.'), { status: 401 });
    const request = (credential) => fetch(`${SUPABASE_URL}/storage/v1/object/sign/plans`, {
      method: 'POST',
      headers: authHeaders(credential),
      body: JSON.stringify({ expiresIn: 900, paths: unique }),
    });
    let response = await request(accessToken);
    if (response.status === 401 && !token) {
      accessToken = await getValidToken({ forceRefresh: true });
      if (accessToken) response = await request(accessToken);
    }
    if (!response.ok) throw await responseFailure(response, 'The secure plan view could not be prepared.');
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
