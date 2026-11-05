'use strict';

const $ = (id) => document.getElementById(id);
const fn = (n) => (Number(n) || 0).toLocaleString('vi-VN');
const fb = (n) => {
  n = Number(n) || 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n >= 100 || !n ? 0 : 1) : n) + ' ' + u[i];
};

function renderMcp(state) {
  const m = state.mcp ?? { running: false, tools: [] };
  $('mcpDot').classList.toggle('on', !!m.running);
  $('mcpPort').value = state.mcpPort ?? 6789;
  $('mcpTools').textContent = m.running
    ? `on · ${m.tools.length} tools (${m.tools.join(', ')})`
    : m.error
      ? `unavailable — ${m.error}`
      : 'off';
  $('mcpUrl').textContent = m.url ?? '–';
  const cmd = m.url ? `claude mcp add --transport http agentproxy ${m.url}` : null;
  $('mcpCmd').textContent = cmd ?? '–';
  $('btnCopyMcp').dataset.copy = cmd ?? '';
}

function renderQuota(state) {
  const q = state.quota;
  const el = $('quotaLine');
  if (!q) { el.textContent = ''; return; }
  const left = q.left ?? 0;
  const limit = q.limit ?? 20;
  const mins = Math.round((q.windowMs ?? 1200000) / 60000);
  const next = q.nextResetAt
    ? ` · next free ${new Date(q.nextResetAt).toLocaleTimeString('vi-VN')}`
    : '';
  const usedPercent = Math.round(((limit - left) / limit) * 100);
  el.innerHTML =
    `Proxy resets: <b>${left}/${limit}</b> left (${usedPercent}% used, window ${mins} min, ` +
    `used ${q.used ?? 0}${next}) — total lifetime resets: <b>${q.totalResets ?? 0}</b>`;
}

function checkQuotaAlert(state) {
  const q = state.quota;
  const threshold = Number($('quotaAlertThreshold').value) ?? 80;
  if (threshold === 100 || !q) return; // no alert
  const limit = q.limit ?? 20;
  const left = q.left ?? 0;
  const usedPercent = Math.round(((limit - left) / limit) * 100);
  if (usedPercent >= threshold) {
    $('msg').textContent = `⚠️ Quota alert: ${usedPercent}% used (${limit - left}/${limit} resets)`;
    $('msg').style.color = '#ff6b6b';
  } else if ($('msg').textContent.startsWith('⚠️')) {
    $('msg').textContent = '';
    $('msg').style.color = '';
  }
}

function render(state) {
  $('statusDot').classList.toggle('on', state.running);
  $('btnToggle').textContent = state.running ? 'Disconnect' : 'Connect';
  $('btnToggle').classList.toggle('stop', state.running);
  $('publicIp').textContent = state.publicIp ?? '–';
  $('bindIp').value = state.bindIp ?? '127.0.0.1';
  $('portStart').value = state.portStart ?? 8801;
  $('portCount').value = state.portCount ?? 20;
  $('portEnd').textContent = `${state.portStart}+${state.portCount}`;
  $('rotationStrategy').value = state.rotationStrategy ?? 'manual';
  $('healthCheckInterval').value = state.healthCheckInterval ?? '60000';
  $('quotaAlertThreshold').value = state.quotaAlertThreshold ?? '80';
  renderQuota(state);
  renderMcp(state);
  checkQuotaAlert(state);

  const rows = $('rows');
  if (!state.proxies?.length) {
    rows.innerHTML =
      '<tr><td colspan="10" class="empty">Press <b>Connect</b> to fetch your 20 free proxies.</td></tr>';
    return;
  }
  const q = state.quota;
  const canRotate = state.running && (q ? (q.left ?? 0) > 0 : true);
  rows.innerHTML = state.proxies
    .map((p, i) => {
      const listen = `${state.bindIp}:${p.listen.split(':')[1]}`;
      const revoked = p.revoked
        ? '<span class="tag revoked">REVOKED</span>'
        : '<span class="tag ok">ACTIVE</span>';
      const rot = !canRotate || p.revoked
        ? ''
        : `<button class="copy" data-rotate="${p.itemId}" title="Get a different exit IP (uses 1 reset)">⟳</button>`;
      // Health status
      const health = p.health ?? {};
      const healthStatus = health.status ?? 'unknown';
      const healthEmoji = { healthy: '🟢', warning: '🟡', critical: '🔴', unknown: '⚪' }[healthStatus] ?? '?';
      const healthTitle = health.latency ? ` (${health.latency}ms, ${(health.successRate ?? 0).toFixed(0)}%)` : '';
      return `<tr class="${p.revoked ? 'row-revoked' : ''}">
        <td class="muted">${i + 1}</td>
        <td class="mono">${listen}</td>
        <td>${fmtCountry(p.country)}${p.scheme === 'https' ? ' <span class="tag" title="Encrypted proxy upstream">TLS</span>' : ''}</td>
        <td class="mono">${p.exitHost ?? '?'}</td>
        <td title="${healthTitle}">${healthEmoji}</td>
        <td class="muted">${p.active ?? 0}</td>
        <td class="num muted">${fn(p.usage?.requests)}</td>
        <td class="num muted">${fb(p.usage?.bytesUp)} / ${fb(p.usage?.bytesDown)}</td>
        <td class="muted">${p.stats.connectOk} / ${p.stats.connectFail}</td>
        <td>${revoked} <button class="copy" data-copy="${listen}">copy</button> ${rot}</td>
      </tr>`;
    })
    .join('');
}

const fmtCountry = (c) => {
  const t = String(c ?? '').trim();
  if (!t) return '?';
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase(); // ISO2
  const [country, ...city] = t.toLowerCase().split('-');
  const cap = (s) => s.replace(/(^|\s|-)\w/g, (ch) => ch.toUpperCase());
  return city.length ? `${cap(country)} · ${cap(city.join('-'))}` : cap(country);
};

document.addEventListener('click', (e) => {
  // Nút ⟳ phải check TRƯỚC nút copy — nó dùng chung class "copy" để có style,
  // check .copy trước sẽ nuốt click và rotate không bao giờ chạy.
  const rot = e.target.closest('[data-rotate]');
  if (rot && !rot.disabled) {
    rot.disabled = true;
    rot.textContent = '…';
    window.api.rotate(rot.dataset.rotate).then(async (res) => {
      if (!res.ok) $('msg').textContent = res.error;
      // Luôn re-render: exit mới hiện ngay + nút quay lại trạng thái bình thường.
      render(await window.api.state());
    });
    return;
  }
  const btn = e.target.closest('.copy');
  if (btn) { navigator.clipboard.writeText(btn.dataset.copy ?? ''); return; }
});

$('btnToggle').onclick = async () => {
  const btn = $('btnToggle');
  if (btn.disabled) return; // ignore double-clicks while busy
  const cur = await window.api.state();
  const busyLabel = cur.running ? 'Disconnecting…' : 'Connecting…';
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = `<span class="spinner"></span>${busyLabel}`;
  try {
    const res = cur.running ? await window.api.stop() : await window.api.start();
    $('msg').textContent = res.ok ? '' : res.error;
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    render(await window.api.state()); // restores proper label + fresh counts
  }
};

$('btnSave').onclick = async () => {
  const res = await window.api.saveSettings({
    bindIp: $('bindIp').value.trim() || '127.0.0.1',
    portStart: Number($('portStart').value) || 8801,
    portCount: Math.min(20, Math.max(1, Number($('portCount').value) || 20)),
    mcpPort: Number($('mcpPort').value) || 6789,
    rotationStrategy: $('rotationStrategy').value || 'manual',
    healthCheckInterval: $('healthCheckInterval').value || '60000',
    quotaAlertThreshold: Number($('quotaAlertThreshold').value) || 80,
  });
  if (!res.ok) $('msg').textContent = res.error;
  render(res.ok && res.state ? res.state : await window.api.state());
};

$('btnReload').onclick = async () => {
  const btn = $('btnReload');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Reloading…';
  try {
    const res = await window.api.reload();
    $('msg').textContent = res.ok ? 'Allocation refreshed' : res.error;
    render(res.ok && res.state ? res.state : await window.api.state());
  } finally {
    btn.disabled = false;
    btn.textContent = '⟳ Reload';
  }
};

window.api.onState(render);
window.api.state().then(render);

// Logs functionality
const logs = [];
const MAX_LOGS = 200;

// Capture console.log
const originalLog = console.log;
console.log = function(...args) {
  originalLog.apply(console, args);
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const timestamp = new Date().toLocaleTimeString('vi-VN');
  logs.push(`[${timestamp}] ${msg}`);
  if (logs.length > MAX_LOGS) logs.shift();
  updateLogsDisplay();
};

function updateLogsDisplay() {
  const content = $('logsContent');
  if (content) content.textContent = logs.join('\n');
  const logsPanel = $('logsPanel');
  if (logsPanel && logsPanel.style.display !== 'none') {
    setTimeout(() => { content.scrollTop = content.scrollHeight; }, 0);
  }
}

$('btnShowLogs').onclick = () => {
  const panel = $('logsPanel');
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  $('btnShowLogs').textContent = isHidden ? '📋 Logs ▲' : '📋 Logs';
  $('btnClearLogs').style.display = isHidden ? 'none' : 'inline-block';
  if (isHidden) {
    setTimeout(() => {
      const content = $('logsContent');
      if (content) content.scrollTop = content.scrollHeight;
    }, 50);
  }
};

// Log app start
console.log('AgentProxy app started');

$('btnClearLogs').onclick = () => {
  logs.length = 0;
  updateLogsDisplay();
};
