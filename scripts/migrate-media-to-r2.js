// scripts/migrate-media-to-r2.js
// Uploads the files from scripts/backup-cloudinary-media.js to a Cloudflare R2 bucket, then points the
// database links at R2. Dry run by default (uploads nothing, writes nothing).
//
//   export R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=majority-media
//   export MONGODB_URI="mongodb+srv://..."
//   node scripts/migrate-media-to-r2.js --backup ./media-backup --public-base https://media.themajorities.com            # dry run
//   node scripts/migrate-media-to-r2.js --backup ./media-backup --public-base https://media.themajorities.com --apply    # do it
//
// --public-base is the public address of the bucket (a custom domain or the r2.dev URL).
// With --apply it uploads first, checks a sample of the new links load, and only then rewrites the database.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { CLOUDINARY_URL, parseCloudinaryUrl, contentTypeFor } = require('../lib/mediaKeys');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const APPLY = process.argv.includes('--apply');
const BACKUP = path.resolve(arg('backup') || './media-backup');
const BASE = (arg('public-base') || '').replace(/\/+$/, '');

// Replace every Cloudinary link inside a document with its R2 address (only for files we actually backed up).
const rewrite = (value, have, base, stats) => {
  if (typeof value === 'string') {
    return value.replace(new RegExp(CLOUDINARY_URL.source, 'g'), (url) => {
      const p = parseCloudinaryUrl(url);
      if (p && have.has(p.key)) { stats.count += 1; return `${base}/${p.key}`; }
      stats.missing += 1;
      return url;
    });
  }
  if (Array.isArray(value)) return value.map((v) => rewrite(v, have, base, stats));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, have, base, stats)]));
  }
  return value;
};

(async () => {
  for (const v of ['MONGODB_URI', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) if (!process.env[v]) throw new Error(`${v} is not set`);
  if (!BASE) throw new Error('--public-base is required (the public address of your R2 bucket)');
  const manifest = JSON.parse(fs.readFileSync(path.join(BACKUP, 'manifest.json'), 'utf8'));
  const files = manifest.files.filter((f) => f.status !== 'FAILED' && fs.existsSync(path.join(BACKUP, f.key)));
  const have = new Set(files.map((f) => f.key));
  console.log(`${APPLY ? 'APPLY' : 'Dry run'}: ${files.length} backed-up files → bucket "${process.env.R2_BUCKET}", links → ${BASE}/…`);

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });

  if (APPLY) {
    let n = 0;
    for (const f of files) {
      const exists = await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: f.key })).then(() => true).catch(() => false);
      if (!exists) {
        await s3.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET, Key: f.key, Body: fs.readFileSync(path.join(BACKUP, f.key)),
          ContentType: contentTypeFor(f.key), CacheControl: 'public, max-age=31536000, immutable',
        }));
      }
      n += 1;
      if (n % 10 === 0 || n === files.length) console.log(`  uploaded/verified ${n}/${files.length}`);
    }
    const sample = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / 5)) === 0).slice(0, 5);
    let bad = 0;
    for (const f of sample) {
      const res = await fetch(`${BASE}/${f.key}`, { method: 'HEAD' }).catch(() => null);
      const ok = res && res.ok;
      if (!ok) bad += 1;
      console.log(`  check ${ok ? 'OK  ' : 'FAIL'} ${res ? res.status : 'no response'} ${BASE}/${f.key}`);
    }
    if (bad) { console.error('\nSample links do not load from the public address. Files are uploaded but the database was NOT changed. Check the bucket\'s public access / custom domain.'); process.exitCode = 1; return; }
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
  for (const name of names) {
    const ops = []; const stats = { count: 0, missing: 0 };
    for await (const doc of db.collection(name).find({})) {
      const before = stats.count;
      const next = rewrite(doc, have, BASE, stats);
      if (stats.count === before) continue;
      const $set = {};
      for (const k of Object.keys(next)) if (k !== '_id' && JSON.stringify(next[k]) !== JSON.stringify(doc[k])) $set[k] = next[k];
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set } } });
    }
    if (!ops.length) continue;
    console.log(`  ${name}: ${ops.length} documents, ${stats.count} links${stats.missing ? `, ${stats.missing} left on Cloudinary (not in backup)` : ''}`);
    if (APPLY) await db.collection(name).bulkWrite(ops, { ordered: false });
  }
  if (!APPLY) console.log('\nNothing was uploaded or written. Re-run with --apply to do it.');
  await mongoose.disconnect();
})().catch((err) => { console.error(err.message); process.exitCode = 1; });
