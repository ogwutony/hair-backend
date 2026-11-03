// lib/shopifyCustomers.js
// Keeps themajorities.com accounts and Shopify customers in step, matched by email.
// Every website account gets a Shopify customer tagged "themajorities.com", so orders, subscriptions
// and customer records in Shopify admin line up with the people who log in on the site.
//
// Needs SHOPIFY_ADMIN_TOKEN: an Admin API access token from a Shopify custom app with the
// read_customers + write_customers scopes. Without it, sync is skipped and logins work as before.

const axios = require('axios');

const SITE_TAG = 'themajorities.com';
// Apple sign-in without a shared email gets a placeholder address that Shopify should never see
const PLACEHOLDER_EMAIL = /@users\.themajorities\.com$/i;

const isShopifyCustomerSyncConfigured = () => Boolean(process.env.SHOPIFY_ADMIN_TOKEN);

const adminGraphql = async (query, variables) => {
  const shop = process.env.SHOPIFY_STORE_DOMAIN || 'c0bqfe-z2.myshopify.com';
  const version = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';
  const res = await axios.post(
    `https://${shop}/admin/api/${version}/graphql.json`,
    { query, variables },
    { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' }, timeout: 10000 },
  );
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
