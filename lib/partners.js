// lib/partners.js
// Validation for partner applications (POST /api/duma/partner), sent as multipart/form-data
// by hair-frontend's PartnerPage and the mobile PartnerScreen. Every multipart field arrives
// as a string, so checkboxes are compared against 'true'.

const PARTNER_CATEGORIES = [
  'Creator / Influencer Partners',
  'Community / Venue Partners',
  'Brand & Retail Partners',
  'Marketplace Access',
  'Review Request',
];

const REVIEW_REQUEST = 'Review Request';
const REVIEW_TARGET_TYPES = ['Restaurant', 'Bar', 'Event', 'Product'];
const PHYSICAL_REVIEW_TARGETS = ['Restaurant', 'Bar', 'Event'];
const EIN_OPTIONAL_CATEGORIES = [REVIEW_REQUEST, 'Creator / Influencer Partners'];

// Agreements every non-review category must accept
const STANDARD_AGREEMENTS = ['customerRewardAgreed', 'commission20AgreedTo', 'shippingReturnsAgreed', 'ownershipTitleAgreed'];

// Category-specific fields kept with the application (never shown publicly)
const CATEGORY_FIELDS = {
  'Marketplace Access': ['productTypes', 'productDetails', 'whyPartner', 'desiredOrderQuantity', 'pricing5Gallon', 'standardUnitPrice', 'promotionalUnitPrice'],
  'Creator / Influencer Partners': ['contentTypes', 'contentPitch', 'commission8Agreed'],
  'Community / Venue Partners': ['eventDetails', 'majoritiesRole', 'bulkOrderNeeded', 'totalBudget'],
  'Brand & Retail Partners': ['advertisingInterest', 'wholesaleInterest', 'sponsoredDumaInterest', 'sponsoredMarketplaceInterest', 'totalBudget'],
  [REVIEW_REQUEST]: ['reviewTargetType', 'reviewAddress', 'preferredDate', 'preferredTime', 'websiteLink', 'socialLink', 'sponsoredDumaPlacement', 'reviewTermsAgreed'],
};

const str = (v) => (typeof v === 'string' ? v.trim() : '').slice(0, 20000);
const isChecked = (v) => v === true || v === 'true';
const isDeclined = (v) => v === false || v === 'false';
const isHttpUrl = (v) => /^https?:\/\/\S+\.\S+/i.test(v);

// Returns { error } or { application } where application is what gets stored privately.
const validatePartnerApplication = (body = {}) => {
  const category = str(body.partnerCategory);
  if (!PARTNER_CATEGORIES.includes(category)) return { error: 'Please choose a valid partnership category.' };
  const isReview = category === REVIEW_REQUEST;
  // Review requests never collect an EIN; individual creators often don't have one, so it's optional for them
  const einRequired = !EIN_OPTIONAL_CATEGORIES.includes(category);

  const contact = {
    name: str(body.name),
    contactEmail: str(body.contactEmail),
    phoneNumber: str(body.phoneNumber),
    ein: isReview ? '' : str(body.ein),
  };
  if (!contact.name || !contact.contactEmail || !contact.phoneNumber || (einRequired && !contact.ein)) {
    return { error: 'Please fill in all contact information fields.' };
  }

  const company = str(body.company);
  const countryOfOrigin = str(body.countryOfOrigin);
  const operatingCountry = str(body.operatingCountry);
  if (!company || !countryOfOrigin || !operatingCountry) {
    return { error: 'Please fill in all company information fields.' };
  }

  const details = {};
  for (const field of CATEGORY_FIELDS[category]) details[field] = str(body[field]);

  if (isReview) {
    if (!REVIEW_TARGET_TYPES.includes(details.reviewTargetType)) return { error: 'Please choose what you want reviewed.' };
    if (PHYSICAL_REVIEW_TARGETS.includes(details.reviewTargetType) && !details.reviewAddress) {
      return { error: 'Please provide the venue or event address.' };
    }
    if (!details.preferredDate || !details.preferredTime) return { error: 'Please provide the best date and time to visit.' };
    if (!isHttpUrl(details.websiteLink) || !isHttpUrl(details.socialLink)) {
      return { error: 'Please provide a valid website link and social media link (starting with https://).' };
    }
    if (!isChecked(details.reviewTermsAgreed)) return { error: 'You must agree to the Review Terms & Media Rights Consent.' };
  } else if (STANDARD_AGREEMENTS.some((k) => isDeclined(body[k]))) {
    // Released mobile builds check these on-device but don't send them, so only an explicit "false" fails
    return { error: 'You must agree to all policies and agreements.' };
  }

  if (category === 'Creator / Influencer Partners' && isDeclined(details.commission8Agreed)) {
    return { error: 'You must agree to the 8% referral commission rate.' };
  }

  return {
    application: {
      category,
      ...contact,
      company,
      websiteOrSocial: str(body.websiteOrSocial),
      countryOfOrigin,
      operatingCountry,
      tier: str(body.tier) || 'National Associate',
      agreements: isReview ? { reviewTermsAgreed: true } : Object.fromEntries(STANDARD_AGREEMENTS.map((k) => [k, true])),
      details,
    },
  };
};

// Short public line for the Duma feed — no contact details, EIN, budgets or pricing.
const publicPartnerSummary = ({ category, details }) => {
  if (category === REVIEW_REQUEST) return `Review request: ${details.reviewTargetType}`;
  return category;
};

// Strip private application data before an item is sent to the public feed
const toPublicDumaItem = (item) => {
  const { ein, partner, ...rest } = item;
  return rest;
};

module.exports = {
  PARTNER_CATEGORIES,
  REVIEW_REQUEST,
  EIN_OPTIONAL_CATEGORIES,
  REVIEW_TARGET_TYPES,
  validatePartnerApplication,
  publicPartnerSummary,
  toPublicDumaItem,
};
