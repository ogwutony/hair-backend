// lib/creatorProgram.js
// Creator program (themajorities.com/pages/influencers): creator codes, post-link checks and the
// points rules. Every rule that pays points lives here, on the server; the Shopify page only shows
// results. Points land in the member's existing rank score (profile page) through awardPoints.
//
// Rules (owner-approved):
//   First Duma post for a product ............................. 200
//   Repeat Duma post for the same product ..................... 150
//   First post link on a platform for a product ............... 300
//   Repeat post link on the same platform for the same product  150
//   A different product or platform starts again at "first".
//   The same post URL is never paid twice (unique ledger key).
//   Links must be on the platform's own domain.
//   Daily cap per creator: CREATOR_DAILY_POINTS_CAP (rolling 24 hours).

const crypto = require('crypto');

const POINTS = Object.freeze({ dumaFirst: 200, dumaRepeat: 150, socialFirst: 300, socialRepeat: 150 });

// Owner has not set the cap yet. Change it with the CREATOR_DAILY_POINTS_CAP environment variable.
const DEFAULT_DAILY_POINTS_CAP = 3000;
const dailyCap = (env = process.env) => {
  const n = Number.parseInt(env.CREATOR_DAILY_POINTS_CAP, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_POINTS_CAP;
};

const PLATFORMS = Object.freeze({
  tiktok: { label: 'TikTok', domains: ['tiktok.com'] },
  instagram: { label: 'Instagram', domains: ['instagram.com'] },
  pinterest: { label: 'Pinterest', domains: ['pinterest.com', 'pin.it'] },
  snapchat: { label: 'Snapchat', domains: ['snapchat.com'] },
  x: { label: 'X', domains: ['x.com', 'twitter.com'] },
  facebook: { label: 'Facebook', domains: ['facebook.com', 'fb.watch', 'fb.com'] },
  youtube: { label: 'YouTube', domains: ['youtube.com', 'youtu.be'] },
});

// Products creators can review (Shopify handles). Titles are used in Duma post titles.
const PRODUCTS = Object.freeze({
  'the-majorities-shampoo': 'The Majorities Shampoo - 100ml',
  'the-majorities-conditioner': 'The Majorities Conditioner - 100ml',
  'the-majorities-hair-oil': 'The Majorities Hair Oil - 100ml',
  'the-majorities-facial-scrub': 'The Majorities Facial Scrub - 100ml',
  'the-majorities-face-tonner': 'The Majorities Face Toner - 100ml',
  'the-majorities-moisturizing-lotion': 'The Majorities Moisturizing Lotion - 100ml',
  'the-majorities-3-in-1-hair-routine-bundle-3-bottle-set': 'The Majorities 3-Bottle Hair Routine Bundle',
  'the-majorities-3-in-1-face-routine-bundle-3-bottle-set': 'The Majorities 3-Bottle Face Routine Bundle',
  'the-majorities-6-in-1-face-and-hair-routine-bundle': 'The Majorities 6-Bottle Face and Hair Routine Bundle',
  'the-majorities-6-bottle-double-hair-routine-bundle': 'The Majorities 6-Bottle Double Hair Routine Bundle',
  'the-majorities-6-bottle-double-face-routine-bundle': 'The Majorities 6-Bottle Double Face Routine Bundle',
});

const SHOP_URL = 'https://themajorities.com';
const productUrl = (handle) => `${SHOP_URL}/products/${handle}`;

// ── Creator codes ──────────────────────────────────────────────────────────────
// Format TM-XXXX-XXXX from an alphabet without look-alike characters (no 0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const generateCreatorCode = (randomBytes = crypto.randomBytes) => {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `TM-${chars.slice(0, 4)}-${chars.slice(4)}`;
};
const normalizeCreatorCode = (code) => String(code || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);
const normalizeEmail = (email) => String(email || '').trim().toLowerCase().slice(0, 254);

// ── Post links ─────────────────────────────────────────────────────────────────
const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

// Returns { url, key } or { error }. `key` is the duplicate-check identity of the post: host
// without www/m, path without trailing slash, no tracking query or hash. YouTube keeps the video id.
const normalizePostUrl = (raw, platform) => {
  const spec = PLATFORMS[platform];
  if (!spec) return { error: 'Choose a valid platform.' };
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return { error: 'Paste the full link to your post, starting with https://' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Paste the full link to your post, starting with https://' };
  if (url.username || url.password) return { error: 'That link is not a valid post link.' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!spec.domains.some((d) => hostMatches(host, d))) {
    return { error: `That link isn't on ${spec.label}. Paste the link to your ${spec.label} post.` };
  }
  const bareHost = host.replace(/^(www|m|mobile|web)\./, '');
  let path = url.pathname.replace(/\/+$/, '') || '/';
  let id = '';
  if (platform === 'youtube') {
    if (bareHost === 'youtu.be') id = path.slice(1).split('/')[0];
    else if (url.searchParams.get('v')) id = url.searchParams.get('v');
    else {
      const m = path.match(/^\/(shorts|live|embed)\/([^/]+)/);
      if (m) id = m[2];
    }
  }
  if (platform === 'facebook' && /^\/(watch|story\.php|permalink\.php|profile\.php)$/.test(path)) {
    const keep = ['v', 'story_fbid', 'id'].map((k) => url.searchParams.get(k) && `${k}=${url.searchParams.get(k)}`).filter(Boolean);
    path = `${path}?${keep.join('&')}`;
  }
  if (path === '/' && !id) return { error: 'Paste the link to the post itself, not your profile.' };
  const key = id ? `youtube:${id}` : `${platform}:${bareHost}${path.toLowerCase()}`;
  return { url: url.href.slice(0, 2000), key: key.slice(0, 500) };
};

// ── Points ─────────────────────────────────────────────────────────────────────
const pointsFor = (kind, priorCount) => {
  if (kind === 'duma') return priorCount > 0 ? POINTS.dumaRepeat : POINTS.dumaFirst;
  return priorCount > 0 ? POINTS.socialRepeat : POINTS.socialFirst;
};

// Pays what is left under the cap, never more.
const capAward = (points, earnedToday, cap) => Math.max(0, Math.min(points, cap - earnedToday));

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The creator program service. Storage and the rank system are injected so the rules can be tested
 * without a database.
 *   ledger.count({ userId, productHandle, platform })      -> number of earlier submissions
 *   ledger.pointsSince(userId, date)                        -> points paid since date
 *   ledger.insert(row)                                      -> throws { code: 11000 } on duplicate urlKey
 *   ledger.listForUser(userId)                              -> rows
 *   awardPoints(user, points, reason)                       -> adds to the member's rank score
 */
const createCreatorProgram = ({ ledger, awardPoints, now = () => new Date(), env = process.env }) => {
  const record = async (user, { kind, productHandle, platform, url = null, urlKey = null, dumaItemId = null }) => {
    const prior = await ledger.count({ userId: user._id, productHandle, platform });
    const base = pointsFor(kind, prior);
    const earnedToday = await ledger.pointsSince(user._id, new Date(now().getTime() - DAY_MS));
    const cap = dailyCap(env);
    const points = capAward(base, earnedToday, cap);
    const row = {
      userId: user._id,
      creatorCode: user.creatorCode,
      productHandle,
      platform,
      url,
      urlKey,
      dumaItemId,
      points,
      basePoints: base,
      repeat: prior > 0,
      createdAt: now(),
    };
    await ledger.insert(row); // a duplicate urlKey throws before any points are paid
    if (points > 0) await awardPoints(user, points, `creator:${platform}:${productHandle}`);
    return { points, basePoints: base, capped: points < base, repeat: prior > 0 };
  };

  const submitSocial = async (user, { productHandle, platform, url }) => {
    if (!PRODUCTS[productHandle]) return { status: 400, error: 'Choose a product from the checklist.' };
    const link = normalizePostUrl(url, platform);
    if (link.error) return { status: 400, error: link.error };
    try {
      const result = await record(user, { kind: 'social', productHandle, platform, url: link.url, urlKey: link.key });
      return { status: 201, ...result };
    } catch (err) {
      if (err && err.code === 11000) return { status: 409, error: 'That post link was already submitted. Each post can earn points once.' };
      throw err;
    }
  };

  const recordDuma = async (user, { productHandle, dumaItemId }) =>
    record(user, { kind: 'duma', productHandle, platform: 'duma', dumaItemId });

  // Shape the checklist page reads: { points, tasks, products: { handle: { duma, platforms } } }
  const progress = async (user) => {
    // Awards for posts hidden by moderation no longer count
    const rows = (await ledger.listForUser(user._id)).filter((row) => !row.revoked);
    const products = {};
    for (const row of rows) {
      const p = (products[row.productHandle] ||= { duma: 0, platforms: {} });
      if (row.platform === 'duma') p.duma += 1;
      else p.platforms[row.platform] = (p.platforms[row.platform] || 0) + 1;
    }
    return {
      points: rows.reduce((sum, row) => sum + (row.points || 0), 0),
      rankScore: user.rank_score || 0,
      tasks: { app: !!user.creatorTasks?.app, purchase: !!user.creatorTasks?.purchase },
      products,
    };
  };

  return { submitSocial, recordDuma, progress };
};

// Text for the Duma post body: plain text only (the Duma renders text, never HTML).
const cleanText = (value, max) => String(value || '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/<[^>]*>/g, '')
  .trim()
  .slice(0, max);

// The Influencers page (Shopify theme) proves which signed-in store customer is viewing it by
// signing "<email>:<unix seconds>" with HMAC-SHA256 in Liquid (hmac_sha256 filter) using a secret
// shared with this server (CREATOR_POINTS_SECRET). Only Shopify's server knows the secret, so a
// visitor cannot forge a signature for someone else's email. Signatures expire after maxAgeSec.
const POINTS_SIGNATURE_MAX_AGE_SEC = 24 * 60 * 60;
const verifyPointsSignature = ({ email, ts, sig }, secret, nowMs = Date.now(), maxAgeSec = POINTS_SIGNATURE_MAX_AGE_SEC) => {
  if (!secret || typeof secret !== 'string' || secret.length < 32) return null;
  const address = normalizeEmail(email);
  const stamp = String(ts || '');
  const given = String(sig || '').toLowerCase();
  if (!address.includes('@') || !/^\d{1,12}$/.test(stamp) || !/^[0-9a-f]{64}$/.test(given)) return null;
  const age = nowMs / 1000 - Number(stamp);
  if (age > maxAgeSec || age < -300) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${address}:${stamp}`).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'))) return null;
  return address;
};

module.exports = {
  POINTS,
  DEFAULT_DAILY_POINTS_CAP,
  PLATFORMS,
  PRODUCTS,
  productUrl,
  dailyCap,
  generateCreatorCode,
  normalizeCreatorCode,
  normalizeEmail,
  normalizePostUrl,
  pointsFor,
  capAward,
  createCreatorProgram,
  cleanText,
  verifyPointsSignature,
  POINTS_SIGNATURE_MAX_AGE_SEC,
};
