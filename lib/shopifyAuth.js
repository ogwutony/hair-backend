// Customer Account API authorization-code exchange for the community site.
// Shopify owns the login session; the community keeps its existing member IDs.
const CLIENT_ID = 'a16fc149-7ebe-4b9a-bfe2-765e1fb52c54';
const AUTH_BASE = 'https://shopify.com/authentication/77673398450';
const COMMUNITY = 'https://community.themajorities.com';
const REDIRECT_URI = `${COMMUNITY}/auth/shopify/callback`;
const SHOP = 'https://c0bqfe-z2.myshopify.com';

async function readJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Shopify authentication failed');
  return response.json();
}

async function exchangeCustomer(code, verifier, fetchImpl = fetch) {
  if (typeof code !== 'string' || code.length < 1 || code.length > 4096 ||
      typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    throw new Error('Invalid authorization response');
  }
  const tokens = await readJson(fetchImpl, `${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: COMMUNITY },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI, code, code_verifier: verifier }).toString(),
  });
  if (!tokens.access_token || !tokens.id_token) throw new Error('Missing Shopify credentials');
  // Discover only from this store, never from a URL supplied by the client.
  const api = await readJson(fetchImpl, `${SHOP}/.well-known/customer-account-api`);
  const endpoint = new URL(api.graphql_api);
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'shopify.com' ||
      !endpoint.pathname.startsWith('/77673398450/')) throw new Error('Unexpected customer API');
  const result = await readJson(fetchImpl, endpoint.href, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: tokens.access_token },
    body: JSON.stringify({ query: 'query CommunityIdentity { customer { id emailAddress { emailAddress } } }' }),
  });
  const customer = result.data?.customer;
  const email = customer?.emailAddress?.emailAddress;
  if (result.errors?.length || !customer?.id || typeof email !== 'string' || !email.includes('@')) {
    throw new Error('Unable to verify Shopify customer');
  }
  return { email: email.trim().toLowerCase(), customerId: customer.id, idToken: tokens.id_token };
}

function registerShopifyAuth(app, { User, generateToken, getRankTitle, fetchImpl = fetch }) {
  const enabled = () => process.env.SHOPIFY_CUSTOMER_SSO_ENABLED === 'true';
  app.get('/api/auth/shopify/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: enabled(), clientId: CLIENT_ID, redirectUri: REDIRECT_URI,
      authorizationEndpoint: `${AUTH_BASE}/oauth/authorize` });
  });
  app.post('/api/auth/shopify/exchange', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!enabled()) return res.status(503).json({ error: 'Shopify sign-in is not enabled yet.' });
    if (req.get('origin') !== COMMUNITY) return res.status(403).json({ error: 'Invalid origin' });
    try {
      const identity = await exchangeCustomer(req.body?.code, req.body?.verifier, fetchImpl);
      // An authenticated Shopify customer proves ownership of this email. Existing
      // community profiles, posts, rank, and moderation state stay on the same user.
      let user = await User.findOne({ email: identity.email });
      if (!user) {
        try { user = await User.create({ email: identity.email }); }
        catch (error) {
          if (error.code !== 11000) throw error;
          user = await User.findOne({ email: identity.email });
        }
      }
      if (!user || user.banned) return res.status(403).json({ error: 'This account is unavailable.' });
      const logout = new URL(`${AUTH_BASE}/logout`);
      logout.searchParams.set('id_token_hint', identity.idToken);
      logout.searchParams.set('post_logout_redirect_uri', `${COMMUNITY}/login`);
      res.json({ token: generateToken(user._id, false), email: user.email,
        rank_title: getRankTitle(user.rank_score || 1), rank_score: user.rank_score || 1,
        logoutUrl: logout.href });
    } catch {
      // Never log the code, verifier, access token, ID token, or full upstream response.
      res.status(401).json({ error: 'Sign-in could not be verified. Please try again.' });
    }
  });
}
module.exports = { exchangeCustomer, registerShopifyAuth };
