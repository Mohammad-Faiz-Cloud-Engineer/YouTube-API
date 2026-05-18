const NodeCache = require('node-cache');

const searchCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const streamCache = new NodeCache({ stdTTL: 1500, checkperiod: 120 });
const metadataCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

const STREAM_EXPIRY_BUFFER_MS = 3 * 60 * 1000;

function isStreamExpired(streamData) {
  if (!streamData?.expires_at) return false;
  const expiresAt = new Date(streamData.expires_at).getTime();
  if (isNaN(expiresAt)) return true;
  return expiresAt - Date.now() <= STREAM_EXPIRY_BUFFER_MS;
}

function getCacheStats() {
  return {
    search: {
      keys: searchCache.keys().length,
      hits: searchCache.getStats().hits,
      misses: searchCache.getStats().misses,
    },
    stream: {
      keys: streamCache.keys().length,
      hits: streamCache.getStats().hits,
      misses: streamCache.getStats().misses,
    },
    metadata: {
      keys: metadataCache.keys().length,
      hits: metadataCache.getStats().hits,
      misses: metadataCache.getStats().misses,
    },
  };
}

module.exports = { searchCache, streamCache, metadataCache, isStreamExpired, getCacheStats };
