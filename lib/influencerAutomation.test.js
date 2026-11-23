const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discountPercent, isAutomationEnabled, baseDiscountCode, codeCandidates, reserveDiscountCode,
  buildWebhookPayload, sendToMake,
} = require('./influencerAutomation');

test('baseDiscountCode uppercases, strips spaces/punctuation/accents and appends the percent', () => {
  assert.equal(baseDiscountCode('Sarah Smith'), 'SARAHSMITH5');
  assert.equal(baseDiscountCode("José O'Neil-Brown"), 'JOSEONEILBROWN5');
  assert.equal(baseDiscountCode('  sarah  '), 'SARAH5');
  assert.equal(baseDiscountCode('Ana', 10), 'ANA10');
  assert.equal(baseDiscountCode('😀 !!'), 'CREATOR5');
  assert.equal(baseDiscountCode('A'.repeat(50)).length, 21);
});

test('codeCandidates starts with the plain code, then letter suffixes, then random digits', () => {
  const list = codeCandidates('Sarah Smith', 5, () => 42);
  assert.equal(list[0], 'SARAHSMITH5');
  assert.equal(list[1], 'SARAHSMITH5B');
  assert.equal(list[list.length - 1], 'SARAHSMITH51042');
});

test('reserveDiscountCode skips taken codes', async () => {
  const taken = new Set(['SARAHSMITH5', 'SARAHSMITH5B']);
  assert.equal(await reserveDiscountCode('Sarah Smith', async (c) => taken.has(c)), 'SARAHSMITH5C');
  assert.equal(await reserveDiscountCode('Sarah Smith', async () => true), null);
});

test('discountPercent and isAutomationEnabled read env safely', () => {
  assert.equal(discountPercent({}), 5);
  assert.equal(discountPercent({ INFLUENCER_DISCOUNT_PERCENT: '10' }), 10);
  assert.equal(discountPercent({ INFLUENCER_DISCOUNT_PERCENT: 'abc' }), 5);
  assert.equal(isAutomationEnabled({}), false);
  assert.equal(isAutomationEnabled({ MAKE_INFLUENCER_WEBHOOK_URL: 'http://insecure' }), false);
  assert.equal(isAutomationEnabled({ MAKE_INFLUENCER_WEBHOOK_URL: 'https://hook.us1.make.com/abc' }), true);
});

test('buildWebhookPayload flattens the application for Make', () => {
  const payload = buildWebhookPayload({
    application: {
      category: 'Creator / Influencer Partners', name: 'Sarah Smith', contactEmail: 'sarah@biz.com',
      details: {
        socialAccounts: JSON.stringify([{ platform: 'Instagram', url: 'https://instagram.com/sarah', followers: '12k' }]),
        city: 'Atlanta', state: 'GA', country: 'United States', doneBefore: 'No',
      },
    },
    code: 'SARAHSMITH5', percent: 5, user: { email: 'sarah@gmail.com' }, item: { _id: 'abc123' },
    media: [{ url: 'https://cdn/x.jpg' }],
  });
  assert.equal(payload.fullName, 'Sarah Smith');
  assert.equal(payload.firstName, 'Sarah');
  assert.equal(payload.businessEmail, 'sarah@biz.com');
  assert.equal(payload.accountEmail, 'sarah@gmail.com');
  assert.equal(payload.discountCode, 'SARAHSMITH5');
  assert.equal(payload.shopifyValue, '-5.0');
  assert.equal(payload.priceRuleTitle, 'Sarah Smith Referral');
  assert.equal(payload.socialHandles, 'Instagram: https://instagram.com/sarah (12k followers)');
  assert.equal(payload.primarySocialUrl, 'https://instagram.com/sarah');
  assert.equal(payload.applicationId, 'abc123');
  assert.deepEqual(payload.mediaUrls, ['https://cdn/x.jpg']);
});

test('sendToMake posts JSON with the shared secret and never throws', async () => {
  const env = { MAKE_INFLUENCER_WEBHOOK_URL: 'https://hook.make.com/x', MAKE_INFLUENCER_WEBHOOK_SECRET: 's3cret' };
  let call;
  const ok = await sendToMake({ a: 1 }, { env, fetchImpl: async (url, opts) => { call = { url, opts }; return { ok: true, status: 200 }; } });
  assert.deepEqual(ok, { ok: true, status: 200 });
  assert.equal(call.url, 'https://hook.make.com/x');
  assert.equal(call.opts.headers['X-Majorities-Secret'], 's3cret');
  assert.equal(call.opts.body, '{"a":1}');

  const down = await sendToMake({}, { env, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.deepEqual(down, { ok: false, error: 'ECONNRESET' });
  assert.deepEqual(await sendToMake({}, { env: {} }), { ok: false, skipped: 'not_configured' });
});
