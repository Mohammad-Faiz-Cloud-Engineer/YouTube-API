const API_BASE = '/api';

let currentAudio = null;

// ── Navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    item.classList.add('active');
    const tab = item.dataset.tab;
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (tab === 'dashboard') refreshDashboard();
  });
});

// ── Dashboard ─────────────────────────────────────────────────────────────
async function refreshDashboard() {
  try {
    const [health, cache] = await Promise.all([
      fetch(`${API_BASE}/health`).then(r => r.json()),
      fetch(`${API_BASE}/admin/cache`).then(r => r.json()),
    ]);

    document.getElementById('statStatus').textContent = health.status === 'ok' ? 'Online' : 'Unknown';
    document.getElementById('statStatus').style.color = 'var(--green)';

    const uptime = Math.floor(health.uptime);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    document.getElementById('statUptime').textContent = `${hours}h ${minutes}m ${seconds}s`;

    document.getElementById('statSearchCache').textContent = `${cache.search.keys} keys`;
    document.getElementById('statStreamCache').textContent = `${cache.stream.keys} keys`;
    document.getElementById('statMetadataCache').textContent = `${cache.metadata.keys} keys`;

    document.getElementById('serverStatus').innerHTML = '<span class="status-dot online"></span> Online';
  } catch (err) {
    document.getElementById('statStatus').textContent = 'Offline';
    document.getElementById('statStatus').style.color = 'var(--accent)';
    document.getElementById('serverStatus').innerHTML = '<span class="status-dot offline"></span> Offline';
  }
}

// ── Search ────────────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') performSearch();
});

async function performSearch() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;

  const container = document.getElementById('searchResults');
  container.innerHTML = '<div class="loading">Searching...</div>';

  try {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      const err = await res.json();
      const errDiv = document.createElement('div');
      errDiv.className = 'error-message';
      errDiv.textContent = err.message || 'Search failed';
      container.innerHTML = '';
      container.appendChild(errDiv);
      return;
    }

    const data = await res.json();
    const items = data.results || [];

    if (!items.length) {
      container.innerHTML = '<div class="empty-state"><div class="icon">&#128270;</div>No results found</div>';
      return;
    }

    // Build result cards via DOM to avoid any attribute-context injection risk.
    // item.id is a YouTube video ID (11-char alphanumeric) validated server-side,
    // but we never trust that assumption in the UI layer.
    const fragment = document.createDocumentFragment();
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'result-item';

      const img = document.createElement('img');
      img.src = item.thumbnail || '';
      img.alt = item.title || '';
      img.loading = 'lazy';
      img.onerror = function () {
        this.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22><rect fill=%22%23252529%22 width=%22320%22 height=%22180%22/><text fill=%22%23666%22 x=%22160%22 y=%2290%22 text-anchor=%22middle%22>No Thumbnail</text></svg>';
      };

      const body = document.createElement('div');
      body.className = 'result-item-body';

      const title = document.createElement('h4');
      title.title = item.title || '';
      title.textContent = item.title || '';

      const channel = document.createElement('div');
      channel.className = 'channel';
      channel.textContent = item.channel?.name || 'Unknown';

      const meta = document.createElement('div');
      meta.className = 'meta';
      const dur = document.createElement('span');
      dur.textContent = item.duration_label || '';
      const views = document.createElement('span');
      views.textContent = item.views || '';
      meta.append(dur, views);

      const actions = document.createElement('div');
      actions.className = 'actions';

      const detailsBtn = document.createElement('button');
      detailsBtn.textContent = 'Details';
      detailsBtn.addEventListener('click', () => switchTab('video', item.id));

      const playBtn = document.createElement('button');
      playBtn.textContent = 'Play';
      playBtn.addEventListener('click', () => switchTab('stream', item.id));

      actions.append(detailsBtn, playBtn);
      body.append(title, channel, meta, actions);
      card.append(img, body);
      fragment.appendChild(card);
    });
    container.innerHTML = '';
    container.appendChild(fragment);
  } catch (err) {
    const errDiv = document.createElement('div');
    errDiv.className = 'error-message';
    errDiv.textContent = `Network error: ${err.message}`;
    container.innerHTML = '';
    container.appendChild(errDiv);
  }
}

// ── Video Info ────────────────────────────────────────────────────────────
document.getElementById('videoInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') getVideoInfo();
});

async function getVideoInfo(videoId) {
  const id = videoId || document.getElementById('videoInput').value.trim();
  if (!id) return;

  const container = document.getElementById('videoResult');
  container.innerHTML = '<div class="loading">Loading video info...</div>';

  try {
    const res = await fetch(`${API_BASE}/video/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const err = await res.json();
      const errDiv = document.createElement('div');
      errDiv.className = 'error-message';
      errDiv.textContent = err.message || 'Failed to get video info';
      container.innerHTML = '';
      container.appendChild(errDiv);
      return;
    }

    const data = await res.json();

    // Build video info card via DOM to keep all user-controlled values out of
    // HTML/attribute string context. data.id comes from the server but we treat
    // it as untrusted at the UI layer.
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'video-header';

    const img = document.createElement('img');
    img.src = data.thumbnail || '';
    img.alt = data.title || '';
    img.onerror = function () {
      this.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%22135%22><rect fill=%22%23252529%22 width=%22240%22 height=%22135%22/><text fill=%22%23666%22 x=%22120%22 y=%2267%22 text-anchor=%22middle%22>No Thumbnail</text></svg>';
    };

    const infoDiv = document.createElement('div');
    infoDiv.style.flex = '1';

    const titleEl = document.createElement('h3');
    titleEl.style.marginBottom = '8px';
    titleEl.textContent = data.title || '';

    const channelEl = document.createElement('p');
    channelEl.style.cssText = 'color:var(--text2);margin-bottom:12px';
    channelEl.textContent = data.channel?.name || 'Unknown Channel';

    const dl = document.createElement('dl');
    dl.className = 'video-meta';
    const metaRows = [
      ['Video ID', data.id],
      ['Duration', data.duration_label],
      ['Views', data.views || 'N/A'],
      ['Uploaded', data.uploaded_date || 'N/A'],
    ];
    if (data.stream) {
      metaRows.push(['Stream Quality', data.stream.quality || 'N/A']);
      metaRows.push(['Stream Format', data.stream.format || 'N/A']);
    }
    metaRows.forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    });

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'actions';
    actionsDiv.style.marginTop = '12px';

    if (data.stream) {
      const playBtn = document.createElement('button');
      playBtn.textContent = 'Play Audio';
      playBtn.addEventListener('click', () => switchTab('stream', data.id));
      actionsDiv.appendChild(playBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy ID';
    copyBtn.addEventListener('click', () => copyText(data.id));
    actionsDiv.appendChild(copyBtn);

    infoDiv.append(titleEl, channelEl, dl, actionsDiv);
    header.append(img, infoDiv);
    container.appendChild(header);

    if (data.description) {
      const desc = document.createElement('div');
      desc.className = 'description';
      desc.textContent = data.description;
      container.appendChild(desc);
    }
  } catch (err) {
    const errDiv = document.createElement('div');
    errDiv.className = 'error-message';
    errDiv.textContent = `Network error: ${err.message}`;
    container.innerHTML = '';
    container.appendChild(errDiv);
  }
}

// ── Stream Test ───────────────────────────────────────────────────────────
document.getElementById('streamInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') playStream();
});

async function playStream(videoId) {
  const id = videoId || document.getElementById('streamInput').value.trim();
  if (!id) return;

  const playerContainer = document.getElementById('streamPlayer');
  const audioPlayer = document.getElementById('audioPlayer');
  const streamInfo = document.getElementById('streamInfo');
  const streamResult = document.getElementById('streamResult');

  playerContainer.style.display = 'none';
  streamResult.innerHTML = '<div class="loading">Resolving stream...</div>';

  try {
    const res = await fetch(`${API_BASE}/video/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const err = await res.json();
      const errDiv = document.createElement('div');
      errDiv.className = 'error-message';
      errDiv.textContent = err.message || 'Failed to resolve stream';
      streamResult.innerHTML = '';
      streamResult.appendChild(errDiv);
      return;
    }

    const data = await res.json();

    // Build stream info via DOM — no innerHTML with interpolated values.
    streamInfo.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = data.title || '';
    streamInfo.appendChild(strong);
    streamInfo.appendChild(document.createTextNode(
      ` \u2014 ${data.channel?.name || 'Unknown'} \u00b7 ${data.duration_label} \u00b7 Quality: ${data.stream?.quality || 'N/A'}`
    ));

    const playUrl = `${API_BASE}/video/${encodeURIComponent(id)}/play`;
    audioPlayer.src = playUrl;
    audioPlayer.load();

    playerContainer.style.display = 'block';
    streamResult.innerHTML = '';

    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    currentAudio = audioPlayer;
  } catch (err) {
    const errDiv = document.createElement('div');
    errDiv.className = 'error-message';
    errDiv.textContent = `Network error: ${err.message}`;
    streamResult.innerHTML = '';
    streamResult.appendChild(errDiv);
  }
}

// ── API Console ───────────────────────────────────────────────────────────
document.getElementById('consolePath').addEventListener('keydown', e => {
  if (e.key === 'Enter') executeConsole();
});

const examples = [
  'search?q=never gonna give you up',
  'suggestions?q=never',
  'video/dQw4w9WgXcQ',
  'video/dQw4w9WgXcQ/stream',
  'health',
];
let exampleIndex = 0;
const consoleInput = document.getElementById('consolePath');
setInterval(() => {
  exampleIndex = (exampleIndex + 1) % examples.length;
  consoleInput.placeholder = `e.g. ${examples[exampleIndex]}`;
}, 3000);

function buildConsoleUrl(raw) {
  let path = raw.trim();
  if (!path) return '';
  if (!path.startsWith('/')) path = '/' + path;
  if (!path.startsWith('/api')) path = '/api' + path;
  return path;
}

async function executeConsole() {
  const method = document.getElementById('consoleMethod').value;
  const rawPath = document.getElementById('consolePath').value.trim();
  if (!rawPath) {
    document.getElementById('consoleOutput').textContent = 'Enter an API path first';
    return;
  }

  const url = buildConsoleUrl(rawPath);
  const output = document.getElementById('consoleOutput');
  output.textContent = `→ ${method} ${url}\nLoading...`;

  try {
    const startTime = performance.now();
    const res = await fetch(url, { method });
    const elapsed = (performance.now() - startTime).toFixed(0);

    const contentType = res.headers.get('content-type') || '';
    const statusIcon = res.ok ? '✓' : '✗';
    let body;

    if (contentType.includes('application/json')) {
      body = JSON.stringify(await res.json(), null, 2);
    } else if (contentType.includes('audio') || contentType.includes('video')) {
      body = `[Binary stream: ${contentType}]`;
    } else {
      body = await res.text();
    }

    const truncated = body.length > 5000 ? body.substring(0, 5000) + '\n\n... (truncated, full length: ' + body.length + ' chars)' : body;
    output.textContent = `${statusIcon} ${res.status} ${res.statusText} (${elapsed}ms)\n\n${truncated}`;
  } catch (err) {
    output.textContent = `Network Error: ${err.message}`;
  }
}

function clearConsole() {
  document.getElementById('consolePath').value = '';
  document.getElementById('consoleOutput').textContent = '';
}

// ── Utilities ─────────────────────────────────────────────────────────────
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    const el = document.createElement('div');
    el.textContent = 'Copied!';
    el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--green);color:#000;padding:8px 16px;border-radius:6px;font-weight:600;z-index:9999';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  });
}

function switchTab(tab, value) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

  const navItem = document.querySelector(`[data-tab="${tab}"]`);
  if (navItem) navItem.classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');

  if (tab === 'video') {
    document.getElementById('videoInput').value = value;
    getVideoInfo(value);
  } else if (tab === 'stream') {
    document.getElementById('streamInput').value = value;
    playStream(value);
  } else if (tab === 'search') {
    document.getElementById('searchInput').value = value;
    performSearch();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
refreshDashboard();
setInterval(refreshDashboard, 30000);
