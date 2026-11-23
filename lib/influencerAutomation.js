// Creator / Influencer partner automation.
//
// When someone submits a "Creator / Influencer Partners" application (POST /api/duma/partner),
// the server reserves a personal discount code for them (e.g. "Sarah Smith" -> SARAHSMITH5) and
// POSTs the application as JSON to a Make (make.com) Custom Webhook. The Make scenario then:
//   1. creates the 5% Shopify price rule / discount for that code, and
//   2. emails the creator their code.
// See docs/INFLUENCER_MAKE_AUTOMATION.md for the scenario setup.
//
// Env:
//   MAKE_INFLUENCER_WEBHOOK_URL    Make Custom Webhook URL. Unset = automation off.
//   MAKE_INFLUENCER_WEBHOOK_SECRET Optional shared secret, sent as the X-Majorities-Secret header
//                                  so the Make scenario can ignore requests that don't carry it.
//   INFLUENCER_DISCOUNT_PERCENT    Follower discount, default 5.

const DEFAULT_DISCOUNT_PERCENT = 5;
const MAX_CODE_BASE = 20; // keeps codes short enough to type and say out loud
const WEBHOOK_TIMEOUT_MS = 10000;

const discountPercent = (env = process.env) => {
  const n = Number(env.INFLUENCER_DISCOUNT_PERCENT);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : DEFAULT_DISCOUNT_PERCENT;
};

const isAutomationEnabled = (env = process.env) => /^https:\/\//i.test(String(env.MAKE_INFLUENCER_WEBHOOK_URL || '').trim());

// "Sarah Smith" -> "SARAHSMITH5"; "José O'Neil-Brown" -> "JOSEONEILBROWN5".
// Accents are stripped and anything that isn't A–Z / 0–9 is dropped. Falls back to "CREATOR".
const baseDiscountCode = (fullName, percent = DEFAULT_DISCOUNT_PERCENT) => {
  const letters = String(fullName || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, MAX_CODE_BASE);
  return `${letters || 'CREATOR'}${percent}`;
};

// Candidates in order: SARAHSMITH5, SARAHSMITH5B, SARAHSMITH5C, … then a random suffix.
const codeCandidates = (fullName, percent, randomInt = (n) => Math.floor(Math.random() * n)) => {
  const base = baseDiscountCode(fullName, percent);
  const list = [base];
  for (const letter of 'BCDEFGHJK') list.push(`${base}${letter}`);
  for (let i = 0; i < 5; i += 1) list.push(`${base}${String(1000 + randomInt(9000))}`);
  return list;
};

// Picks the first candidate `isTaken(code)` reports as free. Returns null if all are taken.
const reserveDiscountCode = async (fullName, isTaken, percent = DEFAULT_DISCOUNT_PERCENT, randomInt) => {
  for (const code of codeCandidates(fullName, percent, randomInt)) {
    if (!(await isTaken(code))) return code;
  }
  return null;
};

const parseSocials = (raw) => {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Flat JSON body for the Make webhook. Flat keys map cleanly in Make's field picker.
const buildWebhookPayload = ({ application, code, percent, user, item, media = [] }) => {
  const details = application.details || {};
  const socials = parseSocials(details.socialAccounts)
    .map((s) => ({ platform: String(s.platform || ''), url: String(s.url || ''), followers: String(s.followers || '') }));
  const fullName = application.name;
  return {
    event: 'influencer_partner_application',
    submittedAt: new Date().toISOString(),
    applicationId: item?._id ? String(item._id) : null,
    category: application.category,
    fullName,
    firstName: String(fullName || '').trim().split(/\s+/)[0] || fullName,
    businessEmail: application.contactEmail,
    accountEmail: user?.email || null,
    // Shopify fields, ready to drop into the Make modules
    discountCode: code,
    discountPercent: percent,
    shopifyValue: `-${Number(percent).toFixed(1)}`, // Shopify price rules take a negative value
    priceRuleTitle: `${fullName} Referral`,
    // Application details
    socialHandles: socials.map((s) => `${s.platform}: ${s.url}${s.followers ? ` (${s.followers} followers)` : ''}`).join('\n'),
    socialAccounts: socials,
    primarySocialUrl: socials[0]?.url || '',
    city: details.city || '',
    state: details.state || '',
    country: details.country || '',
    contentPitch: details.contentPitch || '',
    doneBefore: details.doneBefore || '',
    experienceDetails: details.experienceDetails || '',
    mediaUrls: media.map((m) => m.url),
  };
};

// POSTs the payload to Make. Resolves { ok, status } and never throws, so a Make outage can't
// break the application itself. `fetchImpl` is injectable for tests.
const sendToMake = async (payload, { env = process.env, fetchImpl = globalThis.fetch } = {}) => {
  const url = String(env.MAKE_INFLUENCER_WEBHOOK_URL || '').trim();
  if (!isAutomationEnabled(env)) return { ok: false, skipped: 'not_configured' };
  const headers = { 'Content-Type': 'application/json' };
  if (env.MAKE_INFLUENCER_WEBHOOK_SECRET) headers['X-Majorities-Secret'] = env.MAKE_INFLUENCER_WEBHOOK_SECRET;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

module.exports = {
  DEFAULT_DISCOUNT_PERCENT,
  discountPercent,
  isAutomationEnabled,
  baseDiscountCode,
  codeCandidates,
  reserveDiscountCode,
  buildWebhookPayload,
  sendToMake,
};
