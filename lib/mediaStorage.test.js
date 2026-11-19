const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { classifyUploadError, sendUploadError, checkMediaStorage, resetMediaStorageState, MEDIA_UPLOADS_UNAVAILABLE, MEDIA_UPLOAD_FAILED } = require('./mediaStorage');

const env = { CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' };
const fakeRes = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

beforeEach(() => resetMediaStorageState());

test('a disabled Cloudinary account is reported as uploads unavailable', () => {
  const r = classifyUploadError({ message: 'cloud_name du1azv5ip is disabled', http_code: 401 }, env);
  assert.equal(r.status, 503);
  assert.equal(r.code, MEDIA_UPLOADS_UNAVAILABLE);
});

test('plan limits, rate limits and bad credentials are account-level outages', () => {
  for (const err of [{ http_code: 420, message: 'Rate Limit Exceeded' }, { message: 'Your account has exceeded its usage limits' }, { http_code: 401, message: 'Unknown API key x' }, { error: { message: 'Must supply api_key' } }]) {
    assert.equal(classifyUploadError(err, env).code, MEDIA_UPLOADS_UNAVAILABLE, JSON.stringify(err));
  }
});

test('missing configuration means uploads are unavailable', () => {
  assert.equal(classifyUploadError(new Error('anything'), {}).code, MEDIA_UPLOADS_UNAVAILABLE);
});

test('a problem with one file is a normal retryable failure', () => {
  for (const err of [{ http_code: 400, message: 'File size too large. Got 20000000. Maximum is 10485760.' }, { http_code: 400, message: 'Invalid image file' }, new Error('socket hang up')]) {
    const r = classifyUploadError(err, env);
    assert.equal(r.status, 502, JSON.stringify(err));
    assert.equal(r.code, MEDIA_UPLOAD_FAILED);
  }
});

test('sendUploadError responds with a readable message and code', () => {
  const res = fakeRes();
  const origError = console.error; console.error = () => {};
  try { sendUploadError(res, { message: 'cloud_name x is disabled', http_code: 401 }, 'Test'); } finally { console.error = origError; }
  // Real env may not be configured in tests; either way an outage is a 503.
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /temporarily unavailable/);
  assert.equal(res.body.code, MEDIA_UPLOADS_UNAVAILABLE);
});

test('health check reports a disabled account and caches the result', async () => {
  let pings = 0;
  const cloudinary = { api: { ping: async () => { pings += 1; const e = new Error('cloud_name demo is disabled'); e.http_code = 401; throw e; } } };
  const first = await checkMediaStorage(cloudinary, { now: 1000, env });
  assert.equal(first.ok, false);
  assert.equal(first.status, 'unavailable');
  assert.equal(first.httpCode, 401);
  await checkMediaStorage(cloudinary, { now: 2000, env });
  assert.equal(pings, 1);
  await checkMediaStorage(cloudinary, { now: 1000 + 5 * 60 * 1000 + 1, env });
  assert.equal(pings, 2);
});

test('health check reports ok and not_configured', async () => {
  assert.equal((await checkMediaStorage({ api: { ping: async () => ({ status: 'ok' }) } }, { now: 1, env })).status, 'ok');
  resetMediaStorageState();
  assert.equal((await checkMediaStorage({ api: { ping: async () => ({}) } }, { now: 1, env: {} })).status, 'not_configured');
});
