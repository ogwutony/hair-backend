// lib/cloudinaryUrls.js
// Rewrites Cloudinary delivery URLs from one cloud name to another, anywhere inside a
// stored document (nested objects and arrays). Used by scripts/migrate-cloudinary-urls.js.

const CLOUD_NAME_PATTERN = /^[a-z0-9_-]+$/i;

const assertCloudName = (name, label) => {
  if (!name || !CLOUD_NAME_PATTERN.test(name)) throw new Error(`${label} must be a Cloudinary cloud name (letters, numbers, - and _ only)`);
};

const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

// Returns { value, changed, count }. Leaves ObjectIds, Dates, Buffers etc. untouched.
const rewriteCloudinaryUrls = (input, fromCloud, toCloud) => {
  assertCloudName(fromCloud, 'from');
  assertCloudName(toCloud, 'to');
  // Matches both res.cloudinary.com/<cloud>/ and <cloud>-res.cloudinary.com private CDN hosts.
  const pattern = new RegExp(`(https?://res\\.cloudinary\\.com/)${fromCloud}(?=/)|(https?://)${fromCloud}(-res\\.cloudinary\\.com)`, 'g');
  let count = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      return v.replace(pattern, (m, resPrefix, scheme, hostSuffix) => {
        count += 1;
        return resPrefix ? `${resPrefix}${toCloud}` : `${scheme}${toCloud}${hostSuffix}`;
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (isPlainObject(v)) {
      const out = {};
      for (const [k, child] of Object.entries(v)) out[k] = walk(child);
      return out;
    }
    return v;
  };
  const value = walk(input);
  return { value, changed: count > 0, count };
};

// Top-level fields whose value changed, for a minimal $set.
const changedTopLevelFields = (before, after) => {
  const set = {};
  for (const key of Object.keys(after)) {
    if (key === '_id') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) set[key] = after[key];
  }
  return set;
};

module.exports = { rewriteCloudinaryUrls, changedTopLevelFields };
