// lib/shopifyCustomers.js
// Keeps themajorities.com accounts and Shopify customers in step, matched by email.
// Every website account gets a Shopify customer tagged "themajorities.com", so orders, subscriptions
// and customer records in Shopify admin line up with the people who log in on the site.
//
// Needs SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET from a Dev Dashboard app with the read_customers +
// write_customers scopes, installed on the store. They are exchanged for an Admin API token that lasts
// 24 hours (client credentials grant). Without them, sync is skipped and logins work as before.

const axios = require('axios');

const SITE_TAG = 'themajorities.com';
// Apple sign-in without a shared email gets a placeholder address that Shopify should never see
const PLACEHOLDER_EMAIL = /@users\.themajorities\.com$/i;

// Refresh this long before the token expires
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

const isShopifyCustomerSyncConfigured = () => Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);

const shopDomain = () => process.env.SHOPIFY_STORE_DOMAIN || 'c0bqfe-z2.myshopify.com';

let cachedToken = null; // { value, expiresAt }
let tokenRequest = null; // shared so concurrent logins make only one token request

const requestAccessToken = async () => {
  try {
    const res = await axios.post(
      `https://${shopDomain()}/admin/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 },
    );
    return { value: res.data.access_token, expiresAt: Date.now() + res.data.expires_in * 1000 };
  } catch (err) {
    // Report only the status and Shopify's error code: the request itself contains the client secret
    const reason = err.response?.data?.error || err.response?.status || err.code || 'network error';
    throw new Error(`Shopify token request failed: ${reason}`);
  }
};

const getAccessToken = async () => {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS) return cachedToken.value;
  if (!tokenRequest) {
    tokenRequest = requestAccessToken()
      .then((token) => { cachedToken = token; return token.value; })
      .finally(() => { tokenRequest = null; });
  }
  return tokenRequest;
};

const postAdminGraphql = async (query, variables) => {
  const version = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
  return axios.post(
    `https://${shopDomain()}/admin/api/${version}/graphql.json`,
    { query, variables },
    { headers: { 'X-Shopify-Access-Token': await getAccessToken(), 'Content-Type': 'application/json' }, timeout: 10000 },
  );
};

const adminGraphql = async (query, variables) => {
  let res;
  try {
    res = await postAdminGraphql(query, variables);
  } catch (err) {
    if (err.response?.status !== 401) throw err;
    // Token no longer valid (e.g. secret rotated or app reinstalled): get a new one and retry once
    cachedToken = null;
    res = await postAdminGraphql(query, variables);
  }
  if (res.data.errors) {
    const message = Array.isArray(res.data.errors) ? res.data.errors[0].message : String(res.data.errors);
    throw new Error(`Shopify Admin API error: ${message}`);
  }
  return res.data.data;
};

const FIND_CUSTOMER = `
  query FindCustomer($query: String!) {
    customers(first: 1, query: $query) { edges { node { id tags } } }
  }
`;

const CREATE_CUSTOMER = `
  mutation CreateCustomer($input: CustomerInput!) {
    customerCreate(input: $input) { customer { id } userErrors { field message } }
  }
`;

const ADD_TAGS = `
  mutation AddTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
  }
`;

const splitName = (displayName) => {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || undefined };
};

// Find or create the Shopify customer for this email. Returns the customer GID, or null when skipped.
const syncShopifyCustomer = async ({ email, displayName } = {}) => {
  if (!isShopifyCustomerSyncConfigured()) return null;
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized || PLACEHOLDER_EMAIL.test(normalized)) return null;

  const found = await adminGraphql(FIND_CUSTOMER, { query: `email:"${normalized.replace(/"/g, '')}"` });
  const existing = found.customers.edges[0]?.node;
  if (existing) {
    if (!existing.tags.includes(SITE_TAG)) await adminGraphql(ADD_TAGS, { id: existing.id, tags: [SITE_TAG] });
    return existing.id;
  }

  const created = await adminGraphql(CREATE_CUSTOMER, {
    input: { email: normalized, tags: [SITE_TAG], ...splitName(displayName) },
  });
  const { customer, userErrors } = created.customerCreate;
  if (userErrors.length) throw new Error(`Shopify customerCreate: ${userErrors[0].message}`);
  return customer.id;
};

// Sync a website user document and remember the Shopify customer id on it.
// Never throws: a Shopify outage must not block signing in.
const linkUserToShopify = async (user) => {
  if (!user || user.shopifyCustomerId || !isShopifyCustomerSyncConfigured()) return null;
  try {
    const id = await syncShopifyCustomer({ email: user.email, displayName: user.displayName });
    if (id) {
      user.shopifyCustomerId = id;
      // Targeted update so this background write can't overwrite other fields saved meanwhile
      await user.constructor.updateOne({ _id: user._id }, { $set: { shopifyCustomerId: id } });
    }
    return id;
  } catch (err) {
    console.warn(`Shopify customer sync failed for ${user.email}: ${err.message}`);
    return null;
  }
};

module.exports = { SITE_TAG, isShopifyCustomerSyncConfigured, syncShopifyCustomer, linkUserToShopify };
