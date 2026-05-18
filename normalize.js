function trim(v) {
  return typeof v === 'string' ? v.trim() : v;
}

function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, '&');
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pickThumbnail(thumbnails) {
  if (!thumbnails || !Array.isArray(thumbnails) || !thumbnails.length) return null;
  const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || null;
}

function normalizeSearchItem(item) {
  const thumbnails = item.thumbnail?.thumbnails || [];
  return {
    id: item.id || '',
    title: decodeHtmlEntities(item.title || ''),
    channel: {
      id: item.channel?.id || '',
      name: decodeHtmlEntities(item.channel?.name || ''),
    },
    duration_seconds: item.duration?.seconds || 0,
    duration_label: formatDuration(item.duration?.seconds || 0),
    thumbnail: pickThumbnail(thumbnails),
    thumbnails: thumbnails.slice(0, 3),
    views: item.views || '',
    uploaded_date: item.uploadedDate || '',
    is_live: !!item.isLive,
  };
}

function normalizeSearch(source, data, query) {
  const items = (data || []).map(normalizeSearchItem);
  return { source, query, results: items, total: items.length };
}

function normalizeVideo(source, video) {
  let thumbnails = [];
  if (Array.isArray(video.thumbnail)) {
    thumbnails = video.thumbnail;
  } else if (video.thumbnail?.thumbnails) {
    thumbnails = video.thumbnail.thumbnails;
  } else if (typeof video.thumbnail === 'string') {
    thumbnails = [{ url: video.thumbnail, width: 480, height: 360 }];
  }
  const bestThumbnail = pickThumbnail(thumbnails);

  const formats = (video.formats || []).map(f => ({
    itag: f.itag,
    mime_type: f.mimeType,
    quality_label: f.qualityLabel,
    has_audio: f.hasAudio,
    has_video: f.hasVideo,
    content_length: f.contentLength,
  }));

  return {
    source,
    id: video.videoId || '',
    title: decodeHtmlEntities(video.title || ''),
    description: decodeHtmlEntities(video.description || ''),
    channel: {
      id: video.channel?.id || '',
      name: decodeHtmlEntities(video.channel?.name || ''),
      thumbnails: video.channel?.thumbnails || [],
    },
    duration_seconds: video.duration || 0,
    duration_label: formatDuration(video.duration || 0),
    thumbnail: bestThumbnail,
    thumbnails,
    views: video.views || '',
    uploaded_date: video.uploadDate || '',
    allow_ratings: video.allowRatings,
    average_rating: video.averageRating,
    keywords: video.keywords || [],
    category: video.category || '',
    is_live: !!video.isLive,
    is_private: !!video.isPrivate,
    formats,
    format_count: formats.length,
  };
}

function normalizeStream(source, id, streamUrl, format, quality, expiresAt, headers) {
  return {
    id,
    source,
    stream_url: streamUrl,
    quality: quality || 'unknown',
    format: format || 'unknown',
    expires_at: expiresAt || null,
    headers: headers || null,
  };
}

module.exports = {
  trim,
  decodeHtmlEntities,
  formatDuration,
  pickThumbnail,
  normalizeSearch,
  normalizeSearchItem,
  normalizeVideo,
  normalizeStream,
};
