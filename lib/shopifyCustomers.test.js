// Run with: node --test lib/shopifyCustomers.test.js
// Uses a fake axios, so it never calls Shopify.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const calls = [];
let respond = () => { throw new Error('no fake response set'); };
const fakeAxios = {
  post: async (url, body, options) => {
    calls.push({ url, body, options });
    return respond(url, body, options);
  },
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  return request === 'axios' ? fakeAxios : originalLoad.call(this, request, ...rest);
};

process.env.SHOPIFY_CLIENT_ID = 'test-id';
process.env.SHOPIFY_CLIENT_SECRET = 'test-secret';
process.env.SHOPIFY_STORE_DOMAIN = 'test.myshopify.com';

const httpError = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
const isTokenCall = (url) => url.endsWith('/admin/oauth/access_token');

// Each test loads a fresh copy of the module so the cached token starts empty
const load = () => {
  delete require.cache[require.resolve('./shopifyCustomers')];
  return require('./shopifyCustomers');
};

// A store with one existing tagged customer. Issues tok-1, tok-2, ... and accepts only `validToken()`.
const fakeShop = ({ validToken = () => 'tok-1', expiresIn = 86399 } = {}) => {
  let issued = 0;
  calls.length = 0;
  respond = (url, body, options) => {
    if (isTokenCall(url)) {
      issued += 1;
      return { data: { access_token: `tok-${issued}`, expires_in: expiresIn, scope: 'read_customers,write_customers' } };
    }
    if (options.headers['X-Shopify-Access-Token'] !== validToken()) throw httpError(401, {});
    return { data: { data: { customers: { edges: [{ node: { id: 'gid://shopify/Customer/1', tags: ['themajorities.com'] } }] } } } };
  };
};
const tokenCalls = () => calls.filter((c) => isTokenCall(c.url));

test('exchanges client credentials using a form-encoded request', async () => {
  fakeShop();
  const id = await load().syncShopifyCustomer({ email: 'a@example.com' });
  assert.strictEqual(id, 'gid://shopify/Customer/1');
  assert.strictEqual(calls[0].url, 'https://test.myshopify.com/admin/oauth/access_token');
  assert.strictEqual(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(calls[0].body)), {
    grant_type: 'client_credentials', client_id: 'test-id', client_secret: 'test-secret',
  });
});

test('reuses the token between calls and shares one request across concurrent calls', async () => {
  fakeShop();
  const { syncShopifyCustomer } = load();
  await Promise.all([1, 2, 3].map((n) => syncShopifyCustomer({ email: `${n}@example.com` })));
  await syncShopifyCustomer({ email: '4@example.com' });
  assert.strictEqual(tokenCalls().length, 1);
});

test('refreshes the token once it is close to expiring', async (t) => {
  fakeShop({ validToken: () => calls.filter((c) => isTokenCall(c.url)).length === 1 ? 'tok-1' : 'tok-2' });
  const { syncShopifyCustomer } = load();
  const start = Date.now();
  t.mock.method(Date, 'now', () => start);
  await syncShopifyCustomer({ email: 'a@example.com' });
  Date.now.mock.mockImplementation(() => start + 86399 * 1000 - 59 * 1000);
  await syncShopifyCustomer({ email: 'a@example.com' });
  assert.strictEqual(tokenCalls().length, 2);
});

test('gets a new token and retries once after a 401', async () => {
  fakeShop({ validToken: () => 'tok-2' });
  const id = await load().syncShopifyCustomer({ email: 'a@example.com' });
  assert.strictEqual(id, 'gid://shopify/Customer/1');
  assert.strictEqual(tokenCalls().length, 2);
});

test('token failures report Shopify\'s error code, never the secret', async () => {
  calls.length = 0;
  respond = () => { throw httpError(400, { error: 'shop_not_permitted' }); };
  await assert.rejects(load().syncShopifyCustomer({ email: 'a@example.com' }), (err) => {
    assert.match(err.message, /shop_not_permitted/);
    assert.doesNotMatch(err.message, /test-secret/);
    return true;
  });
});

test('a failed token request is not cached', async () => {
  calls.length = 0;
  respond = () => { throw httpError(500, {}); };
  const { syncShopifyCustomer } = load();
  await assert.rejects(syncShopifyCustomer({ email: 'a@example.com' }));
  fakeShop();
  assert.strictEqual(await syncShopifyCustomer({ email: 'a@example.com' }), 'gid://shopify/Customer/1');
});

test('linkUserToShopify does not throw when Shopify is down', async (t) => {
  t.mock.method(console, 'warn', () => {});
  respond = () => { throw httpError(500, {}); };
  const user = { email: 'a@example.com', constructor: { updateOne: async () => {} } };
  assert.strictEqual(await load().linkUserToShopify(user), null);
});

test('sync is off when either credential is missing', () => {
  const { isShopifyCustomerSyncConfigured } = load();
  assert.strictEqual(isShopifyCustomerSyncConfigured(), true);
  const saved = process.env.SHOPIFY_CLIENT_SECRET;
  delete process.env.SHOPIFY_CLIENT_SECRET;
  assert.strictEqual(isShopifyCustomerSyncConfigured(), false);
  process.env.SHOPIFY_CLIENT_SECRET = saved;
});
