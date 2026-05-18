const { Router } = require('express');
const axios = require('axios');
const youtube = require('./scraper');
const { searchCache, streamCache, metadataCache, isStreamExpired } = require('./cache');
const { trim } = require('./normalize');

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────
const VIDEO_ID_REGEX = /^[0-9A-Za-z_-]{11}$/;
const MAX_QUERY_LENGTH = 200;

// ── Validators ────────────────────────────────────────────────────────────
function isValidVideoId(id) {
  return VIDEO_ID_REGEX.test(id);
}

function requireValidVideoId(req, res, next) {
  const id = trim(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'missing_id', message: 'Video ID is required' });
  }
  if (!isValidVideoId(id)) {
    return res.status(400).json({
      error: 'invalid_id',
      message: 'Invalid video ID format. YouTube video IDs are exactly 11 characters containing letters, numbers, underscores, and hyphens.',
    });
  }
  next();
}

// ── Search ────────────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  const q = trim(req.query.q);
  if (!q) {
    return res.status(400).json({ error: 'missing_query', message: 'Query parameter "q" is required' });
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: 'query_too_long', message: `Query must be ${MAX_QUERY_LENGTH} characters or fewer` });
  }

  const cacheKey = `search:youtube:${q.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const result = await youtube.search(q);
    searchCache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    if (err.message?.includes('unavailable') || err.message?.includes('timed out') || err.message?.includes('returned 5')) {
      return res.status(503).json({ error: 'source_unavailable', source: 'youtube', message: 'YouTube search is temporarily unavailable' });
    }
    console.error('[youtube] search error:', err.message);
    res.status(500).json({ error: 'search_failed', source: 'youtube', message: 'Search failed. Please try again.' });
  }
});

// ── Suggestions ───────────────────────────────────────────────────────────
router.get('/suggestions', async (req, res) => {
  const q = trim(req.query.q);
  if (!q) {
    return res.status(400).json({ error: 'missing_query', message: 'Query parameter "q" is required' });
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: 'query_too_long', message: `Query must be ${MAX_QUERY_LENGTH} characters or fewer` });
  }

  const cacheKey = `suggestions:youtube:${q.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const result = await youtube.getSuggestions(q);
    searchCache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    if (err.message?.includes('unavailable') || err.message?.includes('timed out')) {
      return res.status(503).json({ error: 'source_unavailable', source: 'youtube', message: 'YouTube suggestions are temporarily unavailable' });
    }
    console.error('[youtube] suggestions error:', err.message);
    res.status(500).json({ error: 'suggestions_failed', source: 'youtube', message: 'Suggestions failed. Please try again.' });
  }
});

// ── Video details ─────────────────────────────────────────────────────────
router.get('/video/:id', requireValidVideoId, async (req, res) => {
  const id = trim(req.params.id);

  // Only cache the stable metadata portion. Stream URLs expire (CDN TTL) so
  // they must never be served from the metadata cache — they have their own
  // streamCache with expiry checks.
  const cacheKey = `video:youtube:${id}`;
  const cached = metadataCache.get(cacheKey);
  if (cached) {
    // Re-attach a fresh stream if available, otherwise return without stream.
    const streamCacheKey = `stream:youtube:${id}`;
    let streamData = streamCache.get(streamCacheKey);
    if (streamData && isStreamExpired(streamData)) {
      streamCache.del(streamCacheKey);
      streamData = null;
    }
    const stream = streamData
      ? { url: streamData.stream_url, quality: streamData.quality, format: streamData.format, headers: streamData.headers }
      : null;
    return res.json({ ...cached, stream });
  }

  try {
    const result = await youtube.getVideoDetails(id);
    // Store only the stable metadata fields — strip the stream before caching.
    const { stream, ...metadata } = result;
    metadataCache.set(cacheKey, metadata);

    // Cache the stream separately if present.
    if (stream?.url) {
      const streamCacheKey = `stream:youtube:${id}`;
      streamCache.set(streamCacheKey, {
        id,
        source: 'youtube',
        stream_url: stream.url,
        quality: stream.quality,
        format: stream.format,
        expires_at: null,
        headers: stream.headers,
      });
    }

    res.json(result);
  } catch (err) {
    if (err.message?.includes('not found') || err.message?.includes('not_found') || err.message?.includes('Video not found') || err.message?.includes('No video id found')) {
      return res.status(404).json({ error: 'video_not_found', source: 'youtube', message: 'Video not found' });
    }
    if (err.message?.includes('private')) {
      return res.status(403).json({ error: 'video_private', source: 'youtube', message: 'This video is private' });
    }
    if (err.message?.includes('copyright') || err.message?.includes('blocked')) {
      return res.status(451).json({ error: 'video_blocked', source: 'youtube', message: 'This video is blocked due to copyright' });
    }
    if (err.message?.includes('unavailable') || err.message?.includes('timed out')) {
      return res.status(503).json({ error: 'source_unavailable', source: 'youtube', message: 'YouTube is temporarily unavailable' });
    }
    if (err.message?.includes('Unsupported URL')) {
      return res.status(400).json({ error: 'invalid_id', source: 'youtube', message: 'Invalid video ID format' });
    }
    console.error('[youtube] video error:', err.message);
    res.status(500).json({ error: 'video_failed', source: 'youtube', message: 'Failed to retrieve video. Please try again.' });
  }
});

// ── Stream URL ────────────────────────────────────────────────────────────
router.get('/video/:id/stream', requireValidVideoId, async (req, res) => {
  const id = trim(req.params.id);

  const cacheKey = `stream:youtube:${id}`;
  let cached = streamCache.get(cacheKey);

  if (cached) {
    if (isStreamExpired(cached)) {
      streamCache.del(cacheKey);
      cached = null;
    } else {
      return res.json(cached);
    }
  }

  try {
    const result = await youtube.getStreamUrl(id);
    streamCache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    if (err.message?.includes('not found') || err.message?.includes('Video not found') || err.message?.includes('Unsupported URL')) {
      return res.status(404).json({ error: 'video_not_found', source: 'youtube', message: 'Video not found' });
    }
    if (err.message?.includes('No playable') || err.message?.includes('requested format not available')) {
      return res.status(404).json({ error: 'no_stream', source: 'youtube', message: 'No playable audio format available for this video' });
    }
    if (err.message?.includes('private')) {
      return res.status(403).json({ error: 'video_private', source: 'youtube', message: 'This video is private' });
    }
    if (err.message?.includes('unavailable') || err.message?.includes('timed out') || err.message?.includes('HTTP Error')) {
      return res.status(503).json({ error: 'source_unavailable', source: 'youtube', message: 'YouTube is temporarily unavailable' });
    }
    console.error('[youtube] stream error:', err.message);
    res.status(500).json({ error: 'stream_failed', source: 'youtube', message: 'Failed to retrieve stream. Please try again.' });
  }
});

// ── Proxy audio stream (direct playback) ─────────────────────────────────
router.get('/video/:id/play', requireValidVideoId, async (req, res) => {
  const id = trim(req.params.id);

  try {
    const cacheKey = `stream:youtube:${id}`;
    let streamData = streamCache.get(cacheKey);

    if (streamData && isStreamExpired(streamData)) {
      streamCache.del(cacheKey);
      streamData = null;
    }

    if (!streamData) {
      streamData = await youtube.getStreamUrl(id);
      streamCache.set(cacheKey, streamData);
    }

    if (!streamData.stream_url) {
      return res.status(404).json({ error: 'no_stream', message: 'No playable stream URL found for this video' });
    }

    const range = req.headers.range;
    const axiosConfig = {
      method: 'get',
      url: streamData.stream_url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com',
      },
      timeout: 30000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    };

    if (range) {
      axiosConfig.headers['Range'] = range;
    }

    const cdnRes = await axios(axiosConfig);

    const contentType = cdnRes.headers['content-type'];
    res.set('Content-Type', contentType || 'audio/mp4');

    if (cdnRes.headers['content-length']) {
      res.set('Content-Length', cdnRes.headers['content-length']);
    }
    if (cdnRes.headers['accept-ranges']) {
      res.set('Accept-Ranges', cdnRes.headers['accept-ranges']);
    } else {
      res.set('Accept-Ranges', 'bytes');
    }
    if (range && cdnRes.headers['content-range']) {
      res.set('Content-Range', cdnRes.headers['content-range']);
    }
    if (cdnRes.status === 206) {
      res.status(206);
    }

    cdnRes.data.on('error', (streamErr) => {
      console.error('[youtube] proxy stream error for', id, streamErr.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'proxy_stream_error', message: 'Stream error occurred' });
      } else {
        res.end();
      }
    });

    req.on('close', () => {
      cdnRes.data.destroy();
    });

    cdnRes.data.pipe(res);
  } catch (err) {
    console.error('[youtube] proxy error:', err.message);
    if (err.message?.includes('Video not found') || err.message?.includes('not found') || err.message?.includes('Unsupported URL')) {
      return res.status(404).json({ error: 'video_not_found', message: 'Video not found' });
    }
    if (err.message?.includes('private')) {
      return res.status(403).json({ error: 'video_private', message: 'This video is private' });
    }
    if (err.message?.includes('No playable') || err.message?.includes('requested format not available')) {
      return res.status(404).json({ error: 'no_stream', message: 'No playable audio format found for this video' });
    }
    if (err.response?.status === 403 || err.message?.includes('403')) {
      return res.status(502).json({ error: 'proxy_forbidden', message: 'Stream source rejected the request. The CDN may be blocking this server.' });
    }
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'proxy_timeout', message: 'Stream source timed out' });
    }
    res.status(502).json({ error: 'proxy_error', message: 'Failed to proxy stream' });
  }
});

// ── Health check ──────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'youtube',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

module.exports = router;
