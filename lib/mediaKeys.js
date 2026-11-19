// lib/mediaKeys.js
// Helpers for moving media out of Cloudinary: find every Cloudinary link inside a stored document and
// turn a delivery URL into the stable file it points at (no resize/format transformations).

// Matches a Cloudinary delivery link up to the next quote, space or bracket.
const CLOUDINARY_URL = /https?:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/(?:image|video|raw)\/upload\/[^\s"'<>)\]]+/g;

// → { resourceType: 'image'|'video'|'raw', key: 'video/user_media/abc.mp4', cloud } or null.
// Drops transformation segments (c_limit,w_1080 / f_mp4,vc_h264) and the version (v1794…).
const parseCloudinaryUrl = (url) => {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== 'res.cloudinary.com') return null;
  const parts = u.pathname.split('/').filter(Boolean); // [cloud, type, 'upload', ...rest]
  if (parts.length < 4 || parts[2] !== 'upload') return null;
  const [cloud, resourceType] = parts;
  if (!['image', 'video', 'raw'].includes(resourceType)) return null;
  let rest = parts.slice(3);
  const vIdx = rest.findIndex((seg) => /^v\d+$/.test(seg));
  rest = vIdx > -1 ? rest.slice(vIdx + 1) : rest.filter((seg) => !/^[a-z]{1,3}_[^/]*$/i.test(seg));
  if (!rest.length) return null;
  const path = decodeURIComponent(rest.join('/'));
  return { cloud, resourceType, key: `${resourceType}/${path}` };
};

// Every distinct Cloudinary URL string found anywhere inside a value (objects, arrays, text).
const findCloudinaryUrls = (value, out = new Set()) => {
  if (typeof value === 'string') {
    for (const m of value.matchAll(CLOUDINARY_URL)) out.add(m[0]);
  } else if (Array.isArray(value)) value.forEach((v) => findCloudinaryUrls(v, out));
  else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach((v) => findCloudinaryUrls(v, out));
  }
  return out;
};

const CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
};
const contentTypeFor = (key) => CONTENT_TYPES[String(key).split('.').pop().toLowerCase()] || 'application/octet-stream';

module.exports = { CLOUDINARY_URL, parseCloudinaryUrl, findCloudinaryUrls, contentTypeFor };
