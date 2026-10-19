/**
 * iTeraPlay Reverse-Engineered Resolver
 * Automatically creates and refreshes guest session cookies and queries iTeraPlay's backend API.
 * Includes dynamic IP forwarding to eliminate 429 guest usage limits.
 */

function generateRandomIp() {
  const o1 = Math.floor(Math.random() * 200) + 11;
  const o2 = Math.floor(Math.random() * 254) + 1;
  const o3 = Math.floor(Math.random() * 254) + 1;
  const o4 = Math.floor(Math.random() * 254) + 1;
  return `${o1}.${o2}.${o3}.${o4}`;
}

function getHeaders(ip) {
  const clientIp = ip || generateRandomIp();
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Forwarded-For': clientIp,
    'Client-IP': clientIp,
    'X-Real-IP': clientIp
  };
}

async function createFreshSession(ip) {
  try {
    const headers = getHeaders(ip);
    const res = await fetch('https://iteraplay.com/', {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(4000)
    });

    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    const cookieMap = {};

    for (const header of setCookies) {
      const parts = header.split(';');
      const [key, val] = parts[0].trim().split('=');
      if (key && val) {
        cookieMap[key] = val;
      }
    }

    if (!cookieMap['__secure_token'] && !cookieMap['session_id']) {
      const singleHeader = res.headers.get('set-cookie') || '';
      const regex = /(__secure_token|session_id)=([^;]+)/g;
      let m;
      while ((m = regex.exec(singleHeader)) !== null) {
        cookieMap[m[1]] = m[2];
      }
    }

    const cookieString = Object.entries(cookieMap)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    return { cookie: cookieString, ip };
  } catch (err) {
    console.error('[iTeraPlay Session] Failed to initialize session:', err.message);
    return null;
  }
}

function extractStreamUrl(item) {
  if (!item) return null;
  if (typeof item.fast_stream_url === 'string') return item.fast_stream_url;
  if (typeof item.fast_stream_url === 'object' && item.fast_stream_url) {
    return item.fast_stream_url['1080p'] || 
           item.fast_stream_url['720p'] || 
           item.fast_stream_url['480p'] || 
           item.fast_stream_url['360p'] || 
           Object.values(item.fast_stream_url)[0];
  }
  return item.normal_dlink || item.fast_download_url || item.download_link || item.dlink || null;
}

function extractDownloadUrl(item) {
  if (!item) return null;
  return item.normal_dlink || item.fast_download_url || item.download_link || item.dlink || extractStreamUrl(item);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function resolveIteraPlay(url, endpoint = '/api/stream') {
  // Always use a fresh virtual client IP so the 5 plays/6 hours limit NEVER triggers
  const clientIp = generateRandomIp();
  const session = await createFreshSession(clientIp);
  const cookie = session ? session.cookie : '';

  const postHeaders = {
    ...getHeaders(clientIp),
    'Origin': 'https://iteraplay.com',
    'Referer': 'https://iteraplay.com/',
    'Content-Type': 'application/json',
    'Cookie': cookie,
  };

  const response = await fetch(`https://iteraplay.com${endpoint}`, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(6000)
  });

  let data;
  try {
    data = await response.json();
  } catch (e) {
    const text = await response.text();
    throw new Error(`iTeraPlay returned invalid JSON: ${text.substring(0, 100)}`);
  }

  if (data.status === 'success' && data.list && data.list.length > 0) {
    return {
      success: true,
      provider: 'iteraplay',
      list: data.list.map(item => {
        const streamUrl = extractStreamUrl(item);
        const downloadUrl = extractDownloadUrl(item);
        return {
          name: item.name || 'Untitled Video',
          size: item.size || 0,
          size_formatted: item.size_formatted || formatBytes(item.size || 0),
          fast_stream_url: streamUrl,
          fast_download_url: downloadUrl,
          stream_qualities: typeof item.fast_stream_url === 'object' ? item.fast_stream_url : null,
          thumbnail: item.thumbnail || null,
          duration: item.duration || '0:00',
          subtitle_url: item.subtitle_url || null,
          type: item.type || (item.name && item.name.match(/\.(mp4|mkv|webm|mov|avi)$/i) ? 'video' : 'file')
        };
      }),
      total_folders: data.total_folders || 0,
      zip_download_link: data.zip_download_link || null
    };
  }

  return {
    success: false,
    provider: 'iteraplay',
    error: data.details || data.error_detail || data.error || data.message || 'Failed to resolve link'
  };
}

module.exports = {
  resolveIteraPlay
};
