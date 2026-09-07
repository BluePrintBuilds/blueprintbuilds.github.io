import { planDeskUrl, redeemPlanHandoff } from '../core.js';

const status = document.getElementById('handoff-status');
const recovery = document.getElementById('handoff-recovery');

function fail(message) {
  status.className = 'status err';
  status.textContent = message;
  recovery.hidden = false;
}

async function boot() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const code = new URLSearchParams(hash).get('code') || '';
  // Remove the one-use secret from browser history before the network exchange.
  history.replaceState(null, '', '/workspace/handoff/');
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(code)) {
    fail('This Plan Desk handoff link is incomplete.');
    return;
  }
  try {
    const scope = await redeemPlanHandoff(code);
    status.textContent = 'Verified. Opening the exact drawing…';
    location.replace(planDeskUrl(scope.projectId, scope.planId));
  } catch (reason) {
    fail(reason?.message || 'Blueprint could not verify this Plan Desk handoff.');
  }
}

void boot();
