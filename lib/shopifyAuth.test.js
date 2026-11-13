const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exchangeCustomer, registerShopifyAuth } = require('./shopifyAuth');
const verifier = 'x'.repeat(43);
const reply = data => ({ ok: true, json: async () => data });
const token = { access_token: 'test-access', id_token: 'test-id' };
const discovery = { graphql_api: 'https://shopify.com/77673398450/account/customer/api/2026-10/graphql' };

test('identity comes only from the store API and not from caller supplied email', async () => {
  const calls = [];
  const responses = [token, discovery, { data: { customer: { id: 'gid://shopify/Customer/1', emailAddress: { emailAddress: 'MEMBER@example.com' } } } }];
  const result = await exchangeCustomer('one-use-code', verifier, async (url, options) => {
    calls.push({ url, options }); return reply(responses.shift());
  });
  assert.equal(result.email, 'member@example.com');
  assert.equal(calls[0].url, 'https://shopify.com/authentication/77673398450/oauth/token');
  assert.equal(new URLSearchParams(calls[0].options.body).get('code_verifier'), verifier);
  assert.equal(calls[2].options.headers.Authorization, 'test-access');
});

test('invalid PKCE is rejected before contacting Shopify', async () => {
  await assert.rejects(exchangeCustomer('code', 'short', () => { throw new Error('must not fetch'); }), /Invalid authorization/);
});

test('an unexpected API host or shop never receives a buyer token', async () => {
  for (const graphql_api of ['https://evil.example/graphql', 'https://shopify.com/other-shop/graphql', 'http://shopify.com/77673398450/graphql']) {
    let calls = 0;
    await assert.rejects(exchangeCustomer('code', verifier, async () => reply(++calls === 1 ? token : { graphql_api })), /Unexpected customer API/);
    assert.equal(calls, 2);
  }
});

test('failed upstream auth and missing identities fail closed', async () => {
  await assert.rejects(exchangeCustomer('code', verifier, async () => ({ ok: false })), /authentication failed/);
  const responses = [token, discovery, { errors: [{ message: 'Unauthorized' }] }];
  await assert.rejects(exchangeCustomer('code', verifier, async () => reply(responses.shift())), /Unable to verify/);
});

test('disabled integration and invalid origins cannot create community sessions', async () => {
  const routes = {};
  const app = { get: (path, fn) => { routes[path] = fn; }, post: (path, fn) => { routes[path] = fn; } };
  registerShopifyAuth(app, { User: {}, generateToken: () => { throw new Error('must not issue token'); }, getRankTitle: () => '' });
  const res = { set() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
  delete process.env.SHOPIFY_CUSTOMER_SSO_ENABLED;
  await routes['/api/auth/shopify/exchange']({}, res);
  assert.equal(res.statusCode, 503);
  process.env.SHOPIFY_CUSTOMER_SSO_ENABLED = 'true';
  await routes['/api/auth/shopify/exchange']({ get: () => 'https://evil.example' }, res);
  assert.equal(res.statusCode, 403);
  delete process.env.SHOPIFY_CUSTOMER_SSO_ENABLED;
});

test('a banned existing member is never issued a community session', async () => {
  const routes = {};
  const app = { get() {}, post: (path, fn) => { routes[path] = fn; } };
  const responses = [token, discovery, { data: { customer: { id: 'gid://shopify/Customer/1', emailAddress: { emailAddress: 'member@example.com' } } } }];
  let issued = false;
  registerShopifyAuth(app, { User: { findOne: async () => ({ banned: true }) }, generateToken: () => { issued = true; }, getRankTitle: () => '', fetchImpl: async () => reply(responses.shift()) });
  process.env.SHOPIFY_CUSTOMER_SSO_ENABLED = 'true';
  const res = { set() {}, status(code) { this.statusCode = code; return this; }, json() { return this; } };
  await routes['/api/auth/shopify/exchange']({ get: () => 'https://community.themajorities.com', body: { code: 'code', verifier } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(issued, false);
  delete process.env.SHOPIFY_CUSTOMER_SSO_ENABLED;
});
