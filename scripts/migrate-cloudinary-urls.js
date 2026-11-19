// scripts/migrate-cloudinary-urls.js
// Points every stored Cloudinary link at a different Cloudinary account (cloud name).
//
// Only needed if you move to a NEW Cloudinary account. It changes the links, not the files:
// copy the files into the new account first (same public IDs / folders, e.g. user_media/...),
// otherwise the new links will be broken too.
//
// Dry run (default — shows what would change, writes nothing):
//   MONGODB_URI=... node scripts/migrate-cloudinary-urls.js --from du1azv5ip --to NEW_CLOUD_NAME
// Apply the changes:
//   MONGODB_URI=... node scripts/migrate-cloudinary-urls.js --from du1azv5ip --to NEW_CLOUD_NAME --apply
//
// Before applying it checks that a sample of the rewritten links actually load from the
// new account, and stops if they don't (override with --skip-check).
require('dotenv').config();
const mongoose = require('mongoose');
const { rewriteCloudinaryUrls, changedTopLevelFields } = require('../lib/cloudinaryUrls');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes('--apply');
const SKIP_CHECK = process.argv.includes('--skip-check');
const FROM = arg('from');
const TO = arg('to');
const SAMPLE_SIZE = 5;

const collectUrls = (value, toCloud, out) => {
  if (out.length >= SAMPLE_SIZE) return;
  if (typeof value === 'string') {
    const m = value.match(/https?:\/\/res\.cloudinary\.com\/[^\s"']+/);
    if (m && m[0].includes(`/${toCloud}/`)) out.push(m[0]);
  } else if (Array.isArray(value)) value.forEach((v) => collectUrls(v, toCloud, out));
  else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach((v) => collectUrls(v, toCloud, out));
  }
};

(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  if (!FROM || !TO) throw new Error('Usage: node scripts/migrate-cloudinary-urls.js --from OLD_CLOUD --to NEW_CLOUD [--apply]');
  if (FROM === TO) throw new Error('--from and --to are the same');

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'));

  const plan = [];
  const samples = [];
  for (const name of collections) {
    const ops = [];
    let links = 0;
    for await (const doc of db.collection(name).find({})) {
      const { value, changed, count } = rewriteCloudinaryUrls(doc, FROM, TO);
      if (!changed) continue;
      links += count;
      const $set = changedTopLevelFields(doc, value);
      collectUrls($set, TO, samples);
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set } } });
    }
    if (ops.length) plan.push({ name, ops, links });
  }

  console.log(`${APPLY ? 'Applying' : 'Dry run'}: ${FROM} → ${TO}`);
  if (!plan.length) console.log('No links to change.');
  for (const { name, ops, links } of plan) console.log(`  ${name}: ${ops.length} documents, ${links} links`);

  if (APPLY && plan.length) {
    if (!SKIP_CHECK) {
      let broken = 0;
      for (const url of samples) {
        const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
        const ok = res && res.ok;
        if (!ok) broken += 1;
        console.log(`  check ${ok ? 'OK ' : 'FAIL'} ${res ? res.status : 'no response'} ${url}`);
      }
      if (broken) {
        console.error(`\n${broken}/${samples.length} sample links do not load from "${TO}". Copy the files into the new account first (or re-run with --skip-check). Nothing was changed.`);
        process.exitCode = 1;
        return;
      }
    }
    for (const { name, ops } of plan) {
      const result = await db.collection(name).bulkWrite(ops, { ordered: false });
      console.log(`  ${name}: updated ${result.modifiedCount}`);
    }
  } else if (plan.length) {
    console.log('\nNothing was written. Re-run with --apply to make these changes.');
  }
})()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
