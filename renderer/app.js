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

function initTheme() {
  const saved = localStorage.getItem('agentproxy-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  $('themeSelect').value = saved;
}

async function initI18n() {
  const saved = localStorage.getItem('agentproxy-lang') || 'en';
  await i18n.load(saved);
  $('languageSelect').value = i18n.getLocale();
  if (saved !== 'en') translate();
}

function translate() {
  if (i18n.getLocale() === 'en') return;

  const t = (k) => i18n.t(k);

  // Header & badges
  $('planBadge').textContent = t('app.subtitle');
  $('btnReload').textContent = t('header.reload');
  $('btnReload').title = t('header.reloadHint');
  $('btnToggle').textContent = $('btnToggle').textContent.includes('Connect') ? t('header.connect') : t('header.disconnect');

  // Settings labels - update just the text before input/select
  const labels = document.querySelectorAll('.settings label');
  const labelKeys = [
    'settings.bindIp', 'settings.portRange', 'settings.count', 'settings.mcpPort',
    'settings.rotationStrategy', 'settings.healthCheckInterval', 'settings.quotaAlertThreshold', 'settings.language'
  ];
  labels.forEach((label, i) => {
    const child = label.querySelector('input, select, .row');
    if (child && labelKeys[i]) {
      const newText = t(labelKeys[i]) + ' ';
      label.textContent = newText;
      label.appendChild(child);
    }
  });

  // Dropdown options
  [$('rotationStrategy'), 'settings.strategies.manual', 'settings.strategies.autoFail', 'settings.strategies.autoSlow', 'settings.strategies.autoBoth']
    .slice(1).forEach((k, i) => {
      const opt = $('rotationStrategy')?.querySelector(`option:nth-child(${i+1})`);
      if (opt) opt.textContent = t(k);
    });

  [$('healthCheckInterval'), 'settings.intervals.perRequest', 'settings.intervals.1min', 'settings.intervals.5min', 'settings.intervals.10min', 'settings.intervals.manual']
    .slice(1).forEach((k, i) => {
      const opt = $('healthCheckInterval')?.querySelector(`option:nth-child(${i+1})`);
      if (opt) opt.textContent = t(k);
    });

  [$('quotaAlertThreshold'), 'settings.thresholds.50', 'settings.thresholds.70', 'settings.thresholds.80', 'settings.thresholds.90', 'settings.thresholds.100']
    .slice(1).forEach((k, i) => {
      const opt = $('quotaAlertThreshold')?.querySelector(`option:nth-child(${i+1})`);
      if (opt) opt.textContent = t(k);
    });

  const themeOpts = $('themeSelect')?.querySelectorAll('option');
  if (themeOpts) {
    themeOpts[0].textContent = t('settings.themes.dark');
    themeOpts[1].textContent = t('settings.themes.light');
  }

  // Buttons
  $('btnSave').textContent = t('settings.save');
  $('btnShowLogs').textContent = t('logs.show');
  $('btnClearLogs').textContent = t('logs.clear');

  // MCP section
  const mcpTitle = document.querySelector('.settings.mcp b');
  if (mcpTitle) mcpTitle.textContent = t('mcp.title');

  // Reload dropdown
  const reloadOpts = $('reloadMode')?.querySelectorAll('option');
  if (reloadOpts) {
    reloadOpts[0].textContent = t('reload.soft');
    reloadOpts[1].textContent = t('reload.full');
    reloadOpts[2].textContent = t('reload.hot');
  }

  // Reload button & label
  const reloadLabel = document.querySelector('label:has(#reloadMode)');
  if (reloadLabel) {
    const labelText = reloadLabel.childNodes[0];
    if (labelText) labelText.textContent = t('reload.label');
  }
  $('btnReloadApp').textContent = t('reload.button');

  // Table headers
  const headers = Array.from($('proxyTable')?.querySelectorAll('thead th') || []);
  const headerKeys = ['table.index', 'table.proxy', 'table.country', 'table.exitIp', 'table.health', 'table.active', 'table.requests', 'table.bandwidth', 'table.stats', 'table.actions'];
  headers.forEach((h, i) => h.textContent = t(headerKeys[i] || ''));
}

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
  const usedPercent = Math.round(((limit - left) / limit) * 100);
  el.innerHTML = `<b>${left}/${limit}</b> (${usedPercent}%)`;
}

function checkQuotaAlert(state) {
  const q = state.quota;
  const threshold = Number($('quotaAlertThreshold').value) ?? 80;
  if (threshold === 100 || !q) return; // no alert
  const limit = q.limit ?? 20;
  const left = q.left ?? 0;
  const usedPercent = Math.round(((limit - left) / limit) * 100);
  if (usedPercent >= threshold) {
    const msg = i18n.t('messages.quotaAlert')
      .replace('{percent}', usedPercent)
      .replace('{used}', limit - left)
      .replace('{limit}', limit);
    $('msg').textContent = msg;
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
      '<tr><td colspan="11" class="empty">Press <b>Connect</b> to fetch your 20 free proxies.</td></tr>';
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
        <td style="width: 30px;"><input type="checkbox" class="proxy-checkbox" data-item-id="${p.itemId}" /></td>
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

function showToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

async function reloadApp(mode) {
  const reloadMode = mode || $('reloadMode').value || 'soft';

  switch (reloadMode) {
    case 'soft':
      showToast(i18n.t('reload.softMsg'));
      setTimeout(() => location.reload(), 300);
      break;

    case 'full':
      showToast(i18n.t('reload.fullMsg'));
      setTimeout(async () => {
        if (window.api.relaunch) {
          await window.api.relaunch();
        } else {
          location.reload();
        }
      }, 500);
      break;

    case 'hot':
      try {
        if (window.api.enableHotReload) {
          await window.api.enableHotReload();
          showToast(i18n.t('reload.hotMsg'));
        } else {
          showToast(i18n.t('reload.hotNotSupported'));
        }
      } catch (e) {
        showToast(i18n.t('reload.hotNotSupported'));
      }
      break;
  }
}

function updateBatchUI() {
  const checked = document.querySelectorAll('.proxy-checkbox:checked').length;
  const allCheckboxes = document.querySelectorAll('.proxy-checkbox');
  const isAllChecked = allCheckboxes.length > 0 && checked === allCheckboxes.length;

  $('selectAllHeader').checked = isAllChecked;
  $('selectAllProxies').checked = isAllChecked;
  $('selectedCount').textContent = checked > 0 ? checked : '';

  const show = checked > 0;
  $('btnBatchRotate').style.display = show ? 'inline-block' : 'none';
  $('btnBatchCopy').style.display = show ? 'inline-block' : 'none';
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'selectAllHeader' || e.target.id === 'selectAllProxies') {
    document.querySelectorAll('.proxy-checkbox').forEach(cb => cb.checked = e.target.checked);
    updateBatchUI();
    return;
  }
  if (e.target.classList.contains('proxy-checkbox')) {
    updateBatchUI();
  }
});

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
  const busyLabel = cur.running ? i18n.t('messages.disconnecting') : i18n.t('messages.connecting');
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
  btn.innerHTML = `<span class="spinner"></span>${i18n.t('messages.reloading')}`;
  try {
    const res = await window.api.reload();
    $('msg').textContent = res.ok ? i18n.t('messages.refreshed') : res.error;
    render(res.ok && res.state ? res.state : await window.api.state());
  } finally {
    btn.disabled = false;
    btn.textContent = i18n.t('header.reload');
  }
};

$('languageSelect').onchange = async (e) => {
  await i18n.load(e.target.value);
  translate();
  render(await window.api.state());
};

$('themeSelect').onchange = (e) => {
  const theme = e.target.value;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('agentproxy-theme', theme);
};

$('btnBatchRotate').onclick = async () => {
  const checked = Array.from(document.querySelectorAll('.proxy-checkbox:checked')).map(cb => cb.dataset.itemId);
  if (!checked.length) return;

  const btn = $('btnBatchRotate');
  btn.disabled = true;
  btn.textContent = '⟳ Rotating...';

  for (const itemId of checked) {
    await window.api.rotate(itemId).catch(e => console.error('Rotate failed:', e));
    await new Promise(r => setTimeout(r, 200)); // small delay between rotations
  }

  btn.disabled = false;
  btn.textContent = '⟳ Rotate Selected';
  render(await window.api.state());
};

$('btnBatchCopy').onclick = () => {
  const checked = Array.from(document.querySelectorAll('.proxy-checkbox:checked'));
  const proxies = checked.map(cb => {
    const row = cb.closest('tr');
    const proxyCell = row.cells[2]; // proxy cell
    return proxyCell.textContent.trim();
  });

  navigator.clipboard.writeText(proxies.join('\n'));
  const btn = $('btnBatchCopy');
  const original = btn.textContent;
  btn.textContent = '✓ Copied!';
  setTimeout(() => btn.textContent = original, 1500);
};

$('btnExportSettings').onclick = async () => {
  const state = await window.api.state();
  const settings = {
    bindIp: state.bindIp,
    portStart: state.portStart,
    portCount: state.portCount,
    mcpPort: state.mcpPort,
    rotationStrategy: state.rotationStrategy,
    healthCheckInterval: state.healthCheckInterval,
    quotaAlertThreshold: state.quotaAlertThreshold,
    theme: localStorage.getItem('agentproxy-theme') || 'dark',
    language: i18n.getLocale(),
    exportedAt: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agentproxy-settings-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  $('msg').textContent = '✓ Settings exported';
  setTimeout(() => $('msg').textContent = '', 2000);
};

$('btnImportSettings').onclick = () => {
  $('importFile').click();
};

$('importFile').onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);

    const res = await window.api.saveSettings({
      bindIp: imported.bindIp ?? '127.0.0.1',
      portStart: imported.portStart ?? 8801,
      portCount: imported.portCount ?? 20,
      mcpPort: imported.mcpPort ?? 6789,
      rotationStrategy: imported.rotationStrategy ?? 'manual',
      healthCheckInterval: imported.healthCheckInterval ?? '60000',
      quotaAlertThreshold: imported.quotaAlertThreshold ?? 80,
    });

    if (imported.theme) {
      document.documentElement.setAttribute('data-theme', imported.theme);
      localStorage.setItem('agentproxy-theme', imported.theme);
      $('themeSelect').value = imported.theme;
    }
    if (imported.language) {
      await i18n.load(imported.language);
      $('languageSelect').value = imported.language;
      translate();
    }

    if (res.ok) {
      $('msg').textContent = '✓ Settings imported successfully';
      render(res.state || await window.api.state());
    } else {
      $('msg').textContent = '❌ Import failed: ' + res.error;
    }
    setTimeout(() => $('msg').textContent = '', 3000);
  } catch (err) {
    $('msg').textContent = '❌ Invalid file: ' + err.message;
  }

  $('importFile').value = '';
};

window.api.onState(render);
initTheme();
initI18n().then(() => window.api.state().then(render));

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

$('btnReloadApp').onclick = () => reloadApp();

$('reloadMode').onchange = () => {
  // Optional: auto-reload on dropdown change (disabled by default)
  // reloadApp();
};

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'r') {
    e.preventDefault();
    reloadApp('soft');
  }
  if (e.ctrlKey && e.shiftKey && !e.altKey && e.key === 'r') {
    e.preventDefault();
    reloadApp('full');
  }
  if (e.ctrlKey && e.altKey && !e.shiftKey && e.key === 'r') {
    e.preventDefault();
    reloadApp('hot');
  }
});

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
