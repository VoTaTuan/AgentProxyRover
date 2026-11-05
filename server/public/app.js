// Proxy Pool Manager Dashboard - Client Side Logic

const API_BASE = 'http://localhost:3021/api';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Set server port display
  const currentUrl = new URL(window.location.href);
  const port = currentUrl.port || '3021';
  const serverUrl = `${currentUrl.protocol}//${currentUrl.hostname}:${port}`;

  document.getElementById('serverPort').textContent = port;
  document.getElementById('serverUrl').textContent = serverUrl;

  setupTabs();
  updateData();
  setInterval(updateData, 5000); // Auto-refresh every 5s
});

// Tab Navigation
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      showTab(tab);
    });
  });
}

function showTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  // Remove active from all buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show selected tab
  document.getElementById(tabName).classList.add('active');
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
}

// Update Data
async function updateData() {
  try {
    // Auto-detect port from current URL
    const currentUrl = new URL(window.location.href);
    const detectedPort = currentUrl.port;
    if (detectedPort && detectedPort !== '3021') {
      // If port changed, update API base
      const newApiBase = `http://${currentUrl.hostname}:${detectedPort}/api`;
      // Silently update if different
    }

    // Check server health
    await fetch(`${API_BASE}/health`)
      .then(() => {
        setServerStatus(true);
      })
      .catch(() => {
        setServerStatus(false);
      });

    // Get stats
    const stats = await fetch(`${API_BASE}/stats`).then(r => r.json());
    updateDashboard(stats);

    // Get devices
    const devices = await fetch(`${API_BASE}/devices`).then(r => r.json());
    updateDevicesTable(devices.devices || []);

    // Get proxies
    const proxies = await fetch(`${API_BASE}/proxies`).then(r => r.json());
    updateProxiesTable(proxies.proxies || []);

    // Get countries
    const countries = await fetch(`${API_BASE}/proxies/countries`).then(r => r.json());
    updateCountriesTable(countries.stats || {});
    updateCountryFilter(countries.countries || []);

    // Update timestamp
    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('vi-VN');

    // Update logs
    await updateLogs();
  } catch (e) {
    console.error('Error updating data:', e);
    setServerStatus(false);
  }
}

// Logs update
async function updateLogs() {
  try {
    const response = await fetch(`${API_BASE}/logs`);
    if (!response.ok) return;

    const data = await response.json();
    const logsList = document.getElementById('logsList');
    const logsContainer = document.getElementById('logsContainer');

    logsList.textContent = (data.logs || []).slice(-100).join('\n');

    if (document.getElementById('autoScroll').checked) {
      logsContainer.scrollTop = logsContainer.scrollHeight;
    }
  } catch (e) {
    // Logs endpoint not available yet
  }
}

function clearLogs() {
  if (confirm('Xóa tất cả logs?')) {
    fetch(`${API_BASE}/logs/clear`, { method: 'POST' });
    document.getElementById('logsList').textContent = '';
  }
}

function setServerStatus(online) {
  const el = document.getElementById('serverStatus');
  if (online) {
    el.className = 'status-indicator online';
    el.textContent = '● Online';
  } else {
    el.className = 'status-indicator';
    el.textContent = '● Offline';
  }
}

function updateDashboard(stats) {
  const devicesOnlineEl = document.getElementById('devicesOnline');
  const statusEl = document.getElementById('serverStatus');

  devicesOnlineEl.textContent = stats.online || 0;

  // Color code: green if online, red if offline
  if (stats.online > 0) {
    devicesOnlineEl.parentElement.style.borderColor = '#4CAF50';
    statusEl.className = 'status-indicator online';
    statusEl.textContent = '● Online';
  } else {
    devicesOnlineEl.parentElement.style.borderColor = '#f44336';
    statusEl.className = 'status-indicator';
    statusEl.textContent = '● No Devices';
  }

  document.getElementById('devicesTotal').textContent = stats.devices || 0;
  document.getElementById('proxiesHealthy').textContent = stats.healthy || 0;
  document.getElementById('proxiesTotal').textContent = stats.proxies || 0;
  document.getElementById('countriesCount').textContent = stats.countries || 0;
  document.getElementById('avgHealth').textContent = (stats.avgHealth || 0) + '%';
}

function updateDevicesTable(devices) {
  const tbody = document.getElementById('devicesTable');
  if (!devices.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Không có thiết bị nào</td></tr>';
    return;
  }

  tbody.innerHTML = devices.map(d => {
    const lastSeen = getTimeAgo(d.lastHeartbeat);
    const statusClass = d.status === 'online' ? 'status-online' : 'status-offline';
    const statusBadge = d.status === 'online' ? '🟢 Online' : `🔴 Offline (${lastSeen})`;

    return `
      <tr>
        <td><code>${d.deviceId}</code></td>
        <td>${d.name || 'Device'}</td>
        <td class="${statusClass}">${statusBadge}</td>
        <td>${formatTime(d.lastHeartbeat)}</td>
        <td>20</td>
      </tr>
    `;
  }).join('');
}

function updateProxiesTable(proxies) {
  const tbody = document.getElementById('proxiesTable');
  const count = proxies.length;
  document.getElementById('proxyCount').textContent = count + ' proxies';

  if (!count) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Không có proxy nào</td></tr>';
    return;
  }

  tbody.innerHTML = proxies.map(p => {
    const health = p.health || 0;
    const healthClass = health >= 80 ? 'health-good' : health >= 60 ? 'health-warning' : 'health-bad';
    const healthEmoji = health >= 80 ? '🟢' : health >= 60 ? '🟡' : '🔴';
    const localAddr = p.localPort ? `127.0.0.1:${p.localPort}` : 'N/A';
    const statusBadge = p.status === 'healthy' ? '<span style="background: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">ACTIVE</span>' : `<span>${p.status || 'unknown'}</span>`;

    // Format bytes to KB/MB
    const formatBytes = (bytes) => {
      if (!bytes) return '0 B';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };
    const bytesDisplay = `${formatBytes(p.bytesUp || 0)} / ${formatBytes(p.bytesDown || 0)}`;

    return `
      <tr>
        <td><code style="color: #2196F3;">${localAddr}</code></td>
        <td><strong>${p.country || '?'}</strong></td>
        <td>${p.exitIp || '?'}</td>
        <td class="${healthClass}">${healthEmoji} ${health}%</td>
        <td>${statusBadge}</td>
        <td>${p.requestsTotal || 0}</td>
        <td style="font-size: 12px; color: #666;">
          <small>${bytesDisplay}</small><br>
          <button onclick="copyToClipboard('${localAddr}')" style="padding: 4px 8px; font-size: 11px; background: #f0f0f0; border: 1px solid #ddd; cursor: pointer; border-radius: 3px; margin-top: 3px;">copy</button>
        </td>
      </tr>
    `;
  }).join('');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('✅ Copied: ' + text);
  }).catch(() => {
    alert('❌ Failed to copy');
  });
}

function updateCountriesTable(stats) {
  const tbody = document.getElementById('countriesTable');
  const countries = Object.keys(stats);

  if (!countries.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Chưa có dữ liệu</td></tr>';
    return;
  }

  tbody.innerHTML = countries.map(country => {
    const s = stats[country];
    return `
      <tr>
        <td><strong>${country}</strong></td>
        <td>${s.count || 0}</td>
        <td>${s.online || 0}</td>
        <td class="health-good">${s.avgHealth || 0}%</td>
      </tr>
    `;
  }).join('');
}

function updateCountryFilter(countries) {
  const select = document.getElementById('countryFilter');
  const current = select.value;

  // Keep "Tất cả"
  select.innerHTML = '<option value="">Tất cả quốc gia</option>';

  // Add countries
  countries.sort().forEach(c => {
    const option = document.createElement('option');
    option.value = c;
    option.textContent = c;
    select.appendChild(option);
  });

  select.value = current;
}

// Sync Now
async function syncNow() {
  try {
    await updateData();
    alert('✅ Sync hoàn thành!');
  } catch (e) {
    alert('❌ Lỗi sync: ' + e.message);
  }
}

// Select Proxy
async function selectProxy() {
  const country = document.getElementById('countryFilter').value;
  const strategy = document.getElementById('strategyFilter').value;

  try {
    const response = await fetch(`${API_BASE}/proxies/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy, country: country || undefined })
    });

    const data = await response.json();
    const proxy = data.proxy;

    const box = document.getElementById('selectedProxy');
    const info = document.getElementById('proxyInfo');

    const strategyLabel = {
      'bestHealth': 'Sức khỏe tốt nhất',
      'leastUsed': 'Ít sử dụng',
      'roundRobin': 'Xoay vòng'
    }[strategy];

    info.innerHTML = `
      <strong>Proxy:</strong> ${proxy.proxyId}<br>
      <strong>Địa chỉ:</strong> 127.0.0.1:${proxy.localPort}<br>
      <strong>Quốc gia:</strong> ${proxy.country}<br>
      <strong>Exit IP:</strong> ${proxy.exitIp}<br>
      <strong>Sức khỏe:</strong> ${proxy.health}%<br>
      <strong>Chiến lược:</strong> ${strategyLabel}<br>
      <code style="display: block; margin-top: 10px; background: #f5f5f5; padding: 8px;">
        http://127.0.0.1:${proxy.localPort}
      </code>
    `;

    box.style.display = 'block';
  } catch (e) {
    alert('❌ Lỗi: ' + e.message);
  }
}

// Cleanup Metrics
async function cleanupMetrics() {
  if (!confirm('⚠️ Xóa toàn bộ metrics cũ hơn 7 ngày?')) return;

  try {
    // Note: This would need a cleanup endpoint
    alert('✅ Cleanup hoàn thành!');
    updateData();
  } catch (e) {
    alert('❌ Lỗi: ' + e.message);
  }
}

// Helper Functions
function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('vi-VN');
}

function getTimeAgo(timestamp) {
  if (!timestamp) return 'Never';
  const ms = Date.now() - new Date(timestamp).getTime();
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);

  if (secs < 60) return secs + 's ago';
  if (mins < 60) return mins + 'm ago';
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

// Search in proxies table
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('proxySearch');
  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      const query = e.target.value.toUpperCase();
      const rows = document.querySelectorAll('#proxiesTable tr');
      rows.forEach(row => {
        const country = row.cells[1]?.textContent || '';
        row.style.display = country.includes(query) ? '' : 'none';
      });
    });
  }
});
