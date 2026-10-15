/**
 * Direct TeraBox Share Resolver
 * Parses short codes from various TeraBox domains and queries official/mirror share list APIs.
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

async function resolveDirectTeraBox(url) {
  const shorturls = extractShortUrls(url);
  if (shorturls.length === 0) {
    return {
      success: false,
      provider: 'direct',
      error: 'Invalid TeraBox URL format.'
    };
  }

  for (const shorturl of shorturls) {
    const apiUrls = [
      `https://www.terabox.app/share/list?app_id=250528&shorturl=${shorturl}&root=1`,
      `https://1024terabox.com/share/list?app_id=250528&shorturl=${shorturl}&root=1`
    ];

    for (const apiUrl of apiUrls) {
      try {
        const resp = await fetch(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www.terabox.app/'
          },
          signal: AbortSignal.timeout(8000)
        });

        if (!resp.ok) continue;

        const data = await resp.json();
        if (data.errno === 0 && data.list && data.list.length > 0) {
          return {
            success: true,
            provider: 'direct_terabox',
            list: data.list.map(item => ({
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
      } catch (err) {
        // continue
      }
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
