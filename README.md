# TeraPlay – Reverse Engineered TeraBox Online Player & Downloader

A full-stack, independent, and ad-free clone of [iteraplay.com](https://iteraplay.com/) built from reverse-engineering its network flow, Next.js client bundles, verification mechanisms, and streaming architecture.

---

## 🔍 Reverse Engineering Findings

1. **Frontend Architecture**:
   - Original site is built with **Next.js (App Router)** and utilizes **Plyr.js** for video playback.
   - All interactive actions send requests to internal API endpoints: `/api/stream` and `/api/download`.

2. **Session Verification & Security Flow**:
   - Requests directly to `/api/stream` without cookies yield `{"error": "cors_blocked"}` or `{"error": "token_missing"}`.
   - On the homepage (`/`), the server issues an encrypted HTTP session cookie: `__secure_token` and `session_id`.
   - The frontend passes `credentials: "include"`, which carries these session cookies.
   - Guest limits are tracked server-side (default limit: 5 plays per IP/session).
   - Our implementation incorporates automatic session rotation: when a session nears its guest play limit or expires, a new session token is automatically minted in milliseconds.

3. **Multi-Engine Resolution**:
   - **Tier 1 (iTeraPlay Engine Emulator)**: Proxies requests with dynamic token handshakes to extract high-speed streaming links (`fast_stream_url`, `fast_download_url`).
   - **Tier 2 (Direct TeraBox API)**: Direct queries to `https://www.terabox.app/share/list?app_id=250528&shorturl=...&root=1` extracting original `dlink` and file metadata.
   - **Tier 3 (Mirror Fallback)**: Supports mirrors (`1024terabox.com`, `teraboxshare.com`, `nephobox.com`, `4funbox.com`, `mirrobox.com`).

4. **Range-Enabled Streaming Proxy (`/api/proxy-stream`)**:
   - Solves CORS/Referer restrictions imposed by video CDNs.
   - Full support for HTTP `Range: bytes=start-end` chunking (HTTP 206 Partial Content), enabling fast seeking and playback scrub without buffering.

---

## 🚀 Getting Started

### 1. Requirements
- Node.js (v18+)

### 2. Run Server
```bash
npm start
```
The application will launch at: **`http://localhost:3000`**

---

## 📡 API Endpoints

### 1. Resolve Stream
- **URL**: `/api/stream`
- **Method**: `POST`
- **Payload**:
  ```json
  {
    "url": "https://terabox.com/s/1xxxxxxx"
  }
  ```
- **Response**:
  ```json
  {
    "status": "success",
    "provider": "iteraplay",
    "list": [
      {
        "name": "sample_video.mp4",
        "size": 52428800,
        "size_formatted": "50.0 MB",
        "fast_stream_url": "https://...",
        "fast_download_url": "https://...",
        "thumbnail": "https://...",
        "duration": "05:20",
        "type": "video"
      }
    ]
  }
  ```

### 2. Video Streaming Proxy
- **URL**: `/api/proxy-stream?url=<ENCODED_STREAM_URL>`
- **Method**: `GET`
- **Headers supported**: `Range: bytes=...` (enables scrubbing)

### 3. File Download Proxy
- **URL**: `/api/proxy-download?url=<ENCODED_URL>&name=<FILENAME>`
- **Method**: `GET`
- **Headers**: Returns `Content-Disposition: attachment; filename="..."`
