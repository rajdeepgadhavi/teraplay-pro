const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const https = require('https');
const { resolveLink } = require('./resolvers');

const app = express();
const PORT = process.env.PORT || 3000;

// Anti-Trace & Zero-Log Headers Middleware
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.removeHeader('X-Powered-By');
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  }
}));

// API: Stream resolver (Zero logs)
app.post('/api/stream', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ status: 'error', message: 'URL is required.' });
    }
    const result = await resolveLink(url, 'stream');
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Resolution failed.' });
  }
});

// API: Download resolver (Zero logs)
app.post('/api/download', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ status: 'error', message: 'URL is required.' });
    }
    const result = await resolveLink(url, 'download');
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Resolution failed.' });
  }
});

// API: Debug endpoint to diagnose cloud environment
app.get('/api/debug-resolve', async (req, res) => {
  const url = req.query.url || 'https://terasharelink.com/s/1qRyqtHe4m7FCycqpsiEDsA';
  const cookieVal = process.env.TERABOX_COOKIE || process.env.NDUS || process.env.ndus || process.env.COOKIE || process.env.cookie || process.env.TERABOX_NDUS || '';
  const debug = {
    hasCookie: Boolean(cookieVal),
    cookieLength: cookieVal.length,
    cookieSnippet: cookieVal ? (cookieVal.substring(0, 10) + '...') : 'NONE',
    envKeysFound: Object.keys(process.env).filter(k => /ndus|cookie|terabox/i.test(k))
  };

  try {
    const { resolveDirectTeraBox } = require('./resolvers/terabox_direct');
    debug.directRes = await resolveDirectTeraBox(url);
  } catch (e) {
    debug.directErr = e.message;
  }
  
  try {
    const t0 = Date.now();
    const r1 = await fetch('https://iteraplay.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(8000)
    });
    debug.iteraplay_home = {
      status: r1.status,
      timeMs: Date.now() - t0,
      preview: (await r1.text()).substring(0, 150)
    };
  } catch (e) {
    debug.iteraplay_home_err = e.message;
  }

  return res.json(debug);
});

// In-memory cache for CDN redirect locations to bypass 700ms 302 handshake on every chunk
const cdnRedirectCache = new Map();

// Video Streaming Proxy (Zero-disk cache, in-memory stream pipe only)
app.get('/api/proxy-stream', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL query parameter required');
  }

  const cookieVal = process.env.TERABOX_COOKIE || 
                    process.env.NDUS || 
                    process.env.ndus || 
                    process.env.COOKIE || 
                    process.env.cookie || 
                    process.env.TERABOX_NDUS || '';
  let ndus = cookieVal;
  if (cookieVal.includes('ndus=')) {
    const match = cookieVal.match(/ndus=([^;]+)/);
    if (match) ndus = match[1].trim();
  }

  try {
    const isTeraBox = /terabox|1024tera|nephobox|4funbox|mirrobox/i.test(targetUrl);
    const clientReqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': isTeraBox ? 'https://www.terabox.app/' : 'https://iteraplay.com/',
    };

    if (ndus && isTeraBox) {
      clientReqHeaders['Cookie'] = `ndus=${ndus}; lang=en`;
    }

    // 3.5 MB chunks: maximizes buffer speed while staying safely under Vercel's 4.5 MB payload limit
    const CHUNK_SIZE = Math.floor(3.5 * 1024 * 1024);
    if (req.headers.range) {
      const parts = req.headers.range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10) || 0;
      let end = parts[1] ? parseInt(parts[1], 10) : (start + CHUNK_SIZE - 1);
      if (end - start + 1 > CHUNK_SIZE) {
        end = start + CHUNK_SIZE - 1;
      }
      clientReqHeaders['Range'] = `bytes=${start}-${end}`;
    } else {
      clientReqHeaders['Range'] = `bytes=0-${CHUNK_SIZE - 1}`;
    }

    // Fast-path: Check if we already have the direct CDN node cached
    let initialUrl = targetUrl;
    const cachedRedirect = cdnRedirectCache.get(targetUrl);
    if (cachedRedirect && (Date.now() - cachedRedirect.time < 30 * 60 * 1000)) {
      initialUrl = cachedRedirect.url;
    }

    function makeStreamRequest(currentUrl, redirectCount = 0) {
      if (redirectCount > 5) {
        if (!res.headersSent) res.status(502).send('Too many redirects');
        return;
      }
      const client = currentUrl.startsWith('https:') ? https : http;
      const proxyReq = client.get(currentUrl, { headers: clientReqHeaders }, (proxyRes) => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          cdnRedirectCache.set(targetUrl, { url: proxyRes.headers.location, time: Date.now() });
          return makeStreamRequest(proxyRes.headers.location, redirectCount + 1);
        }

        // If cached CDN node returned 403 or error, evict cache and retry from original URL
        if (proxyRes.statusCode === 403 && currentUrl !== targetUrl) {
          cdnRedirectCache.delete(targetUrl);
          return makeStreamRequest(targetUrl, redirectCount + 1);
        }

        res.status(proxyRes.statusCode);

        const forwardHeaders = ['content-range', 'content-length', 'content-type', 'accept-ranges'];
        for (const h of forwardHeaders) {
          if (proxyRes.headers[h]) {
            res.setHeader(h, proxyRes.headers[h]);
          }
        }

        if (!proxyRes.headers['content-type'] || proxyRes.headers['content-type'].includes('application/octet-stream')) {
          res.setHeader('Content-Type', 'video/mp4');
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

        proxyRes.pipe(res);
      });

      proxyReq.on('error', () => {
        if (!res.headersSent) res.status(502).send('Stream error');
      });

      req.on('close', () => {
        proxyReq.destroy();
      });
    }

    makeStreamRequest(targetUrl);

  } catch {
    if (!res.headersSent) res.status(500).send('Stream error');
  }
});

// Direct Download Proxy
app.get('/api/proxy-download', async (req, res) => {
  const targetUrl = req.query.url;
  const filename = req.query.name || 'video.mp4';
  if (!targetUrl) {
    return res.status(400).send('URL query parameter required');
  }

  const cookieVal = process.env.TERABOX_COOKIE || 
                    process.env.NDUS || 
                    process.env.ndus || 
                    process.env.COOKIE || 
                    process.env.cookie || 
                    process.env.TERABOX_NDUS || '';
  let ndus = cookieVal;
  if (cookieVal.includes('ndus=')) {
    const match = cookieVal.match(/ndus=([^;]+)/);
    if (match) ndus = match[1].trim();
  }

  try {
    const client = targetUrl.startsWith('https:') ? https : http;
    const isTeraBox = /terabox|1024tera|nephobox|4funbox|mirrobox/i.test(targetUrl);
    const clientReqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': isTeraBox ? 'https://www.terabox.app/' : 'https://iteraplay.com/',
    };

    if (ndus && isTeraBox) {
      clientReqHeaders['Cookie'] = `ndus=${ndus}; lang=en`;
    }

    const proxyReq = client.get(targetUrl, { headers: clientReqHeaders }, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        return res.redirect(`/api/proxy-download?url=${encodeURIComponent(proxyRes.headers.location)}&name=${encodeURIComponent(filename)}`);
      }

      res.status(proxyRes.statusCode);
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

      proxyRes.pipe(res);
    });

    proxyReq.on('error', () => {
      if (!res.headersSent) res.status(502).send('Download error');
    });

    req.on('close', () => {
      proxyReq.destroy();
    });

  } catch {
    if (!res.headersSent) res.status(500).send('Download error');
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    mode: 'zero-trace',
    app: 'TeraPlay Pro',
    version: '1.0.0'
  });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 TeraPlay (Zero-Trace Mode) running at: http://localhost:${PORT}`);
  });
}

module.exports = app;
