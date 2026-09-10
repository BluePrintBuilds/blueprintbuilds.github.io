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
const panels = ['panel-wait', 'panel-gate', 'panel-checking', 'panel-network', 'panel-expired', 'panel-form', 'panel-done'];
let accessToken = '';
let account = null;
let continuationLink = '';
let activationType = 'invite';
let verifying = false;
let submitting = false;

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
  const reviewer = role === 'Site lead' && meta.blueprint_client_preview === true;
  const profile = reviewer ? {
    ...ROLE_PROFILE[role],
    eyebrow: 'SPECIAL REVIEW ACCESS',
    title: 'See both sides of the build.',
    copy: 'Your Site Lead access includes a controlled Client View Preview for product review.',
    unlocks: ['Build Team View', 'Client View Preview', 'Field capture + plans', 'One authoritative project record'],
  } : ROLE_PROFILE[role];
  document.documentElement.style.setProperty('--accent', profile.accent);
  document.documentElement.style.setProperty('--accent-rgb', profile.rgb);
  $('role-eyebrow').textContent = profile.eyebrow;
  $('hero-title').textContent = profile.title;
  $('hero-copy').textContent = profile.copy;
  $('pass-state').textContent = 'IDENTITY VERIFIED';
  $('pass-email').textContent = user?.email || 'Verified account';
  $('pass-role').textContent = reviewer ? 'Site Lead + Client View Preview' : role;
  $('pass-workspace').textContent = typeof meta.blueprint_invite_workspace === 'string' && meta.blueprint_invite_workspace ? meta.blueprint_invite_workspace : 'Blueprint workspace';
  $('pass-inviter').textContent = typeof meta.blueprint_invited_by === 'string' && meta.blueprint_invited_by ? meta.blueprint_invited_by : 'Blueprint Builds';
  $('unlock-grid').replaceChildren(...profile.unlocks.map((item) => {
    const node = document.createElement('div');
    node.className = 'unlock-item';
    node.textContent = item;
    return node;
  }));
  $('who').textContent = `Verified as ${user?.email || 'this account'} · ${reviewer ? 'special review access' : `${role} access`}.`;
  return { role, meta, reviewer };
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      ...options, signal: controller.signal, cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.msg || body?.message || body?.error_description || 'request_failed');
      error.status = response.status;
      throw error;
    }
    return body;
  } finally { clearTimeout(timeout); }
}

async function fetchAccount() {
  const user = await requestJson(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!user?.email) throw new Error('verification_unavailable');
  return user;
}

async function savePassword(password) {
  await requestJson(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

async function recordAcceptance() {
  return requestJson(`${SUPABASE_URL}/rest/v1/rpc/blueprint_mobile_accept_invite`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function closeLink() {
  accessToken = '';
  continuationLink = '';
  $('password').value = '';
  $('confirm').value = '';
  $('pass-state').textContent = 'LINK CLOSED';
  show('panel-expired');
}

async function verifyAccount() {
  if (verifying || !accessToken) return;
  verifying = true;
  $('retry-verification').disabled = true;
  $('pass-state').textContent = 'CHECKING IDENTITY';
  show('panel-checking');
  try {
    account = await fetchAccount();
    const { meta } = applyProfile(account);
    if (activationType === 'recovery') {
      $('role-eyebrow').textContent = 'SECURE RECOVERY';
      $('hero-title').textContent = 'Choose a new password.';
      $('hero-copy').textContent = 'Your verified Blueprint account is ready for a password reset.';
      $('who').textContent = `Verified as ${account.email}. Choose your new password.`;
      $('form-title').textContent = 'Reset your password.';
      $('submit').textContent = 'SAVE NEW PASSWORD →';
    }
    const invitationExpiry = Date.parse(typeof meta.blueprint_invite_expires_at === 'string' ? meta.blueprint_invite_expires_at : '');
    if (activationType === 'invite' && Number.isFinite(invitationExpiry) && Date.now() > invitationExpiry) {
      closeLink();
      return;
    }
    show('panel-form');
  } catch (reason) {
    if (reason?.status === 401 || reason?.status === 403) closeLink();
    else {
      $('pass-state').textContent = 'VERIFICATION PAUSED';
      show('panel-network');
    }
  } finally {
    verifying = false;
    $('retry-verification').disabled = false;
  }
}

async function boot() {
  const fragment = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  // Auth fragments, including failed verification responses, stay out of history.
  // Keep usable credentials only in memory; retry does not reload or store them.
  if (location.hash) {
    try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* cosmetic */ }
  }
  if (fragment.get('error') || fragment.get('error_code')) { closeLink(); return; }

  const encodedContinuation = fragment.get('continue') || '';
  continuationLink = decodeContinuation(encodedContinuation);
  if (encodedContinuation && !continuationLink) { closeLink(); return; }
  if (continuationLink) {
    $('pass-state').textContent = 'AWAITING VERIFICATION';
    show('panel-gate');
    return;
  }

  accessToken = fragment.get('access_token') || '';
  activationType = fragment.get('type') === 'recovery' ? 'recovery' : 'invite';
  if (!accessToken) { show('panel-wait'); return; }
  await verifyAccount();
}

$('continue').addEventListener('click', () => {
  if (!continuationLink) { closeLink(); return; }
  location.assign(continuationLink);
});
$('retry-verification').addEventListener('click', () => { void verifyAccount(); });

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting || !accessToken || !account) return;
  const password = $('password').value;
  const confirm = $('confirm').value;
  if (password.length < 8) { status('err', 'Use at least 8 characters.'); return; }
  if (password !== confirm) { status('err', 'The two passwords do not match.'); return; }

  const button = $('submit');
  submitting = true;
  button.disabled = true;
  status('busy', activationType === 'recovery' ? 'Saving your new password…' : 'Activating your Blueprint access…');
  try {
    await savePassword(password);
    let auditRecorded = true;
    if (activationType === 'invite') {
      try { await recordAcceptance(); } catch { auditRecorded = false; }
    }
    $('done-title').textContent = activationType === 'recovery' ? 'Password updated.' : 'Access activated.';
    $('done-copy').textContent = activationType === 'recovery'
      ? `Your Blueprint password has been updated. Sign in as ${account.email} with the password you just created.`
      : `Your Blueprint account is ready. Sign in as ${account.email} with the password you just created.${auditRecorded ? '' : ' Your access is active; Blueprint will reconcile the activation record when you next sign in.'}`;
    $('hero-title').textContent = activationType === 'recovery' ? 'Your account is ready again.' : 'Your Blueprint access is ready.';
    $('hero-copy').textContent = 'Open Blueprint Builds and sign in to continue to your workspace.';
    $('password').value = '';
    $('confirm').value = '';
    accessToken = '';
    show('panel-done');
  } catch (reason) {
    if (reason?.status === 401 || reason?.status === 403) closeLink();
    else {
      const message = reason?.status && reason.status < 500 && reason.message !== 'request_failed'
        ? reason.message
        : 'We could not confirm your password was saved. Check your connection, then try again on this page.';
      status('err', message);
      button.disabled = false;
    }
  } finally { submitting = false; }
});

void boot();
