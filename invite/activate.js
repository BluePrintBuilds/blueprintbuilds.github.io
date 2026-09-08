const SUPABASE_URL = 'https://mxjuknqwzbvvmmdrvkql.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14anVrbnF3emJ2dm1tZHJ2a3FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5ODU4MjcsImV4cCI6MjEwMTU2MTgyN30.RNrDixA6B1TgVHqoswkMDSYlwywGYfcC0P7SYY8A_lY';

const ROLE_PROFILE = {
  Owner: {
    accent: '#F3C969', rgb: '243,201,105', eyebrow: 'OWNER ACCESS', title: 'Take the controls.',
    copy: 'Full workspace authority has been issued to this account.',
    unlocks: ['Workspace control', 'People + permissions', 'Projects, plans, costs + decisions', 'Verified build record'],
  },
  'Project manager': {
    accent: '#66D8FF', rgb: '102,216,255', eyebrow: 'PROJECT MANAGER ACCESS', title: 'Run the build.',
    copy: 'Your project-control desk is ready.',
    unlocks: ['Run projects + milestones', 'Publish plans + costs', 'Manage decisions', 'Verified project evidence'],
  },
  'Site lead': {
    accent: '#78E3AC', rgb: '120,227,172', eyebrow: 'SITE LEAD ACCESS', title: 'Own the site record.',
    copy: 'Field capture and drawing access have been issued to this account.',
    unlocks: ['Capture site evidence', 'Open + mark up plans', 'Track milestones', 'Keep the field record provable'],
  },
  Client: {
    accent: '#9AAEFF', rgb: '154,174,255', eyebrow: 'PRIVATE CLIENT ACCESS', title: 'See the build clearly.',
    copy: 'A private, read-only window into your build is ready.',
    unlocks: ['Progress + milestones', 'Plans + verified markups', 'Decisions + approvals', 'Read-only project truth'],
  },
};

const $ = (id) => document.getElementById(id);
const panels = ['panel-wait', 'panel-gate', 'panel-expired', 'panel-form', 'panel-done'];
let accessToken = '';
let account = null;
let continuationLink = '';

function show(id) {
  for (const name of panels) $(name)?.classList.toggle('hidden', name !== id);
}

function status(kind, text) {
  const node = $('form-status');
  node.className = `status show ${kind}`;
  node.textContent = text;
}

function safeRole(value) {
  return Object.prototype.hasOwnProperty.call(ROLE_PROFILE, value) ? value : 'Client';
}

function decodeContinuation(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return '';
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const link = new TextDecoder().decode(bytes);
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.hostname !== 'mxjuknqwzbvvmmdrvkql.supabase.co' || url.pathname !== '/auth/v1/verify') return '';
    const token = url.searchParams.get('token') || '';
    const type = url.searchParams.get('type') || '';
    const redirectValue = url.searchParams.get('redirect_to') || '';
    if (!token || !['invite', 'recovery'].includes(type) || !redirectValue) return '';
    const redirect = new URL(redirectValue);
    const allowedRedirects = new Set([
      new URL('/invite/', location.origin).toString(),
      'https://blueprintbuilds.app/invite/',
    ]);
    if (!allowedRedirects.has(redirect.toString())) return '';
    return url.toString();
  } catch { return ''; }
}

function applyProfile(user) {
  const meta = user?.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  const role = safeRole(meta.blueprint_invite_role);
  const profile = ROLE_PROFILE[role];
  document.documentElement.style.setProperty('--accent', profile.accent);
  document.documentElement.style.setProperty('--accent-rgb', profile.rgb);
  $('role-eyebrow').textContent = profile.eyebrow;
  $('hero-title').textContent = profile.title;
  $('hero-copy').textContent = profile.copy;
  $('pass-email').textContent = user?.email || 'Verified account';
  $('pass-role').textContent = role;
  $('pass-workspace').textContent = typeof meta.blueprint_invite_workspace === 'string' && meta.blueprint_invite_workspace ? meta.blueprint_invite_workspace : 'Blueprint workspace';
  $('pass-inviter').textContent = typeof meta.blueprint_invited_by === 'string' && meta.blueprint_invited_by ? meta.blueprint_invited_by : 'Blueprint Builds';
  $('unlock-grid').replaceChildren(...profile.unlocks.map((item) => {
    const node = document.createElement('div');
    node.className = 'unlock-item';
    node.textContent = item;
    return node;
  }));
  $('who').textContent = `Verified as ${user?.email || 'this account'} · ${role} access.`;
  return { role, meta };
}

async function fetchAccount() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
    cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('activation_session_invalid');
  return response.json();
}

async function savePassword(password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }), cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body?.msg || body?.message || body?.error_description || 'password_update_failed');
    error.status = response.status;
    throw error;
  }
}

async function recordAcceptance() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/blueprint_mobile_accept_invite`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}', cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('acceptance_audit_failed');
  return response.json().catch(() => ({}));
}

async function boot() {
  const fragment = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  if (fragment.get('error') || fragment.get('error_code')) { show('panel-expired'); return; }

  const encodedContinuation = fragment.get('continue') || '';
  continuationLink = decodeContinuation(encodedContinuation);
  if (encodedContinuation && !continuationLink) {
    try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* cosmetic */ }
    show('panel-expired');
    return;
  }
  if (continuationLink) {
    // Fragments never reach the web server. Scrub the encoded auth target from
    // local browser history too; keep it only in memory until the human clicks.
    try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* cosmetic */ }
    show('panel-gate');
    return;
  }

  accessToken = fragment.get('access_token') || '';
  if (!accessToken) { show('panel-wait'); return; }

  // Remove auth credentials from browser history before any user interaction.
  try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* cosmetic */ }

  try {
    account = await fetchAccount();
    const { meta } = applyProfile(account);
    const invitationExpiry = Date.parse(typeof meta.blueprint_invite_expires_at === 'string' ? meta.blueprint_invite_expires_at : '');
    if (Number.isFinite(invitationExpiry) && Date.now() > invitationExpiry) { show('panel-expired'); return; }
    show('panel-form');
  } catch {
    show('panel-expired');
  }
}

$('continue').addEventListener('click', () => {
  if (!continuationLink) { show('panel-expired'); return; }
  location.assign(continuationLink);
});

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('password').value;
  const confirm = $('confirm').value;
  if (password.length < 8) { status('err', 'Use at least 8 characters.'); return; }
  if (password !== confirm) { status('err', 'The two passwords do not match.'); return; }

  const button = $('submit');
  button.disabled = true;
  status('busy', 'Activating your Blueprint access…');
  try {
    await savePassword(password);
    let auditRecorded = true;
    try { await recordAcceptance(); } catch { auditRecorded = false; }
    $('done-copy').textContent = `Your Blueprint account is ready. Sign in as ${account?.email || 'the email on this pass'} with the password you just created.${auditRecorded ? '' : ' Your access is active; Blueprint will reconcile the activation record when you next sign in.'}`;
    show('panel-done');
  } catch (reason) {
    if (reason?.status === 401 || reason?.status === 403) show('panel-expired');
    else {
      status('err', reason?.message && reason.message !== 'password_update_failed' ? reason.message : 'The password could not be saved. Check your connection and try again.');
      button.disabled = false;
    }
  }
});

void boot();
