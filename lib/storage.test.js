const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isR2Enabled, buildKey, createStorage } = require('./storage');

const R2 = { STORAGE_PROVIDER: 'r2', R2_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', R2_BUCKET_NAME: 'media', R2_PUBLIC_URL: 'https://media.example.com/', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' };

test('R2 only turns on when the switch AND every setting are present', () => {
  assert.equal(isR2Enabled(R2), true);
  assert.equal(isR2Enabled({ ...R2, STORAGE_PROVIDER: 'cloudinary' }), false);
  assert.equal(isR2Enabled({ ...R2, R2_SECRET_ACCESS_KEY: '' }), false);
  assert.equal(isR2Enabled({}), false);
});

test('accepts R2_ACCOUNT_ID and R2_BUCKET aliases', () => {
  const env = { ...R2, R2_ENDPOINT: '', R2_ACCOUNT_ID: 'abc', R2_BUCKET_NAME: '', R2_BUCKET: 'b' };
  assert.equal(isR2Enabled(env), true);
});

test('buildKey uses the migration layout', () => {
  const { key, resourceType } = buildKey({ mimetype: 'video/quicktime', folder: 'majority-hair/comments' });
  assert.equal(resourceType, 'video');
  assert.match(key, /^video\/majority-hair\/comments\/[0-9a-f-]{36}\.mov$/);
  assert.match(buildKey({ mimetype: 'image/png', folder: '../../etc' }).key, /^image\/etc\/.+\.png$/);
});

test('R2 upload sends the file and returns the public URL', async () => {
  const sent = [];
  const s3 = { send: async (c) => { sent.push(c); }, PutObjectCommand: class { constructor(i) { this.input = i; } }, HeadBucketCommand: class { constructor(i) { this.input = i; } } };
  const storage = createStorage({ env: R2, s3, cloudinaryUpload: async () => { throw new Error('should not be used'); } });
  const out = await storage.upload(Buffer.from('x'), { mimetype: 'image/jpeg', folder: 'user_media' });
  assert.equal(storage.provider, 'r2');
  assert.match(out.secure_url, /^https:\/\/media\.example\.com\/image\/user_media\/.+\.jpg$/);
  assert.equal(sent[0].input.Bucket, 'media');
  assert.equal(sent[0].input.ContentType, 'image/jpeg');
  assert.equal((await storage.health()).ok, true);
});

test('falls back to Cloudinary when R2 is not enabled', async () => {
  const storage = createStorage({ env: {}, cloudinaryUpload: async (b, o) => ({ secure_url: `https://res.cloudinary.com/c/image/upload/v1/${o.folder}/a.jpg` }) });
  assert.equal(storage.provider, 'cloudinary');
  assert.match((await storage.upload(Buffer.from('x'), { mimetype: 'image/jpeg', folder: 'user_media' })).secure_url, /cloudinary/);
});
