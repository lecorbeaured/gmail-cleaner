// app.js — Gmail Cleaner Dashboard
// ─────────────────────────────────────────────────────────────
// UPDATE THIS LINE with your Railway URL before deploying:
const API_BASE = 'https://gmail-cleaner-backend-production.up.railway.app';
// ─────────────────────────────────────────────────────────────

// ============================================
// UTILITIES
// ============================================

function formatSize(kb) {
  if (!kb || kb === 0) return '0 KB';
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeUntil(targetHour, dayOfWeek = null) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(targetHour, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  if (dayOfWeek !== null) {
    while (next.getUTCDay() !== dayOfWeek) next.setUTCDate(next.getUTCDate() + 1);
  }
  const diffMs = next - now;
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

// ============================================
// LOGGING
// ============================================

const logBody = document.getElementById('logBody');

function log(msg, type = 'info') {
  const now = new Date().toLocaleTimeString('en-US', { hour12: false });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${now}</span>
    <span class="log-msg ${type}">${msg}</span>
  `;
  logBody.prepend(entry);
  // Keep max 100 entries
  while (logBody.children.length > 100) logBody.removeChild(logBody.lastChild);
}

// ============================================
// API CALLS
// ============================================

async function apiFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ============================================
// AUTH STATUS
// ============================================

async function checkAuth() {
  const dot = document.getElementById('authDot');
  const label = document.getElementById('authLabel');

  // Show config banner if API_BASE not set
  if (API_BASE.includes('YOUR_RAILWAY_URL')) {
    document.getElementById('configBanner').classList.add('visible');
    dot.className = 'status-dot error';
    label.textContent = 'NOT CONFIGURED';
    log('API URL not set — open app.js and update API_BASE', 'error');
    return;
  }

  try {
    const data = await apiFetch('/auth/status');
    if (data.authenticated) {
      dot.className = 'status-dot connected';
      label.textContent = 'CONNECTED';
      log('Gmail connection verified', 'success');
    } else {
      dot.className = 'status-dot error';
      label.textContent = 'NOT AUTH';
      log('Not authenticated — visit ' + API_BASE + '/auth/login', 'warn');
    }
  } catch (err) {
    dot.className = 'status-dot error';
    label.textContent = 'OFFLINE';
    log('Cannot reach backend: ' + err.message, 'error');
  }
}

// ============================================
// STATS + HISTORY
// ============================================

let sessionTotals = { trashed: 0, sizeKB: 0, unsubs: 0, runs: 0 };

function animateValue(el, value, formatter = v => v) {
  const current = parseInt(el.dataset.current || '0');
  const target = parseInt(value) || 0;
  const duration = 600;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const cur = Math.round(current + (target - current) * ease);
    el.textContent = formatter(cur);
    if (progress < 1) requestAnimationFrame(step);
    else el.dataset.current = target;
  }
  requestAnimationFrame(step);
}

function updateStats() {
  animateValue(document.getElementById('statTrashed'), sessionTotals.trashed, v => v.toLocaleString());
  animateValue(document.getElementById('statFreed'), sessionTotals.sizeKB, v => formatSize(v));
  animateValue(document.getElementById('statUnsubs'), sessionTotals.unsubs, v => v.toLocaleString());
  animateValue(document.getElementById('statRuns'), sessionTotals.runs, v => v.toLocaleString());

  // Animate bars
  setTimeout(() => {
    document.getElementById('barTrashed').style.width = Math.min((sessionTotals.trashed / 1000) * 100, 100) + '%';
    document.getElementById('barFreed').style.width = Math.min((sessionTotals.sizeKB / 102400) * 100, 100) + '%';
    document.getElementById('barUnsubs').style.width = Math.min((sessionTotals.unsubs / 50) * 100, 100) + '%';
    document.getElementById('barRuns').style.width = Math.min((sessionTotals.runs / 30) * 100, 100) + '%';
  }, 100);
}

async function loadHistory() {
  try {
    const data = await apiFetch('/clean/history');
    renderHistory(data.history || []);

    // Accumulate totals from all runs
    if (data.history && data.history.length > 0) {
      sessionTotals.trashed = data.history.reduce((s, r) => s + (r.totals?.trashed || 0), 0);
      sessionTotals.sizeKB = data.history.reduce((s, r) => s + (r.totals?.estimatedSizeKB || 0), 0);
      sessionTotals.unsubs = data.history.reduce((s, r) => s + (r.totals?.unsubscribed || 0), 0);
      sessionTotals.runs = data.history.length;
      updateStats();
    }
  } catch (err) {
    log('History load failed: ' + err.message, 'error');
  }
}

function renderHistory(runs) {
  const list = document.getElementById('historyList');
  if (!runs || runs.length === 0) {
    list.innerHTML = '<div class="history-empty">No runs yet. Hit RUN CLEAN to start.</div>';
    return;
  }

  list.innerHTML = runs.slice(0, 20).map(r => `
    <div class="history-item">
      <span class="hi-icon">${r.success ? '✅' : '❌'}</span>
      <div class="hi-info">
        <div class="hi-date">${formatDate(r.startedAt)}</div>
        <div class="hi-stats">
          ${(r.totals?.trashed || 0).toLocaleString()} trashed ·
          ${formatSize(r.totals?.estimatedSizeKB || 0)} freed ·
          ${r.totals?.unsubscribed || 0} unsubs ·
          ${formatDuration(r.durationMs)}
        </div>
      </div>
      <span class="hi-trigger">${(r.trigger || 'manual').toUpperCase()}</span>
    </div>
  `).join('');
}

async function loadLastRun() {
  try {
    const data = await apiFetch('/clean/last');
    if (data.message) return; // no runs yet
    renderLastRun(data);
  } catch {}
}

function renderLastRun(stats) {
  document.getElementById('lastRunTime').textContent = formatDate(stats.startedAt);

  const detail = document.getElementById('lastRunDetail');
  if (!stats.totals) {
    detail.innerHTML = '<div class="detail-empty">No data</div>';
    return;
  }

  const rows = [
    ['Status', stats.success ? '<span class="dr-val green">SUCCESS</span>' : '<span class="dr-val red">FAILED</span>'],
    ['Trashed', `<span class="dr-val green">${(stats.totals.trashed || 0).toLocaleString()}</span>`],
    ['Freed', `<span class="dr-val green">${formatSize(stats.totals.estimatedSizeKB || 0)}</span>`],
    ['Unsubscribed', `<span class="dr-val green">${stats.totals.unsubscribed || 0}</span>`],
    ['Duration', `<span class="dr-val">${formatDuration(stats.durationMs)}</span>`],
    ['Trigger', `<span class="dr-val">${stats.trigger || 'manual'}</span>`],
  ];

  const catHTML = stats.categories && stats.categories.length > 0 ? `
    <div class="detail-categories">
      <div class="dc-title">BY CATEGORY</div>
      ${stats.categories.map(c => `
        <div class="dc-item">
          <span class="dc-cat">${c.category}</span>
          <span class="dc-count">${c.trashed.toLocaleString()} · ~${formatSize(c.estimatedSizeKB)}</span>
        </div>
      `).join('')}
      ${stats.oldEmails ? `
        <div class="dc-item">
          <span class="dc-cat">old (${stats.oldEmails.olderThanDays}d+)</span>
          <span class="dc-count">${stats.oldEmails.trashed.toLocaleString()} · ~${formatSize(stats.oldEmails.estimatedSizeKB)}</span>
        </div>
      ` : ''}
    </div>
  ` : '';

  detail.innerHTML = `
    ${rows.map(([label, val]) => `
      <div class="detail-row">
        <span class="dr-label">${label}</span>
        ${val}
      </div>
    `).join('')}
    ${catHTML}
  `;
}

// ============================================
// PREVIEW
// ============================================

async function runPreview() {
  const previewEl = document.getElementById('previewResult');
  previewEl.classList.remove('visible');
  previewEl.innerHTML = '';
  log('Fetching preview...', 'info');

  try {
    const data = await apiFetch('/clean/preview');
    const lines = (data.preview || []).map(p => `
      <div class="preview-line">
        <span class="pl-label">${p.type}</span>
        <span class="pl-val">~${(p.count || 0).toLocaleString()}</span>
      </div>
    `).join('');

    previewEl.innerHTML = `
      ${lines}
      <div class="preview-total">
        <span class="pt-label">TOTAL WOULD TRASH</span>
        <span class="pt-val">~${(data.totalWouldTrash || 0).toLocaleString()}</span>
      </div>
    `;
    previewEl.classList.add('visible');
    log(`Preview: ~${(data.totalWouldTrash || 0).toLocaleString()} emails would be trashed`, 'success');
  } catch (err) {
    log('Preview failed: ' + err.message, 'error');
  }
}

// ============================================
// RUN CLEAN
// ============================================

const overlay = document.getElementById('runOverlay');
const runStatus = document.getElementById('runStatus');
const runProgress = document.getElementById('runProgress');

function showOverlay(msg) {
  runStatus.textContent = msg;
  runProgress.style.width = '0%';
  overlay.classList.add('visible');
}
function updateOverlay(msg, pct) {
  runStatus.textContent = msg;
  runProgress.style.width = pct + '%';
}
function hideOverlay() {
  overlay.classList.remove('visible');
}

async function runClean() {
  const categories = Array.from(document.querySelectorAll('.checkbox-row input[type="checkbox"]:checked'))
    .map(cb => cb.value)
    .filter(v => ['promotions','social','updates','forums'].includes(v));

  const olderThanDays = parseInt(document.getElementById('daysRange').value);
  const autoUnsubscribe = document.getElementById('chkUnsub').checked;

  log('Starting clean run...', 'info');
  showOverlay('Connecting to Gmail...');
  document.getElementById('btnClean').disabled = true;

  // Simulate progress steps while API runs
  const steps = [
    [10, 'Scanning promotions...'],
    [30, 'Scanning categories...'],
    [50, 'Processing old emails...'],
    [70, 'Running unsubscribes...'],
    [90, 'Finalizing...'],
  ];
  let stepIdx = 0;
  const stepTimer = setInterval(() => {
    if (stepIdx < steps.length) {
      const [pct, msg] = steps[stepIdx++];
      updateOverlay(msg, pct);
    }
  }, 2500);

  try {
    const stats = await apiFetch('/clean/run', 'POST', {
      categories,
      olderThanDays,
      autoUnsubscribe,
    });

    clearInterval(stepTimer);
    updateOverlay('Complete!', 100);

    setTimeout(() => {
      hideOverlay();

      // Update session totals
      sessionTotals.trashed += stats.totals?.trashed || 0;
      sessionTotals.sizeKB += stats.totals?.estimatedSizeKB || 0;
      sessionTotals.unsubs += stats.totals?.unsubscribed || 0;
      sessionTotals.runs += 1;
      updateStats();

      renderLastRun(stats);
      document.getElementById('lastRunTime').textContent = formatDate(stats.startedAt);

      log(
        `✓ Clean complete — ${(stats.totals?.trashed || 0).toLocaleString()} trashed · ${formatSize(stats.totals?.estimatedSizeKB || 0)} freed · ${stats.totals?.unsubscribed || 0} unsubs`,
        'success'
      );

      loadHistory();
    }, 600);

  } catch (err) {
    clearInterval(stepTimer);
    hideOverlay();
    log('Clean failed: ' + err.message, 'error');
  } finally {
    document.getElementById('btnClean').disabled = false;
  }
}

// ============================================
// CLOCK + SCHEDULE
// ============================================

function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toUTCString().replace('GMT', 'UTC').split(' ').slice(1, 6).join(' ');
}

function updateSchedule() {
  document.getElementById('schedNext1').textContent = timeUntil(2);
  document.getElementById('schedNext2').textContent = timeUntil(3, 0); // Sunday
}

// ============================================
// EVENT LISTENERS
// ============================================

document.getElementById('daysRange').addEventListener('input', function () {
  document.getElementById('daysVal').textContent = this.value;
});

document.getElementById('btnPreview').addEventListener('click', runPreview);
document.getElementById('btnClean').addEventListener('click', runClean);

document.getElementById('btnRefresh').addEventListener('click', () => {
  log('Refreshing history...', 'info');
  loadHistory();
  loadLastRun();
});

document.getElementById('btnClearLog').addEventListener('click', () => {
  logBody.innerHTML = '';
});

// ============================================
// INIT
// ============================================

async function init() {
  log('Dashboard initializing...', 'info');
  updateClock();
  updateSchedule();
  setInterval(updateClock, 1000);
  setInterval(updateSchedule, 60000);

  await checkAuth();
  await Promise.all([loadHistory(), loadLastRun()]);
  log('Dashboard ready', 'success');
}

init();