// lib/wholesale.js
// Wholesale catalog for approved partners. Products are read from Shopify's Storefront API
// (everything with product type "Wholesale") and returned in a small, flat shape for hair-frontend.
//
// Needs SHOPIFY_STOREFRONT_TOKEN (Storefront API access token from a Shopify custom / headless app
// with "unauthenticated_read_product_listings" + "unauthenticated_read_product_inventory").
// The token stays on the server; only approved users can reach the route that calls this.

const axios = require('axios');

const WHOLESALE_PRODUCT_TYPE = 'Wholesale';
const CACHE_TTL_MS = 5 * 60 * 1000;

const PRODUCTS_QUERY = `
  query WholesaleProducts($query: String!) {
    products(first: 50, query: $query) {
      edges {
        node {
          id
          title
          handle
          description
          productType
          featuredImage { url altText }
          variants(first: 25) {
            edges {
              node {
                id
                title
                availableForSale
                price { amount currencyCode }
              }
            }
          }
        }
      }
    }
  }
`;

// "gid://shopify/ProductVariant/123456" -> "123456" (the id used in cart permalinks)
const numericId = (gid) => String(gid || '').split('/').pop();

const normalizeProducts = (data) => {
  const edges = data?.products?.edges || [];
  return edges
    .map(({ node }) => node)
    // Storefront search is fuzzy; keep only exact product-type matches
    .filter((p) => p && p.productType === WHOLESALE_PRODUCT_TYPE)
    .map((p) => ({
      id: numericId(p.id),
      title: p.title,
      handle: p.handle,
      description: p.description || '',
      image: p.featuredImage ? { url: p.featuredImage.url, alt: p.featuredImage.altText || p.title } : null,
      variants: (p.variants?.edges || []).map(({ node: v }) => ({
        id: numericId(v.id),
        title: v.title,
        availableForSale: !!v.availableForSale,
        price: Number(v.price?.amount || 0),
        currency: v.price?.currencyCode || 'USD',
      })),
    }));
};

let cache = { at: 0, products: null };

const fetchWholesaleProducts = async ({ domain, token, apiVersion, fetchFn = axios.post } = {}) => {
  if (!token) {
    const err = new Error('Wholesale catalog is not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  if (cache.products && Date.now() - cache.at < CACHE_TTL_MS) return cache.products;

  const res = await fetchFn(
    `https://${domain}/api/${apiVersion}/graphql.json`,
    { query: PRODUCTS_QUERY, variables: { query: `product_type:${WHOLESALE_PRODUCT_TYPE}` } },
    { headers: { 'X-Shopify-Storefront-Access-Token': token, 'Content-Type': 'application/json' }, timeout: 10000 },
  );
  if (res.data?.errors?.length) {
    const err = new Error(`Shopify Storefront API error: ${res.data.errors[0].message}`);
    err.code = 'SHOPIFY_ERROR';
    throw err;
  }
  const products = normalizeProducts(res.data?.data);
  cache = { at: Date.now(), products };
  return products;
};

const clearWholesaleCache = () => { cache = { at: 0, products: null }; };

module.exports = { WHOLESALE_PRODUCT_TYPE, normalizeProducts, fetchWholesaleProducts, clearWholesaleCache };
