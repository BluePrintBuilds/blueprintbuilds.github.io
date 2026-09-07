const SUPABASE_URL = 'https://mxjuknqwzbvvmmdrvkql.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJteGp1a253d3pidnZtbWRydmtxbCIsInJlZiI6Im14anVrbnF3emJ2dm1tZHJ2a3FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5ODU4MjcsImV4cCI6MjEwMTU2MTgyN30.RNrDixA6B1TgVHqoswkMDSYlwywGYfcC0P7SYY8A_lY';
const TOKEN_KEY = 'blueprint.workspace.token';
const STAFF_ROLES = new Set(['Owner', 'Project manager', 'Site lead']);

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function isStaff(role) {
  return STAFF_ROLES.has(role);
}

function authHeaders(token, json = true) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function errorMessage(response, fallback) {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) return 'Your Blueprint Builds session expired. Sign in again.';
  if (response.status === 403 || body?.code === '42501') return 'This account does not have access to that build record.';
  return body?.message || body?.msg || body?.error_description || fallback;
}

export async function signIn(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Check the email and password and try again.'));
  const payload = await response.json();
  if (!payload?.access_token) throw new Error('Blueprint Builds did not return a usable session.');
  sessionStorage.setItem(TOKEN_KEY, payload.access_token);
  return payload.access_token;
}

export async function rpc(name, params = {}, token = getToken()) {
  if (!token) throw new Error('Sign in is required.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Blueprint Builds could not load that record.'));
  return response.json();
}

export async function loadSession(token = getToken()) {
  return rpc('blueprint_mobile_session', {}, token);
}

export async function signPlanPaths(paths, token = getToken()) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/plans`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ expiresIn: 900, paths: unique }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'The secure plan view could not be prepared.'));
  const payload = await response.json();
  const result = {};
  for (const entry of Array.isArray(payload) ? payload : []) {
    if (!entry?.error && typeof entry?.path === 'string' && typeof entry?.signedURL === 'string') {
      const slash = entry.signedURL.startsWith('/') ? '' : '/';
      result[entry.path] = `${SUPABASE_URL}/storage/v1${slash}${entry.signedURL}`;
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
