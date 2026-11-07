const path = require('path');

const env = process.env;

module.exports = {
  port: parseInt(env.PORT || '3420', 10),
  host: env.HOST || '127.0.0.1',
  dataDir: env.DATA_DIR || '/var/lib/glint',
  webDir: env.WEB_DIR || path.join(__dirname, '..', '..', 'web'),
  downloadDir: env.DOWNLOAD_DIR || '/var/www/html/glint/download',
  publicBase: (env.PUBLIC_BASE || 'https://clips.nookara.cc').replace(/\/$/, ''),
  basePath: env.BASE_PATH || '',
  veloraAppId: env.VELORA_APP_ID || 'app_7c41e9b02fd86a35c1e7',
  veloraApi: (env.VELORA_API || 'http://127.0.0.1:3100').replace(/\/$/, ''),
  veloraPublic: (env.VELORA_PUBLIC || 'https://nookara.cc').replace(/\/$/, ''),
  mediaPrefix: env.MEDIA_PREFIX || 'https://nookara.cc/uploads/videos/',
  legacyPublic: 'https://velora.ikelene.net',
  cdnPublic: (env.CDN_PUBLIC || 'https://cdn.nookara.cc').replace(/\/$/, ''),
  cdnFetchBase: (env.CDN_FETCH_BASE || '').replace(/\/$/, ''),

  tokenTtlMs: 5 * 60 * 1000,
  headTtlMs: 2 * 60 * 1000,
  sweepEveryMs: 15 * 60 * 1000,
  mediaListTtlMs: 60 * 1000,
  lookupTtlMs: 2 * 60 * 1000,
  pageSize: 24,

  ffmpeg: env.FFMPEG || 'ffmpeg',
  ffprobe: env.FFPROBE || 'ffprobe',
  nice: env.FF_NICE === undefined ? 10 : parseInt(env.FF_NICE, 10),
  ffThreads: parseInt(env.FF_THREADS || '2', 10),
  proxyTtlMs: 7 * 24 * 3600 * 1000,
  signTtlSec: 6 * 3600,
};
