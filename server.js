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
  const debug = {
    hasCookie: Boolean(process.env.TERABOX_COOKIE || process.env.NDUS),
    cookieLength: (process.env.TERABOX_COOKIE || '').length,
    cookieSnippet: process.env.TERABOX_COOKIE ? (process.env.TERABOX_COOKIE.substring(0, 10) + '...') : 'NONE'
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

// Video Streaming Proxy (Zero-disk cache, in-memory stream pipe only)
app.get('/api/proxy-stream', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL query parameter required');
  }

  try {
    const client = targetUrl.startsWith('https:') ? https : http;
    const clientReqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': 'https://iteraplay.com/',
    };

    if (req.headers.range) {
      clientReqHeaders['Range'] = req.headers.range;
    }

    const proxyReq = client.get(targetUrl, { headers: clientReqHeaders }, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        return res.redirect(`/api/proxy-stream?url=${encodeURIComponent(proxyRes.headers.location)}`);
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

  try {
    const client = targetUrl.startsWith('https:') ? https : http;
    const clientReqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://iteraplay.com/',
    };

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

app.listen(PORT, () => {
  console.log(`🚀 TeraPlay (Zero-Trace Mode) running at: http://localhost:${PORT}`);
});
