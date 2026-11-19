// lib/storage.js
// One place that decides where uploaded photos/videos go: Cloudflare R2 (S3-compatible, no bandwidth
// fees) when STORAGE_PROVIDER=r2 and the R2_* settings are present, otherwise Cloudinary as before.
//
// R2 settings (set in the host environment, never in code):
//   STORAGE_PROVIDER=r2
//   R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com   (or R2_ACCOUNT_ID=<account-id>)
//   R2_BUCKET_NAME=majority-media                                (or R2_BUCKET)
//   R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...
//   R2_PUBLIC_URL=https://media.example.com   (public address of the bucket, no trailing slash)
const crypto = require('crypto');

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

const r2Config = (env = process.env) => ({
  endpoint: env.R2_ENDPOINT || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
  bucket: env.R2_BUCKET_NAME || env.R2_BUCKET || '',
  publicUrl: String(env.R2_PUBLIC_URL || env.R2_PUBLIC_BASE || '').replace(/\/+$/, ''),
  accessKeyId: env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
});

const isR2Configured = (env = process.env) => {
  const c = r2Config(env);
  return Boolean(c.endpoint && c.bucket && c.publicUrl && c.accessKeyId && c.secretAccessKey);
};
const isR2Enabled = (env = process.env) => String(env.STORAGE_PROVIDER || '').toLowerCase() === 'r2' && isR2Configured(env);

// Same key layout the migration script uses: <image|video>/<folder>/<random>.<ext>
const buildKey = ({ mimetype, folder = 'user_media' }) => {
  const resourceType = String(mimetype || '').startsWith('video') ? 'video' : 'image';
  const ext = MIME_EXT[String(mimetype || '').toLowerCase()] || (resourceType === 'video' ? 'mp4' : 'jpg');
  const safeFolder = String(folder).replace(/[^A-Za-z0-9/_-]/g, '').replace(/^\/+|\/+$/g, '') || 'user_media';
  return { key: `${resourceType}/${safeFolder}/${crypto.randomUUID()}.${ext}`, resourceType };
};

// createStorage({ env, cloudinaryUpload, s3 }) → { provider, upload(buffer, {mimetype, folder}) → { secure_url, key }, health() }
//   cloudinaryUpload(buffer, {folder}) must resolve { secure_url }.  s3 = { send, PutObjectCommand, HeadBucketCommand } (injectable for tests).
const createStorage = ({ env = process.env, cloudinaryUpload, s3 } = {}) => {
  if (!isR2Enabled(env)) {
    return {
      provider: 'cloudinary',
      upload: async (buffer, { folder } = {}) => cloudinaryUpload(buffer, { folder }),
      health: null,
    };
  }
  const cfg = r2Config(env);
  let client = s3;
  const getClient = () => {
    if (client) return client;
    const { S3Client, PutObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
    const c = new S3Client({ region: 'auto', endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } });
    client = { send: (cmd) => c.send(cmd), PutObjectCommand, HeadBucketCommand };
    return client;
  };
  return {
    provider: 'r2',
    upload: async (buffer, { mimetype, folder } = {}) => {
      const { key } = buildKey({ mimetype, folder });
      const c = getClient();
      await c.send(new c.PutObjectCommand({
        Bucket: cfg.bucket, Key: key, Body: buffer,
        ContentType: mimetype || 'application/octet-stream',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return { secure_url: `${cfg.publicUrl}/${key}`, key };
    },
    health: async () => {
      try {
        const c = getClient();
        await c.send(new c.HeadBucketCommand({ Bucket: cfg.bucket }));
        return { ok: true, status: 'ok', provider: 'r2', bucket: cfg.bucket };
      } catch (err) {
        return { ok: false, status: 'unavailable', provider: 'r2', bucket: cfg.bucket, httpCode: err?.$metadata?.httpStatusCode || null, message: String(err?.message || err).slice(0, 200) };
      }
    },
  };
};

module.exports = { r2Config, isR2Configured, isR2Enabled, buildKey, createStorage };
