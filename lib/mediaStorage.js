// lib/mediaStorage.js
// Turns Cloudinary upload failures into clear API responses.
// When the Cloudinary account is disabled, over its plan limits, or misconfigured, every
// upload fails the same way; members get one honest "uploads are unavailable" message
// (503) instead of a generic 500, and can still post without photos or video.

const UNAVAILABLE_STATUS_CODES = new Set([401, 403, 420, 429]);
// Account-level problems only: a single bad file ("File size too large", "Invalid image file") is not an outage.
const UNAVAILABLE_PATTERN = /disabled|suspended|blocked|quota|usage limit|plan limit|rate limit|credits|account (?:has )?exceeded|cloud_name|api_key|api_secret|unknown api|invalid signature/i;

const MEDIA_UPLOADS_UNAVAILABLE = 'MEDIA_UPLOADS_UNAVAILABLE';
const MEDIA_UPLOAD_FAILED = 'MEDIA_UPLOAD_FAILED';

const UNAVAILABLE_MESSAGE = 'Photo and video uploads are temporarily unavailable. Please try again later, or post without photos or video.';
const FAILED_MESSAGE = 'Your photo or video could not be uploaded. Please try again.';

const { isR2Enabled } = require('./storage');

const isMediaStorageConfigured = (env = process.env) =>
  isR2Enabled(env) || Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

const errorDetails = (err) => {
  const nested = err && typeof err.error === 'object' ? err.error : {};
  return {
    httpCode: Number(err?.http_code || nested.http_code || err?.status || err?.$metadata?.httpStatusCode || 0) || 0,
    message: String(err?.message || nested.message || err || ''),
  };
};

// Returns { status, code, error } for an upload error.
const classifyUploadError = (err, env = process.env) => {
  const { httpCode, message } = errorDetails(err);
  const unavailable = !isMediaStorageConfigured(env)
    || UNAVAILABLE_STATUS_CODES.has(httpCode)
    || UNAVAILABLE_PATTERN.test(message);
  return unavailable
    ? { status: 503, code: MEDIA_UPLOADS_UNAVAILABLE, error: UNAVAILABLE_MESSAGE }
    : { status: 502, code: MEDIA_UPLOAD_FAILED, error: FAILED_MESSAGE };
};

// Most recent "uploads unavailable" failure, surfaced by GET /api/health/media.
let lastUnavailable = null;

const sendUploadError = (res, err, context = 'Media upload') => {
  const { httpCode, message } = errorDetails(err);
  const result = classifyUploadError(err);
  if (result.code === MEDIA_UPLOADS_UNAVAILABLE) {
    lastUnavailable = { at: new Date().toISOString(), reason: message.slice(0, 200) };
  }
  console.error(`❌ ${context} failed (${result.code}${httpCode ? `, Cloudinary HTTP ${httpCode}` : ''}): ${message}`);
  return res.status(result.status).json({ error: result.error, code: result.code });
};

// Checks the Cloudinary account with the Admin API ping, cached so the health
// endpoint can't burn through the Admin API rate limit.
const HEALTH_CACHE_MS = 5 * 60 * 1000;
let healthCache = null;

const checkMediaStorage = async (cloudinary, { now = Date.now(), env = process.env } = {}) => {
  if (healthCache && now - healthCache.checkedAtMs < HEALTH_CACHE_MS) return healthCache.result;
  let result;
  if (!isMediaStorageConfigured(env)) {
    result = { ok: false, status: 'not_configured', message: 'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must all be set.' };
  } else {
    try {
      await cloudinary.api.ping();
      result = { ok: true, status: 'ok', cloudName: env.CLOUDINARY_CLOUD_NAME };
    } catch (err) {
      const { httpCode, message } = errorDetails(err);
      result = { ok: false, status: 'unavailable', cloudName: env.CLOUDINARY_CLOUD_NAME, httpCode: httpCode || null, message: message.slice(0, 200) };
    }
  }
  result = { ...result, checkedAt: new Date(now).toISOString(), lastUploadUnavailable: lastUnavailable };
  healthCache = { checkedAtMs: now, result };
  return result;
};

const resetMediaStorageState = () => { healthCache = null; lastUnavailable = null; };

module.exports = {
  MEDIA_UPLOADS_UNAVAILABLE,
  MEDIA_UPLOAD_FAILED,
  isMediaStorageConfigured,
  classifyUploadError,
  sendUploadError,
  checkMediaStorage,
  resetMediaStorageState,
};
