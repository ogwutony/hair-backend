// scripts/migrate-rank-titles.js
// One-off: rewrite stored rank titles (legacy "bolshevik"/"bold carp"/city names)
// to the unified ladder in lib/rankTiers.js.
// Usage: MONGODB_URI=... node scripts/migrate-rank-titles.js [--dry-run]
require('dotenv').config();
const mongoose = require('mongoose');
const { getRankTitle } = require('../lib/rankTiers');

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  // 1. Users: rank_title derived from rank_score
  const users = await db.collection('users').find({}, { projection: { email: 1, rank_score: 1, rank_title: 1 } }).toArray();
  const scoreByEmail = new Map();
  const userOps = [];
  for (const u of users) {
    const score = u.rank_score || 1;
    if (u.email) scoreByEmail.set(u.email, score);
    const title = getRankTitle(score);
    if (u.rank_title !== title) {
      userOps.push({ updateOne: { filter: { _id: u._id }, update: { $set: { rank_title: title } } } });
    }
  }

  // 2. Duma items: submitterRank derived from the submitter's current score
  const items = await db.collection('dumaitems').find({}, { projection: { submittedBy: 1, submitterRank: 1 } }).toArray();
  const itemOps = [];
  for (const it of items) {
    const title = getRankTitle(scoreByEmail.get(it.submittedBy) || 1);
    if (it.submitterRank !== title) {
      itemOps.push({ updateOne: { filter: { _id: it._id }, update: { $set: { submitterRank: title } } } });
    }
  }

  console.log(`Users to update: ${userOps.length}/${users.length}`);
  console.log(`Duma items to update: ${itemOps.length}/${items.length}`);
  if (!DRY_RUN) {
    if (userOps.length) await db.collection('users').bulkWrite(userOps);
    if (itemOps.length) await db.collection('dumaitems').bulkWrite(itemOps);
    console.log('Done.');
  } else {
    console.log('Dry run — no changes written.');
  }
  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
