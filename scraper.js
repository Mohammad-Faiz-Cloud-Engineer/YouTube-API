const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const ytSearch = require('youtube-search-api');
const ytdl = require('@distube/ytdl-core');
const { normalizeSearch, normalizeVideo, normalizeStream } = require('./normalize');

// ── yt-dlp discovery ──────────────────────────────────────────────────────
// On Linux (Docker / HuggingFace Spaces) yt-dlp is installed to
// /usr/local/bin/yt-dlp by the Dockerfile.  On Windows (local dev) it is
// typically on PATH as yt-dlp or yt-dlp.exe.  We check the explicit Linux
// path first so the binary is found even if PATH is minimal inside the
// container, then fall back to PATH resolution for every other environment.
function findYtDlp() {
  const candidates = [
    '/usr/local/bin/yt-dlp',          // Docker / Linux (installed by Dockerfile)
    path.join(__dirname, 'bin', 'yt-dlp'), // local override (any platform)
    'yt-dlp',                          // PATH resolution (Linux / macOS)
    'yt-dlp.exe',                      // PATH resolution (Windows)
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // existsSync can throw on malformed paths; skip silently
    }
  }
  return 'yt-dlp';
}

const YTDLP_PATH = findYtDlp();
const YTDLP_OPTS = {
  maxBuffer: 10 * 1024 * 1024,
  timeout: 30000,
  windowsHide: true,
};

function execYtDlp(args) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP_PATH, args, YTDLP_OPTS, (err, stdout, stderr) => {
      if (err) {
        // Extract the first ERROR: line from stderr for a clean message;
        // fall back to the raw error message if none is found.
        const msg = stderr?.split('\n').find(l => l.includes('ERROR:'))?.trim() || err.message;
        reject(new Error(msg));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// ── Video info via ytdl-core ──────────────────────────────────────────────
async function getVideoInfoFromYtdl(videoId) {
  const info = await ytdl.getInfo(videoId, {
    requestOptions: {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    },
  });
  return normalizeVideo('youtube', {
    ...info.videoDetails,
    formats: info.formats || [],
  });
}

// ── Video info via yt-dlp (fallback) ─────────────────────────────────────
async function getVideoInfoFromYtDlp(videoId) {
  const json = await execYtDlp([
    '--dump-json',
    '--no-warnings',
    '--no-playlist',
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);
  const data = JSON.parse(json);
  return normalizeVideo('youtube', {
    videoId: data.id,
    title: data.title,
    description: data.description || '',
    channel: { id: data.channel_id, name: data.channel, thumbnails: [] },
    duration: data.duration || 0,
    thumbnail: data.thumbnail ? [{ url: data.thumbnail, width: 480, height: 360 }] : [],
    views: data.view_count?.toString() || '',
    uploadDate: data.upload_date || '',
    allowRatings: true,
    averageRating: data.average_rating,
    keywords: data.tags || [],
    category: data.categories?.[0] || '',
    isLive: !!data.is_live,
    isPrivate: false,
    formats: [],
    likeCount: data.like_count,
  });
}

// ── Public API ────────────────────────────────────────────────────────────
async function search(query, limit = 20) {
  try {
    const result = await ytSearch.GetListByKeyword(query, [{ type: 'video', limit }]);
    return normalizeSearch('youtube', result.items || [], query);
  } catch (err) {
    // Log the raw library error server-side for diagnostics; surface a clean
    // message to callers so library internals don't leak up the stack.
    console.error('[scraper] youtube-search-api error:', err.message);
    if (err.message?.includes('timed out') || err.message?.includes('ETIMEDOUT') || err.message?.includes('ECONNREFUSED')) {
      throw new Error('YouTube search timed out');
    }
    throw new Error('YouTube search unavailable');
  }
}

async function getSuggestions(query) {
  try {
    const result = await ytSearch.GetListByKeyword(query, [{ type: 'video', limit: 10 }]);
    const items = result.items || [];
    const suggestions = [...new Set(
      items.slice(0, 8).map(i => i.title || '').filter(Boolean).map(s => s.trim()).filter(s => s.length > 0)
    )];
    return { source: 'youtube', query, suggestions };
  } catch {
    // On failure, return a minimal fallback rather than propagating the error,
    // since suggestions are non-critical UX.
    const fallback = query.split(' ').slice(0, 3).join(' ');
    return { source: 'youtube', query, suggestions: [fallback] };
  }
}

async function getVideoInfo(videoId) {
  try {
    return await getVideoInfoFromYtdl(videoId);
  } catch (ytdlErr) {
    try {
      return await getVideoInfoFromYtDlp(videoId);
    } catch (ytdlpErr) {
      // Classify the error from the primary source (ytdl) for a clean message.
      // The yt-dlp fallback error is logged for diagnostics but not surfaced.
      void ytdlpErr; // fallback error intentionally not surfaced to callers
      if (ytdlErr.message?.includes('Video unavailable') || ytdlErr.message?.includes('This video is unavailable')) {
        throw new Error('Video not found');
      }
      if (ytdlErr.message?.includes('Private video') || ytdlErr.message?.includes('Sign in')) {
        throw new Error('Video is private');
      }
      if (ytdlErr.message?.includes('Copyright') || ytdlErr.message?.includes('blocked')) {
        throw new Error('Video is blocked due to copyright');
      }
      console.error('[scraper] both ytdl and yt-dlp failed:', ytdlErr.message, '|', ytdlpErr.message);
      throw new Error('Failed to retrieve video info');
    }
  }
}

async function getStreamUrl(videoId) {
  try {
    // Use --print to get both the URL and the format details in one call.
    // Format selector: prefer m4a (128kbps, universally compatible) over webm/opus.
    // YouTube's actual audio ceiling is ~160kbps opus — there is no 320kbps source.
    const output = await execYtDlp([
      '--no-warnings',
      '--no-playlist',
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
      '--print', '%(url)s\t%(abr)s\t%(ext)s',
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);

    const [url, abr, ext] = output.split('\n')[0].split('\t');

    if (!url || !url.startsWith('http')) {
      throw new Error('No playable audio format found');
    }

    const quality = abr && abr !== 'NA' ? `${Math.round(Number(abr))}kbps` : 'unknown';
    const format = ext && ext !== 'NA' ? ext : (url.includes('m4a') ? 'm4a' : 'webm');

    return normalizeStream('youtube', videoId, url, format, quality, null, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.youtube.com/',
      'Origin': 'https://www.youtube.com',
    });
  } catch (err) {
    if (err.message?.includes('Video unavailable') || err.message?.includes('This video is unavailable') || err.message?.includes('not found')) {
      throw new Error('Video not found');
    }
    if (err.message?.includes('Private video') || err.message?.includes('Sign in')) {
      throw new Error('Video is private');
    }
    if (err.message?.includes('No playable') || err.message?.includes('requested format not available')) {
      throw new Error('No playable audio format found for this video');
    }
    throw new Error('Failed to get stream URL');
  }
}

async function getVideoDetails(videoId) {
  const [videoResult, streamResult] = await Promise.allSettled([
    getVideoInfo(videoId),
    getStreamUrl(videoId),
  ]);

  if (videoResult.status === 'rejected') {
    throw videoResult.reason;
  }

  const video = videoResult.value;
  const stream = streamResult.status === 'fulfilled' ? streamResult.value : null;

  return {
    ...video,
    stream: stream
      ? { url: stream.stream_url, quality: stream.quality, format: stream.format, headers: stream.headers }
      : null,
  };
}

module.exports = { search, getSuggestions, getVideoInfo, getStreamUrl, getVideoDetails };
