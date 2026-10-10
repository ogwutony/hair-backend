// lib/shopifyImport.js
// Reads a partner's public Shopify catalog (https://<store>/products.json) so Marketplace Access
// applicants can import their products instead of typing them in. Only public storefront data is
// read: no Shopify credentials are involved. Because the store address comes from the applicant,
// every hop is checked so the server never fetches a private / internal address.
const dns = require('dns').promises;
const net = require('net');

const MAX_PRODUCTS = 250;
const TIMEOUT_MS = 8000;

class ImportError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

// "https://Shop.example.com/collections/all" -> "shop.example.com"; "mystore" -> "mystore.myshopify.com"
const normalizeStoreHost = (input) => {
  let t = String(input || '').trim().toLowerCase();
  if (!t) return '';
  t = t.replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  if (/^[a-z0-9-]+$/.test(t)) t = `${t}.myshopify.com`; // bare store handle
  return t;
};

const isValidHostname = (host) =>
  host.length <= 253 &&
  /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) &&
  !/(^|\.)(localhost|local|internal|lan|home|corp|onrender\.com)$/.test(host);

const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
};

const assertPublicHost = async (host) => {
  if (!isValidHostname(host)) throw new ImportError('Please enter a valid store address, like yourstore.myshopify.com', 400);
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch (e) { throw new ImportError("We couldn't find that store. Check the address and try again."); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new ImportError('That store address is not allowed.', 400);
};

const stripHtml = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const simplify = (p) => {
  const variant = (p.variants || [])[0] || {};
  return {
    id: String(p.id),
    title: String(p.title || '').slice(0, 200),
    handle: String(p.handle || ''),
    vendor: String(p.vendor || '').slice(0, 120),
    productType: String(p.product_type || '').slice(0, 120),
    price: variant.price != null ? String(variant.price) : '',
    compareAtPrice: variant.compare_at_price != null ? String(variant.compare_at_price) : '',
    variantCount: (p.variants || []).length,
    image: ((p.images || [])[0] || {}).src || '',
    description: stripHtml(p.body_html).slice(0, 600),
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 20) : String(p.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20),
  };
};

// Follows up to 3 redirects manually so each new host is re-checked
const fetchShopifyProducts = async (storeInput) => {
  let host = normalizeStoreHost(storeInput);
  if (!host) throw new ImportError('Please enter your Shopify store address.', 400);

  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`https://${host}/products.json?limit=${MAX_PRODUCTS}`, {
        redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'TheMajoritiesPartnerImport/1.0' },
      });
    } catch (e) {
      throw new ImportError("We couldn't reach that store. Check the address and try again.");
    } finally { clearTimeout(timer); }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      let next;
      try { next = new URL(res.headers.get('location'), `https://${host}`); } catch (e) { break; }
      if (next.protocol !== 'https:') break;
      host = next.hostname.toLowerCase();
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new ImportError('That store is password protected. Remove the storefront password or add your products manually.');
    if (!res.ok) throw new ImportError("We couldn't read products from that store. Make sure it's a published Shopify store.");

    const text = await res.text();
    if (text.length > 15 * 1024 * 1024) throw new ImportError('That catalog is too large to import here. Add your top products manually.');
    let data;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.products)) throw new ImportError("We couldn't read products from that store. Make sure it's a published Shopify store.");
    return { store: host, products: data.products.slice(0, MAX_PRODUCTS).map(simplify) };
  }
  throw new ImportError('That store redirected too many times. Try your yourstore.myshopify.com address.');
};

module.exports = { fetchShopifyProducts, normalizeStoreHost, isPrivateIp, ImportError };
