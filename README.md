---
title: OpenMusic YouTube Server
emoji: 🎵
colorFrom: red
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# OpenMusic YouTube Server

A YouTube video metadata and audio streaming API proxy. No API keys, no sign-up, no database. Just a JSON API, a built-in admin panel, and audio playback in the browser.

---

## Deploy on HuggingFace Spaces

1. Create a new Space → select **Docker** as the SDK
2. Push this repository to the Space
3. The app will be available at `https://<your-space>.hf.space`

The admin panel is at the root URL. The API base is `/api`.

> `yt-dlp` is installed automatically inside the Docker image — no manual setup needed.

---

## Deploy locally

```bash
npm install
npm start
```

Opens on `http://localhost:7860`. Hit `/api/health` to check.

> **Requires `yt-dlp`** to be installed and available on PATH.
>
> Install: `pip install yt-dlp` or download from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases).

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/search?q=<query>` | Search YouTube videos |
| `GET` | `/api/suggestions?q=<query>` | Autocomplete suggestions |
| `GET` | `/api/video/:id` | Video metadata + stream info |
| `GET` | `/api/video/:id/stream` | Stream URL only |
| `GET` | `/api/video/:id/play` | **Proxy audio stream** (pipe through server) |
| `GET` | `/api/health` | Health check + uptime |

---

## Copy-Paste Examples

### JavaScript (fetch)

```javascript
const BASE = 'https://<your-space>.hf.space'; // or http://localhost:7860

// Search videos
const searchRes = await fetch(`${BASE}/api/search?q=never gonna give you up`);
const searchData = await searchRes.json();
console.log(searchData.results);
// [{ id, title, channel, duration_label, duration_seconds, thumbnail, views }, ...]

// Get video metadata + stream info
const videoRes = await fetch(`${BASE}/api/video/dQw4w9WgXcQ`);
const videoData = await videoRes.json();
console.log(videoData.title, videoData.stream.url);

// Get stream URL only
const streamRes = await fetch(`${BASE}/api/video/dQw4w9WgXcQ/stream`);
const streamData = await streamRes.json();
console.log(streamData.stream_url);  // ← direct CDN audio URL

// Play audio in browser (uses server-side proxy)
const audio = new Audio();
audio.src = `${BASE}/api/video/dQw4w9WgXcQ/play`;
audio.play();

// Suggestions
const sugRes = await fetch(`${BASE}/api/suggestions?q=never`);
const sugData = await sugRes.json();
console.log(sugData.suggestions);  // ['never gonna give you up', ...]
```

### Python (requests)

```python
import requests

BASE = 'https://<your-space>.hf.space'

search = requests.get(f'{BASE}/api/search', params={'q': 'never gonna give you up'}).json()
print(search['results'][0]['title'])

video = requests.get(f'{BASE}/api/video/dQw4w9WgXcQ').json()
print(video['title'], video['stream']['quality'])

stream = requests.get(f'{BASE}/api/video/dQw4w9WgXcQ/stream').json()
print('Stream URL:', stream['stream_url'])
```

### cURL

```bash
BASE=https://<your-space>.hf.space

# Search
curl "$BASE/api/search?q=never+gonna+give+you+up"

# Video metadata
curl "$BASE/api/video/dQw4w9WgXcQ"

# Stream URL only
curl "$BASE/api/video/dQw4w9WgXcQ/stream"

# Health check
curl "$BASE/api/health"
```

---

## Response Shapes

Every endpoint returns JSON.

### Search results

```json
{
  "source": "youtube",
  "query": "never gonna give you up",
  "results": [
    {
      "id": "dQw4w9WgXcQ",
      "title": "Rick Astley - Never Gonna Give You Up (Official Music Video)",
      "channel": { "id": "UCuAXFkgsw1L7xaCfnd5JJOw", "name": "Rick Astley" },
      "duration_seconds": 213,
      "duration_label": "3:33",
      "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "views": "1.5B views",
      "is_live": false
    }
  ],
  "total": 20
}
```

### Video details

```json
{
  "source": "youtube",
  "id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up (Official Music Video)",
  "description": "The official video for...",
  "channel": { "id": "UCuAXFkgsw1L7xaCfnd5JJOw", "name": "Rick Astley" },
  "duration_seconds": 213,
  "duration_label": "3:33",
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "views": "1.5B views",
  "uploaded_date": "20091025",
  "is_live": false,
  "is_private": false,
  "stream": {
    "url": "https://rr1---sn-xxx.googlevideo.com/...",
    "quality": "128kbps",
    "format": "m4a",
    "headers": { "User-Agent": "...", "Referer": "https://www.youtube.com/" }
  }
}
```

### Stream URL

```json
{
  "id": "dQw4w9WgXcQ",
  "source": "youtube",
  "stream_url": "https://rr1---sn-xxx.googlevideo.com/videoplayback?...",
  "quality": "128kbps",
  "format": "m4a",
  "expires_at": null,
  "headers": {
    "User-Agent": "Mozilla/5.0 ...",
    "Referer": "https://www.youtube.com/"
  }
}
```

### Suggestions

```json
{
  "source": "youtube",
  "query": "never",
  "suggestions": ["never gonna give you up", "never say never", "never enough"]
}
```

### Health check

```json
{
  "status": "ok",
  "service": "youtube",
  "timestamp": "2026-05-19T10:00:00.000Z",
  "uptime": 3600.42
}
```

---

## How It Works

```
Browser / App → Express → Scraper (ytdl-core + yt-dlp fallback) → Normalizer → Cache → JSON
```

- Each request checks an in-memory cache first
- On a miss, the scraper fetches from YouTube, normalizes the response, caches it, and returns JSON
- `ytdl-core` is the primary source for video info; `yt-dlp` is the fallback if ytdl-core fails
- Stream URLs are extracted via `yt-dlp -g` and cached separately from metadata
- `/api/video/:id/play` proxies the audio through the server to bypass CORS and Referer restrictions, with full byte-range support for seeking

### Cache TTLs

| Cache | TTL | Endpoints |
|---|---|---|
| Search / Suggestions | 5 min | `/search`, `/suggestions` |
| Video metadata | 10 min | `/video/:id` |
| Stream URLs | 25 min | `/video/:id/stream`, `/video/:id/play` |

Stream URLs are also checked against their CDN expiry timestamp before being served from cache — expired entries are evicted and re-fetched automatically.

---

## Built-in Admin Panel

Open the root URL in a browser. There's a dark-themed single-page app with five tabs:

- **Dashboard** — server status, uptime, and live cache stats
- **Search** — search YouTube and browse results with thumbnails
- **Video Info** — look up full metadata for any video ID
- **Stream Test** — play audio directly in the browser via the proxy
- **API Console** — fire raw API requests and inspect responses

All vanilla JS, zero frameworks.

---

## Rate Limiting

60 requests per minute per IP across all `/api` routes. After that:

```json
{ "error": "rate_limited", "message": "Too many requests, please try again later" }
```

---

## Tech Stack

| Layer | Tool |
|---|---|
| Runtime | Node.js 20 |
| Web framework | Express 4 |
| HTTP client | Axios |
| Video info | @distube/ytdl-core |
| Stream extraction | yt-dlp (installed in Docker image) |
| Search | youtube-search-api |
| Caching | node-cache (in-memory) |
| Rate limiting | express-rate-limit |
| Security headers | helmet |
| Request logging | morgan |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7860` | Server port (matches HuggingFace `app_port`) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin. Set to your client URL in production |
| `NODE_ENV` | `production` | Set automatically in Docker image |

---

## Error Responses

All errors follow the same shape:

```json
{ "error": "error_code", "message": "Human-readable description" }
```

| HTTP Status | Error Code | Meaning |
|---|---|---|
| `400` | `missing_query` | `q` param not provided |
| `400` | `query_too_long` | Query exceeds 200 characters |
| `400` | `invalid_id` | Video ID is not a valid 11-character YouTube ID |
| `403` | `video_private` | Video is private |
| `404` | `video_not_found` | Video does not exist or was removed |
| `404` | `no_stream` | No playable audio format available |
| `429` | `rate_limited` | Too many requests |
| `451` | `video_blocked` | Video blocked due to copyright |
| `500` | `*_failed` | Internal error — retry |
| `502` | `proxy_error` | Upstream CDN error during stream proxy |
| `503` | `source_unavailable` | YouTube temporarily unreachable |

---

## Why This Exists

Personal YouTube audio proxy. Pulls what the official API won't give you directly. Streams what apps lock behind accounts. Use at your own risk; no warranty, no guarantees.
