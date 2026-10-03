// lib/places.js
// Nearest named place (venue, business, landmark) for a GPS position, via Google Places API (New).
// Used by the mobile app's auto-location so posts can be tagged "Place Name, Address".
// Requires GOOGLE_PLACES_API_KEY (a server key with the Places API (New) enabled).

const axios = require('axios');

const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const SEARCH_RADIUS_METERS = 75;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

// Keyed by coordinates rounded to ~11m, so repeat taps from the same spot don't hit Google again
const cache = new Map();

// Same rule as the web's formatPlaceLabel: "Name, Address", skipping the name when the
// address already starts with it (cities, plain street addresses).
const formatPlaceLabel = (name, address) => {
  const n = (name || '').trim();
  const a = (address || '').trim();
  if (!a) return n;
  if (!n || a.toLowerCase().startsWith(n.toLowerCase())) return a;
  return `${n}, ${a}`;
};

const parseCoordinate = (value, limit) => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && Math.abs(num) <= limit ? num : null;
};

const isPlacesConfigured = () => Boolean(process.env.GOOGLE_PLACES_API_KEY);

// Returns { name, address, label } for the closest place, or null when nothing named is nearby.
const findNearestPlace = async (lat, lng) => {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const response = await axios.post(
    NEARBY_URL,
    {
      maxResultCount: 1,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_RADIUS_METERS },
      },
    },
    {
      headers: {
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        // Only request the fields we use (keeps the call on the cheaper billing tier)
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress',
      },
      timeout: 5000,
    }
  );

  const place = response.data?.places?.[0];
  const value = place
    ? {
        name: place.displayName?.text || '',
        address: place.formattedAddress || '',
        label: formatPlaceLabel(place.displayName?.text, place.formattedAddress),
      }
    : null;

  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
};

module.exports = { findNearestPlace, formatPlaceLabel, parseCoordinate, isPlacesConfigured };
