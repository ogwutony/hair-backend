// scripts/backup-cloudinary-media.js
// Downloads every Cloudinary file your database links to (originals, no resizing) into a local folder,
// plus a manifest.json that maps each stored link to its file. Read-only: it never changes the
// database or Cloudinary. Safe to re-run — files already downloaded are skipped.
//
//   MONGODB_URI="mongodb+srv://..." node scripts/backup-cloudinary-media.js --out ./media-backup
//
// Needs Node 20+. Needs ~2–5 GB free disk for a video-heavy feed. Links don't need API keys (public delivery).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const mongoose = require('mongoose');
const { findCloudinaryUrls, parseCloudinaryUrl } = require('../lib/mediaKeys');

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const OUT = path.resolve(arg('out', './media-backup'));
const CONCURRENCY = Number(arg('concurrency', 4));

const download = async (url, dest) => {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  const size = fs.statSync(tmp).size;
  if (size === 0) throw new Error('empty file');
  fs.renameSync(tmp, dest);
  return size;
};

(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));

  const found = new Set();
  for (const name of names) for await (const doc of db.collection(name).find({})) findCloudinaryUrls(doc, found);
  await mongoose.disconnect();

  // Many stored links resolve to the same original file (different resize variants) — download each once.
  const byKey = new Map();
  for (const url of found) {
    const parsed = parseCloudinaryUrl(url);
    if (!parsed) { console.warn(`  skipping unrecognised link: ${url}`); continue; }
    if (!byKey.has(parsed.key)) byKey.set(parsed.key, { key: parsed.key, cloud: parsed.cloud, urls: [], source: null });
    const entry = byKey.get(parsed.key);
    entry.urls.push(url);
    // Download the plain original: strip everything between /upload/ and the version/path
    entry.source = entry.source || `https://res.cloudinary.com/${parsed.cloud}/${parsed.resourceType}/upload/${parsed.key.slice(parsed.resourceType.length + 1)}`;
  }
  const entries = [...byKey.values()];
  console.log(`Found ${found.size} links → ${entries.length} distinct files. Saving to ${OUT}`);

  const results = [];
  let done = 0;
  const queue = entries.slice();
  const worker = async () => {
    while (queue.length) {
      const e = queue.shift();
      const dest = path.join(OUT, e.key);
      try {
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
          results.push({ ...e, file: e.key, bytes: fs.statSync(dest).size, status: 'already-had' });
        } else {
          // Prefer a versioned URL if one of the stored links has it; fall back to the unversioned original.
          const versioned = e.urls.find((u) => /\/v\d+\//.test(u) && !/\/upload\/[^/]*[a-z]_[^/]*\//.test(u)) || e.urls[0];
          let bytes;
          try { bytes = await download(e.source, dest); } catch { bytes = await download(versioned, dest); }
          results.push({ ...e, file: e.key, bytes, status: 'downloaded' });
        }
      } catch (err) {
        results.push({ ...e, status: 'FAILED', error: err.message });
      }
      done += 1;
      if (done % 10 === 0 || done === entries.length) console.log(`  ${done}/${entries.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), files: results }, null, 2));
  const failed = results.filter((r) => r.status === 'FAILED');
  const bytes = results.reduce((s, r) => s + (r.bytes || 0), 0);
  console.log(`\nDone. ${results.length - failed.length} files (${(bytes / 1e6).toFixed(1)} MB) saved, ${failed.length} failed.`);
  failed.forEach((f) => console.log(`  FAILED ${f.key}: ${f.error}`));
  if (failed.length) process.exitCode = 1;
})().catch((err) => { console.error(err.message); process.exitCode = 1; });
