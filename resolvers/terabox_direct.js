/**
 * Direct TeraBox Share Resolver
 * Parses short codes from various TeraBox domains and queries official share APIs.
 * Supports authenticated resolution via TERABOX_COOKIE (ndus) to bypass Cloudflare and datacenter blocks.
 */

function extractShortUrls(url) {
  if (!url) return [];
  const trimmed = url.trim();
  const codes = new Set();

  // Pattern: /s/1... or /s/0... or /s/...
  const sMatch = trimmed.match(/\/s\/([a-zA-Z0-9_-]+)/i);
  if (sMatch) {
    const raw = sMatch[1];
    codes.add(raw);
    if (raw.startsWith('1')) {
      codes.add(raw.slice(1));
    } else {
      codes.add('1' + raw);
    }
  }

  // Pattern: ?surl=... or &surl=...
  const surlMatch = trimmed.match(/[?&]surl=([a-zA-Z0-9_-]+)/i);
  if (surlMatch) {
    const raw = surlMatch[1];
    codes.add(raw);
    if (raw.startsWith('1')) {
      codes.add(raw.slice(1));
    } else {
      codes.add('1' + raw);
    }
  }

  // Pattern: ?shorturl=...
  const shorturlMatch = trimmed.match(/[?&]shorturl=([a-zA-Z0-9_-]+)/i);
  if (shorturlMatch) {
    const raw = shorturlMatch[1];
    codes.add(raw);
    if (raw.startsWith('1')) {
      codes.add(raw.slice(1));
    } else {
      codes.add('1' + raw);
    }
  }

  return Array.from(codes);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getNdusCookie() {
  const envCookie = process.env.TERABOX_COOKIE || process.env.NDUS || '';
  if (!envCookie) return '';
  if (envCookie.includes('ndus=')) {
    const match = envCookie.match(/ndus=([^;]+)/);
    return match ? match[1].trim() : '';
  }
  return envCookie.trim();
}

async function resolveDirectTeraBox(url) {
  const ndus = getNdusCookie();
  const shorturls = extractShortUrls(url);
  if (shorturls.length === 0) {
    return {
      success: false,
      provider: 'direct',
      error: 'Invalid TeraBox URL format.'
    };
  }

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  for (const shorturl of shorturls) {
    const cleanSurl = shorturl.startsWith('1') ? shorturl.slice(1) : shorturl;

    // Strategy A: Authenticated API flow using ndus (Official dm.terabox.app endpoint)
    if (ndus) {
      try {
        const firstUrl = `https://dm.terabox.app/sharing/link?surl=${cleanSurl}`;
        const firstRes = await fetch(firstUrl, {
          headers: {
            'User-Agent': userAgent,
            'Cookie': `ndus=${ndus}; lang=en`,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(10000)
        });

        const firstHtml = await firstRes.text();
        const tokenMatch = firstHtml.match(/fn%28%22(.*?)%22%29/);
        const jsToken = tokenMatch ? tokenMatch[1] : '';

        const apiUrl = new URL('https://dm.terabox.app/share/list');
        apiUrl.searchParams.append('app_id', '250528');
        if (jsToken) apiUrl.searchParams.append('jsToken', jsToken);
        apiUrl.searchParams.append('site_referer', 'https://www.terabox.app/');
        apiUrl.searchParams.append('shorturl', cleanSurl);
        apiUrl.searchParams.append('root', '1');

        const apiRes = await fetch(apiUrl.toString(), {
          headers: {
            'Host': 'dm.terabox.app',
            'User-Agent': userAgent,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `https://dm.terabox.app/sharing/link?surl=${cleanSurl}&clearCache=1`,
            'Origin': 'https://dm.terabox.app',
            'Cookie': `ndus=${ndus}; lang=en`
          },
          signal: AbortSignal.timeout(10000)
        });

        const data = await apiRes.json();
        if (data.errno === 0 && data.list && data.list.length > 0) {
          return {
            success: true,
            provider: 'direct_terabox_auth',
            list: data.list.map(item => ({
              name: item.server_filename || item.filename || 'TeraBox Video',
              size: item.size || 0,
              size_formatted: formatBytes(item.size || 0),
              fast_stream_url: item.dlink || item.direct_link || (item.thumbs ? item.thumbs.url3 : null),
              fast_download_url: item.dlink || item.direct_link || null,
              thumbnail: item.thumbs ? (item.thumbs.url3 || item.thumbs.url2 || item.thumbs.url1) : null,
              duration: item.duration ? `${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, '0')}` : '0:00',
              subtitle_url: null,
              type: (item.category === '1' || item.category === 1 || (item.server_filename && item.server_filename.match(/\.(mp4|mkv|webm|mov|avi)$/i))) ? 'video' : 'file'
            })),
            total_folders: 0,
            zip_download_link: null
          };
        }
      } catch (err) {
        console.warn('[Direct TeraBox ndus] Failed:', err.message);
      }
    }

    // Strategy B: Public fallback without ndus
    const publicEndpoints = [
      `https://www.terabox.app/share/list?app_id=250528&shorturl=${shorturl}&root=1`,
      `https://1024terabox.com/share/list?app_id=250528&shorturl=${shorturl}&root=1`
    ];
    for (const ep of publicEndpoints) {
      try {
        const resp = await fetch(ep, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www.terabox.app/'
          },
          signal: AbortSignal.timeout(8000)
        });
        if (!resp.ok) continue;
        const d = await resp.json();
        if (d.errno === 0 && d.list && d.list.length > 0) {
          return {
            success: true,
            provider: 'direct_terabox_public',
            list: d.list.map(item => ({
              name: item.server_filename || item.filename || 'TeraBox File',
              size: item.size || 0,
              size_formatted: formatBytes(item.size || 0),
              fast_stream_url: item.dlink || item.direct_link || (item.thumbs ? item.thumbs.url3 : null),
              fast_download_url: item.dlink || item.direct_link || null,
              thumbnail: item.thumbs ? (item.thumbs.url3 || item.thumbs.url2 || item.thumbs.url1) : null,
              duration: item.duration ? `${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, '0')}` : '0:00',
              subtitle_url: null,
              type: (item.category === '1' || item.category === 1 || (item.server_filename && item.server_filename.match(/\.(mp4|mkv|webm|mov|avi)$/i))) ? 'video' : 'file'
            })),
            total_folders: 0,
            zip_download_link: null
          };
        }
      } catch (e) {}
    }
  }

  return {
    success: false,
    provider: 'direct',
    error: 'Link not accessible via direct share API.'
  };
}

module.exports = {
  extractShortUrls,
  resolveDirectTeraBox
};
