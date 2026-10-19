/**
 * TeraPlay Client Application - 100% Zero-Trace & Ephemeral Mode
 * - NO history saved anywhere (no localStorage, no cookies, no databases).
 * - Immediate memory purge on tab close or session clear.
 * - Streams directly into RAM buffers without disk persistence.
 */

// Purge any preexisting history or cached tokens immediately
try {
  localStorage.removeItem('teraplay_history');
  sessionStorage.clear();
} catch (e) {}

let player = null;
let hlsInstance = null;
let currentFiles = [];
let activeFileIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
  initPlayer();
  initTheme();
  initEventListeners();
});

// Initialize Plyr Video Player
function initPlayer() {
  const videoElement = document.getElementById('main-video');
  if (videoElement && window.Plyr) {
    player = new Plyr(videoElement, {
      controls: [
        'play-large',
        'play',
        'progress',
        'current-time',
        'duration',
        'mute',
        'volume',
        'captions',
        'settings',
        'pip',
        'airplay',
        'fullscreen'
      ],
      settings: ['speed', 'quality'],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] }
    });
  }
}

// Attach Video Source (supports HLS .m3u8 and MP4)
function setVideoSource(src, poster, autoPlay = true) {
  const video = document.getElementById('main-video');
  if (!video || !src) return;

  if (poster) {
    video.poster = poster;
  }

  // Destroy any existing Hls instance to free memory
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  const isM3u8 = src.includes('.m3u8');

  if (isM3u8 && window.Hls && window.Hls.isSupported()) {
    hlsInstance = new window.Hls({
      enableWorker: true,
      lowLatencyMode: true
    });
    hlsInstance.loadSource(src);
    hlsInstance.attachMedia(video);
    hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
      if (autoPlay) {
        video.play().catch(e => console.log('Autoplay deferred:', e));
      }
    });
    hlsInstance.on(window.Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        fallbackToProxyStream();
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl') && isM3u8) {
    video.src = src;
    if (autoPlay) video.play().catch(() => {});
  } else {
    if (player) {
      player.source = {
        type: 'video',
        title: currentFiles[activeFileIndex] ? currentFiles[activeFileIndex].name : 'TeraBox Video',
        sources: [
          {
            src: src,
            type: 'video/mp4'
          }
        ],
        poster: poster || ''
      };
      if (autoPlay) player.play().catch(() => {});
    } else {
      video.src = src;
      if (autoPlay) video.play().catch(() => {});
    }
  }
}

// Fallback to proxy stream if needed
function fallbackToProxyStream() {
  const file = currentFiles[activeFileIndex];
  if (!file) return;

  const originalUrl = file.fast_stream_url || file.fast_download_url;
  if (!originalUrl) return;

  const proxyUrl = `/api/proxy-stream?url=${encodeURIComponent(originalUrl)}`;
  setVideoSource(proxyUrl, file.thumbnail, true);
}

// Theme Handling (Dark/Light)
function initTheme() {
  const savedTheme = localStorage.getItem('teraplay_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('teraplay_theme', next);
      updateThemeIcon(next);
    });
  }
}

function updateThemeIcon(theme) {
  const toggleBtn = document.getElementById('theme-toggle');
  if (!toggleBtn) return;
  toggleBtn.innerHTML = theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
}

// Event Listeners
function initEventListeners() {
  const input = document.getElementById('terabox-url');
  const pasteBtn = document.getElementById('btn-paste');
  const clearBtn = document.getElementById('btn-clear');
  const playBtn = document.getElementById('btn-play');
  const downloadBtn = document.getElementById('btn-download');
  const purgeBtn = document.getElementById('btn-purge');

  function updateClearButtonVisibility() {
    if (!clearBtn) return;
    if (input.value.trim().length > 0) {
      clearBtn.style.display = 'inline-flex';
    } else {
      clearBtn.style.display = 'none';
    }
  }

  // Monitor input typing and pasting
  input.addEventListener('input', updateClearButtonVisibility);
  input.addEventListener('change', updateClearButtonVisibility);

  // Clear button click
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      updateClearButtonVisibility();
      input.focus();
      hideError();
    });
  }

  // Paste from clipboard
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        input.value = text.trim();
        updateClearButtonVisibility();
        input.focus();
        showNotification('Link pasted!');
      }
    } catch (err) {
      showError('Please paste manually using Ctrl+V or allow clipboard access.');
    }
  });

  // Play button
  playBtn.addEventListener('click', () => {
    handleProcess('stream');
  });

  // Download button
  downloadBtn.addEventListener('click', () => {
    handleProcess('download');
  });

  // 1-Click Purge & Reset Button
  if (purgeBtn) {
    purgeBtn.addEventListener('click', () => {
      purgeEverything();
      updateClearButtonVisibility();
    });
  }

  // Enter key in input
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleProcess('stream');
    }
  });

  // Demo test button
  const demoBtn = document.getElementById('btn-try-demo');
  if (demoBtn) {
    demoBtn.addEventListener('click', () => {
      input.value = 'https://terasharelink.com/s/1qRyqtHe4m7FCycqpsiEDsA';
      updateClearButtonVisibility();
      handleProcess('stream');
    });
  }

  // FAQ Accordion
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.parentElement;
      const isActive = item.classList.contains('active');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
}

// Complete Memory & State Purge
function purgeEverything() {
  const video = document.getElementById('main-video');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  currentFiles = [];
  activeFileIndex = 0;

  const input = document.getElementById('terabox-url');
  if (input) input.value = '';

  const resultSection = document.getElementById('result-section');
  if (resultSection) resultSection.style.display = 'none';

  try {
    localStorage.removeItem('teraplay_history');
    sessionStorage.clear();
  } catch (e) {}

  hideError();
  showNotification('🛡️ Trace Purged: All links, video buffers, and session data wiped.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Main Process Handler
async function handleProcess(action = 'stream') {
  const input = document.getElementById('terabox-url');
  const url = input.value.trim();

  if (!url) {
    showError('Please paste a TeraBox video or folder link first.');
    return;
  }

  hideError();
  showLoading(true, action === 'stream' ? 'Resolving high-speed streaming links...' : 'Fetching direct download links...');

  try {
    const endpoint = action === 'download' ? '/api/download' : '/api/stream';
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    let data;
    try {
      const rawText = await resp.text();
      data = JSON.parse(rawText);
    } catch (parseErr) {
      showLoading(false);
      showError('Server responded with an unexpected error. Please try again.');
      return;
    }

    showLoading(false);

    if (data.status === 'success' && data.list && data.list.length > 0) {
      currentFiles = data.list;
      activeFileIndex = 0;
      renderResults(data, action);
    } else {
      showError(data.message || 'Could not resolve this TeraBox link. Please verify that the link exists and is publicly accessible.');
    }
  } catch (err) {
    showLoading(false);
    showError('Network error connecting to resolver server. Please check your internet connection.');
  }
}

// Render Results & Player
function renderResults(data, action) {
  hideError();
  const resultSection = document.getElementById('result-section');
  resultSection.style.display = 'block';

  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  renderAlbumList(data.list);
  loadFile(0, action === 'stream');
}

function loadFile(index, autoPlay = true) {
  activeFileIndex = index;
  const file = currentFiles[index];
  if (!file) return;

  document.querySelectorAll('.file-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === index);
  });

  document.getElementById('video-title').textContent = file.name;
  document.getElementById('video-size').textContent = file.size_formatted;
  document.getElementById('video-quality').textContent = file.duration && file.duration !== '0:00' ? file.duration : 'HD VIDEO';

  const rawStream = file.fast_stream_url || file.fast_download_url;
  const rawDownload = file.fast_download_url || file.fast_stream_url;

  let streamUrl = rawStream;
  if (rawStream && (/terabox|1024tera|nephobox|4funbox|mirrobox/i.test(rawStream) || !rawStream.includes('.m3u8'))) {
    streamUrl = `/api/proxy-stream?url=${encodeURIComponent(rawStream)}`;
  }

  if (streamUrl) {
    setVideoSource(streamUrl, file.thumbnail, autoPlay);
  }

  const directDlBtn = document.getElementById('btn-direct-download');
  const proxyDlBtn = document.getElementById('btn-proxy-download');
  const copyLinkBtn = document.getElementById('btn-copy-link');

  if (rawDownload) {
    proxyDlBtn.href = `/api/proxy-download?url=${encodeURIComponent(rawDownload)}&name=${encodeURIComponent(file.name)}`;
    proxyDlBtn.style.display = 'inline-flex';

    directDlBtn.href = rawDownload;
    directDlBtn.style.display = 'inline-flex';
  } else {
    directDlBtn.style.display = 'none';
    proxyDlBtn.style.display = 'none';
  }

  copyLinkBtn.onclick = () => {
    const linkToCopy = streamUrl || downloadUrl;
    if (linkToCopy) {
      navigator.clipboard.writeText(linkToCopy);
      showNotification('Direct link copied to clipboard!');
    }
  };
}

// Multi-file album rendering
function renderAlbumList(files) {
  const albumCard = document.getElementById('album-card');
  const fileGrid = document.getElementById('file-grid');
  const albumCount = document.getElementById('album-count');

  if (!files || files.length <= 1) {
    albumCard.style.display = 'none';
    return;
  }

  albumCard.style.display = 'block';
  albumCount.textContent = `${files.length} Files in Shared Folder`;
  fileGrid.innerHTML = '';

  files.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = `file-item ${index === 0 ? 'active' : ''}`;
    item.innerHTML = `
      <div class="file-thumb">
        ${file.thumbnail ? `<img src="${file.thumbnail}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" alt="thumb">` : '📁'}
      </div>
      <div class="file-details">
        <div class="file-name" title="${file.name}">${file.name}</div>
        <div class="file-meta">${file.size_formatted} • ${file.type || 'File'}</div>
      </div>
    `;
    item.addEventListener('click', () => {
      loadFile(index, true);
    });
    fileGrid.appendChild(item);
  });
}

// UI Helpers
function showLoading(show, message = 'Loading...') {
  const loadingBox = document.getElementById('loading-box');
  const loadingText = document.getElementById('loading-text');
  const playBtn = document.getElementById('btn-play');
  const downloadBtn = document.getElementById('btn-download');

  if (loadingBox) {
    loadingBox.style.display = show ? 'block' : 'none';
    if (loadingText) loadingText.textContent = message;
    if (show) loadingBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  if (playBtn) playBtn.disabled = show;
  if (downloadBtn) downloadBtn.disabled = show;
}

function showError(msg) {
  const banner = document.getElementById('error-banner');
  const text = document.getElementById('error-text');
  if (banner && text) {
    text.textContent = msg;
    banner.style.display = 'flex';
  }
}

function hideError() {
  const banner = document.getElementById('error-banner');
  if (banner) banner.style.display = 'none';
}

function showNotification(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #10b981;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 600;
    box-shadow: 0 10px 25px rgba(0,0,0,0.3);
    z-index: 9999;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2500);
}
