const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  POINTS, normalizePostUrl, pointsFor, capAward, createCreatorProgram, generateCreatorCode,
  normalizeCreatorCode, dailyCap, DEFAULT_DAILY_POINTS_CAP, cleanText,
} = require('./creatorProgram');

// In-memory ledger with the same contract as the Mongo one (unique urlKey).
const memoryLedger = () => {
  const rows = [];
  return {
    rows,
    count: async ({ userId, productHandle, platform }) =>
      rows.filter((r) => r.userId === userId && r.productHandle === productHandle && r.platform === platform).length,
    pointsSince: async (userId, since) =>
      rows.filter((r) => r.userId === userId && r.createdAt >= since).reduce((s, r) => s + r.points, 0),
    insert: async (row) => {
      if (row.urlKey && rows.some((r) => r.urlKey === row.urlKey)) {
        const err = new Error('duplicate'); err.code = 11000; throw err;
      }
      rows.push(row);
    },
    listForUser: async (userId) => rows.filter((r) => r.userId === userId),
  };
};

const setup = ({ cap = '100000', start = Date.parse('2026-11-20T12:00:00Z') } = {}) => {
  const ledger = memoryLedger();
  const awarded = [];
  let clock = start;
  const program = createCreatorProgram({
    ledger,
    awardPoints: async (user, points, reason) => awarded.push({ user: user._id, points, reason }),
    now: () => new Date(clock),
    env: { CREATOR_DAILY_POINTS_CAP: cap },
  });
  return { ledger, awarded, program, advance: (ms) => { clock += ms; } };
};

const alice = { _id: 'u1', creatorCode: 'TM-AAAA-BBBB', rank_score: 10 };
const bob = { _id: 'u2', creatorCode: 'TM-CCCC-DDDD' };
const SHAMPOO = 'the-majorities-shampoo';
const OIL = 'the-majorities-hair-oil';

test('points table matches the owner rules', () => {
  assert.deepEqual(POINTS, { dumaFirst: 200, dumaRepeat: 150, socialFirst: 300, socialRepeat: 150 });
  assert.equal(pointsFor('duma', 0), 200);
  assert.equal(pointsFor('duma', 3), 150);
  assert.equal(pointsFor('social', 0), 300);
  assert.equal(pointsFor('social', 1), 150);
});

test('Duma: 200 the first time per product, 150 on repeat, 200 again for another product', async () => {
  const { program, awarded } = setup();
  assert.equal((await program.recordDuma(alice, { productHandle: SHAMPOO, dumaItemId: 'd1' })).points, 200);
  assert.equal((await program.recordDuma(alice, { productHandle: SHAMPOO, dumaItemId: 'd2' })).points, 150);
  assert.equal((await program.recordDuma(alice, { productHandle: OIL, dumaItemId: 'd3' })).points, 200);
  assert.deepEqual(awarded.map((a) => a.points), [200, 150, 200]);
});

test('social: 300 first per platform and product, 150 repeat, fresh 300 on another platform or product', async () => {
  const { program } = setup();
  const s = (productHandle, platform, url) => program.submitSocial(alice, { productHandle, platform, url });
  assert.equal((await s(SHAMPOO, 'tiktok', 'https://www.tiktok.com/@alice/video/1')).points, 300);
  assert.equal((await s(SHAMPOO, 'tiktok', 'https://www.tiktok.com/@alice/video/2')).points, 150);
  assert.equal((await s(SHAMPOO, 'instagram', 'https://www.instagram.com/reel/abc/')).points, 300);
  assert.equal((await s(OIL, 'tiktok', 'https://www.tiktok.com/@alice/video/3')).points, 300);
});

test('the same post URL is never paid twice, even with tracking junk or by another creator', async () => {
  const { program, awarded } = setup();
  const first = await program.submitSocial(alice, { productHandle: SHAMPOO, platform: 'tiktok', url: 'https://www.tiktok.com/@alice/video/1' });
  assert.equal(first.status, 201);
  const again = await program.submitSocial(alice, { productHandle: SHAMPOO, platform: 'tiktok', url: 'https://m.tiktok.com/@Alice/video/1/?is_from_webapp=1#x' });
  assert.equal(again.status, 409);
  const other = await program.submitSocial(bob, { productHandle: OIL, platform: 'tiktok', url: 'https://tiktok.com/@alice/video/1' });
  assert.equal(other.status, 409);
  assert.equal(awarded.length, 1);
});

test('YouTube links count as the same video across URL forms', () => {
  const a = normalizePostUrl('https://www.youtube.com/watch?v=XyZ123&t=10', 'youtube');
  const b = normalizePostUrl('https://youtu.be/XyZ123?si=abc', 'youtube');
  const c = normalizePostUrl('https://youtube.com/shorts/XyZ123', 'youtube');
  assert.equal(a.key, 'youtube:XyZ123');
  assert.equal(b.key, a.key);
  assert.equal(c.key, a.key);
});

test('wrong-domain and look-alike links are rejected', async () => {
  const { program, awarded } = setup();
  for (const url of [
    'https://www.instagram.com/reel/abc/',
    'https://tiktok.com.evil.example/@a/video/1',
    'https://eviltiktok.com/@a/video/1',
    'javascript:alert(1)',
    'not a url',
    'https://user:pw@tiktok.com/@a/video/1',
  ]) {
    const result = await program.submitSocial(alice, { productHandle: SHAMPOO, platform: 'tiktok', url });
    assert.equal(result.status, 400, url);
  }
  assert.equal(awarded.length, 0);
});

test('every platform accepts its own domains', () => {
  const ok = {
    tiktok: 'https://vm.tiktok.com/ZM123/',
    instagram: 'https://instagram.com/p/abc',
    pinterest: 'https://pin.it/abc',
    snapchat: 'https://www.snapchat.com/spotlight/abc',
    x: 'https://twitter.com/a/status/1',
    facebook: 'https://fb.watch/abc/',
    youtube: 'https://m.youtube.com/watch?v=abc',
  };
  for (const [platform, url] of Object.entries(ok)) assert.ok(normalizePostUrl(url, platform).key, platform);
  assert.ok(normalizePostUrl('https://x.com/a', 'facebook').error);
  assert.ok(normalizePostUrl('https://www.tiktok.com/', 'tiktok').error, 'profile root is not a post');
  assert.ok(normalizePostUrl('https://tiktok.com/@a/video/1', 'myspace').error);
});

test('unknown products are rejected', async () => {
  const { program } = setup();
  const r = await program.submitSocial(alice, { productHandle: 'wholesale-case', platform: 'tiktok', url: 'https://tiktok.com/@a/video/9' });
  assert.equal(r.status, 400);
});

test('daily cap: pays only what is left, then nothing, and resets after 24 hours', async () => {
  const { program, awarded, advance } = setup({ cap: '500' });
  const s = (n) => program.submitSocial(alice, { productHandle: SHAMPOO, platform: 'x', url: `https://x.com/alice/status/${n}` });
  assert.equal((await s(1)).points, 300);
  const second = await s(2);
  assert.equal(second.points, 150);
  const third = await s(3);
  assert.equal(third.points, 50);
  assert.equal(third.capped, true);
  assert.equal((await s(4)).points, 0);
  assert.deepEqual(awarded.map((a) => a.points), [300, 150, 50]);
  advance(24 * 60 * 60 * 1000 + 1);
  assert.equal((await s(5)).points, 150);
});

test('cap is per creator', async () => {
  const { program } = setup({ cap: '300' });
  await program.submitSocial(alice, { productHandle: SHAMPOO, platform: 'x', url: 'https://x.com/a/status/1' });
  const r = await program.submitSocial(bob, { productHandle: SHAMPOO, platform: 'x', url: 'https://x.com/b/status/1' });
  assert.equal(r.points, 300);
});

test('ledger row carries code, product, platform, url or article id, points and time', async () => {
  const { program, ledger } = setup();
  await program.submitSocial(alice, { productHandle: SHAMPOO, platform: 'facebook', url: 'https://www.facebook.com/watch?v=55&ref=share' });
  await program.recordDuma(alice, { productHandle: SHAMPOO, dumaItemId: 'd9' });
  const [social, duma] = ledger.rows;
  assert.equal(social.creatorCode, 'TM-AAAA-BBBB');
  assert.equal(social.platform, 'facebook');
  assert.equal(social.urlKey, 'facebook:facebook.com/watch?v=55');
  assert.equal(social.points, 300);
  assert.ok(social.createdAt instanceof Date);
  assert.equal(duma.platform, 'duma');
  assert.equal(duma.dumaItemId, 'd9');
  assert.equal(duma.urlKey, null);
});

test('progress groups the ledger for the checklist page', async () => {
  const { program } = setup();
  await program.recordDuma(alice, { productHandle: SHAMPOO, dumaItemId: 'd1' });
  await program.submitSocial(alice, { productHandle: SHAMPOO, platform: 'tiktok', url: 'https://tiktok.com/@a/video/1' });
  await program.submitSocial(alice, { productHandle: SHAMPOO, platform: 'tiktok', url: 'https://tiktok.com/@a/video/2' });
  const p = await program.progress({ ...alice, creatorTasks: { app: true } });
  assert.equal(p.points, 650);
  assert.deepEqual(p.tasks, { app: true, purchase: false });
  assert.deepEqual(p.products[SHAMPOO], { duma: 1, platforms: { tiktok: 2 } });
});

test('creator codes: readable format, case and space insensitive', () => {
  const code = generateCreatorCode();
  assert.match(code, /^TM-[A-HJ-KMNP-Z2-9]{4}-[A-HJ-KMNP-Z2-9]{4}$/);
  assert.equal(normalizeCreatorCode(' tm-ab cd-efgh '), 'TM-ABCD-EFGH');
});

test('daily cap setting falls back to the default when unset or invalid', () => {
  assert.equal(dailyCap({}), DEFAULT_DAILY_POINTS_CAP);
  assert.equal(dailyCap({ CREATOR_DAILY_POINTS_CAP: 'abc' }), DEFAULT_DAILY_POINTS_CAP);
  assert.equal(dailyCap({ CREATOR_DAILY_POINTS_CAP: '1200' }), 1200);
});

test('cleanText strips tags and control characters', () => {
  assert.equal(cleanText('<b>Loved</b> it\u0007 <script>x</script>', 100), 'Loved it x');
  assert.equal(cleanText('a'.repeat(50), 10).length, 10);
});

test('progress leaves out awards whose post was hidden (points taken back)', async () => {
  const { program, ledger } = setup();
  await program.recordDuma(alice, { productHandle: SHAMPOO, dumaItemId: 'd1' });
  await program.submitSocial(alice, { productHandle: SHAMPOO, platform: 'x', url: 'https://x.com/a/status/9' });
  ledger.rows[0].revoked = true;
  const p = await program.progress(alice);
  assert.equal(p.points, 300);
  assert.equal(p.products[SHAMPOO].duma, 0);
  assert.equal(p.products[SHAMPOO].platforms.x, 1);
});

test('verifyPointsSignature accepts a fresh Liquid-style signature and rejects forgeries', () => {
  const { verifyPointsSignature } = require('./creatorProgram');
  const crypto = require('crypto');
  const secret = 'x'.repeat(40);
  const now = Date.parse('2026-11-24T12:00:00Z');
  const ts = String(Math.floor(now / 1000) - 60);
  const sign = (msg, key = secret) => crypto.createHmac('sha256', key).update(msg).digest('hex');
  const sig = sign(`tony@example.com:${ts}`);
  assert.equal(verifyPointsSignature({ email: ' Tony@Example.com ', ts, sig }, secret, now), 'tony@example.com');
  assert.equal(verifyPointsSignature({ email: 'other@example.com', ts, sig }, secret, now), null);
  assert.equal(verifyPointsSignature({ email: 'tony@example.com', ts, sig: sign(`tony@example.com:${ts}`, 'y'.repeat(40)) }, secret, now), null);
  const old = String(Math.floor(now / 1000) - 2 * 24 * 3600);
  assert.equal(verifyPointsSignature({ email: 'tony@example.com', ts: old, sig: sign(`tony@example.com:${old}`) }, secret, now), null);
  assert.equal(verifyPointsSignature({ email: 'tony@example.com', ts, sig }, '', now), null);
  assert.equal(verifyPointsSignature({ email: 'tony@example.com', ts, sig: 'zz' }, secret, now), null);
});
